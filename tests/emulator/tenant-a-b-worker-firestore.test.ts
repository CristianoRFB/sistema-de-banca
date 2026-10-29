import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FirestoreRest } from "../../cloudflare/worker/src/firebase/firestore-rest";
import { handleClientRoute } from "../../cloudflare/worker/src/routes/client";
import { handleTenantBootstrapRoute } from "../../cloudflare/worker/src/routes/tenant-bootstrap";
import { hashClientSessionToken } from "../../cloudflare/worker/src/security";
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
        ativa: true, expiraEm: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      db.doc("sessoesClientes/" + sessionB).set({
        bancaId: "tenant-b", clienteId: "customer-b",
        ativa: true, expiraEm: new Date(Date.now() + 86_400_000).toISOString(),
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