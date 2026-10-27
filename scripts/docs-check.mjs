import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const failures = [];
const required = (relative) => {
  const full = join(root, relative);
  if (!existsSync(full)) failures.push('missing: ' + relative);
  return full;
};

required('docs/CURRENT.md');
required('docs/DIAGRAMS_MANIFEST.md');
required('docs/LEADS_MANIFEST.md');

let versionRoot = '';
const currentPath = join(root, 'docs', 'CURRENT.md');
if (existsSync(currentPath)) {
  const current = readFileSync(currentPath, 'utf8');
  const match = current.match(/CANONICAL_VERSION:\s*([^\s]+)/);
  if (!match) failures.push('CURRENT missing CANONICAL_VERSION');
  else { versionRoot = match[1].replace(/^\.\//, ''); required(versionRoot); }
}

if (versionRoot) {
  const files = ['README.md','STATUS.md','ARCHITECTURE.md','DATA_MODEL.md','SECURITY.md','FIREBASE_STRUCTURE.md','PROJECT_STRUCTURE.md','SCREENS.md','GENERATED_VISUALS.md','LEADS_OVERVIEW.md','MULTI_TENANCY.md','WHITE_LABEL.md','DEPLOYMENT.md','MIGRATION.md','ROADMAP.md'];
  for (const file of files) required(versionRoot + '/' + file);
  for (const dir of ['diagrams/source','diagrams/rendered','screenshots','generated/concepts','generated/mockups','generated/lead-adapted','generated/covers']) required(versionRoot + '/' + dir);
  const firebase = join(root, versionRoot, 'FIREBASE_STRUCTURE.md');
  if (existsSync(firebase)) {
    const text = readFileSync(firebase, 'utf8');
    if (!/Firebase Auth/i.test(text) || !/Firestore/i.test(text) || !/Storage/i.test(text)) failures.push('FIREBASE_STRUCTURE must document Auth, Firestore and Storage status');
  }
}

if (failures.length) {
  globalThis.console.error('docs:check FAILED');
  for (const failure of failures) globalThis.console.error('-', failure);
  process.exit(1);
}
globalThis.console.log('docs:check PASS');
