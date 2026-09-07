// Tab-Leiste des Hauptfensters: Umschalten zwischen ProjektManager und
// 3CX-Telefon sowie dauerhaft sichtbare Anzeige des Verbindungsstatus zur
// Telefonanlage. Die eigentlichen Inhalte (WordPress bzw. 3CX-Web-Client) sind
// eingebettete Ansichten, die der Hauptprozess unterhalb der Leiste anordnet.
(function () {
  const body = document.body;
  const tabSite = document.getElementById('tabSite');
  const tabPhone = document.getElementById('tabPhone');
  const phoneDot = document.getElementById('phoneDot');
  const phoneSub = document.getElementById('phoneSub');
  const pill = document.getElementById('statuspill');
  const pillDot = document.getElementById('pillDot');
  const pillText = document.getElementById('pillText');
  const pillReconnect = document.getElementById('pillReconnect');
  const banner = document.getElementById('banner');
  const bannerText = document.getElementById('bannerText');
  const bannerReconnect = document.getElementById('bannerReconnect');
  const card = document.getElementById('card');
  const cardTitle = document.getElementById('cardTitle');
  const cardDetail = document.getElementById('cardDetail');
  const cardHint = document.getElementById('cardHint');
  const cardMeta = document.getElementById('cardMeta');
  const cardReconnect = document.getElementById('cardReconnect');
  const cardSettings = document.getElementById('cardSettings');

  let state = { activeTab: 'site', tabBarVisible: false, status: { state: 'disabled' } };
  let tickTimer = null;

  const TITLES = {
    disabled: '3CX-Telefonie ist deaktiviert',
    connecting: 'Verbindung wird aufgebaut…',
    online: 'Verbunden',
    login: 'Anmeldung im 3CX-Web-Client erforderlich',
    offline: 'Keine Verbindung zur Telefonanlage',
    error: 'Telefonanlage: Störung',
  };

  const HINTS = {
    disabled: 'Aktivieren Sie die 3CX-Integration in den Einstellungen und hinterlegen Sie die URL des 3CX-Web-Clients.',
    connecting: 'Der 3CX-Web-Client wird geladen. Das kann einen Moment dauern.',
    online: '',
    login: 'Ohne Anmeldung werden eingehende Anrufe nicht erkannt und es erscheint kein Anrufer-Popup.',
    offline: 'Eingehende Anrufe werden in dieser Zeit NICHT erkannt. Die App versucht automatisch, die Verbindung wiederherzustellen. Prüfen Sie Netzwerk/VPN und ob die Telefonanlage läuft.',
    error: 'Die App startet den 3CX-Web-Client automatisch neu.',
  };

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  }

  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    return h + ' h ' + (m % 60) + ' min';
  }

  function render() {
    const st = state.status || { state: 'disabled' };
    const kind = st.state || 'disabled';

    body.classList.toggle('no-tabs', !state.tabBarVisible);
    tabSite.classList.toggle('active', state.activeTab === 'site');
    tabPhone.classList.toggle('active', state.activeTab === 'phone');

    phoneDot.className = 'dot ' + kind;
    phoneSub.className = 'sub ' + kind;
    phoneSub.textContent = kind === 'online' ? '' : (st.label || '');

    pill.className = kind;
    pillDot.className = 'dot ' + kind;
    pillText.textContent = 'Telefonanlage: ' + (st.label || '');
    pill.title = st.detail || '';
    pillReconnect.hidden = !(kind === 'offline' || kind === 'error' || kind === 'login');

    const phoneActive = state.activeTab === 'phone';
    const showPlaceholder = phoneActive && st.presentation === 'placeholder';
    const showBanner = phoneActive && st.presentation === 'view+banner';
    body.classList.toggle('show-placeholder', showPlaceholder);
    body.classList.toggle('show-banner', showBanner);

    if (showBanner) {
      banner.className = kind;
      bannerText.textContent = (TITLES[kind] || st.label || '') + (st.detail ? ' – ' + st.detail : '');
    }

    if (showPlaceholder) {
      card.className = 'card ' + kind;
      cardTitle.textContent = TITLES[kind] || st.label || '';
      cardDetail.textContent = st.detail || '';
      cardHint.textContent = HINTS[kind] || '';
      cardReconnect.hidden = kind === 'disabled';
      renderMeta();
    }
  }

  function renderMeta() {
    const st = state.status || {};
    const parts = [];
    if (st.url) parts.push('Web-Client: ' + st.url);
    if (st.since && st.state !== 'disabled') parts.push('Seit ' + fmtTime(st.since) + ' (' + fmtDuration(Date.now() - st.since) + ')');
    if (st.nextRetryAt) {
      const rem = st.nextRetryAt - Date.now();
      parts.push(rem > 0 ? 'Nächster automatischer Versuch in ' + fmtDuration(rem) : 'Verbindungsversuch läuft…');
    }
    cardMeta.textContent = parts.join('  ·  ');
  }

  function startTicker() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (body.classList.contains('show-placeholder')) renderMeta();
    }, 1000);
  }

  function selectTab(tab) {
    if (state.activeTab === tab) return;
    state.activeTab = tab;
    render();
    window.pmpShell.selectTab(tab);
  }

  tabSite.addEventListener('click', () => selectTab('site'));
  tabPhone.addEventListener('click', () => selectTab('phone'));

  function reconnect(btn) {
    if (btn) { btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 3000); }
    window.pmpShell.reconnectPhone();
  }
  pillReconnect.addEventListener('click', () => reconnect(pillReconnect));
  bannerReconnect.addEventListener('click', () => reconnect(bannerReconnect));
  cardReconnect.addEventListener('click', () => reconnect(cardReconnect));
  cardSettings.addEventListener('click', () => window.pmpShell.openSettings());

  window.pmpShell.onState((next) => {
    state = Object.assign({}, state, next || {});
    render();
  });

  window.pmpShell.getState().then((next) => {
    state = Object.assign({}, state, next || {});
    render();
    startTicker();
  }).catch(() => { render(); startTicker(); });
})();
