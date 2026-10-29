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
const { fileURLToPath } = require('node:url');
const isMac = process.platform === 'darwin';
const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value;
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

// Unsaved drafts survive a crash so the next launch can offer them back. They are keyed
// by a hash of the path, never the path itself, and are bounded in count and age because
// they hold document text on disk.
const MAX_DRAFTS = 20;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const draftsDirectory = () => path.join(app.getPath('userData'), 'drafts');
const draftFile = filePath => path.join(draftsDirectory(), digest(Buffer.from(pathKey(filePath))).slice(0, 32) + '.json');

async function readDraft(filePath) {
  try {
    const record = JSON.parse(await fs.readFile(draftFile(filePath), 'utf8'));
    return typeof record?.text === 'string' && typeof record.baseHash === 'string' ? record : null;
  } catch { return null; }
}

async function deleteDraft(filePath) {
  await fs.unlink(draftFile(filePath)).catch(() => {});
}

async function pruneDrafts() {
  let entries;
  try { entries = await fs.readdir(draftsDirectory(), { withFileTypes: true }); }
  catch { return; }
  const kept = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(draftsDirectory(), entry.name);
    // A rename interrupted by a crash leaves the temporary behind.
    if (entry.name.endsWith('.tmp')) { await fs.unlink(full).catch(() => {}); continue; }
    if (!entry.name.endsWith('.json')) continue;
    try { kept.push({ full, mtime: (await fs.stat(full)).mtimeMs }); } catch {}
  }
  kept.sort((a, b) => b.mtime - a.mtime);
  const cutoff = Date.now() - DRAFT_MAX_AGE_MS;
  for (const [index, draft] of kept.entries()) {
    if (index >= MAX_DRAFTS || draft.mtime < cutoff) await fs.unlink(draft.full).catch(() => {});
  }
}

const { version: viewerVersion } = require('../../package.json');
const { createUpdateChecker, RELEASE_PAGE } = require('./updates.cjs');
const checkUpdates = createUpdateChecker(viewerVersion);
const { readLegacyDoc } = require('./legacy-doc.cjs');
async function showUpdateCheck() {
  const result = await checkUpdates(true);
  const window = liveWindow();
  if (!window) return;
  window.webContents.send('update-status', result);
  const available = result.status === 'available';
  const answer = await dialog.showMessageBox(window, {
    type: 'info', title: 'OmniView updates',
    message: available ? `OmniView ${result.latestVersion} is available` : result.status === 'current' ? `OmniView ${viewerVersion} is up to date` : 'Could not check for updates',
    detail: available ? `You are using ${viewerVersion}. Download the new version from GitHub Releases.` : result.status === 'current' ? 'You have the latest published stable version.' : 'Check your connection and try again. You can keep using OmniView offline.',
    buttons: available ? ['View release', 'Later'] : ['OK'], cancelId: available ? 1 : 0
  });
  if (available && answer.response === 0) shell.openExternal(RELEASE_PAGE);
}
let mainWindow;
let rendererReady = false;
let desktopReady = false;
let quitRequested = false;
// On macOS the app outlives its window, so every menu and IPC entry point has to
// tolerate a null or destroyed window instead of dereferencing it.
const liveWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
function ensureWindow() {
  if (!liveWindow() && desktopReady) createWindow();
  return liveWindow();
}
function sendToRenderer(channel, ...args) {
  liveWindow()?.webContents.send(channel, ...args);
}
const trustedSender = event => Boolean(liveWindow()) && event.sender === mainWindow.webContents;
function handleTrusted(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event)) throw new Error('Blocked an unexpected IPC sender.');
    return listener(event, ...args);
  });
}
function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => { if (trustedSender(event)) listener(event, ...args); });
}
app.on('before-quit', () => { quitRequested = true; });
let pendingPaths = [];
const MAX_FILE_SIZE = 256 * 1024 * 1024;
const argumentFiles = argv => argv.filter(arg => !arg.startsWith('-')).map(arg => {
  try { return arg.startsWith('file://') ? fileURLToPath(arg) : arg; } catch { return ''; }
}).filter(arg => path.isAbsolute(arg) && path.resolve(arg) !== path.resolve(__filename) && !(process.platform === 'win32' && /\.exe$/i.test(arg)));

async function openPaths(paths) {
  const window = liveWindow();
  if (!window || !rendererReady) {
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
      const existing = recentFiles.find(item => pathKey(item.path) === pathKey(resolved));
      recentFiles = [{ id: existing?.id || randomUUID(), path: resolved, name: path.basename(resolved), size: stat.size },
        ...recentFiles.filter(item => pathKey(item.path) !== pathKey(resolved))].slice(0, 25);
      if (isMedia) {
        const mediaToken = randomUUID(); mediaFiles.set(mediaToken, resolved);
        window.webContents.send('open-media', { name: path.basename(resolved), size: stat.size, filePath: resolved, mediaToken, url: `viewer-media://${mediaToken}/media` });
        continue;
      }
      const bytes = await fs.readFile(filePath);
      const editToken = bytes.length <= 2 * 1024 * 1024 ? randomUUID() : null;
      if (editToken) editFiles.set(editToken, { path: resolved, hash: digest(bytes) });
      const record = editToken ? await readDraft(resolved) : null;
      const draft = record ? { text: record.text, savedAt: record.savedAt, stale: record.baseHash !== digest(bytes) } : null;
      window.webContents.send('open-file', { name: path.basename(filePath), bytes, filePath: resolved, editToken, draft });
    } catch (error) {
      dialog.showErrorBox('Could not open file', `${path.basename(filePath)}: ${error.message}`);
    }
  }
  // Persist once per batch; serial disk writes must not stall every file open.
  await saveHistory().catch(error => console.warn('Could not save file history:', error.message));
}

async function pickFiles() {
  const window = ensureWindow();
  if (!window) return;
  const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
  if (!result.canceled) await openPaths(result.filePaths);
}

function createWindow() {
  rendererReady = false;
    mainWindow = new BrowserWindow({
      width: 1280, height: 850, minWidth: 760, minHeight: 540,
      title: 'OmniView', icon: path.join(__dirname, '..', 'resources', 'app-icon.png'), backgroundColor: '#18181b',
      titleBarStyle: 'hidden',
      ...(isMac ? { titleBarOverlay: true, trafficLightPosition: { x: 12, y: 10 } } : { titleBarOverlay: { color: '#18181b', symbolColor: '#f4f4f5', height: 36 } }),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    mainWindow.setMenuBarVisibility(false);
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
    mainWindow.on('close', event => {
      if (!mainWindow.allowEditedClose) { event.preventDefault(); mainWindow.webContents.send('request-close'); }
    });
    mainWindow.webContents.on('will-prevent-unload', event => {
      if (mainWindow.allowEditedClose || mainWindow.allowEditedReload) { event.preventDefault(); mainWindow.allowEditedReload = false; }
      else mainWindow.webContents.send('request-reload');
    });
    mainWindow.webContents.on('did-start-loading', () => {
      rendererReady = false;
      for (const token of mediaFiles.keys()) releaseMedia(token);
      editFiles.clear();
    });
    mainWindow.webContents.on('did-finish-load', () => { mainWindow.allowEditedReload = false; });
    mainWindow.on('closed', () => {
      mainWindow = null; rendererReady = false;
      for (const token of mediaFiles.keys()) releaseMedia(token);
      editFiles.clear();
    });
    mainWindow.loadFile(entry);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  pendingPaths = argumentFiles(process.argv.slice(app.isPackaged ? 1 : 2));
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    ensureWindow();
    openPaths([filePath]);
  });
  app.on('activate', () => { ensureWindow(); });
  app.on('second-instance', (_event, argv) => {
    const window = ensureWindow();
    if (window?.isMinimized()) window.restore();
    window?.focus();
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
    onTrusted('show-menu', (_event, { name, x, y }) => {
      if (!['File', 'Edit', 'View', 'Help'].includes(name)) return;
      const window = liveWindow();
      if (!window) return;
      const submenu = Menu.getApplicationMenu()?.items.find(item => item.label === name)?.submenu;
      const zoom = window.webContents.getZoomFactor();
      const bounds = window.getContentBounds();
      submenu?.popup({ window, x: Math.max(0, Math.min(bounds.width - 1, Math.round((Number(x) || 0) * zoom))), y: Math.max(0, Math.min(bounds.height - 1, Math.round((Number(y) || 36) * zoom))) });
    });
    handleTrusted('pick-files', pickFiles);
    handleTrusted('read-legacy-doc', (_event, bytes) => readLegacyDoc(bytes));
    handleTrusted('check-updates', () => checkUpdates());
    handleTrusted('open-update-release', () => shell.openExternal(RELEASE_PAGE));
    handleTrusted('support-project', () => shell.openExternal('https://github.com/4Raisan/OmniView'));
    handleTrusted('recent-files', async () => Promise.all(recentFiles.map(async item => {
      try {
        const stat = await fs.stat(item.path);
        return { ...item, size: stat.size, missing: !stat.isFile() };
      } catch { return { ...item, missing: true }; }
    })));
    handleTrusted('open-recent', async (_event, id) => {
      const item = recentFiles.find(item => item.id === id);
      if (item) await openPaths([item.path]);
    });
    handleTrusted('clear-recents', async () => { recentFiles = []; await saveHistory(); });
    handleTrusted('open-dropped', async (_event, paths) => {
      if (!Array.isArray(paths) || paths.length > 100 || paths.some(value => typeof value !== 'string' || !path.isAbsolute(value))) throw new Error('Invalid dropped files');
      await openPaths(paths);
    });
    handleTrusted('fullscreen', () => {
      const window = liveWindow();
      if (window) window.setFullScreen(!window.isFullScreen());
    });
    handleTrusted('save-text', async (_event, { token, name, bytes, saveAs }) => {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 2 * 1024 * 1024) throw new Error('Editing is limited to 2 MB.');
      const original = editFiles.get(token);
      let target = original?.path;
      if (!target || saveAs) {
        const window = liveWindow();
        if (!window) return null;
        const result = await dialog.showSaveDialog(window, { defaultPath: target || path.basename(name) });
        if (result.canceled) return null;
        target = result.filePath;
      } else {
        const current = await fs.readFile(target);
        if (digest(current) !== original.hash) throw new Error('This file changed outside OmniView. Use Save As to keep both versions.');
      }
      if (original && pathKey(target) === pathKey(original.path)) {
        if (digest(await fs.readFile(target)) !== original.hash) throw new Error('This file changed outside OmniView. Choose a different Save As name.');
      }
      const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
      try {
        // Flush before rename: a rename alone can leave a zero-length file after power loss.
        // Windows needs a write-mode handle for FlushFileBuffers, so write and sync the same one.
        const temporaryHandle = await fs.open(temporary, 'wx');
        try { await temporaryHandle.writeFile(bytes); await temporaryHandle.sync(); }
        finally { await temporaryHandle.close(); }
        for (let attempt = 0; ; attempt++) {
          if (original && pathKey(target) === pathKey(original.path) && digest(await fs.readFile(target)) !== original.hash) {
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
      // A completed save supersedes any recovery copy, including one left against the
      // old name when Save As moved the document.
      await deleteDraft(target);
      if (original && pathKey(original.path) !== pathKey(target)) await deleteDraft(original.path);
      const existing = recentFiles.find(item => pathKey(item.path) === pathKey(target));
      recentFiles = [{ id: existing?.id || randomUUID(), path: target, name: path.basename(target), size: bytes.byteLength }, ...recentFiles.filter(item => pathKey(item.path) !== pathKey(target))].slice(0, 25);
      await saveHistory().catch(() => {});
      return { token: nextToken, path: target, name: path.basename(target) };
    });
    handleTrusted('confirm-edit-close', async (_event, name) => {
      const window = liveWindow();
      if (!window) return 2;
      return (await dialog.showMessageBox(window, {
        type: 'question', buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2,
        message: `Save changes to ${path.basename(name)}?`
      })).response;
    });
    onTrusted('release-edit-file', (_event, token) => editFiles.delete(token));
    handleTrusted('save-draft', async (_event, { token, text, bom, lineEnding }) => {
      const original = editFiles.get(token);
      if (!original) throw new Error('Unknown edit token.');
      if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new Error('Drafts are limited to 2 MB.');
      const target = draftFile(original.path);
      await fs.mkdir(draftsDirectory(), { recursive: true });
      const record = { baseHash: original.hash, text, bom: Boolean(bom), lineEnding: lineEnding === '\r\n' ? '\r\n' : '\n', savedAt: Date.now() };
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(record));
        await fs.rename(temporary, target);
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return true;
    });
    onTrusted('discard-draft', (_event, token) => {
      const original = editFiles.get(token);
      if (original) deleteDraft(original.path).catch(() => {});
    });
    onTrusted('release-media', (_event, token) => releaseMedia(token));
    onTrusted('allow-close', () => {
      const window = liveWindow();
      if (!window) return;
      window.allowEditedClose = true;
      if (quitRequested) app.quit(); else window.close();
    });
    onTrusted('cancel-close', () => { quitRequested = false; });
    onTrusted('allow-reload', () => {
      const window = liveWindow();
      if (!window) return;
      window.allowEditedReload = true; window.webContents.reload();
    });
    onTrusted('cancel-reload', () => { liveWindow()?.webContents.stop(); rendererReady = true; });
    handleTrusted('print', () => new Promise(resolve => {
      const window = liveWindow();
      if (!window) return resolve(false);
      window.webContents.print({ printBackground: true }, success => resolve(success));
    }));
    handleTrusted('save-file', async (_event, { name, bytes }) => {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_SIZE) throw new Error('Invalid export data.');
      const window = liveWindow();
      if (!window) return false;
      const result = await dialog.showSaveDialog(window, { defaultPath: path.basename(name) });
      if (result.canceled) return false;
      await fs.writeFile(result.filePath, Buffer.from(bytes));
      return true;
    });
    onTrusted('viewer-ready', () => {
      rendererReady = true;
      const paths = pendingPaths;
      pendingPaths = [];
      openPaths(paths);
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(isMac ? [{ label: 'OmniView', submenu: [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { label: 'File', submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: pickFiles },
        { label: 'Save text', accelerator: 'CmdOrCtrl+S', click: () => sendToRenderer('save-document', false) },
        { label: 'Save text as…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendToRenderer('save-document', true) },
        { label: 'Close document', accelerator: 'CmdOrCtrl+W', click: () => sendToRenderer('close-document') },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => sendToRenderer('print-document') },
        { type: 'separator' }, { role: 'quit' }
      ] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
      { label: 'Help', submenu: [
        { label: 'About OmniView', click: () => {
          const options = { title: 'OmniView', message: `OmniView ${viewerVersion}`, detail: 'Any File. One Viewer.\n\nhttps://github.com/4Raisan/OmniView\n\nIf OmniView helps you, star the repository to support the project.\nShare ideas and feedback in GitHub Discussions.\n\nView and edit supported files locally.' };
          const window = liveWindow();
          if (window) dialog.showMessageBox(window, options); else dialog.showMessageBox(options);
        } },
        { label: 'GitHub repository — star to support', click: () => shell.openExternal('https://github.com/4Raisan/OmniView') },
        { label: 'Discussions — ideas and feedback', click: () => shell.openExternal('https://github.com/4Raisan/OmniView/discussions/5') },
        { type: 'separator' }, { label: 'Check for updates…', click: showUpdateCheck }
      ] }
    ]));
    desktopReady = true;
    pruneDrafts().catch(() => {});
    createWindow();
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
