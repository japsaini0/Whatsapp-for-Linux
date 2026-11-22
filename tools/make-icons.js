'use strict';

/**
 * Renders build/icon-source.svg into the PNG icons used by the app
 * (app icon for the window/RPM/AppImage, and the system-tray icon).
 *
 * Usage: npm run icon   (or: node tools/make-icons.js)
 */

const fs = require('node:fs');
const path = require('node:path');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('sharp is not installed. Run `npm install` first.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'build', 'icon-source.svg');
const OUT_DIR = path.join(ROOT, 'build', 'icons');

const SIZES = [16, 22, 32, 48, 64, 128, 256, 512];

(async () => {
  const svg = fs.readFileSync(SVG_PATH);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(path.join(OUT_DIR, `icon-${size}.png`));
  }

  // Canonical icon used by electron-builder for RPM/AppImage
  await sharp(Buffer.from(svg))
    .resize(512, 512)
    .png()
    .toFile(path.join(OUT_DIR, 'icon.png'));

  // System tray icon (kept small + crisp)
  await sharp(Buffer.from(svg))
    .resize(22, 22)
    .png()
    .toFile(path.join(OUT_DIR, 'tray.png'));

  console.log('Icons written to build/icons/');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
