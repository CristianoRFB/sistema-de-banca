import process from 'node:process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.cwd());
const sourceDir = join(root, 'docs', 'versions', 'v01-multitenant-whitelabel', 'diagrams', 'source');
const renderedDir = join(root, 'docs', 'versions', 'v01-multitenant-whitelabel', 'diagrams', 'rendered');

if (!existsSync(sourceDir)) throw new Error('Diagram source directory is missing.');
mkdirSync(renderedDir, { recursive: true });
const sources = readdirSync(sourceDir).filter((name) => name.endsWith('.mmd')).sort();
if (!sources.length) throw new Error('No Mermaid sources found.');

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
for (const source of sources) {
  const input = join(sourceDir, source);
  const output = join(renderedDir, basename(source, '.mmd') + '.svg');
  const result = spawnSync(command, ['--yes', '@mermaid-js/mermaid-cli@11.12.0', '-i', input, '-o', output, '-b', 'transparent'], { stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error('Mermaid render failed: ' + source);
}
globalThis.console.log('Rendered ' + sources.length + ' diagram(s).');
