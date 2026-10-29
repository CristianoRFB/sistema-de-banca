import { createHmac } from "node:crypto";

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED = new Set(["admin", "api", "catalogo", "cliente", "localizacao", "produto"]);
const PHONE_PATTERN = /^55\d{10,11}$/;

export function validateMigrationSettings({ projectId, bankId, tenantSlug, pepper }) {
  if (!projectId || !/^[A-Za-z0-9-]+$/.test(projectId)) throw new Error("Set FIREBASE_PROJECT_ID.");
  if (!bankId || !/^[A-Za-z0-9_-]{1,128}$/.test(bankId)) throw new Error("Set BANCA_ID to the existing bank ID.");
  if (!tenantSlug || !SLUG_PATTERN.test(tenantSlug) || RESERVED.has(tenantSlug)) {
    throw new Error("Set a valid, non-reserved TENANT_SLUG.");
  }
  if (typeof pepper !== "string" || pepper.length < 32) {
    throw new Error("Set CLIENT_SESSION_PEPPER to the existing Worker HMAC secret.");
  }
}

/** Keep the migration's phone canonicalization identical to the Worker. */
export function normalizeMigrationPhone(rawPhone) {
  let digits = String(rawPhone ?? "").replace(/\D/g, "");
  if (digits.startsWith("0055") && /^0055\d{10,11}$/.test(digits)) digits = digits.slice(2);
  if (digits.startsWith("55") && /^55\d{10,11}$/.test(digits)) return digits;
  if (/^\d{10,11}$/.test(digits)) return "55" + digits;
  return digits;
}

export function tenantPhoneHash(pepper, bankId, phone) {
  return createHmac("sha256", pepper).update(`customer-phone:v2:${bankId}:${phone}`).digest("base64url");
}

/**
 * Returns a safe, deterministic plan without writing data or exposing PII.
 * Each phone index is validated in full before the first persistent write.
 */
export function createMigrationPlan({ bankId, tenantSlug, tenant, conflictingSlugs, clients, indexes, pepper }) {
  if (!tenant) throw new Error("The source banca document does not exist.");
  const currentSlug = typeof tenant.fields.slug === "string" ? tenant.fields.slug.trim() : "";
  if (currentSlug && currentSlug !== tenantSlug) {
    throw new Error("The banca already has another slug. Explicit manual review is required.");
  }
  if (conflictingSlugs.some((match) => match.id !== bankId)) {
    throw new Error("The requested slug belongs to another tenant.");
  }

  const actions = [];
  const plannedHashes = new Map();
  for (const client of clients) {
    if (!client?.id || !/^[A-Za-z0-9_-]{1,128}$/.test(client.id)) {
      throw new Error("Invalid client ID in migration source.");
    }
    const phone = normalizeMigrationPhone(client.fields.telefoneNormalizado ?? client.fields.telefone);
    if (!PHONE_PATTERN.test(phone)) {
      actions.push({ clientId: client.id, status: "SKIP_INVALID_PHONE" });
      continue;
    }
    const documentId = tenantPhoneHash(pepper, bankId, phone);
    const duplicatedClient = plannedHashes.get(documentId);
    if (duplicatedClient && duplicatedClient !== client.id) {
      throw new Error("Multiple client documents share a phone in this tenant; manual deduplication required.");
    }
    plannedHashes.set(documentId, client.id);
    const existing = indexes.get(documentId);
    if (existing) {
      if (existing.fields.bancaId !== bankId || existing.fields.clienteId !== client.id) {
        throw new Error("Tenant phone index collision; no records should be overwritten.");
      }
      actions.push({ clientId: client.id, documentId, status: "ALREADY_PRESENT" });
    } else {
      actions.push({ clientId: client.id, documentId, status: "WOULD_CREATE" });
    }
  }
  const phoneIndexes = actions.reduce((acc, action) => {
    acc[action.status] = (acc[action.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    projectBankId: bankId, tenantSlug, clientCount: clients.length, phoneIndexes, actions,
    tenantUpdateRequired: currentSlug !== tenantSlug,
    sourceUpdateTime: tenant.updateTime ?? null,
  };
}

export async function runMigration({ projectId, bankId, tenantSlug, pepper, apply = false, gateway }) {
  validateMigrationSettings({ projectId, bankId, tenantSlug, pepper });
  const tenant = await gateway.getTenant(bankId);
  if (!tenant) throw new Error("The requested banca document does not exist.");
  const [clients, conflictingSlugs] = await Promise.all([
    gateway.listClients(bankId),
    gateway.findBySlug(tenantSlug),
  ]);
  // Preflight every target index before performing any write.
  const indexes = new Map();
  const hashes = [...new Set(clients
    .map((client) => normalizeMigrationPhone(client.fields.telefoneNormalizado ?? client.fields.telefone))
    .filter((phone) => PHONE_PATTERN.test(phone))
    .map((phone) => tenantPhoneHash(pepper, bankId, phone)))];
  for (let offset = 0; offset < hashes.length; offset += 20) {
    const page = hashes.slice(offset, offset + 20);
    const found = await Promise.all(page.map((hash) => gateway.getPhoneIndex(hash)));
    found.forEach((item, i) => { if (item) indexes.set(page[i], item); });
  }
  const plan = createMigrationPlan({ bankId, tenantSlug, tenant, conflictingSlugs, clients, indexes, pepper });
  if (!apply) return { ...plan, mode: "DRY_RUN", createdCount: 0 };

  // APPLY must be confirmed by the caller, never inferred from a read-only run.
  let createdCount = 0;
  try {
    for (const action of plan.actions) {
      if (action.status !== "WOULD_CREATE") continue;
      await gateway.createPhoneIndex(action.documentId, bankId, action.clientId);
      createdCount += 1;
    }
    if (plan.tenantUpdateRequired) {
      await gateway.patchTenant(bankId, tenantSlug, plan.sourceUpdateTime);
    }
  } catch (error) {
    throw new Error(
      `Migration interrupted after ${createdCount} new indexes. Do NOT delete created indexes; resolve the error, run dry-run, and safely resume. Cause: ${error instanceof Error ? error.message : "unknown"}`,
      { cause: error },
    );
  }
  return { ...plan, mode: "APPLY", createdCount };
}
