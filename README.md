# ProjektManager Pro – Desktop App

Native Desktop-App (macOS, Windows, Linux) als Wrapper für die ProjektManager Pro WordPress-Anwendung.

## Download

Laden Sie die passende Version für Ihr Betriebssystem herunter:

| Betriebssystem | Datei | Hinweis |
|---|---|---|
| **Windows** | `.exe` Installer | Windows 10 oder neuer |
| **macOS** | `.dmg` Disk Image | macOS 11 oder neuer (Intel + Apple Silicon) |
| **Linux** | `.AppImage` / `.deb` | Ubuntu 20.04 oder neuer |

**[Zum Download (Releases)](../../releases/latest)**

### Installation

1. Laden Sie die passende Datei für Ihr Betriebssystem herunter.
2. Installieren bzw. starten Sie die App.
3. Geben Sie beim ersten Start Ihre Server-URL ein (z.B. `https://meine-seite.de`).

Die App verbindet sich dann mit Ihrer ProjektManager Pro WordPress-Installation.

### Automatische Updates

Die App prüft beim Start automatisch auf neue Versionen. Wenn ein Update verfügbar ist, werden Sie benachrichtigt und können es direkt herunterladen und installieren.

## Funktionen

- **Lokale Dateien öffnen**: Downloads werden automatisch lokal gespeichert und mit dem Standard-Programm geöffnet.
- **Download-Ordner**: Konfigurierbar über die Einstellungen.
- **Native Benachrichtigungen**: Download-Abschluss-Meldungen direkt im OS.
- **Menüleiste**: Vollständige deutsche Menüleiste (Datei, Bearbeiten, Ansicht, Fenster).
- **Fensterposition merken**: Die App merkt sich Größe und Position.
- **Externe Links**: Werden automatisch im Standard-Browser geöffnet.
- **Automatische Updates**: Die App prüft beim Start auf neue Versionen.

## Für Entwickler

### Voraussetzungen

- [Node.js](https://nodejs.org/) (v18 oder neuer)
- npm (kommt mit Node.js)

### Installation

```bash
npm install
```

### Entwicklung / Testen

```bash
npm start
```

### App erstellen

```bash
# macOS (.app / .dmg)
npm run build:mac

# Windows (.exe)
npm run build:win

# Linux (.AppImage / .deb)
npm run build:linux
```

Die fertigen Dateien liegen dann im Ordner `dist/`.

### Icons

Das Standard-Icon ist ein SVG. Für den Build wird ein PNG benötigt:

```bash
npm install --save-dev sharp
node scripts/generate-icons.js
```

Alternativ können Sie manuell ein 512x512 PNG als `assets/icon.png` ablegen.

## Architektur

```
├── main.js          # Electron Hauptprozess
├── preload.js       # Sichere Brücke zwischen Web und Native
├── setup.html       # Einrichtungsassistent (UI)
├── setup.js         # Einrichtungsassistent (Logik)
├── config.html      # Einstellungsfenster (UI)
├── config.js        # Einstellungsfenster (Logik)
├── store.js         # Konfigurationsspeicher (JSON-Datei)
├── assets/
│   └── icon.svg     # App-Icon
├── build/
│   ├── installer.nsh  # Windows Installer-Konfiguration
│   └── license.txt    # Lizenztext
├── scripts/
│   └── generate-icons.js  # Icon-Konvertierung
└── package.json     # Abhängigkeiten & Build-Konfiguration
```

## Lizenz

Copyright © 2026 KreativBunker
