import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const destination = path.join(root, 'app', 'dist', 'pdf-assets');
await mkdir(destination, { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(root, 'node_modules', 'pdfjs-dist', name), path.join(destination, name), { recursive: true });
}

// The selectable text layer needs pdf.js's own rules, which track the pinned version.
// Take only the .textLayer block: the full pdf_viewer.css also sets :root variables
// and styles viewer chrome OmniView does not use.
const css = await readFile(path.join(root, 'node_modules', 'pdfjs-dist', 'web', 'pdf_viewer.css'), 'utf8');
const start = css.indexOf('\n.textLayer {');
if (start < 0) throw new Error('pdfjs-dist no longer ships a top-level .textLayer rule; update the extraction.');
let depth = 0, end = -1;
for (let index = css.indexOf('{', start); index < css.length; index++) {
  if (css[index] === '{') depth++;
  else if (css[index] === '}' && --depth === 0) { end = index + 1; break; }
}
if (end < 0) throw new Error('Unbalanced .textLayer rule in pdf_viewer.css.');
await writeFile(path.join(destination, 'text-layer.css'), css.slice(start + 1, end) + '\n');