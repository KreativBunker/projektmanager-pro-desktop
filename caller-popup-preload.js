const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('callerPopup', {
  // Empfängt die Anrufdaten vom Hauptprozess.
  onData: (callback) => ipcRenderer.on('threecx:data', (_event, data) => callback(data)),
  // Navigiert das Hauptfenster zur übergebenen URL (Kunde/Projekt) und schließt das Popup.
  openUrl: (url) => ipcRenderer.invoke('threecx:open-url', url),
  // Schließt (versteckt) das Popup.
  close: () => ipcRenderer.invoke('threecx:close-popup'),
});
