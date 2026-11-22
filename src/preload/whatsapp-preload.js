'use strict';

/**
 * Preload for the WhatsApp Web window.
 * Exposes exactly one API to the page: desktopNotify(payload).
 * nodeIntegration is OFF and contextIsolation is ON — the page can only
 * do what we explicitly allow.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopNotify', (payload) => {
  try {
    ipcRenderer.send('page:notification', payload);
  } catch {
    /* ignore */
  }
});
