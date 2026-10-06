import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist/pdf-assets', { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(`node_modules/pdfjs-dist/${name}`, `dist/pdf-assets/${name}`, { recursive: true });
}
