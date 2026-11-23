// Builds the Retake Chrome extension into dist/extension and zips it for the Chrome Web Store.
// No dependencies: the extension is plain JavaScript, so building is copying the shared core in.
//   node scripts/build.mjs          build dist/extension
//   node scripts/build.mjs --zip    also write dist/retake-<version>.zip

import { cpSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(dist, 'extension');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'extension'), out, { recursive: true });
// Web-app-only modules (sign-in, slide presenter, PDF reader) stay out of the extension package,
// so the Web Store build contains no network code and nothing it does not use.
const WEB_ONLY = ['auth.js', 'presenter.js', 'ink.js', 'vendor'];
cpSync(join(root, 'core'), join(out, 'core'), {
  recursive: true,
  filter: (src) => !WEB_ONLY.some((name) => src === join(root, 'core', name)),
});

const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
console.log(`Built Retake ${manifest.version} -> ${out}`);

if (process.argv.includes('--zip')) {
  const zip = join(dist, `retake-${manifest.version}.zip`);
  if (existsSync(zip)) rmSync(zip);
  execFileSync('zip', ['-r', '-q', '-X', zip, '.', '-x', '*.DS_Store'], { cwd: out });
  console.log(`Packaged ${zip}`);
}
