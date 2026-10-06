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
  
}


