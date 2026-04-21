const { app, BrowserWindow, ipcMain, systemPreferences, session } = require('electron')
const path = require('path')

/** Pasta %APPDATA%\\inEar Desktop (alinha com NSIS e documentação). */
app.setName('inEar Desktop')

let services
/** Última janela principal (para IPC e getUserMedia). */
let mainWindowRef = null

function setupMediaPermissionHandler() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'microphone') {
      callback(true)
    } else {
      callback(false)
    }
  })
}

/**
 * Pede ao sistema permissão para captura/listagem de áudio (TCC no macOS; privacidade no Windows).
 * @param {import('electron').BrowserWindow | null | undefined} win
 * @returns {Promise<{ ok: boolean; detail: string }>}
 */
async function requestCaptureAudioPermission(win) {
  const out = { ok: false, detail: '' }
  try {
    if (process.platform === 'darwin') {
      const st = systemPreferences.getMediaAccessStatus('microphone')
      if (st !== 'granted') {
        const granted = await systemPreferences.askForMediaAccess('microphone')
        out.ok = Boolean(granted)
        out.detail = granted ? 'macos: microfone autorizado' : 'macos: microfone recusado'
        return out
      }
      out.ok = true
      out.detail = 'macos: já autorizado'
      return out
    }
    if (process.platform === 'win32') {
      if (typeof systemPreferences.askForMediaAccess === 'function') {
        try {
          const granted = await systemPreferences.askForMediaAccess('microphone')
          if (granted) {
            out.ok = true
            out.detail = 'windows: microfone autorizado (Electron)'
            return out
          }
        } catch (e) {
          out.detail = `windows askForMediaAccess: ${e && e.message ? e.message : e}`
        }
      }
      const w =
        win && !win.isDestroyed()
          ? win
          : BrowserWindow.getFocusedWindow() || mainWindowRef
      if (w && !w.isDestroyed() && w.webContents) {
        const r = await w.webContents.executeJavaScript(
          `(async () => {
            try {
              if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                return { ok: false, detail: 'getUserMedia indisponível' }
              }
              const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
              s.getTracks().forEach((t) => t.stop())
              return { ok: true, detail: 'windows: consentimento via navegador' }
            } catch (e) {
              return {
                ok: false,
                detail: e && (e.name + ': ' + (e.message || String(e))),
              }
            }
          })()`,
          true,
        )
        if (r && typeof r === 'object') {
          out.ok = Boolean(r.ok)
          out.detail = String(r.detail || '')
        }
      } else {
        out.detail = 'windows: sem janela para pedir consentimento'
      }
      return out
    }
    out.ok = true
    out.detail = 'plataforma sem pedido explícito'
    return out
  } catch (e) {
    out.detail = String(e && e.message ? e.message : e)
    return out
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindowRef = win

  win.webContents.once('did-finish-load', () => {
    void requestCaptureAudioPermission(win).then((r) => {
      console.info('[inear] Permissão de captura de áudio:', r.detail, r.ok ? 'OK' : 'falhou')
    })
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(() => {
  setupMediaPermissionHandler()
  try {
    ipcMain.removeHandler('inear:request-capture-permission')
  } catch {
    /* */
  }
  ipcMain.handle('inear:request-capture-permission', async () => {
    const w = BrowserWindow.getFocusedWindow() || mainWindowRef
    return requestCaptureAudioPermission(w)
  })

  const { createServices } = require('./server.cjs')
  services = createServices(app)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (services && typeof services.shutdown === 'function') {
    services.shutdown()
  }
})
