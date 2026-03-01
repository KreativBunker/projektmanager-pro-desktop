!macro customHeader
  !system "echo '' > /dev/null"
!macroend

!macro preInit
  ; Prüfe ob bereits installiert
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\{${APP_ID}}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
!macroend

!macro customInstall
  ; Desktop-Verknüpfung erstellen
  CreateShortCut "$DESKTOP\ProjektManager Pro.lnk" "$INSTDIR\ProjektManager Pro.exe" "" "$INSTDIR\ProjektManager Pro.exe" 0

  ; Autostart-Eintrag (optional, deaktiviert per default)
  ; WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ProjektManager Pro" "$INSTDIR\ProjektManager Pro.exe --hidden"

  ; Dateizuordnungen für .pmp Dateien
  WriteRegStr HKCR ".pmp" "" "ProjektManagerPro.File"
  WriteRegStr HKCR "ProjektManagerPro.File" "" "ProjektManager Pro Datei"
  WriteRegStr HKCR "ProjektManagerPro.File\DefaultIcon" "" "$INSTDIR\ProjektManager Pro.exe,0"
  WriteRegStr HKCR "ProjektManagerPro.File\shell\open\command" "" '"$INSTDIR\ProjektManager Pro.exe" "%1"'

  ; URL-Protokoll pmp:// registrieren
  WriteRegStr HKCR "pmp" "" "URL:ProjektManager Pro Protocol"
  WriteRegStr HKCR "pmp" "URL Protocol" ""
  WriteRegStr HKCR "pmp\DefaultIcon" "" "$INSTDIR\ProjektManager Pro.exe,0"
  WriteRegStr HKCR "pmp\shell\open\command" "" '"$INSTDIR\ProjektManager Pro.exe" "%1"'
!macroend

!macro customUnInstall
  ; Desktop-Verknüpfung entfernen
  Delete "$DESKTOP\ProjektManager Pro.lnk"

  ; Autostart entfernen
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ProjektManager Pro"

  ; Dateizuordnungen entfernen
  DeleteRegKey HKCR ".pmp"
  DeleteRegKey HKCR "ProjektManagerPro.File"
  DeleteRegKey HKCR "pmp"
!macroend
