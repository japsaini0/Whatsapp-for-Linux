'use strict';

/* Settings window logic. Talks to the main process only via window.settingsAPI. */

const api = window.settingsAPI;
const STATUS_KEYS = ['autostart', 'closeToTray', 'spellcheck', 'notifySound', 'downloadsAsk'];

function status(text) {
  const el = document.getElementById('status');
  el.textContent = text || '';
  if (text) setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 4000);
}

async function init() {
  let s;
  try {
    s = await api.get();
  } catch (e) {
    status('Could not load settings: ' + e);
    return;
  }

  document.getElementById('version').textContent = s.version;
  document.getElementById('dataDir').textContent = s.dataDir;

  for (const key of STATUS_KEYS) {
    const el = document.getElementById(key);
    el.checked = !!s[key];
    el.addEventListener('change', async () => {
      const before = el.checked;
      await api.set(key, before);
      if (el.checked !== before) {
        el.checked = before;
        status('Could not save “' + key + '”');
      } else if (key === 'autostart') {
        status(before ? 'Will start at next login.' : 'Autostart disabled.');
      }
    });
  }

  document.getElementById('reload').addEventListener('click', async () => {
    status('Reloading WhatsApp…');
    await api.reload();
  });

  document.getElementById('clearData').addEventListener('click', async () => {
    const ok = window.confirm(
      'This signs you out of WhatsApp on this computer and deletes the locally ' +
      'cached session and media.\n\nYour chats on your phone are NOT affected — ' +
      'you will just need to scan the QR code again here.\n\nContinue?'
    );
    if (!ok) return;
    const res = await api.clearData();
    if (res && res.ok) {
      status('Local data cleared. Reload WhatsApp and scan the QR code again.');
      setTimeout(() => api.reload(), 800);
    } else {
      status('Clearing data failed: ' + (res && res.error ? res.error : 'unknown error'));
    }
  });

  document.getElementById('openDataDir').addEventListener('click', () => api.openDataDir());
  document.getElementById('openDownloads').addEventListener('click', () => api.openDownloads());
}

init();
