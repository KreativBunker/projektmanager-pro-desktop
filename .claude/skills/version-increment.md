# Skill: Versionserhöhung bei Merge

## Beschreibung

Bei jedem Merge in den `main`-Branch (z.B. durch Pull Requests oder direkte Merges) **muss** die Softwareversion in `package.json` erhöht werden. Diese Regel ist verbindlich und darf nicht übersprungen werden.

## Regeln

1. **Pflicht**: Jeder Merge in `main` erfordert eine Versionserhöhung in `package.json` im Feld `"version"`.
2. **Semantic Versioning (SemVer)** wird verwendet: `MAJOR.MINOR.PATCH` (z.B. `1.2.3`)
3. **Welche Stelle erhöht wird**, richtet sich nach der Art der Änderungen:
   - **PATCH** (z.B. `1.0.0` → `1.0.1`): Bugfixes, kleine Korrekturen, Textänderungen
   - **MINOR** (z.B. `1.0.1` → `1.1.0`): Neue Features, Verbesserungen, neue Funktionalität (PATCH wird auf 0 zurückgesetzt)
   - **MAJOR** (z.B. `1.1.0` → `2.0.0`): Breaking Changes, grundlegende Architekturänderungen, Inkompatibilitäten (MINOR und PATCH werden auf 0 zurückgesetzt)

## Ablauf

Wenn ein Merge vorbereitet oder ein Pull Request erstellt wird:

1. **Prüfe** die aktuelle Version in `package.json`
2. **Analysiere** die Änderungen im Branch und bestimme die Art (Bugfix/Feature/Breaking Change)
3. **Erhöhe** die passende Versionsnummer nach SemVer
4. **Committe** die Versionsänderung zusammen mit den anderen Änderungen oder als separaten Commit

## Beispiel

```bash
# Aktuelle Version: 1.0.0

# Bei einem Bugfix:
# → 1.0.1

# Bei einem neuen Feature:
# → 1.1.0

# Bei einem Breaking Change:
# → 2.0.0
```

## Versionsdatei

- **Datei**: `package.json`
- **Feld**: `"version"`
- Diese Version wird automatisch von `electron-builder` für alle Plattform-Builds und von `electron-updater` für Auto-Updates verwendet.

## Wichtig

- Vergiss **niemals** die Version zu erhöhen, wenn Änderungen in `main` gemergt werden
- Bei Unsicherheit über die Art der Versionserhöhung: Frage den Benutzer
- Die Versionserhöhung muss **vor** dem Merge-Commit erfolgen
