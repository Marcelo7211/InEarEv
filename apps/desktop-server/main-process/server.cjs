const path = require('path')
const fs = require('fs')
const http = require('http')
const dgram = require('dgram')
const crypto = require('crypto')
const { spawn, spawnSync, execFileSync, execFile } = require('child_process')
const util = require('util')
const execFileP = util.promisify(execFile)

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
  MVP_MAX_INPUTS,
  MVP_MAX_CAPTURE_CHANNELS,
  MVP_SAMPLE_RATE_HZ,
  normalizeChannelColor,
  serverHello,
} = protocol

const HTTP_PORT = 3847
const UDP_AUDIO_PORT = 9876
const UDP_CONTROL_PORT = 9877

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
  candidates.push(path.join(__dirname, '..', 'resources', 'ffmpeg-win'))
  for (const d of candidates) {
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
  const r = spawnSync(ffmpeg, args, { ...spawnOpts, windowsHide: true })
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

/** @returns {Array<{ index: number, name: string }>} */
function parseDshowAudioDevices(text) {
  const lines = String(text || '').split(/\r?\n/)
  const aIdx = lines.findIndex((l) => /DirectShow audio devices/i.test(l))
  if (aIdx === -1) return []
  const names = []
  const videoRe = /DirectShow video devices/i
  for (let i = aIdx + 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw) continue
    if (videoRe.test(raw)) break
    if (/Alternative name/i.test(raw)) continue
    const m = raw.match(/"([^"]+)"/)
    if (m) names.push(m[1])
  }
  return names.map((name, index) => ({ index, name }))
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

function defaultState() {
  const showfile = migrateShowfile(defaultShowfile())
  // Primeira execução: instalação "limpa". Admin será criado no wizard inicial.
  showfile.musicians = []
  return {
    showfile,
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    pairing: null,
    users: [],
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
    audioBlockSamples: 128,
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
        raw.audioBlockSamples = 128
      } else {
        raw.audioBlockSamples = clampAudioBlockSamples(raw.audioBlockSamples)
      }
      if (expandMusicianScopeForInterfaceStrips(raw.showfile)) {
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
  /** @type {Map<string, { lastReportSeqGaps: number | null, samples: Array<{ t: number, rtt: number, gapsDelta: number }> }>} */
  const telemetryBySub = new Map()
  /** @type {Map<string, { address: string, port: number }>} */
  const udpTargets = new Map()
  /** @type {Map<string, Set<import('ws').WebSocket>>} retorno no telemóvel (Expo Go) sem UDP nativo */
  const wsAudioByMusician = new Map()
  const muteRampByMusician = new Map()
  let audioSeq = 0
  let sampleClock = 0
  let audioTimeout = null
  let nextAudioTickAt = Date.now()

  function audioBlockSamples() {
    return clampAudioBlockSamples(state.audioBlockSamples)
  }

  function networkHint(level, avgRtt, gapsPm) {
    if (level === 'bad') {
      if (gapsPm > 8) {
        return 'Muitos saltos de pacotes — prefira Wi‑Fi 5 GHz, router dedicado ao palco e servidor com Ethernet ao AP.'
      }
      return 'Latência de rede alta — aproxime o telemóvel do router, evite VPN e redes públicas.'
    }
    if (level === 'warn') {
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
    const gapSum = recent.reduce((a, s) => a + (s.gapsDelta || 0), 0)
    const spanMin = Math.max(0.25, (now - recent[0].t) / 60000)
    const gapsPerMinute = gapSum / spanMin
    let level = 'good'
    if (avgRtt > 85 || gapsPerMinute > 18) level = 'bad'
    else if (avgRtt > 38 || gapsPerMinute > 5) level = 'warn'
    return {
      level,
      rttMs: Math.round(avgRtt * 10) / 10,
      jitterMs: Math.round(jitter * 10) / 10,
      gapsPerMinute: Math.round(gapsPerMinute * 10) / 10,
      hint: networkHint(level, avgRtt, gapsPerMinute),
    }
  }
  function muteFadeSamples() {
    return Math.max(1, Math.round(MVP_SAMPLE_RATE_HZ * 0.02))
  }

  let captureMeterState = {
    levelsByIndex: {},
    updatedAt: 0,
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
    if (!ffmpeg) return []
    const r = spawnSync(
      ffmpeg,
      ['-hide_banner', '-f', 'dshow', '-list_devices', 'true', '-i', 'dummy'],
      {
        encoding: 'utf8',
        env: augmentPathForFfmpeg(process.env),
        windowsHide: true,
      },
    )
    const combined = `${r.stderr || ''}${r.stdout || ''}`
    return parseDshowAudioDevices(combined)
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
    return picked ? picked.index : null
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
    const capBytes = 4 * MVP_SAMPLE_RATE_HZ * 4
    if (captureBuf.length > capBytes) {
      captureBuf = captureBuf.subarray(captureBuf.length - capBytes)
    }
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
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0))
  }

  function updateCaptureMeters(capBlock, nCh) {
    if (!capBlock || nCh < 1) return
    const frames = Math.max(1, Math.floor(capBlock.length / nCh))
    const prev = captureMeterState.levelsByIndex || {}
    const next = {}
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
      const shaped = clamp01(Math.max(rms * 1.8, peak * 0.92))
      const prevLevel = clamp01(prev[String(c)] ?? 0)
      const attack = 0.6
      const release = 0.18
      next[String(c)] =
        shaped >= prevLevel
          ? prevLevel + (shaped - prevLevel) * attack
          : prevLevel + (shaped - prevLevel) * release
    }
    captureMeterState = { levelsByIndex: next, updatedAt: Date.now() }
  }

  function decayCaptureMeters(nCh) {
    const prev = captureMeterState.levelsByIndex || {}
    const next = {}
    for (let c = 0; c < Math.max(1, nCh); c++) {
      next[String(c)] = clamp01((prev[String(c)] ?? 0) * 0.82)
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
            stdio: ['ignore', 'pipe', 'inherit'],
          })
        : spawn('/bin/sh', ['-c', cmd], { stdio: ['ignore', 'pipe', 'inherit'] })
      captureChild.stdout.on('data', pushCaptureChunk)
      captureChild.on('error', (err) =>
        console.error('[inear] captura spawn:', err.message),
      )
      captureChild.on('exit', (code, sig) =>
        console.warn('[inear] captura ffmpeg terminou', { code, sig }),
      )
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
            stdio: ['ignore', 'pipe', 'inherit'],
            env: augmentPathForFfmpeg(process.env),
          })
          captureChild.stdout.on('data', pushCaptureChunk)
          captureChild.on('error', (err) =>
            console.error('[inear] captura AVFoundation spawn:', err.message),
          )
          captureChild.on('exit', (code, sig) =>
            console.warn('[inear] captura AVFoundation terminou', { code, sig }),
          )
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
            const args = [
              '-nostats',
              '-loglevel',
              'error',
              '-fflags',
              'nobuffer',
              '-flags',
              'low_delay',
              '-f',
              'dshow',
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
              `[inear] captura do PC (DirectShow ${mode}, "${devName}", ${nCh}ch)`,
              ffmpeg,
            )
            captureChild = spawn(ffmpeg, args, {
              stdio: ['ignore', 'pipe', 'inherit'],
              env: augmentPathForFfmpeg(process.env),
              windowsHide: true,
            })
            captureChild.stdout.on('data', pushCaptureChunk)
            captureChild.on('error', (err) =>
              console.error('[inear] captura DirectShow spawn:', err.message),
            )
            captureChild.on('exit', (code, sig) =>
              console.warn('[inear] captura DirectShow terminou', { code, sig }),
            )
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
        const idx = Math.max(
          0,
          Math.min(nCh - 1, Math.floor(ch.captureInputIndex)),
        )
        out[ch.id] = sampleInput(capBlock, i, nCh, idx) * 0.98
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
      if (mode === 'L') mm = L * 0.9
      else if (mode === 'R') mm = R * 0.9
      else if (nCh > 2) mm = sumAll * 0.98
      else mm = (L + R) * 0.45
      out[ch.id] = mm
    }
    return out
  }

  startCaptureIfConfigured()

  function findMusicianByUsername(username) {
    return state.showfile.musicians.find((m) => m.username === username)
  }

  function findUserByUsername(username) {
    return state.users.find((u) => u.username === username)
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
      const ffmpegFound = Boolean(findFfmpegExecutable())
      const ffprobeFound = Boolean(findFfprobeExecutable())
      const usingBundledWinFfmpeg = process.platform === 'win32' && Boolean(getBundledWinFfmpegDir())
      /** @type {{ index: number, name: string, inputChannels: number | null, probeError: string | null }[]} */
      let devicesWithInputs
      if (probeAll) {
        devicesWithInputs = await Promise.all(
          devices.map(async (d) => {
            const pr = await probeCaptureRowResultAsync(d, {
              force: refreshProbe,
            })
            return {
              index: d.index,
              name: d.name,
              inputChannels: pr.channels,
              probeError: pr.error,
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
    const { username, password } = req.body || {}
    const u = state.users.find((x) => x.username === username)
    if (!u || !bcrypt.compareSync(String(password || ''), u.passwordHash)) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }
    const token = signToken({ sub: u.username, role: u.role })
    res.json({ token, role: u.role })
  })
  ex.post('/api/auth/pair-login', loginLimiter, (req, res) => {
    const { code, username } = req.body || {}
    const p = state.pairing
    if (!p || Date.now() > p.expiresAt || String(code) !== p.code) {
      return res.status(401).json({ error: 'invalid_pairing_code' })
    }
    const u = state.users.find((x) => x.username === username)
    if (!u || u.role !== 'musician') {
      return res.status(401).json({ error: 'invalid_musician' })
    }
    const token = signToken({ sub: u.username, role: 'musician' })
    res.json({ token, role: 'musician' })
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
    const devices = listPcAudioCaptureDevicesCached()
    const meta = computePcCaptureMeta(devices)
    const captureOk =
      envOn ||
      meta.captureSource === 'avfoundation' ||
      meta.captureSource === 'dshow'
    if (!captureOk) {
      return res.status(400).json({
        error: 'capture_required',
        message:
          'Ativa primeiro a captura (entrada de áudio no painel ou INEAR_CAPTURE_CMD) para sincronizar os canais da interface.',
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
      (envOn ? 'Captura (INEAR_CAPTURE_CMD)' : 'Interface')
    const prevByIndex = new Map()
    for (const c of state.showfile.channels) {
      let k = null
      const mm = /^if_(\d+)$/.exec(c.id)
      if (mm) k = Number(mm[1])
      else if (c.id === 'if_l') k = 0
      else if (c.id === 'if_r') k = 1
      if (k !== null && k >= 0 && k < n) prevByIndex.set(k, c)
    }
    const channels = []
    for (let k = 0; k < n; k++) {
      const prev = prevByIndex.get(k)
      const defName = `Entrada ${k + 1} · ${baseName}`
      const name =
        prev && typeof prev.name === 'string' && prev.name.trim()
          ? prev.name.trim()
          : defName
      const strip = {
        id: `if_${k}`,
        name,
        icon: typeof prev?.icon === 'string' ? prev.icon : undefined,
        color: channelAccentColor({
          id: `if_${k}`,
          color: typeof prev?.color === 'string' ? prev.color : undefined,
          captureInputIndex: k,
        }),
        gain: typeof prev?.gain === 'number' ? prev.gain : 1,
        pan: typeof prev?.pan === 'number' ? prev.pan : 0,
        mute: Boolean(prev?.mute),
        eq:
          prev?.eq &&
          typeof prev.eq.lowDb === 'number' &&
          typeof prev.eq.midDb === 'number' &&
          typeof prev.eq.highDb === 'number'
            ? {
                lowDb: prev.eq.lowDb,
                midDb: prev.eq.midDb,
                highDb: prev.eq.highDb,
              }
            : { lowDb: 0, midDb: 0, highDb: 0 },
        lockEq: Boolean(prev?.lockEq),
        captureInputIndex: k,
        sourceTap: k === 0 ? 'L' : k === 1 ? 'R' : undefined,
      }
      channels.push(strip)
    }
    state.showfile.channels = channels
    state.showfile.groups = []
    const ids = channels.map((c) => c.id)
    for (const m of state.showfile.musicians) {
      m.scope = { channelIds: [...ids], groupIds: [] }
      const nextGains = {}
      const nextMutes = {}
      for (const id of ids) {
        nextGains[id] = m.sendGains[id] ?? 1
        nextMutes[id] = Boolean(m.sendMutes?.[id])
      }
      m.sendGains = nextGains
      m.sendMutes = nextMutes
      if (!m.eqByChannel) m.eqByChannel = {}
      const nextEq = {}
      for (const id of ids) {
        if (m.eqByChannel[id]) nextEq[id] = m.eqByChannel[id]
      }
      m.eqByChannel = nextEq
    }
    migrateShowfile(state.showfile)
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
    })
    if (prev.samples.length > 40) {
      prev.samples.splice(0, prev.samples.length - 40)
    }
    telemetryBySub.set(sub, prev)
    if (rtt > 200 || gapsDelta > 2) {
      console.info('[telemetry]', sub, { rttMs: rtt, gapsDelta, sequenceGaps: seqGaps })
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
  const { WebSocketServer } = require('ws')
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  })
  const wsAudioProfileBySocket = new WeakMap()

  function activeMusicianIdsForAudio() {
    const s = new Set(udpTargets.keys())
    for (const id of wsAudioByMusician.keys()) s.add(id)
    return s
  }
  function normalizeLatencyProfile(input) {
    return input === 'low' ? 'low' : 'stable'
  }
  function wsBufferedFactorForProfile(profile) {
    return profile === 'low' ? 6 : 12
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
  audioSock.bind(UDP_AUDIO_PORT, () => {
    console.info(`[inear] UDP áudio :${UDP_AUDIO_PORT}`)
  })

  const controlSock = dgram.createSocket('udp4')
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
    for (const musicianId of activeMusicianIdsForAudio()) {
      const mStrip = state.showfile.musicians.find((x) => x.id === musicianId)
      if (!mStrip) continue
      let rampState = muteRampByMusician.get(musicianId)
      if (!rampState) {
        rampState = new Map()
        muteRampByMusician.set(musicianId, rampState)
      }
      const interleaved = new Int16Array(block * 2)
      for (let i = 0; i < block; i++) {
        const mono = useCapture
          ? monoByChannelFromCapture(capBlock, i, nCh)
          : captureChild
            ? silentMonoByChannel()
            : monoByChannelAt(base + i)
        const fadeStep = 1 / muteFadeSamples()
        const { l, r } = mixMusicianStereoFromMonoSources(
          state.showfile,
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
        const gOut = 26500
        interleaved[i * 2] = Math.max(
          -32768,
          Math.min(32767, Math.round(l * gOut)),
        )
        interleaved[i * 2 + 1] = Math.max(
          -32768,
          Math.min(32767, Math.round(r * gOut)),
        )
      }
      const buf = encodeStereoPcmFrame({
        sequence: audioSeq,
        serverTimestampNs: ts,
        pcmInterleavedS16: interleaved,
      })
      const wire = Buffer.from(buf)
      const udpTarget = udpTargets.get(musicianId)
      if (udpTarget) {
        audioSock.send(wire, udpTarget.port, udpTarget.address, (err) => {
          if (err) console.warn('[udp send]', err.message)
        })
      }
      const wsSet = wsAudioByMusician.get(musicianId)
      if (wsSet && wsSet.size > 0) {
        for (const ws of wsSet) {
          if (ws.readyState === 1) {
            const latencyProfile = wsAudioProfileBySocket.get(ws) || 'stable'
            if (
              typeof ws.bufferedAmount === 'number' &&
              ws.bufferedAmount > wire.length * wsBufferedFactorForProfile(latencyProfile)
            ) {
              continue
            }
            try {
              ws.send(wire, { binary: true })
            } catch {
              /* ignore */
            }
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
