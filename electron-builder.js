// ============================================================
// ProjektManager Pro – electron-builder-Konfiguration
//
// Als JS-Datei (statt "build" in package.json), damit die macOS-Signierung
// zur Build-Zeit von den vorhandenen Credentials abhängen kann:
//
//   * Developer-ID vorhanden (CSC_LINK oder CSC_NAME gesetzt):
//       echte Signatur + Hardened Runtime, Notarisierung via afterSign-Hook.
//   * Kein Zertifikat:
//       Ad-hoc-Signatur (identity "-"). Ohne JEDE Signatur meldet macOS auf
//       Apple Silicon "App ist beschädigt und kann nicht geöffnet werden" –
//       nicht umgehbar. Ad-hoc ergibt stattdessen das per Rechtsklick → Öffnen
//       umgehbare "unbekannter Entwickler". Hardened Runtime bleibt hier aus,
//       weil Ad-hoc + Hardened Runtime ohne Notarisierung zu Startfehlern
//       (Library Validation) führt.
//
// Ein festes identity "-" in der Konfiguration würde die Developer-ID
// aushebeln: electron-builder sucht dann ein Zertifikat mit "-" im Namen,
// findet keines und signiert wieder nur ad-hoc.
// ============================================================

const hasDeveloperId = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);

const macSigning = hasDeveloperId
  ? {
      // identity wird automatisch aus CSC_LINK / CSC_NAME ermittelt
      hardenedRuntime: true,
      // Notarisierung übernimmt scripts/notarize.js (afterSign)
      notarize: false,
    }
  : {
      identity: '-',
      hardenedRuntime: false,
      notarize: false,
    };

/** @type {import('electron-builder').Configuration} */
module.exports = {
  "appId": "com.projektmanager.pro",
  "productName": "ProjektManager Pro",
  "copyright": "Copyright © 2026 KreativBunker",
  "artifactName": "ProjektManager-Pro-${version}-${arch}.${ext}",
  "directories": {
    "output": "dist",
    "buildResources": "build"
  },
  "files": [
    "main.js",
    "preload.js",
    "shell.html",
    "shell.js",
    "shell-preload.js",
    "setup.html",
    "setup.js",
    "config.html",
    "config.js",
    "store.js",
    "credentials.js",
    "threecx.js",
    "caller-popup.html",
    "caller-popup.js",
    "caller-popup-preload.js",
    "assets/**/*"
  ],
  "dmg": {
    "sign": false,
    "writeUpdateInfo": false,
    "background": "build/background.tiff",
    "title": "ProjektManager-Pro"
  },
  "win": {
    "icon": "build/icon.png",
    "target": [
      {
        "target": "nsis",
        "arch": [
          "x64",
          "ia32"
        ]
      },
      {
        "target": "portable",
        "arch": [
          "x64"
        ]
      }
    ]
  },
  "nsis": {
    "artifactName": "ProjektManager-Pro-Setup-${version}-${arch}.${ext}",
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "allowElevation": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "ProjektManager Pro",
    "license": "build/license.txt",
    "language": "1031",
    "include": "build/installer.nsh",
    "deleteAppDataOnUninstall": false,
    "menuCategory": "ProjektManager Pro"
  },
  "linux": {
    "icon": "build/icons",
    "category": "Office",
    "desktop": {
      "entry": {
        "StartupWMClass": "projektmanager-pro"
      }
    },
    "target": [
      "AppImage",
      "deb",
      "rpm"
    ]
  },
  "deb": {
    "depends": [
      "libgtk-3-0",
      "libnotify4",
      "libnss3",
      "libxss1",
      "libxtst6"
    ],
    "category": "Office"
  },
  "publish": {
    "provider": "github",
    "owner": "KreativBunker",
    "repo": "projektmanager-pro-desktop"
  },
  "mac": {
    "category": "public.app-category.business",
    "icon": "build/icon.png",
    "darkModeSupport": true,
    "gatekeeperAssess": false,
    "forceCodeSigning": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.inherit.plist",
    "target": [
      {
        "target": "dmg",
        "arch": [
          "x64",
          "arm64"
        ]
      },
      {
        "target": "zip",
        "arch": [
          "x64",
          "arm64"
        ]
      }
    ],
    ...macSigning,
  },
  "afterSign": "scripts/notarize.js",
};
