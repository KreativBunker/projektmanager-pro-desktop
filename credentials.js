const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('./store');

const credentialsPath = path.join(app.getPath('userData'), 'credentials.bin');

// Den (nicht geheimen) Login-Namen im Klartext-Store spiegeln. So können
// Abläufe, die nur den Namen benötigen, ihn ohne safeStorage/Schlüsselbund
// lesen – das vermeidet den macOS-Passwortdialog im Alltag.
function mirrorAuthorLogin(username) {
  try { store.set('authorLogin', typeof username === 'string' ? username : ''); } catch (_) {}
}

function isAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

function saveCredentials(creds) {
  if (!creds || typeof creds.username !== 'string' || typeof creds.password !== 'string') {
    return false;
  }
  if (!isAvailable()) return false;

  const payload = JSON.stringify({ username: creds.username, password: creds.password });
  const encrypted = safeStorage.encryptString(payload);
  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fs.writeFileSync(credentialsPath, encrypted);
  mirrorAuthorLogin(creds.username);
  return true;
}

function getCredentials() {
  if (!isAvailable()) return null;
  if (!fs.existsSync(credentialsPath)) return null;
  try {
    const encrypted = fs.readFileSync(credentialsPath);
    const decrypted = safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(decrypted);
    if (typeof parsed.username === 'string' && typeof parsed.password === 'string') {
      mirrorAuthorLogin(parsed.username); // Klartext-Spiegel aktuell halten
      return parsed;
    }
  } catch (_) {}
  return null;
}

// Login-Name ohne safeStorage/Schlüsselbund. Wird beim Speichern der
// Zugangsdaten bzw. beim (ohnehin nötigen) Entschlüsseln zum Auto-Login
// befüllt – siehe mirrorAuthorLogin.
function getAuthorLogin() {
  try {
    const v = store.get('authorLogin');
    return typeof v === 'string' ? v : '';
  } catch (_) {
    return '';
  }
}

function clearCredentials() {
  try {
    if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
  } catch (_) {}
  mirrorAuthorLogin('');
  return true;
}

function hasCredentials() {
  return fs.existsSync(credentialsPath);
}

module.exports = { saveCredentials, getCredentials, getAuthorLogin, clearCredentials, hasCredentials, isAvailable };
