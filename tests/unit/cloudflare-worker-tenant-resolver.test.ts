import { describe, expect, it } from "vitest";
import { resolveRequestTenant } from "../../cloudflare/worker/src/tenant";
import { HttpError, type Bindings, type FirestoreDocument, type JsonObject } from "../../cloudflare/worker/src/types";
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
});
