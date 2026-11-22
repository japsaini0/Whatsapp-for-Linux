'use strict';

/**
 * WhatsApp for Linux — main process
 *
 * Loads WhatsApp Web (web.whatsapp.com) inside an Electron window with a
 * persistent session, and wraps it with native desktop features:
 * system tray, native notifications, keyboard shortcuts, autostart,
 * spell check, download handling and a local-only settings store.
 *
 * Privacy: no telemetry, no analytics, no external calls other than the
 * WhatsApp Web page itself. All data stays in the user's config directory.
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  nativeImage,
  nativeTheme,
  session,
  shell,
  dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const settings = require('./settings');
const autostart = require('./autostart');

const WHATSAPP_URL = 'https://web.whatsapp.com/';
const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';
const REPO_URL = 'https://github.com/japsaini0/Whatsapp-for-Linux';
const PARTITION = 'persist:whatsapp';

// ---------------------------------------------------------------------------
// Window class (WM_CLASS)
//
// GNOME's overview / window list picks the window icon from the installed
// .desktop file, matched via WM_CLASS ↔ StartupWMClass. The installed
// desktop entry (syncDesktopName) uses StartupWMClass=whatsapp-for-linux, so
// pin WM_CLASS to the same value — otherwise Electron's default class may not
// match and GNOME falls back to a generic/wrong icon.
// Must run before the app creates any window.
// ---------------------------------------------------------------------------

app.commandLine.appendSwitch('class', 'whatsapp-for-linux');

// ---------------------------------------------------------------------------
// Browser identity
//
// Since ~Nov 2026, WhatsApp Web rejects any User-Agent that carries an extra
// product token (such as Electron's default "Electron/45.4.1") and shows the
// "WhatsApp works with Google Chrome 100+" wall instead of the QR screen.
// We therefore present a stock Chrome User-Agent, keeping the *real* Chromium
// version that ships with this Electron build.
// ---------------------------------------------------------------------------

const CHROME_VERSION = process.versions.chrome; // e.g. "148.0.7778.179"
const WHATSAPP_USER_AGENT =
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_VERSION} Safari/537.36`;

function applyBrowserIdentity() {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(WHATSAPP_USER_AGENT);
  // Visible in the terminal when launched from a shell — handy for support.
  console.log(
    `[whatsapp-for-linux] Chromium ${CHROME_VERSION} · user agent:\n  ${WHATSAPP_USER_AGENT}`
  );
}

let mainWindow = null;
let settingsWindow = null;
let tray = null;
let isQuitting = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function iconFile(name) {
  const candidates = [
    path.join(process.resourcesPath, 'icons', name),
    path.join(__dirname, '..', '..', 'build', 'icons', name),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  focusMainWindow();
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

// ---------------------------------------------------------------------------
// Notifications (native, from the main process)
// ---------------------------------------------------------------------------

let lastPageNotifyAt = 0;
let lastUnread = 0;

function notify({ title, body }) {
  if (!Notification.isSupported()) return;
  try {
    const icon = iconFile('icon-256.png');
    const n = new Notification({
      title: title || 'WhatsApp',
      body: body || '',
      ...(icon ? { icon } : {}),
    });
    if (settings.get('notifySound')) {
      const sound = '/usr/share/sounds/freedesktop/stereo/message.oga';
      if (fs.existsSync(sound)) n.setSound([sound]);
    }
    n.on('click', focusMainWindow);
    n.show();
  } catch {
    /* never crash on notification errors */
  }
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

/**
 * Patches the page's Notification API so that WhatsApp Web's web
 * notifications become real native desktop notifications. Runs in the page
 * context via executeJavaScript (no nodeIntegration, no CSP changes).
 */
const NOTIFICATION_PATCH = `
(() => {
  if (window.__w4lNotifyPatched) return;
  window.__w4lNotifyPatched = true;
  class W4LNotification {
    constructor(title, options) {
      options = options || {};
      try {
        if (window.desktopNotify) {
          window.desktopNotify({ title: title || '', body: options.body || '' });
        }
      } catch (e) {}
    }
    close() {}
    static requestPermission() { return Promise.resolve('granted'); }
  }
  try { Object.defineProperty(W4LNotification, 'permission', { get: () => 'granted' }); } catch (e) {}
  try { Object.defineProperty(W4LNotification, 'maxActions', { get: () => 0 }); } catch (e) {}
  window.Notification = W4LNotification;
})();
`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    title: 'WhatsApp',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111b21' : '#f0f2f5',
    icon: iconFile('icon-256.png') || iconFile('icon.png'),
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, '..', 'preload', 'whatsapp-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: settings.get('spellcheck'),
      backgroundThrottling: false,
    },
  });

  const wc = mainWindow.webContents;

  // Relayer for web notifications created by the WhatsApp Web page.
  wc.on('dom-ready', () => {
    wc.executeJavaScript(NOTIFICATION_PATCH, true).catch(() => {});
  });

  // Fallback: detect new unread messages from the window title,
  // e.g. "(3) WhatsApp". Used when the page does not fire a web
  // notification (e.g. window hidden in the tray).
  wc.on('page-title-updated', (_e, title) => {
    const m = /^\((\d+)\)/.exec(title || '');
    const unread = m ? parseInt(m[1], 10) : 0;
    if (unread > lastUnread && Date.now() - lastPageNotifyAt > 4000) {
      const win = mainWindow;
      if (win && !win.isDestroyed() && (win.isMinimized() || !win.isVisible())) {
        const inc = unread - lastUnread;
        notify({
          title: 'New message',
          body: inc > 1 ? `${inc} new messages on WhatsApp` : 'New message on WhatsApp',
        });
      }
    }
    lastUnread = unread;
  });

  // Keep navigation inside WhatsApp Web.
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(WHATSAPP_ORIGIN)) e.preventDefault();
  });

  // Open external links in the system browser, never in a new Electron window.
  wc.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(WHATSAPP_ORIGIN)) {
      wc.loadURL(url);
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('ready-to-show', () => mainWindow.show());

  // Close-to-tray behavior.
  mainWindow.on('close', (e) => {
    if (!isQuitting && settings.get('closeToTray')) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(WHATSAPP_URL);
}

// ---------------------------------------------------------------------------
// Settings window
// ---------------------------------------------------------------------------

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: true,
    title: 'Settings — WhatsApp for Linux',
    autoHideMenuBar: true,
    icon: iconFile('icon-256.png') || iconFile('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

function registerDownloads() {
  const whatsSession = session.fromPartition(PARTITION);
  whatsSession.on('will-download', (_event, item) => {
    const rawName = item.getFilename() || '';
    const safeName =
      path.basename(rawName).replace(/[^\w.\-() ]+/g, '_').slice(0, 180) ||
      `whatsapp-media-${Date.now()}`;

    const destDir = path.join(app.getPath('downloads'), 'WhatsApp');
    let dest = null;

    if (settings.get('downloadsAsk')) {
      dest =
        dialog.showSaveDialogSync(mainWindow, {
          title: 'Save media',
          defaultPath: ensureUnique(destDir, safeName),
          filters: [{ name: 'All files', extensions: ['*'] }],
        }) || null;
      if (!dest) {
        item.cancel();
        return;
      }
    } else {
      dest = ensureUnique(destDir, safeName);
    }

    try {
      item.setSavePath(dest);
    } catch {
      item.cancel();
      return;
    }

    item.once('done', (_e, state) => {
      if (state === 'completed') {
        notify({ title: 'Download complete', body: path.basename(dest) });
      }
    });
  });
}

function ensureUnique(dir, file) {
  fs.mkdirSync(dir, { recursive: true });
  let p = path.join(dir, file);
  let i = 1;
  while (fs.existsSync(p)) {
    const dot = path.extname(file);
    const base = file.slice(0, file.length - dot.length);
    p = path.join(dir, `${base} (${i++})${dot}`);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function createTray() {
  const p = iconFile('tray.png') || iconFile('icon-256.png');
  if (!p) return;
  const image = nativeImage.createFromPath(p);
  if (image.isEmpty()) return;
  try {
    tray = new Tray(image);
    tray.setToolTip('WhatsApp for Linux');
    const menu = Menu.buildFromTemplate([
      {
        label: 'Show / hide WhatsApp',
        click: () =>
          mainWindow && mainWindow.isVisible() ? mainWindow.hide() : showMainWindow(),
      },
      { type: 'separator' },
      { label: 'Settings', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: quitApp },
    ]);
    tray.setContextMenu(menu);
    tray.on('double-click', showMainWindow);
  } catch {
    tray = null;
  }
}

// ---------------------------------------------------------------------------
// Application menu (keyboard shortcuts live here)
// ---------------------------------------------------------------------------

function buildAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Settings', accelerator: 'CmdOrCtrl+Shift+P', click: openSettings },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: quitApp },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'WhatsApp',
      submenu: [
        { label: 'Show window', accelerator: 'CmdOrCtrl+Shift+O', click: showMainWindow },
        {
          label: 'Hide to tray',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => mainWindow && mainWindow.hide(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Report an issue',
          click: () => shell.openExternal(`${REPO_URL}/issues`),
        },
        {
          label: 'About WhatsApp for Linux',
          click: () =>
            dialog.showMessageBox(mainWindow, {
              title: 'About',
              message: 'WhatsApp for Linux',
              detail:
                `Version ${app.getVersion()} · Chromium ${CHROME_VERSION}\n\n` +
                'WhatsApp Web in a native Linux desktop app.\n' +
                'No telemetry. Your data stays on this machine.\n\n' +
                `GitHub: ${REPO_URL}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    app.setName('WhatsApp for Linux');

    // Must run before the first navigation so the very first request to
    // web.whatsapp.com already carries the Chrome-compatible identity.
    applyBrowserIdentity();

    settings.register({
      getMainWindow: () => mainWindow,
      setAutostart: (enabled) => autostart.setEnabled(enabled, iconFile('icon-256.png')),
    });

    // Web notifications → native notifications.
    require('electron').ipcMain.on('page:notification', (_e, payload) => {
      lastPageNotifyAt = Date.now();
      if (payload && typeof payload === 'object') {
        notify({ title: payload.title, body: payload.body });
      }
    });

    registerDownloads();
    createWindow();
    createTray();
    buildAppMenu();

    app.on('activate', showMainWindow);
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  // On Linux we keep running in the tray; only quit when nothing is left
  // to anchor the app (no tray available, e.g. headless session).
  app.on('window-all-closed', () => {
    if (!tray) app.quit();
  });
}
