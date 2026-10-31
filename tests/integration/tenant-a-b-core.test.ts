import { describe, expect, it } from "vitest";
import { prepareIdempotency, saveIdempotency } from "../../cloudflare/worker/src/api";
import { handleClientRoute } from "../../cloudflare/worker/src/routes/client";
import { handleTenantBootstrapRoute } from "../../cloudflare/worker/src/routes/tenant-bootstrap";
import { hashClientSessionToken, hashCustomerPhone } from "../../cloudflare/worker/src/security";
import { resolveRequestTenant } from "../../cloudflare/worker/src/tenant";
import { HttpError, type Bindings, type FirestoreDocument, type JsonObject, type RequestContext } from "../../cloudflare/worker/src/types";
import type { FirestoreRest, FirestoreTransaction } from "../../cloudflare/worker/src/firebase/firestore-rest";

const env: Bindings = {
  FIREBASE_PROJECT_ID: "tenant-integration-test",
  FIREBASE_SERVICE_ACCOUNT_JSON: "{}",
  CLIENT_SESSION_PEPPER: "fake-tenant-isolation-pepper-with-sufficient-length",
  CORS_ORIGINS: "https://app.example.test",
  BANCA_ID: "tenant-a", // Intentional legacy value: canonical B must override it.
  CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) },
};

const tenants = [
  { id: "tenant-a", slug: "banca-a", name: "Banca A", color: "#112233" },
  { id: "tenant-b", slug: "banca-b", name: "Banca B", color: "#334455" },
] as const;

function document(path: string, data: JsonObject): FirestoreDocument {
  return {
    name: `projects/tenant-integration-test/databases/(default)/documents/${path}`,
    id: path.split("/").at(-1) ?? "",
    data,
  };
}

class TwoTenantFirestore {
  readonly documents = new Map<string, FirestoreDocument>();
  seed(path: string, data: JsonObject): void {
    this.documents.set(path, document(path, data));
  }
  async get(path: string): Promise<FirestoreDocument | null> {
    return this.documents.get(path) ?? null;
  }
  async query(collection: string, structuredQuery: JsonObject): Promise<FirestoreDocument[]> {
    const where = structuredQuery.where as {
      fieldFilter?: { field?: { fieldPath?: string }; value?: { stringValue?: string } };
    } | undefined;
    if (collection !== "bancas" || where?.fieldFilter?.field?.fieldPath !== "slug") {
      throw new Error(`Unexpected integration query: ${collection}`);
    }
    return [...this.documents.values()].filter((value) =>
      value.name.includes("/documents/bancas/") &&
      value.data.slug === where.fieldFilter?.value?.stringValue,
    );
  }
}

async function fixture(): Promise<TwoTenantFirestore> {
  const db = new TwoTenantFirestore();
  for (const tenant of tenants) {
    db.seed(`bancas/${tenant.id}`, {
      slug: tenant.slug, nomeExibicao: tenant.name, ativo: true,
      branding: { primaryColor: tenant.color },
    });
    const token = tenant.id === "tenant-a" ? "a".repeat(43) : "b".repeat(43);
    const sessionId = await hashClientSessionToken(env, token);
    db.seed(`sessoesClientes/${sessionId}`, {
      ativa: true, bancaId: tenant.id, clienteId: `customer-${tenant.id}`,
      expiraEm: new Date(Date.now() + 25 * 86_400_000).toISOString(),
    });
    db.seed(`clientes/customer-${tenant.id}`, {
      bancaId: tenant.id, ativo: true, nome: `Cliente ${tenant.name}`,
      telefone: "5517999991234",
    });
  }
  return db;
}

async function context(db: TwoTenantFirestore, slug: string, endpoint: string, token?: string): Promise<RequestContext> {
  const request = new Request(`https://app.example.test/api/t/${slug}/${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}`, "cf-connecting-ip": "192.0.2.8" } : {},
  });
  const resolved = await resolveRequestTenant(
    db as unknown as FirestoreRest, new URL(request.url), env,
  );
  return {
    request, url: resolved.url, env: resolved.env,
    tenant: resolved.tenant, corsOrigin: null,
    db: db as unknown as FirestoreRest,
  };
}

describe("Tenant A × Tenant B integrated core isolation", () => {
  it("resolves each public tenant with independent identity and branding, regardless of legacy BANCA_ID", async () => {
    const db = await fixture();
    const a = await context(db, "banca-a", "public/tenant");
    const b = await context(db, "banca-b", "public/tenant");
    const [aResponse, bResponse] = await Promise.all([
      handleTenantBootstrapRoute(a), handleTenantBootstrapRoute(b),
    ]);
    const aBody = await aResponse!.json() as { data: { tenant: JsonObject } };
    const bBody = await bResponse!.json() as { data: { tenant: JsonObject } };
    expect(a.tenant.id).toBe("tenant-a");
    expect(b.tenant.id).toBe("tenant-b");
    expect(b.env.BANCA_ID).toBe("tenant-b");
    expect(aBody.data.tenant).toMatchObject({
      id: "tenant-a", name: "Banca A", branding: { primaryColor: "#112233" },
    });
    expect(bBody.data.tenant).toMatchObject({
      id: "tenant-b", name: "Banca B", branding: { primaryColor: "#334455" },
    });
  });

  it("prevents cross-tenant session reuse while permitting each tenant's own account", async () => {
    const db = await fixture();
    const contextA = await context(db, "banca-a", "client/profile", "a".repeat(43));
    const contextB = await context(db, "banca-b", "client/profile", "b".repeat(43));
    const aResponse = await handleClientRoute(contextA);
    const bResponse = await handleClientRoute(contextB);
    const aBody = await aResponse!.json() as { data: { profile: JsonObject } };
    const bBody = await bResponse!.json() as { data: { profile: JsonObject } };
    expect(aBody.data.profile.clientId).toBe("customer-tenant-a");
    expect(bBody.data.profile.clientId).toBe("customer-tenant-b");

    const attemptAtoB = await context(db, "banca-b", "client/profile", "a".repeat(43));
    const attemptBtoA = await context(db, "banca-a", "client/profile", "b".repeat(43));
    for (const attempt of [attemptAtoB, attemptBtoA]) {
      await expect(handleClientRoute(attempt)).rejects.toMatchObject({
        code: "session_invalid", status: 401,
      } satisfies Partial<HttpError>);
    }
  });

  it("gives matching customer phones independent opaque indexes in the two tenants", async () => {
    const db = await fixture();
    const a = await context(db, "banca-a", "public/tenant");
    const b = await context(db, "banca-b", "public/tenant");
    const phone = "5517999991234";
    expect(await hashCustomerPhone(a.env, phone))
      .not.toBe(await hashCustomerPhone(b.env, phone));
  });

  it("rejects an inactive tenant even if the legacy BANCA_ID points to a valid bank", async () => {
    const db = await fixture();
    db.seed("bancas/tenant-b", { slug: "banca-b", ativo: false });
    await expect(context(db, "banca-b", "client/profile", "b".repeat(43))).rejects.toMatchObject({
      code: "tenant_not_found", status: 404,
    } satisfies Partial<HttpError>);
  });
  it("keeps idempotency results independent across tenants, with replay only inside the owning banca", async () => {
    const db = await fixture();
    const a = await context(db, "banca-a", "client/profile");
    const b = await context(db, "banca-b", "client/profile");
    const sameHeaders = { "idempotency-key": "admin-shared-key-1234" };
    const aCtx = { ...a, request: new Request(a.request.url, { headers: sameHeaders }) };
    const bCtx = { ...b, request: new Request(b.request.url, { headers: sameHeaders }) };
    const records = new Map<string, JsonObject>();
    const transaction = {
      get: async (path: string) => {
        const data = records.get(path);
        return data ? document(path, data) : null;
      },
      set: (path: string, data: JsonObject) => { records.set(path, data); },
    } as unknown as FirestoreTransaction;

    const body = { name: "Updated public profile" };
    const first = await prepareIdempotency(aCtx, transaction, "bank-update:same-admin-uid", body);
    saveIdempotency(transaction, first, { tenant: "tenant-a" });
    const repeatA = await prepareIdempotency(aCtx, transaction, "bank-update:same-admin-uid", body);
    expect(repeatA.path).toBe(first.path);
    expect(repeatA.replay).toEqual({ tenant: "tenant-a" });

    const firstB = await prepareIdempotency(bCtx, transaction, "bank-update:same-admin-uid", body);
    expect(firstB.path).not.toBe(first.path);
    expect(firstB.replay).toBeUndefined();
    saveIdempotency(transaction, firstB, { tenant: "tenant-b" });
    const repeatB = await prepareIdempotency(bCtx, transaction, "bank-update:same-admin-uid", body);
    expect(repeatB.replay).toEqual({ tenant: "tenant-b" });
    expect(records.size).toBe(2);
  });

});
