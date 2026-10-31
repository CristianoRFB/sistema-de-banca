import { eq, firestoreDocName, firestoreString, jsonResponse, parseLimit, query } from "../api";
import { HttpError, type JsonObject, type RequestContext } from "../types";

const AUDIT_COLLECTION = "auditLogs";
const AUDIT_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const AUDIT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function auditCursor(value: string | null): { createdAt: string; id: string } | null {
  if (value === null) return null;
  if (value.length > 180) {
    throw new HttpError({ code: "invalid_cursor", message: "Audit cursor is invalid.", status: 400 });
  }
  const delimiter = value.indexOf("|");
  const createdAt = value.slice(0, delimiter);
  const id = value.slice(delimiter + 1);
  if (delimiter < 0 || !AUDIT_TIME_RE.test(createdAt) || !AUDIT_ID_RE.test(id)
    || !Number.isFinite(Date.parse(createdAt))
    || new Date(createdAt).toISOString() !== createdAt) {
    throw new HttpError({ code: "invalid_cursor", message: "Audit cursor is invalid.", status: 400 });
  }
  return { createdAt, id };
}

/** Read-only platform audit trail, newest first, never exposed to tenant admins. */
export async function listPlatformAudit(ctx: RequestContext): Promise<Response> {
  const limit = parseLimit(ctx.url.searchParams.get("limit"), 20, 50);
  const tenantId = ctx.url.searchParams.get("tenantId");
  if (tenantId !== null && !/^[A-Za-z0-9_-]{3,80}$/.test(tenantId)) {
    throw new HttpError({ code: "invalid_tenant", message: "Tenant filter is invalid.", status: 400 });
  }
  const cursor = auditCursor(ctx.url.searchParams.get("cursor"));
  const filters: JsonObject[] = [eq("scope", firestoreString("PLATFORM"))];
  if (tenantId) filters.push(eq("tenantId", firestoreString(tenantId)));
  const startAt: JsonObject | undefined = cursor
    ? {
      values: [
        firestoreString(cursor.createdAt),
        { referenceValue: firestoreDocName(ctx.env.FIREBASE_PROJECT_ID, `${AUDIT_COLLECTION}/${cursor.id}`) },
      ],
      before: false,
    }
    : undefined;

  const rows = await ctx.db.query(AUDIT_COLLECTION, query(
    AUDIT_COLLECTION, filters, limit + 1,
    [
      { field: { fieldPath: "createdAt" }, direction: "DESCENDING" },
      { field: { fieldPath: "__name__" }, direction: "DESCENDING" },
    ],
    startAt,
  ));
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const lastTime = last?.data.createdAt;
  if (rows.length > limit && (typeof lastTime !== "string" || !AUDIT_TIME_RE.test(lastTime)
    || !AUDIT_ID_RE.test(last?.id ?? ""))) {
    throw new HttpError({ code: "invalid_audit_record", message: "Audit pagination record is invalid.", status: 500 });
  }

  return jsonResponse(ctx, {
    events: page.map((record) => ({
      id: record.id,
      action: record.data.action,
      actorUid: record.data.actorUid,
      actorRole: record.data.actorRole,
      tenantId: record.data.tenantId ?? null,
      entityId: record.data.entityId ?? null,
      createdAt: record.data.createdAt,
    })),
    page: {
      limit,
      hasMore: rows.length > limit,
      nextCursor: rows.length > limit ? `${lastTime}|${last!.id}` : null,
    },
  });
}
