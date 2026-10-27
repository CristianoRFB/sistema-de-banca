import { describe, expect, it, vi } from "vitest";
import { handlePlatformRoute } from "../../cloudflare/worker/src/routes/platform";
import { isValidSupportGrant } from "../../cloudflare/worker/src/security";
import { HttpError, type FirestoreDocument, type JsonObject, type RequestContext } from "../../cloudflare/worker/src/types";
import type { FirestoreRest } from "../../cloudflare/worker/src/firebase/firestore-rest";

vi.mock("../../cloudflare/worker/src/security", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../cloudflare/worker/src/security")>();
  return {
    ...original,
    requirePlatformOwner: vi.fn(async () => ({ uid: "platform-uid", role: "PLATFORM_OWNER", claims: {} })),
  };
});

class MemorySupportDb {
  documents = new Map<string, JsonObject>([
    ["bancas/tenant-a", { ativo: true, slug: "banca-a" }],
    ["bancas/tenant-b", { ativo: true, slug: "banca-b" }],
    ["bancas/disabled", { ativo: false, slug: "disabled" }],
  ]);

  async get(path: string): Promise<FirestoreDocument | null> {
    const data = this.documents.get(path);
    return data ? {
      id: path.split("/").at(-1) ?? "",
      name: `projects/test/databases/(default)/documents/${path}`,
      data,
    } : null;
  }

  async transact<T>(fn: (transaction: {
    get: (path: string) => Promise<FirestoreDocument | null>;
    set: (path: string, data: JsonObject, options?: { mustNotExist?: boolean }) => void;
  }) => Promise<T>): Promise<T> {
    return fn({
      get: (path) => this.get(path),
      set: (path, data, options) => {
        if (options?.mustNotExist && this.documents.has(path)) throw new Error("Duplicate document");
        this.documents.set(path, data);
      },
    });
  }
}

function context(db: MemorySupportDb, tenantId: string, method: string, body?: JsonObject): RequestContext {
  const request = new Request(`https://example.test/api/platform/tenants/${tenantId}/support`, {
    method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  return {
    request, url: new URL(request.url),
    env: { BANCA_ID: "platform" } as RequestContext["env"],
    db: db as unknown as FirestoreRest,
    corsOrigin: null,
    tenant: { id: "platform", slug: "platform", name: "Platform", active: true, legacyFallback: false },
  };
}

describe("Platform Owner temporary support", () => {
  it("requires explicit reason, saves bounded read-only grant and audits grant/revocation", async () => {
    const db = new MemorySupportDb();
    const result = await handlePlatformRoute(context(db, "tenant-a", "POST", {
      durationMinutes: 15,
      reason: "Analisar problema reportado pela equipe.",
    }));
    expect(result?.status).toBe(201);
    const path = "bancas/tenant-a/supportGrants/platform-uid";
    const grant = db.documents.get(path);
    expect(grant).toMatchObject({
      bancaId: "tenant-a", uid: "platform-uid", ativo: true,
    });
    expect(isValidSupportGrant(grant, "tenant-a", "platform-uid", "GET")).toBe(true);
    expect(isValidSupportGrant(grant, "tenant-b", "platform-uid", "GET")).toBe(false);
    expect(isValidSupportGrant(grant, "tenant-a", "platform-uid", "PUT")).toBe(false);
    expect(isValidSupportGrant(grant, "tenant-a", "platform-uid", "GET", Date.now() + 70 * 60_000)).toBe(false);

    const inspected = await handlePlatformRoute(context(db, "tenant-a", "GET"));
    const data = await inspected?.json() as { data: { grant: { active: boolean; reason: string } } };
    expect(data.data.grant.active).toBe(true);
    expect(data.data.grant.reason).toContain("problema");

    const removed = await handlePlatformRoute(context(db, "tenant-a", "DELETE"));
    expect(removed?.status).toBe(200);
    expect(isValidSupportGrant(db.documents.get(path), "tenant-a", "platform-uid", "GET")).toBe(false);
    expect(db.documents.get("bancas/tenant-b/supportGrants/platform-uid")).toBeUndefined();
    const audits = [...db.documents.entries()].filter(([key]) => key.startsWith("auditLogs/")).map(([, value]) => value);
    expect(audits.map((row) => row.action)).toEqual(["PLATFORM_SUPPORT_GRANTED", "PLATFORM_SUPPORT_REVOKED"]);
  });

  it("rejects unsupported durations, missing justification and inactive tenants", async () => {
    const db = new MemorySupportDb();
    for (const invalid of [0, 10, 120, "15"]) {
      await expect(handlePlatformRoute(context(db, "tenant-a", "POST", {
        reason: "Suporte técnico autorizado.",
        durationMinutes: invalid,
      }))).rejects.toMatchObject({ code: "invalid_support_duration", status: 400 } satisfies Partial<HttpError>);
    }
    await expect(handlePlatformRoute(context(db, "tenant-a", "POST", {
      reason: "Curto", durationMinutes: 15,
    }))).rejects.toMatchObject({ code: "invalid_support_reason", status: 400 } satisfies Partial<HttpError>);
    await expect(handlePlatformRoute(context(db, "disabled", "POST", {
      reason: "Suporte técnico autorizado.", durationMinutes: 15,
    }))).rejects.toMatchObject({ code: "tenant_not_found", status: 404 } satisfies Partial<HttpError>);
  });

  it("fails closed for malformed, inactive and expired grants", () => {
    const now = Date.now();
    const base = { uid: "platform-uid", bancaId: "tenant-a", ativo: true };
    expect(isValidSupportGrant(undefined, "tenant-a", "platform-uid", "GET", now)).toBe(false);
    expect(isValidSupportGrant({ ...base, expiraEm: "invalid-date" }, "tenant-a", "platform-uid", "GET", now)).toBe(false);
    expect(isValidSupportGrant({ ...base, expiraEm: new Date(now).toISOString() }, "tenant-a", "platform-uid", "GET", now)).toBe(false);
    expect(isValidSupportGrant({ ...base, ativo: false, expiraEm: new Date(now + 60_000).toISOString() }, "tenant-a", "platform-uid", "GET", now)).toBe(false);
    expect(isValidSupportGrant({ ...base, expiraEm: new Date(now + 60_000).toISOString() }, "tenant-a", "different-owner", "GET", now)).toBe(false);
  });
});
