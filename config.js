(async function () {
  const config = await window.pmpDesktop.getConfig();

  const elUrl = document.getElementById('siteUrl');
  const elPath = document.getElementById('downloadPath');
  const elSynology = document.getElementById('synologyDrivePath');
  const elOpen = document.getElementById('openFilesLocally');
  const elNotifications = document.getElementById('notificationsEnabled');
  const elNotificationSound = document.getElementById('notificationSoundEnabled');
  const elAutoLogin = document.getElementById('autoLoginEnabled');
  const elAutoLoginHint = document.getElementById('autoLoginHint');
  const elStatus = document.getElementById('status');
  const btnDir = document.getElementById('btnSelectDir');
  const btnSynology = document.getElementById('btnSelectSynology');
  const btnClearCreds = document.getElementById('btnClearCreds');
  const btnSave = document.getElementById('btnSave');

  // 3CX-Felder
  const elThreecxEnabled = document.getElementById('threecxEnabled');
  const elThreecxUrl = document.getElementById('threecxUrl');
  const elThreecxApiKey = document.getElementById('threecxApiKey');
  const elThreecxPopupSeconds = document.getElementById('threecxPopupSeconds');
  const elThreecxAllowMedia = document.getElementById('threecxAllowMedia');
  const elThreecxFields = document.getElementById('threecxFields');

  // Populate current values
  elUrl.value = config.siteUrl || '';
  elPath.value = config.downloadPath || '';
  elSynology.value = config.synologyDrivePath || '';
  elOpen.checked = config.openFilesLocally !== false;
  elNotifications.checked = config.notificationsEnabled !== false;
  elNotificationSound.checked = config.notificationSoundEnabled !== false;
  elAutoLogin.checked = !!config.autoLoginEnabled;

  // 3CX-Werte
  elThreecxEnabled.checked = !!config.threecxEnabled;
  elThreecxUrl.value = config.threecxUrl || '';
  elThreecxApiKey.value = config.threecxApiKey || '';
  elThreecxPopupSeconds.value = config.threecxPopupSeconds != null ? String(config.threecxPopupSeconds) : '20';
  elThreecxAllowMedia.checked = !!config.threecxAllowMedia;

  function refreshThreecxFields() {
    elThreecxFields.style.display = elThreecxEnabled.checked ? 'block' : 'none';
  }
  refreshThreecxFields();
  elThreecxEnabled.addEventListener('change', refreshThreecxFields);

  // Disable auto-login toggle if OS keychain/safeStorage isn't available.
  try {
    const available = await window.pmpDesktop.credentials.available();
    if (!available) {
      elAutoLogin.checked = false;
      elAutoLogin.disabled = true;
      elAutoLoginHint.textContent = 'Automatisches Anmelden ist auf diesem System nicht verfügbar (kein sicherer Schlüsselbund vorhanden).';
    }
  } catch (_) {}

  async function refreshClearCredsButton() {
    try {
      const has = await window.pmpDesktop.credentials.has();
      btnClearCreds.style.display = has ? 'block' : 'none';
    } catch (_) {
      btnClearCreds.style.display = 'none';
    }
  }
  refreshClearCredsButton();

  btnClearCreds.addEventListener('click', async () => {
    await window.pmpDesktop.credentials.clear();
    refreshClearCredsButton();
    elStatus.textContent = 'Zugangsdaten entfernt.';
    elStatus.className = 'status success';
  });

  // If user disables auto-login, wipe any stored credentials immediately.
  elAutoLogin.addEventListener('change', async () => {
    if (!elAutoLogin.checked) {
      await window.pmpDesktop.credentials.clear();
      refreshClearCredsButton();
    }
  });

  btnDir.addEventListener('click', async () => {
    const dir = await window.pmpDesktop.selectDirectory();
    if (dir) elPath.value = dir;
  });

  btnSynology.addEventListener('click', async () => {
    const dir = await window.pmpDesktop.selectDirectory();
    if (dir) elSynology.value = dir;
  });

  btnSave.addEventListener('click', async () => {
    const siteUrl = elUrl.value.trim();
    if (!siteUrl) {
      elStatus.textContent = 'Bitte geben Sie eine URL ein.';
      elStatus.className = 'status error';
      return;
    }

    elStatus.textContent = 'Verbinde…';
    elStatus.className = 'status';
    btnSave.disabled = true;

    try {
      const popupSecs = parseInt(elThreecxPopupSeconds.value, 10);
      await window.pmpDesktop.saveConfig({
        siteUrl: siteUrl,
        downloadPath: elPath.value,
        synologyDrivePath: elSynology.value,
        openFilesLocally: elOpen.checked,
        notificationsEnabled: elNotifications.checked,
        notificationSoundEnabled: elNotificationSound.checked,
        autoLoginEnabled: elAutoLogin.checked,
        threecxEnabled: elThreecxEnabled.checked,
        threecxUrl: elThreecxUrl.value.trim(),
        threecxApiKey: elThreecxApiKey.value.trim(),
        threecxPopupSeconds: (!isNaN(popupSecs) && popupSecs > 0) ? popupSecs : 20,
        threecxAllowMedia: elThreecxAllowMedia.checked
      });
      elStatus.textContent = 'Gespeichert! App wird geladen…';
      elStatus.className = 'status success';
      setTimeout(() => window.close(), 800);
    } catch (e) {
      elStatus.textContent = 'Fehler beim Speichern: ' + e.message;
      elStatus.className = 'status error';
    } finally {
      btnSave.disabled = false;
    }
  });

  // Allow Enter key in URL field
  elUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnSave.click();
  });
})();
