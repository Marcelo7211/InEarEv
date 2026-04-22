const { app, BrowserWindow, ipcMain, systemPreferences, session } = require('electron')
const path = require('path')
const os = require('os')

/** Pasta %APPDATA%\\inEar Desktop (alinha com NSIS e documentação). */
app.setName('inEar Desktop')

// Windows: evita edge cases IPv6 (::1) e instabilidade do stack com "localhost" no Chromium.
if (process.platform === 'win32') {
  try {
    app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess')
  } catch {
    /* ignore */
  }
  try {
    os.setPriority(process.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL)
  } catch {
    /* ignore */
  }
}

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

function normalizeDevServerUrl(url) {
  if (!url || process.platform !== 'win32') return url
  try {
    const u = new URL(url)
    if (u.hostname === 'localhost') {
      u.hostname = '127.0.0.1'
      return u.toString()
    }
  } catch {
    /* ignore */
  }
  return url
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

  /** Recuperação após "Network service crashed" ou falha transitória ao carregar o Vite. */
  let reloadAttempts = 0
  const maxReloadAttempts = 4
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (!devUrl) return
    console.warn(
      '[inear] Falha ao carregar a UI (Electron):',
      errorCode,
      errorDescription,
      validatedURL,
    )
    if (reloadAttempts >= maxReloadAttempts) return
    reloadAttempts += 1
    const target = normalizeDevServerUrl(devUrl)
    setTimeout(() => {
      if (win.isDestroyed()) return
      void win.loadURL(target).catch(() => {})
    }, 600)
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'crashed' && details.reason !== 'killed') return
    const devUrl = process.env.VITE_DEV_SERVER_URL
    if (!devUrl || reloadAttempts >= maxReloadAttempts) return
    console.warn('[inear] Processo de renderização terminou:', details.reason)
    reloadAttempts += 1
    const target = normalizeDevServerUrl(devUrl)
    setTimeout(() => {
      if (win.isDestroyed()) return
      void win.loadURL(target).catch(() => {})
    }, 400)
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(normalizeDevServerUrl(devUrl))
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
