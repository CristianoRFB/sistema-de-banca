import { hashClientSessionToken } from "./security";
import type { RequestContext } from "./types";
import type { FirestoreTransaction } from "./firebase/firestore-rest";
import { HttpError, type Bindings, type FirestoreDocument, type JsonObject } from "./types";

export function jsonResponse(ctx: RequestContext, payload: unknown, status = 200): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (ctx.corsOrigin) {
    headers.set("access-control-allow-origin", ctx.corsOrigin);
    headers.set("vary", "Origin");
    headers.set("access-control-allow-credentials", "false");
  }
  return new Response(JSON.stringify({ data: payload }), { status, headers });
}

export function emptyResponse(ctx: RequestContext, status = 204): Response {
  const response = jsonResponse(ctx, {}, status);
  return new Response(null, { status: response.status, headers: response.headers });
}

export function errorResponse(ctx: RequestContext, error: HttpError): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  if (ctx.corsOrigin) {
    headers.set("access-control-allow-origin", ctx.corsOrigin);
    headers.set("vary", "Origin");
  }
  return new Response(JSON.stringify({ error: { code: error.code, message: error.message } }), { status: error.status, headers });
}

export async function readJsonBody(request: Request, maxBytes = 32_000): Promise<JsonObject> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBytes) throw new HttpError({ code: "payload_too_large", message: "Request body is too large.", status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new HttpError({ code: "payload_too_large", message: "Request body is too large.", status: 413 });
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch {
    throw new HttpError({ code: "invalid_json", message: "Request body must be valid JSON.", status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError({ code: "invalid_json", message: "Request body must be a JSON object.", status: 400 });
  }
  return parsed as JsonObject;
}

export async function requestFingerprint(value: unknown): Promise<string> {
  const canonical = stableStringify(value);
  const bytes = new TextEncoder().encode(canonical);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function prepareIdempotency(ctx: RequestContext, transaction: FirestoreTransaction, scope: string, body: unknown): Promise<{
  path: string;
  fingerprint: string;
  replay?: unknown;
}> {
  const key = ctx.request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 128) {
    throw new HttpError({ code: "idempotency_key_required", message: "Send an Idempotency-Key header with 8 to 128 characters.", status: 400 });
  }
  const fingerprint = await requestFingerprint(body);
  const docId = await hashClientSessionToken(ctx.env, `operation:v1:${scope}:${key}`);
  const path = `idempotency/${docId}`;
  const existing = await transaction.get(path);
  if (!existing) return { path, fingerprint };
  if (existing.data.requestFingerprint !== fingerprint) {
    throw new HttpError({ code: "idempotency_conflict", message: "This Idempotency-Key was already used for a different request.", status: 409 });
  }
  return { path, fingerprint, replay: existing.data.response };
}

export function saveIdempotency(transaction: FirestoreTransaction, prepared: { path: string; fingerprint: string; replay?: unknown }, response: unknown): void {
  if (prepared.replay !== undefined) return;
  transaction.set(prepared.path, {
    requestFingerprint: prepared.fingerprint,
    response,
    criadaEm: new Date().toISOString(),
  }, { mustNotExist: true });
}

export function parseLimit(value: string | null, defaultLimit: number, maxLimit: number): number {
  if (value === null) return defaultLimit;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxLimit) {
    throw new HttpError({ code: "invalid_limit", message: `limit must be between 1 and ${maxLimit}.`, status: 400 });
  }
  return parsed;
}

export function timestamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function firestoreString(value: string): JsonObject {
  return { stringValue: value };
}

export function firestoreTimestamp(value: Date): JsonObject {
  return { timestampValue: value.toISOString() };
}

export function andFilters(filters: JsonObject[]): JsonObject {
  return filters.length === 1 ? { fieldFilter: filters[0] } : { compositeFilter: { op: "AND", filters: filters.map((filter) => ({ fieldFilter: filter })) } };
}

export function eq(fieldPath: string, value: JsonObject): JsonObject {
  return { field: { fieldPath }, op: "EQUAL", value };
}

export function compare(fieldPath: string, op: string, value: JsonObject): JsonObject {
  return { field: { fieldPath }, op, value };
}

export function query(collectionId: string, filters: JsonObject[], limit: number, orderBy?: JsonObject[], startAt?: JsonObject): JsonObject {
  return {
    from: [{ collectionId }],
    ...(filters.length ? { where: andFilters(filters) } : {}),
    ...(orderBy?.length ? { orderBy } : {}),
    ...(startAt ? { startAt } : {}),
    limit,
  };
}

export async function catalogRowsForStocks(transaction: FirestoreTransaction, env: Bindings, itemReparteIds: string[]): Promise<Map<string, FirestoreDocument[]>> {
  const rows = new Map<string, FirestoreDocument[]>();
  for (const itemReparteId of [...new Set(itemReparteIds)]) {
    const documents = await transaction.query("itensLista", query("itensLista", [
      eq("bancaId", firestoreString(env.BANCA_ID)),
      eq("itemReparteId", firestoreString(itemReparteId)),
      eq("ativo", { booleanValue: true }),
    ], 100));
    rows.set(itemReparteId, documents);
  }
  return rows;
}

export function setCatalogAvailability(transaction: FirestoreTransaction, rowsByStock: Map<string, FirestoreDocument[]>, availabilityByStock: Map<string, number>, now: string): void {
  for (const [itemReparteId, rows] of rowsByStock) {
    const available = Math.max(0, Math.trunc(availabilityByStock.get(itemReparteId) ?? 0));
    const availabilityClass = available === 0 ? "SOLD_OUT" : available <= 3 ? "LOW" : "AVAILABLE";
    for (const row of rows) transaction.set(`itensLista/${row.id}`, {
      ...row.data,
      availableUnits: available,
      availabilityClass,
      availabilityUpdatedAt: now,
    });
  }
}

export function firestoreDocName(projectId: string, path: string): string {
  return `projects/${projectId}/databases/(default)/documents/${path}`;
}
