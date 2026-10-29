import { describe, expect, it } from "vitest";
import {
  normalizeMigrationPhone, runMigration, tenantPhoneHash, validateMigrationSettings,
} from "../../scripts/multitenant-migration-core.mjs";

const config = {
  projectId: "banca-fixture-project",
  bankId: "banca-ana-maria",
  tenantSlug: "banca-ana-maria",
  pepper: "local-migration-test-pepper-with-32-characters",
};
function client(id, phone) {
  return { id, fields: { telefoneNormalizado: phone, nome: "Fixture " + id } };
}
function gateway(options = {}) {
  const tenant = {
    id: config.bankId,
    updateTime: "2026-10-27T11:00:00.000Z",
    fields: { nomeExibicao: "Banca Ana Maria", ativo: options.active ?? true, ...options.fields },
  };
  const clients = options.clients ?? [
    client("client-1", "5517999991234"),
    client("client-2", "5517999994321"),
    client("client-no-phone", ""),
  ];
  const indices = new Map(options.indices ?? []);
  const changes = { create: [], patch: [], calls: [] };
  return {
    tenant, clients, indices, changes,
    async getTenant(id) {
      changes.calls.push("getTenant");
      return id === config.bankId ? JSON.parse(JSON.stringify(tenant)) : null;
    },
    async listClients(id) {
      changes.calls.push("listClients");
      return id === config.bankId ? JSON.parse(JSON.stringify(clients)) : [];
    },
    async findBySlug(slug) {
      changes.calls.push("findBySlug");
      return options.conflictingSlugs ?? (tenant.fields.slug === slug ? [{ id: config.bankId }] : []);
    },
    async getPhoneIndex(hash) {
      changes.calls.push("getPhoneIndex");
      return indices.get(hash) ?? null;
    },
    async createPhoneIndex(hash, bankId, clientId) {
      changes.create.push({ hash, bankId, clientId });
      if (options.failAfter === changes.create.length) throw new Error("Injected Firestore failure");
      if (indices.has(hash)) throw new Error("Exclusive create collision");
      indices.set(hash, { fields: { bancaId: bankId, clienteId: clientId } });
    },
    async patchTenant(bankId, slug, expectedUpdateTime) {
      changes.patch.push({ bankId, slug, expectedUpdateTime });
      if (options.failPatch) throw new Error("Simulated Firestore write precondition failure");
      if (tenant.updateTime !== expectedUpdateTime) throw new Error("Source modified concurrently");
      tenant.fields.slug = slug;
      tenant.updateTime = "2026-10-27T11:01:00.000Z";
      // Active/inactive status and all other fields MUST remain unchanged.
    },
  };
}

describe("additive migration with no real Firebase connection", () => {
  it("is dry-run by default and never writes a bank, customer or phone index", async () => {
    const db = gateway();
    const preview = await runMigration({ ...config, gateway: db });
    expect(preview.mode).toBe("DRY_RUN");
    expect(preview.phoneIndexes).toEqual({ WOULD_CREATE: 2, SKIP_INVALID_PHONE: 1 });
    expect(preview.clientCount).toBe(3);
    expect(preview.createdCount).toBe(0);
    expect(preview.tenantUpdateRequired).toBe(true);
    expect(db.changes.create).toEqual([]);
    expect(db.changes.patch).toEqual([]);
    expect(db.tenant.fields).toEqual({ nomeExibicao: "Banca Ana Maria", ativo: true });
  });

  it("applies only additive changes, then safely replays with zero writes", async () => {
    const db = gateway({ active: false, fields: { endereco: "Avenida Exemplo" } });
    const applied = await runMigration({ ...config, gateway: db, apply: true });
    expect(applied.createdCount).toBe(2);
    expect(db.indices.size).toBe(2);
    expect(db.changes.patch).toHaveLength(1);
    expect(db.tenant.fields).toMatchObject({
      nomeExibicao: "Banca Ana Maria",
      endereco: "Avenida Exemplo",
      ativo: false,
      slug: config.tenantSlug,
    });
    const replay = await runMigration({ ...config, gateway: db, apply: true });
    expect(replay.phoneIndexes).toEqual({ ALREADY_PRESENT: 2, SKIP_INVALID_PHONE: 1 });
    expect(replay.createdCount).toBe(0);
    expect(db.changes.create).toHaveLength(2);
    expect(db.changes.patch).toHaveLength(1);
  });

  it("rejects another tenant's slug and conflicting index BEFORE any write", async () => {
    const duplicateSlug = gateway({ conflictingSlugs: [{ id: "tenant-b" }] });
    await expect(runMigration({ ...config, gateway: duplicateSlug, apply: true }))
      .rejects.toThrow("slug belongs to another tenant");
    expect(duplicateSlug.changes.create).toHaveLength(0);

    const id = tenantPhoneHash(config.pepper, config.bankId, "5517999991234");
    const conflict = gateway({ indices: [[id, { fields: { bancaId: "tenant-b", clienteId: "client-b" } }]] });
    await expect(runMigration({ ...config, gateway: conflict, apply: true }))
      .rejects.toThrow("index collision");
    expect(conflict.changes.create).toHaveLength(0);
    expect(conflict.changes.patch).toHaveLength(0);
  });

  it("requires manual deduplication for two customer records with the same phone", async () => {
    const db = gateway({ clients: [client("one", "5517999991234"), client("two", "+55 (17) 99999-1234")] });
    await expect(runMigration({ ...config, gateway: db, apply: true }))
      .rejects.toThrow("Multiple client documents share a phone");
    expect(db.changes.create).toHaveLength(0);
    expect(db.changes.patch).toHaveLength(0);
  });

  it("can resume partial index creation after a failure without duplicating records", async () => {
    const db = gateway({ failAfter: 2 });
    await expect(runMigration({ ...config, gateway: db, apply: true }))
      .rejects.toThrow("Migration interrupted after 1 new indexes");
    expect(db.changes.patch).toHaveLength(0);
    expect(db.indices.size).toBe(1);
    const recovered = await runMigration({ ...config, gateway: db, apply: true });
    expect(recovered.phoneIndexes).toEqual({ ALREADY_PRESENT: 1, WOULD_CREATE: 1, SKIP_INVALID_PHONE: 1 });
    expect(recovered.createdCount).toBe(1);
    expect(db.indices.size).toBe(2);
    expect(db.changes.patch).toHaveLength(1);
  });

  it("does not overwrite changed bank data when the final patch fails", async () => {
    const db = gateway({ failPatch: true });
    await expect(runMigration({ ...config, gateway: db, apply: true }))
      .rejects.toThrow("Do NOT delete created indexes");
    expect(db.tenant.fields.slug).toBeUndefined();
    expect(db.indices.size).toBe(2);
    expect(db.tenant.fields.nomeExibicao).toBe("Banca Ana Maria");
    const dry = await runMigration({ ...config, gateway: db });
    expect(dry.phoneIndexes.ALREADY_PRESENT).toBe(2);
  });

  it("rejects invalid settings and conflicting existing slugs without modifying anything", async () => {
    expect(() => validateMigrationSettings({ ...config, tenantSlug: "api" })).toThrow("non-reserved");
    expect(() => validateMigrationSettings({ ...config, bankId: "../other" })).toThrow("BANCA_ID");
    expect(() => validateMigrationSettings({ ...config, pepper: "tiny" })).toThrow("CLIENT_SESSION_PEPPER");
    const db = gateway({ fields: { slug: "another-tenant" } });
    await expect(runMigration({ ...config, gateway: db, apply: true }))
      .rejects.toThrow("already has another slug");
    expect(db.changes.create).toHaveLength(0);
    expect(db.changes.patch).toHaveLength(0);
  });

  it("normalizes local, international and 0055 phone formats exactly as the Worker", async () => {
    expect(normalizeMigrationPhone("17 99999-1234")).toBe("5517999991234");
    expect(normalizeMigrationPhone("+55 (17) 99999-1234")).toBe("5517999991234");
    expect(normalizeMigrationPhone("0055 (17) 99999-1234")).toBe("5517999991234");
    const db = gateway({ clients: [client("one", "17 99999-1234")] });
    const result = await runMigration({ ...config, gateway: db });
    expect(result.phoneIndexes.WOULD_CREATE).toBe(1);
    expect(result.actions[0].documentId).toBe(tenantPhoneHash(config.pepper, config.bankId, "5517999991234"));
    expect(db.changes.create).toHaveLength(0);
  });

  it("computes deterministic, tenant-separated hashes without exposing customer numbers", () => {
    const phone = "5517999991234";
    const first = tenantPhoneHash(config.pepper, config.bankId, phone);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tenantPhoneHash(config.pepper, config.bankId, phone)).toBe(first);
    expect(tenantPhoneHash(config.pepper, "tenant-b", phone)).not.toBe(first);
    expect(first).not.toContain(phone);
  });
});
