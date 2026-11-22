# WhatsApp for Linux — Architecture & Build Documentation

This document explains **how the app works** and **how it was built**, including
the toolchain, the packaging pipeline, and the pitfalls we hit along the way.
It's aimed at anyone who wants to understand, audit, or extend the project.

---

## 1. What this app is

Meta provides no official Linux client and no legal way to speak WhatsApp's
protocol directly. The only viable approach (used by ZapZap, and by the
official WhatsApp desktop on other platforms) is:

> **Embed a real Chromium browser engine in a desktop window, point it at
> `https://web.whatsapp.com`, and wrap it with native desktop integration.**

That's exactly what this app does. The "chat" you see is WhatsApp's own web
client; the app adds everything that makes it *feel* like a native app:
persistent login, tray, native notifications, shortcuts, autostart, spell
check, downloads, settings — and full control over your local data.

---

## 2. How it works

### 2.1 Process model

```
┌────────────────────────────────────────────────────────────────────┐
│ MAIN PROCESS (src/main/index.js)                                    │
│                                                                     │
│  • BrowserWindow "WhatsApp"  ── loads web.whatsapp.com              │
│      - persistent session partition: persist:whatsapp               │
│      - preload: whatsapp-preload.js (exposes desktopNotify only)    │
│      - contextIsolation ON, nodeIntegration OFF                     │
│                                                                     │
│  • BrowserWindow "Settings" ── loads local settings.html            │
│      - preload: settings-preload.js (exposes settingsAPI)           │
│                                                                     │
│  • Tray, application Menu (shortcuts), native Notifications         │
│  • Download manager (will-download), single-instance lock           │
│  • IPC handlers: settings:get/set, clear-data, reload, open paths   │
│  • Local settings store: <userData>/settings.json (settings.js)     │
│  • Autostart entry: ~/.config/autostart/*.desktop (autostart.js)    │
└────────────────────────────────────────────────────────────────────┘
        ▲ ipc (invoke/handle, send)          ▲
        │                                     │
┌───────┴──────────────┐            ┌─────────┴─────────┐
│ WhatsApp Web page    │            │ Settings page     │
│ (renderer, isolated) │            │ (local, trusted)  │
└──────────────────────┘            └───────────────────┘
```

Key isolation choices:

- The WhatsApp Web page can only talk to the main process through the single
  `window.desktopNotify()` function bridged by `whatsapp-preload.js`
  (`contextBridge` + `ipcRenderer.send`). No Node.js, no filesystem, nothing
  else is reachable from the page.
- The settings window is a **local, trusted** HTML file with its own small
  `settingsAPI` bridge.

### 2.2 Login persistence & cached chats

- The window uses the session partition **`persist:whatsapp`**, which stores
  cookies, IndexedDB, service-worker cache, etc. under
  `~/.config/WhatsApp for Linux/whatsapp/` (the partition directory inside
  Electron's `userData`).
- Consequences:
  - **Scan the QR once** — the device pairing cookie persists across restarts.
  - **Fast startup** — recent chats/media are served from local cache, exactly
    like WhatsApp Web in a browser.
  - **Source of truth stays Meta's cloud** — on launch the app re-syncs;
    clearing the local folder logs you out but never deletes your real chats
    (they live on your phone / Meta's servers).
  - **Offline**: cached chats are briefly readable; sending/receiving needs
    internet.
- **Settings → "Clear all local data & sign out"** calls
  `session.clearData()` on that partition — one-click logout.

### 2.3 Browser identity (the v1.0.1 fix)

Electron's default User-Agent looks like:

```
... Chrome/148.0.0.0 Electron/45.4.1 Safari/537.36
```

Since **~November 2026, WhatsApp Web rejects any User-Agent carrying an extra
product token** (anything after the Chrome/Safari tokens, e.g. `Electron/…`,
`Edg/…`, app tokens) and shows the *"WhatsApp works with Google Chrome 100+"*
wall instead of the QR screen — even though the Chromium engine is modern.
Multiple Electron-based apps (T3 Code, Orca, Arbalete) hit the identical wall
and fixed it the same way.

The fix, in `applyBrowserIdentity()` (src/main/index.js):

```js
const CHROME_VERSION = process.versions.chrome;   // real bundled Chromium
const WHATSAPP_USER_AGENT =
  `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
  `Chrome/${CHROME_VERSION} Safari/537.36`;

session.fromPartition('persist:whatsapp').setUserAgent(WHATSAPP_USER_AGENT);
```

Notes:

- It runs **before the first navigation**, so the very first request already
  carries the Chrome-compatible identity.
- It keeps the **real** Chromium version (no version lying).
- It's set at **session scope** rather than per-host, because this app only
  ever talks to `web.whatsapp.com` — there are no other sites that would want
  the Electron identity.
- The UA is also printed to the terminal at startup and the Chromium version
  is shown in **Help → About** for diagnostics.

### 2.4 Notifications (two paths)

1. **Page → native (primary).** On `dom-ready` the main process injects a
   small script (`executeJavaScript`) that replaces the page's
   `window.Notification` class with a shim. When WhatsApp Web creates a web
   notification, the shim calls `window.desktopNotify({title, body})` →
   IPC → the main process shows a **native desktop notification** with the
   system message sound (`/usr/share/sounds/freedesktop/stereo/message.oga`,
   when present). Clicking it focuses the window.
2. **Title parsing (fallback).** WhatsApp Web prefixes the window title with
   the unread count: `(3) WhatsApp`. The main process watches
   `page-title-updated`; when the count increases while the window is hidden
   (tray) or minimized, it fires a generic "New message" notification —
   covering cases where the page doesn't emit a web notification. A 4-second
   guard prevents double-firing when both paths trigger.

While the window is focused, WhatsApp shows its normal in-app toasts and no
system notification is duplicated.

### 2.5 Tray & window lifecycle

- **Close-to-tray** (default): the window's `close` event is intercepted and
  converted to `hide()`. Disable in Settings.
- **Single-instance lock**: a second launch focuses the existing window.
- **Tray menu**: Show/hide · Settings · Quit. Double-click restores.
- **Icon in the overview / window list (v1.0.2 fix).** GNOME shows the icon
  from the installed `.desktop` file, matched to the window via
  `WM_CLASS` ↔ `StartupWMClass`. Electron's default WM_CLASS didn't always
  match, so GNOME fell back to a generic icon. The app now forces
  `app.commandLine.appendSwitch('class', 'whatsapp-for-linux')` before
  creating any window, which pins WM_CLASS to the same value the packaged
  `.desktop` entry uses (`syncDesktopName` + `desktopName`). A fresh install
  may still show the fallback until you log out and back in (GNOME's icon
  cache refreshes at login).
- If the tray could not be created (e.g. headless session), the app quits
  when the last window closes, like a normal app.
- **GNOME note**: GNOME Shell hides classic tray icons — enable the
  *AppIndicator and KStatusNotifierItem* extension. KDE shows the tray
  natively.

### 2.6 Downloads

`session('persist:whatsapp').on('will-download')` intercepts every file the
web page saves (photos, voice notes, documents):

1. Filename is sanitized (`path.basename`, illegal chars → `_`).
2. Destination: `~/Downloads/WhatsApp/<name>` (with ` (1)`, ` (2)` …
   deduplication), or a save dialog if *Ask where to save media* is on.
3. On completion, a native "Download complete" notification is shown.

### 2.7 Settings & autostart

- Settings live in **`~/.config/WhatsApp for Linux/settings.json`** — plain
  JSON, readable and hand-editable. Merged over defaults:
  `autostart`, `closeToTray`, `spellcheck`, `notifySound`, `downloadsAsk`.
- Applying a change has immediate side effects:
  - `spellcheck` → `session.setSpellCheckerLanguages(['en','en-IN'])`
  - `autostart` → writes/removes
    `~/.config/autostart/whatsapp-for-linux.desktop` (standard freedesktop
    autostart entry pointing at `process.execPath` — works for both the RPM
    install and an AppImage; no root, no third-party dependency).
- **Keyboard shortcuts** (application menu):
  `Ctrl+R` reload · `Ctrl+Shift+P` settings · `Ctrl+Shift+H` hide to tray ·
  `Ctrl+Shift+O` show window · `Ctrl+Q` quit · `Ctrl+Shift+I` devtools.

### 2.8 Security & privacy design

- **No telemetry, no analytics, no crash reporting, no auto-updater.** The
  only network traffic is to `web.whatsapp.com` (plus the system browser for
  external links you explicitly click).
- **Navigation is locked**: `will-navigate` blocks any URL outside
  `web.whatsapp.com`; `setWindowOpenHandler` denies new windows and sends
  external `http(s)` links to the system browser.
- **End-to-end encryption is WhatsApp's**, not the wrapper's: this machine is
  a *linked device*, exactly like official WhatsApp Web. The wrapper never
  sees message contents. (Metadata — who/when — still goes to Meta's
  servers; true of *any* WhatsApp client.)
- Everything is auditable: the entire app is a few hundred lines of readable
  JavaScript in this repo.

### 2.9 Where your data lives

| What | Where |
|---|---|
| WhatsApp session (cookies, IndexedDB, cache) | `~/.config/WhatsApp for Linux/whatsapp/` |
| Settings | `~/.config/WhatsApp for Linux/settings.json` |
| Downloaded media | `~/Downloads/WhatsApp/` |
| Autostart entry | `~/.config/autostart/whatsapp-for-linux.desktop` |
| App files (RPM) | `/opt/WhatsApp for Linux/` |

Remove **all** traces: `sudo dnf remove whatsapp-for-linux` (or delete the
AppImage) and delete `~/.config/WhatsApp for Linux/`.

---

## 3. How it was built

### 3.1 Toolchain

| Component | Version | Role |
|---|---|---|
| Node.js | ≥ 20 (CI: 22) | Runtime / build host |
| Electron | 45 | Bundled Chromium desktop runtime |
| electron-builder | 26 | Packaging (RPM, AppImage, icons, desktop file) |
| fpm (1.17, ruby) | auto-downloaded by electron-builder | Builds the RPM (needs system `rpmbuild`) |
| AppImage toolset | auto-downloaded by electron-builder | Builds the AppImage |
| sharp | 0.35 | Renders the SVG icon into PNGs |
| GitHub Actions | ubuntu-latest | CI: build + publish releases on tags |

### 3.2 Source layout

```
src/
  main/
    index.js          # window, identity, tray, menu, notifications,
                      # downloads, lifecycle, IPC wiring
    settings.js       # local JSON settings store + IPC handlers
    autostart.js      # ~/.config/autostart/*.desktop writer
  preload/
    whatsapp-preload.js   # page bridge: desktopNotify() only
    settings-preload.js   # settings-page bridge: settingsAPI
  renderer/
    settings.html       # local settings UI (dark, WhatsApp-styled)
    settings.js
build/
  icon-source.svg     # the icon, as SVG (edit this)
  icons/              # generated PNGs (committed so builds work anywhere)
tools/
  make-icons.js       # SVG → PNG via sharp (npm run icon)
.github/workflows/build.yml   # CI/CD
```

### 3.3 Icons

`build/icon-source.svg` (green gradient tile + white chat bubble + three
typing dots) is rendered by `tools/make-icons.js` into `build/icons/`
(`icon-16…512.png`, `icon.png`, `tray.png`). The PNGs are **committed** so a
build never depends on sharp being available; `npm run icon` regenerates them
after editing the SVG. electron-builder bundles them as `resources/icons/`
(`extraResources`) and uses `icon.png` for the RPM/AppImage/desktop entry.

### 3.4 Building locally (any Linux, including Fedora)

```bash
sudo dnf install nodejs npm git     # Fedora 40 → Node 20, Fedora 41+ → Node 22
npm install
npm start        # run from source
npm run dist     # → dist/WhatsApp-for-Linux-<ver>-x86_64.{rpm,AppImage}
```

What `npm run dist` actually does:

1. `npm run icon` — regenerates PNG icons.
2. `electron-builder --linux --publish never`:
   - downloads the Electron 45 binary (from GitHub releases),
   - packs the app into `dist/linux-unpacked/`,
   - **AppImage**: assembles with the downloaded AppImage toolset
     (linuxdeploy-based),
   - **RPM**: via the auto-downloaded **fpm** tool — which shells out to the
     system **`rpmbuild`** (so `rpm` and `xz-utils` must be installed:
     `sudo dnf install rpm xz` on Fedora),
   - `--publish never` stops electron-builder from trying to publish to a
     release provider itself (in CI it would fail without a token — the
     GitHub Release is created by the workflow instead).

### 3.5 CI/CD (GitHub Actions)

`.github/workflows/build.yml` — triggered by **`v*` tags** and manual
dispatch:

```
checkout → Node 22 (npm cache)
→ apt-get install rpm xz-utils          # rpmbuild for the RPM target
→ npm ci
→ npm run dist                          # RPM + AppImage
→ upload artifact (always downloadable from the run)
→ [tags only] softprops/action-gh-release → GitHub Release with both assets
```

Plus a self-diagnosis step: if the build fails, the tail of `build.log` is
posted to a new GitHub issue (the Actions log hosts weren't reachable from
every environment during development, so the workflow reports to a place that
is).

**Release flow used for this project:**

```bash
# bump "version" in package.json, commit, then:
git tag v1.0.1
git push origin v1.0.1        # CI builds both packages + publishes the release
```

### 3.6 Version history

| Version | Date | Notes |
|---|---|---|
| v1.0.0 | 2026-11-22 | Initial release: full feature set, RPM + AppImage, CI |
| v1.0.1 | 2026-11-22 | **Fix:** stock Chrome User-Agent (drop the `Electron/…` token) so WhatsApp Web no longer shows the "Chrome 100+" wall — see §2.3 |
| v1.0.2 | 2026-11-22 | **Fix:** pin `WM_CLASS` to `whatsapp-for-linux` (Chromium `--class` switch) so GNOME's overview/window-list matches the installed `.desktop` entry and shows the app icon instead of a generic one — see §2.5 |

### 3.7 Pitfalls we hit (so you don't have to)

1. **WhatsApp Web's UA wall (Nov 2026).** Any extra product token in the
   User-Agent (Electron's included by default) → "update Chrome to 100+"
   wall, no QR. Fix: session-level stock Chrome UA with the real Chromium
   version (§2.3). Several other Electron apps shipped the same fix in
   Oct/Nov 2026.
2. **electron-builder 26 removed `build.linux.rpm`.** Per-format options moved
   to top-level keys: `build.rpm.packageName` (was
   `build.linux.rpm.name`). The old key fails schema validation with a
   cryptic `configuration.linux should be one of these: null`.
3. **RPM target needs system `rpmbuild`.** fpm is auto-downloaded, but it
   invokes the OS `rpmbuild` — install `rpm` + `xz-utils` on the build host
   (the CI workflow does `apt-get install rpm xz-utils`).
4. **Implicit publishing in CI.** electron-builder ≥ 24 detects CI and tries
   to publish automatically; without a token it fails *after* the artifacts
   are built. Always pass `--publish never` when the workflow creates the
   release itself.
5. **Artifact names cannot contain `/`.** Using `github.ref_name` (a branch
   name like `arena/…`) in `actions/upload-artifact` breaks — use a fixed
   name.
6. **GitHub expressions have no `replace()`.** Common mistake; use fixed
   strings or `format()`.
7. **GNOME tray.** Not an app bug, but users on Fedora/GNOME need the
   AppIndicator extension to see the tray icon.
8. **Electron binary downloads** go through `objects.githubusercontent.com`
   (GitHub's release CDN) — environments with restricted egress (e.g. this
   sandbox) can't fetch it; packaging had to run on GitHub Actions instead.

---

## 4. Extending the app (pointers)

- **New setting:** add a key to `DEFAULTS` in `src/main/settings.js`, a row in
  `src/renderer/settings.html` (the JS auto-binds any checkbox whose `id`
  matches a key), and apply it in `settings.js → apply()`.
- **New shortcut:** add an item to the menu template in `src/main/index.js`.
- **New tray action:** extend `createTray()`'s menu template.
- **Rebrand the icon:** edit `build/icon-source.svg`, run `npm run icon`.
- **Bump a release:** `package.json` version → tag → push.
