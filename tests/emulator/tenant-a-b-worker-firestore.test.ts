import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FirestoreRest } from "../../cloudflare/worker/src/firebase/firestore-rest";
import { handleClientRoute } from "../../cloudflare/worker/src/routes/client";
import { handleTenantBootstrapRoute } from "../../cloudflare/worker/src/routes/tenant-bootstrap";
import { hashClientSessionToken } from "../../cloudflare/worker/src/security";
import { runMigration } from "../../scripts/multitenant-migration-core.mjs";
import { resolveRequestTenant } from "../../cloudflare/worker/src/tenant";
import type { Bindings, JsonObject, RequestContext } from "../../cloudflare/worker/src/types";

const projectId = "demo-banca";
type TestEnv = Awaited<ReturnType<typeof initializeTestEnvironment>>;
let testEnv: TestEnv;
let workerDb: FirestoreRest;
let workerEnv: Bindings;
const rawFetch = globalThis.fetch.bind(globalThis);

async function setupWorkerEmulatorBridge(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host || !/^127\.0\.0\.1:\d+$/.test(host)) {
    throw new Error("Firestore Emulator is required at 127.0.0.1; refusing any production database.");
  }
  // Worker still signs its service-account assertion, but the OAuth endpoint is
  // local-only in this test and returns the emulator's privileged sentinel.
  const pair = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const pemBase64 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  const privateKey = "-----BEGIN PRIVATE KEY-----\n" +
    (pemBase64.match(/.{1,64}/g) ?? []).join("\n") + "\n-----END PRIVATE KEY-----\n";
  workerEnv = {
    FIREBASE_PROJECT_ID: projectId,
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: projectId,
      client_email: "emulator-worker@demo-banca.iam.gserviceaccount.com",
      private_key: privateKey,
      token_uri: "https://oauth2.googleapis.com/token",
    }),
    CLIENT_SESSION_PEPPER: "emulator-only-tenant-test-pepper-never-for-production",
    CORS_ORIGINS: "https://banca.example.test",
    // A real deployment provides this Cloudflare binding. The emulator
    // fixture explicitly allows calls without changing production fail-closed logic.
    CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) },
    BANCA_ID: "tenant-a",
  } as Bindings;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "owner", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    const prefix = "https://firestore.googleapis.com/";
    if (url.startsWith(prefix)) {
      const emulatorUrl = "http://" + host + "/" + url.slice(prefix.length);
      return rawFetch(emulatorUrl, init);
    }
    if (url.startsWith("http://" + host + "/")) return rawFetch(input, init);
    throw new Error("Unexpected external request in emulator integration test.");
  });
  workerDb = new FirestoreRest(workerEnv);
}

async function scopedContext(slug: string, endpoint: string, clientToken?: string): Promise<RequestContext> {
  const request = new Request("https://banca.example.test/api/t/" + slug + "/" + endpoint, {
    headers: clientToken ? { authorization: "Bearer " + clientToken } : {},
  });
  const resolved = await resolveRequestTenant(workerDb, new URL(request.url), workerEnv);
  return {
    request,
    url: resolved.url,
    env: resolved.env,
    db: workerDb,
    tenant: resolved.tenant,
    corsOrigin: null,
  };
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Run via firebase emulators:exec, never against a real Firestore project.");
  }
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
    },
  });
  await testEnv.clearFirestore();
  await setupWorkerEmulatorBridge();
  const sessionA = await hashClientSessionToken(workerEnv, "a".repeat(43));
  const sessionB = await hashClientSessionToken(workerEnv, "b".repeat(43));
  await testEnv.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    await Promise.all([
      db.doc("bancas/tenant-a").set({
        slug: "banca-a", nomeExibicao: "Banca A", ativo: true,
        branding: { primaryColor: "#123456" },
      }),
      db.doc("bancas/tenant-b").set({
        slug: "banca-b", nomeExibicao: "Banca B", ativo: true,
        branding: { primaryColor: "#654321" },
      }),
      db.doc("clientes/customer-a").set({
        bancaId: "tenant-a", nome: "Cliente A", ativo: true, telefone: "5517999991234",
      }),
      db.doc("clientes/customer-b").set({
        bancaId: "tenant-b", nome: "Cliente B", ativo: true, telefone: "5517999991234",
      }),
      db.doc("sessoesClientes/" + sessionA).set({
        bancaId: "tenant-a", clienteId: "customer-a",
        ativa: true, expiraEm: new Date(Date.now() + 25 * 86_400_000).toISOString(),
      }),
      db.doc("sessoesClientes/" + sessionB).set({
        bancaId: "tenant-b", clienteId: "customer-b",
        ativa: true, expiraEm: new Date(Date.now() + 25 * 86_400_000).toISOString(),
      }),
    ]);
  });
}, 30_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (testEnv) await testEnv.cleanup();
});

describe("actual Firestore Emulator + Cloudflare Worker tenant boundary", () => {
  it("resolves Tenant A and B through actual Firestore queries and serves distinct public brands", async () => {
    const a = await scopedContext("banca-a", "public/tenant");
    const b = await scopedContext("banca-b", "public/tenant");
    const [aResult, bResult] = await Promise.all([
      handleTenantBootstrapRoute(a), handleTenantBootstrapRoute(b),
    ]);
    const aData = await aResult!.json() as { data: { tenant: JsonObject } };
    const bData = await bResult!.json() as { data: { tenant: JsonObject } };
    expect(a.tenant.id).toBe("tenant-a");
    expect(b.tenant.id).toBe("tenant-b");
    expect(b.env.BANCA_ID).toBe("tenant-b");
    expect(aData.data.tenant).toMatchObject({
      id: "tenant-a", name: "Banca A", branding: { primaryColor: "#123456" },
    });
    expect(bData.data.tenant).toMatchObject({
      id: "tenant-b", name: "Banca B", branding: { primaryColor: "#654321" },
    });
  });

  it("accepts a customer's own session but refuses reuse in the other tenant", async () => {
    const ownA = await handleClientRoute(await scopedContext("banca-a", "client/profile", "a".repeat(43)));
    const ownB = await handleClientRoute(await scopedContext("banca-b", "client/profile", "b".repeat(43)));
    const aData = await ownA!.json() as { data: { profile: JsonObject } };
    const bData = await ownB!.json() as { data: { profile: JsonObject } };
    expect(aData.data.profile.clientId).toBe("customer-a");
    expect(bData.data.profile.clientId).toBe("customer-b");
    await expect(handleClientRoute(await scopedContext("banca-b", "client/profile", "a".repeat(43))))
      .rejects.toMatchObject({ code: "session_invalid", status: 401 });
    await expect(handleClientRoute(await scopedContext("banca-a", "client/profile", "b".repeat(43))))
      .rejects.toMatchObject({ code: "session_invalid", status: 401 });
  });

  it("renews near-expiry client session through a real Firestore transaction without crossing tenants", async () => {
    const pathA = "sessoesClientes/" + await hashClientSessionToken(workerEnv, "a".repeat(43));
    const pathB = "sessoesClientes/" + await hashClientSessionToken(workerEnv, "b".repeat(43));
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      await admin.firestore().doc(pathA).update({ expiraEm: new Date(Date.now() + 86_400_000).toISOString() });
    });
    const before = await testEnv.withSecurityRulesDisabled(async (admin) =>
      (await admin.firestore().doc(pathB).get()).data(),
    );

    // Temporary trace for diagnosing real emulator transaction stalls; no PII.
    const initialBegin = workerDb.beginTransaction.bind(workerDb);
    const initialCommit = workerDb.commit.bind(workerDb);
    const initialGet = workerDb.get.bind(workerDb);
    const beginSpy = vi.spyOn(workerDb, "beginTransaction").mockImplementation(async () => {
      console.error("[emulator-renewal] begin transaction");
      const result = await initialBegin();
      console.error("[emulator-renewal] began transaction");
      return result;
    });
    const getSpy = vi.spyOn(workerDb, "get").mockImplementation(async (path, tx) => {
      console.error("[emulator-renewal] get", tx ? "with tx" : "no tx");
      const result = await initialGet(path, tx);
      console.error("[emulator-renewal] got", tx ? "with tx" : "no tx");
      return result;
    });
    const commitSpy = vi.spyOn(workerDb, "commit").mockImplementation(async (writes, tx) => {
      console.error("[emulator-renewal] commit", Boolean(tx));
      const result = await initialCommit(writes, tx);
      console.error("[emulator-renewal] committed");
      return result;
    });
    const result = await handleClientRoute(await scopedContext("banca-a", "client/profile", "a".repeat(43)));
    beginSpy.mockRestore();
    getSpy.mockRestore();
    commitSpy.mockRestore();
    expect(result?.status).toBe(200);
    const after = await testEnv.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore();
      const [a, b] = await Promise.all([db.doc(pathA).get(), db.doc(pathB).get()]);
      return { a: a.data(), b: b.data() };
    });
    expect(Date.parse(String(after.a?.expiraEm)) - Date.now()).toBeGreaterThan(20 * 86_400_000);
    expect(after.b).toEqual(before);
    expect(after.a?.bancaId).toBe("tenant-a");
  });

  it("runs dry-run, APPLY and idempotent replay on real emulator indexes without mixing identical phones", async () => {
    await testEnv.withSecurityRulesDisabled(async (admin) => {
      const db = admin.firestore();
      const gateway = {
        async getTenant(id: string) {
          const snap = await db.doc("bancas/" + id).get();
          return snap.exists ? {
            id: snap.id, fields: snap.data() ?? {},
            updateTime: snap.updateTime?.toDate().toISOString() ?? null,
          } : null;
        },
        async listClients(id: string) {
          const rows = await db.collection("clientes").where("bancaId", "==", id).get();
          return rows.docs.map((row) => ({ id: row.id, fields: row.data() }));
        },
        async findBySlug(slug: string) {
          const rows = await db.collection("bancas").where("slug", "==", slug).get();
          return rows.docs.map((row) => ({ id: row.id, fields: row.data() }));
        },
        async getPhoneIndex(hash: string) {
          const row = await db.doc("indiceTelefonesClientes/" + hash).get();
          return row.exists ? { id: row.id, fields: row.data() ?? {} } : null;
        },
        async createPhoneIndex(hash: string, tenantId: string, clientId: string) {
          const ref = db.doc("indiceTelefonesClientes/" + hash);
          await db.runTransaction(async (tx) => {
            const existing = await tx.get(ref);
            if (existing.exists) throw new Error("Exclusive create conflict");
            tx.set(ref, { bancaId: tenantId, clienteId: clientId, indexVersion: 2 });
          });
        },
        async patchTenant() {
          throw new Error("Fixture banks already have canonical slugs; patch is not expected.");
        },
      };
      const config = (bankId: string, tenantSlug: string) => ({
        projectId, bankId, tenantSlug,
        pepper: workerEnv.CLIENT_SESSION_PEPPER, gateway,
      });

      const beforeA = await runMigration(config("tenant-a", "banca-a"));
      const beforeB = await runMigration(config("tenant-b", "banca-b"));
      expect(beforeA.phoneIndexes).toMatchObject({ WOULD_CREATE: 1 });
      expect(beforeB.phoneIndexes).toMatchObject({ WOULD_CREATE: 1 });
      expect((await db.collection("indiceTelefonesClientes").get()).size).toBe(0);

      const resultA = await runMigration({ ...config("tenant-a", "banca-a"), apply: true });
      const resultB = await runMigration({ ...config("tenant-b", "banca-b"), apply: true });
      expect(resultA.createdCount).toBe(1);
      expect(resultB.createdCount).toBe(1);
      const allIndexes = await db.collection("indiceTelefonesClientes").get();
      expect(allIndexes.size).toBe(2);
      expect(new Set(allIndexes.docs.map((row) => row.data().bancaId))).toEqual(new Set(["tenant-a", "tenant-b"]));

      const replayA = await runMigration({ ...config("tenant-a", "banca-a"), apply: true });
      const replayB = await runMigration({ ...config("tenant-b", "banca-b"), apply: true });
      expect(replayA.createdCount).toBe(0);
      expect(replayB.createdCount).toBe(0);
      expect((await db.collection("indiceTelefonesClientes").get()).size).toBe(2);
      expect((await db.doc("bancas/tenant-a").get()).data()?.slug).toBe("banca-a");
      expect((await db.doc("bancas/tenant-b").get()).data()?.slug).toBe("banca-b");
    });
  });

  it("keeps all direct browser reads and writes denied, even with admin claims", async () => {
    const a = testEnv.authenticatedContext("admin-a", { role: "ADMIN", bancaId: "tenant-a" }).firestore();
    const b = testEnv.authenticatedContext("admin-b", { role: "ADMIN", bancaId: "tenant-b" }).firestore();
    const publicDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(a.doc("bancas/tenant-a").get());
    await assertFails(a.doc("bancas/tenant-b").get());
    await assertFails(b.doc("clientes/customer-a").get());
    await assertFails(b.doc("clientes/customer-b").get());
    await assertFails(publicDb.doc("bancas/tenant-a").get());
    await assertFails(a.doc("clientes/customer-a").update({ nome: "Attempted write" }));
    await assertFails(b.doc("bancas/tenant-a").set({ slug: "hijacked" }));
    await assertFails(publicDb.collection("clientes").get());
  });
});