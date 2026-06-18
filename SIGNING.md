# macOS Code-Signing & Notarisierung

Damit der macOS-Schlüsselbund-Dialog („… möchte deine vertraulichen
Informationen verwenden") **dauerhaft** mit „Immer erlauben" wegklickbar bleibt,
muss die App mit einer **stabilen Apple-Developer-ID** signiert (und für die
Verteilung notarisiert) werden.

## Warum ist das nötig?

Der Schlüsselbund bindet die Berechtigung „Immer erlauben" an die
**Code-Signatur** der App. Bisher wurde die App **Ad-hoc** signiert
(`identity: "-"`) – diese Signatur ist bei **jedem Build anders**. Nach jedem
Update sieht macOS die App deshalb als „neu/unbekannt" und fragt erneut nach dem
Passwort.

Mit einer echten **Developer-ID-Application**-Signatur bleibt die Identität über
alle Versionen hinweg gleich → „Immer erlauben" hält dauerhaft.

> Hinweis: Der Code wurde zusätzlich so geändert, dass das Speichern einer
> Anruf-Notiz **gar nicht mehr** auf den Schlüsselbund zugreift (der Login-Name
> wird im Klartext gespiegelt). Der verbleibende Zugriff betrifft nur noch das
> Auto-Login beim Programmstart – und genau dort hilft die stabile Signatur.

## Was ist bereits eingerichtet?

- `package.json` → `mac`: kein erzwungenes Ad-hoc mehr (`identity` entfernt),
  `hardenedRuntime: true` (Voraussetzung für Notarisierung), Entitlements
  hinterlegt. `forceCodeSigning: false` → Builds **ohne** Zertifikat schlagen
  nicht fehl (ergeben dann nur eine unsignierte App).
- `scripts/notarize.js` → `afterSign`-Hook: notarisiert **nur**, wenn die
  Apple-Credentials gesetzt sind, und stapelt die App anschließend.
- `.github/workflows/build-and-release.yml` → liest die unten genannten Secrets
  bereits aus. Ohne Secrets bleibt alles unsigniert; mit Secrets wird signiert +
  notarisiert. **Es muss nichts am Workflow geändert werden.**

## Benötigte GitHub-Secrets

Unter **Repository → Settings → Secrets and variables → Actions** anlegen:

| Secret | Inhalt |
| --- | --- |
| `MAC_CERTIFICATE_P12` | Das **Developer-ID-Application**-Zertifikat als `.p12`, **Base64-codiert** |
| `MAC_CERTIFICATE_PASSWORD` | Passwort des `.p12`-Exports |
| `APPLE_ID` | Apple-ID (E-Mail) des Developer-Accounts |
| `APPLE_ID_PASSWORD` | **App-spezifisches Passwort** (nicht das normale Apple-ID-Passwort) |
| `APPLE_TEAM_ID` | Team-ID aus dem Apple Developer Portal (10 Zeichen) |

### Zertifikat exportieren & codieren

1. In **Schlüsselbundverwaltung** das Zertifikat **„Developer ID Application:
   …"** (inkl. privatem Schlüssel) als `.p12` exportieren.
2. Base64 erzeugen:
   ```bash
   base64 -i DeveloperID.p12 | pbcopy
   ```
   Den Inhalt als `MAC_CERTIFICATE_P12` einfügen.

### App-spezifisches Passwort erstellen

1. <https://account.apple.com> → Anmeldung & Sicherheit → **App-spezifische
   Passwörter**.
2. Neues Passwort erzeugen und als `APPLE_ID_PASSWORD` hinterlegen.

### Team-ID finden

<https://developer.apple.com/account> → **Membership** → „Team ID".

## Lokaler signierter Build (optional)

```bash
export CSC_LINK="$(base64 -i DeveloperID.p12)"
export CSC_KEY_PASSWORD="<p12-passwort>"
export APPLE_ID="<apple-id>"
export APPLE_ID_PASSWORD="<app-spezifisches-passwort>"
export APPLE_TEAM_ID="<team-id>"
npm run build:mac
```

Ohne diese Variablen entsteht weiterhin ein unsignierter (lokal lauffähiger)
Build.

## „Dennoch öffnen" funktioniert nicht / App ist „beschädigt"

Eine **nicht notarisierte** App bekommt beim Download das macOS-Quarantäne-
Attribut. Auf Apple Silicon meldet macOS dann oft „… ist beschädigt und kann
nicht geöffnet werden" – und „Dennoch öffnen" hilft nicht. Das ist **kein**
echter Schaden, sondern Gatekeeper.

**Sofort-Workaround** (bis die Notarisierung eingerichtet ist): App in den Ordner
`Programme` verschieben und im Terminal das Quarantäne-Attribut entfernen:

```bash
xattr -dr com.apple.quarantine "/Applications/ProjektManager Pro.app"
```

Danach lässt sich die App normal per Doppelklick starten.

> Lasting fix: Sobald die oben genannten Secrets gesetzt sind, ist die App
> Developer-ID-signiert **und notarisiert** – dann entfällt der Dialog komplett,
> ganz ohne Terminal.

## Prüfen, ob es funktioniert hat

```bash
# Signatur prüfen (sollte "Developer ID Application: …" zeigen)
codesign -dvvv "ProjektManager Pro.app"

# Notarisierung/Stapling prüfen (sollte "accepted" / "source=Notarized" zeigen)
spctl -a -vvv -t install "ProjektManager Pro.app"
xcrun stapler validate "ProjektManager Pro.app"
```
