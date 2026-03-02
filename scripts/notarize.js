// ============================================================
// ProjektManager Pro – macOS Notarization (afterSign Hook)
// Wird automatisch nach dem Code-Signing durch electron-builder aufgerufen
// ============================================================

const { notarize } = require('@electron/notarize');
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Nur auf macOS notarisieren
  if (electronPlatformName !== 'darwin') {
    console.log('Notarisierung übersprungen – kein macOS-Build.');
    return;
  }

  // Prüfe ob Notarisierungs-Credentials vorhanden sind
  if (!process.env.APPLE_ID || !process.env.APPLE_TEAM_ID) {
    console.log('Notarisierung übersprungen – APPLE_ID oder APPLE_TEAM_ID nicht gesetzt.');
    console.log('Setze folgende Umgebungsvariablen für die Notarisierung:');
    console.log('  APPLE_ID           – Deine Apple-ID (E-Mail)');
    console.log('  APPLE_ID_PASSWORD  – App-spezifisches Passwort');
    console.log('  APPLE_TEAM_ID      – Team-ID aus dem Apple Developer Portal');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Notarisiere ${appName}...`);

  await notarize({
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });

  console.log(`Notarisierung erfolgreich: ${appName}`);
};
