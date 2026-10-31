import { jsonResponse } from "../api";
import { requireAdmin } from "../security";
import type { RequestContext } from "../types";

export async function handleTenantSessionRoute(ctx: RequestContext): Promise<Response | null> {
  if (ctx.request.method !== "GET" || ctx.url.pathname !== "/api/admin/session") return null;
  const identity = await requireAdmin(ctx);
  return jsonResponse(ctx, {
    session: {
      uid: identity.uid,
      role: identity.role,
      platformOverride: identity.platformOverride === true,
      supportExpiresAt: identity.supportExpiresAt ?? null,
      tenant: {
        id: ctx.tenant.id,
        slug: ctx.tenant.slug,
        name: ctx.tenant.name,
      },
    },
  });
}
