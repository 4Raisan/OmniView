const { app, BrowserWindow, dialog, ipcMain, Menu, shell, protocol } = require('electron');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const mediaFiles = new Map();
const mediaStreams = new Map();
function releaseMedia(token) {
  mediaFiles.delete(token);
  for (const stream of mediaStreams.get(token) || []) stream.destroy();
  mediaStreams.delete(token);
}
const MEDIA_EXTENSIONS = /\.(mp4|webm|ogv|mp3|wav|ogg|m4a|flac)$/i;
protocol.registerSchemesAsPrivileged([{ scheme: 'viewer-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const editFiles = new Map();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let recentFiles = [];
let recentWrite = Promise.resolve();
const historyPath = () => path.join(app.getPath('userData'), 'recent-files.json');
function saveHistory() {
  const snapshot = JSON.stringify(recentFiles);
  recentWrite = recentWrite.catch(() => {}).then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(historyPath() + '.tmp', snapshot);
    await fs.rename(historyPath() + '.tmp', historyPath());
  });
  return recentWrite;
}

const { version: viewerVersion } = require('../package.json');
let mainWindow;
let rendererReady = false;
let pendingPaths = [];
const MAX_FILE_SIZE = 256 * 1024 * 1024;
const argumentFiles = argv => argv.filter(arg => !arg.startsWith('-') && path.isAbsolute(arg) && !/\.exe$/i.test(arg));

async function openPaths(paths) {
  if (!mainWindow || !rendererReady) {
    pendingPaths.push(...paths);
    return;
  }
  for (const filePath of paths) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      const isMedia = MEDIA_EXTENSIONS.test(filePath);
      if (!isMedia && stat.size > MAX_FILE_SIZE) throw new Error('Documents larger than 256 MB are not supported.');
      const resolved = path.resolve(filePath);
      const existing = recentFiles.find(item => item.path.toLowerCase() === resolved.toLowerCase());
      recentFiles = [{ id: existing?.id || randomUUID(), path: resolved, name: path.basename(resolved), size: stat.size },
        ...recentFiles.filter(item => item.path.toLowerCase() !== resolved.toLowerCase())].slice(0, 25);
      await saveHistory().catch(error => console.warn('Could not save file history:', error.message));
      if (isMedia) {
        const mediaToken = randomUUID(); mediaFiles.set(mediaToken, resolved);
        mainWindow.webContents.send('open-media', { name: path.basename(resolved), size: stat.size, filePath: resolved, mediaToken, url: `viewer-media://${mediaToken}/media` });
        continue;
      }
      const bytes = await fs.readFile(filePath);
      const editToken = bytes.length <= 2 * 1024 * 1024 ? randomUUID() : null;
      if (editToken) editFiles.set(editToken, { path: resolved, hash: digest(bytes) });
      mainWindow.webContents.send('open-file', { name: path.basename(filePath), bytes, filePath: resolved, editToken });
    } catch (error) {
      dialog.showErrorBox('Could not open file', `${path.basename(filePath)}: ${error.message}`);
    }
  }
}

async function pickFiles() {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  if (!result.canceled) await openPaths(result.filePaths);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  pendingPaths = argumentFiles(process.argv.slice(app.isPackaged ? 1 : 2));
  app.on('second-instance', (_event, argv) => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
    openPaths(argumentFiles(argv.slice(1)));
  });
  app.whenReady().then(async () => {
    protocol.handle('viewer-media', async request => {
      const token = new URL(request.url).hostname;
      const target = mediaFiles.get(token);
      if (!target) return new Response('Not found', { status: 404 });
      try {
        const { size } = await fs.stat(target);
        const range = request.headers.get('range');
        let start = 0, end = size - 1;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
          start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
          if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        }
        const mime = { '.wav':'audio/wav', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.webm':'video/webm', '.ogv':'video/ogg', '.ogg':'audio/ogg', '.m4a':'audio/mp4', '.flac':'audio/flac' }[path.extname(target).toLowerCase()];
        const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
        if (size === 0) return new Response(null, { headers: { ...headers, 'Content-Length':'0' } });
        const stream = createReadStream(target, { start, end });
        const streams = mediaStreams.get(token) || new Set();
        streams.add(stream); mediaStreams.set(token, streams);
        const abort = () => stream.destroy();
        request.signal.addEventListener('abort', abort, { once:true });
        stream.on('close', () => {
          request.signal.removeEventListener('abort', abort); streams.delete(stream);
          if (!streams.size && mediaStreams.get(token) === streams) mediaStreams.delete(token);
        });
        return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers });
      } catch { return new Response('Media unavailable', { status:404 }); }
    });
    try {
      const saved = JSON.parse(await fs.readFile(historyPath(), 'utf8'));
      if (Array.isArray(saved)) recentFiles = saved.filter(item => typeof item.id === 'string' && typeof item.name === 'string' && typeof item.path === 'string' && path.isAbsolute(item.path)).slice(0, 25);
    } catch { /* A new install or invalid history starts empty. */ }
    mainWindow = new BrowserWindow({
      width: 1280, height: 850, minWidth: 760, minHeight: 540,
      title: 'OmniView', icon: path.join(__dirname, '..', 'resources', 'app-icon.png'), backgroundColor: '#18181b',
      titleBarStyle: 'hidden', titleBarOverlay: { color: '#18181b', symbolColor: '#f4f4f5', height: 36 },
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    mainWindow.setMenuBarVisibility(false);
    ipcMain.on('show-menu', (_event, { name, x, y }) => {
      if (!['File', 'Edit', 'View', 'Help'].includes(name)) return;
      const submenu = Menu.getApplicationMenu()?.items.find(item => item.label === name)?.submenu;
      const zoom = mainWindow.webContents.getZoomFactor();
      const bounds = mainWindow.getContentBounds();
      submenu?.popup({ window: mainWindow, x: Math.max(0, Math.min(bounds.width - 1, Math.round((Number(x) || 0) * zoom))), y: Math.max(0, Math.min(bounds.height - 1, Math.round((Number(y) || 36) * zoom))) });
    });
    mainWindow.on('page-title-updated', event => { event.preventDefault(); mainWindow.setTitle('OmniView'); });
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r'))) {
        event.preventDefault(); mainWindow.webContents.send('request-reload');
      }
      if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 's') {
        event.preventDefault(); mainWindow.webContents.send('save-document', input.shift);
      }
    });
    const entry = path.join(__dirname, '..', 'dist', 'index.html');
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    // Documents stay local: block external resources, including tracking images.
    mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /^https?:\/\//i.test(details.url) });
    });
    ipcMain.handle('pick-files', pickFiles);
    ipcMain.handle('recent-files', async () => Promise.all(recentFiles.map(async item => {
      try {
        const stat = await fs.stat(item.path);
        return { ...item, size: stat.size, missing: !stat.isFile() };
      } catch { return { ...item, missing: true }; }
    })));
    ipcMain.handle('open-recent', async (_event, id) => {
      const item = recentFiles.find(item => item.id === id);
      if (item) await openPaths([item.path]);
    });
    ipcMain.handle('clear-recents', async () => { recentFiles = []; await saveHistory(); });
    ipcMain.handle('open-dropped', async (_event, paths) => {
      if (!Array.isArray(paths) || paths.length > 100 || paths.some(value => typeof value !== 'string' || !path.isAbsolute(value))) throw new Error('Invalid dropped files');
      await openPaths(paths);
    });
    ipcMain.handle('fullscreen', () => mainWindow.setFullScreen(!mainWindow.isFullScreen()));
    ipcMain.handle('save-text', async (_event, { token, name, bytes, saveAs }) => {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 2 * 1024 * 1024) throw new Error('Editing is limited to 2 MB.');
      const original = editFiles.get(token);
      let target = original?.path;
      if (!target || saveAs) {
        const result = await dialog.showSaveDialog(mainWindow, { defaultPath: target || path.basename(name) });
        if (result.canceled) return null;
        target = result.filePath;
      } else {
        const current = await fs.readFile(target);
        if (digest(current) !== original.hash) throw new Error('This file changed outside OmniView. Use Save As to keep both versions.');
      }
      if (original && target.toLowerCase() === original.path.toLowerCase()) {
        if (digest(await fs.readFile(target)) !== original.hash) throw new Error('This file changed outside OmniView. Choose a different Save As name.');
      }
      const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx' });
        for (let attempt = 0; ; attempt++) {
          if (original && target.toLowerCase() === original.path.toLowerCase() && digest(await fs.readFile(target)) !== original.hash) {
            throw new Error('This file changed outside OmniView. Use a different Save As name.');
          }
          try { await fs.rename(temporary, target); break; }
          catch (error) {
            if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 5) throw error;
            await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
          }
        }
      } finally { await fs.unlink(temporary).catch(() => {}); }
      const nextToken = token || randomUUID();
      editFiles.set(nextToken, { path: target, hash: digest(bytes) });
      const existing = recentFiles.find(item => item.path.toLowerCase() === target.toLowerCase());
      recentFiles = [{ id: existing?.id || randomUUID(), path: target, name: path.basename(target), size: bytes.byteLength }, ...recentFiles.filter(item => item.path.toLowerCase() !== target.toLowerCase())].slice(0, 25);
      await saveHistory().catch(() => {});
      return { token: nextToken, path: target, name: path.basename(target) };
    });
    ipcMain.handle('confirm-edit-close', async (_event, name) => (await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2,
      message: `Save changes to ${path.basename(name)}?`
    })).response);
    ipcMain.on('release-edit-file', (_event, token) => editFiles.delete(token));
    ipcMain.on('release-media', (_event, token) => releaseMedia(token));
    mainWindow.on('close', event => {
      if (!mainWindow.allowEditedClose) { event.preventDefault(); mainWindow.webContents.send('request-close'); }
    });
    ipcMain.on('allow-close', () => { mainWindow.allowEditedClose = true; mainWindow.close(); });
    ipcMain.on('allow-reload', () => { mainWindow.allowEditedReload = true; mainWindow.webContents.reload(); });
    ipcMain.on('cancel-reload', () => { mainWindow.webContents.stop(); rendererReady = true; });
    mainWindow.webContents.on('will-prevent-unload', event => {
      if (mainWindow.allowEditedClose || mainWindow.allowEditedReload) { event.preventDefault(); mainWindow.allowEditedReload = false; }
      else mainWindow.webContents.send('request-reload');
    });
    ipcMain.handle('print', () => new Promise(resolve => mainWindow.webContents.print({ printBackground: true }, success => resolve(success))));
    ipcMain.handle('save-file', async (_event, { name, bytes }) => {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_SIZE) throw new Error('Invalid export data.');
      const result = await dialog.showSaveDialog(mainWindow, { defaultPath: path.basename(name) });
      if (result.canceled) return false;
      await fs.writeFile(result.filePath, Buffer.from(bytes));
      return true;
    });
    mainWindow.webContents.on('did-start-loading', () => {
      rendererReady = false;
      for (const token of mediaFiles.keys()) releaseMedia(token);
      editFiles.clear();
    });
    mainWindow.webContents.on('did-finish-load', () => { mainWindow.allowEditedReload = false; });
    ipcMain.on('viewer-ready', event => {
      if (event.sender !== mainWindow.webContents) return;
      rendererReady = true;
      const paths = pendingPaths;
      pendingPaths = [];
      openPaths(paths);
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'File', submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: pickFiles },
        { label: 'Save text', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('save-document', false) },
        { label: 'Save text as…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('save-document', true) },
        { label: 'Close document', accelerator: 'CmdOrCtrl+W', click: () => mainWindow.webContents.send('close-document') },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.send('print-document') },
        { type: 'separator' }, { role: 'quit' }
      ] },
      { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
      { label: 'Help', submenu: [
        { label: 'About OmniView', click: () => dialog.showMessageBox(mainWindow, { title: 'OmniView', message: `OmniView ${viewerVersion}`, detail: 'Any File. One Viewer.\n\nhttps://github.com/4Raisan/OmniView\n\nIf OmniView helps you, star the repository to support the project.\nShare ideas and feedback in GitHub Discussions.\n\nView and edit supported files locally.' }) },
        { label: 'GitHub repository — star to support', click: () => shell.openExternal('https://github.com/4Raisan/OmniView') },
        { label: 'Discussions — ideas and feedback', click: () => shell.openExternal('https://github.com/4Raisan/OmniView/discussions/5') }
      ] }
    ]));
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(entry);
  });
  app.on('window-all-closed', () => app.quit());
}
