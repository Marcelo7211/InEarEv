const path = require('path')
const fs = require('fs')
const http = require('http')
const dgram = require('dgram')
const os = require('os')
const crypto = require('crypto')
const { spawn, spawnSync, execFileSync, execFile } = require('child_process')
const util = require('util')
const execFileP = util.promisify(execFile)
let wrtc = null
try {
  wrtc = require('wrtc')
} catch {
  /* WebRTC opcional (android nativo). */
}

function loadProtocol() {
  return require('@inear/protocol')
}

let protocol
try {
  protocol = loadProtocol()
} catch (e) {
  console.error('Falha ao carregar @inear/protocol. Rode npm install na raiz.', e)
  process.exit(1)
}

const {
  channelAccentColor,
  defaultShowfile,
  encodeStereoPcmFrame,
  mixMusicianStereoFromMonoSources,
  migrateShowfile,
  musicianScopeHasValidTarget,
  syncInterfaceChannels,
  MVP_MAX_INPUTS,
  MVP_MAX_CAPTURE_CHANNELS,
  MVP_SAMPLE_RATE_HZ,
  normalizeChannelColor,
  serverHello,
} = protocol

const HTTP_PORT = 3847
const UDP_AUDIO_PORT = 9876
const UDP_CONTROL_PORT = 9877

/** Desenvolvimento / primeira execução: utilizador `admin` com senha `admin123` (bcrypt cost 10). */
const DEFAULT_DEV_ADMIN_BCRYPT =
  '$2a$10$zkUmrcTtnuJ1ZkZSEegAFeq2eyA9ARmDcpLOiHszZ8hgD7KusfEoy'

/**
 * Binários empacotados pelo electron-builder (extraResources → resources/ffmpeg-win/).
 * Em dev, usa apps/desktop-server/resources/ffmpeg-win/.
 * @returns {string | null} diretório que contém ffmpeg.exe
 */
function getBundledWinFfmpegDir() {
  if (process.platform !== 'win32') return null
  const candidates = []
  try {
    if (process.resourcesPath) {
      candidates.push(path.join(process.resourcesPath, 'ffmpeg-win'))
    }
  } catch {
    /* */
  }
  /* main-process/ → resources (dev e fonte empacotada). */
  candidates.push(path.join(__dirname, '..', 'resources', 'ffmpeg-win'))
  /* npm run dev com cwd = apps/desktop-server */
  try {
    candidates.push(path.join(process.cwd(), 'resources', 'ffmpeg-win'))
  } catch {
    /* */
  }
  for (const d of candidates) {
    if (!d) continue
    const p = path.join(d, 'ffmpeg.exe')
    if (fs.existsSync(p)) return d
  }
  return null
}

/** @param {string} cmdBase ex.: ffmpeg, ffprobe (sem .exe) */
function resolveExecutableOnWindowsPath(cmdBase) {
  const base = String(cmdBase || '').trim()
  if (!base) return null
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const names = base.toLowerCase().endsWith('.exe')
    ? [base]
    : [`${base}.exe`, base]
  for (const dir of pathDirs) {
    for (const n of names) {
      const p = path.join(dir, n)
      if (fs.existsSync(p)) return p
    }
  }
  try {
    const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `where ${base}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: process.env,
      windowsHide: true,
    })
    const line = (r.stdout || '').trim().split(/\r?\n/)[0]
    if (line && fs.existsSync(line)) return line
  } catch {
    /* */
  }
  return null
}

function augmentPathForFfmpeg(env) {
  const extra = []
  if (process.platform === 'win32') {
    const b = getBundledWinFfmpegDir()
    if (b) extra.push(b)
  }
  extra.push(
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    process.env.HOME ? path.join(process.env.HOME, '.nix-profile/bin') : '',
  )
  const filtered = extra.filter(Boolean)
  return {
    ...env,
    PATH: [...filtered, env.PATH || ''].join(path.delimiter),
  }
}

/** @returns {string | null} */
function findFfmpegExecutable() {
  if (process.env.INEAR_FFMPEG && fs.existsSync(process.env.INEAR_FFMPEG)) {
    return process.env.INEAR_FFMPEG
  }
  if (process.platform === 'win32') {
    const bundled = getBundledWinFfmpegDir()
    if (bundled) {
      const p = path.join(bundled, 'ffmpeg.exe')
      if (fs.existsSync(p)) return p
    }
    const w = resolveExecutableOnWindowsPath('ffmpeg')
    if (w) return w
  }
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    process.env.HOME ? path.join(process.env.HOME, '.nix-profile/bin') : '',
  ].filter(Boolean)
  for (const d of dirs) {
    const p = path.join(d, 'ffmpeg')
    if (fs.existsSync(p)) return p
  }
  try {
    const out = execFileSync('sh', ['-c', 'command -v ffmpeg'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: augmentPathForFfmpeg(process.env),
    })
    const line = out.trim().split('\n')[0]
    if (line && fs.existsSync(line)) return line
  } catch {
    /* */
  }
  return null
}

/** @returns {string | null} */
function findFfprobeExecutable() {
  if (process.env.INEAR_FFPROBE && fs.existsSync(process.env.INEAR_FFPROBE)) {
    return process.env.INEAR_FFPROBE
  }
  if (process.platform === 'win32') {
    const bundled = getBundledWinFfmpegDir()
    if (bundled) {
      const p = path.join(bundled, 'ffprobe.exe')
      if (fs.existsSync(p)) return p
    }
  }
  const ffmpeg = findFfmpegExecutable()
  if (ffmpeg) {
    const pb = path.join(path.dirname(ffmpeg), 'ffprobe')
    if (fs.existsSync(pb)) return pb
    if (process.platform === 'win32') {
      const pbExe = path.join(path.dirname(ffmpeg), 'ffprobe.exe')
      if (fs.existsSync(pbExe)) return pbExe
    }
  }
  if (process.platform === 'win32') {
    const w = resolveExecutableOnWindowsPath('ffprobe')
    if (w) return w
  }
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    process.env.HOME ? path.join(process.env.HOME, '.nix-profile/bin') : '',
  ].filter(Boolean)
  for (const d of dirs) {
    const p = path.join(d, 'ffprobe')
    if (fs.existsSync(p)) return p
  }
  try {
    const out = execFileSync('sh', ['-c', 'command -v ffprobe'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: augmentPathForFfmpeg(process.env),
    })
    const line = out.trim().split('\n')[0]
    if (line && fs.existsSync(line)) return line
  } catch {
    /* */
  }
  return null
}

const AVF_PROBE_TTL_MS = 60_000
/** @type {Map<number, { channels: number | null, error: string | null, at: number }>} */
const avfInputChannelsProbeCache = new Map()
/** @type {Map<string, { channels: number | null, error: string | null, at: number }>} */
const dshowInputChannelsProbeCache = new Map()

const DSHOW_PROBE_HINT =
  'DirectShow: permite o microfone nas definições de privacidade do Windows; fecha apps que monopolizam o dispositivo; confirma que o ffmpeg inclui suporte dshow (build completa).'

function truncateProbeMsg(s, max = 220) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/**
 * @param {string} stdout
 * @returns {{ best: number | null, errMsg: string | null }}
 */
function parseFfprobeAvfoundationStdout(stdout) {
  let best = null
  let errMsg = null
  if (!stdout) {
    return { best: null, errMsg: 'ffprobe sem saída stdout' }
  }
  try {
    const j = JSON.parse(stdout)
    const streams = Array.isArray(j.streams) ? j.streams : []
    for (const s of streams) {
      if (s.codec_type === 'audio' && typeof s.channels === 'number') {
        const c = Math.floor(s.channels)
        if (c > 0 && c <= MVP_MAX_CAPTURE_CHANNELS) {
          best = best == null ? c : Math.max(best, c)
        }
      }
    }
    if (best == null) {
      errMsg =
        'ffprobe não encontrou stream audio com campo channels no JSON (dispositivo só vídeo ou formato inesperado)'
    }
  } catch (e) {
    errMsg = truncateProbeMsg(`JSON inválido: ${e && e.message ? e.message : e}`)
  }
  return { best, errMsg }
}

/**
 * Entrada AVFoundation só-áudio. `-i ":N"` deixa o vídeo em default e falha com
 * "audio format is not supported" em muitas interfaces / agregados; `none:N` é o
 * formato documentado (vídeo none, áudio índice N).
 * @param {number} idx
 */
function avfoundationAudioInputSpecifier(idx) {
  return `none:${idx}`
}

const FFPROBE_AVF_HINT =
  'Dica agregado: no Configuração de áudio MIDI usa a mesma taxa (ex. 48 kHz) em todas as interfaces; fecha apps que reservem o input (Logic, Zoom…). Atualiza ffmpeg: brew upgrade ffmpeg.'

/**
 * Várias linhas de comando — em alguns Macs `none:N` falha até com `-sample_rate`;
 * `-audio_device_index` ou o legado `:N` por vezes abre o mesmo índice.
 * @param {number} idx
 * @returns {string[][]}
 */
function ffprobeAvfoundationArgVariants(idx) {
  const i = String(Math.floor(idx))
  const head = ['-hide_banner', '-v', 'error', '-print_format', 'json', '-show_streams']
  const noneIn = (extra) => [...head, ...extra, '-f', 'avfoundation', '-i', `none:${i}`]
  return [
    noneIn([]),
    noneIn(['-sample_rate', '48000']),
    noneIn(['-sample_rate', '44100']),
    noneIn(['-sample_rate', '96000']),
    [...head, '-audio_device_index', i, '-f', 'avfoundation', '-i', 'none:none'],
    [...head, '-f', 'avfoundation', '-i', `:${i}`],
  ]
}

/** @param {string} layout */
function avfLayoutStringToChannelCount(layout) {
  const k = String(layout || '')
    .trim()
    .toLowerCase()
  const map = {
    mono: 1,
    stereo: 2,
    '2.1': 3,
    '3.0': 3,
    '4.0': 4,
    quad: 4,
    '5.0': 5,
    '5.1': 6,
    '6.1': 7,
    '7.1': 8,
  }
  if (map[k] != null) return map[k]
  const m = /^(\d+)\.(\d+)$/.exec(k)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (Number.isFinite(a) && Number.isFinite(b)) return Math.min(MVP_MAX_CAPTURE_CHANNELS, a + b)
  }
  return null
}

/**
 * Extrai número de canais de áudio do log do ffmpeg (fallback quando ffprobe falha).
 * @param {string} text
 * @returns {number | null}
 */
function parseFfmpegProbeLogForAudioChannelCount(text) {
  const t = String(text || '')
  const mExplicit = t.match(/Audio:[^\n]{0,200}?(\d+)\s*channels?\b/i)
  if (mExplicit) {
    const n = Math.floor(Number(mExplicit[1]))
    if (n > 0 && n <= MVP_MAX_CAPTURE_CHANNELS) return n
  }
  let best = null
  const streamRows = t.match(/Stream\s+#\d+:\d+:\s*Audio:[^\n]+/gi) || []
  for (const row of streamRows) {
    const m = row.match(/,\s*(\d+)\s*Hz,\s*([^,\n]+)/i)
    if (!m) continue
    const layout = m[2].trim()
    const n = avfLayoutStringToChannelCount(layout)
    if (n != null) best = best == null ? n : Math.max(best, n)
  }
  return best
}

/**
 * @param {number} idx
 * @returns {string[][]} argv (sem binário) para tentar abrir o dispositivo e descartar para null
 */
function ffmpegAvfoundationNullArgVariants(idx) {
  const i = String(Math.floor(idx))
  const tail = (extra, inputToken) => [
    '-nostats',
    '-hide_banner',
    '-loglevel',
    'info',
    '-t',
    '0.25',
    ...extra,
    '-f',
    'avfoundation',
    '-i',
    inputToken,
    '-f',
    'null',
    '-',
  ]
  return [
    tail([], `none:${i}`),
    tail(['-sample_rate', '48000'], `none:${i}`),
    tail(['-sample_rate', '44100'], `none:${i}`),
    tail([], `:${i}`),
  ]
}

/**
 * @param {string} ffmpeg
 * @param {number} idx
 * @param {object} spawnOpts
 * @returns {{ best: number | null, errMsg: string | null }}
 */
function ffmpegAvfoundationChannelCountSync(ffmpeg, idx, spawnOpts) {
  let lastErr = null
  for (const args of ffmpegAvfoundationNullArgVariants(idx)) {
    const r = spawnSync(ffmpeg, args, spawnOpts)
    const log = `${r.stderr || ''}${r.stdout || ''}`
    if (r.error) {
      lastErr = truncateProbeMsg(r.error.message || String(r.error))
      continue
    }
    const n = parseFfmpegProbeLogForAudioChannelCount(log)
    if (n != null) {
      return { best: n, errMsg: null }
    }
    if (r.status !== 0 && r.status != null) {
      const tail = log.trim()
      lastErr = tail
        ? truncateProbeMsg(`ffmpeg exit ${r.status}: ${tail}`)
        : `ffmpeg terminou com código ${r.status}`
    } else {
      lastErr = 'ffmpeg não reportou canais de áudio no log'
    }
  }
  return {
    best: null,
    errMsg: lastErr
      ? truncateProbeMsg(`${lastErr} (fallback ffmpeg)`, 200)
      : 'ffmpeg fallback: sem canais detetados',
  }
}

/**
 * @param {string} ffmpeg
 * @param {number} idx
 * @returns {Promise<{ best: number | null, errMsg: string | null }>}
 */
async function ffmpegAvfoundationChannelCountAsync(ffmpeg, idx) {
  const execOpts = {
    maxBuffer: 2 * 1024 * 1024,
    timeout: 15000,
    encoding: 'utf8',
    env: augmentPathForFfmpeg(process.env),
  }
  let lastErr = null
  for (const args of ffmpegAvfoundationNullArgVariants(idx)) {
    try {
      const r = await execFileP(ffmpeg, args, execOpts)
      const log = `${r.stderr || ''}${r.stdout || ''}`
      const n = parseFfmpegProbeLogForAudioChannelCount(log)
      if (n != null) return { best: n, errMsg: null }
      lastErr = 'ffmpeg não reportou canais de áudio no log'
    } catch (e) {
      if (e.killed || e.signal === 'SIGTERM') {
        lastErr = 'ffmpeg timeout (fallback)'
        continue
      }
      const code = typeof e.code === 'number' ? e.code : null
      const log = `${e.stderr || ''}${e.stdout || ''}`.trim()
      lastErr = log
        ? truncateProbeMsg(`ffmpeg exit ${code}: ${log}`)
        : truncateProbeMsg(e.message || String(e))
    }
  }
  return { best: null, errMsg: lastErr || 'ffmpeg fallback falhou' }
}

/**
 * @param {string} ffprobe
 * @param {number} idx
 * @param {object} spawnOpts
 * @returns {{ best: number | null, errMsg: string | null }}
 */
function ffprobeAvfoundationChannelCountSync(ffprobe, idx, spawnOpts) {
  let lastErr = null
  for (const args of ffprobeAvfoundationArgVariants(idx)) {
    const r = spawnSync(ffprobe, args, spawnOpts)
    if (r.error) {
      lastErr = truncateProbeMsg(r.error.message || String(r.error))
      continue
    }
    if (r.status !== 0) {
      const tail = `${r.stderr || ''}${r.stdout || ''}`.trim()
      lastErr = tail
        ? truncateProbeMsg(`ffprobe exit ${r.status}: ${tail}`)
        : `ffprobe terminou com código ${r.status}`
      continue
    }
    if (!r.stdout) {
      lastErr = 'ffprobe sem saída stdout'
      continue
    }
    const parsed = parseFfprobeAvfoundationStdout(r.stdout)
    if (parsed.best != null) {
      return { best: parsed.best, errMsg: null }
    }
    lastErr = parsed.errMsg || 'JSON sem canais de áudio'
  }
  const ffmpeg = findFfmpegExecutable()
  if (ffmpeg) {
    const fb = ffmpegAvfoundationChannelCountSync(ffmpeg, idx, spawnOpts)
    if (fb.best != null) return fb
    const tail = lastErr || 'ffprobe: todas as variantes falharam'
    return {
      best: null,
      errMsg: truncateProbeMsg(
        `${tail}; ${fb.errMsg || 'ffmpeg fallback sem sucesso'} — ${FFPROBE_AVF_HINT}`,
        380,
      ),
    }
  }
  const tail = lastErr || 'ffprobe: todas as variantes falharam'
  return {
    best: null,
    errMsg: truncateProbeMsg(
      `${tail}; ffmpeg não encontrado para fallback — ${FFPROBE_AVF_HINT}`,
      380,
    ),
  }
}

/**
 * @param {string} ffprobe
 * @param {number} idx
 * @returns {Promise<{ best: number | null, errMsg: string | null }>}
 */
async function ffprobeAvfoundationChannelCountAsync(ffprobe, idx) {
  const execOpts = {
    maxBuffer: 2 * 1024 * 1024,
    timeout: 12000,
    encoding: 'utf8',
    env: augmentPathForFfmpeg(process.env),
  }
  let lastErr = null
  for (const args of ffprobeAvfoundationArgVariants(idx)) {
    try {
      const { stdout } = await execFileP(ffprobe, args, execOpts)
      const parsed = parseFfprobeAvfoundationStdout(
        typeof stdout === 'string' ? stdout : String(stdout || ''),
      )
      if (parsed.best != null) {
        return { best: parsed.best, errMsg: null }
      }
      lastErr = parsed.errMsg || 'JSON sem canais de áudio'
    } catch (e) {
      if (e.killed || e.signal === 'SIGTERM') {
        lastErr = 'ffprobe timeout (~12s) ou processo terminado'
        continue
      }
      const code = typeof e.code === 'number' ? e.code : null
      const tail = `${e.stderr || ''}${e.stdout || ''}`.trim()
      lastErr = tail
        ? truncateProbeMsg(`ffprobe exit ${code}: ${tail}`)
        : truncateProbeMsg(e.message || String(e))
    }
  }
  const ffmpeg = findFfmpegExecutable()
  if (ffmpeg) {
    const fb = await ffmpegAvfoundationChannelCountAsync(ffmpeg, idx)
    if (fb.best != null) return fb
    return {
      best: null,
      errMsg: truncateProbeMsg(
        `${lastErr || 'ffprobe: todas as variantes falharam'}; ${
          fb.errMsg || 'ffmpeg fallback sem sucesso'
        } — ${FFPROBE_AVF_HINT}`,
        380,
      ),
    }
  }
  return {
    best: null,
    errMsg: truncateProbeMsg(
      `${lastErr || 'ffprobe: todas as variantes falharam'}; ffmpeg não encontrado para fallback — ${FFPROBE_AVF_HINT}`,
      380,
    ),
  }
}

/**
 * @param {number} deviceIndex
 * @param {{ force?: boolean }} opts
 * @returns {Promise<{ channels: number | null, error: string | null }>}
 */
async function probeAvfoundationInputChannelsResultAsync(deviceIndex, opts = {}) {
  if (process.platform !== 'darwin') {
    return { channels: null, error: 'não macOS' }
  }
  const idx = Math.floor(Number(deviceIndex))
  if (!Number.isFinite(idx) || idx < 0) {
    return { channels: null, error: 'índice inválido' }
  }
  const now = Date.now()
  const cached = avfInputChannelsProbeCache.get(idx)
  if (!opts.force && cached && now - cached.at < AVF_PROBE_TTL_MS) {
    return { channels: cached.channels, error: cached.error }
  }
  const ffprobe = findFfprobeExecutable()
  if (!ffprobe) {
    const err =
      'ffprobe não encontrado no PATH deste processo (Electron). Instala ffmpeg (inclui ffprobe) ou define INEAR_FFPROBE=/caminho/completo/ffprobe'
    avfInputChannelsProbeCache.set(idx, { channels: null, error: err, at: now })
    return { channels: null, error: err }
  }
  const { best, errMsg } = await ffprobeAvfoundationChannelCountAsync(ffprobe, idx)
  const at = Date.now()
  avfInputChannelsProbeCache.set(idx, {
    channels: best,
    error: best != null ? null : errMsg,
    at,
  })
  return { channels: best, error: best != null ? null : errMsg }
}

/**
 * @param {number} deviceIndex
 * @param {{ force?: boolean }} opts
 * @returns {{ channels: number | null, error: string | null }}
 */
function probeAvfoundationInputChannelsResult(deviceIndex, opts = {}) {
  if (process.platform !== 'darwin') {
    return { channels: null, error: 'não macOS' }
  }
  const idx = Math.floor(Number(deviceIndex))
  if (!Number.isFinite(idx) || idx < 0) {
    return { channels: null, error: 'índice inválido' }
  }
  const now = Date.now()
  const cached = avfInputChannelsProbeCache.get(idx)
  if (!opts.force && cached && now - cached.at < AVF_PROBE_TTL_MS) {
    return { channels: cached.channels, error: cached.error }
  }
  const ffprobe = findFfprobeExecutable()
  if (!ffprobe) {
    const err =
      'ffprobe não encontrado no PATH deste processo (Electron). Instala ffmpeg (inclui ffprobe) ou define INEAR_FFPROBE=/caminho/completo/ffprobe'
    avfInputChannelsProbeCache.set(idx, { channels: null, error: err, at: now })
    return { channels: null, error: err }
  }
  const spawnOpts = {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    env: augmentPathForFfmpeg(process.env),
    timeout: 12000,
  }
  const { best, errMsg } = ffprobeAvfoundationChannelCountSync(ffprobe, idx, spawnOpts)
  avfInputChannelsProbeCache.set(idx, {
    channels: best,
    error: best != null ? null : errMsg,
    at: now,
  })
  return { channels: best, error: best != null ? null : errMsg }
}

/**
 * Entradas PCM que o ffmpeg expõe para este índice AVFoundation (ffprobe).
 * @param {number} deviceIndex
 * @param {{ force?: boolean }} opts
 * @returns {number | null}
 */
function probeAvfoundationInputChannels(deviceIndex, opts = {}) {
  return probeAvfoundationInputChannelsResult(deviceIndex, opts).channels
}

/** @param {string} deviceName */
function dshowAudioInputSpecifier(deviceName) {
  return `audio=${String(deviceName || '').trim()}`
}

/**
 * @param {string} ffmpeg
 * @param {string} deviceName
 * @param {object} spawnOpts
 * @returns {{ best: number | null, errMsg: string | null }}
 */
function ffmpegDshowChannelCountSync(ffmpeg, deviceName, spawnOpts) {
  const name = String(deviceName || '').trim()
  if (!name) return { best: null, errMsg: 'nome de dispositivo vazio' }
  const args = [
    '-nostats',
    '-hide_banner',
    '-loglevel',
    'info',
    '-t',
    '0.25',
    '-f',
    'dshow',
    '-i',
    dshowAudioInputSpecifier(name),
    '-f',
    'null',
    '-',
  ]
  const r = spawnSync(ffmpeg, args, {
    ...spawnOpts,
    windowsHide: true,
    cwd: spawnOpts.cwd || path.dirname(ffmpeg),
  })
  const log = `${r.stderr || ''}${r.stdout || ''}`
  if (r.error) {
    return { best: null, errMsg: truncateProbeMsg(r.error.message || String(r.error)) }
  }
  const n = parseFfmpegProbeLogForAudioChannelCount(log)
  if (n != null) return { best: n, errMsg: null }
  const tail = log.trim()
  return {
    best: null,
    errMsg: tail
      ? truncateProbeMsg(`ffmpeg exit ${r.status}: ${tail}`)
      : `ffmpeg terminou com código ${r.status}`,
  }
}

/**
 * @param {string} ffmpeg
 * @param {string} deviceName
 * @param {object} execOpts
 * @returns {Promise<{ best: number | null, errMsg: string | null }>}
 */
async function ffmpegDshowChannelCountAsync(ffmpeg, deviceName, execOpts) {
  const name = String(deviceName || '').trim()
  if (!name) return { best: null, errMsg: 'nome de dispositivo vazio' }
  const args = [
    '-nostats',
    '-hide_banner',
    '-loglevel',
    'info',
    '-t',
    '0.25',
    '-f',
    'dshow',
    '-i',
    dshowAudioInputSpecifier(name),
    '-f',
    'null',
    '-',
  ]
  try {
    const { stdout, stderr } = await execFileP(ffmpeg, args, {
      ...execOpts,
      windowsHide: true,
      cwd: execOpts.cwd || path.dirname(ffmpeg),
    })
    const log = `${stderr || ''}${stdout || ''}`
    const n = parseFfmpegProbeLogForAudioChannelCount(log)
    if (n != null) return { best: n, errMsg: null }
    return { best: null, errMsg: truncateProbeMsg('ffmpeg dshow: sem canais no log') }
  } catch (e) {
    const tail = `${e.stderr || ''}${e.stdout || ''}`.trim()
    return {
      best: null,
      errMsg: tail
        ? truncateProbeMsg(`ffmpeg: ${tail}`)
        : truncateProbeMsg(e.message || String(e)),
    }
  }
}

/**
 * @param {string} deviceName
 * @param {{ force?: boolean }} opts
 * @returns {{ channels: number | null, error: string | null }}
 */
function probeDshowInputChannelsResult(deviceName, opts = {}) {
  if (process.platform !== 'win32') {
    return { channels: null, error: 'não Windows' }
  }
  const name = String(deviceName || '').trim()
  if (!name) {
    return { channels: null, error: 'nome de dispositivo vazio' }
  }
  const now = Date.now()
  const cached = dshowInputChannelsProbeCache.get(name)
  if (!opts.force && cached && now - cached.at < AVF_PROBE_TTL_MS) {
    return { channels: cached.channels, error: cached.error }
  }
  const ffprobe = findFfprobeExecutable()
  if (!ffprobe) {
    const err =
      'ffprobe não encontrado no PATH deste processo (Electron). Instala ffmpeg (inclui ffprobe) ou define INEAR_FFPROBE=caminho\\ffprobe.exe'
    dshowInputChannelsProbeCache.set(name, { channels: null, error: err, at: now })
    return { channels: null, error: err }
  }
  const spawnOpts = {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    env: augmentPathForFfmpeg(process.env),
    timeout: 15000,
    windowsHide: true,
    cwd: path.dirname(ffprobe),
  }
  const args = [
    '-hide_banner',
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-f',
    'dshow',
    '-i',
    dshowAudioInputSpecifier(name),
  ]
  const r = spawnSync(ffprobe, args, spawnOpts)
  let best = null
  let errMsg = null
  if (r.error) {
    errMsg = truncateProbeMsg(r.error.message || String(r.error))
  } else if (r.status !== 0) {
    const tail = `${r.stderr || ''}${r.stdout || ''}`.trim()
    errMsg = tail
      ? truncateProbeMsg(`ffprobe exit ${r.status}: ${tail}`)
      : `ffprobe terminou com código ${r.status}`
  } else if (!r.stdout) {
    errMsg = 'ffprobe sem saída stdout'
  } else {
    const parsed = parseFfprobeAvfoundationStdout(r.stdout)
    best = parsed.best
    errMsg = parsed.errMsg
  }
  if (best == null) {
    const ffmpeg = findFfmpegExecutable()
    if (ffmpeg) {
      const fb = ffmpegDshowChannelCountSync(ffmpeg, name, spawnOpts)
      if (fb.best != null) {
        best = fb.best
        errMsg = null
      } else {
        errMsg = truncateProbeMsg(
          `${errMsg || 'ffprobe sem canais'}; ${fb.errMsg || 'ffmpeg fallback sem sucesso'} — ${DSHOW_PROBE_HINT}`,
          380,
        )
      }
    } else {
      errMsg = truncateProbeMsg(
        `${errMsg || 'ffprobe sem canais'}; ffmpeg não encontrado — ${DSHOW_PROBE_HINT}`,
        380,
      )
    }
  }
  const at = Date.now()
  dshowInputChannelsProbeCache.set(name, {
    channels: best,
    error: best != null ? null : errMsg,
    at,
  })
  return { channels: best, error: best != null ? null : errMsg }
}

/**
 * @param {string} deviceName
 * @param {{ force?: boolean }} opts
 * @returns {Promise<{ channels: number | null, error: string | null }>}
 */
async function probeDshowInputChannelsResultAsync(deviceName, opts = {}) {
  if (process.platform !== 'win32') {
    return { channels: null, error: 'não Windows' }
  }
  const name = String(deviceName || '').trim()
  if (!name) {
    return { channels: null, error: 'nome de dispositivo vazio' }
  }
  const now = Date.now()
  const cached = dshowInputChannelsProbeCache.get(name)
  if (!opts.force && cached && now - cached.at < AVF_PROBE_TTL_MS) {
    return { channels: cached.channels, error: cached.error }
  }
  const ffprobe = findFfprobeExecutable()
  if (!ffprobe) {
    const err =
      'ffprobe não encontrado no PATH deste processo (Electron). Instala ffmpeg (inclui ffprobe) ou define INEAR_FFPROBE=caminho\\ffprobe.exe'
    dshowInputChannelsProbeCache.set(name, { channels: null, error: err, at: now })
    return { channels: null, error: err }
  }
  const execOpts = {
    maxBuffer: 2 * 1024 * 1024,
    timeout: 15000,
    encoding: 'utf8',
    env: augmentPathForFfmpeg(process.env),
    windowsHide: true,
    cwd: path.dirname(ffprobe),
  }
  const args = [
    '-hide_banner',
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-f',
    'dshow',
    '-i',
    dshowAudioInputSpecifier(name),
  ]
  let best = null
  let errMsg = null
  try {
    const { stdout } = await execFileP(ffprobe, args, execOpts)
    const parsed = parseFfprobeAvfoundationStdout(
      typeof stdout === 'string' ? stdout : String(stdout || ''),
    )
    best = parsed.best
    errMsg = parsed.errMsg
  } catch (e) {
    if (e.killed || e.signal === 'SIGTERM') {
      errMsg = 'ffprobe timeout (~15s) ou processo terminado'
    } else {
      const tail = `${e.stderr || ''}${e.stdout || ''}`.trim()
      errMsg = tail
        ? truncateProbeMsg(`ffprobe: ${tail}`)
        : truncateProbeMsg(e.message || String(e))
    }
  }
  if (best == null) {
    const ffmpeg = findFfmpegExecutable()
    if (ffmpeg) {
      const fb = await ffmpegDshowChannelCountAsync(ffmpeg, name, execOpts)
      if (fb.best != null) {
        best = fb.best
        errMsg = null
      } else {
        errMsg = truncateProbeMsg(
          `${errMsg || 'ffprobe sem canais'}; ${fb.errMsg || 'ffmpeg fallback sem sucesso'} — ${DSHOW_PROBE_HINT}`,
          380,
        )
      }
    } else {
      errMsg = truncateProbeMsg(
        `${errMsg || 'ffprobe sem canais'}; ffmpeg não encontrado — ${DSHOW_PROBE_HINT}`,
        380,
      )
    }
  }
  const at = Date.now()
  dshowInputChannelsProbeCache.set(name, {
    channels: best,
    error: best != null ? null : errMsg,
    at,
  })
  return { channels: best, error: best != null ? null : errMsg }
}

/** @returns {Array<{ index: number, name: string }>} */
function parseAvfAudioDevices(stderr) {
  const lines = stderr.split(/\r?\n/)
  const aIdx = lines.findIndex((l) => l.includes('AVFoundation audio devices'))
  if (aIdx === -1) return []
  const vIdx = lines.findIndex((l) => l.includes('AVFoundation video devices'))
  const deviceRe = /\]\s+\[(\d+)\]\s*(.+)$/
  const devices = []
  const start = aIdx + 1
  const endExclusive = vIdx > aIdx ? vIdx : lines.length
  for (let i = start; i < endExclusive; i++) {
    const raw = lines[i]
    if (!raw || raw.includes('Error opening')) break
    const m = raw.match(deviceRe)
    if (m) devices.push({ index: Number(m[1]), name: m[2].trim() })
  }
  return devices
}

/** @param {string} s */
function looksLikeFfmpegDshowDeviceLog(s) {
  const t = String(s || '')
  return (
    /DirectShow|dshow\s+audio|directshow\s+audio|\[dshow[^\]]*\]/i.test(t) ||
    /\bin#\d+\s*@[^\]]*\]\s*"[^"]+"\s*\(\s*audio\s*\)/i.test(t)
  )
}

/**
 * Saída de ffmpeg no Windows pode vir em UTF-8, UTF-16 ou página de código; isto evita lista vazia por parsing falhado.
 * @param {Buffer | string | undefined | null} stderrBuf
 * @param {Buffer | string | undefined | null} stdoutBuf
 */
function decodeFfmpegDeviceListBuffers(stderrBuf, stdoutBuf) {
  const decodeOne = (buf) => {
    if (buf == null) return ''
    if (typeof buf === 'string') return buf
    if (!Buffer.isBuffer(buf) || buf.length === 0) return ''
    const b = buf
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
      return b.slice(2).toString('utf16le')
    }
    const utf8 = b.toString('utf8')
    if (looksLikeFfmpegDshowDeviceLog(utf8) || /ffmpeg version|libav/i.test(utf8)) return utf8
    const latin1 = b.toString('latin1')
    if (looksLikeFfmpegDshowDeviceLog(latin1)) return latin1
    let utf16Score = 0
    const sampleLen = Math.min(200, b.length)
    for (let i = 1; i < sampleLen; i += 2) {
      if (b[i] === 0 && b[i - 1] !== 0) utf16Score++
    }
    if (utf16Score > 12 && b.length > 64) {
      const u16 = b.toString('utf16le')
      if (/DirectShow|dshow|in#\d+\s*@/i.test(u16)) return u16
    }
    return utf8
  }
  return `${decodeOne(stderrBuf)}\n${decodeOne(stdoutBuf)}`
}

function uniqueDshowDeviceNames(names) {
  const seen = new Set()
  const out = []
  for (const raw of names) {
    const n = String(raw || '').trim()
    if (!n || /^dummy$/i.test(n)) continue
    const k = n.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(n)
  }
  return out.map((name, index) => ({ index, name }))
}

/**
 * Extrai nomes de dispositivos DirectShow a partir do log do ffmpeg.
 * Suporta aspas tipográficas, BOM e variações de linha; o bloco "Diagnóstico" usa o mesmo texto.
 * @returns {Array<{ index: number, name: string }>}
 */
function parseDshowAudioDevices(text) {
  let raw = String(text || '')
  raw = raw
    .replace(/^\uFEFF/, '')
    .replace(/\u201c|\u201d|\u201e|\u201f|\u00ab|\u00bb/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u00A0/g, ' ')
  const lower = raw.toLowerCase()
  let idx = lower.indexOf('directshow audio devices')
  let markerLen = 'directshow audio devices'.length
  if (idx === -1) {
    idx = lower.indexOf('dshow audio devices')
    if (idx !== -1) markerLen = 'dshow audio devices'.length
  }
  if (idx === -1) {
    const m = raw.match(/direct\s*show\s+audio\s+devices/i)
    if (m && m.index != null) {
      idx = m.index
      markerLen = m[0].length
    }
  }
  if (idx === -1) {
    const fallback = []
    for (const m of raw.matchAll(/\[[^\]]*in#\d+\s*@[^\]]*\]\s*"([^"]+)"\s*\(\s*audio\s*\)/gi)) {
      fallback.push(m[1])
    }
    if (fallback.length > 0) return uniqueDshowDeviceNames(fallback)
    return []
  }

  const from = idx + markerLen
  let chunk = raw.slice(from, from + 120000)
  const stopM = chunk.match(/\n(?:Input #|Press \[q\]|files:|file:)/i)
  if (stopM && stopM.index != null) chunk = chunk.slice(0, stopM.index)

  const names = []
  /* Builds recentes: `[dshow @ …] "Dispositivo"` — clássico. */
  for (const m of chunk.matchAll(/\[dshow[^\]]*\]\s*"([^"]+)"/gi)) {
    names.push(m[1])
  }
  /**
   * FFmpeg mais novo (ex. listagem DirectShow): `[in#0 @ …] "Microfone (…)" (audio)`
   * em vez do prefixo `[dshow @ …]`.
   */
  for (const m of chunk.matchAll(/\[[^\]]*in#\d+\s*@[^\]]*\]\s*"([^"]+)"\s*\(\s*audio\s*\)/gi)) {
    names.push(m[1])
  }
  if (names.length === 0) {
    for (const line of chunk.split(/\r\n|[\n\r]/)) {
      if (!line || /Alternative name/i.test(line)) continue
      const m1 = line.match(/\[dshow[^\]]*\]\s*"([^"]+)"/i)
      if (m1) names.push(m1[1])
      else {
        const m2 = line.match(/\[dshow[^\]]*\]\s*'([^']+)'/i)
        if (m2) names.push(m2[1])
        else {
          const m3 = line.match(/\[[^\]]*in#\d+\s*@[^\]]*\]\s*"([^"]+)"\s*\(\s*audio\s*\)/i)
          if (m3) names.push(m3[1])
        }
      }
    }
  }
  if (names.length === 0) {
    for (const m of chunk.matchAll(/"([^"]{3,200})"/g)) {
      const n = m[1].trim()
      if (/^dummy$/i.test(n)) continue
      if (/^@device_/i.test(n)) continue
      if (/^(true|false|null|\d+)$/i.test(n)) continue
      names.push(n)
    }
  }
  return uniqueDshowDeviceNames(names)
}

/**
 * Saída de `ffmpeg -devices` (ver se o binário expõe indev dshow).
 * @param {string} ffmpeg
 * @returns {{ tail: string, exitCode: number | null, hasDshow: boolean }}
 */
function ffmpegDevicesSupportDiagSync(ffmpeg) {
  const ffDir = path.dirname(ffmpeg)
  const r = spawnSync(ffmpeg, ['-hide_banner', '-devices'], {
    encoding: 'buffer',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 8000,
    windowsHide: true,
    cwd: ffDir,
    env: augmentPathForFfmpeg(process.env),
  })
  const combined = decodeFfmpegDeviceListBuffers(r.stderr, r.stdout)
  const s = String(combined).replace(/\r\n/g, '\n')
  const hasDshow = /\bdshow\b/i.test(s)
  const tail = s.length > 3500 ? s.slice(-3500) : s
  return {
    tail,
    exitCode: typeof r.status === 'number' ? r.status : null,
    hasDshow,
  }
}

/**
 * Últimas linhas de `ffmpeg -list_options -f dshow -i audio=…` (pins / formatos).
 * @param {string} ffmpeg
 * @param {string} deviceName
 * @returns {string | null}
 */
function dshowListOptionsTailSync(ffmpeg, deviceName) {
  const name = String(deviceName || '').trim()
  if (!name) return null
  const ffDir = path.dirname(ffmpeg)
  const r = spawnSync(
    ffmpeg,
    ['-hide_banner', '-list_options', 'true', '-f', 'dshow', '-i', dshowAudioInputSpecifier(name)],
    {
      encoding: 'buffer',
      maxBuffer: 4 * 1024 * 1024,
      timeout: 12000,
      windowsHide: true,
      cwd: ffDir,
      env: augmentPathForFfmpeg(process.env),
    },
  )
  const combined = decodeFfmpegDeviceListBuffers(r.stderr, r.stdout)
  const t = String(combined).replace(/\r\n/g, '\n').trim()
  if (!t) return null
  return t.length > 2500 ? t.slice(-2500) : t
}

/**
 * Escolhe entrada AVFoundation por heurística (USB/profissional → loopback virtual).
 * Opcional: `INEAR_CAPTURE_DEVICE_SUBSTRING` — primeiro dispositivo cujo nome contém a string.
 * @param {Array<{ index: number, name: string }>} devices
 * @returns {{ index: number, name: string } | null}
 */
function pickPreferredAvfoundationDevice(devices) {
  if (!devices || devices.length === 0) return null
  const sub = String(process.env.INEAR_CAPTURE_DEVICE_SUBSTRING || '').trim()
  if (sub) {
    const needle = sub.toLowerCase()
    const hit = devices.find((d) => d.name.toLowerCase().includes(needle))
    if (hit) return hit
  }
  const prefer = [
    /\bstudio\b/i,
    /\bsteinberg\b/i,
    /\bfocusrite\b/i,
    /\bscarlett\b/i,
    /\bumc\b/i,
    /\bvocaster\b/i,
    /\bzoom\b/i,
    /\bh\d\b.*\bzoom\b/i,
    /\brode\b/i,
    /\bapogee\b/i,
    /\bbehringer\b/i,
    /\bmotu\b/i,
    /\bpresonus\b/i,
    /\broland\b/i,
    /\baudiofuse\b/i,
    /\bkomplete\b/i,
    /\b(blackhole|soundflower|loopback)\b/i,
    /\baggregate\b/i,
    /\bmulti[- ]?output\b/i,
    /\bvb-?audio\b/i,
    /\bvoicemeeter\b/i,
    /\bcable\b/i,
    /\bvirtual\b.*\bcable\b/i,
    /\b(stereo mix|what u hear)\b/i,
    /\bline in\b/i,
    /\bmicrophone\b/i,
    /\busb\b.*\b(audio|mic)\b/i,
    /\brealtek\b/i,
    /\bwasapi\b/i,
  ]
  for (const re of prefer) {
    const d = devices.find((x) => re.test(x.name))
    if (d) return d
  }
  return null
}

function statePath(userData) {
  return path.join(userData, 'inear-state.json')
}

function userNameKey(u) {
  return String((u && u.username) || '')
    .trim()
    .toLowerCase()
}

/**
 * Garante um administrador por defeito quando o estado não tem nenhum (ex.: ficheiros antigos com `users: []`).
 * @param {*} raw estado carregado de `inear-state.json`
 * @returns {boolean} true se o estado foi alterado e deve ser gravado
 */
function ensureDefaultAdminUser(raw) {
  if (!Array.isArray(raw.users)) raw.users = []
  if (raw.users.some((u) => u && u.role === 'admin')) return false
  if (raw.users.some((u) => u && userNameKey(u) === 'admin')) return false
  raw.users.push({
    username: 'admin',
    passwordHash: DEFAULT_DEV_ADMIN_BCRYPT,
    role: 'admin',
  })
  return true
}

/**
 * Se já existe admin com outro nome (wizard), acrescenta a conta documentada `admin` / `admin123`.
 * @param {*} raw
 * @returns {boolean}
 */
function ensureBuiltinAdminLoginExists(raw) {
  if (!Array.isArray(raw.users)) raw.users = []
  if (raw.users.some((u) => u && userNameKey(u) === 'admin')) return false
  raw.users.push({
    username: 'admin',
    passwordHash: DEFAULT_DEV_ADMIN_BCRYPT,
    role: 'admin',
  })
  return true
}

/**
 * Garante que o utilizador `admin` (qualquer capitalização) tem sempre a senha `admin123`.
 * @param {*} raw
 * @returns {boolean}
 */
function normalizeBuiltinAdminPassword(raw) {
  const bcrypt = require('bcryptjs')
  if (!Array.isArray(raw.users)) raw.users = []
  const u = raw.users.find((x) => x && x.role === 'admin' && userNameKey(x) === 'admin')
  if (!u) return false
  let changed = false
  if (u.username !== 'admin') {
    u.username = 'admin'
    changed = true
  }
  let ok = false
  try {
    ok =
      typeof u.passwordHash === 'string' &&
      u.passwordHash.length >= 20 &&
      bcrypt.compareSync('admin123', u.passwordHash)
  } catch {
    ok = false
  }
  if (!ok) {
    u.passwordHash = DEFAULT_DEV_ADMIN_BCRYPT
    changed = true
  }
  return changed
}

function defaultState() {
  const showfile = migrateShowfile(defaultShowfile())
  // Primeira execução: instalação "limpa". Admin será criado no wizard inicial.
  showfile.musicians = []
  return {
    showfile,
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    pairing: null,
    users: [
      {
        username: 'admin',
        passwordHash: DEFAULT_DEV_ADMIN_BCRYPT,
        role: 'admin',
      },
    ],
    /** macOS: índice AVFoundation só-áudio (`none:N` no ffmpeg); usado só em modo `manual`. */
    captureAvfoundationAudioIndex: null,
    /**
     * macOS: `auto` = detetar entrada por heurística; `manual` = usar índice acima;
     * `off` = não captar (tons de teste). Ignorado se `INEAR_CAPTURE_CMD` estiver definido.
     */
    captureAvfoundationMode: 'auto',
    /**
     * Ganhos L/R do PCM estéreo da interface e, por canal da mesa, fonte sum|L|R
     * (cada canal do showfile recebe mono derivado da captura).
     * `gainByIndex["k"]` — ganho 0..4 por entrada física k (PCM multi-canal).
     */
    captureInputMatrix: { gainL: 1, gainR: 1, assign: {}, gainByIndex: {} },
    /** Número de canais no fluxo único de captura (ex.: dispositivo agregado no macOS). */
    captureChannelCount: 2,
    /**
     * Se true (default), ao iniciar captura AVFoundation o servidor ajusta N com ffprobe.
     * Passa a false quando defines N manualmente no painel.
     */
    captureChannelCountAuto: true,
    /** Bloco PCM por tick do motor de áudio (64/128/256/512 amostras @ 48 kHz). */
    audioBlockSamples: process.platform === 'win32' ? 128 : 64,
  }
}

/**
 * Se o showfile ganhou faixas `if_*` e o músico tem escopo explícito antigo (só parte das entradas),
 * acrescenta os ids em falta para alinhar retorno e EQ.
 * @param {*} sf
 * @returns {boolean}
 */
function expandMusicianScopeForInterfaceStrips(sf) {
  if (!sf || !Array.isArray(sf.channels) || !Array.isArray(sf.musicians)) return false
  const allIf = sf.channels
    .filter((c) => /^if_\d+$/.test(c.id))
    .map((c) => c.id)
    .sort((a, b) => {
      const na = Number(String(a).replace(/^if_/, ''))
      const nb = Number(String(b).replace(/^if_/, ''))
      return (Number.isFinite(na) ? na : 0) - (Number.isFinite(nb) ? nb : 0)
    })
  if (allIf.length === 0) return false
  let changed = false
  for (const m of sf.musicians) {
    if (!m.scope || typeof m.scope !== 'object') {
      m.scope = { channelIds: [], groupIds: [] }
    }
    const ids = Array.isArray(m.scope.channelIds) ? m.scope.channelIds : []
    const gids = Array.isArray(m.scope.groupIds) ? m.scope.groupIds : []
    const explicit = ids.length > 0 || gids.length > 0
    if (!explicit) continue
    let missing = false
    for (const id of allIf) {
      if (!ids.includes(id)) {
        missing = true
        break
      }
    }
    if (!missing) continue
    m.scope.channelIds = [...ids]
    for (const id of allIf) {
      if (!m.scope.channelIds.includes(id)) m.scope.channelIds.push(id)
    }
    changed = true
  }
  return changed
}

/** @param {string} userData */
function loadOrCreateState(userData) {
  const p = statePath(userData)
  if (fs.existsSync(p)) {
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      migrateShowfile(raw.showfile)
      if (!Array.isArray(raw.users)) raw.users = []
      if (!Array.isArray(raw.showfile.musicians)) raw.showfile.musicians = []
      if (raw.captureAvfoundationAudioIndex === undefined) {
        raw.captureAvfoundationAudioIndex = null
      }
      if (raw.captureAvfoundationMode === undefined) {
        const hadManualIndex =
          raw.captureAvfoundationAudioIndex != null &&
          Number.isInteger(Number(raw.captureAvfoundationAudioIndex)) &&
          Number(raw.captureAvfoundationAudioIndex) >= 0
        raw.captureAvfoundationMode = hadManualIndex ? 'manual' : 'auto'
      }
      if (!raw.captureInputMatrix || typeof raw.captureInputMatrix !== 'object') {
        raw.captureInputMatrix = { gainL: 1, gainR: 1, assign: {}, gainByIndex: {} }
      } else {
        if (typeof raw.captureInputMatrix.gainL !== 'number') {
          raw.captureInputMatrix.gainL = 1
        }
        if (typeof raw.captureInputMatrix.gainR !== 'number') {
          raw.captureInputMatrix.gainR = 1
        }
        if (
          !raw.captureInputMatrix.assign ||
          typeof raw.captureInputMatrix.assign !== 'object'
        ) {
          raw.captureInputMatrix.assign = {}
        }
        if (
          !raw.captureInputMatrix.gainByIndex ||
          typeof raw.captureInputMatrix.gainByIndex !== 'object'
        ) {
          raw.captureInputMatrix.gainByIndex = {}
        }
      }
      if (raw.captureChannelCount === undefined || raw.captureChannelCount === null) {
        raw.captureChannelCount = 2
      } else {
        const nc = Math.floor(Number(raw.captureChannelCount))
        raw.captureChannelCount = Math.max(
          1,
          Math.min(MVP_MAX_CAPTURE_CHANNELS, Number.isFinite(nc) ? nc : 2),
        )
      }
      if (raw.captureChannelCountAuto === undefined) {
        raw.captureChannelCountAuto = true
      } else {
        raw.captureChannelCountAuto = Boolean(raw.captureChannelCountAuto)
      }
      if (raw.audioBlockSamples === undefined || raw.audioBlockSamples === null) {
        raw.audioBlockSamples = process.platform === 'win32' ? 128 : 64
      } else {
        raw.audioBlockSamples = clampAudioBlockSamples(raw.audioBlockSamples)
      }
      let dirty = expandMusicianScopeForInterfaceStrips(raw.showfile)
      if (process.platform === 'win32' && (raw.audioBlockSamples === 64 || raw.audioBlockSamples === 256)) {
        raw.audioBlockSamples = 128
        dirty = true
      }
      if (ensureDefaultAdminUser(raw)) dirty = true
      if (ensureBuiltinAdminLoginExists(raw)) dirty = true
      if (normalizeBuiltinAdminPassword(raw)) dirty = true
      if (dirty) {
        fs.writeFileSync(p, JSON.stringify(raw, null, 2), 'utf8')
      }
      return raw
    } catch {
      /* fallthrough */
    }
  }
  const s = defaultState()
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf8')
  return s
}

function saveState(userData, state) {
  fs.writeFileSync(statePath(userData), JSON.stringify(state, null, 2), 'utf8')
}

function clampEqDb(v) {
  return Math.max(-12, Math.min(12, Number(v) || 0))
}

const AUDIO_BLOCK_OPTIONS = [64, 128, 256, 512]

function clampAudioBlockSamples(n) {
  const x = Math.floor(Number(n))
  return AUDIO_BLOCK_OPTIONS.includes(x) ? x : 128
}

function channelVisibleToMusician(m, cid, sf) {
  /** Retorno multi-entrada: faixas `if_*` da mesa devem aceitar EQ/send alinhados ao showfile. */
  if (/^if_\d+$/.test(cid) && sf.channels.some((c) => c.id === cid)) return true
  const explicit =
    m.scope.channelIds.length > 0 || m.scope.groupIds.length > 0
  if (!explicit || !musicianScopeHasValidTarget(sf, m)) return true
  if (m.scope.channelIds.includes(cid)) return true
  for (const gid of m.scope.groupIds) {
    const g = sf.groups.find((x) => x.id === gid)
    if (g && g.channelIds.includes(cid)) return true
  }
  return false
}

function createServices(app) {
  const userData = app.getPath('userData')
  const express = require('express')
  const cors = require('cors')
  const jwt = require('jsonwebtoken')
  const bcrypt = require('bcryptjs')
  const rateLimit = require('express-rate-limit')

  let state = loadOrCreateState(userData)
  if (String(process.env.INEAR_HEADLESS || '').trim() === '1') {
    if ((state.captureAvfoundationMode || 'auto') !== 'off') {
      state.captureAvfoundationMode = 'off'
      saveState(userData, state)
    }
  }
  let lastAutoIfSyncKey = null
  function showfileLooksLikeInterfaceOnly(sf) {
    if (!sf || !Array.isArray(sf.channels)) return false
    if (sf.channels.length === 0) return true
    return sf.channels.every(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        (/^if_\d+$/.test(c.id) || c.id === 'if_l' || c.id === 'if_r'),
    )
  }
  function autoSyncInterfaceChannelsIfNeeded(baseName, channelCount) {
    if (state.captureChannelCountAuto === false) return
    if (!showfileLooksLikeInterfaceOnly(state.showfile)) return
    const n = Math.max(1, Math.floor(Number(channelCount) || 0))
    const name = String(baseName || '').trim() || 'Interface'
    const key = `${process.platform}|${name}|${n}`
    if (key === lastAutoIfSyncKey) return
    const currentIf = state.showfile.channels.filter((c) => /^if_\d+$/.test(c.id))
    const alreadyAligned =
      state.showfile.channels.length === n &&
      currentIf.length === n &&
      currentIf.every((c) => typeof c.captureInputIndex === 'number' && c.captureInputIndex >= 0)
    if (!alreadyAligned) {
      syncInterfaceChannels(state.showfile, { channelCount: n, baseName: name })
      saveState(userData, state)
    }
    lastAutoIfSyncKey = key
  }
  /** Última listagem DirectShow (diagnóstico quando a lista vem vazia no Windows). */
  let lastWinDshowListDiag = {
    exitCode: /** @type {number | null} */ (null),
    tail: '',
    combinedLen: 0,
    ffmpegDevicesExitCode: /** @type {number | null} */ (null),
    ffmpegDevicesTail: '',
    ffmpegHasDshowInDevices: /** @type {boolean | null} */ (null),
    at: 0,
  }
  /** @type {Map<string, { lastReportSeqGaps: number | null, samples: Array<{ t: number, rtt: number, gapsDelta: number, aheadMs: number, estimatedE2eMs: number, queueDepth: number, drops: number, underruns: number, slaOver1s: number, latencyProfile: string }> }>} */
  const telemetryBySub = new Map()
  /** @type {Map<string, { address: string, port: number }>} */
  const udpTargets = new Map()
  /** @type {Map<string, Set<import('ws').WebSocket>>} retorno no telemóvel (Expo Go) sem UDP nativo */
  const wsAudioByMusician = new Map()
  /** node-webrtc: RTCAudioSource.onData exige ~10 ms de PCM por chamada (ver docs/nonstandard-apis). */
  const WEBRTC_PCM_FRAMES_PER_PUSH = Math.max(1, Math.round(MVP_SAMPLE_RATE_HZ / 100))
  const WEBRTC_PCM_SAMPLES_STEREO = WEBRTC_PCM_FRAMES_PER_PUSH * 2

  /**
   * @type {Map<string, { id: string, pc: any, source: any, track: any, latencyProfile?: string, pcmPending?: Int16Array, pcmPendingUsed?: number, lastAudioPushAt?: number, statsTimer?: any, lastRtcStats?: { rttMs: number | null, jitterMs: number | null, at: number } | null }>}
   */
  const webrtcSessions = new Map()
  /** @type {Map<string, Set<string>>} */
  const webrtcSessionsByMusician = new Map()

  /**
   * Acumula PCM estéreo intercalado e envia ao RTCAudioSource em blocos de 10 ms (requisito da lib wrtc).
   * @returns {boolean} false se onData falhar (sessão deve ser descartada)
   */
  function feedWebRtcSessionAudio(sess, interleavedBlock) {
    if (!sess || !sess.source) return true
    if (!(interleavedBlock instanceof Int16Array) || interleavedBlock.length === 0) return true
    if (!sess.pcmPending) {
      sess.pcmPending = new Int16Array(8192)
      sess.pcmPendingUsed = 0
    }
    let buf = sess.pcmPending
    let used = sess.pcmPendingUsed || 0
    const need = used + interleavedBlock.length
    if (need > buf.length) {
      let nl = buf.length
      while (nl < need) nl *= 2
      const nb = new Int16Array(nl)
      nb.set(buf.subarray(0, used))
      buf = nb
      sess.pcmPending = buf
    }
    buf.set(interleavedBlock, used)
    used += interleavedBlock.length
    sess.pcmPendingUsed = used
    while (sess.pcmPendingUsed >= WEBRTC_PCM_SAMPLES_STEREO) {
      const u = sess.pcmPendingUsed
      const chunk = new Int16Array(
        sess.pcmPending.subarray(0, WEBRTC_PCM_SAMPLES_STEREO),
      )
      try {
        sess.source.onData({
          samples: chunk,
          sampleRate: MVP_SAMPLE_RATE_HZ,
          bitsPerSample: 16,
          channelCount: 2,
          numberOfFrames: WEBRTC_PCM_FRAMES_PER_PUSH,
        })
        sess.lastAudioPushAt = Date.now()
      } catch (e) {
        console.warn(
          '[inear] WebRTC onData:',
          e && e.message ? String(e.message) : String(e),
        )
        return false
      }
      sess.pcmPending.copyWithin(0, WEBRTC_PCM_SAMPLES_STEREO, u)
      sess.pcmPendingUsed = u - WEBRTC_PCM_SAMPLES_STEREO
    }
    return true
  }
  function summarizeWebRtcSessions() {
    return Array.from(webrtcSessions.entries()).map(([sessionId, sess]) => ({
      sessionId,
      musicianId: sess && sess.id ? sess.id : null,
      latencyProfile: sess && sess.latencyProfile ? String(sess.latencyProfile) : 'stable',
      connectionState:
        sess && sess.pc && sess.pc.connectionState ? String(sess.pc.connectionState) : null,
      iceConnectionState:
        sess && sess.pc && sess.pc.iceConnectionState ? String(sess.pc.iceConnectionState) : null,
      iceGatheringState:
        sess && sess.pc && sess.pc.iceGatheringState ? String(sess.pc.iceGatheringState) : null,
      signalingState:
        sess && sess.pc && sess.pc.signalingState ? String(sess.pc.signalingState) : null,
      hasTrack: Boolean(sess && sess.track),
      pendingSamples: sess && typeof sess.pcmPendingUsed === 'number' ? sess.pcmPendingUsed : 0,
      rttMs:
        sess && sess.lastRtcStats && typeof sess.lastRtcStats.rttMs === 'number'
          ? Number(sess.lastRtcStats.rttMs.toFixed(2))
          : null,
      jitterMs:
        sess && sess.lastRtcStats && typeof sess.lastRtcStats.jitterMs === 'number'
          ? Number(sess.lastRtcStats.jitterMs.toFixed(2))
          : null,
      statsAgeMs:
        sess && sess.lastRtcStats && sess.lastRtcStats.at
          ? Math.max(0, Date.now() - sess.lastRtcStats.at)
          : null,
      lastAudioPushMsAgo:
        sess && sess.lastAudioPushAt ? Math.max(0, Date.now() - sess.lastAudioPushAt) : null,
    }))
  }
  function normalizeRtcStatsReports(stats) {
    if (!stats) return []
    if (typeof stats.values === 'function') {
      try {
        return Array.from(stats.values())
      } catch {
        /* ignore */
      }
    }
    if (Array.isArray(stats)) return stats
    if (typeof stats.forEach === 'function') {
      const items = []
      try {
        stats.forEach((value) => items.push(value))
        return items
      } catch {
        /* ignore */
      }
    }
    if (typeof stats === 'object') return Object.values(stats)
    return []
  }
  function extractRtcNetworkStats(stats) {
    let rttMs = null
    let jitterMs = null
    for (const report of normalizeRtcStatsReports(stats)) {
      if (!report || typeof report !== 'object') continue
      if (
        report.type === 'candidate-pair' &&
        report.nominated === true &&
        report.state === 'succeeded' &&
        typeof report.currentRoundTripTime === 'number'
      ) {
        rttMs = report.currentRoundTripTime * 1000
      }
      if (
        (report.type === 'inbound-rtp' || report.type === 'remote-inbound-rtp') &&
        (report.kind === 'audio' || report.mediaType === 'audio') &&
        typeof report.jitter === 'number'
      ) {
        jitterMs = report.jitter * 1000
      }
    }
    return { rttMs, jitterMs }
  }
  function startWebRtcSessionStatsPolling(sessionId, pc) {
    return setInterval(async () => {
      const sess = webrtcSessions.get(sessionId)
      if (!sess || !pc || typeof pc.getStats !== 'function') return
      try {
        const stats = await pc.getStats()
        const next = extractRtcNetworkStats(stats)
        sess.lastRtcStats = {
          rttMs: next.rttMs,
          jitterMs: next.jitterMs,
          at: Date.now(),
        }
      } catch {
        /* ignore */
      }
    }, 1000)
  }
  function hasActiveWebRtcLatencyProfile(profile) {
    for (const sess of webrtcSessions.values()) {
      if (sess && sess.latencyProfile === profile) return true
    }
    return false
  }
  const muteRampByMusician = new Map()
  let audioSeq = 0
  let sampleClock = 0
  let audioTimeout = null
  let nextAudioTickAt = Date.now()

  function audioBlockSamples() {
    const configured = clampAudioBlockSamples(state.audioBlockSamples)
    if (
      process.platform === 'win32' &&
      (hasActiveWebRtcLatencyProfile('provocal') || hasActiveWebRtcLatencyProfile('pro'))
    ) {
      return 64
    }
    return configured
  }

  function avgSample(values) {
    if (!values || values.length === 0) return 0
    return values.reduce((a, b) => a + b, 0) / values.length
  }

  function percentile(values, p) {
    if (!values || values.length === 0) return 0
    const sorted = values
      .filter((v) => typeof v === 'number' && Number.isFinite(v))
      .slice()
      .sort((a, b) => a - b)
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
    return sorted[idx]
  }

  function buildWifi24Recommendations(summary) {
    const items = [
      'Fixe o access point de 2,4 GHz em 20 MHz e use apenas canais 1, 6 ou 11.',
      'Ative WMM/QoS com prioridade de voz para o SSID do palco e ligue o servidor por Ethernet ao AP.',
    ]
    if (summary.avgRtt > 45 || summary.jitterMs > 18) {
      items.push(
        'Há indício de interferência: afaste o AP de Bluetooth, micro-ondas, iluminação sem fio e receptores IEM.',
      )
    }
    if (summary.queueDepthP95 >= 10 || summary.e2eP95Ms > 700) {
      items.push(
        'Reduza clientes concorrentes no SSID de palco, desative power save agressivo no telemóvel e mantenha visada para o AP.',
      )
    }
    if (summary.slaBreaches > 0 || summary.gapsPerMinute > 8) {
      items.push(
        'Se o AP suportar, reserve SSID dedicado para retorno e marque o tráfego de áudio como DSCP EF/46.',
      )
    }
    return items.slice(0, 4)
  }

  function networkHint(level, _avgRtt, gapsPm, e2eP95Ms, slaBreaches) {
    if (level === 'bad') {
      if (slaBreaches > 0 || e2eP95Ms > 1000) {
        return 'Meta de < 1000 ms violada — reduza carga no SSID 2,4 GHz, use QoS/WMM e fixe canal 1, 6 ou 11.'
      }
      if (gapsPm > 8) {
        return 'Muitos saltos de pacotes — prefira Wi‑Fi 5 GHz, router dedicado ao palco e servidor com Ethernet ao AP.'
      }
      return 'Latência de rede alta — aproxime o telemóvel do router, evite VPN e redes públicas.'
    }
    if (level === 'warn') {
      if (e2eP95Ms > 650) {
        return 'Ligação utilizável, mas perto do limite operacional — ajuste canal, QoS e mantenha 20 MHz em 2,4 GHz.'
      }
      return 'Ligação utilizável — se ouvir cortes, use 5 GHz ou aproxime-se do access point.'
    }
    return 'Ligação estável para retorno.'
  }

  function computeQualityFromSamples(samples) {
    if (!samples || samples.length === 0) {
      return {
        level: 'warn',
        rttMs: null,
        jitterMs: null,
        gapsPerMinute: 0,
        estimatedE2eMs: null,
        estimatedE2eP95Ms: null,
        aheadP95Ms: null,
        queueDepthP95: null,
        sampleCount: 0,
        slaBreaches: 0,
        slaUnder1s: false,
        recommendations: buildWifi24Recommendations({
          avgRtt: 0,
          jitterMs: 0,
          gapsPerMinute: 0,
          e2eP95Ms: 0,
          queueDepthP95: 0,
          slaBreaches: 0,
        }),
        hint: 'Sem telemetria ainda — inicie o retorno (WebSocket) no telemóvel.',
      }
    }
    const windowMs = 45000
    const now = Date.now()
    const recent = samples.filter((s) => now - s.t < windowMs)
    if (recent.length === 0) {
      return {
        level: 'warn',
        rttMs: null,
        jitterMs: null,
        gapsPerMinute: 0,
        estimatedE2eMs: null,
        estimatedE2eP95Ms: null,
        aheadP95Ms: null,
        queueDepthP95: null,
        sampleCount: 0,
        slaBreaches: 0,
        slaUnder1s: false,
        recommendations: buildWifi24Recommendations({
          avgRtt: 0,
          jitterMs: 0,
          gapsPerMinute: 0,
          e2eP95Ms: 0,
          queueDepthP95: 0,
          slaBreaches: 0,
        }),
        hint: 'Dados de rede desatualizados — confirme que o retorno está ativo.',
      }
    }
    const rtts = recent
      .map((s) => s.rtt)
      .filter((r) => typeof r === 'number' && r >= 0 && r < 5000)
    const avgRtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : 0
    const mean = avgRtt
    const variance =
      rtts.length > 1
        ? rtts.reduce((acc, r) => acc + (r - mean) ** 2, 0) / rtts.length
        : 0
    const jitter = Math.sqrt(variance)
    const aheads = recent
      .map((s) => s.aheadMs)
      .filter((v) => typeof v === 'number' && v >= 0 && v < 5000)
    const e2es = recent
      .map((s) => s.estimatedE2eMs)
      .filter((v) => typeof v === 'number' && v >= 0 && v < 10000)
    const queueDepths = recent
      .map((s) => s.queueDepth)
      .filter((v) => typeof v === 'number' && v >= 0 && v < 200)
    const gapSum = recent.reduce((a, s) => a + (s.gapsDelta || 0), 0)
    const slaBreaches = recent.reduce((a, s) => a + (s.slaOver1s || 0), 0)
    const spanMin = Math.max(0.25, (now - recent[0].t) / 60000)
    const gapsPerMinute = gapSum / spanMin
    const e2eAvg = avgSample(e2es)
    const e2eP95 = percentile(e2es, 95)
    const aheadP95 = percentile(aheads, 95)
    const queueDepthP95 = percentile(queueDepths, 95)
    let level = 'good'
    if (avgRtt > 85 || gapsPerMinute > 18 || e2eP95 > 1000 || slaBreaches > 0) level = 'bad'
    else if (avgRtt > 38 || gapsPerMinute > 5 || e2eP95 > 650 || jitter > 25) level = 'warn'
    const summary = {
      avgRtt,
      jitterMs: jitter,
      gapsPerMinute,
      e2eP95Ms: e2eP95,
      queueDepthP95,
      slaBreaches,
    }
    return {
      level,
      rttMs: Math.round(avgRtt * 10) / 10,
      jitterMs: Math.round(jitter * 10) / 10,
      gapsPerMinute: Math.round(gapsPerMinute * 10) / 10,
      estimatedE2eMs: Math.round(e2eAvg * 10) / 10,
      estimatedE2eP95Ms: Math.round(e2eP95 * 10) / 10,
      aheadP95Ms: Math.round(aheadP95 * 10) / 10,
      queueDepthP95: Math.round(queueDepthP95 * 10) / 10,
      sampleCount: recent.length,
      slaBreaches,
      slaUnder1s: e2eP95 > 0 && e2eP95 < 1000 && slaBreaches === 0,
      recommendations: buildWifi24Recommendations(summary),
      hint: networkHint(level, avgRtt, gapsPerMinute, e2eP95, slaBreaches),
    }
  }
  function muteFadeSamples() {
    return Math.max(1, Math.round(MVP_SAMPLE_RATE_HZ * 0.02))
  }

  let captureMeterState = {
    levelsByIndex: {},
    updatedAt: 0,
  }
  let captureDebugState = {
    ffmpegPath: null,
    captureKind: null,
    captureDeviceName: null,
    captureDeviceIndex: null,
    startedAt: 0,
    lastChunkAt: 0,
    lastChunkBytes: 0,
    totalBytes: 0,
    lastStderrLines: [],
    lastError: null,
    lastExit: null,
    lastUdpSendAt: 0,
    lastUdpSendMusicianId: null,
    lastWsSendAt: 0,
    lastWsSendMusicianId: null,
    lastWebRtcSendAt: 0,
    lastWebRtcSendMusicianId: null,
  }

  function resetCaptureDebugState() {
    captureDebugState = {
      ffmpegPath: null,
      captureKind: null,
      captureDeviceName: null,
      captureDeviceIndex: null,
      startedAt: 0,
      lastChunkAt: 0,
      lastChunkBytes: 0,
      totalBytes: 0,
      lastStderrLines: [],
      lastError: null,
      lastExit: null,
      lastUdpSendAt: 0,
      lastUdpSendMusicianId: null,
      lastWsSendAt: 0,
      lastWsSendMusicianId: null,
      lastWebRtcSendAt: 0,
      lastWebRtcSendMusicianId: null,
    }
  }

  function appendCaptureStderr(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    const merged = captureDebugState.lastStderrLines.concat(lines)
    captureDebugState.lastStderrLines = merged.slice(-18)
    captureDebugState.lastError = captureDebugState.lastStderrLines.at(-1) || null
  }

  function attachCaptureProcessDiagnostics(child, meta) {
    if (!child) return
    captureDebugState.captureKind = meta.captureKind || null
    captureDebugState.captureDeviceName = meta.captureDeviceName || null
    captureDebugState.captureDeviceIndex =
      Number.isInteger(meta.captureDeviceIndex) ? meta.captureDeviceIndex : null
    captureDebugState.ffmpegPath = meta.ffmpegPath || null
    captureDebugState.startedAt = Date.now()
    captureDebugState.lastError = null
    captureDebugState.lastExit = null
    if (child.stderr) {
      child.stderr.on('data', (buf) => {
        appendCaptureStderr(buf)
      })
    }
    child.on('error', (err) => {
      const msg = err && err.message ? String(err.message) : String(err)
      captureDebugState.lastError = msg
      console.error(`[inear] captura ${meta.captureKind || 'pc'} spawn:`, msg)
    })
    child.on('exit', (code, sig) => {
      captureDebugState.lastExit = {
        at: Date.now(),
        code: typeof code === 'number' ? code : null,
        signal: sig || null,
      }
      if (code || sig) {
        console.warn(`[inear] captura ${meta.captureKind || 'pc'} terminou`, {
          code,
          sig,
        })
      }
    })
  }

  function monoByChannelAt(globalSample) {
    const sr = MVP_SAMPLE_RATE_HZ
    const out = {}
    let i = 0
    for (const ch of state.showfile.channels) {
      const f = 80 + i * 45
      const t = globalSample / sr
      out[ch.id] = Math.sin(2 * Math.PI * f * t) * 0.25
      i++
    }
    return out
  }

  /** Captura estéreo s16le 48kHz: `INEAR_CAPTURE_CMD` ou AVFoundation (macOS). */
  let captureBuf = Buffer.alloc(0)
  let captureChild = null
  let captureUnderruns = 0
  /** Última vez em que havia PCM suficiente do ffmpeg (para /api/session). */
  let lastGoodCaptureMs = 0

  function captureBufferSoftCapBytes(blockSamples, nCh) {
    const bytesPerFrame = Math.max(1, nCh) * 2
    const minBlockBytes = Math.max(1, blockSamples) * bytesPerFrame
    const targetMs =
      process.platform === 'win32'
        ? hasActiveWebRtcLatencyProfile('provocal')
          ? 10
          : hasActiveWebRtcLatencyProfile('pro')
            ? 14
            : 40
        : 80
    const targetBytes = Math.round((MVP_SAMPLE_RATE_HZ * bytesPerFrame * targetMs) / 1000)
    return Math.max(minBlockBytes * 2, targetBytes)
  }

  function normalizeCaptureChannelCount() {
    const raw = Math.floor(Number(state.captureChannelCount))
    if (!Number.isFinite(raw) || raw < 1) return 2
    return Math.max(1, Math.min(MVP_MAX_CAPTURE_CHANNELS, raw))
  }

  function listAvfoundationAudioDevices() {
    if (process.platform !== 'darwin') return []
    const ffmpeg = findFfmpegExecutable()
    if (!ffmpeg) return []
    const r = spawnSync(
      ffmpeg,
      ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
      { encoding: 'utf8', env: augmentPathForFfmpeg(process.env) },
    )
    const stderr = `${r.stderr || ''}${r.stdout || ''}`
    return parseAvfAudioDevices(stderr)
  }

  function listDshowAudioDevices() {
    if (process.platform !== 'win32') return []
    const ffmpeg = findFfmpegExecutable()
    if (!ffmpeg) {
      lastWinDshowListDiag = {
        exitCode: null,
        tail: '',
        combinedLen: 0,
        ffmpegDevicesExitCode: null,
        ffmpegDevicesTail: '',
        ffmpegHasDshowInDevices: null,
        at: Date.now(),
      }
      return []
    }
    const ffDir = path.dirname(ffmpeg)
    const attempts = [
      ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
      ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', ''],
      ['-hide_banner', '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'],
      ['-loglevel', 'info', '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'],
      ['-hide_banner', '-f', 'dshow', '-list_devices', 'true', '-i', 'audio=dummy'],
    ]
    let best = /** @type {{ index: number, name: string }[]} */ ([])
    let lastCombined = ''
    let lastStatus = /** @type {number | null} */ (null)
    for (const args of attempts) {
      const r = spawnSync(ffmpeg, args, {
        encoding: 'buffer',
        maxBuffer: 50 * 1024 * 1024,
        env: augmentPathForFfmpeg(process.env),
        windowsHide: true,
        cwd: ffDir,
      })
      const combined = decodeFfmpegDeviceListBuffers(r.stderr, r.stdout)
      lastCombined = combined
      lastStatus = typeof r.status === 'number' ? r.status : null
      const parsed = parseDshowAudioDevices(combined)
      if (parsed.length > best.length) best = parsed
      if (best.length > 0) break
    }
    const s = String(lastCombined)
    let devDiag = {
      exitCode: /** @type {number | null} */ (null),
      tail: '',
      hasDshow: false,
    }
    if (best.length === 0) {
      try {
        devDiag = ffmpegDevicesSupportDiagSync(ffmpeg)
      } catch {
        /* */
      }
      console.warn(
        '[inear] DirectShow: lista de áudio vazia após',
        attempts.length,
        'tentativas; exit=',
        lastStatus,
        'len=',
        s.length,
        'ffmpeg -devices dshow=',
        devDiag.hasDshow,
      )
    }
    lastWinDshowListDiag = {
      exitCode: lastStatus,
      tail: s.slice(-4000),
      combinedLen: s.length,
      ffmpegDevicesExitCode: devDiag.exitCode,
      ffmpegDevicesTail: devDiag.tail,
      ffmpegHasDshowInDevices: best.length === 0 ? devDiag.hasDshow : null,
      at: Date.now(),
    }
    return best
  }

  let pcCaptureDevicesCache = {
    /** @type {{ index: number, name: string }[] | null} */
    list: null,
    at: 0,
  }
  const AVF_LIST_TTL_MS = 5000

  function listPcAudioCaptureDevicesCached() {
    const now = Date.now()
    if (pcCaptureDevicesCache.list && now - pcCaptureDevicesCache.at < AVF_LIST_TTL_MS) {
      return pcCaptureDevicesCache.list
    }
    let list = []
    if (process.platform === 'darwin') {
      list = listAvfoundationAudioDevices()
    } else if (process.platform === 'win32') {
      list = listDshowAudioDevices()
    }
    pcCaptureDevicesCache = { list, at: now }
    return list
  }

  function bustPcCaptureCaches() {
    pcCaptureDevicesCache = { list: null, at: 0 }
    avfInputChannelsProbeCache.clear()
    dshowInputChannelsProbeCache.clear()
  }

  /** @param {{ index: number, name: string }[]} devices */
  function resolveEffectiveAvfoundationIndex(devices) {
    const mode = state.captureAvfoundationMode || 'auto'
    if (mode === 'off') return null
    if (mode === 'manual') {
      const raw = state.captureAvfoundationAudioIndex
      if (raw === null || raw === undefined) return null
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 0) return null
      return n
    }
    const picked = pickPreferredAvfoundationDevice(devices)
    if (picked) return picked.index
    /* Sem heurística: usa a primeira entrada listada para modo automático (ex. Windows genérico). */
    if (devices.length > 0) return devices[0].index
    return null
  }

  /** @param {{ index: number, name: string }[]} devices */
  function computePcCaptureMeta(devices) {
    const envOn = Boolean(String(process.env.INEAR_CAPTURE_CMD || '').trim())
    if (envOn) {
      return {
        captureSource: 'env',
        effectiveIndex: null,
        effectiveName: null,
        autoPicked: false,
        mode: state.captureAvfoundationMode || 'auto',
      }
    }
    if (process.platform === 'darwin') {
      const mode = state.captureAvfoundationMode || 'auto'
      const eff = resolveEffectiveAvfoundationIndex(devices)
      const name =
        eff != null ? devices.find((d) => d.index === eff)?.name ?? null : null
      const autoPicked = mode === 'auto' && eff != null
      return {
        captureSource: eff != null ? 'avfoundation' : 'none',
        effectiveIndex: eff,
        effectiveName: name,
        autoPicked,
        mode,
      }
    }
    if (process.platform === 'win32') {
      const mode = state.captureAvfoundationMode || 'auto'
      const eff = resolveEffectiveAvfoundationIndex(devices)
      const name =
        eff != null ? devices.find((d) => d.index === eff)?.name ?? null : null
      const autoPicked = mode === 'auto' && eff != null
      return {
        captureSource: eff != null ? 'dshow' : 'none',
        effectiveIndex: eff,
        effectiveName: name,
        autoPicked,
        mode,
      }
    }
    return {
      captureSource: 'none',
      effectiveIndex: null,
      effectiveName: null,
      autoPicked: false,
      mode: state.captureAvfoundationMode || 'auto',
    }
  }

  function pushCaptureChunk(chunk) {
    captureBuf = Buffer.concat([captureBuf, chunk])
    const capBytes = captureBufferSoftCapBytes(audioBlockSamples(), normalizeCaptureChannelCount())
    if (captureBuf.length > capBytes) {
      captureBuf = captureBuf.subarray(captureBuf.length - capBytes)
    }
    captureDebugState.lastChunkAt = Date.now()
    captureDebugState.lastChunkBytes = chunk ? chunk.length : 0
    captureDebugState.totalBytes += chunk ? chunk.length : 0
  }

  function stopCaptureChild() {
    if (captureChild && !captureChild.killed) {
      try {
        captureChild.kill('SIGTERM')
      } catch {
        /* */
      }
    }
    captureChild = null
    captureBuf = Buffer.alloc(0)
    captureMeterState = { levelsByIndex: {}, updatedAt: Date.now() }
    resetCaptureDebugState()
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0))
  }

  function updateCaptureMeters(capBlock, nCh) {
    if (!capBlock || nCh < 1) return
    const frames = Math.max(1, Math.floor(capBlock.length / nCh))
    const prev = captureMeterState.levelsByIndex || {}
    const next = {}
    const meterFloor = 0.02
    for (let c = 0; c < nCh; c++) {
      let sumSq = 0
      let peak = 0
      for (let i = 0; i < frames; i++) {
        const s = capBlock[i * nCh + c] / 32768
        const a = Math.abs(s)
        sumSq += s * s
        if (a > peak) peak = a
      }
      const rms = Math.sqrt(sumSq / frames)
      const dbPeak = peak > 0 ? 20 * Math.log10(peak) : -90
      const dbRms = rms > 0 ? 20 * Math.log10(rms) : -90
      const normalizedPeak = clamp01((dbPeak + 48) / 48)
      const normalizedRms = clamp01((dbRms + 42) / 42)
      const shaped = clamp01(Math.max(normalizedPeak, normalizedRms * 0.92, peak * 1.25, rms * 2.7))
      const prevLevel = clamp01(prev[String(c)] ?? 0)
      const attack = 0.82
      const release = 0.24
      next[String(c)] =
        clamp01(
          shaped >= prevLevel
            ? Math.max(meterFloor, prevLevel + (shaped - prevLevel) * attack)
            : prevLevel + (shaped - prevLevel) * release,
        )
    }
    captureMeterState = { levelsByIndex: next, updatedAt: Date.now() }
  }

  function decayCaptureMeters(nCh) {
    const prev = captureMeterState.levelsByIndex || {}
    const next = {}
    for (let c = 0; c < Math.max(1, nCh); c++) {
      const current = prev[String(c)] ?? 0
      next[String(c)] = current <= 0.02 ? 0 : clamp01(current * 0.9 - 0.008)
    }
    captureMeterState = { levelsByIndex: next, updatedAt: Date.now() }
  }

  function silentMonoByChannel() {
    const out = {}
    for (const ch of state.showfile.channels) out[ch.id] = 0
    return out
  }

  function startCaptureIfConfigured() {
    stopCaptureChild()
    captureUnderruns = 0

    const cmd = process.env.INEAR_CAPTURE_CMD
    if (cmd && String(cmd).trim()) {
      console.info(
        '[inear] captura do PC (INEAR_CAPTURE_CMD):',
        String(cmd).length > 140 ? `${String(cmd).slice(0, 140)}…` : cmd,
      )
      const isWin = process.platform === 'win32'
      captureChild = isWin
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], {
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        : spawn('/bin/sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] })
      attachCaptureProcessDiagnostics(captureChild, {
        captureKind: 'env',
        captureDeviceName: 'INEAR_CAPTURE_CMD',
        captureDeviceIndex: null,
        ffmpegPath: String(cmd),
      })
      captureChild.stdout.on('data', pushCaptureChunk)
      return
    }

    if (process.platform === 'darwin') {
      bustPcCaptureCaches()
      const devices = listAvfoundationAudioDevices()
      pcCaptureDevicesCache = { list: devices, at: Date.now() }
      const n = resolveEffectiveAvfoundationIndex(devices)
      if (n != null) {
        const ffmpeg = findFfmpegExecutable()
        if (!ffmpeg) {
          console.error(
            '[inear] captura AVFoundation: ffmpeg não encontrado (brew install ffmpeg ou INEAR_FFMPEG).',
          )
        } else {
          const mode = state.captureAvfoundationMode || 'auto'
          const devName = devices.find((d) => d.index === n)?.name || ''
          if (state.captureChannelCountAuto !== false) {
            const probed = probeAvfoundationInputChannels(n)
            if (probed && probed >= 1) {
              const next = Math.min(MVP_MAX_CAPTURE_CHANNELS, probed)
              if (next !== state.captureChannelCount) {
                console.info(
                  `[inear] AVFoundation ${avfoundationAudioInputSpecifier(n)} — ffprobe detetou ${probed} entradas PCM; captureChannelCount=${next}`,
                )
                state.captureChannelCount = next
                saveState(userData, state)
              }
            }
          }
          const nCh = normalizeCaptureChannelCount()
          autoSyncInterfaceChannelsIfNeeded(devName, nCh)
          const args = [
            '-nostats',
            '-loglevel',
            'error',
            '-fflags',
            'nobuffer',
            '-flags',
            'low_delay',
            '-f',
            'avfoundation',
            '-i',
            avfoundationAudioInputSpecifier(n),
            '-ar',
            String(MVP_SAMPLE_RATE_HZ),
            '-ac',
            String(nCh),
            '-f',
            's16le',
            '-',
          ]
          console.info(
            `[inear] captura do PC (AVFoundation ${mode} ${avfoundationAudioInputSpecifier(n)}, ${nCh}ch) ${devName}`,
            ffmpeg,
          )
          captureChild = spawn(ffmpeg, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: augmentPathForFfmpeg(process.env),
          })
          attachCaptureProcessDiagnostics(captureChild, {
            captureKind: 'avfoundation',
            captureDeviceName: devName,
            captureDeviceIndex: n,
            ffmpegPath: ffmpeg,
          })
          captureChild.stdout.on('data', pushCaptureChunk)
          return
        }
      } else if ((state.captureAvfoundationMode || 'auto') !== 'off') {
        console.info(
          '[inear] AVFoundation: sem entrada resolvida (heurística sem correspondência). Opcional: env INEAR_CAPTURE_DEVICE_SUBSTRING, modo manual no painel, ou INEAR_CAPTURE_CMD.',
        )
      }
    }

    if (process.platform === 'win32') {
      bustPcCaptureCaches()
      const devices = listDshowAudioDevices()
      pcCaptureDevicesCache = { list: devices, at: Date.now() }
      const n = resolveEffectiveAvfoundationIndex(devices)
      if (n != null) {
        const ffmpeg = findFfmpegExecutable()
        if (!ffmpeg) {
          console.error(
            '[inear] captura DirectShow: ffmpeg não encontrado (PATH ou INEAR_FFMPEG).',
          )
        } else {
          const mode = state.captureAvfoundationMode || 'auto'
          const devName = devices.find((d) => d.index === n)?.name || ''
          if (!devName) {
            console.error('[inear] DirectShow: nome de dispositivo vazio para índice', n)
          } else {
            if (state.captureChannelCountAuto !== false) {
              const probed = probeDshowInputChannelsResult(devName).channels
              if (probed && probed >= 1) {
                const next = Math.min(MVP_MAX_CAPTURE_CHANNELS, probed)
                if (next !== state.captureChannelCount) {
                  console.info(
                    `[inear] DirectShow "${devName}" — ffprobe detetou ${probed} entradas PCM; captureChannelCount=${next}`,
                  )
                  state.captureChannelCount = next
                  saveState(userData, state)
                }
              }
            }
            const nCh = normalizeCaptureChannelCount()
            autoSyncInterfaceChannelsIfNeeded(devName, nCh)
            const audioPinName = String(process.env.INEAR_DSHOW_AUDIO_PIN_NAME || '').trim()
            const audioDeviceNumberRaw = String(process.env.INEAR_DSHOW_AUDIO_DEVICE_NUMBER || '').trim()
            const audioDeviceNumber = Number.isFinite(Number(audioDeviceNumberRaw))
              ? Math.max(0, Math.floor(Number(audioDeviceNumberRaw)))
              : null
            const dshowAudioBufferMsRaw = Number(
              String(process.env.INEAR_DSHOW_AUDIO_BUFFER_MS || '').trim() || '5',
            )
            const dshowAudioBufferMs =
              Number.isFinite(dshowAudioBufferMsRaw) && dshowAudioBufferMsRaw >= 0
                ? Math.max(0, Math.min(500, Math.floor(dshowAudioBufferMsRaw)))
                : 20
            const args = [
              '-nostats',
              '-loglevel',
              'error',
              '-fflags',
              'nobuffer',
              '-flags',
              'low_delay',
              '-rtbufsize',
              '96k',
              '-thread_queue_size',
              '1024',
              '-f',
              'dshow',
              '-sample_rate',
              String(MVP_SAMPLE_RATE_HZ),
              '-audio_buffer_size',
              String(dshowAudioBufferMs),
              ...(audioPinName ? ['-audio_pin_name', audioPinName] : []),
              ...(audioDeviceNumber !== null ? ['-audio_device_number', String(audioDeviceNumber)] : []),
              '-i',
              dshowAudioInputSpecifier(devName),
              '-ar',
              String(MVP_SAMPLE_RATE_HZ),
              '-ac',
              String(nCh),
              '-f',
              's16le',
              '-',
            ]
            console.info(
              `[inear] captura do PC (DirectShow ${mode}, "${devName}", ${nCh}ch, audio_buffer_size=${dshowAudioBufferMs}ms)`,
              ffmpeg,
            )
            captureChild = spawn(ffmpeg, args, {
              stdio: ['ignore', 'pipe', 'pipe'],
              env: augmentPathForFfmpeg(process.env),
              windowsHide: true,
              cwd: path.dirname(ffmpeg),
            })
            attachCaptureProcessDiagnostics(captureChild, {
              captureKind: 'dshow',
              captureDeviceName: devName,
              captureDeviceIndex: n,
              ffmpegPath: ffmpeg,
            })
            captureChild.stdout.on('data', pushCaptureChunk)
            return
          }
        }
      } else if ((state.captureAvfoundationMode || 'auto') !== 'off') {
        console.info(
          '[inear] DirectShow: sem entrada resolvida (lista vazia ou heurística sem correspondência). Opcional: INEAR_CAPTURE_DEVICE_SUBSTRING, modo manual no painel, instalar ffmpeg no PATH, ou INEAR_CAPTURE_CMD.',
        )
      }
    }

    console.info(
      '[inear] captura do PC: desligada (senoides). macOS: Entrada Mac (AVFoundation); Windows: DirectShow (ffmpeg no PATH); ou INEAR_CAPTURE_CMD — ver README.',
    )
  }

  /**
   * @param {number} blockSamples
   * @param {number} nCh canais intercalados por sample (ch0,ch1,…)
   * @returns {Int16Array | null} interleaved … length blockSamples * nCh
   */
  function takePcmBlock(blockSamples, nCh) {
    const need = blockSamples * nCh * 2
    const capBytes = captureBufferSoftCapBytes(blockSamples, nCh)
    if (captureBuf.length > capBytes) {
      captureBuf = captureBuf.subarray(captureBuf.length - capBytes)
    }
    if (captureBuf.length < need) return null
    const slice = captureBuf.subarray(0, need)
    captureBuf = captureBuf.subarray(need)
    if (slice.byteOffset % 2 !== 0) {
      const copy = Buffer.allocUnsafe(need)
      slice.copy(copy, 0, 0, need)
      return new Int16Array(copy.buffer, 0, blockSamples * nCh)
    }
    return new Int16Array(slice.buffer, slice.byteOffset, blockSamples * nCh)
  }

  function gainForPhysicalInput(mx, idx, nCh) {
    const gi =
      mx.gainByIndex && typeof mx.gainByIndex === 'object' ? mx.gainByIndex : {}
    const k = String(idx)
    if (typeof gi[k] === 'number') {
      return Math.max(0, Math.min(4, gi[k]))
    }
    if (idx === 0) return Math.max(0, Math.min(4, Number(mx.gainL) || 1))
    if (idx === 1) return Math.max(0, Math.min(4, Number(mx.gainR) || 1))
    if (nCh === 2) {
      /* já coberto por 0 e 1 */
    }
    return 1
  }

  function sampleInput(capBlock, i, nCh, idx) {
    if (nCh < 1) return 0
    const ii = Math.max(0, Math.min(nCh - 1, idx))
    const mx = state.captureInputMatrix || {
      gainL: 1,
      gainR: 1,
      assign: {},
      gainByIndex: {},
    }
    const g = gainForPhysicalInput(mx, ii, nCh)
    return (capBlock[i * nCh + ii] / 32768) * g
  }

  function monoByChannelFromCapture(capBlock, i, nCh) {
    const mx = state.captureInputMatrix || {
      gainL: 1,
      gainR: 1,
      assign: {},
      gainByIndex: {},
    }
    const assign = mx.assign && typeof mx.assign === 'object' ? mx.assign : {}
    const out = {}
    for (const ch of state.showfile.channels) {
      if (
        typeof ch.captureInputIndex === 'number' &&
        Number.isFinite(ch.captureInputIndex)
      ) {
        const raw = Math.floor(ch.captureInputIndex)
        if (raw < 0 || raw >= nCh) {
          out[ch.id] = 0
        } else {
          out[ch.id] = sampleInput(capBlock, i, nCh, raw)
        }
        continue
      }
      const L = sampleInput(capBlock, i, nCh, 0)
      const R = nCh >= 2 ? sampleInput(capBlock, i, nCh, 1) : L
      let sumAll = 0
      if (nCh > 2) {
        for (let c = 0; c < nCh; c++) sumAll += sampleInput(capBlock, i, nCh, c)
        sumAll /= nCh
      }
      const tap = ch.sourceTap
      const modeRaw = assign[ch.id]
      const legacy =
        modeRaw === 'L' || modeRaw === 'R' || modeRaw === 'sum' ? modeRaw : null
      const mode =
        tap === 'L' || tap === 'R' || tap === 'sum'
          ? tap
          : legacy || 'sum'
      let mm
      if (mode === 'L') mm = L * 0.96
      else if (mode === 'R') mm = R * 0.96
      else if (nCh > 2) mm = sumAll
      else mm = (L + R) * 0.5
      out[ch.id] = mm
    }
    return out
  }

  startCaptureIfConfigured()

  function findMusicianByUsername(username) {
    return state.showfile.musicians.find((m) => m.username === username)
  }

  function findUserByUsername(username) {
    const key = String(username || '')
      .trim()
      .toLowerCase()
    if (!key) return undefined
    return state.users.find(
      (u) => u && String(u.username || '').trim().toLowerCase() === key,
    )
  }

  function hasAdminUser() {
    return state.users.some((u) => u.role === 'admin')
  }

  function signToken(payload) {
    return jwt.sign(payload, state.jwtSecret, { expiresIn: '12h' })
  }

  function authMiddleware(req, res, next) {
    const h = req.headers.authorization
    if (!h || !h.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing_token' })
    }
    try {
      req.user = jwt.verify(h.slice(7), state.jwtSecret)
      return next()
    } catch {
      return res.status(401).json({ error: 'invalid_token' })
    }
  }

  const loginLimiter = rateLimit({
    windowMs: 60_000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const ex = express()
  ex.use(cors())
  ex.use(express.json({ limit: '2mb' }))
  ex.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() })
  })
  ex.get('/api/server-addresses', (_req, res) => {
    const out = []
    const ifs = os.networkInterfaces() || {}
    for (const [name, rows] of Object.entries(ifs)) {
      for (const row of rows || []) {
        if (!row || row.internal) continue
        if (row.family !== 'IPv4') continue
        out.push({ iface: name, ip: row.address })
      }
    }
    res.json({ httpPort: HTTP_PORT, addresses: out })
  })
  ex.get('/api/setup/status', (_req, res) => {
    res.json({ required: !hasAdminUser() })
  })
  ex.post('/api/setup/bootstrap', loginLimiter, (req, res) => {
    if (hasAdminUser()) {
      return res.status(409).json({ error: 'already_initialized' })
    }
    const body = req.body || {}
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    if (!username || !password) {
      return res.status(400).json({ error: 'missing_fields' })
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'weak_password' })
    }
    if (findUserByUsername(username) || findMusicianByUsername(username)) {
      return res.status(409).json({ error: 'username_exists' })
    }
    state.users.push({
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin',
    })
    // Segurança e previsibilidade: reset de pairing e músicos default.
    state.pairing = null
    state.showfile.musicians = []
    saveState(userData, state)
    const token = signToken({ sub: username, role: 'admin' })
    res.json({ ok: true, token, role: 'admin' })
  })

  /**
   * @param {{ index: number, name: string }} d
   * @param {{ force?: boolean }} opts
   * @returns {{ channels: number | null, error: string | null }}
   */
  function probeCaptureRowResult(d, opts) {
    if (process.platform === 'darwin') {
      return probeAvfoundationInputChannelsResult(d.index, opts)
    }
    if (process.platform === 'win32') {
      return probeDshowInputChannelsResult(d.name, opts)
    }
    return { channels: null, error: null }
  }

  /**
   * @param {{ index: number, name: string }} d
   * @param {{ force?: boolean }} opts
   * @returns {Promise<{ channels: number | null, error: string | null }>}
   */
  async function probeCaptureRowResultAsync(d, opts) {
    if (process.platform === 'darwin') {
      return probeAvfoundationInputChannelsResultAsync(d.index, opts)
    }
    if (process.platform === 'win32') {
      return probeDshowInputChannelsResultAsync(d.name, opts)
    }
    return { channels: null, error: null }
  }

  ex.get('/api/session', authMiddleware, (_req, res) => {
    const envOn = Boolean(String(process.env.INEAR_CAPTURE_CMD || '').trim())
    const devices = listPcAudioCaptureDevicesCached()
    const meta = computePcCaptureMeta(devices)
    const configured =
      envOn ||
      meta.captureSource === 'avfoundation' ||
      meta.captureSource === 'dshow'
    const receiving =
      configured && captureChild && !captureChild.killed
        ? Date.now() - lastGoodCaptureMs < 3000
        : false
    res.json({
      ...serverHello('sess-1', {
        udpAudio: UDP_AUDIO_PORT,
        udpControl: UDP_CONTROL_PORT,
        http: HTTP_PORT,
        networkProfile: state.showfile.networkProfile,
      }),
      pcAudioCaptureConfigured: configured,
      pcAudioCaptureReceiving: receiving,
      audioCaptureSource: envOn ? 'env' : meta.captureSource,
      captureAvfoundationAudioIndex: meta.effectiveIndex,
      captureAvfoundationMode: meta.mode,
      captureAvfoundationAutoPicked: meta.autoPicked,
      captureChannelCount: normalizeCaptureChannelCount(),
      captureChannelCountAuto: state.captureChannelCountAuto !== false,
      audioBlockSamples: clampAudioBlockSamples(state.audioBlockSamples),
      captureDeviceName: meta.effectiveName || null,
      captureLastError: captureDebugState.lastError,
      captureLastGoodMsAgo: lastGoodCaptureMs ? Math.max(0, Date.now() - lastGoodCaptureMs) : null,
    })
  })
  ex.get('/api/audio-debug', authMiddleware, (_req, res) => {
    const envOn = Boolean(String(process.env.INEAR_CAPTURE_CMD || '').trim())
    const devices = listPcAudioCaptureDevicesCached()
    const meta = computePcCaptureMeta(devices)
    const configured =
      envOn ||
      meta.captureSource === 'avfoundation' ||
      meta.captureSource === 'dshow'
    const receiving =
      configured && captureChild && !captureChild.killed
        ? Date.now() - lastGoodCaptureMs < 3000
        : false
    const wsClientCount = Array.from(wsAudioByMusician.values()).reduce(
      (sum, set) => sum + set.size,
      0,
    )
    res.json({
      configured,
      receiving,
      captureSource: envOn ? 'env' : meta.captureSource,
      captureMode: meta.mode,
      captureDeviceName: meta.effectiveName || captureDebugState.captureDeviceName || null,
      captureDeviceIndex:
        meta.effectiveIndex != null ? meta.effectiveIndex : captureDebugState.captureDeviceIndex,
      ffmpegPath: captureDebugState.ffmpegPath,
      captureChildRunning: Boolean(captureChild && !captureChild.killed),
      captureChannelCount: normalizeCaptureChannelCount(),
      captureUnderruns,
      captureBufferedBytes: captureBuf.length,
      captureLastGoodMsAgo: lastGoodCaptureMs ? Math.max(0, Date.now() - lastGoodCaptureMs) : null,
      captureLastChunkMsAgo: captureDebugState.lastChunkAt
        ? Math.max(0, Date.now() - captureDebugState.lastChunkAt)
        : null,
      captureLastChunkBytes: captureDebugState.lastChunkBytes,
      captureTotalBytes: captureDebugState.totalBytes,
      captureLastError: captureDebugState.lastError,
      captureLastExit: captureDebugState.lastExit,
      captureStderrTail: captureDebugState.lastStderrLines,
      udpTargetCount: udpTargets.size,
      wsClientCount,
      webrtcSessionCount: webrtcSessions.size,
      webrtcSessions: summarizeWebRtcSessions(),
      lastUdpSendMsAgo: captureDebugState.lastUdpSendAt
        ? Math.max(0, Date.now() - captureDebugState.lastUdpSendAt)
        : null,
      lastUdpSendMusicianId: captureDebugState.lastUdpSendMusicianId,
      lastWsSendMsAgo: captureDebugState.lastWsSendAt
        ? Math.max(0, Date.now() - captureDebugState.lastWsSendAt)
        : null,
      lastWsSendMusicianId: captureDebugState.lastWsSendMusicianId,
      lastWebRtcSendMsAgo: captureDebugState.lastWebRtcSendAt
        ? Math.max(0, Date.now() - captureDebugState.lastWebRtcSendAt)
        : null,
      lastWebRtcSendMusicianId: captureDebugState.lastWebRtcSendMusicianId,
    })
  })
  ex.get('/api/audio-input-levels', authMiddleware, (_req, res) => {
    const envOn = Boolean(String(process.env.INEAR_CAPTURE_CMD || '').trim())
    const devices = listPcAudioCaptureDevicesCached()
    const meta = computePcCaptureMeta(devices)
    const configured =
      envOn ||
      meta.captureSource === 'avfoundation' ||
      meta.captureSource === 'dshow'
    const receiving =
      configured && captureChild && !captureChild.killed
        ? Date.now() - lastGoodCaptureMs < 3000
        : false
    res.json({
      captureChannelCount: normalizeCaptureChannelCount(),
      updatedAt: captureMeterState.updatedAt,
      receiving,
      levelsByIndex: captureMeterState.levelsByIndex || {},
    })
  })
  ex.get('/api/audio-capture-devices', authMiddleware, async (req, res) => {
    try {
      const q = req.query || {}
      const rawRefresh = q.refresh
      const refreshStr = Array.isArray(rawRefresh) ? rawRefresh[0] : rawRefresh
      const refreshProbe = refreshStr === '1' || refreshStr === 'true'
      if (refreshProbe) bustPcCaptureCaches()
      const devices = listPcAudioCaptureDevicesCached()
      const meta = computePcCaptureMeta(devices)
      const suggestion = pickPreferredAvfoundationDevice(devices)
      const manualIdx =
        (state.captureAvfoundationMode || 'auto') === 'manual'
          ? state.captureAvfoundationAudioIndex
          : null
      const rawProbe = q.probe
      const probeStr = Array.isArray(rawProbe) ? rawProbe[0] : rawProbe
      const probeAll = probeStr === 'all' || probeStr === '1'
      const rawDshowOpts = q.dshowOptions
      const dshowOptsStr = Array.isArray(rawDshowOpts) ? rawDshowOpts[0] : rawDshowOpts
      const dshowListOptionsRequested =
        process.platform === 'win32' &&
        probeAll &&
        (dshowOptsStr === '1' || dshowOptsStr === 'true')
      const ffmpegFound = Boolean(findFfmpegExecutable())
      const ffprobeFound = Boolean(findFfprobeExecutable())
      const usingBundledWinFfmpeg = process.platform === 'win32' && Boolean(getBundledWinFfmpegDir())
      /** @type {{ index: number, name: string, inputChannels: number | null, probeError: string | null, dshowOptionsTail?: string | null }[]} */
      let devicesWithInputs
      const ffmpegForOpts = findFfmpegExecutable()
      if (probeAll) {
        devicesWithInputs = await Promise.all(
          devices.map(async (d) => {
            const pr = await probeCaptureRowResultAsync(d, {
              force: refreshProbe,
            })
            let dshowOptionsTail = null
            if (dshowListOptionsRequested && ffmpegForOpts) {
              try {
                dshowOptionsTail = dshowListOptionsTailSync(ffmpegForOpts, d.name)
              } catch {
                dshowOptionsTail = null
              }
            }
            return {
              index: d.index,
              name: d.name,
              inputChannels: pr.channels,
              probeError: pr.error,
              ...(dshowListOptionsRequested ? { dshowOptionsTail: dshowOptionsTail ?? null } : {}),
            }
          }),
        )
      } else {
        devicesWithInputs = devices.map((d) => {
          const shouldProbe =
            d.index === meta.effectiveIndex ||
            (suggestion && d.index === suggestion.index)
          let inputChannels = null
          let probeError = null
          if (shouldProbe) {
            const pr = probeCaptureRowResult(d, {
              force: refreshProbe,
            })
            inputChannels = pr.channels
            probeError = pr.error
          } else if (process.platform === 'darwin') {
            const hit = avfInputChannelsProbeCache.get(d.index)
            if (hit && Date.now() - hit.at < AVF_PROBE_TTL_MS) {
              inputChannels = hit.channels
              probeError = hit.error
            }
          } else if (process.platform === 'win32') {
            const hit = dshowInputChannelsProbeCache.get(d.name)
            if (hit && Date.now() - hit.at < AVF_PROBE_TTL_MS) {
              inputChannels = hit.channels
              probeError = hit.error
            }
          }
          return { index: d.index, name: d.name, inputChannels, probeError }
        })
      }
      let effectiveProbedInputChannels = null
      let effectiveProbeError = null
      const activeNativeCapture =
        (meta.captureSource === 'avfoundation' || meta.captureSource === 'dshow') &&
        meta.effectiveIndex != null
      if (activeNativeCapture) {
        if (probeAll) {
          const row = devicesWithInputs.find((x) => x.index === meta.effectiveIndex)
          if (row) {
            effectiveProbedInputChannels = row.inputChannels
            effectiveProbeError = row.probeError
          }
        } else {
          const effRow = devices.find((x) => x.index === meta.effectiveIndex)
          const er = effRow
            ? probeCaptureRowResult(effRow, { force: refreshProbe })
            : { channels: null, error: 'índice sem dispositivo na lista' }
          effectiveProbedInputChannels = er.channels
          effectiveProbeError = er.error
        }
      }
      res.json({
        platform: process.platform,
        ffmpegFound,
        usingBundledWinFfmpeg,
        ffprobeFound,
        ...(process.platform === 'win32' && devicesWithInputs.length === 0
          ? {
              dshowListDiag: {
                exitCode: lastWinDshowListDiag.exitCode,
                combinedLen: lastWinDshowListDiag.combinedLen,
                outputTail: lastWinDshowListDiag.tail,
                ffmpegDevicesExitCode: lastWinDshowListDiag.ffmpegDevicesExitCode,
                ffmpegDevicesTail: lastWinDshowListDiag.ffmpegDevicesTail,
                ffmpegHasDshowInDevices: lastWinDshowListDiag.ffmpegHasDshowInDevices,
              },
            }
          : {}),
        devices: devicesWithInputs,
        captureSource: meta.captureSource,
        captureMode: meta.mode,
        manualAvfoundationAudioIndex:
          manualIdx !== null &&
          manualIdx !== undefined &&
          Number.isInteger(Number(manualIdx)) &&
          Number(manualIdx) >= 0
            ? Number(manualIdx)
            : null,
        effectiveAvfoundationAudioIndex: meta.effectiveIndex,
        effectiveDeviceName: meta.effectiveName,
        autoPicked: meta.autoPicked,
        suggestedDevice: suggestion
          ? { index: suggestion.index, name: suggestion.name }
          : null,
        effectiveProbedInputChannels,
        effectiveProbeError,
        captureChannelCount: normalizeCaptureChannelCount(),
        captureChannelCountAuto: state.captureChannelCountAuto !== false,
        captureInputMatrix: state.captureInputMatrix || {
          gainL: 1,
          gainR: 1,
          assign: {},
          gainByIndex: {},
        },
        mixerChannels: state.showfile.channels.map((c) => ({
          id: c.id,
          name: c.name,
          captureInputIndex: c.captureInputIndex,
        })),
      })
    } catch (e) {
      console.error('[inear] GET /api/audio-capture-devices', e)
      res.status(500).json({
        error: 'audio_capture_devices_failed',
        message: e && e.message ? String(e.message) : String(e),
      })
    }
  })
  ex.patch('/api/audio-capture-routing', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const b = req.body || {}
    const prevN = normalizeCaptureChannelCount()
    const mx = state.captureInputMatrix || {
      gainL: 1,
      gainR: 1,
      assign: {},
      gainByIndex: {},
    }
    if (!mx.gainByIndex || typeof mx.gainByIndex !== 'object') mx.gainByIndex = {}
    if (typeof b.gainL === 'number') {
      mx.gainL = Math.max(0, Math.min(4, b.gainL))
    }
    if (typeof b.gainR === 'number') {
      mx.gainR = Math.max(0, Math.min(4, b.gainR))
    }
    if (b.gainByIndex && typeof b.gainByIndex === 'object') {
      const nextGi = { ...mx.gainByIndex }
      for (const [key, val] of Object.entries(b.gainByIndex)) {
        const ik = Math.floor(Number(key))
        if (!Number.isFinite(ik) || ik < 0 || ik >= MVP_MAX_CAPTURE_CHANNELS) {
          continue
        }
        if (typeof val === 'number') {
          nextGi[String(ik)] = Math.max(0, Math.min(4, val))
        }
      }
      mx.gainByIndex = nextGi
    }
    if (b.assign && typeof b.assign === 'object') {
      const valid = new Set(state.showfile.channels.map((c) => c.id))
      const next = { ...mx.assign }
      for (const [k, v] of Object.entries(b.assign)) {
        if (!valid.has(k)) continue
        if (v !== 'L' && v !== 'R' && v !== 'sum') {
          return res.status(400).json({ error: 'invalid_assign', key: k })
        }
        next[k] = v
      }
      mx.assign = next
    }
    if (typeof b.captureChannelCount === 'number') {
      const nc = Math.floor(b.captureChannelCount)
      if (Number.isFinite(nc)) {
        state.captureChannelCount = Math.max(
          1,
          Math.min(MVP_MAX_CAPTURE_CHANNELS, nc),
        )
        state.captureChannelCountAuto = false
      }
    }
    if (typeof b.captureChannelCountAuto === 'boolean') {
      state.captureChannelCountAuto = b.captureChannelCountAuto
    }
    state.captureInputMatrix = mx
    saveState(userData, state)
    if (prevN !== normalizeCaptureChannelCount()) {
      startCaptureIfConfigured()
    }
    res.json({
      ok: true,
      captureInputMatrix: mx,
      captureChannelCount: normalizeCaptureChannelCount(),
      captureChannelCountAuto: state.captureChannelCountAuto !== false,
    })
  })
  ex.patch('/api/audio-capture-device', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    if (Boolean(String(process.env.INEAR_CAPTURE_CMD || '').trim())) {
      return res.status(409).json({
        error: 'env_capture_active',
        message:
          'INEAR_CAPTURE_CMD está definido; remove-o do ambiente para escolher a entrada pelo painel.',
      })
    }
    const body = req.body || {}
    let mode = body.captureAvfoundationMode
    const idxBody = body.avfoundationAudioIndex
    if (mode == null || mode === '') {
      if (
        idxBody === null ||
        idxBody === undefined ||
        idxBody === ''
      ) {
        mode = 'off'
      } else {
        mode = 'manual'
      }
    }
    if (!['auto', 'manual', 'off'].includes(mode)) {
      return res.status(400).json({ error: 'invalid_mode' })
    }
    state.captureAvfoundationMode = mode
    if (mode === 'manual') {
      const num = Number(idxBody)
      if (!Number.isInteger(num) || num < 0) {
        return res.status(400).json({ error: 'invalid_index' })
      }
      state.captureAvfoundationAudioIndex = num
    } else {
      state.captureAvfoundationAudioIndex = null
    }
    bustPcCaptureCaches()
    saveState(userData, state)
    startCaptureIfConfigured()
    res.json({
      ok: true,
      captureAvfoundationMode: state.captureAvfoundationMode,
      captureAvfoundationAudioIndex: state.captureAvfoundationAudioIndex,
    })
  })
  ex.post('/api/auth/login', loginLimiter, (req, res) => {
    const username = String((req.body || {}).username || '').trim()
    const password = String((req.body || {}).password || '')
    const u = findUserByUsername(username)
    let passOk = false
    try {
      passOk =
        Boolean(u) &&
        typeof u.passwordHash === 'string' &&
        bcrypt.compareSync(String(password || ''), u.passwordHash)
    } catch {
      passOk = false
    }
    if (!passOk) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }
    const token = signToken({ sub: u.username, role: u.role })
    res.json({ token, role: u.role })
  })
  ex.post('/api/auth/pair-login', loginLimiter, (req, res) => {
    const body = req.body || {}
    const code = body.code
    const username = String(body.username || '').trim()
    const p = state.pairing
    if (!p || Date.now() > p.expiresAt || String(code) !== p.code) {
      return res.status(401).json({ error: 'invalid_pairing_code' })
    }
    const u = findUserByUsername(username)
    if (!u || u.role !== 'musician') {
      return res.status(401).json({ error: 'invalid_musician' })
    }
    const token = signToken({ sub: u.username, role: 'musician' })
    res.json({ token, role: 'musician' })
  })
  ex.post('/api/webrtc/offer', authMiddleware, async (req, res) => {
    if (!wrtc) {
      return res.status(501).json({ error: 'webrtc_unavailable', message: 'wrtc não instalado.' })
    }
    if (req.user.role !== 'musician') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const strip = findMusicianByUsername(req.user.sub)
    if (!strip) {
      return res.status(404).json({ error: 'musician_not_found' })
    }
    const body = req.body || {}
    const sdp = typeof body.sdp === 'string' ? body.sdp : ''
    const latencyProfile = normalizeLatencyProfile(body.latencyProfile)
    if (!sdp) {
      return res.status(400).json({ error: 'invalid_offer' })
    }
    const sessionId = `rtc_${crypto.randomBytes(6).toString('hex')}`
    try {
      const pc = new wrtc.RTCPeerConnection({ iceServers: [] })
      const source = new wrtc.nonstandard.RTCAudioSource()
      const track = source.createTrack()
      pc.addTrack(track)
      pc.onconnectionstatechange = () => {
        const st = String(pc.connectionState || '')
        if (st === 'closed' || st === 'failed' || st === 'disconnected') {
          disposeWebRtcSession(sessionId)
        }
      }
      await pc.setRemoteDescription(
        new wrtc.RTCSessionDescription({
          type: 'offer',
          sdp,
        }),
      )
      const answer = await pc.createAnswer()
      if (!answer || !answer.sdp) {
        throw new Error('createAnswer_returned_empty')
      }
      const tunedAnswerSdp = answer && answer.sdp ? answer.sdp : ''
      if (!tunedAnswerSdp || !String(tunedAnswerSdp).trim()) {
        throw new Error('answer_sdp_empty')
      }
      await pc.setLocalDescription(
        new wrtc.RTCSessionDescription({
        type: 'answer',
        sdp: tunedAnswerSdp,
        }),
      )
      await waitIceGatheringComplete(pc, 350)
      const localAnswerSdp =
        pc.localDescription && typeof pc.localDescription.sdp === 'string'
          ? pc.localDescription.sdp
          : tunedAnswerSdp
      if (!localAnswerSdp || !String(localAnswerSdp).trim()) {
        throw new Error('local_answer_sdp_empty')
      }
      const session = {
        id: strip.id,
        pc,
        source,
        track,
        latencyProfile,
        lastRtcStats: null,
        statsTimer: null,
      }
      webrtcSessions.set(sessionId, session)
      session.statsTimer = startWebRtcSessionStatsPolling(sessionId, pc)
      let bucket = webrtcSessionsByMusician.get(strip.id)
      if (!bucket) {
        bucket = new Set()
        webrtcSessionsByMusician.set(strip.id, bucket)
      }
      bucket.add(sessionId)
      return res.json({
        ok: true,
        sessionId,
        type: 'answer',
        sdp: localAnswerSdp,
      })
    } catch (e) {
      disposeWebRtcSession(sessionId)
      return res.status(500).json({
        error: 'webrtc_offer_failed',
        message: e && e.message ? String(e.message) : String(e),
      })
    }
  })
  ex.post('/api/admin/musicians', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const body = req.body || {}
    const username = String(body.username || '').trim()
    const password = String(body.password || '')
    const name = String(body.name || username).trim()
    if (!username || !password || !name) {
      return res.status(400).json({ error: 'missing_fields' })
    }
    if (findUserByUsername(username) || findMusicianByUsername(username)) {
      return res.status(409).json({ error: 'username_exists' })
    }
    const ids = state.showfile.channels.map((c) => c.id)
    const musician = {
      id: `m_${crypto.randomBytes(5).toString('hex')}`,
      name,
      username,
      role: 'musician',
      sendGains: Object.fromEntries(ids.map((id) => [id, 1])),
      sendMutes: Object.fromEntries(ids.map((id) => [id, false])),
      mute: false,
      scope: { channelIds: [...ids], groupIds: [] },
      eqByChannel: {},
    }
    state.users.push({
      username,
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'musician',
    })
    state.showfile.musicians.push(musician)
    migrateShowfile(state.showfile)
    saveState(userData, state)
    res.json({ ok: true, musician })
  })
  ex.patch('/api/admin/musicians/:id', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const musician = state.showfile.musicians.find((m) => m.id === req.params.id)
    if (!musician) return res.status(404).json({ error: 'not_found' })
    const body = req.body || {}
    const prevUsername = musician.username
    const nextUsername =
      typeof body.username === 'string' && body.username.trim()
        ? body.username.trim()
        : prevUsername
    if (
      nextUsername !== prevUsername &&
      (findUserByUsername(nextUsername) || findMusicianByUsername(nextUsername))
    ) {
      return res.status(409).json({ error: 'username_exists' })
    }
    const user = findUserByUsername(prevUsername)
    if (!user) return res.status(404).json({ error: 'user_not_found' })
    if (typeof body.name === 'string' && body.name.trim()) musician.name = body.name.trim()
    musician.username = nextUsername
    user.username = nextUsername
    if (typeof body.password === 'string' && body.password) {
      user.passwordHash = bcrypt.hashSync(body.password, 10)
    }
    saveState(userData, state)
    res.json({ ok: true, musician })
  })
  ex.post('/api/admin/pairing-code', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const code = String(Math.floor(100000 + Math.random() * 900000))
    state.pairing = { code, expiresAt: Date.now() + 10 * 60 * 1000 }
    saveState(userData, state)
    res.json({ code, expiresAt: state.pairing.expiresAt })
  })
  ex.get('/api/showfile', authMiddleware, (_req, res) => {
    res.json(state.showfile)
  })
  ex.patch('/api/showfile/meta', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const { networkProfile, name } = req.body || {}
    if (networkProfile) {
      if (!['wifi_2_4', 'wifi_5', 'auto'].includes(networkProfile)) {
        return res.status(400).json({ error: 'invalid_network_profile' })
      }
      state.showfile.networkProfile = networkProfile
    }
    if (typeof name === 'string') state.showfile.name = name
    saveState(userData, state)
    res.json({ ok: true, showfile: state.showfile })
  })
  ex.put('/api/showfile', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const next = req.body
    if (!next || next.version !== 1) {
      return res.status(400).json({ error: 'invalid_showfile' })
    }
    if (next.channels?.length > MVP_MAX_INPUTS) {
      return res.status(400).json({ error: 'too_many_channels' })
    }
    migrateShowfile(next)
    state.showfile = next
    saveState(userData, state)
    res.json({ ok: true })
  })
  ex.post('/api/showfile/sync-interface-channels', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const envOn = Boolean(String(process.env.INEAR_CAPTURE_CMD || '').trim())
    bustPcCaptureCaches()
    const devices = listPcAudioCaptureDevicesCached()
    const meta = computePcCaptureMeta(devices)
    const hasNativeDeviceList =
      (process.platform === 'darwin' || process.platform === 'win32') &&
      Array.isArray(devices) &&
      devices.length > 0
    const captureOk =
      envOn ||
      meta.captureSource === 'avfoundation' ||
      meta.captureSource === 'dshow' ||
      hasNativeDeviceList
    if (!captureOk) {
      return res.status(400).json({
        error: 'capture_required',
        message:
          'É necessário ffmpeg a listar pelo menos uma entrada (Windows/macOS), ou define INEAR_CAPTURE_CMD, para sincronizar as faixas da interface.',
      })
    }
    const body = req.body || {}
    if (typeof body.channelCount === 'number') {
      const nc = Math.floor(body.channelCount)
      if (Number.isFinite(nc)) {
        state.captureChannelCount = Math.max(
          1,
          Math.min(MVP_MAX_CAPTURE_CHANNELS, nc),
        )
      }
    }
    const n = normalizeCaptureChannelCount()
    const baseName =
      meta.effectiveName ||
      (envOn
        ? 'Captura (INEAR_CAPTURE_CMD)'
        : devices[0]?.name || 'Interface')
    syncInterfaceChannels(state.showfile, { channelCount: n, baseName })
    saveState(userData, state)
    startCaptureIfConfigured()
    res.json({
      ok: true,
      showfile: state.showfile,
      captureChannelCount: n,
    })
  })
  ex.patch('/api/showfile/channel/:id', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const ch = state.showfile.channels.find((c) => c.id === req.params.id)
    if (!ch) return res.status(404).json({ error: 'not_found' })
    const b = req.body || {}
    for (const k of ['gain', 'pan', 'mute', 'lockEq', 'name', 'icon']) {
      if (b[k] === undefined) continue
      if (k === 'gain') {
        const g = Number(b.gain)
        ch.gain = Math.max(0, Math.min(4, Number.isFinite(g) ? g : ch.gain))
        continue
      }
      ch[k] = b[k]
    }
    if (b.color !== undefined) {
      ch.color = normalizeChannelColor(b.color)
    }
    if (b.sourceTap !== undefined) {
      if (b.sourceTap !== 'L' && b.sourceTap !== 'R' && b.sourceTap !== 'sum') {
        return res.status(400).json({ error: 'invalid_sourceTap' })
      }
      ch.sourceTap = b.sourceTap
    }
    if (b.captureInputIndex !== undefined) {
      const idx = Math.floor(Number(b.captureInputIndex))
      if (!Number.isFinite(idx) || idx < 0 || idx >= MVP_MAX_CAPTURE_CHANNELS) {
        return res.status(400).json({ error: 'invalid_captureInputIndex' })
      }
      ch.captureInputIndex = idx
    }
    if (b.eq && typeof b.eq === 'object') {
      ch.eq = { ...ch.eq, ...b.eq }
    }
    ch.eq.lowDb = clampEqDb(ch.eq.lowDb)
    ch.eq.midDb = clampEqDb(ch.eq.midDb)
    ch.eq.highDb = clampEqDb(ch.eq.highDb)
    saveState(userData, state)
    res.json(ch)
  })
  function mergeMusicianEqByChannel(musician, partialByCid, skipScope) {
    if (!musician.eqByChannel) musician.eqByChannel = {}
    for (const [cid, eq] of Object.entries(partialByCid)) {
      const ch = state.showfile.channels.find((c) => c.id === cid)
      if (!ch || ch.lockEq) continue
      if (
        !skipScope &&
        !channelVisibleToMusician(musician, cid, state.showfile)
      ) {
        continue
      }
      if (!eq || typeof eq !== 'object') continue
      const prev = musician.eqByChannel[cid] || {
        lowDb: ch.eq.lowDb,
        midDb: ch.eq.midDb,
        highDb: ch.eq.highDb,
      }
      musician.eqByChannel[cid] = {
        lowDb:
          typeof eq.lowDb === 'number' ? clampEqDb(eq.lowDb) : clampEqDb(prev.lowDb),
        midDb:
          typeof eq.midDb === 'number' ? clampEqDb(eq.midDb) : clampEqDb(prev.midDb),
        highDb:
          typeof eq.highDb === 'number'
            ? clampEqDb(eq.highDb)
            : clampEqDb(prev.highDb),
      }
    }
  }
  function sanitizeSendGainsInput(partial) {
    const out = {}
    for (const [k, raw] of Object.entries(partial || {})) {
      const n = Number(raw)
      if (!Number.isFinite(n)) continue
      out[k] = Math.max(0, Math.min(4, n))
    }
    return out
  }

  ex.patch('/api/showfile/musician/:id', authMiddleware, (req, res) => {
    const m = state.showfile.musicians.find((x) => x.id === req.params.id)
    if (!m) return res.status(404).json({ error: 'not_found' })
    if (req.user.role === 'admin') {
      const b = req.body || {}
      // Mesmo que o músico: PATCH envia só uma chave em sendGains/sendMutes — tem de fazer merge.
      if (b.sendGains && typeof b.sendGains === 'object') {
        m.sendGains = { ...m.sendGains, ...sanitizeSendGainsInput(b.sendGains) }
      }
      if (b.sendMutes && typeof b.sendMutes === 'object') {
        m.sendMutes = { ...m.sendMutes, ...b.sendMutes }
      }
      if (typeof b.mute === 'boolean') m.mute = b.mute
      if (b.name !== undefined) m.name = b.name
      if (b.scope !== undefined) m.scope = b.scope
      if (b.eqByChannel && typeof b.eqByChannel === 'object') {
        mergeMusicianEqByChannel(m, b.eqByChannel, true)
      }
    } else if (req.user.role === 'musician') {
      const self = findMusicianByUsername(req.user.sub)
      if (!self || self.id !== m.id) {
        return res.status(403).json({ error: 'forbidden' })
      }
      const body = req.body || {}
      if (body.sendGains) {
        m.sendGains = { ...m.sendGains, ...sanitizeSendGainsInput(body.sendGains) }
      }
      if (body.sendMutes) m.sendMutes = { ...m.sendMutes, ...body.sendMutes }
      if (typeof body.mute === 'boolean') m.mute = body.mute
      if (body.eqByChannel && typeof body.eqByChannel === 'object') {
        mergeMusicianEqByChannel(m, body.eqByChannel, false)
      }
    } else {
      return res.status(403).json({ error: 'forbidden' })
    }
    saveState(userData, state)
    res.json(m)
  })
  ex.post('/api/telemetry', authMiddleware, (req, res) => {
    const sub = req.user.sub
    const b = req.body || {}
    const rttRaw = b.rttMs
    const rtt =
      typeof rttRaw === 'number' && Number.isFinite(rttRaw)
        ? Math.max(0, Math.min(5000, rttRaw))
        : 0
    const seqGaps =
      typeof b.sequenceGaps === 'number' && Number.isFinite(b.sequenceGaps)
        ? Math.max(0, Math.floor(b.sequenceGaps))
        : 0
    const aheadMs =
      typeof b.aheadMs === 'number' && Number.isFinite(b.aheadMs)
        ? Math.max(0, Math.min(5000, b.aheadMs))
        : 0
    const estimatedE2eMs =
      typeof b.estimatedE2eMs === 'number' && Number.isFinite(b.estimatedE2eMs)
        ? Math.max(0, Math.min(10000, b.estimatedE2eMs))
        : 0
    const queueDepth =
      typeof b.queueDepth === 'number' && Number.isFinite(b.queueDepth)
        ? Math.max(0, Math.min(200, Math.round(b.queueDepth)))
        : 0
    const drops =
      typeof b.drops === 'number' && Number.isFinite(b.drops)
        ? Math.max(0, Math.floor(b.drops))
        : 0
    const underruns =
      typeof b.underruns === 'number' && Number.isFinite(b.underruns)
        ? Math.max(0, Math.floor(b.underruns))
        : 0
    const slaOver1s =
      typeof b.slaOver1s === 'number' && Number.isFinite(b.slaOver1s)
        ? Math.max(0, Math.floor(b.slaOver1s))
        : 0
    const latencyProfile =
      typeof b.latencyProfile === 'string' && b.latencyProfile
        ? String(b.latencyProfile).slice(0, 24)
        : 'unknown'
    const prev = telemetryBySub.get(sub) || {
      lastReportSeqGaps: /** @type {number | null} */ (null),
      samples: [],
    }
    let gapsDelta = 0
    if (prev.lastReportSeqGaps != null) {
      gapsDelta = Math.max(0, seqGaps - prev.lastReportSeqGaps)
    }
    prev.lastReportSeqGaps = seqGaps
    prev.samples.push({
      t: Date.now(),
      rtt,
      gapsDelta,
      aheadMs,
      estimatedE2eMs,
      queueDepth,
      drops,
      underruns,
      slaOver1s,
      latencyProfile,
    })
    if (prev.samples.length > 40) {
      prev.samples.splice(0, prev.samples.length - 40)
    }
    telemetryBySub.set(sub, prev)
    if (rtt > 200 || gapsDelta > 2 || estimatedE2eMs > 1000) {
      console.info('[telemetry]', sub, {
        rttMs: rtt,
        gapsDelta,
        sequenceGaps: seqGaps,
        estimatedE2eMs,
        aheadMs,
        queueDepth,
        latencyProfile,
      })
    }
    res.json({ ok: true })
  })

  ex.get('/api/network-quality', authMiddleware, (req, res) => {
    if (req.user.role === 'admin') {
      const byUsername = {}
      for (const u of state.users) {
        if (u.role !== 'musician') continue
        const samp = telemetryBySub.get(u.username)?.samples
        byUsername[u.username] = computeQualityFromSamples(samp)
      }
      return res.json({ self: null, byUsername })
    }
    if (req.user.role === 'musician') {
      const samp = telemetryBySub.get(req.user.sub)?.samples
      return res.json({
        self: computeQualityFromSamples(samp),
        byUsername: {},
      })
    }
    return res.status(403).json({ error: 'forbidden' })
  })

  ex.patch('/api/audio-engine', authMiddleware, (req, res) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden' })
    }
    const b = req.body || {}
    if (b.audioBlockSamples !== undefined) {
      state.audioBlockSamples = clampAudioBlockSamples(b.audioBlockSamples)
      saveState(userData, state)
    }
    res.json({
      ok: true,
      audioBlockSamples: clampAudioBlockSamples(state.audioBlockSamples),
    })
  })

  const httpServer = http.createServer(ex)
  function notifyServiceError(kind, port, err) {
    const payload = {
      kind,
      port,
      code: err && err.code ? String(err.code) : '',
      message: err && err.message ? String(err.message) : String(err),
    }
    console.error('[inear] bind falhou:', payload)
    try {
      app.emit('inear:service-error', payload)
    } catch {
      /* ignore */
    }
  }
  httpServer.on('connection', (socket) => {
    try {
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 15000)
    } catch {
      /* ignore */
    }
  })
  httpServer.on('error', (err) => {
    notifyServiceError('http', HTTP_PORT, err)
  })
  const { WebSocketServer } = require('ws')
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  })
  const wsAudioProfileBySocket = new WeakMap()

  function activeMusicianIdsForAudio() {
    const s = new Set(udpTargets.keys())
    for (const id of wsAudioByMusician.keys()) s.add(id)
    for (const id of webrtcSessionsByMusician.keys()) s.add(id)
    return s
  }
  function disposeWebRtcSession(sessionId) {
    const sess = webrtcSessions.get(sessionId)
    if (!sess) return
    webrtcSessions.delete(sessionId)
    const byM = webrtcSessionsByMusician.get(sess.id)
    if (byM) {
      byM.delete(sessionId)
      if (byM.size === 0) webrtcSessionsByMusician.delete(sess.id)
    }
    try {
      if (sess.statsTimer) clearInterval(sess.statsTimer)
    } catch {
      /* */
    }
    try {
      if (sess.track) sess.track.stop()
    } catch {
      /* */
    }
    try {
      if (sess.pc) sess.pc.close()
    } catch {
      /* */
    }
  }
  async function waitIceGatheringComplete(pc, timeoutMs = 1200) {
    if (!pc || pc.iceGatheringState === 'complete') return
    await new Promise((resolve) => {
      let done = false
      const onState = () => {
        if (pc.iceGatheringState === 'complete' && !done) {
          done = true
          cleanup()
          resolve()
        }
      }
      const timer = setTimeout(() => {
        if (!done) {
          done = true
          cleanup()
          resolve()
        }
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        try {
          pc.removeEventListener('icegatheringstatechange', onState)
        } catch {
          /* */
        }
      }
      try {
        pc.addEventListener('icegatheringstatechange', onState)
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
  }
  function tuneWebRtcAudioSdp(sdp, latencyProfile = 'pro') {
    const raw = String(sdp || '')
    if (!raw.trim()) return raw
    const desiredPtime =
      latencyProfile === 'wifi24' || latencyProfile === 'mid200'
        ? 20
        : latencyProfile === 'provocal'
          ? 3
          : latencyProfile === 'pro'
            ? 5
            : 10
    const lines = raw.replace(/\r\n/g, '\n').split('\n')
    const mediaIndex = lines.findIndex((line) => line.startsWith('m=audio '))
    if (mediaIndex === -1) return raw
    let mediaEnd = lines.findIndex((line, idx) => idx > mediaIndex && line.startsWith('m='))
    if (mediaEnd === -1) mediaEnd = lines.length
    const opusMap = lines
      .slice(mediaIndex, mediaEnd)
      .map((line) => /^\s*a=rtpmap:(\d+)\s+opus\/48000\/2\s*$/i.exec(line))
      .find(Boolean)
    const opusPayload = opusMap ? opusMap[1] : null
    if (!opusPayload) return raw
    const section = lines.slice(mediaIndex, mediaEnd)
    const fmtpIdx = section.findIndex((line) => line.startsWith(`a=fmtp:${opusPayload} `))
    const tunedFmtp = buildWebRtcOpusFmtp(opusPayload, fmtpIdx >= 0 ? section[fmtpIdx] : '', desiredPtime, latencyProfile)
    if (fmtpIdx >= 0) section[fmtpIdx] = tunedFmtp
    else section.push(tunedFmtp)
    upsertSdpSectionLine(section, 'a=ptime:', `a=ptime:${desiredPtime}`)
    upsertSdpSectionLine(section, 'a=maxptime:', `a=maxptime:${desiredPtime}`)
    const merged = [...lines.slice(0, mediaIndex), ...section, ...lines.slice(mediaEnd)]
    return `${merged.join('\r\n').trim()}\r\n`
  }
  function buildWebRtcOpusFmtp(payload, currentLine, desiredPtime, latencyProfile = 'pro') {
    const params = new Map()
    const aggressive = latencyProfile === 'pro' || latencyProfile === 'provocal'
    String(currentLine || '')
      .replace(new RegExp(`^a=fmtp:${payload}\\s+`), '')
      .split(';')
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((kv) => {
        const idx = kv.indexOf('=')
        if (idx <= 0) return
        params.set(kv.slice(0, idx).trim(), kv.slice(idx + 1).trim())
      })
    params.set('minptime', String(desiredPtime))
    params.set('stereo', '1')
    params.set('sprop-stereo', '1')
    params.set('maxplaybackrate', String(MVP_SAMPLE_RATE_HZ))
    params.set('usedtx', '0')
    params.set('useinbandfec', aggressive ? '0' : '1')
    params.set('cbr', aggressive ? '0' : params.get('cbr') || '0')
    params.set(
      'maxaveragebitrate',
      latencyProfile === 'provocal' ? '128000' : aggressive ? '160000' : params.get('maxaveragebitrate') || '128000',
    )
    params.set('x-google-min-bitrate', latencyProfile === 'provocal' ? '96' : aggressive ? '128' : '96')
    params.set('x-google-start-bitrate', latencyProfile === 'provocal' ? '128' : aggressive ? '160' : '128')
    params.set('x-google-max-bitrate', latencyProfile === 'provocal' ? '160' : aggressive ? '192' : '160')
    return `a=fmtp:${payload} ${Array.from(params.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join(';')}`
  }
  function upsertSdpSectionLine(section, prefix, replacement) {
    const idx = section.findIndex((line) => line.startsWith(prefix))
    if (idx >= 0) section[idx] = replacement
    else section.push(replacement)
  }
  function normalizeLatencyProfile(input) {
    if (input === 'provocal' || input === 'pro' || input === 'low' || input === 'wifi24') return input
    if (input === 'mid200') return input
    return 'stable'
  }
  function preferredWireCodecForProfile(profile) {
    if (profile === 'wifi24') return 'mulaw_u8'
    if (profile === 'provocal') return 'pcm_s16'
    if (profile === 'pro') return 'pcm_s16'
    return 'pcm_s16'
  }
  function wireCodecForSocket(profile, bufferedAmount, pcmWireBytes) {
    if (profile === 'wifi24') return 'mulaw_u8'
    if (profile === 'provocal') {
      return bufferedAmount > pcmWireBytes * 0.1 ? 'mulaw_u8' : 'pcm_s16'
    }
    if (profile === 'pro') {
      return bufferedAmount > pcmWireBytes * 0.2 ? 'mulaw_u8' : 'pcm_s16'
    }
    if (profile === 'low') {
      return bufferedAmount > pcmWireBytes * 0.65 ? 'mulaw_u8' : 'pcm_s16'
    }
    return bufferedAmount > pcmWireBytes * 2 ? 'mulaw_u8' : 'pcm_s16'
  }
  /** Limiar `bufferedAmount` antes de saltar um tick (evita fila TCP gigante no cliente). */
  function wsBufferedFactorForProfile(profile) {
    /* `pro`: palco 5 GHz, não tolera backlog. `wifi24`: menos fila TCP em 2,4 GHz (LAN interna pode usar UDP em vez disto).
     * `stable`: mais backpressure no Node se o socket enche. */
    if (profile === 'provocal') return 0.2
    if (profile === 'pro') return 0.35
    if (profile === 'low') return 0.75
    if (profile === 'wifi24') return 0.5
    return 8
  }

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname = ''
    try {
      pathname = new URL(request.url || '', 'http://x').pathname
    } catch {
      socket.destroy()
      return
    }
    if (pathname !== '/api/stream/audio') {
      socket.destroy()
      return
    }
    let token = ''
    let latencyProfile = 'stable'
    try {
      const u = new URL(request.url || '', 'http://x')
      token = u.searchParams.get('token') || ''
      latencyProfile = normalizeLatencyProfile(u.searchParams.get('latency'))
    } catch {
      socket.destroy()
      return
    }
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    try {
      const pl = jwt.verify(token, state.jwtSecret)
      if (pl.role !== 'musician') {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      const strip = findMusicianByUsername(pl.sub)
      if (!strip) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        try {
          socket.setNoDelay(true)
          socket.setKeepAlive(true, 15000)
        } catch {
          /* ignore */
        }
        const mid = strip.id
        let set = wsAudioByMusician.get(mid)
        if (!set) {
          set = new Set()
          wsAudioByMusician.set(mid, set)
        }
        set.add(ws)
        wsAudioProfileBySocket.set(ws, latencyProfile)
        ws.on('close', () => {
          set.delete(ws)
          if (set.size === 0) wsAudioByMusician.delete(mid)
        })
        ws.on('error', () => {
          /* ignore */
        })
        try {
          ws.send(
            JSON.stringify({
              t: 'hello',
              musicianId: mid,
              sampleRateHz: MVP_SAMPLE_RATE_HZ,
              blockSamples: audioBlockSamples(),
              latencyProfile,
              wireCodec:
                latencyProfile === 'pro'
                  ? 'adaptive-pcm16-mulaw'
                  : preferredWireCodecForProfile(latencyProfile),
            }),
          )
        } catch {
          /* ignore */
        }
        console.info('[inear] WebSocket áudio (retorno):', pl.sub, mid, latencyProfile)
      })
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
    }
  })

  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.info(`[inear] HTTP API http://0.0.0.0:${HTTP_PORT}`)
    console.info(
      `[inear] WebSocket retorno (músico): ws://<host>:${HTTP_PORT}/api/stream/audio?token=<JWT>`,
    )
  })

  const audioSock = dgram.createSocket('udp4')
  audioSock.on('error', (err) => {
    notifyServiceError('udp-audio', UDP_AUDIO_PORT, err)
  })
  audioSock.bind(UDP_AUDIO_PORT, () => {
    console.info(`[inear] UDP áudio :${UDP_AUDIO_PORT}`)
  })

  const controlSock = dgram.createSocket('udp4')
  controlSock.on('error', (err) => {
    notifyServiceError('udp-control', UDP_CONTROL_PORT, err)
  })
  controlSock.bind(UDP_CONTROL_PORT, () => {
    console.info(`[inear] UDP controle :${UDP_CONTROL_PORT}`)
  })

  controlSock.on('message', (msg, rinfo) => {
    let j
    try {
      j = JSON.parse(msg.toString('utf8'))
    } catch {
      return
    }
    if (j.t !== 'reg' || !j.token) return
    try {
      const pl = jwt.verify(j.token, state.jwtSecret)
      if (pl.role !== 'musician') return
      const strip = findMusicianByUsername(pl.sub)
      if (!strip) return
      udpTargets.set(strip.id, { address: rinfo.address, port: rinfo.port })
      const ack = Buffer.from(
        JSON.stringify({ t: 'ack', musicianId: strip.id }),
      )
      controlSock.send(ack, rinfo.port, rinfo.address)
    } catch {
      /* ignore */
    }
  })

  function audioTick() {
    const block = audioBlockSamples()
    const delay = (1000 * block) / MVP_SAMPLE_RATE_HZ
    const base = sampleClock
    const sf = state.showfile
    const activeMusicianIds = activeMusicianIdsForAudio()
    const musicianById = new Map(sf.musicians.map((m) => [m.id, m]))
    const fadeStep = 1 / muteFadeSamples()
    const gOut = 30000
    sampleClock += block
    audioSeq += 1
    const ts = process.hrtime.bigint()
    const nCh = normalizeCaptureChannelCount()
    const capBlock = captureChild ? takePcmBlock(block, nCh) : null
    const useCapture = capBlock !== null
    if (useCapture && capBlock) {
      lastGoodCaptureMs = Date.now()
      updateCaptureMeters(capBlock, nCh)
    } else {
      decayCaptureMeters(nCh)
    }
    if (captureChild && !useCapture) {
      captureUnderruns += 1
      if (captureUnderruns === 1 || captureUnderruns % 250 === 0) {
        console.warn(
          '[inear] captura: poucos dados do ffmpeg (buffer vazio) — bloco em silêncio para evitar artefactos; verifica INEAR_CAPTURE_CMD, índice AVFoundation no painel, ou o dispositivo de áudio.',
        )
      }
    }
    const monoFrames = new Array(block)
    if (useCapture) {
      for (let i = 0; i < block; i++) {
        monoFrames[i] = monoByChannelFromCapture(capBlock, i, nCh)
      }
    } else if (captureChild) {
      const silentFrame = silentMonoByChannel()
      monoFrames.fill(silentFrame)
    } else {
      for (let i = 0; i < block; i++) {
        monoFrames[i] = monoByChannelAt(base + i)
      }
    }
    for (const musicianId of activeMusicianIds) {
      const mStrip = musicianById.get(musicianId)
      if (!mStrip) continue
      let rampState = muteRampByMusician.get(musicianId)
      if (!rampState) {
        rampState = new Map()
        muteRampByMusician.set(musicianId, rampState)
      }
      const interleaved = new Int16Array(block * 2)
      for (let i = 0; i < block; i++) {
        const mono = monoFrames[i]
        const { l, r } = mixMusicianStereoFromMonoSources(
          sf,
          mStrip,
          mono,
          {
            getSourceGainMultiplier(sourceId) {
              const target = mStrip.sendMutes?.[sourceId] ? 0 : 1
              const prev = rampState.get(sourceId)
              const current = typeof prev === 'number' ? prev : target
              const next =
                current < target
                  ? Math.min(target, current + fadeStep)
                  : current > target
                    ? Math.max(target, current - fadeStep)
                    : current
              rampState.set(sourceId, next)
              return next
            },
          },
        )
        // ~-1,1 → s16 com margem (menos clipping duro / menos artefactos “metálicos”)
        interleaved[i * 2] = Math.max(
          -32768,
          Math.min(32767, Math.round(l * gOut)),
        )
        interleaved[i * 2 + 1] = Math.max(
          -32768,
          Math.min(32767, Math.round(r * gOut)),
        )
      }
      const udpTarget = udpTargets.get(musicianId)
      if (udpTarget) {
        const udpWire = Buffer.from(
          encodeStereoPcmFrame({
            sequence: audioSeq,
            serverTimestampNs: ts,
            pcmInterleavedS16: interleaved,
            codec:
              sf.networkProfile === 'wifi_2_4' ? 'mulaw_u8' : 'pcm_s16',
          }),
        )
        audioSock.send(udpWire, udpTarget.port, udpTarget.address, (err) => {
          if (err) console.warn('[udp send]', err.message)
          else {
            captureDebugState.lastUdpSendAt = Date.now()
            captureDebugState.lastUdpSendMusicianId = musicianId
          }
        })
      }
      const wsSet = wsAudioByMusician.get(musicianId)
      if (wsSet && wsSet.size > 0) {
        for (const ws of wsSet) {
          if (ws.readyState === 1) {
            const latencyProfile = wsAudioProfileBySocket.get(ws) || 'stable'
            const pcmWireBytes = interleaved.length * 2 + 32
            const bufferedAmount =
              typeof ws.bufferedAmount === 'number' ? ws.bufferedAmount : 0
            const codec = wireCodecForSocket(latencyProfile, bufferedAmount, pcmWireBytes)
            const wire = Buffer.from(
              encodeStereoPcmFrame({
                sequence: audioSeq,
                serverTimestampNs: ts,
                pcmInterleavedS16: interleaved,
                codec,
              }),
            )
            if (
              bufferedAmount > wire.length * wsBufferedFactorForProfile(latencyProfile)
            ) {
              continue
            }
            try {
              ws.send(wire, { binary: true })
              captureDebugState.lastWsSendAt = Date.now()
              captureDebugState.lastWsSendMusicianId = musicianId
            } catch {
              /* ignore */
            }
          }
        }
      }
      const rtcSet = webrtcSessionsByMusician.get(musicianId)
      if (rtcSet && rtcSet.size > 0) {
        for (const sid of rtcSet) {
          const sess = webrtcSessions.get(sid)
          if (!sess || !sess.source) continue
          if (!feedWebRtcSessionAudio(sess, interleaved)) {
            disposeWebRtcSession(sid)
          } else {
            captureDebugState.lastWebRtcSendAt = Date.now()
            captureDebugState.lastWebRtcSendMusicianId = musicianId
          }
        }
      }
    }
    nextAudioTickAt += delay
    const now = Date.now()
    if (nextAudioTickAt < now - delay * 3) {
      nextAudioTickAt = now + delay
    }
    audioTimeout = setTimeout(audioTick, Math.max(0, nextAudioTickAt - now))
  }
  nextAudioTickAt = Date.now() + (1000 * audioBlockSamples()) / MVP_SAMPLE_RATE_HZ
  audioTick()

  function shutdown() {
    if (audioTimeout) clearTimeout(audioTimeout)
    stopCaptureChild()
    try {
      wss.clients.forEach((c) => c.close())
      wss.close()
    } catch {
      /* ignore */
    }
    wsAudioByMusician.clear()
    for (const sid of Array.from(webrtcSessions.keys())) {
      disposeWebRtcSession(sid)
    }
    httpServer.close()
    audioSock.close()
    controlSock.close()
  }

  return {
    shutdown,
    getPorts: () => ({ HTTP_PORT, UDP_AUDIO_PORT, UDP_CONTROL_PORT }),
  }
}

module.exports = { createServices }
