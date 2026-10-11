import { cp, mkdir } from 'node:fs/promises';
await mkdir('app/dist/pdf-assets', { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(`node_modules/pdfjs-dist/${name}`, `app/dist/pdf-assets/${name}`, { recursive: true });
}
