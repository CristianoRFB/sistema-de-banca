import { jsonResponse } from "../api";
import { HttpError, type JsonObject, type RequestContext } from "../types";

function safeString(value: unknown, maxLength = 500): string | null {
  return typeof value === "string" && value.trim() && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function branding(value: unknown): JsonObject {
  const data = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  return {
    primaryColor: safeString(data.primaryColor, 32),
    accentColor: safeString(data.accentColor, 32),
    backgroundColor: safeString(data.backgroundColor, 32),
    textColor: safeString(data.textColor, 32),
    logoUrl: safeString(data.logoUrl),
    tagline: safeString(data.tagline, 160),
  };
}

export async function handleTenantBootstrapRoute(ctx: RequestContext): Promise<Response | null> {
  if (ctx.request.method !== "GET" || ctx.url.pathname !== "/api/public/tenant") return null;

  const document = await ctx.db.get(`bancas/${ctx.tenant.id}`);
  if (!document || document.data.ativo === false) {
    throw new HttpError({ code: "tenant_not_found", message: "Tenant was not found.", status: 404 });
  }

  return jsonResponse(ctx, {
    tenant: {
      id: ctx.tenant.id,
      slug: ctx.tenant.slug,
      name: safeString(document.data.nomeExibicao, 100) ?? ctx.tenant.name,
      phone: safeString(document.data.telefone, 40),
      address: safeString(document.data.endereco),
      photoUrl: safeString(document.data.fotoFixaUrl),
      active: true,
      branding: branding(document.data.branding),
    },
  });
}
