const { parentPort, workerData } = require('node:worker_threads');
// Pin these internal entry points so the bundle contains only the binary DOC reader.
const WordOleExtractor = require('word-extractor/lib/word-ole-extractor');
const BufferReader = require('word-extractor/lib/buffer-reader');
class LegacyExtractor extends WordOleExtractor {
  extractWordDocument(document, buffer) {
    if (buffer.length < 0x6c) throw new Error('The DOC header is incomplete.');
    if (buffer.readUInt16LE(0x0a) & 0x8100) throw new Error('Password-protected DOC files are not supported. Save an unprotected copy in Word first.');
    return super.extractWordDocument(document, buffer);
  }
}
(async () => {
  try {
    const document = await new LegacyExtractor().extract(new BufferReader(Buffer.from(workerData)));
    const sections = [
      ['Document', document.getBody({ filterUnicode: false })],
      ['Headers', document.getHeaders({ includeFooters: false, filterUnicode: false })],
      ['Footers', document.getFooters({ filterUnicode: false })],
      ['Footnotes', document.getFootnotes({ filterUnicode: false })],
      ['Endnotes', document.getEndnotes({ filterUnicode: false })],
      ['Text boxes', document.getTextboxes({ includeHeadersAndFooters: true })],
      ['Comments', document.getAnnotations({ filterUnicode: false })]
    ].filter(([, text]) => text.trim()).map(([title, text]) => ({ title, text }));
    if (sections.reduce((total, section) => total + section.text.length, 0) > 5 * 1024 * 1024) throw new Error('Extracted DOC text exceeds the 5 million character limit.');
    if (!sections.length) throw new Error('No readable text was found. This DOC may contain only images or use an unsupported Word format.');
    parentPort.postMessage({ sections });
  } catch (error) {
    parentPort.postMessage({ error: /Password-protected|limit|No readable|header is incomplete/.test(error.message) ? error.message : 'This DOC is damaged or uses an unsupported Word format. Try saving it as DOCX.' });
  }
})();
