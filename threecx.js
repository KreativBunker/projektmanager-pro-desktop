// ── 3CX-Integration ───────────────────────────────────────────
//
// Bettet den 3CX-Web-Client als unsichtbares Hintergrundfenster ein, damit die
// Telefonie immer mitläuft und eingeloggt bleibt. Beim Klingeln eines
// eingehenden Anrufs ruft 3CX (Funktion „Kontakt-URL öffnen") eine Sentinel-URL
//   http://pmp.local/incoming-call?phoneNumber=%CallerNumber%&displayName=%CallerDisplayName%
// auf. Diese wird hier IN-PROCESS abgefangen (nie wirklich geladen), die Nummer
// gegen die WordPress-REST-API abgeglichen, der Anruf protokolliert und ein
// natives Anrufer-Popup angezeigt.
//
// Free-Tier-Grenzen: nur EINGEHEND, nur beim KLINGELN, nur solange dieses
// Fenster (= die App) läuft. Keine Dauer/verpasst/ausgehend (das bräuchte 3CX PRO).

const { app, BrowserWindow, session, net, ipcMain, shell, screen } = require('electron');
const path = require('path');
const store = require('./store');
const credentials = require('./credentials');

const PARTITION_3CX = 'persist:3cx';
const SENTINEL_HOST = 'pmp.local';
const SENTINEL_PATH = '/incoming-call';

let phoneWindow = null;   // eingebetteter 3CX-Web-Client (versteckt)
let popupWindow = null;   // natives Anrufer-Popup
let popupTimer = null;
let quitting = false;
let initialized = false;

// Vom Hauptprozess injizierte Helfer
let helpers = {
  getIconPath: () => undefined,
  openInMainWindow: () => {},
};

app.on('before-quit', () => { quitting = true; });

// ── URL-Helfer ────────────────────────────────────────────────

function normalizeUrl(url) {
  if (!url) return '';
  let u = String(url).trim();
  if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u;
  return u;
}

function baseUrl() {
  const site = normalizeUrl(store.get('siteUrl'));
  return site.replace(/\/+$/, '');
}

function isSentinel(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.hostname === SENTINEL_HOST && u.pathname === SENTINEL_PATH;
  } catch (_) {
    return false;
  }
}

// ── REST-Aufrufe an WordPress ─────────────────────────────────

function apiRequest(method, pathName, query, body) {
  return new Promise((resolve, reject) => {
    const base = baseUrl();
    if (!base) return reject(new Error('siteUrl nicht konfiguriert'));

    let url = base + '/wp-json/pmp/v1' + pathName;
    if (query) {
      const qs = new URLSearchParams(query).toString();
      if (qs) url += '?' + qs;
    }

    const req = net.request({ method, url, redirect: 'follow' });
    req.setHeader('X-PMP-Api-Key', String(store.get('threecxApiKey') || ''));
    if (body) req.setHeader('Content-Type', 'application/json');

    let data = '';
    const timeout = setTimeout(() => { req.abort(); reject(new Error('Timeout')); }, 8000);

    req.on('response', (res) => {
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try { resolve(JSON.parse(data || '{}')); }
        catch (_) { resolve({}); }
      });
    });
    req.on('error', (err) => { clearTimeout(timeout); reject(err); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function apiLookup(phone) {
  return apiRequest('GET', '/caller-lookup', { phone });
}

function apiLog(payload) {
  return apiRequest('POST', '/call-log', null, payload);
}

// ── Eingehender Anruf ─────────────────────────────────────────

async function handleIncomingCall(rawUrl) {
  let phoneNumber = '', displayName = '';
  try {
    const u = new URL(rawUrl);
    phoneNumber = u.searchParams.get('phoneNumber') || '';
    displayName = u.searchParams.get('displayName') || '';
  } catch (_) { return; }

  if (!phoneNumber && !displayName) return;
  console.log('[3cx] Eingehender Anruf:', phoneNumber, displayName);

  let lookup = { found: false, matches: [] };
  try {
    lookup = await apiLookup(phoneNumber);
  } catch (err) {
    console.warn('[3cx] Lookup fehlgeschlagen:', err.message);
  }

  const matched = (lookup && lookup.found && lookup.matches && lookup.matches[0]) ? lookup.matches[0] : null;

  // Protokollierung. Server dedupliziert (gleiche Nummer im Zeitfenster) und
  // liefert die call_id zurück – auch wenn der Anruf auf mehreren PCs klingelt.
  let callId = null;
  let matchedProject = null;
  try {
    const res = await apiLog({
      phoneNumber,
      displayName,
      direction: 'in',
      matched_user_id: matched ? matched.customer_id : null,
    });
    if (res && res.call_id) {
      callId = res.call_id;
      matchedProject = res.matched_project_id || null;
    }
  } catch (err) {
    console.warn('[3cx] Log fehlgeschlagen:', err.message);
  }

  const createCustomerUrl = buildCreateCustomerUrl(phoneNumber);

  showCallerPopup({ phoneNumber, displayName, lookup, callId, matchedProject, createCustomerUrl });
}

// URL der Frontend-Kundenregistrierung mit vorbelegter Telefonnummer.
function buildCreateCustomerUrl(phoneNumber) {
  const base = baseUrl();
  if (!base) return '';
  return base + '/kundenregistrierung/?step=register&telefon=' + encodeURIComponent(phoneNumber || '');
}

// ── Anrufer-Popup ─────────────────────────────────────────────

function showCallerPopup(payload) {
  const W = 380, H = 420;
  const wa = screen.getPrimaryDisplay().workArea;

  if (!popupWindow || popupWindow.isDestroyed()) {
    popupWindow = new BrowserWindow({
      width: W,
      height: H,
      x: wa.x + wa.width - W - 20,
      y: wa.y + wa.height - H - 20,
      frame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      icon: helpers.getIconPath(),
      webPreferences: {
        preload: path.join(__dirname, 'caller-popup-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    popupWindow.loadFile(path.join(__dirname, 'caller-popup.html'));
    popupWindow.on('closed', () => { popupWindow = null; });
  }

  popupWindow.setAlwaysOnTop(true, 'screen-saver');

  const send = () => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('threecx:data', payload);
    }
  };
  if (popupWindow.webContents.isLoading()) {
    popupWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }

  popupWindow.showInactive();

  const secs = parseInt(store.get('threecxPopupSeconds'), 10) || 20;
  if (popupTimer) clearTimeout(popupTimer);
  popupTimer = setTimeout(() => {
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
  }, secs * 1000);
}

// ── Eingebettetes 3CX-Fenster ─────────────────────────────────

function configureMediaPermissions(ses, url) {
  let origin = '';
  try { origin = new URL(normalizeUrl(url)).origin; } catch (_) {}

  // Mikrofon nur erlauben, wenn Softphone-Audio aktiviert ist (vorbereitet, Default aus).
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowMedia = !!store.get('threecxAllowMedia');
    if (allowMedia && (permission === 'media' || permission === 'audioCapture')) {
      return callback(true);
    }
    return callback(false);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    const allowMedia = !!store.get('threecxAllowMedia');
    if (allowMedia && permission === 'media' && requestingOrigin === origin) return true;
    return false;
  });
}

function attachInterceptors(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (isSentinel(url)) {
      handleIncomingCall(url);
      return { action: 'deny' };
    }
    // Andere Fenster/Links des 3CX-Clients im Systembrowser öffnen.
    try { shell.openExternal(url); } catch (_) {}
    return { action: 'deny' };
  });

  const blockSentinel = (event, url) => {
    if (isSentinel(url)) {
      event.preventDefault();
      handleIncomingCall(url);
    }
  };
  wc.on('will-navigate', blockSentinel);
  wc.on('will-redirect', blockSentinel);
}

function createPhoneWindow() {
  const url = normalizeUrl(store.get('threecxUrl'));
  if (!url) return null;
  if (phoneWindow && !phoneWindow.isDestroyed()) return phoneWindow;

  const ses = session.fromPartition(PARTITION_3CX);
  configureMediaPermissions(ses, url);

  phoneWindow = new BrowserWindow({
    width: 420,
    height: 760,
    title: '3CX Telefon',
    icon: helpers.getIconPath(),
    show: false,
    webPreferences: {
      partition: PARTITION_3CX,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // Hintergrundfenster nicht drosseln (Signalisierung)
    },
  });

  // Schließen = nur verstecken, damit 3CX im Hintergrund weiterläuft.
  phoneWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      phoneWindow.hide();
    }
  });
  phoneWindow.on('closed', () => { phoneWindow = null; });

  attachInterceptors(phoneWindow.webContents);
  phoneWindow.setMenuBarVisibility(false);
  phoneWindow.loadURL(url);
  return phoneWindow;
}

function togglePhoneWindow() {
  if (!store.get('threecxEnabled')) return;
  if (!phoneWindow || phoneWindow.isDestroyed()) {
    const w = createPhoneWindow();
    if (w) w.show();
    return;
  }
  if (phoneWindow.isVisible()) {
    phoneWindow.hide();
  } else {
    phoneWindow.show();
    phoneWindow.focus();
  }
}

function isPhoneVisible() {
  return !!(phoneWindow && !phoneWindow.isDestroyed() && phoneWindow.isVisible());
}

// Nach Speichern der Einstellungen erneut anwenden.
function applyConfig() {
  const enabled = !!store.get('threecxEnabled');
  if (!enabled) {
    if (phoneWindow && !phoneWindow.isDestroyed()) {
      quitting = true;            // erlaubt echtes Schließen
      phoneWindow.close();
      quitting = false;
    }
    return;
  }
  if (phoneWindow && !phoneWindow.isDestroyed()) {
    // URL evtl. geändert -> neu laden
    const url = normalizeUrl(store.get('threecxUrl'));
    if (url) phoneWindow.loadURL(url);
  } else {
    createPhoneWindow(); // bleibt versteckt
  }
}

// ── Init ──────────────────────────────────────────────────────

function init(injected) {
  helpers = Object.assign(helpers, injected || {});

  // IPC-Handler nur einmal registrieren (createMainWindow kann auf macOS bei
  // 'activate' erneut laufen).
  if (initialized) {
    if (store.get('threecxEnabled') && store.get('threecxUrl')) createPhoneWindow();
    return;
  }
  initialized = true;

  ipcMain.handle('threecx:open-url', (_e, url) => {
    if (url && typeof url === 'string') helpers.openInMainWindow(url);
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
    return true;
  });

  ipcMain.handle('threecx:close-popup', () => {
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
    return true;
  });

  // Auto-Ausblenden abbrechen, sobald der Nutzer mit dem Popup interagiert.
  ipcMain.handle('threecx:keep-open', () => {
    if (popupTimer) { clearTimeout(popupTimer); popupTimer = null; }
    return true;
  });

  // Notiz/Name/Projekt zu einem Anruf speichern (-> Feed-Eintrag im CRM).
  // Den WP-Login des angemeldeten Mitarbeiters mitsenden, damit der Server
  // festhält, wer den Anrufgrund dokumentiert hat (Auth läuft über den API-Key,
  // nicht über eine WP-Session).
  ipcMain.handle('threecx:save-note', async (_e, payload) => {
    try {
      const body = Object.assign({}, payload || {});
      const creds = credentials.getCredentials();
      if (creds && creds.username) body.author_login = creds.username;
      const res = await apiRequest('POST', '/call-note', null, body);
      return { ok: !!(res && res.saved) };
    } catch (err) {
      console.warn('[3cx] Notiz speichern fehlgeschlagen:', err.message);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('threecx:get-sentinel-url', () => {
    return `http://${SENTINEL_HOST}${SENTINEL_PATH}?phoneNumber=%CallerNumber%&displayName=%CallerDisplayName%`;
  });

  // Für isolierte Tests aus den DevTools des 3CX-Fensters aufrufbar.
  ipcMain.handle('threecx:simulate-call', (_e, phoneNumber, displayName) => {
    handleIncomingCall(`http://${SENTINEL_HOST}${SENTINEL_PATH}?phoneNumber=${encodeURIComponent(phoneNumber || '')}&displayName=${encodeURIComponent(displayName || '')}`);
    return true;
  });

  if (store.get('threecxEnabled') && store.get('threecxUrl')) {
    createPhoneWindow(); // versteckt im Hintergrund
  }
}

module.exports = {
  init,
  applyConfig,
  togglePhoneWindow,
  isPhoneVisible,
  // exportiert für evtl. direkte Nutzung/Tests
  _handleIncomingCall: handleIncomingCall,
};
