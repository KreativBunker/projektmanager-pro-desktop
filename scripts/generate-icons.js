#!/usr/bin/env node
/**
 * Icon-Generator für ProjektManager Pro Desktop App.
 *
 * Erzeugt alle benötigten Icon-Dateien aus dem SVG-Quellbild:
 *   - build/icon.png        (512x512 – für electron-builder)
 *   - build/icon.ico         (256x256 – Windows)
 *   - build/icon.icns        (wird von electron-builder aus PNGs erzeugt)
 *   - build/icons/16x16.png  (Linux)
 *   - build/icons/32x32.png
 *   - build/icons/48x48.png
 *   - build/icons/64x64.png
 *   - build/icons/128x128.png
 *   - build/icons/256x256.png
 *   - build/icons/512x512.png
 *   - assets/icon.png        (für Laufzeit-Icon)
 *
 * Benötigt: npm install --save-dev sharp
 * Nutzung:  node scripts/generate-icons.js
 */

const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];

async function generate() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.log('');
    console.log('  sharp ist nicht installiert.');
    console.log('  Bitte zuerst ausführen: npm install --save-dev sharp');
    console.log('');
    console.log('  Alternativ: Legen Sie manuell folgende Dateien an:');
    console.log('    - build/icon.png   (512x512)');
    console.log('    - assets/icon.png  (512x512)');
    console.log('');
    process.exit(0);
  }

  const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
  if (!fs.existsSync(svgPath)) {
    console.error('SVG-Quelldatei nicht gefunden: ' + svgPath);
    process.exit(1);
  }

  const svgBuffer = fs.readFileSync(svgPath);

  // Ensure directories exist
  const buildDir = path.join(__dirname, '..', 'build');
  const iconsDir = path.join(buildDir, 'icons');
  const assetsDir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(iconsDir, { recursive: true });

  console.log('Generiere Icons...');

  // Generate all sizes for Linux/build
  for (const size of sizes) {
    const outPath = path.join(iconsDir, `${size}x${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
    console.log(`  ${size}x${size}.png`);
  }

  // Main build icon (512x512)
  const buildIcon = path.join(buildDir, 'icon.png');
  fs.copyFileSync(path.join(iconsDir, '512x512.png'), buildIcon);
  console.log('  build/icon.png (512x512)');

  // Runtime icon
  const runtimeIcon = path.join(assetsDir, 'icon.png');
  fs.copyFileSync(path.join(iconsDir, '512x512.png'), runtimeIcon);
  console.log('  assets/icon.png (512x512)');

  // Windows ICO – create a multi-resolution .ico with embedded PNGs
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];
  for (const size of icoSizes) {
    const pngBuf = await sharp(svgBuffer).resize(size, size).png().toBuffer();
    pngBuffers.push({ size, buf: pngBuf });
  }

  const imageCount = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * imageCount;
  let dataOffset = headerSize + dirSize;

  // ICO header: reserved (2), type=1 (2), count (2)
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // type: 1 = ICO
  header.writeUInt16LE(imageCount, 4); // number of images

  // Directory entries
  const dirEntries = Buffer.alloc(dirSize);
  let currentOffset = dataOffset;
  for (let i = 0; i < imageCount; i++) {
    const { size: s, buf } = pngBuffers[i];
    const offset = i * dirEntrySize;
    dirEntries.writeUInt8(s < 256 ? s : 0, offset);       // width (0 = 256)
    dirEntries.writeUInt8(s < 256 ? s : 0, offset + 1);   // height (0 = 256)
    dirEntries.writeUInt8(0, offset + 2);                  // color palette
    dirEntries.writeUInt8(0, offset + 3);                  // reserved
    dirEntries.writeUInt16LE(1, offset + 4);               // color planes
    dirEntries.writeUInt16LE(32, offset + 6);              // bits per pixel
    dirEntries.writeUInt32LE(buf.length, offset + 8);      // image data size
    dirEntries.writeUInt32LE(currentOffset, offset + 12);  // image data offset
    currentOffset += buf.length;
  }

  const icoBuffer = Buffer.concat([header, dirEntries, ...pngBuffers.map(p => p.buf)]);
  const icoPath = path.join(buildDir, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('  build/icon.ico (multi-resolution)');

  console.log('');
  console.log('Icons erfolgreich generiert!');
}

generate().catch((err) => {
  console.error('Fehler bei Icon-Generierung:', err.message);
  process.exit(1);
});
