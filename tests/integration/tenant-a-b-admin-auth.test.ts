import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireAdmin, requirePlatformOwner } from "../../cloudflare/worker/src/security";
import { resolveRequestTenant } from "../../cloudflare/worker/src/tenant";
import type { Bindings, FirestoreDocument, JsonObject, RequestContext } from "../../cloudflare/worker/src/types";
import type { FirestoreRest } from "../../cloudflare/worker/src/firebase/firestore-rest";

const projectId = "tenant-admin-a-b-test";
const signingKeyId = "tenant-admin-a-b-rsa-key";

function doc(path: string, data: JsonObject): FirestoreDocument {
  return {
    id: path.split("/").at(-1) ?? "",
    name: "projects/" + projectId + "/databases/(default)/documents/" + path,
    data,
  };
}

class MembershipDb {
  readonly records = new Map<string, FirestoreDocument>();
  constructor() {
    this.put("bancas/tenant-a", { slug: "banca-a", ativo: true });
    this.put("bancas/tenant-b", { slug: "banca-b", ativo: true });
    this.put("bancas/tenant-a/usuarios/admin-a", { papel: "ADMIN", ativo: true });
    this.put("bancas/tenant-b/usuarios/admin-b", { papel: "TENANT_OWNER", ativo: true });
    this.put("bancas/tenant-a/usuarios/staff-a", { papel: "STAFF", ativo: true });
    this.put("bancas/tenant-b/usuarios/inactive-user", { papel: "ADMIN", ativo: false });
    this.put("platformOwners/platform-uid", { ativo: true });
  }
  put(path: string, data: JsonObject): void { this.records.set(path, doc(path, data)); }
  async get(path: string): Promise<FirestoreDocument | null> { return this.records.get(path) ?? null; }
  async query(collection: string, structuredQuery: JsonObject): Promise<FirestoreDocument[]> {
    if (collection !== "bancas") throw new Error("Unexpected query: " + collection);
    const where = structuredQuery.where as { fieldFilter?: { value?: { stringValue?: string } } } | undefined;
    return [...this.records.entries()]
      .filter(([path]) => /^bancas\/[^/]+$/.test(path))
      .map(([, value]) => value)
      .filter((value) => value.data.slug === where?.fieldFilter?.value?.stringValue);
  }
}

const env = {
  FIREBASE_PROJECT_ID: projectId,
  FIREBASE_SERVICE_ACCOUNT_JSON: "{}",
  CLIENT_SESSION_PEPPER: "admin-auth-integration-pepper-with-32-plus-characters",
  CORS_ORIGINS: "https://example.test",
  BANCA_ID: "tenant-a", // legacy value must be replaced by the URL-resolved tenant
} as Bindings;

let privateKey: CryptoKey;

function toBase64Url(data: string | ArrayBuffer): string {
  return Buffer.from(data).toString("base64url");
}

async function signedToken(uid: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", kid: signingKeyId, typ: "JWT" }));
  const claims = toBase64Url(JSON.stringify({
    aud: projectId, iss: "https://securetoken.google.com/" + projectId,
    sub: uid, iat: timestamp, auth_time: timestamp, exp: timestamp + 3600, ...overrides,
  }));
  const signingInput = header + "." + claims;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signingInput),
  );
  return signingInput + "." + toBase64Url(signature);
}

async function context(db: MembershipDb, slug: string, token: string, method = "GET"): Promise<RequestContext> {
  const request = new Request("https://example.test/api/t/" + slug + "/admin/session", {
    method,
    headers: { authorization: "Bearer " + token },
  });
  const resolved = await resolveRequestTenant(db as unknown as FirestoreRest, new URL(request.url), env);
  return {
    request, url: resolved.url, env: resolved.env, tenant: resolved.tenant,
    corsOrigin: null, db: db as unknown as FirestoreRest,
  };
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  privateKey = keyPair.privateKey;
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com") {
      throw new Error("Unexpected network request");
    }
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: signingKeyId }] }), {
      status: 200, headers: { "cache-control": "public, max-age=600" },
    });
  }));
});
afterAll(() => vi.unstubAllGlobals());

describe("signed Firebase admin authorization across Tenant A and Tenant B", () => {
  it("permits each real member in their own banca but not in the other banca", async () => {
    const db = new MembershipDb();
    const adminA = await signedToken("admin-a");
    const adminB = await signedToken("admin-b");

    await expect(requireAdmin(await context(db, "banca-a", adminA), ["ADMIN"]))
      .resolves.toMatchObject({ uid: "admin-a", role: "ADMIN" });
    await expect(requireAdmin(await context(db, "banca-b", adminA), ["ADMIN"]))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });

    await expect(requireAdmin(await context(db, "banca-b", adminB), ["ADMIN"]))
      .resolves.toMatchObject({ uid: "admin-b", role: "TENANT_OWNER" });
    await expect(requireAdmin(await context(db, "banca-a", adminB), ["ADMIN"]))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });
  });

  it("enforces local permissions, inactive memberships, and signed identity claims", async () => {
    const db = new MembershipDb();
    const staff = await signedToken("staff-a");
    await expect(requireAdmin(await context(db, "banca-a", staff), ["ADMIN", "OPERADOR"]))
      .resolves.toMatchObject({ role: "STAFF" });
    await expect(requireAdmin(await context(db, "banca-a", staff), ["ADMIN"]))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });

    await expect(requireAdmin(await context(db, "banca-b", await signedToken("inactive-user")), ["ADMIN"]))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });

    const signed = await signedToken("admin-a");
    const [header, , signature] = signed.split(".");
    const forgedPayload = toBase64Url(JSON.stringify({
      aud: projectId, iss: "https://securetoken.google.com/" + projectId,
      sub: "admin-b", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600,
    }));
    await expect(requireAdmin(await context(db, "banca-b", header + "." + forgedPayload + "." + signature)))
      .rejects.toMatchObject({ code: "admin_auth_required", status: 401 });
  });

  it("fails closed when a caller tries to provide an env tenant that differs from the URL resolver", async () => {
    const db = new MembershipDb();
    const ctx = await context(db, "banca-a", await signedToken("admin-a"));
    await expect(requireAdmin({ ...ctx, env: { ...ctx.env, BANCA_ID: "tenant-b" } }))
      .rejects.toMatchObject({ code: "tenant_context_mismatch", status: 500 });
  });

  it("never grants Platform Owner an implicit tenant membership", async () => {
    const db = new MembershipDb();
    const owner = await signedToken("platform-uid");
    const a = await context(db, "banca-a", owner);
    await expect(requirePlatformOwner(a)).resolves.toMatchObject({ uid: "platform-uid" });
    await expect(requireAdmin(a)).rejects.toMatchObject({ code: "admin_forbidden", status: 403 });
    await expect(requireAdmin(await context(db, "banca-b", owner)))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });
  });

  it("permits only a tenant-bound, active, unexpired GET support grant", async () => {
    const db = new MembershipDb();
    const token = await signedToken("platform-uid");
    const path = "bancas/tenant-b/supportGrants/platform-uid";
    db.put(path, {
      bancaId: "tenant-b", uid: "platform-uid", ativo: true,
      expiraEm: new Date(Date.now() + 600_000).toISOString(),
    });
    await expect(requireAdmin(await context(db, "banca-b", token)))
      .resolves.toMatchObject({ role: "PLATFORM_OWNER", platformOverride: true });
    await expect(requireAdmin(await context(db, "banca-a", token)))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });
    await expect(requireAdmin(await context(db, "banca-b", token, "POST")))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });

    db.put(path, {
      bancaId: "tenant-b", uid: "platform-uid", ativo: false,
      expiraEm: new Date(Date.now() + 600_000).toISOString(),
    });
    await expect(requireAdmin(await context(db, "banca-b", token)))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });
    db.put(path, {
      bancaId: "tenant-b", uid: "platform-uid", ativo: true,
      expiraEm: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(requireAdmin(await context(db, "banca-b", token)))
      .rejects.toMatchObject({ code: "admin_forbidden", status: 403 });
  });
});