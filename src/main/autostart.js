'use strict';

/**
 * Autostart via a standard freedesktop autostart entry:
 *   ~/.config/autostart/whatsapp-for-linux.desktop
 *
 * Works on GNOME, KDE, XFCE and other freedesktop-compliant desktops.
 * No third-party dependency, no root required.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const FILENAME = 'whatsapp-for-linux.desktop';

function file() {
  return path.join(os.homedir(), '.config', 'autostart', FILENAME);
}

function isEnabled() {
  try {
    return fs.existsSync(file());
  } catch {
    return false;
  }
}

function setEnabled(enabled, iconPath) {
  const p = file();
  if (enabled) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=WhatsApp for Linux',
      'Comment=Start WhatsApp for Linux at login',
      `Exec=${process.execPath || ''}`,
      `Icon=${iconPath || ''}`,
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n');
    fs.writeFileSync(p, content);
  } else {
    try {
      fs.unlinkSync(p);
    } catch {
      /* already gone */
    }
  }
  return isEnabled();
}

module.exports = { isEnabled, setEnabled };
