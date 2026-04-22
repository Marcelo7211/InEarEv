const path = require('path')
const os = require('os')
const fs = require('fs')

if (!String(process.env.INEAR_HEADLESS || '').trim()) process.env.INEAR_HEADLESS = '1'

const { createServices } = require('../apps/desktop-server/main-process/server.cjs')

const userData =
  process.env.INEAR_USER_DATA ||
  path.join(os.tmpdir(), `inear-headless-${process.pid}`)

fs.mkdirSync(userData, { recursive: true })

const app = {
  getPath(name) {
    if (name === 'userData') return userData
    return userData
  },
}

const services = createServices(app)
console.info('[inear] headless services up:', services.getPorts(), 'userData=', userData)

function shutdown(code) {
  try {
    services.shutdown()
  } catch {
  }
  process.exit(code)
}

const exitAfterMs = Number(process.env.INEAR_EXIT_AFTER_MS || 0)
if (Number.isFinite(exitAfterMs) && exitAfterMs > 0) {
  const t = setTimeout(() => shutdown(0), Math.floor(exitAfterMs))
  if (typeof t.unref === 'function') t.unref()
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('uncaughtException', (e) => {
  try {
    console.error('[inear] uncaughtException:', e && e.stack ? e.stack : e)
  } catch {
  }
  shutdown(1)
})
process.on('unhandledRejection', (e) => {
  try {
    console.error('[inear] unhandledRejection:', e)
  } catch {
  }
  shutdown(1)
})

