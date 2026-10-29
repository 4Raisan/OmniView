const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createHash } = require('node:crypto');
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

// Keep this last: on Windows destroying the last window quits the application.
test('menu commands with no window do not throw in the main process', async () => {
  // destroy() fires 'closed' synchronously, so mainWindow is null while the
  // process is still alive. This reproduces the macOS state on every platform.
  const windows = await application.evaluate(({ BrowserWindow, Menu }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.allowEditedClose = true;
    win.destroy();
    const file = Menu.getApplicationMenu().items.find(item => item.label === 'File').submenu.items;
    for (const label of ['Save text', 'Save text as…', 'Close document', 'Print…']) {
      file.find(item => item.label === label).click();
    }
    Menu.getApplicationMenu().items.find(item => item.label === 'Help').submenu.items
      .find(item => item.label === 'About OmniView').click();
    return BrowserWindow.getAllWindows().length;
  });
  expect(windows).toBe(0);
});