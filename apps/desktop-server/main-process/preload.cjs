const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('inearDesktop', {
  isElectron: true,
  apiBase: () => 'http://127.0.0.1:3847',
})
