const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Sends a request to the main process to open a directory.
   * @param {string} path - The absolute path of the directory to open.
   */
  openDirectory: (path) => ipcRenderer.send('open-directory', path)
});