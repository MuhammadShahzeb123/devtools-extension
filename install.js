// install.js
'use strict';

const fs    = require('fs');
const path  = require('path');
const zlib  = require('zlib');
const { execSync } = require('child_process');

const root         = __dirname;
const hostDir      = path.join(root, 'host');
const iconsDir     = path.join(root, 'extension', 'icons');
const manifestPath = path.join(hostDir, 'com.cdpbridge.host.json');
const batPath      = path.join(hostDir, 'run-host.bat');
const extDir       = path.join(root, 'extension');

// ── 1. npm install ────────────────────────────────────────────────────────────
console.log('[1/4] Installing npm dependencies...');
execSync('npm install', { cwd: hostDir, stdio: 'inherit' });

// ── 2. Generate PNG icons ─────────────────────────────────────────────────────
console.log('[2/4] Generating icons...');

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t   = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function makePNG(size, r, g, b) {
  const sig  = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  const raw = Buffer.alloc(size * (1 + 3 * size));
  for (let y = 0; y < size; y++) {
    const base = y * (1 + 3 * size);
    raw[base] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      raw[base + 1 + x * 3]     = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(iconsDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(
    path.join(iconsDir, `icon${size}.png`),
    makePNG(size, 99, 102, 241)  // indigo #6366f1
  );
}

// ── 3. Update manifest path ───────────────────────────────────────────────────
console.log('[3/4] Updating native host manifest path...');
const manifest   = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.path    = batPath;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// ── 4. Write Windows registry key ────────────────────────────────────────────
console.log('[4/4] Writing registry key...');
const regKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.cdpbridge.host';
execSync(`reg add "${regKey}" /ve /t REG_SZ /d "${manifestPath}" /f`, { stdio: 'inherit' });

console.log(`
================================================================
 CDP Bridge — Installation Complete
================================================================

NEXT STEPS:

  1. Open  chrome://extensions  in Chrome
  2. Enable "Developer mode" (top-right toggle)
  3. Click "Load unpacked" and select:
       ${extDir}
  4. Copy the Extension ID shown under the extension name
  5. Edit:  ${manifestPath}
     Replace  REPLACE_WITH_EXTENSION_ID  with your Extension ID
  6. Click the reload icon (↺) on the extension card

  The bridge starts automatically when the extension loads.
  AI clients connect to:  ws://localhost:1232

================================================================
`);
