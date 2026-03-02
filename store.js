const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const configPath = path.join(app.getPath('userData'), 'config.json');

const defaults = {
  siteUrl: '',
  downloadPath: app.getPath('downloads'),
  synologyDrivePath: '',
  openFilesLocally: true,
  notificationsEnabled: true,
  notificationSoundEnabled: true,
  windowBounds: { width: 1280, height: 800 }
};

function load() {
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return { ...defaults, ...data };
    }
  } catch (_) {}
  return { ...defaults };
}

function save(data) {
  const current = load();
  const merged = { ...current, ...data };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  save({ [key]: value });
}

module.exports = { load, save, get, set, defaults };
