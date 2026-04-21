const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('inearDesktop', {
  isElectron: true,
  apiBase: () => 'http://127.0.0.1:3847',
  /** macOS / Windows: pede permissão de microfone ao sistema (TCC / privacidade). */
  requestCapturePermission: () =>
    ipcRenderer.invoke('inear:request-capture-permission'),
})
