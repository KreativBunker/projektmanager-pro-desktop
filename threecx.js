// ── 3CX-Integration ───────────────────────────────────────────
//
// Bettet den 3CX-Web-Client als zweiten Tab („Telefon") ins Hauptfenster ein,
// damit die Telefonie immer mitläuft und eingeloggt bleibt – auch wenn gerade
// der ProjektManager-Tab aktiv ist (die Ansicht wird nur ausgeblendet, nie
// entladen). Beim Klingeln eines eingehenden Anrufs ruft 3CX (Funktion
// „Kontakt-URL öffnen") eine Sentinel-URL
//   http://pmp.local/incoming-call?phoneNumber=%CallerNumber%&displayName=%CallerDisplayName%
// auf. Diese wird hier IN-PROCESS abgefangen (nie wirklich geladen), die Nummer
// gegen die WordPress-REST-API abgeglichen, der Anruf protokolliert und ein
// natives Anrufer-Popup angezeigt.
//
// Verbindungs-Überwachung: Ein Monitor prüft laufend, ob die Telefonanlage
// erreichbar ist (HTTP-Probe), ob der Web-Client geladen werden konnte
// (Ladefehler/Absturz/Hänger) und was der Web-Client selbst meldet
// (Login-Seite, „Verbindung verloren"-Banner). Der Zustand wird als Status an
// die Tab-Leiste gemeldet und bei Ausfall automatisch mit steigendem Abstand
// (5 s … 60 s) neu verbunden.
//
// Free-Tier-Grenzen: nur EINGEHEND, nur beim KLINGELN, nur solange die App
// läuft. Keine Dauer/verpasst/ausgehend (das bräuchte 3CX PRO).

const { BrowserWindow, WebContentsView, session, net, ipcMain, shell, screen, systemPreferences } = require('electron');
const path = require('path');
const store = require('./store');
const credentials = require('./credentials');

const PARTITION_3CX = 'persist:3cx';
const SENTINEL_HOST = 'pmp.local';
const SENTINEL_PATH = '/incoming-call';

// Verbindungs-Monitor: Intervalle/Grenzen
const PROBE_INTERVAL_MS = 30 * 1000;   // Erreichbarkeits-Prüfung der Telefonanlage
const PROBE_TIMEOUT_MS = 8 * 1000;
const PROBE_FAILS_BEFORE_OFFLINE = 2;  // erst nach 2 Fehlversuchen „offline" (kein Flackern)
const RETRY_MIN_MS = 5 * 1000;         // Auto-Reconnect: Startabstand
const RETRY_MAX_MS = 60 * 1000;        // Auto-Reconnect: Maximalabstand
const UNRESPONSIVE_RELOAD_MS = 15 * 1000;
const OFFLINE_NOTIFY_THROTTLE_MS = 10 * 60 * 1000;
const CALL_DEDUPE_MS = 4 * 1000;       // gleiche Nummer innerhalb 4 s = derselbe Anruf

let phoneView = null;     // eingebetteter 3CX-Web-Client (WebContentsView im Hauptfenster)
let phoneBounds = { x: 0, y: 0, width: 0, height: 0 };
let phoneVisible = false; // ist der Telefon-Tab aktiv?
let loadedUrl = '';       // zuletzt in die Ansicht geladene 3CX-URL
let popupWindow = null;   // natives Anrufer-Popup
let popupTimer = null;
let popupAnswered = false; // wurde der aktuelle Anruf an DIESEM Platz angenommen?
let initialized = false;
let lastCall = { key: '', at: 0 };

// Eindeutige Marker, mit denen die in den 3CX-Web-Client injizierten Detektoren
// per console.log an den Hauptprozess melden.
const CALL_ACTIVE_MARKER = '__PMP_3CX_CALL_ACTIVE__';
const CLIENT_STATE_MARKER = '__PMP_3CX_STATE__:';

// Vom Hauptprozess injizierte Helfer
let helpers = {
  getIconPath: () => undefined,
  openInMainWindow: () => {},
  getMainWindow: () => null,
  onStatusChange: () => {},
  notify: () => {},
};

// ── Verbindungs-Zustand ───────────────────────────────────────

// Roh-Signale, aus denen der Gesamtstatus berechnet wird.
const conn = {
  loading: false,
  loadFailed: false,
  loadError: '',
  crashed: false,
  unresponsive: false,
  reachable: null,        // null = noch nicht geprüft
  probeFails: 0,
  lastProbeAt: null,
  client: { state: 'unknown' }, // Meldung des injizierten Detektors
  retryDelay: RETRY_MIN_MS,
  nextRetryAt: null,
  lastOfflineNotifyAt: 0,
  errorPagePending: false, // did-finish-load der Chromium-Fehlerseite steht noch aus
  loadSeq: 0,              // Zähler, um verspätete Prüfungen alter Ladevorgänge zu ignorieren
};

let probeTimer = null;
let retryTimer = null;
let unresponsiveTimer = null;

// Zuletzt gemeldeter Status (an Tab-Leiste, Tray, …).
let status = { state: 'disabled', label: 'Deaktiviert', detail: '', since: Date.now(), presentation: 'placeholder', nextRetryAt: null };

const STATE_LABELS = {
  disabled: 'Deaktiviert',
  connecting: 'Verbinde…',
  online: 'Verbunden',
  login: 'Anmeldung erforderlich',
  offline: 'Keine Verbindung',
  error: 'Fehler',
};

function isEnabled() {
  return !!store.get('threecxEnabled') && !!normalizeUrl(store.get('threecxUrl'));
}

// Leitet aus den Roh-Signalen den Gesamtstatus ab und meldet Änderungen.
function recomputeStatus() {
  let state, detail, presentation;

  if (!isEnabled()) {
    state = 'disabled'; detail = '3CX-Integration ist in den Einstellungen deaktiviert.'; presentation = 'placeholder';
  } else if (conn.crashed) {
    state = 'error'; detail = 'Der 3CX-Web-Client ist abgestürzt und wird neu gestartet.'; presentation = 'placeholder';
  } else if (!phoneView || phoneView.webContents.isDestroyed()) {
    state = 'offline'; detail = 'Der 3CX-Web-Client ist nicht geladen.'; presentation = 'placeholder';
  } else if (conn.reachable === false) {
    state = 'offline'; detail = 'Die Telefonanlage ist nicht erreichbar (Netzwerk/Server).'; presentation = 'placeholder';
  } else if (conn.loadFailed) {
    state = 'offline'; detail = 'Der 3CX-Web-Client konnte nicht geladen werden' + (conn.loadError ? ' (' + conn.loadError + ')' : '') + '.'; presentation = 'placeholder';
  } else if (conn.unresponsive) {
    state = 'error'; detail = 'Der 3CX-Web-Client reagiert nicht und wird neu geladen.'; presentation = 'view+banner';
  } else if (conn.loading) {
    state = 'connecting'; detail = 'Der 3CX-Web-Client wird geladen…'; presentation = 'view';
  } else if (conn.client.state === 'offline') {
    state = 'offline'; detail = 'Kein Netzwerk – der Web-Client meldet „offline".'; presentation = 'view+banner';
  } else if (conn.client.state === 'disconnected') {
    state = 'offline'; detail = 'Der 3CX-Web-Client meldet einen Verbindungsverlust zur Telefonanlage.'; presentation = 'view+banner';
  } else if (conn.client.state === 'login') {
    state = 'login'; detail = 'Bitte im 3CX-Web-Client anmelden, damit Anrufe erkannt werden.'; presentation = 'view+banner';
  } else {
    state = 'online'; detail = 'Verbindung zur Telefonanlage steht.'; presentation = 'view';
  }

  const changed = status.state !== state || status.detail !== detail || status.presentation !== presentation
    || status.nextRetryAt !== conn.nextRetryAt;
  if (!changed) return;

  const prevState = status.state;
  status = {
    state,
    label: STATE_LABELS[state] || state,
    detail,
    since: status.state === state ? status.since : Date.now(),
    presentation,
    nextRetryAt: conn.nextRetryAt,
    url: normalizeUrl(store.get('threecxUrl')),
  };

  if (prevState !== state) console.log('[3cx] Status:', prevState, '→', state, '–', detail);

  // Einmalige Benachrichtigung beim Übergang „verbunden → getrennt" (gedrosselt).
  // Nur bei harten Ausfällen (Anlage nicht erreichbar, Ladefehler, Absturz) –
  // nicht bei heuristischen Meldungen aus dem Web-Client selbst.
  if (prevState === 'online' && (state === 'offline' || state === 'error') && presentation === 'placeholder') {
    const now = Date.now();
    if (now - conn.lastOfflineNotifyAt > OFFLINE_NOTIFY_THROTTLE_MS) {
      conn.lastOfflineNotifyAt = now;
      try { helpers.notify({ title: 'Telefonanlage: Verbindung verloren', body: detail }); } catch (_) {}
    }
  }

  applyPhoneLayout();
  try { helpers.onStatusChange(getStatus()); } catch (_) {}
}

function getStatus() {
  return Object.assign({}, status);
}

// ── URL-Helfer ────────────────────────────────────────────────

function normalizeUrl(url) {
  if (!url) return '';
  let u = String(url).trim();
  if (!u) return '';
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

function apiRequestOnce(method, pathName, query, body) {
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
    let settled = false;
    const finish = (fn, val) => { if (settled) return; settled = true; clearTimeout(timeout); fn(val); };
    const timeout = setTimeout(() => { try { req.abort(); } catch (_) {} finish(reject, new Error('Timeout')); }, 8000);

    req.on('response', (res) => {
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 500) return finish(reject, new Error('HTTP ' + res.statusCode));
        try { finish(resolve, JSON.parse(data || '{}')); }
        catch (_) { finish(resolve, {}); }
      });
      res.on('error', (err) => finish(reject, err));
    });
    req.on('error', (err) => finish(reject, err));

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Ein Wiederholungsversuch bei Netzwerk-/Serverfehlern, damit ein kurzer
// Aussetzer nicht gleich ein verlorenes Anrufprotokoll bedeutet.
async function apiRequest(method, pathName, query, body) {
  try {
    return await apiRequestOnce(method, pathName, query, body);
  } catch (err) {
    console.warn('[3cx] API-Aufruf fehlgeschlagen, wiederhole:', method, pathName, err.message);
    await new Promise((r) => setTimeout(r, 700));
    return apiRequestOnce(method, pathName, query, body);
  }
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

  // 3CX kann die Kontakt-URL mehrfach auslösen (z. B. window.open UND
  // Navigation). Denselben Anruf innerhalb weniger Sekunden nur einmal bearbeiten.
  const key = phoneNumber + '|' + displayName;
  const now = Date.now();
  if (lastCall.key === key && now - lastCall.at < CALL_DEDUPE_MS) {
    console.log('[3cx] Doppelte Anruf-Meldung ignoriert:', phoneNumber);
    return;
  }
  lastCall = { key, at: now };

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

// ── Eingebettete 3CX-Ansicht ──────────────────────────────────

// Mikrofon-Freigabe für den eingebetteten Web-Client. Ohne Freigabe meldet
// 3CX „Ihr Mikrofon ist gesperrt … keine Anrufe annehmen". Die Partition
// enthält ausschließlich den 3CX-Web-Client, daher wird nicht zusätzlich auf
// den Origin geprüft (3CX leitet u. U. auf eine andere Subdomain weiter).
function isMicrophoneAllowed() {
  return store.get('threecxMicrophone') !== false;
}

function configureMediaPermissions(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    if (isMicrophoneAllowed() && (permission === 'media' || permission === 'speaker-selection')) {
      return callback(true);
    }
    return callback(false);
  });
  ses.setPermissionCheckHandler((_wc, permission) => {
    if (isMicrophoneAllowed() && (permission === 'media' || permission === 'speaker-selection')) return true;
    return false;
  });
}

// macOS: Die App braucht zusätzlich die System-Freigabe (Datenschutz →
// Mikrofon). Beim ersten Mal fragt macOS nach; wurde sie verweigert, bleibt
// das Mikrofon gesperrt, bis sie in den Systemeinstellungen erteilt wird.
function requestSystemMicrophoneAccess() {
  if (process.platform !== 'darwin' || !isMicrophoneAllowed()) return;
  try {
    if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined') {
      systemPreferences.askForMediaAccess('microphone').catch(() => {});
    }
  } catch (_) {}
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
  // Auch Unterframes (die CRM-URL kann in einem iframe geöffnet werden).
  wc.on('will-frame-navigate', (details) => {
    if (details && details.url && isSentinel(details.url)) {
      details.preventDefault();
      handleIncomingCall(details.url);
    }
  });
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

// ── Verbindungs-Erkennung im eingebetteten 3CX-Web-Client ─────
//
// Meldet heuristisch den Zustand des Web-Clients: „login" (sichtbares
// Passwortfeld), „offline" (Browser ohne Netz), „disconnected" (sichtbarer
// Hinweis wie „Verbindung verloren"/„Reconnecting"), sonst „connected".
// Ein „disconnected" wird erst nach zwei aufeinanderfolgenden Messungen (4 s)
// gemeldet, damit kurze Umschaltmomente nicht als Ausfall erscheinen.
function buildConnectionDetectorSource(marker) {
  return '(function(){' +
    'if(window.__pmpConnDetectorInstalled)return;' +
    'window.__pmpConnDetectorInstalled=true;' +
    'var MARKER=' + JSON.stringify(marker) + ';' +
    'var last="",pendingDisc=0;' +
    'var RX=/(verbindung(?:\\s+zum\\s+server)?\\s+(?:verloren|unterbrochen|getrennt|abgebrochen|wird\\s+wiederhergestellt)|' +
      'nicht\\s+verbunden|keine\\s+verbindung|verbindung\\s+wird\\s+hergestellt|reconnect|connection\\s+(?:lost|failed|error|interrupted)|' +
      'disconnected|not\\s+connected|server\\s+(?:unreachable|not\\s+reachable)|nicht\\s+erreichbar|no\\s+connection|session\\s+expired|sitzung\\s+abgelaufen)/i;' +
    'function visible(el){if(!el)return false;var r=el.getBoundingClientRect();if(!(r.width>0&&r.height>0))return false;' +
      'var cs=getComputedStyle(el);return cs.visibility!=="hidden"&&cs.opacity!=="0";}' +
    'function detect(){' +
      'if(navigator.onLine===false)return "offline";' +
      'var pw=document.querySelectorAll(\'input[type="password"]\');for(var p=0;p<pw.length;p++){if(visible(pw[p]))return "login";}' +
      'var els=document.querySelectorAll("div,span,p,h1,h2,h3,h4,button,a,li,td,label,bdi,strong,small");' +
      'for(var i=0;i<els.length;i++){var el=els[i];if(el.children&&el.children.length>2)continue;' +
        'var t=(el.textContent||"").trim();if(!t||t.length>90)continue;if(!RX.test(t))continue;if(!visible(el))continue;return "disconnected";}' +
      'return "connected";}' +
    'function report(s){if(s===last)return;last=s;console.log(MARKER+JSON.stringify({state:s,url:location.href}));}' +
    'function poll(){var s;try{s=detect();}catch(e){s="unknown";}' +
      'if(s==="disconnected"){pendingDisc++;if(pendingDisc<2)return;}else{pendingDisc=0;}report(s);}' +
    'setInterval(poll,2000);' +
    'window.addEventListener("online",poll);window.addEventListener("offline",poll);' +
    'setTimeout(poll,500);' +
  '})();';
}

function extractConsoleMessage(args) {
  // Signatur je nach Electron-Version unterschiedlich: entweder
  // (event, level, message, …) oder ein einzelnes Event-Objekt mit .message.
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object' && typeof a.message === 'string') return a.message;
  }
  return '';
}

function attachDetectors(wc) {
  wc.on('console-message', function () {
    const msg = extractConsoleMessage(arguments);
    if (!msg) return;
    if (msg.indexOf(CALL_ACTIVE_MARKER) !== -1) { markCallAnswered(); return; }
    const idx = msg.indexOf(CLIENT_STATE_MARKER);
    if (idx !== -1) {
      try {
        const data = JSON.parse(msg.slice(idx + CLIENT_STATE_MARKER.length));
        if (data && typeof data.state === 'string' && !/^chrome-error:/.test(data.url || '')) {
          conn.client = { state: data.state, url: data.url || '' };
          recomputeStatus();
        }
      } catch (_) {}
    }
  });
  wc.on('dom-ready', function () {
    if (isErrorPage(wc)) return;
    wc.executeJavaScript(buildCallDetectorSource(CALL_ACTIVE_MARKER)).catch(function () {});
    wc.executeJavaScript(buildConnectionDetectorSource(CLIENT_STATE_MARKER)).catch(function () {});
  });
}

// ── Verbindungs-Monitor ───────────────────────────────────────

function attachConnectionMonitor(wc) {
  wc.on('did-start-navigation', (details, ...rest) => {
    // Neue API: Event-Objekt mit isMainFrame; alte API: (event, url, isInPlace, isMainFrame)
    const isMain = (details && typeof details === 'object' && 'isMainFrame' in details)
      ? details.isMainFrame
      : rest[2] !== false;
    const inPlace = (details && typeof details === 'object' && 'isSameDocument' in details)
      ? details.isSameDocument
      : !!rest[1];
    if (!isMain || inPlace) return;
    conn.loading = true;
    conn.errorPagePending = false;
    conn.loadSeq++;
    conn.client = { state: 'unknown' };
    recomputeStatus();
  });

  wc.on('did-finish-load', () => {
    conn.loading = false;
    // Nach einem Ladefehler zeigt Chromium eine interne Fehlerseite
    // (chrome-error://…) und meldet dafür ebenfalls „fertig geladen" – das ist
    // KEINE erfolgreiche Verbindung. getURL() liefert dabei weiterhin die
    // 3CX-URL, deshalb wird die tatsächliche Seitenadresse in der Seite geprüft.
    if (conn.errorPagePending) {
      conn.errorPagePending = false;
      recomputeStatus();
      return;
    }
    const seq = ++conn.loadSeq;
    isErrorPageAsync(wc).then((isErr) => {
      if (seq !== conn.loadSeq) return; // inzwischen neu geladen
      if (isErr) {
        conn.loadFailed = true;
        if (!conn.loadError) conn.loadError = 'Fehlerseite';
        scheduleRetry();
      } else {
        conn.loadFailed = false;
        conn.loadError = '';
        conn.crashed = false;
        conn.retryDelay = RETRY_MIN_MS;
        clearRetry();
      }
      recomputeStatus();
    });
  });

  wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame === false) return;
    if (code === -3) { // ERR_ABORTED: Navigation ersetzt/abgebrochen – kein Fehler
      conn.loading = false;
      recomputeStatus();
      return;
    }
    conn.loading = false;
    conn.loadFailed = true;
    conn.loadError = desc || ('Fehler ' + code);
    conn.errorPagePending = true; // das folgende did-finish-load gehört zur Fehlerseite
    console.warn('[3cx] Ladefehler:', code, desc);
    scheduleRetry();
    recomputeStatus();
  });

  wc.on('render-process-gone', (_e, details) => {
    console.warn('[3cx] Renderer beendet:', details && details.reason);
    conn.crashed = true;
    conn.loading = false;
    recomputeStatus();
    // Ansicht neu erzeugen (ein abgestürzter Renderer lädt nicht zuverlässig neu).
    setTimeout(() => {
      destroyPhoneView();
      if (isEnabled()) createPhoneView();
    }, 2000);
  });

  wc.on('unresponsive', () => {
    conn.unresponsive = true;
    recomputeStatus();
    if (unresponsiveTimer) clearTimeout(unresponsiveTimer);
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (conn.unresponsive && phoneView && !phoneView.webContents.isDestroyed()) {
        console.warn('[3cx] Web-Client hängt – wird neu geladen.');
        try { phoneView.webContents.forcefullyCrashRenderer(); } catch (_) { reloadPhone(); }
      }
    }, UNRESPONSIVE_RELOAD_MS);
  });
  wc.on('responsive', () => {
    conn.unresponsive = false;
    if (unresponsiveTimer) { clearTimeout(unresponsiveTimer); unresponsiveTimer = null; }
    recomputeStatus();
  });
}

// Sync-Vorprüfung (leere Seite) …
function isErrorPage(wc) {
  try {
    const u = wc.getURL() || '';
    return u.startsWith('chrome-error://') || u === '' || u === 'about:blank';
  } catch (_) { return true; }
}

// … und zuverlässige Prüfung über die tatsächliche Adresse in der Seite
// (Chromium-Fehlerseiten laufen unter chrome-error://chromewebdata/).
function isErrorPageAsync(wc) {
  if (isErrorPage(wc)) return Promise.resolve(true);
  return wc.executeJavaScript('location.protocol', true)
    .then((proto) => proto === 'chrome-error:')
    .catch(() => false);
}

function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  conn.nextRetryAt = null;
}

// Automatischer Neuverbindungsversuch mit steigendem Abstand.
function scheduleRetry() {
  if (retryTimer) return;
  const delay = conn.retryDelay;
  conn.retryDelay = Math.min(conn.retryDelay * 2, RETRY_MAX_MS);
  conn.nextRetryAt = Date.now() + delay;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    conn.nextRetryAt = null;
    if (!isEnabled()) return;
    console.log('[3cx] Neuverbindungsversuch…');
    reloadPhone();
  }, delay);
}

function reloadPhone() {
  if (!isEnabled()) return;
  if (!phoneView || phoneView.webContents.isDestroyed()) { createPhoneView(); return; }
  const url = normalizeUrl(store.get('threecxUrl'));
  try {
    const wc = phoneView.webContents;
    const current = wc.getURL();
    // Nach Ladefehler oder URL-Wechsel komplett neu laden, sonst nur reload
    // (damit der Login-Zustand des Web-Clients erhalten bleibt).
    if (conn.loadFailed || !current || current === 'about:blank' || url !== loadedUrl) {
      loadedUrl = url;
      wc.loadURL(url);
    } else {
      wc.reload();
    }
  } catch (err) {
    console.warn('[3cx] Neuladen fehlgeschlagen:', err.message);
  }
}

// Erreichbarkeits-Prüfung der Telefonanlage (unabhängig vom Web-Client).
function probeOnce(url) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(timer); resolve(ok); };
    let req;
    try {
      req = net.request({ method: 'GET', url, redirect: 'follow' });
    } catch (_) { return resolve(false); }
    const timer = setTimeout(() => { try { req.abort(); } catch (_) {} finish(false); }, PROBE_TIMEOUT_MS);
    req.on('response', (res) => {
      // Jede HTTP-Antwort (auch 401/403/404) heißt: Server ist erreichbar.
      finish(true);
      try { res.on('data', () => {}); res.on('end', () => {}); req.abort(); } catch (_) {}
    });
    req.on('error', () => finish(false));
    try { req.end(); } catch (_) { finish(false); }
  });
}

async function runProbe() {
  if (!isEnabled()) return;
  const url = normalizeUrl(store.get('threecxUrl'));
  const ok = await probeOnce(url);
  conn.lastProbeAt = Date.now();
  if (ok) {
    const wasUnreachable = conn.reachable === false;
    conn.reachable = true;
    conn.probeFails = 0;
    recomputeStatus();
    // Telefonanlage wieder da → Web-Client sofort neu laden, falls er hängt.
    if (wasUnreachable || conn.loadFailed) {
      clearRetry();
      conn.retryDelay = RETRY_MIN_MS;
      reloadPhone();
    }
  } else {
    conn.probeFails++;
    if (conn.probeFails >= PROBE_FAILS_BEFORE_OFFLINE && conn.reachable !== false) {
      conn.reachable = false;
      console.warn('[3cx] Telefonanlage nicht erreichbar:', url);
    }
    recomputeStatus();
  }
}

function startProbing() {
  stopProbing();
  runProbe();
  probeTimer = setInterval(runProbe, PROBE_INTERVAL_MS);
}

function stopProbing() {
  if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
}

// Manuell (Button „Jetzt verbinden") oder nach Konfigurationsänderung.
function reconnect() {
  if (!isEnabled()) { recomputeStatus(); return; }
  clearRetry();
  conn.retryDelay = RETRY_MIN_MS;
  conn.probeFails = 0;
  conn.reachable = null;
  conn.loadFailed = false;
  conn.crashed = false;
  conn.unresponsive = false;
  if (phoneView && !phoneView.webContents.isDestroyed()) {
    loadedUrl = normalizeUrl(store.get('threecxUrl'));
    conn.loading = true;
    try { phoneView.webContents.loadURL(loadedUrl); } catch (_) {}
  } else {
    createPhoneView();
  }
  startProbing();
  recomputeStatus();
}

// ── Ansicht erzeugen/zerstören/anordnen ───────────────────────

function createPhoneView() {
  const url = normalizeUrl(store.get('threecxUrl'));
  if (!url) return null;
  if (phoneView && !phoneView.webContents.isDestroyed()) return phoneView;

  const win = helpers.getMainWindow();
  if (!win || win.isDestroyed()) return null;

  const ses = session.fromPartition(PARTITION_3CX);
  configureMediaPermissions(ses);
  requestSystemMicrophoneAccess();

  phoneView = new WebContentsView({
    webPreferences: {
      partition: PARTITION_3CX,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // versteckter Tab nicht drosseln (Signalisierung)
    },
  });

  const wc = phoneView.webContents;
  attachInterceptors(wc);
  attachDetectors(wc);
  attachConnectionMonitor(wc);
  wc.on('destroyed', () => {
    if (phoneView && phoneView.webContents === wc) phoneView = null;
    recomputeStatus();
  });

  try { win.contentView.addChildView(phoneView); } catch (err) {
    console.warn('[3cx] Ansicht konnte nicht eingebettet werden:', err.message);
    phoneView = null;
    return null;
  }

  conn.loading = true;
  conn.loadFailed = false;
  conn.crashed = false;
  conn.unresponsive = false;
  conn.client = { state: 'unknown' };
  loadedUrl = url;
  applyPhoneLayout();
  wc.loadURL(url);
  startProbing();
  recomputeStatus();
  return phoneView;
}

function destroyPhoneView() {
  clearRetry();
  if (unresponsiveTimer) { clearTimeout(unresponsiveTimer); unresponsiveTimer = null; }
  if (!phoneView) return;
  const view = phoneView;
  phoneView = null;
  const win = helpers.getMainWindow();
  try { if (win && !win.isDestroyed()) win.contentView.removeChildView(view); } catch (_) {}
  try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch (_) {}
}

// Vom Hauptfenster aufgerufen: Bereich unterhalb der Tab-Leiste und ob der
// Telefon-Tab aktiv ist. Die tatsächliche Sichtbarkeit hängt zusätzlich vom
// Status ab (bei Platzhalter-Darstellung bleibt die Ansicht verborgen, bei
// Banner-Darstellung wird sie um die Banner-Höhe nach unten geschoben).
function layoutPhoneView(bounds, visible, bannerHeight) {
  phoneBounds = Object.assign({}, bounds);
  phoneVisible = !!visible;
  phoneBounds._banner = bannerHeight || 0;
  applyPhoneLayout();
}

function applyPhoneLayout() {
  if (!phoneView || phoneView.webContents.isDestroyed()) return;
  const banner = (status.presentation === 'view+banner') ? (phoneBounds._banner || 0) : 0;
  const showView = phoneVisible && status.presentation !== 'placeholder';
  try {
    phoneView.setBounds({
      x: phoneBounds.x || 0,
      y: (phoneBounds.y || 0) + banner,
      width: Math.max(0, phoneBounds.width || 0),
      height: Math.max(0, (phoneBounds.height || 0) - banner),
    });
    phoneView.setVisible(showView);
  } catch (_) {}
}

function focusPhone() {
  if (phoneView && !phoneView.webContents.isDestroyed() && phoneVisible) {
    try { phoneView.webContents.focus(); } catch (_) {}
  }
}

function getPhoneWebContents() {
  return (phoneView && !phoneView.webContents.isDestroyed()) ? phoneView.webContents : null;
}

// Das Hauptfenster wurde zerstört → die eingebettete Ansicht ist damit weg.
function onMainWindowClosed() {
  clearRetry();
  stopProbing();
  phoneView = null;
  recomputeStatus();
}

// Nach Speichern der Einstellungen erneut anwenden.
function applyConfig() {
  if (!isEnabled()) {
    stopProbing();
    destroyPhoneView();
    recomputeStatus();
    return;
  }
  const url = normalizeUrl(store.get('threecxUrl'));
  if (phoneView && !phoneView.webContents.isDestroyed()) {
    // Nur bei geänderter URL neu laden – sonst bliebe jedes Speichern der
    // Einstellungen ein unnötiger Neustart (und ggf. Re-Login) des Web-Clients.
    if (url !== loadedUrl) reconnect();
    else recomputeStatus();
  } else {
    reconnect();
  }
}

// ── Init ──────────────────────────────────────────────────────

function init(injected) {
  helpers = Object.assign(helpers, injected || {});

  // IPC-Handler nur einmal registrieren (createMainWindow kann auf macOS bei
  // 'activate' erneut laufen).
  if (initialized) {
    if (isEnabled()) createPhoneView();
    recomputeStatus();
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

  ipcMain.handle('threecx:get-status', () => getStatus());
  ipcMain.handle('threecx:reconnect', () => { reconnect(); return getStatus(); });

  // Für isolierte Tests aus den DevTools des 3CX-Tabs aufrufbar.
  ipcMain.handle('threecx:simulate-call', (_e, phoneNumber, displayName) => {
    handleIncomingCall(`http://${SENTINEL_HOST}${SENTINEL_PATH}?phoneNumber=${encodeURIComponent(phoneNumber || '')}&displayName=${encodeURIComponent(displayName || '')}`);
    return true;
  });

  // Netzwerk-Wechsel der App selbst (Standby/WLAN) → sofort prüfen statt auf
  // das nächste Intervall zu warten.
  try {
    const { powerMonitor } = require('electron');
    powerMonitor.on('resume', () => { if (isEnabled()) { conn.probeFails = 0; runProbe(); } });
    powerMonitor.on('unlock-screen', () => { if (isEnabled()) runProbe(); });
  } catch (_) {}

  if (isEnabled()) {
    createPhoneView();
  }
  recomputeStatus();
}

module.exports = {
  init,
  applyConfig,
  reconnect,
  isEnabled,
  getStatus,
  layoutPhoneView,
  focusPhone,
  getPhoneWebContents,
  onMainWindowClosed,
  // exportiert für evtl. direkte Nutzung/Tests
  _handleIncomingCall: handleIncomingCall,
};
