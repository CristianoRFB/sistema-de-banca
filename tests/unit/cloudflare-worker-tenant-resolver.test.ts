import { describe, expect, it } from "vitest";
import { resolveRequestTenant, validateTenantSlugForCreation } from "../../cloudflare/worker/src/tenant";
import { hashCustomerPhone, rateLimit } from "../../cloudflare/worker/src/security";
import { HttpError, type Bindings, type FirestoreDocument, type JsonObject, type RequestContext } from "../../cloudflare/worker/src/types";
import type { FirestoreRest } from "../../cloudflare/worker/src/firebase/firestore-rest";

function document(id: string, data: JsonObject): FirestoreDocument {
  return {
    id,
    name: `projects/test/databases/(default)/documents/bancas/${id}`,
    data,
  };
}

class TenantDb {
  constructor(private readonly tenants: FirestoreDocument[]) {}

  async get(path: string): Promise<FirestoreDocument | null> {
    const id = path.split("/").at(-1);
    return this.tenants.find((item) => item.id === id) ?? null;
  }

  async query(_collection: string, structuredQuery: JsonObject): Promise<FirestoreDocument[]> {
    const where = structuredQuery.where as { fieldFilter?: { value?: { stringValue?: string } } } | undefined;
    const slug = where?.fieldFilter?.value?.stringValue;
    return slug ? this.tenants.filter((item) => item.data.slug === slug) : this.tenants;
  }
}

const baseEnv = {
  FIREBASE_PROJECT_ID: "test-project",
  FIREBASE_SERVICE_ACCOUNT_JSON: "{}",
  CLIENT_SESSION_PEPPER: "x".repeat(32),
  CORS_ORIGINS: "https://example.test",
} as unknown as Bindings;

describe("tenant resolver", () => {
  it("resolves a canonical tenant route by slug and strips the routing prefix", async () => {
    const db = new TenantDb([document("tenant-a", { slug: "ana-maria", nomeExibicao: "Banca Ana Maria", ativo: true })]);
    const result = await resolveRequestTenant(
      db as unknown as FirestoreRest,
      new URL("https://example.test/api/t/ana-maria/public/catalog?q=x"),
      baseEnv,
    );

    expect(result.tenant).toMatchObject({ id: "tenant-a", slug: "ana-maria", legacyFallback: false });
    expect(result.url.pathname).toBe("/api/public/catalog");
    expect(result.url.search).toBe("?q=x");
    expect(result.env.BANCA_ID).toBe("tenant-a");
  });

  it("rejects inactive tenants", async () => {
    const db = new TenantDb([document("tenant-a", { slug: "ana-maria", ativo: false })]);
    await expect(resolveRequestTenant(
      db as unknown as FirestoreRest,
      new URL("https://example.test/api/t/ana-maria/public/catalog"),
      baseEnv,
    )).rejects.toMatchObject({ code: "tenant_not_found", status: 404 } satisfies Partial<HttpError>);
  });

  it("keeps the old API path only when an explicit legacy BANCA_ID exists", async () => {
    const db = new TenantDb([document("tenant-a", { slug: "ana-maria", ativo: true })]);
    const result = await resolveRequestTenant(
      db as unknown as FirestoreRest,
      new URL("https://example.test/api/public/catalog"),
      { ...baseEnv, BANCA_ID: "tenant-a" },
    );

    expect(result.tenant.legacyFallback).toBe(true);
    expect(result.env.BANCA_ID).toBe("tenant-a");
  });

  it("requires tenant scope when neither canonical route nor legacy fallback is available", async () => {
    const db = new TenantDb([]);
    await expect(resolveRequestTenant(
      db as unknown as FirestoreRest,
      new URL("https://example.test/api/public/catalog"),
      baseEnv,
    )).rejects.toMatchObject({ code: "tenant_required", status: 404 } satisfies Partial<HttpError>);
  });
  it("isolates two tenants that use the same customer phone", async () => {
    const phone = "5517999991234";
    const tenantAHash = await hashCustomerPhone({ ...baseEnv, BANCA_ID: "tenant-a" }, phone);
    const tenantBHash = await hashCustomerPhone({ ...baseEnv, BANCA_ID: "tenant-b" }, phone);
    expect(tenantAHash).not.toBe(tenantBHash);
  });

  it("resolves Tenant A and Tenant B independently from their slugs", async () => {
    const db = new TenantDb([
      document("tenant-a", { slug: "ana-maria", ativo: true }),
      document("tenant-b", { slug: "banca-beta", ativo: true }),
    ]);
    const tenantA = await resolveRequestTenant(
      db as unknown as FirestoreRest,
      new URL("https://example.test/api/t/ana-maria/public/catalog"),
      baseEnv,
    );
    const tenantB = await resolveRequestTenant(
      db as unknown as FirestoreRest,
      new URL("https://example.test/api/t/banca-beta/public/catalog"),
      baseEnv,
    );
    expect(tenantA.env.BANCA_ID).toBe("tenant-a");
    expect(tenantB.env.BANCA_ID).toBe("tenant-b");
    expect(tenantA.tenant.id).not.toBe(tenantB.tenant.id);
  });

});


describe("tenant-isolated rate limiting", () => {
  function requestContext(tenantId: string, scopeIp = "203.0.113.44") {
    const keys: string[] = [];
    const env = {
      ...baseEnv,
      BANCA_ID: tenantId,
      CLIENT_RATE_LIMITER: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return { success: true };
        },
      },
    } as unknown as RequestContext["env"];
    const request = new Request("https://example.test/api/t/banca/public/catalog", {
      headers: { "cf-connecting-ip": scopeIp },
    });
    const ctx = {
      request,
      url: new URL(request.url),
      env,
      db: {} as FirestoreRest,
      corsOrigin: null,
      tenant: { id: tenantId, slug: tenantId, name: tenantId, active: true, legacyFallback: false },
    } satisfies RequestContext;
    return { ctx, keys };
  }

  it("does not share the same IP/scope quota across tenant A and tenant B", async () => {
    const a = requestContext("tenant-a");
    const b = requestContext("tenant-b");
    await rateLimit(a.ctx, "public-search");
    await rateLimit(b.ctx, "public-search");
    expect(a.keys).toHaveLength(1);
    expect(b.keys).toHaveLength(1);
    expect(a.keys[0]).not.toBe(b.keys[0]);
  });

  it("keeps a stable key per tenant/IP/scope and distinguishes request scopes", async () => {
    const a = requestContext("tenant-a");
    await rateLimit(a.ctx, "client-read");
    await rateLimit(a.ctx, "client-read");
    await rateLimit(a.ctx, "client-write");
    expect(a.keys[0]).toBe(a.keys[1]);
    expect(a.keys[0]).not.toBe(a.keys[2]);
    expect(a.keys[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("continues to fail closed when the limiter is missing or denies a request", async () => {
    const missing = requestContext("tenant-a");
    const missingEnv = { ...missing.ctx.env, CLIENT_RATE_LIMITER: undefined };
    await expect(rateLimit({ ...missing.ctx, env: missingEnv }, "public-search")).rejects.toMatchObject({
      code: "rate_limit_unavailable",
      status: 503,
    });
    const denied = requestContext("tenant-a");
    denied.ctx.env.CLIENT_RATE_LIMITER = {
      limit: async () => ({ success: false }),
    } as RequestContext["env"]["CLIENT_RATE_LIMITER"];
    await expect(rateLimit(denied.ctx, "public-search")).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
  });
});

describe("tenant slug registration", () => {
  it("rejects slugs that collide with platform, API and legacy root routes", () => {
    for (const slug of ["admin", "api", "catalogo", "cliente", "localizacao", "produto"]) {
      expect(() => validateTenantSlugForCreation(slug)).toThrowError(HttpError);
      try {
        validateTenantSlugForCreation(slug);
      } catch (error) {
        expect(error).toMatchObject({ code: "invalid_tenant_slug", status: 400 });
      }
    }
  });

  it("accepts valid tenant slugs without changing approved tenant URLs", () => {
    expect(validateTenantSlugForCreation("Banca-Ana-Maria")).toBe("banca-ana-maria");
    expect(validateTenantSlugForCreation("banca-beta")).toBe("banca-beta");
  });
});
