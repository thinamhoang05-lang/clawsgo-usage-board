const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hud', {
  getState: () => ipcRenderer.invoke('app:state'),
  refresh: () => ipcRenderer.invoke('app:refresh'),
  setRange: (days) => ipcRenderer.invoke('app:range', days),
  setCollapsed: (value) => ipcRenderer.invoke('app:collapse', value),
  setPinned: (value) => ipcRenderer.invoke('app:pin', value),
  setFollow: (value) => ipcRenderer.invoke('app:follow', value),
  detail: (id) => ipcRenderer.invoke('app:detail', id),
  exportCsv: () => ipcRenderer.invoke('app:export'),
  openApp: () => ipcRenderer.invoke('app:open'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onState: (fn) => {
    const handler = (_event, payload) => fn(payload);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
});
