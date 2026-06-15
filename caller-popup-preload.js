const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callerPopup', {
  // Empfängt die Anrufdaten vom Hauptprozess.
  onData: (callback) => ipcRenderer.on('threecx:data', (_event, data) => callback(data)),
  // Navigiert das Hauptfenster zur übergebenen URL (Kunde/Projekt/Neuanlage) und schließt das Popup.
  openUrl: (url) => ipcRenderer.invoke('threecx:open-url', url),
  // Speichert Notiz/Name/Projekt zu einem Anruf.
  saveNote: (data) => ipcRenderer.invoke('threecx:save-note', data),
  // Bricht das automatische Ausblenden ab (sobald der Nutzer interagiert).
  keepOpen: () => ipcRenderer.invoke('threecx:keep-open'),
  // Schließt (versteckt) das Popup.
  close: () => ipcRenderer.invoke('threecx:close-popup'),
});
