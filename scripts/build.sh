#!/bin/bash
# ============================================================
# ProjektManager Pro – Desktop App Build Script
# Erstellt Setup-Dateien für macOS, Windows und Linux
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo ""
echo "========================================"
echo " ProjektManager Pro – Desktop App Build"
echo "========================================"
echo ""

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Prüfe Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Fehler: Node.js ist nicht installiert.${NC}"
    echo "Bitte installieren Sie Node.js von https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Fehler: Node.js v18+ wird benötigt (aktuell: $(node -v)).${NC}"
    exit 1
fi

echo -e "${GREEN}Node.js $(node -v) gefunden.${NC}"

# macOS Code Signing & Notarisierung prüfen
if [ "$(uname -s)" = "Darwin" ]; then
    echo ""
    if [ -z "$CSC_LINK" ]; then
        echo -e "${YELLOW}Hinweis: Kein Code-Signing-Zertifikat konfiguriert.${NC}"
        echo "  Die App wird NICHT signiert – macOS Gatekeeper wird warnen."
        echo ""
        echo "  Für signierte Builds setze folgende Umgebungsvariablen:"
        echo "    CSC_LINK          – Pfad zur .p12 Zertifikatsdatei (oder base64)"
        echo "    CSC_KEY_PASSWORD  – Passwort des Zertifikats"
        echo ""
    else
        echo -e "${GREEN}Code-Signing-Zertifikat gefunden.${NC}"
    fi

    if [ -z "$APPLE_ID" ] || [ -z "$APPLE_TEAM_ID" ]; then
        echo -e "${YELLOW}Hinweis: Keine Notarisierungs-Credentials konfiguriert.${NC}"
        echo "  Die App wird NICHT notarisiert – macOS Gatekeeper wird warnen."
        echo ""
        echo "  Für notarisierte Builds setze folgende Umgebungsvariablen:"
        echo "    APPLE_ID           – Deine Apple-ID (E-Mail)"
        echo "    APPLE_ID_PASSWORD  – App-spezifisches Passwort"
        echo "    APPLE_TEAM_ID      – Team-ID aus dem Apple Developer Portal"
        echo ""
    else
        echo -e "${GREEN}Notarisierungs-Credentials gefunden.${NC}"
    fi
fi

# Abhängigkeiten installieren
echo ""
echo "Installiere Abhängigkeiten..."
npm install
echo -e "${GREEN}Abhängigkeiten installiert.${NC}"

# Icons generieren (wenn sharp verfügbar)
echo ""
echo "Generiere Icons..."
if node -e "require('sharp')" 2>/dev/null; then
    node scripts/generate-icons.js
    echo -e "${GREEN}Icons generiert.${NC}"
else
    echo -e "${YELLOW}sharp nicht installiert – versuche Installation...${NC}"
    npm install --save-dev sharp 2>/dev/null && node scripts/generate-icons.js || {
        echo -e "${YELLOW}Icon-Generierung übersprungen.${NC}"
        echo "Legen Sie manuell ein 512x512 icon.png in build/ ab."
    }
fi

# Plattform erkennen und bauen
echo ""
PLATFORM="${1:-auto}"

if [ "$PLATFORM" = "auto" ]; then
    case "$(uname -s)" in
        Darwin*)    PLATFORM="mac" ;;
        Linux*)     PLATFORM="linux" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="win" ;;
        *)          PLATFORM="all" ;;
    esac
fi

case "$PLATFORM" in
    mac)
        echo "Erstelle macOS Setup (.app / .dmg)..."
        npx electron-builder --mac
        ;;
    win)
        echo "Erstelle Windows Setup (.exe)..."
        npx electron-builder --win
        ;;
    linux)
        echo "Erstelle Linux Setup (.AppImage / .deb)..."
        npx electron-builder --linux
        ;;
    all)
        echo "Erstelle Setup-Dateien für alle Plattformen..."
        npx electron-builder -mwl
        ;;
    *)
        echo -e "${RED}Unbekannte Plattform: $PLATFORM${NC}"
        echo "Nutzung: $0 [mac|win|linux|all]"
        exit 1
        ;;
esac

echo ""
echo "========================================"
echo -e "${GREEN} Build abgeschlossen!${NC}"
echo "========================================"
echo ""
echo "Setup-Dateien befinden sich in:"
echo "  $PROJECT_DIR/dist/"
echo ""
ls -lh "$PROJECT_DIR/dist/" 2>/dev/null | grep -E '\.(dmg|exe|AppImage|deb|rpm|zip)$' || echo "  (Dateien werden generiert...)"
echo ""

# macOS: Signierung-Status anzeigen
if [ "$(uname -s)" = "Darwin" ] && [ "$PLATFORM" = "mac" ]; then
    APP_PATH=$(find "$PROJECT_DIR/dist/mac"* -name "*.app" -maxdepth 1 2>/dev/null | head -1)
    if [ -n "$APP_PATH" ]; then
        echo "Code-Signing-Status:"
        codesign --verify --deep --strict "$APP_PATH" 2>&1 && \
            echo -e "  ${GREEN}App ist korrekt signiert.${NC}" || \
            echo -e "  ${YELLOW}App ist NICHT signiert.${NC}"
        echo ""
    fi
fi
