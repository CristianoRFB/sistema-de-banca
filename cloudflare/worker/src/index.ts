import { errorResponse, jsonResponse } from "./api";
import { FirestoreRest } from "./firebase/firestore-rest";
import { processExpiredReservations } from "./jobs/process-expired-reservations";
import { processRecollections } from "./jobs/process-recolhimentos";
import { processReminders } from "./jobs/process-reminders";
import { handleAdminRoute } from "./routes/admin";
import { handleClientRoute } from "./routes/client";
import { handlePublicRoute } from "./routes/public";
import { allowedOrigin } from "./security";
import { HttpError, type Bindings, type RequestContext } from "./types";

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function configurationError(env: Bindings): void {
  if (!env.FIREBASE_PROJECT_ID || !env.BANCA_ID || !env.FIREBASE_SERVICE_ACCOUNT_JSON ||
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
      "access-control-credentials": "false",
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
      const url = new URL(request.url);
      ctx = { request, url, env, db: new FirestoreRest(env), corsOrigin };
      if (request.method === "GET" && url.pathname === "/api/health") return jsonResponse(ctx, { status: "ok" });
      const response = await handlePublicRoute(ctx) ?? await handleClientRoute(ctx) ?? await handleAdminRoute(ctx);
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
      const results = await Promise.allSettled([
        processExpiredReservations(db, env, now),
        processReminders(db, env, now),
        processRecollections(db, env, now),
      ]);
      results.forEach((result, index) => {
        if (result.status === "rejected") console.error(JSON.stringify({ event: "scheduled_job_failed", cron: event.cron, job: index, message: result.reason instanceof Error ? result.reason.message : "unknown_error" }));
      });
    })());
  },
};

export default worker;
