'use strict';

/**
 * Preload for the local settings window (trusted local file only).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  clearData: () => ipcRenderer.invoke('settings:clear-data'),
  reload: () => ipcRenderer.invoke('app:reload'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  openDownloads: () => ipcRenderer.invoke('app:open-downloads'),
});
