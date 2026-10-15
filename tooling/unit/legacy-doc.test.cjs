const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readLegacyDoc } = require('../../app/electron/legacy-doc.cjs');
const fixture = name => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name));
test('binary DOC reading preserves Unicode and Word 97 text', async () => {
  const sections = await readLegacyDoc(fixture('legacy-word.doc'));
  assert.match(sections[0].text, /😀 ∀/);
  assert.match(sections[0].text, /This text has been inserted/);
  assert.doesNotMatch(sections[0].text, /This text has been deleted/);
  assert.match((await readLegacyDoc(fixture('legacy-word97.doc')))[0].text, /Word 97-SR2/);
});
test('headers, footers and notes are available separately', async () => {
  const sections = await readLegacyDoc(fixture('legacy-headers.doc'));
  assert.match(sections.find(item => item.title === 'Document').text, /Molière/);
  assert.match(sections.find(item => item.title === 'Headers').text, /€ euro/);
  assert.match(sections.find(item => item.title === 'Footers').text, /Molière/);
  const notes = await readLegacyDoc(fixture('legacy-notes.doc'));
  assert.match(notes.find(item => item.title === 'Footnotes').text, /This is a footnote/);
  assert.match(notes.find(item => item.title === 'Endnotes').text, /This is an endnote/);
});
test('invalid, encrypted and oversized DOC inputs fail without poisoning the next read', async () => {
  await assert.rejects(readLegacyDoc(Buffer.from('<html>Not a binary DOC</html>')), /not a binary Word/);
  await assert.rejects(readLegacyDoc(Buffer.alloc(32 * 1024 * 1024 + 1)), /32 MB/);
  const encrypted = fixture('legacy-word.doc');
  const header = encrypted.indexOf(Buffer.from('eca5', 'hex'));
  encrypted.writeUInt16LE(encrypted.readUInt16LE(header + 10) | 0x0100, header + 10);
  await assert.rejects(readLegacyDoc(encrypted), /Password-protected/);
  const corrupt = Buffer.alloc(512); Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(corrupt);
  await assert.rejects(readLegacyDoc(corrupt), /damaged|stopped|memory limit/);
  assert.match((await readLegacyDoc(fixture('legacy-word97.doc')))[0].text, /Word 97-SR2/);
});
