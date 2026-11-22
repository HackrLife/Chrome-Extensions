// Builds the Retake web app into dist/web: the home page plus the editor and library pages
// shared with the extension, and the shared core. Static files only, ready for any host.
//   node scripts/build-web.mjs

import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'web');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'pages'), { recursive: true });
cpSync(join(root, 'web'), out, { recursive: true });
cpSync(join(root, 'core'), join(out, 'core'), { recursive: true });
cpSync(join(root, 'extension', 'icons'), join(out, 'icons'), { recursive: true });
for (const f of ['editor.html', 'editor.css', 'editor.js', 'library.html', 'library.css', 'library.js']) {
  cpSync(join(root, 'extension', 'pages', f), join(out, 'pages', f));
}
cpSync(join(root, 'extension', 'icons', 'icon-32.png'), join(out, 'favicon.ico'));
console.log(`Built Retake web app -> ${out}`);
