import { describe, expect, it, vi } from "vitest";
import { getClientIdentity, hashClientSessionToken } from "../../cloudflare/worker/src/security";
import { HttpError, type FirestoreDocument, type JsonObject, type RequestContext } from "../../cloudflare/worker/src/types";
import type { FirestoreRest } from "../../cloudflare/worker/src/firebase/firestore-rest";

const token = "r".repeat(43);
const env = {
  BANCA_ID: "tenant-a",
  CLIENT_SESSION_PEPPER: "session-renewal-test-pepper-that-is-not-a-production-secret",
} as RequestContext["env"];

function document(path: string, data: JsonObject, updateTime?: string): FirestoreDocument {
  return { name: "projects/test/databases/(default)/documents/" + path, id: path.split("/").at(-1) ?? "", data, updateTime };
}

async function fixture(options: { expiring?: boolean; updateTime?: string | null; bankId?: string; active?: boolean } = {}) {
  const expiresAt = new Date(Date.now() + (options.expiring === false ? 25 : 1) * 86_400_000).toISOString();
  const sessionId = await hashClientSessionToken(env, token);
  const session = document("sessoesClientes/" + sessionId, {
    bancaId: options.bankId ?? "tenant-a", clienteId: "customer-a",
    ativa: options.active ?? true, expiraEm: expiresAt,
  }, options.updateTime === null ? undefined : options.updateTime ?? new Date().toISOString());
  const client = document("clientes/customer-a", {
    bancaId: "tenant-a", ativo: true, nome: "Customer fixture",
  });
  const get = vi.fn(async (path: string) => {
    if (path === "sessoesClientes/" + sessionId) return session;
    if (path === "clientes/customer-a") return client;
    return null;
  });
  const commit = vi.fn(async (_writes: unknown[]) => {});
  const request = new Request("https://banca.example.test/api/client/profile", {
    headers: { authorization: "Bearer " + token },
  });
  const ctx = {
    request,
    url: new URL(request.url),
    env, corsOrigin: null,
    tenant: { id: "tenant-a", slug: "banca-a", name: "Banca A", active: true, legacyFallback: false },
    db: { get, commit } as unknown as FirestoreRest,
  } satisfies RequestContext;
  return { ctx, get, commit, session };
}

describe("atomic customer-session renewal", () => {
  it("uses a Firestore updateTime precondition and preserves tenant identity", async () => {
    const { ctx, commit, session } = await fixture();
    const identity = await getClientIdentity(ctx);
    expect(identity.clientId).toBe("customer-a");
    expect(commit).toHaveBeenCalledTimes(1);
    const writes = commit.mock.calls[0][0] as Array<{ path: string; data: JsonObject; updateTime?: string }>;
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toMatch(/^sessoesClientes\//);
    expect(writes[0].updateTime).toBe(session.updateTime);
    expect(writes[0].data.bancaId).toBe("tenant-a");
    expect(writes[0].data.clienteId).toBe("customer-a");
    expect(Date.parse(String(writes[0].data.expiraEm)) - Date.now()).toBeGreaterThan(20 * 86_400_000);
  });

  it("does not write when the session does not require renewal", async () => {
    const { ctx, commit } = await fixture({ expiring: false });
    await expect(getClientIdentity(ctx)).resolves.toMatchObject({ clientId: "customer-a" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("fails closed if no Firestore updateTime is available", async () => {
    const { ctx, commit } = await fixture({ updateTime: null });
    await expect(getClientIdentity(ctx)).rejects.toMatchObject({
      code: "session_invalid", status: 401,
    } satisfies Partial<HttpError>);
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not authenticate successfully when a revocation invalidates its write precondition", async () => {
    const { ctx, commit } = await fixture();
    commit.mockRejectedValueOnce(new HttpError({
      code: "firestore_error",
      message: "Firestore precondition failed.",
      status: 412,
    }));
    await expect(getClientIdentity(ctx)).rejects.toMatchObject({ status: 412 });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("rejects an inactive or foreign tenant session before any renewal", async () => {
    for (const options of [{ active: false }, { bankId: "tenant-b" }]) {
      const { ctx, commit } = await fixture(options);
      await expect(getClientIdentity(ctx)).rejects.toMatchObject({
        code: "session_invalid", status: 401,
      } satisfies Partial<HttpError>);
      expect(commit).not.toHaveBeenCalled();
    }
  });
});