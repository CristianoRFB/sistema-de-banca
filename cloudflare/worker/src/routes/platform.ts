import { eq, firestoreString, jsonResponse, query, readJsonBody } from "../api";
import { requirePlatformOwner } from "../security";
import { listTenantDocuments, validateTenantSlugForCreation } from "../tenant";
import { HttpError, type JsonObject, type PlatformIdentity, type RequestContext, type TenantRole } from "../types";

const TENANT_ROLES = new Set<TenantRole>(["ADMIN", "OPERADOR", "TENANT_OWNER", "STAFF"]);


function cleanName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (name.length < 2 || name.length > 100) {
    throw new HttpError({ code: "invalid_tenant_name", message: "Tenant name is invalid.", status: 400 });
  }
  return name;
}

function audit(
  transaction: { set(path: string, data: JsonObject, options?: { mustNotExist?: boolean }): void },
  actor: PlatformIdentity,
  input: { action: string; tenantId?: string | null; entityId?: string | null; details?: JsonObject },
): void {
  const id = crypto.randomUUID();
  transaction.set(`auditLogs/${id}`, {
    scope: "PLATFORM",
    actorUid: actor.uid,
    actorRole: actor.role,
    action: input.action,
    tenantId: input.tenantId ?? null,
    entityId: input.entityId ?? null,
    details: input.details ?? {},
    createdAt: new Date().toISOString(),
  }, { mustNotExist: true });
}

async function listTenants(ctx: RequestContext): Promise<Response> {
  // Pagination happens by document name in the shared tenant enumerator.
  // Sort only after reading all pages so an inactive or later tenant is not lost.
  const rows = await listTenantDocuments(ctx.db);
  rows.sort((a, b) => String(a.data.nomeExibicao ?? a.data.nome ?? a.id)
    .localeCompare(String(b.data.nomeExibicao ?? b.data.nome ?? b.id), "pt-BR"));
  return jsonResponse(ctx, {
    tenants: rows.map((row) => ({
      id: row.id,
      slug: row.data.slug ?? row.id,
      name: row.data.nomeExibicao ?? row.data.nome ?? row.id,
      active: row.data.ativo !== false,
      createdAt: row.data.criadoEm ?? null,
      updatedAt: row.data.atualizadoEm ?? null,
    })),
  });
}

async function createTenant(ctx: RequestContext, actor: PlatformIdentity): Promise<Response> {
  const body = await readJsonBody(ctx.request, 12_000);
  const slug = validateTenantSlugForCreation(body.slug);
  const name = cleanName(body.name);
  const tenantId = typeof body.id === "string" && /^[A-Za-z0-9_-]{3,80}$/.test(body.id.trim())
    ? body.id.trim()
    : crypto.randomUUID();
  const now = new Date().toISOString();

  const tenant = await ctx.db.transact(async (transaction) => {
    const [existingById, existingBySlug] = await Promise.all([
      transaction.get(`bancas/${tenantId}`),
      transaction.query("bancas", query("bancas", [eq("slug", firestoreString(slug))], 2)),
    ]);
    if (existingById || existingBySlug.length) {
      throw new HttpError({ code: "tenant_conflict", message: "Tenant id or slug is already in use.", status: 409 });
    }

    const data: JsonObject = {
      nomeExibicao: name,
      slug,
      ativo: true,
      criadoEm: now,
      atualizadoEm: now,
      branding: typeof body.branding === "object" && body.branding !== null ? body.branding : {},
    };
    transaction.set(`bancas/${tenantId}`, data, { mustNotExist: true });
    audit(transaction, actor, {
      action: "TENANT_CREATED",
      tenantId,
      entityId: tenantId,
      details: { slug, name },
    });
    return { id: tenantId, ...data };
  });

  return jsonResponse(ctx, { tenant }, 201);
}

async function setTenantStatus(
  ctx: RequestContext,
  actor: PlatformIdentity,
  tenantId: string,
): Promise<Response> {
  const body = await readJsonBody(ctx.request, 4_000);
  if (typeof body.active !== "boolean") {
    throw new HttpError({ code: "invalid_status", message: "active must be a boolean.", status: 400 });
  }
  const now = new Date().toISOString();
  const tenant = await ctx.db.transact(async (transaction) => {
    const current = await transaction.get(`bancas/${tenantId}`);
    if (!current) throw new HttpError({ code: "tenant_not_found", message: "Tenant was not found.", status: 404 });
    const updated = { ...current.data, ativo: body.active, atualizadoEm: now };
    transaction.set(`bancas/${tenantId}`, updated);
    audit(transaction, actor, {
      action: body.active ? "TENANT_ACTIVATED" : "TENANT_DEACTIVATED",
      tenantId,
      entityId: tenantId,
    });
    return { id: tenantId, ...updated };
  });
  return jsonResponse(ctx, { tenant });
}

async function listMemberships(ctx: RequestContext, tenantId: string): Promise<Response> {
  const tenant = await ctx.db.get(`bancas/${tenantId}`);
  if (!tenant) throw new HttpError({ code: "tenant_not_found", message: "Tenant was not found.", status: 404 });
  const rows = await ctx.db.query(`bancas/${tenantId}/usuarios`, query("usuarios", [], 200));
  return jsonResponse(ctx, {
    memberships: rows.map((row) => ({
      uid: row.id,
      role: row.data.papel ?? null,
      active: row.data.ativo === true,
      createdAt: row.data.criadoEm ?? null,
      updatedAt: row.data.atualizadoEm ?? null,
    })),
  });
}

async function setMembership(
  ctx: RequestContext,
  actor: PlatformIdentity,
  tenantId: string,
  uid: string,
): Promise<Response> {
  if (!/^[A-Za-z0-9:_-]{3,128}$/.test(uid)) {
    throw new HttpError({ code: "invalid_uid", message: "Membership uid is invalid.", status: 400 });
  }
  const body = await readJsonBody(ctx.request, 8_000);
  const role = String(body.role ?? "") as TenantRole;
  if (!TENANT_ROLES.has(role) || typeof body.active !== "boolean") {
    throw new HttpError({ code: "invalid_membership", message: "Membership role or status is invalid.", status: 400 });
  }
  const now = new Date().toISOString();

  const membership = await ctx.db.transact(async (transaction) => {
    const tenant = await transaction.get(`bancas/${tenantId}`);
    if (!tenant) throw new HttpError({ code: "tenant_not_found", message: "Tenant was not found.", status: 404 });

    const path = `bancas/${tenantId}/usuarios/${uid}`;
    const current = await transaction.get(path);
    const updated: JsonObject = {
      ...(current?.data ?? {}),
      papel: role,
      ativo: body.active,
      criadoEm: current?.data.criadoEm ?? now,
      atualizadoEm: now,
    };
    transaction.set(path, updated);
    audit(transaction, actor, {
      action: current ? "MEMBERSHIP_UPDATED" : "MEMBERSHIP_CREATED",
      tenantId,
      entityId: uid,
      details: { role, active: body.active },
    });
    return { uid, role, active: body.active };
  });

  return jsonResponse(ctx, { membership });
}

const SUPPORT_GRANT_MINUTES = new Set([15, 30, 60]);

async function getSupportGrant(ctx: RequestContext, actor: PlatformIdentity, tenantId: string): Promise<Response> {
  const tenant = await ctx.db.get(`bancas/${tenantId}`);
  if (!tenant) throw new HttpError({ code: "tenant_not_found", message: "Tenant was not found.", status: 404 });
  const document = await ctx.db.get(`bancas/${tenantId}/supportGrants/${actor.uid}`);
  const data = document?.data;
  const expiresAt = typeof data?.expiraEm === "string" ? data.expiraEm : null;
  return jsonResponse(ctx, { grant: {
    active: data?.ativo === true && data.bancaId === tenantId && data.uid === actor.uid && !!expiresAt && Date.parse(expiresAt) > Date.now(),
    expiresAt,
    reason: typeof data?.justificativa === "string" ? data.justificativa : null,
  } });
}

async function grantSupport(ctx: RequestContext, actor: PlatformIdentity, tenantId: string): Promise<Response> {
  const body = await readJsonBody(ctx.request, 4_000);
  const durationMinutes = body.durationMinutes;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (typeof durationMinutes !== "number" || !SUPPORT_GRANT_MINUTES.has(durationMinutes)) {
    throw new HttpError({ code: "invalid_support_duration", message: "Duration must be 15, 30 or 60 minutes.", status: 400 });
  }
  if (reason.length < 12 || reason.length > 300) {
    throw new HttpError({ code: "invalid_support_reason", message: "Support reason must contain 12 to 300 characters.", status: 400 });
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Number(durationMinutes) * 60_000).toISOString();
  const result = await ctx.db.transact(async (transaction) => {
    const tenant = await transaction.get(`bancas/${tenantId}`);
    if (!tenant || tenant.data.ativo === false) {
      throw new HttpError({ code: "tenant_not_found", message: "Active tenant was not found.", status: 404 });
    }
    const path = `bancas/${tenantId}/supportGrants/${actor.uid}`;
    transaction.set(path, {
      uid: actor.uid,
      bancaId: tenantId,
      ativo: true,
      justificativa: reason,
      criadoEm: now.toISOString(),
      expiraEm: expiresAt,
      atualizadoEm: now.toISOString(),
      revogadoEm: null,
    });
    audit(transaction, actor, {
      action: "PLATFORM_SUPPORT_GRANTED",
      tenantId, entityId: actor.uid,
      details: { reason, durationMinutes, expiresAt, mode: "READ_ONLY" },
    });
    return { active: true, expiresAt, reason };
  });
  return jsonResponse(ctx, { grant: result }, 201);
}

async function revokeSupport(ctx: RequestContext, actor: PlatformIdentity, tenantId: string): Promise<Response> {
  const now = new Date().toISOString();
  await ctx.db.transact(async (transaction) => {
    const path = `bancas/${tenantId}/supportGrants/${actor.uid}`;
    const current = await transaction.get(path);
    if (!current) return;
    transaction.set(path, { ...current.data, ativo: false, revogadoEm: now, atualizadoEm: now });
    audit(transaction, actor, {
      action: "PLATFORM_SUPPORT_REVOKED", tenantId, entityId: actor.uid,
      details: { previousExpiry: current.data.expiraEm ?? null },
    });
  });
  return jsonResponse(ctx, { grant: { active: false } });
}

export async function handlePlatformRoute(ctx: RequestContext): Promise<Response | null> {
  if (!ctx.url.pathname.startsWith("/api/platform/")) return null;
  const actor = await requirePlatformOwner(ctx);
  const pathname = ctx.url.pathname;

  if (ctx.request.method === "GET" && pathname === "/api/platform/tenants") {
    return listTenants(ctx);
  }
  if (ctx.request.method === "POST" && pathname === "/api/platform/tenants") {
    return createTenant(ctx, actor);
  }

  const statusMatch = pathname.match(/^\/api\/platform\/tenants\/([A-Za-z0-9_-]+)\/status$/);
  if (ctx.request.method === "PATCH" && statusMatch) {
    return setTenantStatus(ctx, actor, statusMatch[1]);
  }

  const membershipsMatch = pathname.match(/^\/api\/platform\/tenants\/([A-Za-z0-9_-]+)\/memberships$/);
  if (ctx.request.method === "GET" && membershipsMatch) {
    return listMemberships(ctx, membershipsMatch[1]);
  }

  const membershipMatch = pathname.match(/^\/api\/platform\/tenants\/([A-Za-z0-9_-]+)\/memberships\/([A-Za-z0-9:_-]+)$/);
  if (ctx.request.method === "PUT" && membershipMatch) {
    return setMembership(ctx, actor, membershipMatch[1], membershipMatch[2]);
  }

  const supportMatch = pathname.match(/^\/api\/platform\/tenants\/([A-Za-z0-9_-]+)\/support$/);
  if (supportMatch) {
    if (ctx.request.method === "GET") return getSupportGrant(ctx, actor, supportMatch[1]);
    if (ctx.request.method === "POST") return grantSupport(ctx, actor, supportMatch[1]);
    if (ctx.request.method === "DELETE") return revokeSupport(ctx, actor, supportMatch[1]);
  }

  throw new HttpError({ code: "not_found", message: "Platform API route was not found.", status: 404 });
}
