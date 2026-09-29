import { describe, expect, it } from "vitest";
import { handleClientRoute } from "../../cloudflare/worker/src/routes/client";
import { FirestoreRest, TransactionConflict } from "../../cloudflare/worker/src/firebase/firestore-rest";
import { getClientIdentity, hashClientSessionToken, hashCustomerPhone, isBrazilianPhone, normalizePhone, verifyClientSessionSignature } from "../../cloudflare/worker/src/security";
import { HttpError, type Bindings, type FirestoreDocument, type JsonObject, type RequestContext } from "../../cloudflare/worker/src/types";

type StoredDocument = FirestoreDocument & { version: number };
type TransactionState = {
  reads: Map<string, number>;
  queryEpochs: Map<string, number>;
};

const projectId = "reservation-test-project";
const bankId = "test-bank";
const reparteId = "test-reparte";
const stockId = "test-stock";
const listId = "published-list";
const clientId = "test-client";
const clientToken = "a".repeat(43);
const pepper = "unit-test-pepper-with-at-least-thirty-two-bytes";

/**
 * An in-memory Firestore substitute that keeps the real FirestoreRest.transact
 * retry loop. Commits check both document versions and query collection epochs,
 * then apply each write atomically, as Firestore does for this test's needs.
 */
class InMemoryFirestore extends FirestoreRest {
  readonly documents = new Map<string, StoredDocument>();
  readonly queryCalls: string[] = [];
  private readonly versions = new Map<string, number>();
  private readonly collectionEpochs = new Map<string, number>();
  private readonly transactions = new Map<string, TransactionState>();
  private nextTransactionId = 1;
  private commitBarrier: { count: number; arrivals: number; promise: Promise<void>; release: () => void } | null = null;

  constructor(env: Bindings) {
    super(env);
  }

  seed(path: string, data: JsonObject): void {
    const version = (this.versions.get(path) ?? 0) + 1;
    this.versions.set(path, version);
    this.documents.set(path, this.toDocument(path, data, version));
    this.bumpCollection(path);
  }

  synchronizeNextCommits(count: number): void {
    let release = () => {};
    const promise = new Promise<void>((resolve) => { release = resolve; });
    this.commitBarrier = { count, arrivals: 0, promise, release };
  }

  override async beginTransaction(): Promise<string> {
    const id = `memory-transaction-${this.nextTransactionId++}`;
    this.transactions.set(id, { reads: new Map(), queryEpochs: new Map() });
    return id;
  }

  override async get(path: string, transactionId?: string): Promise<FirestoreDocument | null> {
    if (transactionId) {
      const state = this.requireTransaction(transactionId);
      if (!state.reads.has(path)) state.reads.set(path, this.versions.get(path) ?? 0);
    }
    const document = this.documents.get(path);
    return document ? this.copyDocument(document) : null;
  }

  override async query(collection: string, structuredQuery: JsonObject, transactionId?: string): Promise<FirestoreDocument[]> {
    this.queryCalls.push(collection);
    const prefix = `${collection.replace(/^\/+|\/+$/g, "")}/`;
    const epochKey = collection.replace(/^\/+|\/+$/g, "");
    const immediateDocuments = [...this.documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"));

    if (transactionId) {
      const state = this.requireTransaction(transactionId);
      if (!state.queryEpochs.has(epochKey)) state.queryEpochs.set(epochKey, this.collectionEpochs.get(epochKey) ?? 0);
      for (const [path] of immediateDocuments) {
        if (!state.reads.has(path)) state.reads.set(path, this.versions.get(path) ?? 0);
      }
    }

    const filtered = immediateDocuments
      .map(([, document]) => document)
      .filter((document) => this.matchesQuery(document.data, structuredQuery))
      .slice(0, Number((structuredQuery.limit as number | undefined) ?? Number.MAX_SAFE_INTEGER));
    return filtered.map((document) => this.copyDocument(document));
  }

  override async commit(writes: Parameters<FirestoreRest["commit"]>[0], transactionId?: string): Promise<void> {
    if (transactionId && this.commitBarrier) {
      const barrier = this.commitBarrier;
      barrier.arrivals += 1;
      if (barrier.arrivals >= barrier.count) {
        this.commitBarrier = null;
        barrier.release();
      }
      await barrier.promise;
    }

    const state = transactionId ? this.requireTransaction(transactionId) : null;
    if (state) {
      for (const [path, readVersion] of state.reads) {
        if ((this.versions.get(path) ?? 0) !== readVersion) throw new TransactionConflict();
      }
      for (const [collection, epoch] of state.queryEpochs) {
        if ((this.collectionEpochs.get(collection) ?? 0) !== epoch) throw new TransactionConflict();
      }
    }

    for (const write of writes) {
      const current = this.documents.get(write.path);
      if (write.mustNotExist && current) throw new TransactionConflict();
      if (write.updateTime && current?.updateTime !== write.updateTime) throw new TransactionConflict();
    }

    for (const write of writes) {
      const version = (this.versions.get(write.path) ?? 0) + 1;
      this.versions.set(write.path, version);
      if (write.delete) this.documents.delete(write.path);
      else this.documents.set(write.path, this.toDocument(write.path, write.data ?? {}, version));
      this.bumpCollection(write.path);
    }
  }

  override async rollback(transactionId: string): Promise<void> {
    this.transactions.delete(transactionId);
  }

  private requireTransaction(id: string): TransactionState {
    const state = this.transactions.get(id);
    if (!state) throw new Error(`Unknown in-memory transaction: ${id}`);
    return state;
  }

  private toDocument(path: string, data: JsonObject, version: number): StoredDocument {
    return {
      name: `projects/${projectId}/databases/(default)/documents/${path}`,
      id: path.split("/").at(-1) ?? "",
      updateTime: `version-${version}`,
      data: structuredClone(data),
      version,
    };
  }

  private copyDocument(document: StoredDocument): StoredDocument {
    return { ...document, data: structuredClone(document.data) };
  }

  private bumpCollection(path: string): void {
    const collection = path.split("/").slice(0, -1).join("/");
    this.collectionEpochs.set(collection, (this.collectionEpochs.get(collection) ?? 0) + 1);
  }

  private matchesQuery(data: JsonObject, structuredQuery: JsonObject): boolean {
    const where = structuredQuery.where as JsonObject | undefined;
    if (!where) return true;
    const filters = "fieldFilter" in where
      ? [where.fieldFilter as JsonObject]
      : ((where.compositeFilter as JsonObject | undefined)?.filters as Array<JsonObject> | undefined ?? [])
        .map((entry) => entry.fieldFilter as JsonObject);
    return filters.every((filter) => {
      const field = (filter.field as JsonObject | undefined)?.fieldPath;
      const encoded = filter.value as JsonObject | undefined;
      if (typeof field !== "string" || !encoded) return false;
      const expected = "stringValue" in encoded ? encoded.stringValue
        : "booleanValue" in encoded ? encoded.booleanValue
          : "integerValue" in encoded ? Number(encoded.integerValue)
            : "doubleValue" in encoded ? encoded.doubleValue
              : undefined;
      if (filter.op === "IN") {
        const values = ((encoded.arrayValue as JsonObject | undefined)?.values as JsonObject[] | undefined) ?? [];
        return values.some((value) => data[field] === ("stringValue" in value ? value.stringValue : value));
      }
      return data[field] === expected;
    });
  }
}

function testEnv(): Bindings {
  return {
    FIREBASE_PROJECT_ID: projectId,
    BANCA_ID: bankId,
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "fake@example.test", private_key: "unused" }),
    CLIENT_SESSION_PEPPER: pepper,
    CORS_ORIGINS: "https://banca.example.test",
    CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  };
}

async function createContext(db: InMemoryFirestore, path: string, key: string): Promise<RequestContext> {
  const env = testEnv();
  const sessionId = await hashClientSessionToken(env, clientToken);
  if (!db.documents.has(`sessoesClientes/${sessionId}`)) {
    db.seed(`sessoesClientes/${sessionId}`, {
      bancaId: bankId,
      clienteId: clientId,
      ativa: true,
      expiraEm: new Date(Date.now() + 86_400_000).toISOString(),
    });
    db.seed(`clientes/${clientId}`, { bancaId: bankId, ativo: true, nome: "Ana Maria", telefoneFinal: "1234" });
  }
  const request = new Request(`https://banca.example.test${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${clientToken}`,
      "content-type": "application/json",
      "idempotency-key": key,
      "cf-connecting-ip": "192.0.2.1",
    },
    body: path === "/api/client/reservations"
      ? JSON.stringify({ desiredDate: nextOpenDate(), desiredTime: "12:00", items: [{ itemReparteId: stockId, quantity: 1 }] })
      : "{}",
  });
  return { request, url: new URL(request.url), env, db, corsOrigin: null };
}

async function createRouteContext(
  db: InMemoryFirestore,
  path: string,
  options: { method: string; body: JsonObject; key: string; authenticated?: boolean },
): Promise<RequestContext> {
  const env = testEnv();
  const headers = new Headers({
    "content-type": "application/json",
    "idempotency-key": options.key,
    "cf-connecting-ip": "192.0.2.2",
  });
  if (options.authenticated !== false) {
    const sessionId = await hashClientSessionToken(env, clientToken);
    if (!db.documents.has(`sessoesClientes/${sessionId}`)) {
      db.seed(`sessoesClientes/${sessionId}`, {
        bancaId: bankId,
        clienteId: clientId,
        ativa: true,
        expiraEm: new Date(Date.now() + 86_400_000).toISOString(),
      });
      db.seed(`clientes/${clientId}`, { bancaId: bankId, ativo: true, nome: "Ana Maria", telefoneFinal: "1234" });
    }
    headers.set("authorization", `Bearer ${clientToken}`);
  }
  const request = new Request(`https://banca.example.test${path}`, {
    method: options.method,
    headers,
    ...(["GET", "HEAD"].includes(options.method.toUpperCase()) ? {} : { body: JSON.stringify(options.body) }),
  });
  return { request, url: new URL(request.url), env, db, corsOrigin: null };
}

function nextOpenDate(): string {
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(localParts.find((part) => part.type === "year")?.value);
  const month = Number(localParts.find((part) => part.type === "month")?.value);
  const day = Number(localParts.find((part) => part.type === "day")?.value);
  for (let offset = 1; offset <= 9; offset += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day + offset));
    if (candidate.getUTCDay() !== 0) return candidate.toISOString().slice(0, 10);
  }
  throw new Error("Could not find an open date in the next nine days.");
}

function seedPublishedStock(db: InMemoryFirestore, received = 1, reserved = 0): void {
  const now = new Date();
  db.seed(`bancas/${bankId}`, { ativo: true, toleranciaRetiradaDias: 2 });
  db.seed(`repartes/${reparteId}`, {
    bancaId: bankId,
    status: "ATIVO",
    dataRecolhimentoPrevista: new Date(now.getTime() + 20 * 86_400_000).toISOString(),
  });
  db.seed(`listas/${listId}`, { bancaId: bankId, status: "PUBLICADA" });
  db.seed(`itensReparte/${stockId}`, {
    bancaId: bankId,
    reparteId,
    produtoId: "product-1",
    status: "DISPONIVEL",
    publicadoEm: now.toISOString(),
    quantidadeRecebida: received,
    quantidadeReservada: reserved,
    quantidadeRetirada: 0,
    quantidadeDevolvida: 0,
    quantidadeAjustePositivo: 0,
    quantidadeAjusteNegativo: 0,
  });
  db.seed("itensLista/catalog-row-1", {
    bancaId: bankId,
    listaId: listId,
    itemReparteId: stockId,
    tituloExibicao: "Revista de teste",
    volumeExibicao: null,
    precoExibicao: 12,
    ativo: true,
    availableUnits: received - reserved,
    availabilityClass: "AVAILABLE",
  });
}

async function invoke(ctx: RequestContext): Promise<{ status: number; payload: JsonObject }> {
  try {
    const response = await handleClientRoute(ctx);
    if (!response) throw new Error("Expected the client route to handle this request.");
    return { status: response.status, payload: await response.json() as JsonObject };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { status: error.status, payload: { error: { code: error.code, message: error.message } } };
  }
}

describe("Cloudflare Worker reservation transactions", () => {
  it("allows only one concurrent reservation for the last unit and releases it atomically on cancellation", async () => {
    const db = new InMemoryFirestore(testEnv());
    seedPublishedStock(db);
    db.synchronizeNextCommits(2);

    const [first, second] = await Promise.all([
      createContext(db, "/api/client/reservations", "reserve-request-0001").then(invoke),
      createContext(db, "/api/client/reservations", "reserve-request-0002").then(invoke),
    ]);
    const responses = [first, second].sort((a, b) => a.status - b.status);

    expect(responses.map((response) => response.status)).toEqual([201, 409]);
    expect(responses[0].payload.data).toMatchObject({
      id: expect.any(String),
      status: "ATIVA",
      items: [{ itemReparteId: stockId, title: "Revista de teste", quantity: 1 }],
    });
    expect((responses[1].payload.error as JsonObject).code).toBe("insufficient_stock");
    expect(db.documents.get(`itensReparte/${stockId}`)?.data.quantidadeReservada).toBe(1);
    expect(db.documents.get("itensLista/catalog-row-1")?.data.availableUnits).toBe(0);

    const reservationDocs = [...db.documents.entries()].filter(([path]) => path.startsWith("reservas/"));
    const itemReservationDocs = [...db.documents.entries()].filter(([path]) => path.startsWith("itensReserva/"));
    const reservationMovements = [...db.documents.entries()].filter(([path, document]) =>
      path.startsWith("movimentacoesEstoque/") && document.data.tipo === "RESERVA");
    expect(reservationDocs).toHaveLength(1);
    expect(itemReservationDocs).toHaveLength(1);
    expect(reservationMovements).toHaveLength(1);
    expect(itemReservationDocs[0][1].data.itemReparteId).toBe(stockId);
    expect(reservationMovements[0][1].data.itemReparteId).toBe(stockId);
    expect(reservationMovements[0][1].data.itemReservaId).toBe(itemReservationDocs[0][1].id);

    const reservationId = reservationDocs[0][1].id;
    const cancel = await invoke(await createContext(db, `/api/client/reservations/${reservationId}/cancel`, "cancel-request-0001"));
    expect(cancel.status).toBe(200);
    expect((cancel.payload.data as JsonObject).status).toBe("CANCELADA");
    expect(db.documents.get(`itensReparte/${stockId}`)?.data.quantidadeReservada).toBe(0);
    expect(db.documents.get("itensLista/catalog-row-1")?.data.availableUnits).toBe(1);
    expect(db.documents.get(`itensReserva/${itemReservationDocs[0][1].id}`)?.data.status).toBe("CANCELADO_CLIENTE");
    expect([...db.documents.values()].filter((document) => document.data.tipo === "CANCELAMENTO")).toHaveLength(1);
  });

  it("rejects a pre-existing negative inventory balance without writing reservation records", async () => {
    const db = new InMemoryFirestore(testEnv());
    seedPublishedStock(db, 1, 2);

    const response = await invoke(await createContext(db, "/api/client/reservations", "reserve-invalid-0001"));

    expect(response.status).toBe(409);
    expect((response.payload.error as JsonObject).code).toBe("inventory_invariant_failed");
    expect(db.documents.get(`itensReparte/${stockId}`)?.data.quantidadeReservada).toBe(2);
    expect([...db.documents.keys()].some((path) => path.startsWith("reservas/"))).toBe(false);
    expect([...db.documents.keys()].some((path) => path.startsWith("itensReserva/"))).toBe(false);
    expect([...db.documents.keys()].some((path) => path.startsWith("movimentacoesEstoque/"))).toBe(false);
  });

  it("updates a reservation intent using the documented input and returns the complete reservation", async () => {
    const db = new InMemoryFirestore(testEnv());
    const reservationId = "reservation-intent-1";
    db.seed(`reservas/${reservationId}`, {
      bancaId: bankId,
      clienteId: clientId,
      status: "ATIVA",
      criadaEm: new Date().toISOString(),
      dataRetiradaPretendida: new Date(Date.now() + 86_400_000).toISOString(),
      horarioAproximado: "12:00",
      expiraEm: new Date(Date.now() + 172_800_000).toISOString(),
      intencaoRetirada: "SEM_RESPOSTA",
    });
    db.seed("itensReserva/reservation-item-1", {
      bancaId: bankId,
      clienteId: clientId,
      reservaId: reservationId,
      itemReparteId: stockId,
      produtoId: "product-1",
      tituloSnapshot: "Revista de teste",
      volumeSnapshot: "02",
      quantidade: 2,
      quantidadeOriginal: 2,
      status: "RESERVADO",
    });

    const response = await invoke(await createRouteContext(db, `/api/client/reservations/${reservationId}/intent`, {
      method: "PATCH",
      body: { intent: "ESTOU_INDO" },
      key: "intent-request-0001",
    }));

    expect(response.status).toBe(200);
    expect(response.payload.data).toMatchObject({
      id: reservationId,
      status: "ATIVA",
      pickupIntent: "ESTOU_INDO",
      items: [{ itemReparteId: stockId, title: "Revista de teste", quantity: 2 }],
    });
  });

  it("does not issue a new session for a profile already claimed on another device", async () => {
    const env = testEnv();
    const db = new InMemoryFirestore(env);
    const phone = "5517999991234";
    const phoneHash = await hashCustomerPhone(env, phone);
    db.seed(`bancas/${bankId}`, { ativo: true });
    db.seed("clientes/existing-client", {
      bancaId: bankId,
      ativo: true,
      nomeNormalizado: "ana maria",
      telefone: phone,
    });
    db.seed(`indiceTelefonesClientes/${phoneHash}`, { bancaId: bankId, clienteId: "existing-client" });

    const response = await invoke(await createRouteContext(db, "/api/client/sessions", {
      method: "POST",
      body: { name: "Ana Maria", phone },
      key: "session-request-0001",
      authenticated: false,
    }));

    expect(response.status).toBe(404);
    expect((response.payload.error as JsonObject).code).toBe("identity_not_found");
    expect([...db.documents.keys()].filter((path) => path.startsWith("sessoesClientes/")).sort()).toEqual([]);
  });

  it("normalizes national and country-code Brazilian numbers to one phone index", async () => {
    const env = testEnv();
    const db = new InMemoryFirestore(env);
    db.seed(`bancas/${bankId}`, { ativo: true });

    expect(normalizePhone("(17) 99999-1234")).toBe("5517999991234");
    expect(normalizePhone("+55 17 99999-1234")).toBe("5517999991234");
    expect(normalizePhone("00 55 17 99999-1234")).toBe("5517999991234");
    expect(isBrazilianPhone("5517999991234")).toBe(true);
    expect(isBrazilianPhone("55179999123456")).toBe(false);

    const created = await invoke(await createRouteContext(db, "/api/client/sessions", {
      method: "POST", body: { name: "Ana Maria", phone: "(17) 99999-1234" }, key: "canonical-phone-0001", authenticated: false,
    }));
    expect(created.status).toBe(201);
    const duplicate = await invoke(await createRouteContext(db, "/api/client/sessions", {
      method: "POST", body: { name: "Outra pessoa", phone: "+55 17 99999-1234" }, key: "canonical-phone-0002", authenticated: false,
    }));
    expect(duplicate.status).toBe(404);
    expect([...db.documents.keys()].filter((path) => path.startsWith("clientes/")).length).toBe(1);
    expect([...db.documents.keys()].filter((path) => path.startsWith("indiceTelefonesClientes/")).length).toBe(1);
  });

  it("returns the same session error for a linked phone with matching or nonmatching name", async () => {
    const env = testEnv();
    const db = new InMemoryFirestore(env);
    const nationalPhone = "1799991234";
    const phoneHash = await hashCustomerPhone(env, nationalPhone);
    db.seed(`bancas/${bankId}`, { ativo: true });
    db.seed(`clientes/existing-client`, { bancaId: bankId, ativo: true, nomeNormalizado: "ana maria", telefone: nationalPhone });
    db.seed(`indiceTelefonesClientes/${phoneHash}`, { bancaId: bankId, clienteId: "existing-client" });

    const wrongName = await invoke(await createRouteContext(db, "/api/client/sessions", {
      method: "POST", body: { name: "Outra pessoa", phone: "+55 17 9999-1234" }, key: "same-error-0001", authenticated: false,
    }));
    const matchingName = await invoke(await createRouteContext(db, "/api/client/sessions", {
      method: "POST", body: { name: "Ana Maria", phone: "+55 17 9999-1234" }, key: "same-error-0002", authenticated: false,
    }));
    expect(wrongName).toEqual({
      status: 404,
      payload: { error: { code: "identity_not_found", message: "No profile matched those details." } },
    });
    expect(matchingName).toEqual(wrongName);
  });

  it("migrates a legacy national-number index to the canonical key on profile update", async () => {
    const db = new InMemoryFirestore(testEnv());
    const context = await createRouteContext(db, "/api/client/profile", {
      method: "PATCH", body: { name: "Ana Maria", phone: "+55 (17) 9999-1234" }, key: "phone-migration-0001",
    });
    const legacyHash = await hashCustomerPhone(context.env, "1799991234");
    const canonicalHash = await hashCustomerPhone(context.env, "551799991234");
    db.seed(`indiceTelefonesClientes/${legacyHash}`, { bancaId: bankId, clienteId: clientId });

    const response = await invoke(context);

    expect(response.status).toBe(200);
    expect(db.documents.has(`indiceTelefonesClientes/${legacyHash}`)).toBe(false);
    expect(db.documents.get(`indiceTelefonesClientes/${canonicalHash}`)?.data.clienteId).toBe(clientId);
    expect(db.documents.get(`clientes/${clientId}`)?.data.telefone).toBe("551799991234");
  });

  it("revokes the client session server-side on logout", async () => {
    const db = new InMemoryFirestore(testEnv());
    const context = await createRouteContext(db, "/api/client/sessions/logout", {
      method: "POST", body: {}, key: "logout-session-0001",
    });
    const sessionId = await hashClientSessionToken(context.env, clientToken);
    const response = await invoke(context);
    expect(response.status).toBe(200);
    expect(db.documents.get(`sessoesClientes/${sessionId}`)?.data).toMatchObject({ ativa: false });
    expect(typeof db.documents.get(`sessoesClientes/${sessionId}`)?.data.revogadaEm).toBe("string");

    const profile = await invoke(await createRouteContext(db, "/api/client/profile", {
      method: "GET", body: {}, key: "logout-profile-0001",
    }));
    expect(profile.status).toBe(401);
    expect((profile.payload.error as JsonObject).code).toBe("session_invalid");
  });

  it("rate-limits each authenticated customer read and loads a reservations page with one item query", async () => {
    const db = new InMemoryFirestore(testEnv());
    const paths = ["/api/client/profile", "/api/client/reservations", "/api/client/notifications"];
    for (const path of paths) {
      const context = await createRouteContext(db, path, { method: "GET", body: {}, key: `read-limit-${path.split("/").at(-1)}-01` });
      const rateLimitKeys: string[] = [];
      context.env.CLIENT_RATE_LIMITER = { limit: async ({ key }) => { rateLimitKeys.push(key); return { success: true }; } };
      const result = await invoke(context);
      expect(result.status).toBe(200);
      expect(rateLimitKeys).toHaveLength(1);
    }
    const blockedContext = await createRouteContext(db, "/api/client/profile", { method: "GET", body: {}, key: "read-limit-block-01" });
    blockedContext.env.CLIENT_RATE_LIMITER = { limit: async () => ({ success: false }) };
    expect((await invoke(blockedContext)).status).toBe(429);

    for (let index = 1; index <= 3; index += 1) {
      const reservationId = `reservation-${index}`;
      db.seed(`reservas/${reservationId}`, {
        bancaId: bankId, clienteId: clientId, status: "ATIVA", criadaEm: new Date(Date.now() - index * 1000).toISOString(),
        dataRetiradaPretendida: "2026-10-01T12:00:00.000Z", expiraEm: "2026-10-02T12:00:00.000Z",
      });
      db.seed(`itensReserva/item-${index}`, {
        bancaId: bankId, reservaId: reservationId, itemReparteId: `stock-${index}`, tituloSnapshot: `Item ${index}`,
        quantidade: 1, quantidadeOriginal: 1, status: "RESERVADO",
      });
    }
    db.seed("itensReserva/foreign-item", {
      bancaId: "another-bank", reservaId: "reservation-1", itemReparteId: "foreign-stock", tituloSnapshot: "Not visible",
      quantidade: 1, quantidadeOriginal: 1, status: "RESERVADO",
    });
    db.queryCalls.length = 0;
    const listing = await invoke(await createRouteContext(db, "/api/client/reservations", {
      method: "GET", body: {}, key: "reservations-page-0001",
    }));
    expect(listing.status).toBe(200);
    const reservations = (listing.payload.data as JsonObject).reservations as JsonObject[];
    expect(reservations).toHaveLength(3);
    expect(reservations[0].items).toHaveLength(1);
    expect(db.queryCalls.filter((collection) => collection === "itensReserva")).toHaveLength(1);
  });

  it("renews a valid client session before expiry and verifies scoped cursor HMACs", async () => {
    const env = testEnv();
    const db = new InMemoryFirestore(env);
    const sessionId = await hashClientSessionToken(env, clientToken);
    db.seed(`sessoesClientes/${sessionId}`, {
      bancaId: bankId,
      clienteId: clientId,
      ativa: true,
      expiraEm: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
    db.seed(`clientes/${clientId}`, { bancaId: bankId, ativo: true, nome: "Ana Maria" });
    const request = new Request("https://banca.example.test/api/client/profile", {
      headers: { authorization: `Bearer ${clientToken}` },
    });
    const ctx: RequestContext = { request, url: new URL(request.url), env, db, corsOrigin: null };

    await getClientIdentity(ctx);

    const renewedExpiry = Date.parse(String(db.documents.get(`sessoesClientes/${sessionId}`)?.data.expiraEm));
    expect(renewedExpiry).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const signature = await hashClientSessionToken(env, "admin-cursor:v2:scope:value:id");
    expect(await verifyClientSessionSignature(env, "admin-cursor:v2:scope:value:id", signature)).toBe(true);
    expect(await verifyClientSessionSignature(env, "admin-cursor:v2:other-scope:value:id", signature)).toBe(false);
  });
});
