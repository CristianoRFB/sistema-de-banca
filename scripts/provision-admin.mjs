import { spawnSync } from 'node:child_process';
import { log } from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const bankId = process.env.BANCA_ID?.trim();
const uid = process.env.ADMIN_UID?.trim();
const role = process.env.ADMIN_ROLE?.trim() || 'ADMIN';

if (!projectId || !/^[A-Za-z0-9-]+$/.test(projectId)) throw new Error('Set FIREBASE_PROJECT_ID to the intended Firebase project ID.');
if (!bankId || !/^[A-Za-z0-9_-]{1,128}$/.test(bankId)) throw new Error('Set BANCA_ID to the existing banca document ID.');
if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Set ADMIN_UID to the authenticated Firebase Auth user UID.');
if (role !== 'ADMIN' && role !== 'OPERADOR') throw new Error('ADMIN_ROLE must be ADMIN or OPERADOR.');

const tokenResult = spawnSync('gcloud', ['auth', 'application-default', 'print-access-token'], {
  encoding: 'utf8',
  windowsHide: true,
  shell: process.platform === 'win32',
});
const accessToken = tokenResult.status === 0 ? tokenResult.stdout.trim() : '';
if (!accessToken) throw new Error('Could not get a Google Cloud application-default access token. Set up gcloud ADC with Firestore write access.');

const collection = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/bancas/${encodeURIComponent(bankId)}/usuarios`;
const url = new URL(collection);
url.searchParams.set('documentId', uid);
const now = new Date().toISOString();
const response = await globalThis.fetch(url, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    fields: {
      bancaId: { stringValue: bankId },
      uid: { stringValue: uid },
      papel: { stringValue: role },
      ativo: { booleanValue: true },
      criadoEm: { timestampValue: now },
      atualizadoEm: { timestampValue: now },
    },
  }),
});

if (!response.ok) {
  const status = response.status;
  if (status === 409 || status === 400) throw new Error('Firestore refused creation; the admin document may already exist or the project/bank/user ID is incorrect. No document was overwritten.');
  if (status === 401 || status === 403) throw new Error('The current gcloud ADC account lacks Firestore write access to this project.');
  throw new Error(`Firestore admin provisioning failed (HTTP ${status}).`);
}

log(`Provisioned ${role} access for Firebase Auth UID ${uid} in ${projectId}/${bankId}.`);
