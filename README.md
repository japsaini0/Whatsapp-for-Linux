# WhatsApp for Linux

A native-feeling WhatsApp desktop app for Linux. It runs **WhatsApp Web**
(`web.whatsapp.com`) inside a packaged Chromium (Electron) window and wraps it
with real desktop features: system tray, native notifications, keyboard
shortcuts, autostart, spell check, download handling and a local-only settings
store.

Built for **Fedora**, runs on most Linux distros (Ubuntu, Debian, Arch, openSUSE, …).

> **What this is / isn't:** there is no official Linux client from Meta and no
> legal way to speak WhatsApp's protocol directly. Like ZapZap and other
> "native" WhatsApp Linux apps, this embeds a real browser engine and loads
> WhatsApp Web inside a desktop window. You get WhatsApp's own web client —
> with full parity (chat, calls, video, stories, communities) — plus proper
> desktop integration and full control over your local data.

---

## Features

- ✅ Persistent login — scan the QR code **once**, stays logged in on this machine
- ✅ Fast startup with chats cached locally (same model as WhatsApp Web)
- ✅ System tray icon (close-to-tray by default)
- ✅ Native desktop notifications with sound (click notification → focus chat window)
- ✅ Keyboard shortcuts: `Ctrl+R` reload · `Ctrl+Shift+P` settings · `Ctrl+Shift+H` hide to tray · `Ctrl+Shift+O` show window · `Ctrl+Q` quit
- ✅ Start at login (optional, in Settings)
- ✅ Spell check for typed messages (optional)
- ✅ Media downloads saved to `~/Downloads/WhatsApp` (or ask every time)
- ✅ Settings window: toggle every behavior, reload, **clear all local data & sign out**
- ✅ External links open in your system browser (never in the app)
- ✅ RPM **and** AppImage packages, single-instance lock, auto-hide menu bar

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+R` | Reload WhatsApp Web (also picks up web updates) |
| `Ctrl+Shift+P` | Open settings |
| `Ctrl+Shift+H` | Hide window to tray |
| `Ctrl+Shift+O` | Show the WhatsApp window |
| `Ctrl+Q` | Quit the app |
| `Ctrl+Shift+I` | DevTools (for troubleshooting) |

## Install on Fedora

### Option A — RPM (recommended)

```bash
# from the folder containing the .rpm
sudo dnf install ./WhatsApp-for-Linux-1.0.0-x86_64.rpm
```

Then launch **WhatsApp for Linux** from the app menu.

Uninstall:

```bash
sudo dnf remove whatsapp-for-linux
```

### Option B — AppImage (portable, no install)

```bash
chmod +x WhatsApp-for-Linux-1.0.0-x86_64.AppImage
# optional: keep it somewhere permanent
mv WhatsApp-for-Linux-1.0.0-x86_64.AppImage ~/Applications/
~/Applications/WhatsApp-for-Linux-1.0.0-x86_64.AppImage
```

Tip: to get an app-menu entry, right-click the AppImage → *Add to applications*,
or drop a `.desktop` file in `~/.local/share/applications/` with
`Exec=/home/you/Applications/WhatsApp-for-Linux-1.0.0-x86_64.AppImage`.

If the AppImage refuses to start on a system without FUSE, run:

```bash
./WhatsApp-for-Linux-*.AppImage --appimage-extract-and-run
```

### First launch (both options)

1. Open the app — you'll see the WhatsApp QR code.
2. On your phone: **WhatsApp → Settings → Linked devices → Link a device**.
3. Scan the code. You're in — and you'll never need to scan again on this
   machine (until you clear local data or Meta asks for re-authentication).

### System tray note (GNOME on Fedora)

GNOME Shell hides classic tray icons. To see the tray icon:
open **Extensions** → enable **"AppIndicator and KStatusNotifierItem"**.
KDE Plasma shows the tray icon out of the box. Without a tray the app still
works fully — it just quits when you close the window (or disable
*Close to tray* in Settings).

### Where do I get the RPM / AppImage?

- **GitHub Releases** (this repo): each release tagged `v*` automatically builds
  both packages via GitHub Actions. Download the latest from
  <https://github.com/japsaini0/Whatsapp-for-Linux/releases>.
- **Build it yourself:** see *Building from source* below.

> 🔧 **For developers:** see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) —
> full breakdown of how the app works (process model, notifications, session
> persistence, the v1.0.1 user-agent fix) and how it was built (toolchain,
> packaging pipeline, CI/CD, pitfalls).

## How it works (in one paragraph)

The app is an Electron (Chromium) window pointed at `https://web.whatsapp.com`,
with a **persistent browser session** (`persist:whatsapp` partition). Cookies,
IndexedDB and the service-worker cache live in `~/.config/WhatsApp for Linux/`,
so your login survives restarts and chats load instantly from cache. A small
bridge relays the page's web notifications to native desktop notifications,
and everything else (menu, tray, settings, downloads) is standard Electron
desktop plumbing. WhatsApp's own end-to-end encryption is unchanged — the app
is a linked device, exactly like the official WhatsApp Web.

## Data & privacy

Since you built it, you control it:

- **No telemetry, no analytics, no crash reporting, no auto-updater.** The only
  network calls the app makes are to `web.whatsapp.com` (and your chosen
  external browser for links you click).
- **All local data stays on your machine:** session, cached chats and media in
  `~/.config/WhatsApp for Linux/`, settings in the same folder's `settings.json`.
  Clear everything with one click: *Settings → Clear all local data & sign out*.
- **Encryption is WhatsApp's, not the wrapper's:** messages are end-to-end
  encrypted between your phone and this device (it's a linked device, same as
  WhatsApp Web). The wrapper never sees message contents.
- **Metadata caveat (true of *any* WhatsApp client, including official):**
  *who* you message and *when* still goes through Meta's servers. No app can
  change that.
- **Audit it:** the whole app is this repo — a few hundred lines of readable
  JavaScript. No obfuscation, no bundled black boxes besides Chromium itself.

### Is my chat saved, or does it reload every time?

Both — same model as WhatsApp Web:

- **Login persists** across restarts (no re-scanning the QR).
- **Recent chats/media are cached locally**, so the app opens in a couple of
  seconds with your conversations already visible.
- **The source of truth is Meta's cloud.** On launch the app re-syncs with the
  server; deleting the local folder just logs you out — it never deletes your
  actual chats (which live on your phone / Meta's servers).
- **Offline:** you can briefly read cached chats, but sending/receiving needs
  an internet connection.

## Building from source (Fedora)

Prerequisites:

```bash
sudo dnf install nodejs npm git   # Fedora 40 ships Node 20, Fedora 41+ ships Node 22 — both work
```

Build:

```bash
git clone https://github.com/japsaini0/Whatsapp-for-Linux.git
cd Whatsapp-for-Linux
npm install
npm start          # run directly from source (great for development)
npm run dist       # build RPM + AppImage into dist/
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm start` | Run the app from source |
| `npm run dist` | Build **RPM + AppImage** into `dist/` |
| `npm run dist:rpm` | Build only the RPM |
| `npm run dist:appimage` | Build only the AppImage |
| `npm run icon` | Regenerate PNG icons from `build/icon-source.svg` |

To publish a new version: bump `version` in `package.json`, commit, then push
a tag — GitHub Actions builds both packages and attaches them to a release:

```bash
git tag v1.0.1
git push origin v1.0.1
```

## FAQ

**I see a "WhatsApp works with Google Chrome 100+" wall instead of the QR code.**
Since ~Nov 2026, WhatsApp Web rejects any User-Agent that carries an extra
product token (such as the `Electron/…` token Electron sends by default).
**v1.0.1 fixes this** by presenting a stock Chrome User-Agent with the real
bundled Chromium version. If you're on 1.0.0, update to 1.0.1 or newer.

**The overview / window list shows a different (generic) icon.**
GNOME picks that icon from the installed `.desktop` file, matched to the
window via WM_CLASS. **v1.0.2 fixes this** by pinning WM_CLASS to
`whatsapp-for-linux` so the match always succeeds. On a freshly installed
1.0.0/1.0.1, logging out and back in usually makes the correct icon appear
(GNOME refreshes its icon cache at login).

**Do calls and video work?** Yes — WhatsApp Web calls run over WebRTC in
Chromium, which handles them in the desktop window.

**My screen shows the QR code after an update / after weeks.** WhatsApp
periodically re-authenticates linked devices, or a big WhatsApp Web update
changed the session. Just scan again — your chat history is untouched.

**High RAM / battery usage.** Expected for a Chromium-based app (~200 MB RAM
active, less when hidden in the tray). That's the price of full WhatsApp Web
compatibility; a "lighter" WebKitGTK port would lose features (calls,
notifications reliability).

**Dark mode.** Follows your system theme automatically.

**Can I change the downloads folder?** Yes — *Settings → Ask where to save
media* to pick per download; default is `~/Downloads/WhatsApp`.

**GPU glitches (blank/flickering window)?** Launch with
`whatsapp-for-linux --disable-gpu` (RPM) or `./WhatsApp-for-Linux-*.AppImage
--disable-gpu` (AppImage).

## Project layout

```
src/
  main/
    index.js          # window, tray, notifications, menu, downloads, lifecycle
    settings.js       # settings store (local JSON) + IPC handlers
    autostart.js      # ~/.config/autostart/whatsapp-for-linux.desktop
  preload/
    whatsapp-preload.js   # exposes only desktopNotify() to the page
    settings-preload.js   # exposes settingsAPI to the settings window
  renderer/
    settings.html       # local settings UI (dark, WhatsApp-styled)
    settings.js
build/
  icon-source.svg     # icon source (edit + `npm run icon`)
  icons/              # generated PNGs (committed so builds work without sharp)
tools/
  make-icons.js
docs/
  ARCHITECTURE.md     # how it works + how it was built (developer docs)
.github/workflows/build.yml   # CI: RPM + AppImage on tags
```

## License

MIT — see [LICENSE](LICENSE). Not affiliated with or endorsed by Meta /
WhatsApp.
