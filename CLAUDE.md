# ProjektManager Pro – Desktop App

## Projektübersicht

Electron-basierte Desktop-App für ProjektManager Pro (WordPress). Unterstützt macOS, Windows und Linux.

## Technologie

- **Runtime**: Electron 33+
- **Auto-Updates**: electron-updater (GitHub Releases)
- **Build-System**: electron-builder
- **Sprache**: JavaScript (Node.js)

## Projektstruktur

- `main.js` – Electron Hauptprozess
- `preload.js` – Sicherheitsbrücke (Context Bridge)
- `setup.js` / `setup.html` – Einrichtungsassistent
- `config.js` / `config.html` – Einstellungsfenster
- `store.js` – Konfigurationsspeicher (JSON)
- `scripts/` – Build- und Hilfsskripte
- `assets/` – Icons und Ressourcen

## Verbindliche Regeln

### Versionserhöhung bei Merge

**Bei jedem Merge in `main` muss die Version in `package.json` erhöht werden.**

- Verwende Semantic Versioning: `MAJOR.MINOR.PATCH`
- PATCH: Bugfixes, kleine Korrekturen
- MINOR: Neue Features, Verbesserungen
- MAJOR: Breaking Changes, Inkompatibilitäten
- Details siehe: `.claude/skills/version-increment.md`

## Build & Release

- Builds werden durch Git-Tags (`v*`) via GitHub Actions ausgelöst
- Workflow: `.github/workflows/build-and-release.yml`
- Zielplattformen: macOS (dmg/zip), Windows (nsis/portable), Linux (AppImage/deb/rpm)
