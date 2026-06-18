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
let popupAnswered = false; // wurde der aktuelle Anruf an DIESEM Platz angenommen?
let quitting = false;
let initialized = false;

// Eindeutiger Marker, mit dem der in den 3CX-Web-Client injizierte Detektor
// (siehe attachCallStateDetector) per console.log meldet, dass diese
// Nebenstelle gerade ein Gespräch verbunden hat.
const CALL_ACTIVE_MARKER = '__PMP_3CX_CALL_ACTIVE__';

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

  // Position: Bildschirm unter dem Mauszeiger (aktiver Monitor) und oben mittig
  // statt unten in der Ecke. So landet das Popup auf Mehrmonitor-Setups dort, wo
  // gerade gearbeitet wird, und wird nicht so leicht übersehen.
  let x, y;
  try {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    x = Math.round(wa.x + (wa.width - W) / 2);
    y = Math.round(wa.y + 24);
  } catch (_) {
    const wa = screen.getPrimaryDisplay().workArea;
    x = Math.round(wa.x + (wa.width - W) / 2);
    y = Math.round(wa.y + 24);
  }

  // Jeder Anruf startet „nicht angenommen". Erst wenn dieser Platz das Gespräch
  // verbindet (3CX-Detektor) oder der Nutzer mit dem Popup interagiert, bleibt es
  // dauerhaft offen.
  popupAnswered = false;

  if (!popupWindow || popupWindow.isDestroyed()) {
    popupWindow = new BrowserWindow({
      width: W,
      height: H,
      x,
      y,
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
  } else {
    popupWindow.setPosition(x, y);
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

  // Auto-Ausblenden gilt nur für NICHT angenommene Anrufe. Wer das Gespräch hier
  // annimmt (oder mit dem Popup interagiert), behält es dauerhaft – das Ausblenden
  // wird in dem Fall abgebrochen (markCallAnswered bzw. IPC „keep-open").
  // Frühestens nach 1 Minute ausblenden (auch wenn ein älterer, kleinerer Wert
  // gespeichert ist).
  let secs = parseInt(store.get('threecxPopupSeconds'), 10);
  if (isNaN(secs) || secs < 60) secs = 60;
  if (popupTimer) clearTimeout(popupTimer);
  popupTimer = setTimeout(() => {
    if (!popupAnswered && popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
  }, secs * 1000);
}

// Der Anruf wurde an DIESEM Platz angenommen → Popup offen halten. Greift nur,
// solange das Popup zum aktuellen (klingelnden/gerade angenommenen) Anruf noch
// sichtbar ist; so wird kein veraltetes Popup eines früheren Anrufs und kein
// ausgehender Anruf fälschlich wiederbelebt.
function markCallAnswered() {
  if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return;
  if (popupAnswered) return;
  popupAnswered = true;
  if (popupTimer) { clearTimeout(popupTimer); popupTimer = null; }
  popupWindow.setAlwaysOnTop(true, 'screen-saver');
  popupWindow.webContents.send('threecx:answered');
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

// ── Anruf-Status-Erkennung im eingebetteten 3CX-Web-Client ────
//
// Free-Tier-3CX meldet der App nur das Klingeln, nicht die Annahme. Damit das
// Popup beim Annehmenden offen bleibt, beobachten wir den Web-Client selbst:
// Ein in die Seite injizierter Detektor erkennt heuristisch, ob DIESE
// Nebenstelle gerade ein Gespräch verbunden hat (sichtbarer „Auflegen"-Button
// PLUS laufende Gesprächsdauer mm:ss), und meldet das per console.log-Marker.
// Bewusst defensiv (lieber einmal nicht erkennen als fälschlich auslösen) – als
// Rückfall dient die Interaktions-Erkennung im Popup selbst.
function buildCallDetectorSource(marker) {
  return '(function(){' +
    'if(window.__pmpCallDetectorInstalled)return;' +
    'window.__pmpCallDetectorInstalled=true;' +
    'var MARKER=' + JSON.stringify(marker) + ';' +
    'var active=false,prev={};' +
    'function visible(el){if(!el)return false;var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}' +
    'function toSecs(t){var m=/^(\\d{1,2}):(\\d{2})(?::(\\d{2}))?$/.exec((t||"").trim());if(!m)return null;' +
      'return m[3]!=null?(+m[1])*3600+(+m[2])*60+(+m[3]):(+m[1])*60+(+m[2]);}' +
    'function hasHangup(){var sel=\'[aria-label*="hang" i],[aria-label*="end call" i],[aria-label*="auflegen" i],\'+' +
      '\'[title*="auflegen" i],[title*="hang" i],[class*="hangup" i],[class*="end-call" i],[class*="endcall" i],\'+' +
      '\'[data-qa*="hangup" i],[data-qa*="endcall" i]\';' +
      'var n=document.querySelectorAll(sel);for(var i=0;i<n.length;i++){if(visible(n[i]))return true;}return false;}' +
    'function ticking(){var all=document.querySelectorAll("span,div,p,td,label,bdi");var found=false,next={};' +
      'for(var i=0;i<all.length;i++){var el=all[i];if(el.children&&el.children.length)continue;' +
      'var s=toSecs(el.textContent);if(s==null||s>6*3600)continue;if(!visible(el))continue;next[i]=s;' +
      'if(prev[i]!=null&&s>prev[i]&&(s-prev[i])<=3)found=true;}prev=next;return found;}' +
    'function poll(){var inCall=false;if(hasHangup()){inCall=ticking();}else{prev={};}' +
      'if(inCall&&!active){active=true;console.log(MARKER);}else if(!inCall){active=false;}}' +
    'setInterval(poll,1000);' +
  '})();';
}

function attachCallStateDetector(wc) {
  wc.on('console-message', function () {
    // Signatur je nach Electron-Version unterschiedlich: entweder
    // (event, level, message, …) oder ein einzelnes Event-Objekt mit .message.
    var msg = '';
    for (var i = 0; i < arguments.length; i++) {
      var a = arguments[i];
      if (typeof a === 'string') { msg = a; break; }
      if (a && typeof a === 'object' && typeof a.message === 'string') { msg = a.message; break; }
    }
    if (msg && msg.indexOf(CALL_ACTIVE_MARKER) !== -1) markCallAnswered();
  });
  wc.on('dom-ready', function () {
    wc.executeJavaScript(buildCallDetectorSource(CALL_ACTIVE_MARKER)).catch(function () {});
  });
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
  attachCallStateDetector(phoneWindow.webContents);
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
  // Bewusst nur den Klartext-Login (getAuthorLogin) lesen – NICHT die
  // verschlüsselten Zugangsdaten entschlüsseln. Sonst würde macOS bei jedem
  // Speichern einer Anruf-Notiz den Schlüsselbund-Passwortdialog zeigen.
  ipcMain.handle('threecx:save-note', async (_e, payload) => {
    try {
      const body = Object.assign({}, payload || {});
      const authorLogin = credentials.getAuthorLogin();
      if (authorLogin) body.author_login = authorLogin;
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
