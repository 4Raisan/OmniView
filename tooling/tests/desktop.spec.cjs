const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const JSZip = require('jszip');
const XLSX = require('xlsx');

const ciArgs = process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : [];
let application, page, originalStorage, testProfile;
test.beforeAll(async () => {
  testProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'multiviewer-test-profile-'));
  application = await electron.launch(process.env.MULTIVIEWER_EXECUTABLE
    ? { executablePath: process.env.MULTIVIEWER_EXECUTABLE, args: [...ciArgs, `--user-data-dir=${testProfile}`] }
    : { args: [path.join(__dirname, '..', '..', 'app', 'electron', 'main.cjs'), ...ciArgs, `--user-data-dir=${testProfile}`] });
  application.process().stderr.on('data', data => console.error(data.toString()));
  page = await application.firstWindow();
  page.on('pageerror', error => console.error('Renderer error:', error.message));
  await page.waitForSelector('#btn-hero-browse');
  originalStorage = await page.evaluate(() => ({ ...localStorage }));
});
test('title and menus share one row and open the native application menu', async () => {
  if (process.platform !== 'darwin') expect(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMenuBarVisible())).toBe(false);
  await expect(page.locator('.window-brand')).toHaveText('OmniView');
  const layout = await page.locator('.window-titlebar').evaluate(bar=>({height:bar.getBoundingClientRect().height,ys:[...bar.querySelectorAll('button,.window-brand')].map(el=>{const r=el.getBoundingClientRect();return r.y+r.height/2;})}));
  expect(layout.height).toBe(36); expect(Math.max(...layout.ys)-Math.min(...layout.ys)).toBeLessThan(2);
  await application.evaluate(({Menu})=>{const submenu=Menu.getApplicationMenu().items.find(item=>item.label==='Help').submenu;global.originalPopup=submenu.popup;submenu.popup=options=>{global.popupPosition={x:options.x,y:options.y};};});
  try {
    await page.locator('[data-menu="Help"]').click();
    await expect.poll(()=>application.evaluate(()=>global.popupPosition?.y)).toBe(36);
    expect(await application.evaluate(()=>global.popupPosition.x)).toBeGreaterThan(0);
  } finally { await application.evaluate(({Menu})=>{Menu.getApplicationMenu().items.find(item=>item.label==='Help').submenu.popup=global.originalPopup;}); }
});

test('Open uses the native picker and sidebar keyboard shortcut works', async () => {
  const target = path.join(os.tmpdir(), 'multiviewer-native-picker.txt');
  await fs.writeFile(target, 'selected using native picker');
  await application.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
  }, target);
  await page.locator('#btn-open-file').click();
  await expect(page.locator('.code-block')).toContainText('selected using native picker');
  const previous = await page.locator('#app-sidebar').evaluate(el => el.classList.contains('collapsed'));
  await page.keyboard.press('Control+b');
  await expect.poll(() => page.locator('#app-sidebar').evaluate(el => el.classList.contains('collapsed'))).toBe(!previous);
  await fs.unlink(target);
});
test('Markdown search and live split editing preserve drafts and sanitize preview', async () => {
  await open('live.md', '# Heading\n\nneedle **needle**', 'text/markdown');
  await page.getByLabel('Find in Markdown').fill('needle');
  await expect(page.locator('mark.md-match')).toHaveCount(2);
  await page.getByLabel('Find in Markdown').fill('');
  await expect(page.locator('mark.md-match')).toHaveCount(0);
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit document text').fill('# Changed\n\n**live needle**<img src=x onerror=alert(1)>');
  await expect(page.locator('.live-edit-split .markdown-body strong')).toHaveText('live needle');
  await expect(page.locator('.live-edit-split [onerror]')).toHaveCount(0);
  await page.getByLabel('Find in Markdown').fill('needle');
  await expect(page.locator('mark.md-match')).toHaveCount(1);
  await open('inactive.md', '# Other', 'text/markdown');
  await page.locator('.file-tab[data-full-name="live.md"]').click();
  await expect(page.getByLabel('Edit document text')).toHaveValue('# Changed\n\n**live needle**<img src=x onerror=alert(1)>');
  await expect(page.locator('mark.md-match')).toHaveCount(1);
  await application.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response:1}); });
  await page.keyboard.press('Control+w');
});

test('large Markdown uses manual preview while text typing remains independent', async () => {
  await open('large-preview.md', '# Large\n' + ('content '.repeat(100) + '\n\n').repeat(180), 'text/markdown');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Live split', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh preview', exact: true })).toBeVisible();
  await page.getByLabel('Edit document text').evaluate(el => { el.value = '# Updated\n' + ('content '.repeat(100) + '\n\n').repeat(180); el.dispatchEvent(new Event('input')); });
  await expect(page.locator('.live-edit-split h1')).toHaveText('Large');
  await page.getByRole('button', { name: 'Refresh preview', exact: true }).click();
  await expect(page.locator('.live-edit-split h1')).toHaveText('Updated');
  await page.keyboard.press('Control+w');
});

test('native media above 256 MB streams by range and releases hidden playback source', async () => {
  const target = path.join(os.tmpdir(), `mv-stream-${Date.now()}.wav`);
  const size = 300 * 1024 * 1024;
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(size + 36,4); header.write('WAVEfmt ',8);
  header.writeUInt32LE(16,16); header.writeUInt16LE(1,20); header.writeUInt16LE(1,22);
  header.writeUInt32LE(8000,24); header.writeUInt32LE(16000,28); header.writeUInt16LE(2,32);
  header.writeUInt16LE(16,34); header.write('data',36); header.writeUInt32LE(size,40);
  const file = await fs.open(target,'w'); await file.write(header); await file.truncate(size+44); await file.close();
  try {
    await application.evaluate(({dialog}, target) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:[target]}); }, target);
    await page.locator('#btn-open-file').click();
    await expect.poll(() => page.locator('audio').evaluate(el=>el.readyState)).toBeGreaterThan(0);
    const url = await page.locator('audio').getAttribute('src'); expect(url).toMatch(/^viewer-media:/);
    const range = await application.evaluate(async ({net}, url) => {
      const response = await net.fetch(url,{headers:{Range:'bytes=0-43'}});
      return {status:response.status,length:(await response.arrayBuffer()).byteLength};
    },url);
    expect(range).toEqual({status:206,length:44});
    await page.locator('audio').evaluate(el=>{el.currentTime=20;el.playbackRate=1.5;});
    await open('stream-away.txt','away','text/plain');
    await page.locator('.file-tab').filter({has:page.locator('.tab-title[title="'+path.basename(target)+'"]')}).click();
    await expect.poll(()=>page.locator('audio').evaluate(el=>el.currentTime)).toBe(20);
    expect(await page.locator('audio').evaluate(el=>el.playbackRate)).toBe(1.5);
    await page.keyboard.press('Control+w');
    expect(await application.evaluate(async ({net},url)=>(await net.fetch(url)).status,url)).toBe(404);
    await expect.poll(async () => { try { await fs.unlink(target); return true; } catch { return false; } }).toBe(true);
  } finally { await fs.unlink(target).catch(() => {}); }
});

test('audio is decoded, playback speed is retained across tabs', async () => {
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
  await open('sound.wav', wav, 'audio/wav');
  await expect.poll(() => page.locator('audio').evaluate(el => el.readyState)).toBeGreaterThan(0);
  await page.getByText('1.5x', { exact: true }).click();
  await open('audio-switch.md', '# Audio switch', 'text/markdown');
  await expect(page.locator('#btn-samples-dropdown')).toHaveCount(0);
  await expect(page.locator('.markdown-body')).toBeVisible();
  await page.locator('.file-tab[data-full-name="sound.wav"]').click();
  expect(await page.locator('audio').evaluate(el => el.playbackRate)).toBe(1.5);
  await page.keyboard.press('Control+w');
  await expect(page.locator('.file-tab[data-full-name="sound.wav"]')).toHaveCount(0);
});
test.afterAll(async () => {
  await application?.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
  if (page && !page.isClosed() && originalStorage) {
    await page.evaluate(saved => {
      localStorage.clear();
      for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
    }, originalStorage);
  }
  await application?.close();
});

async function open(name, buffer, mimeType = 'application/octet-stream') {
  await page.locator('#file-picker-input').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });
  await expect(page.locator('#status-filename')).toHaveText(name);
}
test('JSON formatting and state survive tab switching', async () => {
  await open('config.json', '{"hello":"desktop"}', 'application/json');
  await page.getByText('Pretty JSON', { exact: true }).click();
  await expect(page.getByText('Compact JSON', { exact: true })).toBeVisible();
  await open('notes.txt', 'another document', 'text/plain');
  await page.locator('.file-tab[data-full-name="config.json"]').click();
  await expect(page.getByText('Compact JSON', { exact: true })).toBeVisible();
});
test('spreadsheet keeps late columns, filters and exports', async () => {
  const rows = Array.from({ length: 170 }, (_, i) => [`row ${i}`]);
  rows[160] = ['needle', 'late column'];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Data');
  await open('data.xlsx', XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  await expect(page.locator('.excel-col-header')).toHaveCount(2);
  await page.getByPlaceholder('Filter rows...').fill('needle');
  await expect(page.locator('.excel-grid tbody tr')).toHaveCount(1);
  await expect(page.locator('.excel-grid')).toContainText('late column');
  const target = path.join(os.tmpdir(), 'multiviewer-test-export.csv');
  await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
  await page.getByTitle('Export sheet to CSV').click();
  await expect.poll(async () => (await fs.readFile(target, 'utf8').catch(() => '')).includes('late column')).toBe(true);
  await fs.unlink(target);
});
test('Markdown and filenames cannot execute scripts', async () => {
  await open('unsafe.md', '# Safe heading\n<img src=x onerror="window.compromised=true">\n<script>window.compromised=true</script>\n[bad](javascript:alert(1))', 'text/markdown');
  await expect(page.locator('.markdown-body h1')).toHaveText('Safe heading');
  expect(await page.evaluate(() => window.compromised)).toBeUndefined();
  expect(await page.locator('.markdown-body [onerror], .markdown-body script, .markdown-body a[href^="javascript:"]').count()).toBe(0);
  await open('<img src=x onerror=alert(1)>.txt', 'literal filename', 'text/plain');
  await expect(page.locator('.tab-title').last()).toHaveAttribute('title', '<img src=x onerror=alert(1)>.txt');
  await expect(page.locator('.tab-title img')).toHaveCount(0);
});
test('ZIP nested images and text open with correct types', async () => {
  const zip = new JSZip();
  zip.file('inside.txt', 'nested text works');
  zip.file('picture.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64'));
  await open('nested.zip', await zip.generateAsync({ type: 'nodebuffer' }));
  await page.locator('.zip-table tr').filter({ hasText: 'inside.txt' }).getByText('View', { exact: true }).click();
  await expect(page.locator('.code-block')).toContainText('nested text works');
  await page.locator('.file-tab[data-full-name="nested.zip"]').click();
  await page.locator('.zip-table tr').filter({ hasText: 'picture.png' }).getByText('View', { exact: true }).click();
  await expect(page.locator('.image-toolbar .toolbar-badge')).toHaveText('1 × 1 px');
});
test('DOCX opens and rapid tab switching does not mix viewers', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Desktop Word document</w:t></w:r></w:p><w:sectPr/></w:body></w:document>');
  await open('letter.docx', await zip.generateAsync({ type: 'nodebuffer' }));
  await open('foreground.txt', 'foreground remains visible', 'text/plain');
  await expect(page.locator('.code-block')).toContainText('foreground remains visible');
  await page.locator('.file-tab[data-full-name="letter.docx"]').click();
  await expect(page.locator('.word-content-container')).toContainText('Desktop Word document');
});
test('PDF navigation, original download and tab return', async () => {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 6 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream'
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await open('pages.pdf', pdf, 'application/pdf');
  await expect(page.locator('#pdf-canvas')).toBeVisible();
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  const navBounds = await page.locator('.toolbar-nav-group').boundingBox();
  const previousBounds = await page.locator('#pdf-prev').boundingBox();
  const nextBounds = await page.locator('#pdf-next').boundingBox();
  expect(Math.abs(previousBounds.y - nextBounds.y)).toBeLessThan(1);
  expect(nextBounds.y + nextBounds.height).toBeLessThanOrEqual(navBounds.y + navBounds.height + 1);
  await expect(page.getByTitle('Previous page')).toBeDisabled();
  await page.getByTitle('Next page').click();
  await expect(page.locator('#pdf-page-input')).toHaveValue('2');
  await expect(page.getByTitle('Next page')).toBeDisabled();
  await page.locator('.pdf-viewer-wrapper').evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('#pdf-page-input')).toHaveValue('1');
  await page.locator('.pdf-viewer-wrapper').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('#pdf-page-input')).toHaveValue('2');
  await page.getByText('Fit Width', { exact: true }).click();
  expect(await page.locator('.pdf-viewer-wrapper').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.getByTitle('Zoom in', { exact: true }).click();
  await expect(page.locator('.pdf-page.rendered')).toHaveCount(2);
  await page.getByTitle('Previous page').click();
  await expect(page.locator('#pdf-page-input')).toHaveValue('1');
  await page.getByTitle('Next page').click();
  const target = path.join(os.tmpdir(), 'multiviewer-test-export.pdf');
  await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, target);
  await page.getByTitle('Download PDF').click();
  await expect.poll(async () => (await fs.readFile(target).catch(() => Buffer.from(''))).toString()).toBe(pdf);
  await fs.unlink(target);
  const pdfCanvases = await page.locator('.pdf-page-canvas').elementHandles();
  await open('pdf-other.txt', 'switch away', 'text/plain');
  for (const canvas of pdfCanvases) {
    await expect.poll(() => canvas.evaluate(el => el.width * el.height)).toBe(0);
  }
  await page.locator('.file-tab[data-full-name="pages.pdf"]').click();
  await expect(page.locator('#pdf-page-input')).toHaveValue('2');
  await expect(page.locator('.pdf-page.rendered')).toHaveCount(2);
  await application.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.print = async (_options, callback) => {
      global.printedPages = await win.webContents.executeJavaScript("document.querySelectorAll('.pdf-print-pages img').length");
      callback(true);
    };
  });
  await page.getByTitle('Print PDF').click();
  await expect.poll(() => application.evaluate(() => global.printedPages)).toBe(2);
});
test('code search reuses its view, preserves syntax and clears matches', async () => {
  await open('search.py', 'def calculation(value):\n    return value + 10', 'text/plain');
  const firstLine = await page.locator('.code-line').first().elementHandle();
  await expect(page.locator('.hljs-keyword').first()).toHaveText('def');
  const input = page.locator('.toolbar-search input');
  await input.fill('value');
  await expect(page.locator('.code-line.has-match')).toHaveCount(2);
  await expect(page.locator('mark.search-match')).toHaveCount(2);
  expect(await firstLine.evaluate(el => el.isConnected)).toBe(true);
  await input.fill('calculation');
  await expect(page.locator('.code-line.has-match')).toHaveCount(1);
  await input.fill('');
  await expect(page.locator('mark.search-match')).toHaveCount(0);
  await expect(page.locator('.hljs-keyword').first()).toHaveText('def');
  await open('fenced.md', '```py\ndef example():\n    return 1\n```', 'text/markdown');
  await expect(page.locator('.markdown-body .hljs-keyword').first()).toHaveText('def');
});

test('oversized PDF pages keep screen canvases within the memory budget', async () => {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 6000 6000] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await open('large-page.pdf', pdf, 'application/pdf');
  await expect(page.locator('.pdf-page.rendered')).toHaveCount(1);
  const pixels = await page.locator('.pdf-page-canvas').evaluate(canvas => canvas.width * canvas.height);
  expect(pixels).toBeGreaterThan(0);
  expect(pixels).toBeLessThanOrEqual(8_000_000);
  await page.keyboard.press('Control+w');
});

test('Python lines are compact and indentation is preserved', async () => {
  await open('spacing.py', 'def example():\n    value = 42\n    return value\n\nexample()', 'text/plain');
  const rows = page.locator('.code-line');
  await expect(rows).toHaveCount(5);
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  expect(second.y - first.y).toBeLessThan(25);
  expect(second.y - first.y).toBeGreaterThan(15);
  await expect(page.locator('.line-code').nth(1)).toHaveText('    value = 42', { useInnerText: false });
});
test('left panel can be dragged, resized with keyboard and its width persists', async () => {
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,850));
  if (await page.locator('#app-sidebar').evaluate(el => el.classList.contains('collapsed'))) {
    await page.locator('#btn-toggle-sidebar').click();
  }
  const handle = page.locator('#sidebar-resize-handle');
  await expect.poll(async () => Math.round((await page.locator('#app-sidebar').boundingBox()).width)).toBe(Number(await handle.getAttribute('aria-valuenow')));
  const bounds = await page.locator('#app-sidebar').boundingBox();
  await page.mouse.move(bounds.x + bounds.width, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 360, bounds.y + 180, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await page.locator('#app-sidebar').boundingBox()).width)).toBe(360);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '340');
  await page.reload();
  await page.waitForSelector('#btn-hero-browse');
  await expect.poll(async () => Math.round((await page.locator('#app-sidebar').boundingBox()).width)).toBe(340);
});
test('window name and About show viewer version, GitHub and support information', async () => {
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())).toBe('OmniView');
  const about = await application.evaluate(async ({ Menu, dialog }) => {
    let captured;
    const original = dialog.showMessageBox;
    dialog.showMessageBox = async (_window, options) => { captured = options; return { response: 0 }; };
    const help = Menu.getApplicationMenu().items.find(item => item.label === 'Help');
    help.submenu.items[0].click();
    dialog.showMessageBox = original;
    return captured;
  });
  expect(about.message).toBe(`OmniView ${require('../../package.json').version}`);
  expect(about.detail).toContain('GitHub');
  expect(about.detail).toContain('https://github.com/4Raisan/OmniView');
  expect(about.detail).toContain('star');
  const links = await application.evaluate(({Menu,shell}) => {
    const captured=[]; const original=shell.openExternal;
    shell.openExternal=async url=>{captured.push(url);};
    try {
      const help=Menu.getApplicationMenu().items.find(item=>item.label==='Help');
      help.submenu.items[1].click(); help.submenu.items[2].click();
      return captured;
    } finally { shell.openExternal=original; }
  });
  expect(links).toEqual(['https://github.com/4Raisan/OmniView','https://github.com/4Raisan/OmniView/discussions/5']);
});
test('native file events, theme, close and error recovery', async () => {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('open-file', { name: 'native.txt', bytes: Buffer.from('native open works') }));
  await expect(page.locator('.code-block')).toContainText('native open works');
  const previousTheme = await page.locator('html').getAttribute('data-theme');
  await page.locator('#btn-toggle-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', previousTheme === 'dark' ? 'light' : 'dark');
  await open('broken.pdf', 'not a PDF', 'application/pdf');
  await expect(page.locator('.viewer-error')).toContainText('Failed to open PDF');
  await page.keyboard.press('Control+w');
  await expect(page.locator('#status-filename')).toHaveText('native.txt');
});

test('five additional dark themes are distinct, selectable and remembered', async () => {
  await expect(page.locator('.app-brand')).toHaveCount(0);
  const colors = new Set();
  for (const theme of ['dark', 'midnight', 'graphite', 'forest', 'violet', 'ember']) {
    await page.getByLabel('Theme', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    colors.add(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  }
  expect(colors.size).toBe(6);
  await page.reload();
  await expect(page.getByLabel('Theme', { exact: true })).toHaveValue('ember');
  await page.locator('#btn-toggle-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#btn-toggle-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
});

test('text editing preserves UTF-8 BOM and CRLF, draft tabs and safe close', async () => {
  const target = path.join(os.tmpdir(), `mv-edit-${Date.now()}.py`);
  await fs.writeFile(target, '\uFEFFprint("old")\r\n');
  await page.locator('#file-picker-input').setInputFiles(target);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit document text').fill('print("héllo")\n');
  await expect(page.locator('.edit-state')).toHaveText('Unsaved');
  await open('other-edit.txt', 'another tab', 'text/plain');
  await page.locator('.file-tab').filter({ has: page.locator('.tab-title[title="' + path.basename(target) + '"]') }).click();
  await expect(page.getByLabel('Edit document text')).toHaveValue('print("héllo")\n');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.code-block')).toContainText('héllo');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await fs.readFile(target)).toString()).toBe('\uFEFFprint("héllo")\r\n');
  await expect(page.locator('.edit-state')).toHaveText('');
  await page.getByLabel('Edit document text').fill('unsaved');
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2 }); });
  await page.keyboard.press('F5');
  await expect(page.getByLabel('Edit document text')).toHaveValue('unsaved');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.getByLabel('Edit document text')).toHaveValue('unsaved');
  await page.keyboard.press('Control+w');
  await expect(page.getByLabel('Edit document text')).toHaveValue('unsaved');
  await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
  await page.keyboard.press('Control+w');
  await expect(page.locator('#status-filename')).toHaveText('other-edit.txt');
  expect((await fs.readFile(target)).toString()).toBe('\uFEFFprint("héllo")\r\n');
});

test('editing detects external changes and retains drafts through cancelled Save As', async () => {
  const target = path.join(os.tmpdir(), `mv-conflict-${Date.now()}.txt`);
  const output = target + '.saved.txt';
  await fs.writeFile(target, 'original');
  await page.locator('#file-picker-input').setInputFiles(target);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Edit document text').fill('my edits');
  await fs.writeFile(target, 'external edits');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.edit-error')).toContainText('changed outside');
  expect(await fs.readFile(target, 'utf8')).toBe('external edits');
  await application.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await expect(page.locator('.edit-state')).toHaveText('Unsaved');
  await application.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, output);
  await page.getByRole('button', { name: 'Save As', exact: true }).click();
  await expect.poll(() => fs.readFile(output, 'utf8').catch(() => '')).toBe('my edits');
  await expect(page.locator('.edit-state')).toHaveText('');
});

test('editing excludes oversized and non-UTF8 files', async () => {
  await open('too-large.txt', 'a'.repeat(2 * 1024 * 1024 + 1), 'text/plain');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
  await open('invalid-encoding.txt', Buffer.from([0xff, 0xfe, 65, 0]), 'text/plain');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
});

test('font size changes text only and persists after refresh', async () => {
  await open('font.py', 'print("hello")', 'text/plain');
  await page.getByLabel('Font size', { exact: true }).selectOption('1');
  const before = await page.locator('.code-block').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const zoom = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  await page.getByLabel('Font size', { exact: true }).selectOption('1.5');
  expect(await page.locator('.code-block').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(before * 1.5);
  expect(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(zoom);
  await page.reload();
  await expect(page.getByLabel('Font size', { exact: true })).toHaveValue('1.5');
  await page.getByLabel('Font size', { exact: true }).selectOption('1');
});

test('compact tabs retain icons and ten filename characters only on overflow', async () => {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
  await open('width-check-document.txt', 'width check', 'text/plain');
  await expect(page.locator('#header-tabs-list')).not.toHaveClass(/compact-tabs/);
  for (let i = 0; i < 12; i++) await open(`width-check-long-name-${i}.txt`, 'text', 'text/plain');
  await expect(page.locator('#header-tabs-list')).toHaveClass(/compact-tabs/);
  const widths = await page.locator('.file-tab').last().evaluate(el => ({ normal: Number(el.dataset.normalWidth), actual: el.getBoundingClientRect().width }));
  expect(widths.actual).toBeLessThan(widths.normal);
  await expect(page.locator('.file-tab').last().locator('.tab-title')).toHaveText('width-chec…');
  await expect(page.locator('.file-tab').last().locator('.tab-icon')).toBeVisible();
  for (let i = 0; i < 12; i++) await page.keyboard.press('Control+w');
  await expect(page.locator('#header-tabs-list')).not.toHaveClass(/compact-tabs/);
});

test('overflow tabs remain reachable at a narrow window', async () => {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 700));
  await page.getByLabel('Font size', { exact: true }).selectOption('1.5');
  for (let i = 0; i < 18; i++) await open(`overflow-document-${i}.txt`, `content ${i}`, 'text/plain');
  await expect(page.locator('#tab-picker')).toHaveCount(0);
  const before = await page.locator('#header-tabs-list').evaluate(el => el.scrollLeft);
  await page.getByLabel('Scroll tabs left').click();
  expect(await page.locator('#header-tabs-list').evaluate(el => el.scrollLeft)).toBeLessThan(before);
  for (let i = 0; i < 60 && await page.locator('#header-tabs-list').evaluate(el => el.scrollLeft > 0); i++) await page.getByLabel('Scroll tabs left').click();
  await expect(page.locator('.file-tab').first()).toBeInViewport();
  await page.locator('.file-tab').first().click();
  await page.locator('.file-tab').last().click();
  await expect(page.locator('#status-filename')).toHaveText('overflow-document-17.txt');
  await expect(page.locator('.file-tab.active')).toBeInViewport();
  const right = await page.locator('.header-right').boundingBox();
  expect(right.x + right.width).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  await page.getByLabel('Scroll tabs left').click();
  await page.getByLabel('Scroll tabs right').click();
  await page.getByLabel('Font size', { exact: true }).selectOption('1');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
});

test('copy uses selected text without line numbers, and otherwise the full document', async () => {
  await page.evaluate(() => {
    window.savedWriteText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = async text => { window.copiedText = text; };
  });
  try {
    await open('selection.txt', 'alpha hello\n    beta world\nlast', 'text/plain');
    await expect(page.locator('.line-code')).toHaveCount(3);
    await page.evaluate(() => {
      const lines = document.querySelectorAll('.line-code');
      window.getSelection().setBaseAndExtent(lines[1].firstChild, 8, lines[0].firstChild, 6);
    });
    await page.getByTitle('Copy selected text, or all text', { exact: true }).click();
    await expect(page.locator('.document-copy')).toHaveClass(/selection-ready/);
    expect(await page.evaluate(() => window.copiedText)).toBe('hello\n    beta');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.getByTitle('Copy selected text, or all text', { exact: true }).click();
    expect(await page.evaluate(() => window.copiedText)).toBe('alpha hello\n    beta world\nlast');
    await open('selection.md', '# Heading\n\n**hello** world', 'text/markdown');
    await expect(page.locator('.markdown-body strong')).toHaveText('hello');
    await page.evaluate(() => {
      const node = document.querySelector('.markdown-body strong').firstChild;
      window.getSelection().setBaseAndExtent(node, 0, node, 5);
    });
    await page.getByTitle('Copy selected text, or raw Markdown', { exact: true }).click();
    expect(await page.evaluate(() => window.copiedText)).toBe('hello');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.getByTitle('Copy selected text, or raw Markdown', { exact: true }).click();
    expect(await page.evaluate(() => window.copiedText)).toBe('# Heading\n\n**hello** world');
  } finally {
    await page.evaluate(() => { navigator.clipboard.writeText = window.savedWriteText; });
  }
});

test('recent files keep 25 real paths and reopen changed files after refresh and restart', async () => {
  await page.locator('#btn-clear-recent').click();
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'multiviewer-recent-'));
  const targets = Array.from({ length: 26 }, (_, i) => path.join(folder, `recent-${i}.txt`));
  await Promise.all(targets.map((target, i) => fs.writeFile(target, `original ${i}`)));
  await application.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, targets);
  await page.locator('#btn-open-file').click();
  await expect(page.locator('#status-filename')).toHaveText('recent-25.txt');
  await expect(page.locator('.recent-file-item')).toHaveCount(25);
  await fs.writeFile(targets[25], 'changed on disk');
  await page.reload();
  await expect(page.locator('.recent-file-item')).toHaveCount(25);
  await page.locator('.recent-file-item').filter({ hasText: 'recent-25.txt' }).click();
  await expect(page.locator('.code-block')).toContainText('changed on disk');
  await page.locator('#file-picker-input').setInputFiles(targets[23]);
  await expect(page.locator('#status-filename')).toHaveText('recent-23.txt');
  await expect(page.locator('.recent-file-item').first()).toContainText('recent-23.txt');
  await page.locator('.recent-file-item').filter({ hasText: 'recent-25.txt' }).click();
  await expect(page.locator('.file-tab[data-full-name="recent-25.txt"]')).toHaveCount(1);
  await expect(page.locator('.file-tab')).toHaveCount(2);
  await application.close();
  application = await electron.launch(process.env.MULTIVIEWER_EXECUTABLE
    ? { executablePath: process.env.MULTIVIEWER_EXECUTABLE, args: [...ciArgs, `--user-data-dir=${testProfile}`] }
    : { args: [path.join(__dirname, '..', '..', 'app', 'electron', 'main.cjs'), ...ciArgs, `--user-data-dir=${testProfile}`] });
  page = await application.firstWindow();
  await expect(page.locator('.recent-file-item')).toHaveCount(25);
  await fs.unlink(targets[24]);
  await page.reload();
  await expect(page.locator('.recent-file-item').filter({ hasText: 'recent-24.txt' })).toContainText('Moved or deleted');
  await page.locator('.recent-file-item').filter({ hasText: 'recent-25.txt' }).click();
  await expect(page.locator('.code-block')).toContainText('changed on disk');
  await page.locator('#btn-clear-recent').click();
  await page.reload();
  await expect(page.locator('.recent-file-item')).toHaveCount(0);
});

test('a file passed on startup opens after the renderer is ready', async () => {
  const filePath = path.join(os.tmpdir(), 'multi viewer startup check.txt');
  await fs.writeFile(filePath, 'Opened directly from Windows file arguments');
  await application.close();
  application = await electron.launch(process.env.MULTIVIEWER_EXECUTABLE
    ? { executablePath: process.env.MULTIVIEWER_EXECUTABLE, args: [...ciArgs, require('node:url').pathToFileURL(filePath).href, `--user-data-dir=${testProfile}`] }
    : { args: [path.join(__dirname, '..', '..', 'app', 'electron', 'main.cjs'), ...ciArgs, require('node:url').pathToFileURL(filePath).href, `--user-data-dir=${testProfile}`] });
  page = await application.firstWindow();
  await expect(page.locator('#status-filename')).toHaveText('multi viewer startup check.txt');
  await expect(page.locator('.code-block')).toContainText('Opened directly from Windows file arguments');
  await fs.unlink(filePath);
});

test('native file-open event delivers a document to the existing window', async () => {
  const target = path.join(os.tmpdir(), `omniview-os-open-${Date.now()}.txt`);
  await fs.writeFile(target, 'Opened through the OS file event');
  try {
    await application.evaluate(({app}, target) => app.emit('open-file', { preventDefault() {} }, target), target);
    await expect(page.locator('.code-block')).toContainText('Opened through the OS file event');
  } finally { await fs.unlink(target); }
});

test('Linux keeps filenames with different case as separate documents', async () => {
  test.skip(process.platform !== 'linux', 'Case-sensitive Linux filesystem check');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'omniview-case-'));
  const upper = path.join(folder, 'Notes.txt'), lower = path.join(folder, 'notes.txt');
  await fs.writeFile(upper, 'Uppercase document');
  await fs.writeFile(lower, 'Lowercase document');
  try {
    await application.evaluate(({dialog}, files) => { dialog.showOpenDialog = async () => ({canceled:false,filePaths:files}); }, [upper, lower]);
    await page.locator('#btn-open-file').click();
    await expect(page.locator('.file-tab[data-full-name="Notes.txt"]')).toHaveCount(1);
    await expect(page.locator('.file-tab[data-full-name="notes.txt"]')).toHaveCount(1);
    await page.locator('.file-tab[data-full-name="Notes.txt"]').click();
    await expect(page.locator('.code-block')).toContainText('Uppercase document');
    await page.locator('.file-tab[data-full-name="notes.txt"]').click();
    await expect(page.locator('.code-block')).toContainText('Lowercase document');
  } finally { await fs.rm(folder, {recursive:true,force:true}); }
});

test('Mac Dock activation recreates the window after closing it', async () => {
  test.skip(process.platform !== 'darwin', 'Mac application lifecycle check');
  await application.evaluate(({BrowserWindow}) => { const win=BrowserWindow.getAllWindows()[0]; win.allowEditedClose=true; win.close(); });
  await expect.poll(() => application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)).toBe(0);
  await application.evaluate(({app}) => app.emit('activate'));
  page = await application.firstWindow();
  await expect(page.locator('#btn-hero-browse')).toBeVisible();
  await open('reopened.txt', 'Window reopened with the same desktop API', 'text/plain');
  await expect(page.locator('.code-block')).toContainText('Window reopened with the same desktop API');
});
