import { createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const bankId = process.env.BANCA_ID?.trim();
const tenantSlug = process.env.TENANT_SLUG?.trim().toLocaleLowerCase('pt-BR');
const pepper = process.env.CLIENT_SESSION_PEPPER?.trim();
const apply = process.env.APPLY === '1';

if (!projectId || !/^[A-Za-z0-9-]+$/.test(projectId)) throw new Error('Set FIREBASE_PROJECT_ID.');
if (!bankId || !/^[A-Za-z0-9_-]{1,128}$/.test(bankId)) throw new Error('Set BANCA_ID to the existing Banca Ana Maria document ID.');
if (!tenantSlug || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(tenantSlug)) throw new Error('Set TENANT_SLUG to the canonical tenant slug.');
if (!pepper || pepper.length < 32) throw new Error('Set CLIENT_SESSION_PEPPER to the same HMAC secret used by the Worker.');

const tokenResult = spawnSync('gcloud', ['auth', 'application-default', 'print-access-token'], {
  encoding: 'utf8',
  windowsHide: true,
  shell: process.platform === 'win32',
});
const accessToken = tokenResult.status === 0 ? tokenResult.stdout.trim() : '';
if (!accessToken) throw new Error('Could not get Google Cloud ADC. Configure an authorized operator first.');

const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;

function authHeaders() {
  return { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('integerValue' in value) return Number(value.integerValue);
  return null;
}

function decodeDocument(document) {
  const fields = Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decodeValue(value)]));
  return { id: String(document.name ?? '').split('/').at(-1) ?? '', fields };
}

function tenantPhoneHash(phone) {
  return createHmac('sha256', pepper)
    .update(`customer-phone:v2:${bankId}:${phone}`)
    .digest('base64url');
}

async function getDocument(path) {
  const response = await globalThis.fetch(`${base}/${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore read failed for ${path} (HTTP ${response.status}).`);
  return response.json();
}

async function queryClients() {
  const response = await globalThis.fetch(`${base}:runQuery`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'clientes' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'bancaId' },
            op: 'EQUAL',
            value: { stringValue: bankId },
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Client query failed (HTTP ${response.status}).`);
  const rows = await response.json();
  return rows.filter((row) => row.document).map((row) => decodeDocument(row.document));
}

async function patchTenant() {
  const url = new URL(`${base}/bancas/${encodeURIComponent(bankId)}`);
  url.searchParams.append('updateMask.fieldPaths', 'slug');
  url.searchParams.append('updateMask.fieldPaths', 'ativo');
  url.searchParams.append('updateMask.fieldPaths', 'atualizadoEm');
  const response = await globalThis.fetch(url, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      fields: {
        slug: { stringValue: tenantSlug },
        ativo: { booleanValue: true },
        atualizadoEm: { timestampValue: new Date().toISOString() },
      },
    }),
  });
  if (!response.ok) throw new Error(`Tenant patch failed (HTTP ${response.status}).`);
}

async function createPhoneIndex(client) {
  const phone = String(client.fields.telefoneNormalizado ?? client.fields.telefone ?? '').replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(phone)) return { status: 'SKIP_INVALID_PHONE', clientId: client.id };
  const documentId = tenantPhoneHash(phone);
  const existing = await getDocument(`indiceTelefonesClientes/${documentId}`);
  if (existing) {
    const decoded = decodeDocument(existing);
    if (decoded.fields.bancaId !== bankId || decoded.fields.clienteId !== client.id) {
      throw new Error(`Tenant phone index collision for client ${client.id}. No data was overwritten.`);
    }
    return { status: 'ALREADY_PRESENT', clientId: client.id, documentId };
  }

  if (!apply) return { status: 'WOULD_CREATE', clientId: client.id, documentId };

  const url = new URL(`${base}/indiceTelefonesClientes`);
  url.searchParams.set('documentId', documentId);
  const now = new Date().toISOString();
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      fields: {
        bancaId: { stringValue: bankId },
        clienteId: { stringValue: client.id },
        criadoEm: { timestampValue: now },
        atualizadoEm: { timestampValue: now },
        indexVersion: { integerValue: '2' },
      },
    }),
  });
  if (!response.ok) throw new Error(`Could not create phone index for client ${client.id} (HTTP ${response.status}).`);
  return { status: 'CREATED', clientId: client.id, documentId };
}

const tenant = await getDocument(`bancas/${bankId}`);
if (!tenant) throw new Error('The requested banca document does not exist. Nothing was changed.');

const clients = await queryClients();
const preview = await Promise.all(clients.map(createPhoneIndex));

globalThis.console.log(JSON.stringify({
  mode: apply ? 'APPLY' : 'DRY_RUN',
  projectId,
  bankId,
  tenantSlug,
  clientCount: clients.length,
  phoneIndexes: preview.reduce((summary, item) => {
    summary[item.status] = (summary[item.status] ?? 0) + 1;
    return summary;
  }, {}),
}, null, 2));

if (!apply) {
  globalThis.console.log('Dry-run only. Re-run with APPLY=1 after reviewing the output.');
  process.exit(0);
}

await patchTenant();
globalThis.console.log('Multi-tenant additive migration completed. Legacy records were preserved.');
