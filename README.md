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

## 3CX-Telefonie (zweiter Tab)

Bei aktivierter 3CX-Integration (Einstellungen → 3CX-Telefonie) zeigt das Hauptfenster eine Tab-Leiste:

- **ProjektManager** – die WordPress-Anwendung wie bisher (`Strg/Cmd+1`)
- **Telefon (3CX)** – der eingebettete 3CX-Web-Client (`Strg/Cmd+2`)

Der Web-Client läuft auch im Hintergrund weiter, wenn der ProjektManager-Tab aktiv ist, damit eingehende Anrufe erkannt werden. Rechts in der Tab-Leiste steht dauerhaft der **Verbindungsstatus zur Telefonanlage**:

| Status | Bedeutung |
|---|---|
| 🟢 Verbunden | Web-Client geladen, Telefonanlage erreichbar |
| 🟡 Verbinde… | Web-Client wird geladen |
| 🟡 Anmeldung erforderlich | Der Web-Client zeigt die Login-Seite – ohne Anmeldung keine Anruferkennung |
| 🔴 Keine Verbindung | Telefonanlage nicht erreichbar, Ladefehler oder Verbindungsverlust im Web-Client |
| 🔴 Fehler | Web-Client abgestürzt/hängt – wird automatisch neu gestartet |

Bei Ausfall verbindet die App automatisch neu (5 s … 60 s Abstand), prüft alle 30 s die Erreichbarkeit der Anlage und zeigt im Telefon-Tab einen Hinweis mit „Jetzt neu verbinden". Beim Übergang von „Verbunden" zu „Keine Verbindung" erscheint einmalig eine Systembenachrichtigung. Das Schließen des Hauptfensters versteckt es bei aktiver 3CX-Integration nur (Telefon läuft weiter); Beenden über Menü oder Tray.

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
├── electron-builder.js  # Build-Konfiguration (electron-builder)
└── package.json     # Abhängigkeiten
```

## Lizenz

Copyright © 2026 KreativBunker
