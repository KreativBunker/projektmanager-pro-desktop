const { app, BrowserWindow, Menu, shell, dialog, ipcMain, Notification, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { net } = require('electron');
const store = require('./store');

let mainWindow = null;
let setupWindow = null;
let configWindow = null;
let tray = null;

// ── App Lifecycle ─────────────────────────────────────────────

// Check for --site-url=<url> command-line argument to pre-fill the setup wizard.
function getLaunchSiteUrl() {
  const prefix = '--site-url=';
  const arg = process.argv.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : '';
}

app.whenReady().then(() => {
  setupAutoStart();

  const config = store.load();
  if (!config.setupCompleted || !config.siteUrl) {
    openSetupWizard();
  } else {
    createMainWindow();
  }

  checkForUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const config = store.load();
    if (!config.setupCompleted || !config.siteUrl) {
      openSetupWizard();
    } else {
      createMainWindow();
    }
  }
});

// ── Setup Wizard ──────────────────────────────────────────────

function openSetupWizard() {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }

  setupWindow = new BrowserWindow({
    width: 520,
    height: 640,
    resizable: false,
    maximizable: false,
    title: 'Setup – ProjektManager Pro',
    icon: getIconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  setupWindow.once('ready-to-show', () => setupWindow.show());
  setupWindow.loadFile(path.join(__dirname, 'setup.html'));
  setupWindow.setMenuBarVisibility(false);

  setupWindow.on('closed', () => {
    setupWindow = null;
    // If setup wasn't completed and no main window, quit
    const config = store.load();
    if (!config.setupCompleted && !mainWindow) {
      app.quit();
    }
  });
}

// ── Main Window ───────────────────────────────────────────────

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  const bounds = store.get('windowBounds') || { width: 1280, height: 800 };
  const siteUrl = store.get('siteUrl');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    title: 'ProjektManager Pro',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    },
    show: false
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Save window bounds on resize/move
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('closed', () => { mainWindow = null; });

  if (siteUrl) {
    loadSite(siteUrl);
  }
  buildMenu();
  createTray();
}

// ── Load Site ─────────────────────────────────────────────────

function loadSite(url) {
  if (!mainWindow) return;

  let normalizedUrl = url;
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  mainWindow.loadURL(normalizedUrl);

  // Handle file downloads – save locally and open
  const ses = mainWindow.webContents.session;
  ses.removeAllListeners('will-download');
  ses.on('will-download', (_event, item) => {
    const downloadPath = store.get('downloadPath') || app.getPath('downloads');
    const filePath = path.join(downloadPath, item.getFilename());

    item.setSavePath(filePath);

    item.once('done', (_e, state) => {
      if (state === 'completed') {
        if (store.get('openFilesLocally')) {
          shell.openPath(filePath);
        }
        if (Notification.isSupported()) {
          const n = new Notification({
            title: 'Download abgeschlossen',
            body: item.getFilename(),
            icon: getIconPath()
          });
          n.on('click', () => shell.showItemInFolder(filePath));
          n.show();
        }
      }
    });
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    try {
      const siteOrigin = new URL(normalizedUrl).origin;
      if (linkUrl.startsWith(siteOrigin)) {
        return { action: 'allow' };
      }
    } catch (_) {}
    shell.openExternal(linkUrl);
    return { action: 'deny' };
  });

  // Handle navigation to external sites
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    try {
      const siteOrigin = new URL(normalizedUrl).origin;
      if (!navUrl.startsWith(siteOrigin)) {
        event.preventDefault();
        shell.openExternal(navUrl);
      }
    } catch (_) {}
  });
}

// ── Config Window ─────────────────────────────────────────────

function openConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 520,
    height: 460,
    resizable: false,
    title: 'Einstellungen – ProjektManager Pro',
    icon: getIconPath(),
    parent: mainWindow,
    modal: !!mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  configWindow.loadFile(path.join(__dirname, 'config.html'));
  configWindow.setMenuBarVisibility(false);

  configWindow.on('closed', () => {
    configWindow = null;
  });
}

// ── System Tray ───────────────────────────────────────────────

function createTray() {
  if (tray) return;

  const iconPath = getIconPath();
  if (!fs.existsSync(iconPath)) return;

  try {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('ProjektManager Pro');
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
      }
    });
  } catch (_) {
    // Tray creation can fail on some Linux DEs
  }
}

// ── Menu ──────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: 'Über ProjektManager Pro' },
        { type: 'separator' },
        {
          label: 'Einstellungen…',
          accelerator: 'CmdOrCtrl+,',
          click: () => openConfigWindow()
        },
        { type: 'separator' },
        {
          label: 'Nach Updates suchen…',
          click: () => checkForUpdates(true)
        },
        { type: 'separator' },
        { role: 'hide', label: 'Ausblenden' },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' }
      ]
    }] : []),
    {
      label: 'Datei',
      submenu: [
        {
          label: 'Download-Ordner öffnen',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            const dlPath = store.get('downloadPath') || app.getPath('downloads');
            shell.openPath(dlPath);
          }
        },
        { type: 'separator' },
        ...(!isMac ? [
          {
            label: 'Einstellungen…',
            accelerator: 'CmdOrCtrl+,',
            click: () => openConfigWindow()
          },
          { type: 'separator' },
          {
            label: 'Nach Updates suchen…',
            click: () => checkForUpdates(true)
          },
          { type: 'separator' }
        ] : []),
        isMac ? { role: 'close', label: 'Fenster schließen' } : { role: 'quit', label: 'Beenden' }
      ]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' }
      ]
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'forceReload', label: 'Erzwungenes Neuladen' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Originalgröße' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' }
      ]
    },
    {
      label: 'Fenster',
      submenu: [
        { role: 'minimize', label: 'Minimieren' },
        { role: 'zoom', label: 'Maximieren' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front', label: 'Alle nach vorne bringen' }
        ] : [
          { role: 'close', label: 'Schließen' }
        ])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Auto-Start ────────────────────────────────────────────────

function setupAutoStart() {
  const config = store.load();
  app.setLoginItemSettings({
    openAtLogin: !!config.autoStart,
    path: process.execPath
  });
}

// ── Auto-Updater ──────────────────────────────────────────────

let autoUpdaterReady = false;
let manualUpdateCheck = false;

function initAutoUpdater() {
  const { autoUpdater } = require('electron-updater');

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    const win = mainWindow || setupWindow;
    if (!win) return;
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update verfügbar',
      message: `Version ${info.version} ist verfügbar.`,
      detail: 'Möchten Sie das Update jetzt herunterladen?',
      buttons: ['Herunterladen', 'Später'],
      defaultId: 0
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck) {
      const win = mainWindow || setupWindow;
      if (win) {
        dialog.showMessageBox(win, {
          type: 'info',
          title: 'Kein Update',
          message: 'Sie verwenden bereits die neueste Version.'
        });
      }
    }
  });

  autoUpdater.on('update-downloaded', () => {
    const win = mainWindow || setupWindow;
    if (!win) return;
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update bereit',
      message: 'Das Update wurde heruntergeladen.',
      detail: 'Die App wird jetzt neu gestartet, um das Update zu installieren.',
      buttons: ['Jetzt neu starten', 'Später']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    if (manualUpdateCheck) {
      const win = mainWindow || setupWindow;
      if (win) {
        dialog.showMessageBox(win, {
          type: 'error',
          title: 'Update-Fehler',
          message: 'Beim Suchen nach Updates ist ein Fehler aufgetreten.',
          detail: err ? err.message : 'Bitte prüfen Sie Ihre Internetverbindung.'
        });
      }
    }
  });

  return autoUpdater;
}

function checkForUpdates(manual = false) {
  try {
    const { autoUpdater } = require('electron-updater');

    manualUpdateCheck = manual;

    if (!autoUpdaterReady) {
      initAutoUpdater();
      autoUpdaterReady = true;
    }

    autoUpdater.checkForUpdates().catch((err) => {
      if (manual) {
        const win = mainWindow || setupWindow;
        if (win) {
          dialog.showMessageBox(win, {
            type: 'error',
            title: 'Update-Fehler',
            message: 'Beim Suchen nach Updates ist ein Fehler aufgetreten.',
            detail: err ? err.message : 'Bitte prüfen Sie Ihre Internetverbindung.'
          });
        }
      }
    });
  } catch (_) {
    // electron-updater not available in dev mode
  }
}

// ── IPC Handlers ──────────────────────────────────────────────

ipcMain.handle('get-config', () => {
  const config = store.load();
  // Attach the launch URL so the setup wizard can pre-fill the server field.
  config._launchSiteUrl = getLaunchSiteUrl();
  return config;
});

ipcMain.handle('save-config', (_event, config) => {
  const oldUrl = store.get('siteUrl');
  store.save(config);

  // Update autostart setting
  if ('autoStart' in config) {
    app.setLoginItemSettings({
      openAtLogin: !!config.autoStart,
      path: process.execPath
    });
  }

  if (config.siteUrl && config.siteUrl !== oldUrl && mainWindow && !mainWindow.isDestroyed()) {
    loadSite(config.siteUrl);
    buildMenu();
  }
  return true;
});

ipcMain.handle('finish-setup', () => {
  if (setupWindow) {
    setupWindow.close();
  }
  createMainWindow();
  return true;
});

ipcMain.handle('test-connection', async (_event, url) => {
  return new Promise((resolve) => {
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    const request = net.request({
      url: normalizedUrl,
      method: 'HEAD',
      redirect: 'follow'
    });

    const timeout = setTimeout(() => {
      request.abort();
      resolve({ ok: false, error: 'Timeout' });
    }, 10000);

    request.on('response', (response) => {
      clearTimeout(timeout);
      resolve({ ok: response.statusCode < 400, statusCode: response.statusCode });
    });

    request.on('error', (error) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: error.message });
    });

    request.end();
  });
});

ipcMain.handle('select-directory', async () => {
  const win = configWindow || setupWindow || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Download-Ordner wählen'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('open-file', async (_event, filePath) => {
  if (fs.existsSync(filePath)) {
    return shell.openPath(filePath);
  }
  return 'Datei nicht gefunden';
});

ipcMain.handle('show-in-folder', (_event, filePath) => {
  if (fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

// ── Helpers ───────────────────────────────────────────────────

function getIconPath() {
  // Try PNG first (for production builds), fallback to SVG
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(pngPath)) return pngPath;

  const buildPng = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(buildPng)) return buildPng;

  return path.join(__dirname, 'assets', 'icon.svg');
}
