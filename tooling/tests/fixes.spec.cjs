const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const JSZip = require('jszip');
const XLSX = require('xlsx');

const ciArgs = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : [];
let application, page, testProfile;

test.beforeAll(async () => {
  testProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'omniview-fixes-profile-'));
  application = await electron.launch(process.env.MULTIVIEWER_EXECUTABLE
    ? { executablePath: process.env.MULTIVIEWER_EXECUTABLE, args: [...ciArgs, `--user-data-dir=${testProfile}`] }
    : { args: [path.join(__dirname, '..', '..', 'app', 'electron', 'main.cjs'), ...ciArgs, `--user-data-dir=${testProfile}`] });
  page = await application.firstWindow();
  page.on('pageerror', error => console.error('Renderer error:', error.message));
  await page.waitForSelector('#btn-hero-browse');
});

test.afterAll(async () => { await application?.close().catch(() => {}); });

async function open(name, buffer, mimeType = 'application/octet-stream') {
  await page.locator('#file-picker-input').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
  await expect(page.locator('#status-filename')).toHaveText(name);
}

async function closeActiveTab() {
  await page.keyboard.press('Control+w');
}

// ---------------------------------------------------------------- PDF helpers

const PDF_PADDING = Buffer.from([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A
]);

function rc4(key, data) {
  const box = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  let swap = 0;
  for (let index = 0; index < 256; index++) {
    swap = (swap + box[index] + key[index % key.length]) & 255;
    [box[index], box[swap]] = [box[swap], box[index]];
  }
  const out = Buffer.alloc(data.length);
  let left = 0, right = 0;
  for (let index = 0; index < data.length; index++) {
    left = (left + 1) & 255;
    right = (right + box[left]) & 255;
    [box[left], box[right]] = [box[right], box[left]];
    out[index] = data[index] ^ box[(box[left] + box[right]) & 255];
  }
  return out;
}

const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();

function padPassword(password) {
  const bytes = Buffer.from(password, 'latin1').subarray(0, 32);
  return Buffer.concat([bytes, PDF_PADDING.subarray(0, 32 - bytes.length)]);
}

function buildPdf(pageTexts, password = null) {
  const id = createHash('md5').update('omniview-test-id').digest();
  const pageCount = pageTexts.length;
  const objects = [];
  const pageObjectNumbers = pageTexts.map((_, index) => 3 + index * 2);
  const fontObjectNumber = 3 + pageCount * 2;
  const encryptObjectNumber = fontObjectNumber + 1;

  let key = null, ownerEntry = null, userEntry = null;
  if (password !== null) {
    const paddedUser = padPassword(password);
    const permissions = Buffer.alloc(4);
    permissions.writeInt32LE(-1, 0);
    ownerEntry = rc4(md5(padPassword(password)).subarray(0, 5), paddedUser);
    key = md5(paddedUser, ownerEntry, permissions, id).subarray(0, 5);
    userEntry = rc4(key, PDF_PADDING);
  }
  const objectKey = number => md5(key, Buffer.from([number & 255, (number >> 8) & 255, (number >> 16) & 255, 0, 0])).subarray(0, 10);
  const hex = buffer => `<${buffer.toString('hex')}>`;

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map(number => `${number} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  pageTexts.forEach((text, index) => {
    const number = pageObjectNumbers[index];
    const stream = `BT /F1 18 Tf 40 200 Td (${text}) Tj ET`;
    const body = key ? rc4(objectKey(number + 1), Buffer.from(stream, 'latin1')) : Buffer.from(stream, 'latin1');
    objects[number] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${number + 1} 0 R >>`;
    objects[number + 1] = { stream: body };
  });
  objects[fontObjectNumber] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  if (key) {
    objects[encryptObjectNumber] = `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -1 /O ${hex(ownerEntry)} /U ${hex(userEntry)} >>`;
  }

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let number = 1; number < objects.length; number++) {
    offsets[number] = Buffer.byteLength(pdf, 'latin1');
    const entry = objects[number];
    if (entry && typeof entry === 'object') {
      pdf += `${number} 0 obj\n<< /Length ${entry.stream.length} >>\nstream\n`;
      pdf += entry.stream.toString('latin1');
      pdf += '\nendstream\nendobj\n';
    } else {
      pdf += `${number} 0 obj\n${entry}\nendobj\n`;
    }
  }
  const startxref = Buffer.byteLength(pdf, 'latin1');
  const size = objects.length;
  pdf += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let number = 1; number < size; number++) pdf += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R /ID [${hex(id)} ${hex(id)}]${key ? ` /Encrypt ${encryptObjectNumber} 0 R` : ''} >>\nstartxref\n${startxref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// ------------------------------------------------------------------- the tests

test('PDF text is selectable, searchable and highlighted across pages', async () => {
  await open('searchable.pdf', buildPdf(['alpha needle on page one', 'beta needle on page two', 'gamma nothing here']), 'application/pdf');
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();

  // A real text layer, not just a raster canvas.
  const spans = page.locator('.pdf-page .textLayer span');
  await expect.poll(() => spans.count()).toBeGreaterThan(0);
  await expect(page.locator('.pdf-page .textLayer').first()).toContainText('alpha needle');

  // The layer must be transparent and sit over the canvas, not replace it.
  const layerStyle = await page.locator('.pdf-page .textLayer span').first().evaluate(el => ({
    color: getComputedStyle(el).color,
    position: getComputedStyle(el).position,
    fontSize: parseFloat(getComputedStyle(el).fontSize)
  }));
  expect(layerStyle.color).toBe('rgba(0, 0, 0, 0)');
  expect(layerStyle.position).toBe('absolute');
  expect(layerStyle.fontSize).toBeGreaterThan(1);

  // Selection works through the layer.
  const selected = await page.evaluate(() => {
    const span = document.querySelector('.pdf-page .textLayer span');
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected).toContain('needle');

  // Find scans the whole document and jumps to the page holding the match.
  await page.getByLabel('Find in PDF').fill('beta');
  await expect(page.locator('.pdf-find-count')).toHaveText('1 / 1');
  await expect(page.locator('#pdf-page-input')).toHaveValue('2');
  await expect(page.locator('mark.pdf-match')).toHaveCount(1);

  await page.getByLabel('Find in PDF').fill('needle');
  await expect(page.locator('.pdf-find-count')).toHaveText(/\/ 2$/);
  // The scan starts at the current page (2), so match order is page 2 then page 1.
  await expect(page.locator('#pdf-page-input')).toHaveValue('2');
  await page.getByLabel('Find in PDF').press('Enter');
  await expect(page.locator('.pdf-find-count')).toHaveText('2 / 2');
  await expect(page.locator('#pdf-page-input')).toHaveValue('1');
  await expect(page.locator('.pdf-page[data-page="1"] mark.pdf-match')).toHaveCount(1);

  await page.getByLabel('Find in PDF').fill('zzz-not-present');
  await expect(page.locator('.pdf-find-count')).toHaveText('No matches');
  await page.getByLabel('Find in PDF').fill('');
  await expect(page.locator('.pdf-find-count')).toHaveText('');
  await expect(page.locator('mark.pdf-match')).toHaveCount(0);
  await closeActiveTab();
});

test('password protected PDF prompts, rejects a wrong password and unlocks', async () => {
  await open('locked.pdf', buildPdf(['confidential contents'], 'correct horse'), 'application/pdf');
  await expect(page.getByLabel('PDF password')).toBeVisible();
  await expect(page.locator('.pdf-password-form h3')).toHaveText('This PDF is password protected');

  await page.getByLabel('PDF password').fill('wrong password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.pdf-password-error')).toHaveText('That password was not correct. Try again.');
  await expect(page.getByLabel('PDF password')).toBeVisible();

  await page.getByLabel('PDF password').fill('correct horse');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.pdf-page .textLayer').first()).toContainText('confidential contents');
  await closeActiveTab();
});

test('cancelling the PDF password prompt leaves a clear message and no broken viewer', async () => {
  await open('cancelled.pdf', buildPdf(['hidden'], 'secret'), 'application/pdf');
  await expect(page.getByLabel('PDF password')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.viewer-error h3')).toHaveText('Password required');
  await closeActiveTab();
});

test('PDF download still returns the original bytes without a retained buffer', async () => {
  const pdf = buildPdf(['download fidelity']);
  await open('fidelity.pdf', pdf, 'application/pdf');
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();
  const target = path.join(os.tmpdir(), `omniview-fidelity-${Date.now()}.pdf`);
  await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
  await page.getByTitle('Download PDF').click();
  await expect.poll(async () => (await fs.readFile(target).catch(() => Buffer.from(''))).equals(pdf)).toBe(true);
  await fs.unlink(target);
  await closeActiveTab();
});

test('unknown binary formats are refused by name instead of rendered as garbage', async () => {
  // loadFile reports these through a native alert, so capture the dialog text.
  const messages = [];
  const onDialog = dialog => { messages.push(dialog.message()); dialog.dismiss(); };
  page.on('dialog', onDialog);
  try {
    // Matroska header with a 'matroska' DocType: MKV, not WebM.
    const mkv = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('matroska'.padEnd(64, ' '))]);
    await page.locator('#file-picker-input').setInputFiles({ name: 'film.mkv', mimeType: 'application/octet-stream', buffer: mkv });
    await expect.poll(() => messages.join('\n')).toContain('MKV');
    expect(await page.locator('.file-tab[data-full-name="film.mkv"]').count()).toBe(0);

    // A Windows PE header must not be decoded as text.
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(200, 0x90)]);
    await page.locator('#file-picker-input').setInputFiles({ name: 'setup.bin', mimeType: 'application/octet-stream', buffer: exe });
    await expect.poll(() => messages.join('\n')).toContain('Windows executable');
    expect(await page.locator('.file-tab[data-full-name="setup.bin"]').count()).toBe(0);

    // A RAR archive gets its own message.
    const rar = Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), Buffer.alloc(64)]);
    await page.locator('#file-picker-input').setInputFiles({ name: 'bundle.rar', mimeType: 'application/octet-stream', buffer: rar });
    await expect.poll(() => messages.join('\n')).toContain('RAR archive');
    expect(await page.locator('.file-tab[data-full-name="bundle.rar"]').count()).toBe(0);

    // Latin-1 text has no NUL but is not UTF-8: say so instead of "unsupported format".
    const latin1 = Buffer.from('caf\xe9 na\xefve r\xe9sum\xe9 '.repeat(8), 'latin1');
    await page.locator('#file-picker-input').setInputFiles({ name: 'legacy.dat', mimeType: '', buffer: latin1 });
    await expect.poll(() => messages.join('\n')).toContain('legacy encoding');
    expect(await page.locator('.file-tab[data-full-name="legacy.dat"]').count()).toBe(0);
  } finally { page.off('dialog', onDialog); }
});

test('extensionless text still opens, and a mislabelled PNG is sniffed as an image', async () => {
  await page.locator('#file-picker-input').setInputFiles({ name: 'Makefile', mimeType: '', buffer: Buffer.from('all:\n\techo building\n') });
  await expect(page.locator('.code-block')).toContainText('echo building');
  await closeActiveTab();

  // 1x1 PNG with a .dat extension: the header wins over the unknown extension.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('#file-picker-input').setInputFiles({ name: 'picture.dat', mimeType: '', buffer: png });
  await expect(page.locator('.viewer-img')).toBeVisible();
  await expect(page.locator('#status-type')).toHaveText('IMAGE');
  await closeActiveTab();
});

test('UTF-16 text is decoded rather than shown as replacement characters', async () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo wörld', 'utf16le')]);
  await page.locator('#file-picker-input').setInputFiles({ name: 'unicode.txt', mimeType: 'text/plain', buffer: utf16 });
  await expect(page.locator('.code-block')).toContainText('héllo wörld');
  // Saving would re-encode it as UTF-8, so editing stays disabled.
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
  await closeActiveTab();
});

test('syntax highlighting survives multi-line comments without losing text', async () => {
  const source = '/* block comment\n   still comment\n   end */\nvalue = `template\nliteral`';
  await open('multiline.js', source, 'text/javascript');
  const rows = page.locator('.code-line');
  await expect(rows).toHaveCount(5);

  // Per-line highlighting used to leave lines 2 and 3 of the comment unstyled.
  for (const index of [0, 1, 2]) {
    await expect(rows.nth(index).locator('.hljs-comment')).toHaveCount(1);
  }
  await expect(rows.nth(3).locator('.hljs-string')).toHaveCount(1);
  await expect(rows.nth(4).locator('.hljs-string')).toHaveCount(1);

  // Splitting must not drop, duplicate or reorder a single character.
  const rendered = await page.locator('.code-block').evaluate(block =>
    [...block.querySelectorAll('.line-code')].map(node => node.textContent).join('\n'));
  expect(rendered).toBe(source);

  // Every line's spans must be balanced, or the browser silently re-parents them.
  const unbalanced = await page.locator('.code-block').evaluate(block =>
    [...block.querySelectorAll('.line-code')].filter(node => {
      const html = node.innerHTML;
      return (html.match(/<span/g) || []).length !== (html.match(/<\/span>/g) || []).length;
    }).length);
  expect(unbalanced).toBe(0);
  await closeActiveTab();
});

test('a large text file renders in chunks and search still counts the whole file', async () => {
  const total = 6000;
  const lines = Array.from({ length: total }, (_, index) => `line ${index + 1} filler`);
  lines[2999] = 'line 3000 NEEDLE';
  await open('big.log', lines.join('\n'), 'text/plain');

  // Only the first chunk exists, so opening the file is not 18,000 DOM nodes at once.
  await expect(page.locator('.code-line')).toHaveCount(1200);
  await expect(page.locator('.code-rendered-count')).toHaveText('Showing first 1,200 of 6,000 lines');

  const input = page.locator('.toolbar-search input');
  await input.fill('NEEDLE');
  // The only match is far past the rendered window; the count must still be right.
  await expect(page.locator('.code-find-count')).toHaveText('1 matching line');
  await expect(page.locator('.code-line.has-match')).toHaveCount(0);

  await page.locator('.code-find-next').click();
  await expect(page.locator('.code-find-count')).toHaveText('1 / 1');
  const current = page.locator('.code-line.current-match');
  await expect(current).toHaveCount(1);
  await expect(current.locator('.line-num')).toHaveText('3000');
  await expect(current.locator('mark.search-match')).toHaveText('NEEDLE');
  // Reaching the match built the lines in front of it, not the whole file.
  const afterJump = await page.locator('.code-line').count();
  expect(afterJump).toBeGreaterThanOrEqual(3000);
  expect(afterJump).toBeLessThan(total);

  // Each scroll to the end adds one chunk, so reaching the last line takes repeated
  // scrolling rather than one pre-built document.
  const scroller = page.locator('.code-viewer-container');
  await expect.poll(async () => {
    await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
    return page.locator('.code-line').count();
  }).toBe(total);
  await expect(page.locator('.code-rendered-count')).toBeHidden();

  await input.fill('');
  await expect(page.locator('mark.search-match')).toHaveCount(0);
  await expect(page.locator('.code-find-nav')).toBeHidden();
  await closeActiveTab();
});

test('printing a chunked text file renders every line first', async () => {
  const lines = Array.from({ length: 4000 }, (_, index) => `print line ${index + 1}`);
  await open('print-me.log', lines.join('\n'), 'text/plain');
  await expect(page.locator('.code-line')).toHaveCount(1200);

  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.print = (_options, callback) => callback(true);
  });
  try {
    await page.keyboard.press('Control+p');
    // A print dialog that only saw the first chunk would silently drop 2,800 lines.
    await expect(page.locator('.code-line')).toHaveCount(4000);
    await expect(page.locator('.code-rendered-count')).toBeHidden();
    await expect(page.locator('.line-code').last()).toHaveText('print line 4000');
  } finally {
    await application.evaluate(({ BrowserWindow }) => {
      delete BrowserWindow.getAllWindows()[0].webContents.print;
    });
  }
  await closeActiveTab();
});

test('DOCX keeps its layout styles but loses injected active content', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdEvil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:window.pwned=true" TargetMode="External"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="FF0000"/></w:rPr><w:t>Styled DOCX body</w:t></w:r></w:p><w:p><w:hyperlink r:id="rIdEvil"><w:r><w:t>click me</w:t></w:r></w:hyperlink></w:p></w:body></w:document>');
  await open('styled.docx', await zip.generateAsync({ type: 'nodebuffer' }));
  await expect(page.locator('.word-content-container')).toContainText('Styled DOCX body');

  // Layout must survive sanitizing: docx-preview expresses it through styles.
  const styled = await page.locator('.word-content-container').evaluate(root => ({
    styleElements: root.querySelectorAll('style').length,
    inlineStyles: [...root.querySelectorAll('[style]')].length,
    javascriptHrefs: [...root.querySelectorAll('a')].filter(a => /^javascript:/i.test(a.getAttribute('href') || '')).length,
    anchors: [...root.querySelectorAll('a')].map(a => a.rel),
    text: root.textContent
  }));
  expect(styled.inlineStyles).toBeGreaterThan(0);
  expect(styled.javascriptHrefs).toBe(0);
  expect(styled.text).toContain('click me');
  expect(styled.anchors.every(rel => rel.includes('noopener'))).toBe(true);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await closeActiveTab();
});

// ------------------------------------------------------------ PPTX helpers

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const SLIDE_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const shape = (placeholder, paragraphs) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="1" name="Shape"/><p:cNvSpPr/><p:nvPr>${placeholder ? `<p:ph type="${placeholder}"/>` : ''}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphs.map(text => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;

async function buildPptx() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml', `<?xml version="1.0"?><p:presentation ${SLIDE_NS}><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?><Relationships ${REL_NS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`);

  // A grouped shape must be flattened in document order, and markup inside a text
  // run must stay text rather than becoming an element.
  const table = '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Region</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Count</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p><a:r><a:t>North</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>12</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
  const picture = '<p:pic><p:nvPicPr><p:cNvPr id="10" name="Quarterly chart"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/><a:stretch/></p:blipFill><p:spPr/></p:pic>';
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0"?><p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="0" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape('ctrTitle', ['Quarterly review'])}<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape('body', ['Revenue grew', '&lt;img src=x onerror=window.pptxPwned=true&gt;'])}</p:grpSp>${table}${picture}</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/slide2.xml', `<?xml version="1.0"?><p:sld ${SLIDE_NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="0" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape('title', ['Next steps'])}</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0"?><Relationships ${REL_NS}><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`);
  zip.file('ppt/media/image1.png', PNG_1PX);
  zip.file('ppt/notesSlides/notesSlide1.xml', `<?xml version="1.0"?><p:notes ${SLIDE_NS}><p:cSld><p:spTree>${shape('body', ['Mention the hiring plan'])}${shape('sldNum', ['1'])}</p:spTree></p:cSld></p:notes>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('PPTX shows slide text, tables, images and notes in shape order', async () => {
  await open('review.pptx', await buildPptx());
  const slide = page.locator('.pptx-slide');
  await expect(slide).toBeVisible();
  await expect(slide.locator('.pptx-title')).toHaveText('Quarterly review');
  await expect(page.locator('#status-type')).toHaveText('PRESENTATION');

  // Shape order: title, grouped body, table, picture, notes.
  const order = await slide.evaluate(card => [...card.children].map(node => node.className || node.tagName));
  expect(order).toEqual(['legacy-doc-notice', 'pptx-title', 'pptx-body', 'pptx-table', 'pptx-image', 'pptx-notes']);

  const cells = await slide.locator('.pptx-table td').allTextContents();
  expect(cells).toEqual(['Region', 'Count', 'North', '12']);
  const image = slide.locator('.pptx-image');
  await expect(image).toHaveAttribute('alt', 'Quarterly chart');
  await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBe(1);

  await slide.locator('.pptx-notes summary').click();
  const notes = await slide.locator('.pptx-notes pre').textContent();
  // The slide-number placeholder is chrome, not a note.
  expect(notes).toBe('Mention the hiring plan');

  // Slide text is untrusted: markup inside a run must never become an element.
  expect(await slide.locator('.pptx-body').textContent()).toContain('<img src=x onerror=window.pptxPwned=true>');
  expect(await slide.locator('.pptx-body img').count()).toBe(0);
  expect(await page.evaluate(() => window.pptxPwned)).toBeUndefined();
});

test('PPTX navigation moves between slides and stops at both ends', async () => {
  const indicator = page.locator('#pptx-slide-input');
  await expect(indicator).toHaveValue('1');
  await expect(page.locator('#pptx-prev')).toBeDisabled();

  await page.locator('#pptx-next').click();
  await expect(page.locator('.pptx-title')).toHaveText('Next steps');
  await expect(indicator).toHaveValue('2');
  await expect(page.locator('#pptx-next')).toBeDisabled();
  // Slide 2 has no picture; slide 1's object URL must not keep the image alive.
  await expect(page.locator('.pptx-image')).toHaveCount(0);

  await indicator.fill('1');
  await indicator.press('Enter');
  await expect(page.locator('.pptx-title')).toHaveText('Quarterly review');
  await expect(page.locator('.pptx-image')).toHaveCount(1);

  // Switching away releases the slide, switching back rebuilds the same one.
  await open('notes.txt', 'side note', 'text/plain');
  await page.locator('.file-tab').first().click();
  await expect(page.locator('.pptx-title')).toHaveText('Quarterly review');
  await expect(page.locator('.pptx-image')).toHaveCount(1);
  await expect.poll(() => page.locator('.pptx-image').evaluate(node => node.naturalWidth)).toBe(1);
  await closeActiveTab();
  await closeActiveTab();
});

test('legacy binary PPT is refused with a conversion hint', async () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
  await open('legacy.ppt', ole);
  await expect(page.locator('.viewer-error')).toContainText('Legacy binary .ppt is not supported');
  await expect(page.locator('.viewer-error')).toContainText('Convert it to .pptx');
  await closeActiveTab();
});

test('a ZIP renamed to PPTX reports the missing presentation part', async () => {
  const zip = new JSZip();
  zip.file('readme.txt', 'not a deck');
  await open('fake.pptx', await zip.generateAsync({ type: 'nodebuffer' }));
  await expect(page.locator('.viewer-error')).toContainText('ppt/presentation.xml is missing');
  await closeActiveTab();
});

test('ZIP refuses an entry that declares more than the decompression budget', async () => {
  test.setTimeout(90000);
  const zip = new JSZip();
  // 260 MB of zeros compresses to a few hundred KB but declares 260 MB on expansion:
  // a real zip bomb, not a patched header.
  zip.file('bomb.txt', Buffer.alloc(260 * 1024 * 1024), { compression: 'DEFLATE', compressionOptions: { level: 1 } });
  const archive = await zip.generateAsync({ type: 'nodebuffer' });
  expect(archive.length).toBeLessThan(8 * 1024 * 1024);

  await open('bomb.zip', archive);
  await expect(page.locator('.zip-table')).toBeVisible();
  await expect(page.locator('.zip-size-col')).toContainText('260 MB');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.locator('.zip-entry-error')).toContainText('past the 256 MB limit');
  // The guard must fire before decompression, so no nested tab was created.
  expect(await page.locator('.file-tab[data-full-name="bomb.txt"]').count()).toBe(0);
  await closeActiveTab();
});

test('a nested ZIP text file keeps its BOM and CRLF when saved', async () => {
  const zip = new JSZip();
  zip.file('nested.txt', Buffer.from('\uFEFFfirst line\r\nsecond line\r\n', 'utf8'));
  await open('nested-save.zip', await zip.generateAsync({ type: 'nodebuffer' }));
  await expect(page.locator('.zip-table')).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.locator('.file-tab[data-full-name="nested.txt"]')).toHaveCount(1);
  await expect(page.locator('.code-block')).toContainText('first line');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit document text').fill('first line\r\nsecond line\r\nthird line');
  const target = path.join(os.tmpdir(), `omniview-nested-${Date.now()}.txt`);
  await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await expect.poll(async () => (await fs.readFile(target).catch(() => Buffer.from(''))).toString('utf8'))
    .toBe('\uFEFFfirst line\r\nsecond line\r\nthird line');
  await fs.unlink(target);
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await closeActiveTab();
  await closeActiveTab();
});

test('spreadsheet cells use the workbook number formats and date styles', async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Date', 'Amount', 'Rate'],
    [new Date(Date.UTC(2026, 9, 13)), 1234.5, 0.25]
  ]);
  sheet.B2 = { t: 'n', v: 1234.5, z: '#,##0.00' };
  sheet.C2 = { t: 'n', v: 0.25, z: '0.0%' };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Formats');
  await open('formats.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx', cellDates: true }));
  await expect(page.locator('.excel-grid tbody tr').first()).toBeVisible();

  // Row 1 is the sheet's own header text; row 2 holds the typed cells.
  const dataRow = page.locator('.excel-grid tbody tr').nth(1);
  const cells = await dataRow.locator('td').allTextContents();
  // A raw Date would stringify as "Mon Oct 13 2026 00:00:00 GMT+0530 (...)".
  expect(cells[0]).not.toMatch(/GMT/);
  expect(cells[0]).toMatch(/2026|13|10/);
  expect(cells[1]).toBe('1,234.50');
  expect(cells[2]).toBe('25.0%');
  expect(await dataRow.locator('td.num-cell').count()).toBe(2);
  await closeActiveTab();
});

test('tabs expose tablist semantics and respond to arrow keys and Delete', async () => {
  await open('tab-a.txt', 'first document', 'text/plain');
  await open('tab-b.txt', 'second document', 'text/plain');
  await open('tab-c.txt', 'third document', 'text/plain');

  await expect(page.locator('#header-tabs-list')).toHaveAttribute('role', 'tablist');
  const tabs = page.locator('.file-tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(2)).toHaveAttribute('role', 'tab');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'false');
  // Roving tabindex: only the selected tab is a tab stop.
  await expect(tabs.nth(2)).toHaveAttribute('tabindex', '0');
  await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
  await expect(tabs.nth(0).locator('.tab-close')).toHaveAttribute('aria-label', 'Close tab-a.txt');

  await tabs.nth(2).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#status-filename')).toHaveText('tab-b.txt');
  await expect(page.locator('.file-tab.active')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#status-filename')).toHaveText('tab-a.txt');
  await page.keyboard.press('End');
  await expect(page.locator('#status-filename')).toHaveText('tab-c.txt');
  await page.keyboard.press('Home');
  await expect(page.locator('#status-filename')).toHaveText('tab-a.txt');
  // Wraps around both ends.
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#status-filename')).toHaveText('tab-c.txt');

  await page.keyboard.press('Delete');
  await expect(page.locator('.file-tab[data-full-name="tab-c.txt"]')).toHaveCount(0);
  await expect(page.locator('.file-tab.active')).toBeFocused();
  await closeActiveTab();
  await closeActiveTab();
});

test('unplayable media reports a codec message instead of a dead player', async () => {
  // Valid MP4 'ftyp' box so it is recognised as media, but no playable track.
  const fake = Buffer.alloc(64);
  fake.write('ftyp', 4);
  fake.write('isom', 8);
  await page.locator('#file-picker-input').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: fake });
  await expect(page.locator('video')).toHaveCount(1);
  await expect(page.locator('.media-error')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.media-error')).toContainText('cannot decode');
  await closeActiveTab();
});

test('macOS recreates the window for a second launch after the last one closes', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps running after the last window closes');
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.allowEditedClose = true;
    win.close();
  });
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);

  // A second launch must recreate the window rather than queue paths nobody reads.
  await application.evaluate(({ app }) => app.emit('second-instance', {}, [process.execPath]));
  await expect.poll(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  page = await application.firstWindow();
  await page.waitForSelector('#btn-hero-browse');
});

// A real crash, not a graceful close: the draft has to survive the process dying.
test('a crash keeps an unsaved draft that the next launch offers to restore', async () => {
  test.setTimeout(120000);
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'omniview-draft-'));
  const target = path.join(folder, 'notes.txt');
  await fs.writeFile(target, 'first line\n');
  const draftsDir = path.join(testProfile, 'drafts');
  const draftCount = () => fs.readdir(draftsDir).then(names => names.filter(name => name.endsWith('.json')).length, () => 0);

  const launch = async (expected = 'first line') => {
    application = await electron.launch(process.env.MULTIVIEWER_EXECUTABLE
      ? { executablePath: process.env.MULTIVIEWER_EXECUTABLE, args: [...ciArgs, `--user-data-dir=${testProfile}`] }
      : { args: [path.join(__dirname, '..', '..', 'app', 'electron', 'main.cjs'), ...ciArgs, `--user-data-dir=${testProfile}`] });
    page = await application.firstWindow();
    await page.waitForSelector('#btn-hero-browse');
    await application.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, target);
    await page.locator('#btn-open-file').click();
    await expect(page.locator('.code-block')).toContainText(expected);
  };
  const crash = async () => {
    const pid = application.process().pid;
    if (process.platform === 'win32') await execFileAsync('taskkill', ['/F', '/T', '/PID', String(pid)]);
    else application.process().kill('SIGKILL');
    await expect.poll(() => { try { process.kill(pid, 0); return false; } catch { return true; } }).toBe(true);
  };
  const edit = async text => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Edit document text').fill(text);
    await expect.poll(draftCount).toBe(1);
  };

  try {
    // Replace the shared instance: a second launch would quit on the single-instance lock.
    await crash();
    await launch();
    await edit('first line\nrecovered work');
    await crash();

    await launch();
    await expect(page.locator('#draft-recovery')).toBeVisible();
    await expect(page.locator('#draft-recovery-message')).toContainText('recovered');
    await page.locator('#btn-draft-discard').click();
    await expect(page.locator('#draft-recovery')).toBeHidden();
    await expect.poll(draftCount).toBe(0);
    // Discarding leaves the file on disk untouched and no editor open.
    expect(await fs.readFile(target, 'utf8')).toBe('first line\n');
    await expect(page.getByLabel('Edit document text')).toHaveCount(0);

    await edit('first line\nrestored work');
    await crash();

    await launch();
    await expect(page.locator('#draft-recovery')).toBeVisible();
    await page.locator('#btn-draft-restore').click();
    await expect(page.getByLabel('Edit document text')).toHaveValue('first line\nrestored work');
    await expect(page.locator('#draft-recovery')).toBeHidden();
    await expect(page.locator('.file-tab.active .tab-title')).toContainText('●');

    // Saving supersedes the recovery copy.
    await page.keyboard.press('Control+s');
    await expect.poll(() => fs.readFile(target, 'utf8')).toBe('first line\nrestored work');
    await expect.poll(draftCount).toBe(0);
    await closeActiveTab();

    // A draft whose file changed on disk is flagged rather than offered as a clean restore.
    await page.locator('#btn-open-file').click();
    await expect(page.locator('.code-block')).toContainText('restored work');
    await edit('first line\nrestored work\nmore work');
    await crash();
    await fs.writeFile(target, 'changed by another program\n');
    await launch('changed by another program');
    await expect(page.locator('#draft-recovery-message')).toContainText('changed on disk since');
    await page.locator('#btn-draft-discard').click();
    await expect.poll(draftCount).toBe(0);
    expect(await fs.readFile(target, 'utf8')).toBe('changed by another program\n');
    await closeActiveTab();
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

// Keep this last: on Windows destroying the last window quits the application.
test('menu commands with no window do not throw in the main process', async () => {
  // destroy() fires 'closed' synchronously, so mainWindow is null while the
  // process is still alive. This reproduces the macOS state on every platform.
  const windows = await application.evaluate(({ BrowserWindow, Menu, dialog }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.allowEditedClose = true;
    win.destroy();
    const file = Menu.getApplicationMenu().items.find(item => item.label === 'File').submenu.items;
    for (const label of ['Save text', 'Save text as…', 'Close document', 'Print…']) {
      file.find(item => item.label === label).click();
    }
    const originalDialog = dialog.showMessageBox;
    let aboutOpened = false;
    dialog.showMessageBox = () => { aboutOpened = true; return Promise.resolve({ response: 0 }); };
    try {
      Menu.getApplicationMenu().items.find(item => item.label === 'Help').submenu.items
        .find(item => item.label === 'About OmniView').click();
    } finally { dialog.showMessageBox = originalDialog; }
    if (!aboutOpened) throw new Error('About command did not open its dialog');
    return BrowserWindow.getAllWindows().length;
  });
  expect(windows).toBe(0);
});