import { spawnSync } from 'node:child_process';
import { log } from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';

const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const uid = process.env.PLATFORM_OWNER_UID?.trim();

if (!projectId || !/^[A-Za-z0-9-]+$/.test(projectId)) throw new Error('Set FIREBASE_PROJECT_ID to the intended Firebase project ID.');
if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Set PLATFORM_OWNER_UID to the Firebase Auth user UID.');

const tokenResult = spawnSync('gcloud', ['auth', 'application-default', 'print-access-token'], {
  encoding: 'utf8',
  windowsHide: true,
  shell: process.platform === 'win32',
});
const accessToken = tokenResult.status === 0 ? tokenResult.stdout.trim() : '';
if (!accessToken) throw new Error('Could not get Google Cloud ADC. Configure an authorized operator first.');

const collection = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/platformOwners`;
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
      uid: { stringValue: uid },
      papel: { stringValue: 'PLATFORM_OWNER' },
      ativo: { booleanValue: true },
      criadoEm: { timestampValue: now },
      atualizadoEm: { timestampValue: now },
    },
  }),
});

if (!response.ok) {
  const status = response.status;
  if (status === 409 || status === 400) throw new Error('Firestore refused creation; the Platform Owner may already exist. No document was overwritten.');
  if (status === 401 || status === 403) throw new Error('The current gcloud ADC account lacks Firestore write access to this project.');
  throw new Error(`Platform Owner provisioning failed (HTTP ${status}).`);
}

log(`Provisioned PLATFORM_OWNER for Firebase Auth UID ${uid} in ${projectId}.`);
