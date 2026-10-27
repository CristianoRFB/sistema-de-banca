import { HttpError, type Bindings, type FirestoreDocument, type ScopedBindings, type TenantContext } from "./types";
import type { FirestoreRest } from "./firebase/firestore-rest";

const TENANT_API_ROUTE = /^\/api\/t\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\/(public|client|admin)(\/.*)?$/;
const LEGACY_API_ROUTE = /^\/api\/(public|client|admin)(?:\/.*)?$/;

function tenantFromDocument(document: FirestoreDocument, legacyFallback: boolean): TenantContext {
  const slug = String(document.data.slug ?? document.id).trim().toLocaleLowerCase("pt-BR");
  return {
    id: document.id,
    slug,
    name: String(document.data.nomeExibicao ?? document.data.nome ?? document.id),
    active: document.data.ativo !== false,
    legacyFallback,
  };
}

async function findTenantBySlug(db: FirestoreRest, slug: string): Promise<FirestoreDocument | null> {
  const rows = await db.query("bancas", {
    from: [{ collectionId: "bancas" }],
    where: {
      fieldFilter: {
        field: { fieldPath: "slug" },
        op: "EQUAL",
        value: { stringValue: slug },
      },
    },
    limit: 2,
  });
  if (rows.length > 1) {
    throw new HttpError({
      code: "tenant_configuration_conflict",
      message: "Tenant configuration is inconsistent.",
      status: 500,
    });
  }
  return rows[0] ?? null;
}

export function scopeEnvForTenant(env: Bindings, tenantId: string): ScopedBindings {
  return { ...env, BANCA_ID: tenantId };
}

export async function resolveRequestTenant(
  db: FirestoreRest,
  requestUrl: URL,
  env: Bindings,
): Promise<{ tenant: TenantContext; url: URL; env: ScopedBindings }> {
  const canonical = requestUrl.pathname.match(TENANT_API_ROUTE);
  if (canonical) {
    const slug = canonical[1].toLocaleLowerCase("pt-BR");
    const document = await findTenantBySlug(db, slug);
    if (!document || document.data.ativo === false) {
      throw new HttpError({ code: "tenant_not_found", message: "Tenant was not found.", status: 404 });
    }

    const tenant = tenantFromDocument(document, false);
    const routedUrl = new URL(requestUrl.toString());
    routedUrl.pathname = `/api/${canonical[2]}${canonical[3] ?? ""}`;
    return { tenant, url: routedUrl, env: scopeEnvForTenant(env, tenant.id) };
  }

  if (LEGACY_API_ROUTE.test(requestUrl.pathname) && env.BANCA_ID?.trim()) {
    const document = await db.get(`bancas/${env.BANCA_ID.trim()}`);
    if (!document || document.data.ativo === false) {
      throw new HttpError({ code: "tenant_not_found", message: "Tenant was not found.", status: 404 });
    }
    const tenant = tenantFromDocument(document, true);
    return { tenant, url: new URL(requestUrl.toString()), env: scopeEnvForTenant(env, tenant.id) };
  }

  throw new HttpError({
    code: "tenant_required",
    message: "Use a tenant-scoped API route.",
    status: 404,
  });
}

export async function listActiveTenants(db: FirestoreRest): Promise<TenantContext[]> {
  const rows = await db.query("bancas", {
    from: [{ collectionId: "bancas" }],
    limit: 500,
  });
  return rows
    .filter((document) => document.data.ativo !== false)
    .map((document) => tenantFromDocument(document, false));
}
