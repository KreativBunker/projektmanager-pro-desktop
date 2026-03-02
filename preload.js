const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pmpDesktop', {
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Setup
  testConnection: (url) => ipcRenderer.invoke('test-connection', url),
  finishSetup: () => ipcRenderer.invoke('finish-setup'),

  // File system
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  openNasFolder: (relativePath) => ipcRenderer.invoke('open-nas-folder', relativePath),
  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),

  // Notifications
  showNotification: (data) => ipcRenderer.invoke('show-notification', data),
  updateBadge: (count) => ipcRenderer.invoke('update-badge', count),
  getNotificationSettings: () => ipcRenderer.invoke('get-notification-settings'),
  onNotificationNavigate: (callback) => {
    ipcRenderer.on('notification-navigate', (_event, data) => callback(data));
  },

  // Info
  isDesktopApp: true
});
