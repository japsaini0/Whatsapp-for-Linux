'use strict';

/**
 * Local-only settings store + IPC handlers.
 * Settings live in <userData>/settings.json — nothing leaves the machine.
 */

const { app, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PARTITION = 'persist:whatsapp';

const DEFAULTS = {
  autostart: false,
  closeToTray: true,
  spellcheck: true,
  notifySound: true,
  downloadsAsk: false,
};

let current = { ...DEFAULTS };
let deps = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    current = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    current = { ...DEFAULTS };
  }
  return current;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(current, null, 2));
  } catch {
    /* ignore write errors (read-only fs etc.) */
  }
}

function apply(key, value) {
  if (key === 'autostart' && deps && deps.setAutostart) {
    try {
      deps.setAutostart(value);
    } catch {
      /* ignore */
    }
  }
  if (key === 'spellcheck') {
    try {
      session.fromPartition(PARTITION).setSpellCheckerLanguages(
        value ? ['en', 'en-IN'] : []
      );
    } catch {
      /* ignore */
    }
  }
}

function register(d) {
  deps = d || {};
  load();

  ipcMain.handle('settings:get', () => ({
    ...current,
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    downloadsDir: app.getPath('downloads'),
  }));

  ipcMain.handle('settings:set', (_e, key, value) => {
    if (!(key in DEFAULTS)) return { ...current };
    current[key] = !!value;
    persist();
    apply(key, current[key]);
    return { ...current };
  });

  // Signs the user out of WhatsApp Web on this machine (deletes cookies,
  // IndexedDB, cache for the persistent partition).
  ipcMain.handle('settings:clear-data', async () => {
    try {
      await session.fromPartition(PARTITION).clearData();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle('app:reload', () => {
    const w = deps.getMainWindow && deps.getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.reload();
    return true;
  });

  ipcMain.handle('app:open-data-dir', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('app:open-downloads', () => shell.openPath(app.getPath('downloads')));

  return { ...current };
}

function get(key) {
  return current[key];
}

module.exports = { register, get };
