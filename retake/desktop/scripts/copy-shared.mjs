// Copies the code shared with the extension and web app into desktop/shared, so the packaged
// app is self-contained. Run automatically by npm start and npm run dist.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const retake = join(desktop, '..');
const out = join(desktop, 'shared');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'pages'), { recursive: true });
cpSync(join(retake, 'core'), join(out, 'core'), { recursive: true });
cpSync(join(retake, 'extension', 'icons'), join(out, 'icons'), { recursive: true });
for (const f of ['editor.html', 'editor.css', 'editor.js', 'library.html', 'library.css', 'library.js']) {
  cpSync(join(retake, 'extension', 'pages', f), join(out, 'pages', f));
}
console.log('Shared code copied into desktop/shared');
