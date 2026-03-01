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

  // Windows ICO (256x256 PNG as base – electron-builder handles conversion)
  // For a proper .ico we need to convert; sharp can output to PNG which
  // electron-builder will convert automatically if icon.png exists
  console.log('');
  console.log('Icons erfolgreich generiert!');
  console.log('');
  console.log('Hinweis: electron-builder konvertiert icon.png automatisch');
  console.log('in .ico (Windows) und .icns (macOS) beim Build.');
}

generate().catch((err) => {
  console.error('Fehler bei Icon-Generierung:', err.message);
  process.exit(1);
});
