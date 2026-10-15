import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = new URL('../../app/electron/generated/', import.meta.url);
await mkdir(output, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('../workers/legacy-doc-worker.cjs', import.meta.url))],
  outfile: fileURLToPath(new URL('legacy-doc-worker.cjs', output)),
  bundle: true, platform: 'node', target: 'node22', format: 'cjs', legalComments: 'inline'
});
await copyFile(new URL('../../node_modules/word-extractor/LICENSE', import.meta.url), new URL('word-extractor-LICENSE.txt', output));
