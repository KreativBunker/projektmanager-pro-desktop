# ProjektManager Pro – Desktop App

Native Desktop-App (macOS .app, Windows .exe, Linux .AppImage) als Wrapper für die ProjektManager Pro WordPress-Anwendung.

## Voraussetzungen

- [Node.js](https://nodejs.org/) (v18 oder neuer)
- npm (kommt mit Node.js)

## Installation

```bash
cd projektmanager-pro/desktop-app
npm install
```

## Entwicklung / Testen

```bash
npm start
```

Beim ersten Start öffnet sich das Einstellungsfenster. Geben Sie die URL Ihrer WordPress-Installation ein (z.B. `https://meine-seite.de`).

## App erstellen

### macOS (.app / .dmg)

```bash
npm run build:mac
```

### Windows (.exe)

```bash
npm run build:win
```

### Linux (.AppImage / .deb)

```bash
npm run build:linux
```

Die fertigen Dateien liegen dann im Ordner `dist/`.

## Icons

Das Standard-Icon ist ein SVG. Für den Build wird ein PNG benötigt:

```bash
npm install --save-dev sharp
node scripts/generate-icons.js
```

Alternativ können Sie manuell ein 512x512 PNG als `assets/icon.png` ablegen.

## Funktionen

- **Lokale Dateien öffnen**: Downloads werden automatisch lokal gespeichert und mit dem Standard-Programm geöffnet.
- **Download-Ordner**: Konfigurierbar über die Einstellungen.
- **Native Benachrichtigungen**: Download-Abschluss-Meldungen direkt im OS.
- **Menüleiste**: Vollständige deutsche Menüleiste (Datei, Bearbeiten, Ansicht, Fenster).
- **Fensterposition merken**: Die App merkt sich Größe und Position.
- **Externe Links**: Werden automatisch im Standard-Browser geöffnet.

## Architektur

```
desktop-app/
├── main.js          # Electron Hauptprozess
├── preload.js       # Sichere Brücke zwischen Web und Native
├── config.html      # Einstellungsfenster (UI)
├── config.js        # Einstellungsfenster (Logik)
├── store.js         # Konfigurationsspeicher (JSON-Datei)
├── assets/
│   └── icon.svg     # App-Icon
├── scripts/
│   └── generate-icons.js  # Icon-Konvertierung
└── package.json     # Abhängigkeiten & Build-Konfiguration
```
