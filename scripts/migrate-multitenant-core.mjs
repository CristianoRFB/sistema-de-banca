import { spawnSync } from "node:child_process";
import process from "node:process";
import { URL } from "node:url";
import { runMigration } from "./multitenant-migration-core.mjs";

// This command is intentionally dry-run by default. It never creates new tenants.
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const bankId = process.env.BANCA_ID?.trim();
const tenantSlug = process.env.TENANT_SLUG?.trim().toLocaleLowerCase("pt-BR");
const pepper = process.env.CLIENT_SESSION_PEPPER?.trim();
const apply = process.env.APPLY === "1";

// APPLY requires explicit confirmation of both targets. Prevent accidental
// execution against the wrong Firebase project or original banca.
if (apply && (process.env.CONFIRM_PROJECT_ID !== projectId || process.env.CONFIRM_BANK_ID !== bankId)) {
  throw new Error("For APPLY=1, set CONFIRM_PROJECT_ID and CONFIRM_BANK_ID to the exact verified targets.");
}
if (!projectId || !bankId || !tenantSlug || !pepper) {
  throw new Error("Set FIREBASE_PROJECT_ID, BANCA_ID, TENANT_SLUG and CLIENT_SESSION_PEPPER.");
}

const tokenResult = spawnSync("gcloud", ["auth", "application-default", "print-access-token"], {
  encoding: "utf8", windowsHide: true, shell: process.platform === "win32",
});
const accessToken = tokenResult.status === 0 ? tokenResult.stdout.trim() : "";
if (!accessToken) throw new Error("Could not get Google Cloud ADC. Configure an authorized operator first.");
const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;

function headers() { return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }; }

function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("integerValue" in value) return Number(value.integerValue);
  return null;
}
function decodeDocument(document) {
  return {
    id: String(document.name ?? "").split("/").at(-1) ?? "",
    updateTime: document.updateTime ?? null,
    fields: Object.fromEntries(Object.entries(document.fields ?? {})
      .map(([key, value]) => [key, decodeValue(value)])),
  };
}
async function getDocument(path) {
  const response = await globalThis.fetch(`${base}/${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore GET failed (HTTP ${response.status}) for ${path}.`);
  return decodeDocument(await response.json());
}
async function queryDocuments(structuredQuery) {
  const response = await globalThis.fetch(`${base}:runQuery`, {
    method: "POST", headers: headers(), body: JSON.stringify({ structuredQuery }),
  });
  if (!response.ok) throw new Error(`Firestore query failed (HTTP ${response.status}).`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Invalid Firestore query response.");
  return rows.filter((row) => row.document).map((row) => decodeDocument(row.document));
}
const gateway = {
  getTenant: (id) => getDocument(`bancas/${encodeURIComponent(id)}`),
  listClients: (id) => queryDocuments({
    from: [{ collectionId: "clientes" }],
    where: { fieldFilter: {
      field: { fieldPath: "bancaId" },
      op: "EQUAL", value: { stringValue: id },
    } },
  }),
  findBySlug: (slug) => queryDocuments({
    from: [{ collectionId: "bancas" }],
    where: { fieldFilter: {
      field: { fieldPath: "slug" },
      op: "EQUAL", value: { stringValue: slug },
    } },
  }),
  getPhoneIndex: (hash) => getDocument(`indiceTelefonesClientes/${encodeURIComponent(hash)}`),
  async createPhoneIndex(hash, tenantId, clientId) {
    // POST with documentId fails if another process created the record:
    // never overwrite another client's index in a concurrent migration.
    const url = new URL(`${base}/indiceTelefonesClientes`);
    url.searchParams.set("documentId", hash);
    const now = new Date().toISOString();
    const response = await globalThis.fetch(url, {
      method: "POST", headers: headers(),
      body: JSON.stringify({ fields: {
        bancaId: { stringValue: tenantId },
        clienteId: { stringValue: clientId },
        criadoEm: { timestampValue: now },
        atualizadoEm: { timestampValue: now },
        indexVersion: { integerValue: "2" },
      } }),
    });
    if (!response.ok) throw new Error(`Phone index write refused (HTTP ${response.status}); rerun dry-run.`);
  },
  async patchTenant(id, slug, updateTime) {
    if (!updateTime) throw new Error("Missing Firestore updateTime; refusing unsafe tenant patch.");
    const url = new URL(`${base}/bancas/${encodeURIComponent(id)}`);
    url.searchParams.append("updateMask.fieldPaths", "slug");
    url.searchParams.append("updateMask.fieldPaths", "atualizadoEm");
    url.searchParams.set("currentDocument.updateTime", updateTime);
    const response = await globalThis.fetch(url, {
      method: "PATCH", headers: headers(),
      body: JSON.stringify({ fields: {
        slug: { stringValue: slug },
        atualizadoEm: { timestampValue: new Date().toISOString() },
      } }),
    });
    if (!response.ok) throw new Error(`Tenant patch rejected (HTTP ${response.status}), including possible concurrent update. Rerun dry-run.`);
  },
};

const result = await runMigration({ projectId, bankId, tenantSlug, pepper, apply, gateway });
// Never print phone numbers, client IDs, tokens or hashes; expose aggregated counts.
globalThis.console.log(JSON.stringify({
  mode: result.mode, projectId, bankId, tenantSlug, clientCount: result.clientCount,
  phoneIndexes: result.phoneIndexes, createdCount: result.createdCount,
  tenantUpdateRequired: result.tenantUpdateRequired,
}, null, 2));
if (!apply) globalThis.console.log("DRY_RUN only. Review the plan before explicitly confirming APPLY.");
else globalThis.console.log("Additive migration applied. Existing customer and history documents were preserved.");
