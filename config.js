(async function () {
  const config = await window.pmpDesktop.getConfig();

  const elUrl = document.getElementById('siteUrl');
  const elPath = document.getElementById('downloadPath');
  const elSynology = document.getElementById('synologyDrivePath');
  const elOpen = document.getElementById('openFilesLocally');
  const elStatus = document.getElementById('status');
  const btnDir = document.getElementById('btnSelectDir');
  const btnSynology = document.getElementById('btnSelectSynology');
  const btnSave = document.getElementById('btnSave');

  // Populate current values
  elUrl.value = config.siteUrl || '';
  elPath.value = config.downloadPath || '';
  elSynology.value = config.synologyDrivePath || '';
  elOpen.checked = config.openFilesLocally !== false;

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
      await window.pmpDesktop.saveConfig({
        siteUrl: siteUrl,
        downloadPath: elPath.value,
        synologyDrivePath: elSynology.value,
        openFilesLocally: elOpen.checked
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
