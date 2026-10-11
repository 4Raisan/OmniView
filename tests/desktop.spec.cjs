const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const JSZip = require('jszip');
const XLSX = require('xlsx');

let application, page, originalStorage, testProfile;
test.beforeAll(async () => {
  testProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'multiviewer-test-profile-'));
  application = await electron.launch(process.env.MULTIVIEWER_EXECUTABLE
    ? { executablePath: process.env.MULTIVIEWER_EXECUTABLE, args: [`--user-data-dir=${testProfile}`] }
    : { args: [path.join(__dirname, '..', 'electron', 'main.cjs'), `--user-data-dir=${testProfile}`] });
  page = await application.firstWindow();
  await page.waitForSelector('#btn-hero-browse');
  originalStorage = await page.evaluate(() => ({ ...localStorage }));
});
test('title and menus share one row and open the native application menu', async () => {
  expect(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMenuBarVisible())).toBe(false);
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
































