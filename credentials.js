const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const credentialsPath = path.join(app.getPath('userData'), 'credentials.bin');

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
      return parsed;
    }
  } catch (_) {}
  return null;
}

function clearCredentials() {
  try {
    if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
  } catch (_) {}
  return true;
}

function hasCredentials() {
  return fs.existsSync(credentialsPath);
}

module.exports = { saveCredentials, getCredentials, clearCredentials, hasCredentials, isAvailable };
