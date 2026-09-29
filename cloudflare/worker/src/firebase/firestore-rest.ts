import { HttpError, type Bindings, type FirestoreDocument, type JsonObject } from "../types";

type FirestoreValue = Record<string, unknown>;
type Write = {
  path: string;
  data?: JsonObject;
  updateTime?: string;
  mustNotExist?: boolean;
  delete?: boolean;
};

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
}

interface GoogleErrorBody {
  error?: { status?: string; message?: string; code?: number };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeBase64UrlText(value: string): string {
  return base64Url(new TextEncoder().encode(value));
}

function pemToBytes(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeValue(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: FirestoreValue[] } | undefined)?.values ?? [];
    return values.map(decodeValue);
  }
  if ("mapValue" in value) {
    const fields = (value.mapValue as { fields?: Record<string, FirestoreValue> } | undefined)?.fields ?? {};
    return decodeFields(fields);
  }
  return undefined;
}

function decodeFields(fields: Record<string, FirestoreValue> | undefined): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(fields ?? {})) result[key] = decodeValue(value);
  return result;
}

function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Firestore values must be finite numbers.");
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "object") {
    return { mapValue: { fields: encodeFields(value as JsonObject) } };
  }
  throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

function encodeFields(data: JsonObject): Record<string, FirestoreValue> {
  const result: Record<string, FirestoreValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) result[key] = encodeValue(value);
  }
  return result;
}

function documentFromWire(wire: Record<string, unknown>): FirestoreDocument {
  const name = String(wire.name ?? "");
  return {
    name,
    id: name.split("/").at(-1) ?? "",
    updateTime: typeof wire.updateTime === "string" ? wire.updateTime : undefined,
    data: decodeFields(wire.fields as Record<string, FirestoreValue> | undefined),
  };
}

function parseJsonLines(body: string): Record<string, unknown>[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed as Record<string, unknown>[] : [parsed as Record<string, unknown>];
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

function serviceAccount(env: Bindings): ServiceAccount {
  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  } catch {
    throw new HttpError({ code: "configuration_error", message: "Worker service credentials are invalid.", status: 500 });
  }
  if (!parsed.client_email || !parsed.private_key || (parsed.project_id && parsed.project_id !== env.FIREBASE_PROJECT_ID)) {
    throw new HttpError({ code: "configuration_error", message: "Worker service credentials do not match the configured Firebase project.", status: 500 });
  }
  return parsed;
}

async function createAccessToken(env: Bindings): Promise<string> {
  const account = serviceAccount(env);
  const cached = tokenCache.get(account.client_email);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = encodeBase64UrlText(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(pemToBytes(account.private_key)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const tokenUri = account.token_uri || "https://oauth2.googleapis.com/token";
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !payload.access_token) {
    throw new HttpError({ code: "upstream_auth_failed", message: "Could not authenticate the Firestore service account.", status: 502 });
  }
  tokenCache.set(account.client_email, {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  });
  return payload.access_token;
}

export class TransactionConflict extends Error {
  constructor() {
    super("Firestore transaction conflicted.");
    this.name = "TransactionConflict";
  }
}

export class FirestoreTransaction {
  private readonly writes: Write[] = [];
  private writePhase = false;

  constructor(private readonly db: FirestoreRest, readonly transactionId: string) {}

  async get(path: string): Promise<FirestoreDocument | null> {
    if (this.writePhase) throw new Error("Firestore transactions must read all documents before writing.");
    return this.db.get(path, this.transactionId);
  }

  async query(collection: string, structuredQuery: JsonObject): Promise<FirestoreDocument[]> {
    if (this.writePhase) throw new Error("Firestore transactions must read all documents before writing.");
    return this.db.query(collection, structuredQuery, this.transactionId);
  }

  set(path: string, data: JsonObject, options: { updateTime?: string; mustNotExist?: boolean } = {}): void {
    this.writePhase = true;
    this.writes.push({ path, data, ...options });
  }

  delete(path: string, options: { updateTime?: string } = {}): void {
    this.writePhase = true;
    this.writes.push({ path, delete: true, ...options });
  }

  async commit(): Promise<void> {
    if (this.writes.length === 0) return;
    await this.db.commit(this.writes, this.transactionId);
  }

  get hasWrites(): boolean {
    return this.writes.length > 0;
  }
}

export class FirestoreRest {
  private readonly baseUrl: string;

  constructor(private readonly env: Bindings) {
    if (!env.FIREBASE_PROJECT_ID || !env.BANCA_ID || !env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      throw new HttpError({ code: "configuration_error", message: "Firestore Worker configuration is incomplete.", status: 500 });
    }
    this.baseUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents`;
  }

  documentPath(path: string): string {
    const clean = path.replace(/^\/+|\/+$/g, "");
    if (!clean || clean.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error("Invalid Firestore document path.");
    }
    return `${this.baseUrl}/${clean.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async request(path: string, init: RequestInit = {}, transactionId?: string): Promise<Response> {
    const token = await createAccessToken(this.env);
    const url = new URL(path);
    if (transactionId) url.searchParams.set("transaction", transactionId);
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (response.ok) return response;

    const raw = await response.text();
    let error: GoogleErrorBody = {};
    try { error = JSON.parse(raw) as GoogleErrorBody; } catch { /* preserve generic failure */ }
    if (response.status === 409 || error.error?.status === "ABORTED") throw new TransactionConflict();
    const status = response.status === 404 ? 404 : response.status >= 500 ? 502 : response.status;
    throw new HttpError({
      code: response.status === 404 ? "not_found" : "firestore_error",
      message: response.status === 404 ? "Document not found." : "Firestore request failed.",
      status,
      details: error.error?.status,
    });
  }

  async get(path: string, transactionId?: string): Promise<FirestoreDocument | null> {
    const response = await this.request(this.documentPath(path), { method: "GET" }, transactionId).catch((error: unknown) => {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    });
    if (!response) return null;
    return documentFromWire(await response.json() as Record<string, unknown>);
  }

  async query(collection: string, structuredQuery: JsonObject, transactionId?: string): Promise<FirestoreDocument[]> {
    const segments = collection.replace(/^\/+|\/+$/g, "").split("/");
    const collectionId = segments.pop();
    if (!collectionId || segments.length % 2 !== 0) throw new Error("Invalid Firestore collection path.");
    const parent = segments.length ? `${this.baseUrl}/${segments.map(encodeURIComponent).join("/")}` : this.baseUrl;
    const path = `${parent}:runQuery`;
    const query = { ...structuredQuery };
    if (!query.from) query.from = [{ collectionId }];
    const response = await this.request(path, {
      method: "POST",
      body: JSON.stringify({ structuredQuery: query, ...(transactionId ? { transaction: transactionId } : {}) }),
    });
    const rows = parseJsonLines(await response.text());
    return rows.filter((row) => row.document && typeof row.document === "object")
      .map((row) => documentFromWire(row.document as Record<string, unknown>));
  }

  async batchGet(paths: string[]): Promise<Map<string, FirestoreDocument>> {
    if (paths.length === 0) return new Map();
    const names = paths.map((path) => this.documentPath(path).replace(`${this.baseUrl}/`, `projects/${this.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/`));
    const response = await this.request(`${this.baseUrl}:batchGet`, {
      method: "POST",
      body: JSON.stringify({ documents: names }),
    });
    const rows = parseJsonLines(await response.text());
    const result = new Map<string, FirestoreDocument>();
    for (const row of rows) {
      if (row.found && typeof row.found === "object") {
        const document = documentFromWire(row.found as Record<string, unknown>);
        result.set(document.name, document);
      }
    }
    return result;
  }

  async count(collection: string, structuredQuery: JsonObject): Promise<number> {
    const segments = collection.replace(/^\/+|\/+$/g, "").split("/");
    const collectionId = segments.pop();
    if (!collectionId || segments.length % 2 !== 0) throw new Error("Invalid Firestore collection path.");
    const parent = segments.length ? `${this.baseUrl}/${segments.map(encodeURIComponent).join("/")}` : this.baseUrl;
    const query = { ...structuredQuery };
    if (!query.from) query.from = [{ collectionId }];
    const response = await this.request(`${parent}:runAggregationQuery`, {
      method: "POST",
      body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: query, aggregations: [{ alias: "count", count: {} }] } }),
    });
    const rows = parseJsonLines(await response.text());
    const value = rows[0]?.result as { aggregateFields?: Record<string, { integerValue?: string }> } | undefined;
    const count = Number(value?.aggregateFields?.count?.integerValue ?? 0);
    return Number.isSafeInteger(count) ? count : 0;
  }

  async beginTransaction(): Promise<string> {
    const response = await this.request(`${this.baseUrl}:beginTransaction`, {
      method: "POST",
      body: JSON.stringify({ options: { readWrite: {} } }),
    });
    const payload = await response.json() as { transaction?: string };
    if (!payload.transaction) throw new HttpError({ code: "firestore_error", message: "Firestore did not create a transaction.", status: 502 });
    return payload.transaction;
  }

  transaction(): Promise<FirestoreTransaction> {
    return this.beginTransaction().then((id) => new FirestoreTransaction(this, id));
  }

  async transact<T>(operation: (transaction: FirestoreTransaction) => Promise<T>, retries = 4): Promise<T> {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      const transaction = await this.transaction();
      try {
        const result = await operation(transaction);
        if (transaction.hasWrites) await transaction.commit();
        else await this.rollbackIgnoringFailure(transaction.transactionId);
        return result;
      } catch (error) {
        await this.rollbackIgnoringFailure(transaction.transactionId);
        if (error instanceof TransactionConflict) {
          if (attempt < retries - 1) continue;
          throw new HttpError({ code: "concurrent_update", message: "The record changed concurrently. Retry the request.", status: 409 });
        }
        throw error;
      }
    }
    throw new HttpError({ code: "concurrent_update", message: "The record changed concurrently. Retry the request.", status: 409 });
  }

  private async rollbackIgnoringFailure(transactionId: string): Promise<void> {
    try {
      await this.rollback(transactionId);
    } catch {
      // A failed operation may already have aborted the transaction. Keep the
      // operation's original error (or read-only result) authoritative.
    }
  }

  async rollback(transactionId: string): Promise<void> {
    const response = await this.request(`${this.baseUrl}:rollback`, {
      method: "POST",
      body: JSON.stringify({ transaction: transactionId }),
    });
    await response.arrayBuffer();
  }

  async commit(writes: Write[], transactionId?: string): Promise<void> {
    const updates = writes.map((write) => {
      const name = this.documentPath(write.path).replace(`${this.baseUrl}/`, `projects/${this.env.FIREBASE_PROJECT_ID}/databases/(default)/documents/`);
      const wireWrite: JsonObject = write.delete ? { delete: name } : {
        update: { name, fields: encodeFields(write.data ?? {}) },
      };
      if (write.mustNotExist) wireWrite.currentDocument = { exists: false };
      else if (write.updateTime) wireWrite.currentDocument = { updateTime: write.updateTime };
      return wireWrite;
    });
    const response = await this.request(`${this.baseUrl}:commit`, {
      method: "POST",
      body: JSON.stringify({ writes: updates, ...(transactionId ? { transaction: transactionId } : {}) }),
    });
    await response.arrayBuffer();
  }
}
