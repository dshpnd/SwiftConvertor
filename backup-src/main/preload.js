const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getFilePath(file) {
    return webUtils.getPathForFile(file);
  },
  getFileInfo(filePath) {
    return ipcRenderer.invoke('get-file-info', filePath);
  },
  getOutputs(category, sourceExt) {
    return ipcRenderer.invoke('get-outputs', category, sourceExt);
  },
  getOutputsForMany(category, extensions) {
    return ipcRenderer.invoke('get-outputs-for-many', category, extensions);
  },
  getFilesInfo(filePaths) {
    return ipcRenderer.invoke('get-files-info', filePaths);
  },
  getQuality() {
    return ipcRenderer.invoke('get-quality');
  },
  onQualityChange(callback) {
    const listener = (_event, quality) => callback(quality);
    ipcRenderer.on('settings:quality', listener);
    return () => ipcRenderer.removeListener('settings:quality', listener);
  },
  showContextMenu() {
    return ipcRenderer.invoke('show-context-menu');
  },
  showInFolder(filePath) {
    return ipcRenderer.invoke('show-in-folder', filePath);
  },
  expandWindow() {
    return ipcRenderer.invoke('expand-window');
  },
  collapseWindow() {
    return ipcRenderer.invoke('collapse-window');
  },
  convert(filePath, targetExt) {
    return ipcRenderer.invoke('convert:run', filePath, targetExt);
  },
});
