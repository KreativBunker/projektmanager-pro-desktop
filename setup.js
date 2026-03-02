(async function () {
  const config = await window.pmpDesktop.getConfig();
  let currentStep = 0;

  const elUrl = document.getElementById('setupUrl');
  const elPath = document.getElementById('setupDownloadPath');
  const elSynology = document.getElementById('setupSynologyPath');
  const elAutoOpen = document.getElementById('setupAutoOpen');
  const elAutoStart = document.getElementById('setupAutoStart');
  const elConnTest = document.getElementById('connTest');
  const elSummary = document.getElementById('setupSummary');

  // Pre-fill defaults
  elPath.value = config.downloadPath || '';
  elSynology.value = config.synologyDrivePath || '';
  elAutoOpen.checked = config.openFilesLocally !== false;

  // Pre-fill server URL if passed via --site-url argument (e.g. from a custom installer)
  if (config._launchSiteUrl) {
    elUrl.value = config._launchSiteUrl;
  }

  function showStep(n) {
    currentStep = n;
    document.querySelectorAll('.step').forEach((el) => {
      el.classList.toggle('active', parseInt(el.dataset.step) === n);
    });
    document.querySelectorAll('.step-dot').forEach((el) => {
      const s = parseInt(el.dataset.step);
      el.classList.toggle('active', s === n);
      el.classList.toggle('done', s < n);
    });
  }

  // Step 1: Test connection
  document.getElementById('btnStep1Next').addEventListener('click', async () => {
    const url = elUrl.value.trim();
    if (!url) {
      elUrl.focus();
      return;
    }

    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
      elUrl.value = normalizedUrl;
    }

    elConnTest.className = 'connection-test testing';
    elConnTest.innerHTML = '<span class="spinner"></span> Verbindung wird getestet…';

    try {
      const result = await window.pmpDesktop.testConnection(normalizedUrl);
      if (result.ok) {
        elConnTest.className = 'connection-test success';
        elConnTest.textContent = 'Verbindung erfolgreich! Server erreichbar.';
        setTimeout(() => showStep(1), 800);
      } else {
        elConnTest.className = 'connection-test error';
        elConnTest.textContent = 'Server antwortet nicht. Bitte URL prüfen. (' + (result.error || 'Timeout') + ')';
      }
    } catch (e) {
      // Auch wenn der Test fehlschlägt, erlauben wir den Fortschritt
      elConnTest.className = 'connection-test error';
      elConnTest.innerHTML = 'Verbindungstest fehlgeschlagen – aber Sie können trotzdem <a href="#" id="continueAnyway" style="color:#0073aa;cursor:pointer;">fortfahren</a>.';
      document.getElementById('continueAnyway').addEventListener('click', (ev) => {
        ev.preventDefault();
        showStep(1);
      });
    }
  });

  // Enter key in URL field
  elUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnStep1Next').click();
  });

  // Step 2: Download settings
  document.getElementById('btnSetupDir').addEventListener('click', async () => {
    const dir = await window.pmpDesktop.selectDirectory();
    if (dir) elPath.value = dir;
  });

  document.getElementById('btnSetupSynology').addEventListener('click', async () => {
    const dir = await window.pmpDesktop.selectDirectory();
    if (dir) elSynology.value = dir;
  });

  document.getElementById('btnStep2Back').addEventListener('click', () => showStep(0));
  document.getElementById('btnStep2Next').addEventListener('click', () => {
    // Show summary
    const summaryItems = [
      '<strong>Server:</strong> ' + escapeHtml(elUrl.value),
      '<strong>Downloads:</strong> ' + escapeHtml(elPath.value)
    ];
    if (elSynology.value) {
      summaryItems.push('<strong>Synology Drive:</strong> ' + escapeHtml(elSynology.value));
    }
    summaryItems.push(
      '<strong>Auto-Öffnen:</strong> ' + (elAutoOpen.checked ? 'Ja' : 'Nein'),
      '<strong>Autostart:</strong> ' + (elAutoStart.checked ? 'Ja' : 'Nein')
    );
    elSummary.innerHTML = summaryItems.join('<br>');
    showStep(2);
  });

  // Step 3: Finish
  document.getElementById('btnStep3Back').addEventListener('click', () => showStep(1));
  document.getElementById('btnFinish').addEventListener('click', async () => {
    await window.pmpDesktop.saveConfig({
      siteUrl: elUrl.value.trim(),
      downloadPath: elPath.value,
      synologyDrivePath: elSynology.value,
      openFilesLocally: elAutoOpen.checked,
      autoStart: elAutoStart.checked,
      setupCompleted: true
    });
    window.pmpDesktop.finishSetup();
  });

  function escapeHtml(text) {
    const el = document.createElement('span');
    el.textContent = text;
    return el.innerHTML;
  }
})();
