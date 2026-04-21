/**
 * Descarrega ffmpeg + ffprobe (Windows x64, LGPL) para resources/ffmpeg-win/
 * antes do electron-builder. Necessário para DirectShow sem depender do PATH.
 * Requer rede; em macOS/Linux usa `unzip` no PATH.
 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const os = require('os')
const https = require('https')

const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'resources', 'ffmpeg-win')
const CACHE_ZIP = path.join(ROOT, '.cache', 'ffmpeg-win-essentials.zip')

/** Build estável com dshow (essentials inclui ffprobe). */
const ZIP_URL =
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

function httpsGetBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { 'User-Agent': 'inear-desktop-build/1' },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return resolve(httpsGetBuffer(res.headers.location))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`GET ${url} -> HTTP ${res.statusCode}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
  })
}

function findFileRecursive(root, baseName) {
  const want = baseName.toLowerCase()
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) stack.push(p)
      else if (ent.name.toLowerCase() === want) return p
    }
  }
  return null
}

/**
 * Extrai ZIP para destDir (Windows: tar nativo ou PowerShell; outros: unzip ou tar).
 * @param {string} zipPath
 * @param {string} destDir
 */
function extractZipArchive(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  const tryTar = () => {
    const r = spawnSync('tar', ['-xf', zipPath, '-C', destDir], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return r.status === 0
  }
  const tryUnzip = () => {
    const r = spawnSync('unzip', ['-q', '-o', zipPath, '-d', destDir], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return r.status === 0
  }
  const tryPowerShellExpand = () => {
    const r = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:INEAR_ZIP -DestinationPath $env:INEAR_DEST -Force',
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, INEAR_ZIP: zipPath, INEAR_DEST: destDir },
      },
    )
    return r.status === 0
  }

  if (process.platform === 'win32') {
    if (tryTar()) return
    if (tryPowerShellExpand()) return
    if (tryUnzip()) return
  } else {
    if (tryUnzip()) return
    if (tryTar()) return
  }
  throw new Error(
    'Não foi possível extrair o ZIP (tentativas: tar, unzip' +
      (process.platform === 'win32' ? ', PowerShell Expand-Archive' : '') +
      '). No Windows confirma que `tar` ou PowerShell estão disponíveis.',
  )
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const destFf = path.join(OUT_DIR, 'ffmpeg.exe')
  const destPb = path.join(OUT_DIR, 'ffprobe.exe')
  if (fs.existsSync(destFf) && fs.existsSync(destPb)) {
    const st = fs.statSync(destFf)
    if (st.size > 1_000_000) {
      console.info(
        '[inear] ffmpeg-win já presente; a saltar download (apaga resources/ffmpeg-win/*.exe para forçar).',
      )
      return
    }
  }

  console.info('[inear] A descarregar FFmpeg Windows (essentials)…')
  fs.mkdirSync(path.dirname(CACHE_ZIP), { recursive: true })

  const buf = await httpsGetBuffer(ZIP_URL)
  fs.writeFileSync(CACHE_ZIP, buf)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inear-ff-'))
  extractZipArchive(CACHE_ZIP, tmp)
  const ff = findFileRecursive(tmp, 'ffmpeg.exe')
  const pb = findFileRecursive(tmp, 'ffprobe.exe')
  if (!ff || !pb) {
    throw new Error('ZIP extraído mas ffmpeg.exe ou ffprobe.exe não encontrados na árvore.')
  }
  fs.copyFileSync(ff, destFf)
  fs.copyFileSync(pb, destPb)
  fs.rmSync(tmp, { recursive: true, force: true })
  console.info('[inear] ffmpeg.exe e ffprobe.exe copiados para', OUT_DIR)
}

main().catch((e) => {
  console.error('[inear] Falha ao preparar ffmpeg-win:', e.message || e)
  process.exit(1)
})
