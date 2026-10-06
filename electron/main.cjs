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
    ipcMain.handle('clear-recents', async () => { recentFiles = [];  });
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
  });
  
}
