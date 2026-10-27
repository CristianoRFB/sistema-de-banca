import { errorResponse, jsonResponse } from "./api";
import { FirestoreRest } from "./firebase/firestore-rest";
import { processExpiredReservations } from "./jobs/process-expired-reservations";
import { processRecollections } from "./jobs/process-recolhimentos";
import { processReminders } from "./jobs/process-reminders";
import { handleAdminRoute } from "./routes/admin";
import { handleClientRoute } from "./routes/client";
import { handlePublicRoute } from "./routes/public";
import { handleTenantBootstrapRoute } from "./routes/tenant-bootstrap";
import { handleTenantSessionRoute } from "./routes/tenant-session";
import { handlePlatformRoute } from "./routes/platform";
import { allowedOrigin } from "./security";
import { listActiveTenants, resolveRequestTenant, scopeEnvForTenant } from "./tenant";
import { HttpError, type Bindings, type RequestContext } from "./types";

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function configurationError(env: Bindings): void {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      !env.CLIENT_SESSION_PEPPER || env.CLIENT_SESSION_PEPPER.length < 32 || !env.CORS_ORIGINS?.trim()) {
    throw new HttpError({ code: "configuration_error", message: "Worker configuration is incomplete.", status: 500 });
  }
}

function preflightResponse(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,idempotency-key",
      "access-control-max-age": "600",
      "access-control-allow-credentials": "false",
      "cache-control": "no-store",
      "vary": "Origin",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

const worker = {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    let ctx: RequestContext | null = null;
    try {
      configurationError(env);
      const corsOrigin = allowedOrigin(request, env);
      if (request.method === "OPTIONS") {
        if (!corsOrigin) throw new HttpError({ code: "origin_required", message: "A valid Origin header is required for preflight requests.", status: 400 });
        return preflightResponse(corsOrigin);
      }

      const requestUrl = new URL(request.url);
      if (request.method === "GET" && requestUrl.pathname === "/api/health") {
        const healthCtx = {
          request,
          url: requestUrl,
          env: scopeEnvForTenant(env, "health"),
          db: new FirestoreRest(env),
          corsOrigin,
          tenant: { id: "health", slug: "health", name: "health", active: true, legacyFallback: false },
        } satisfies RequestContext;
        return jsonResponse(healthCtx, { status: "ok" });
      }

      const db = new FirestoreRest(env);

      if (requestUrl.pathname.startsWith("/api/platform/")) {
        ctx = {
          request,
          url: requestUrl,
          env: scopeEnvForTenant(env, "platform"),
          db,
          corsOrigin,
          tenant: { id: "platform", slug: "platform", name: "Platform", active: true, legacyFallback: false },
        };
        const platformResponse = await handlePlatformRoute(ctx);
        if (platformResponse) return platformResponse;
        throw new HttpError({ code: "not_found", message: "Platform API route was not found.", status: 404 });
      }

      const resolved = await resolveRequestTenant(db, requestUrl, env);
      ctx = {
        request,
        url: resolved.url,
        env: resolved.env,
        db,
        corsOrigin,
        tenant: resolved.tenant,
      };

      const response = await handleTenantBootstrapRoute(ctx) ?? await handleTenantSessionRoute(ctx) ?? await handlePublicRoute(ctx) ?? await handleClientRoute(ctx) ?? await handleAdminRoute(ctx);
      if (response) return response;
      throw new HttpError({ code: "not_found", message: "API route was not found.", status: 404 });
    } catch (error) {
      const known = error instanceof HttpError ? error : new HttpError({ code: "internal_error", message: "The request could not be completed.", status: 500 });
      if (!(error instanceof HttpError)) console.error(JSON.stringify({ event: "request_failed", message: error instanceof Error ? error.message : "unknown_error" }));
      if (ctx) return errorResponse(ctx, known);
      const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return new Response(JSON.stringify({ error: { code: known.code, message: known.message } }), { status: known.status, headers });
    }
  },

  async scheduled(event: ScheduledEvent, env: Bindings, execution: ExecutionContext): Promise<void> {
    configurationError(env);
    const db = new FirestoreRest(env);
    const now = new Date(event.scheduledTime || Date.now());

    execution.waitUntil((async () => {
      const tenants = await listActiveTenants(db);
      // Bound per-tenant fanout: thousands of tenants must not start all jobs at once.
      const TENANT_BATCH_SIZE = 8;
      for (let offset = 0; offset < tenants.length; offset += TENANT_BATCH_SIZE) {
        const batch = tenants.slice(offset, offset + TENANT_BATCH_SIZE);
        const tenantResults = await Promise.allSettled(batch.map(async (tenant) => {
          const scopedEnv = scopeEnvForTenant(env, tenant.id);
          const results = await Promise.allSettled([
            processExpiredReservations(db, scopedEnv, now),
            processReminders(db, scopedEnv, now),
            processRecollections(db, scopedEnv, now),
          ]);
          results.forEach((result, index) => {
            if (result.status === "rejected") {
              console.error(JSON.stringify({
                event: "scheduled_job_failed",
                cron: event.cron,
                tenantId: tenant.id,
                tenantSlug: tenant.slug,
                job: index,
                message: result.reason instanceof Error ? result.reason.message : "unknown_error",
              }));
            }
          });
        }));

        tenantResults.forEach((result, index) => {
          if (result.status === "rejected") {
            console.error(JSON.stringify({
              event: "scheduled_tenant_failed",
              cron: event.cron,
              tenantId: batch[index]?.id ?? "unknown",
              message: result.reason instanceof Error ? result.reason.message : "unknown_error",
            }));
          }
        });
      }
    })());
  },
};

export default worker;
