const { Worker } = require('node:worker_threads');
const path = require('node:path');
const MAX_DOC_BYTES = 32 * 1024 * 1024;
const OLE_SIGNATURE = Buffer.from('d0cf11e0a1b11ae1', 'hex');
let activeReaders = 0;
function readLegacyDoc(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DOC_BYTES) return Promise.reject(new Error('Legacy DOC viewing is limited to 32 MB.'));
  const buffer = Buffer.from(bytes);
  if (!buffer.subarray(0, 8).equals(OLE_SIGNATURE)) return Promise.reject(new Error('This is not a binary Word DOC file. Open DOCX with its .docx extension; RTF and HTML files need conversion.'));
  if (activeReaders >= 2) return Promise.reject(new Error('Two DOC files are already opening. Try this file again shortly.'));
  return new Promise((resolve, reject) => {
    let worker;
    try {
      const workerDirectory = __dirname.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
      worker = new Worker(path.join(workerDirectory, 'generated', 'legacy-doc-worker.cjs'), {
        workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 128 }
      });
    } catch (error) { reject(error); return; }
    activeReaders++;
    let settled = false;
    const finish = (error, sections) => {
      if (settled) return;
      settled = true; clearTimeout(timer); activeReaders--;
      worker.terminate().catch(() => {});
      if (error) reject(error); else resolve(sections);
    };
    const timer = setTimeout(() => finish(new Error('This DOC took too long to read. Try converting it to DOCX.')), 15000);
    worker.once('message', result => finish(result.error ? new Error(result.error) : null, result.sections));
    worker.once('error', () => finish(new Error('This DOC could not be read within the viewer memory limit.')));
    worker.once('exit', () => finish(new Error('The DOC reader stopped before finishing.')));
  });
}
module.exports = { readLegacyDoc, MAX_DOC_BYTES };
