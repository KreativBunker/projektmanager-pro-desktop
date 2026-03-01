@echo off
REM ============================================================
REM ProjektManager Pro – Desktop App Build Script (Windows)
REM Erstellt Setup-Dateien (.exe Installer)
REM ============================================================

setlocal enabledelayedexpansion

cd /d "%~dp0\.."

echo.
echo ========================================
echo  ProjektManager Pro – Desktop App Build
echo ========================================
echo.

REM Pruefe Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo FEHLER: Node.js ist nicht installiert.
    echo Bitte installieren Sie Node.js von https://nodejs.org/
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
echo Node.js gefunden.

REM Abhaengigkeiten installieren
echo.
echo Installiere Abhaengigkeiten...
call npm install
if %errorlevel% neq 0 (
    echo FEHLER: npm install fehlgeschlagen.
    exit /b 1
)
echo Abhaengigkeiten installiert.

REM Icons generieren
echo.
echo Generiere Icons...
call node scripts/generate-icons.js 2>nul
if %errorlevel% neq 0 (
    echo Icon-Generierung uebersprungen.
    echo Installieren Sie sharp: npm install --save-dev sharp
    echo Oder legen Sie manuell ein 512x512 icon.png in build\ ab.
)

REM Build starten
echo.
set PLATFORM=%1
if "%PLATFORM%"=="" set PLATFORM=win

if "%PLATFORM%"=="win" (
    echo Erstelle Windows Setup...
    call npx electron-builder --win
) else if "%PLATFORM%"=="all" (
    echo Erstelle Setup-Dateien fuer alle Plattformen...
    call npx electron-builder -mwl
) else (
    echo Erstelle Setup fuer %PLATFORM%...
    call npx electron-builder --%PLATFORM%
)

if %errorlevel% neq 0 (
    echo.
    echo FEHLER: Build fehlgeschlagen.
    exit /b 1
)

echo.
echo ========================================
echo  Build abgeschlossen!
echo ========================================
echo.
echo Setup-Dateien befinden sich in:
echo   %cd%\dist\
echo.
dir /b dist\*.exe dist\*.dmg dist\*.AppImage dist\*.deb 2>nul
echo.

endlocal
