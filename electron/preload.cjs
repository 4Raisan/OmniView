const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  showMenu: (name, x, y) => ipcRenderer.send('show-menu', { name, x, y }),
  openFiles: () => ipcRenderer.invoke('pick-files'),
  recentFiles: () => ipcRenderer.invoke('recent-files'),
  openRecent: id => ipcRenderer.invoke('open-recent', id),
  clearRecents: () => ipcRenderer.invoke('clear-recents'),
  openDropped: files => {
    const paths = Array.from(files).map(file => webUtils.getPathForFile(file));
    return paths.every(Boolean) ? ipcRenderer.invoke('open-dropped', paths).then(() => true) : Promise.resolve(false);
  },
  fullscreen: () => ipcRenderer.invoke('fullscreen'),
  print: () => ipcRenderer.invoke('print'),
  saveFile: (name, bytes) => ipcRenderer.invoke('save-file', { name, bytes }),
  confirmEditClose: name => ipcRenderer.invoke('confirm-edit-close', name),
  releaseEditFile: token => ipcRenderer.send('release-edit-file', token),
  releaseMedia: token => ipcRenderer.send('release-media', token),
  onMedia: callback => ipcRenderer.on('open-media', (_event, file) => callback(file)),
  allowClose: () => ipcRenderer.send('allow-close'),
  onRequestClose: callback => ipcRenderer.on('request-close', () => callback()),
  allowReload: () => ipcRenderer.send('allow-reload'),
  cancelReload: () => ipcRenderer.send('cancel-reload'),
  onRequestReload: callback => ipcRenderer.on('request-reload', () => callback()),
  onFile: callback => {
    ipcRenderer.on('open-file', (_event, file) => callback(file));
    ipcRenderer.send('viewer-ready');
  },
  onPrint: callback => ipcRenderer.on('print-document', () => callback()),
  onSave: callback => ipcRenderer.on('save-document', (_event, saveAs) => callback(saveAs)),
  onClose: callback => ipcRenderer.on('close-document', () => callback())
});
