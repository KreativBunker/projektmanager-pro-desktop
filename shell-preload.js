// Sicherheitsbrücke für die Tab-Leiste des Hauptfensters (shell.html).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pmpShell', {
  // Tab wechseln: 'site' (ProjektManager) oder 'phone' (3CX-Telefon)
  selectTab: (tab) => ipcRenderer.invoke('shell:select-tab', tab),
  // Aktuellen Zustand (aktiver Tab, Tab-Leiste sichtbar, 3CX-Status) abrufen
  getState: () => ipcRenderer.invoke('shell:get-state'),
  // Zustandsänderungen empfangen
  onState: (callback) => ipcRenderer.on('shell:state', (_event, state) => callback(state)),
  // 3CX: sofort neu verbinden
  reconnectPhone: () => ipcRenderer.invoke('threecx:reconnect'),
  // Einstellungen öffnen
  openSettings: () => ipcRenderer.invoke('shell:open-settings'),
});
