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














