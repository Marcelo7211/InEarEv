#!/usr/bin/env node
/**
 * Cliente UDP de teste (POC): regista-se no servidor, recebe PCM estéreo,
 * aplica PLC simples em gap de sequência e imprime latência estimada.
 *
 * Uso:
 *   npm run receiver -- --play
 *   (sem --token: faz login HTTP como musician1/musician1 automaticamente)
 *
 *   npm run receiver -- --token "<JWT>" --play
 *
 * Variáveis:
 *   INEAR_HTTP — API (default http://127.0.0.1:3847); registo UDP usa o mesmo host.
 *   INEAR_LOGIN_USER / INEAR_LOGIN_PASS — credenciais para login automático (opcional).
 *   INEAR_FFPLAY — caminho absoluto para ffplay (opcional).
 *   INEAR_FFMPEG — caminho absoluto para ffmpeg (opcional).
 *   INEAR_PLAY_BACKEND — ffplay | ffmpeg | auto
 *     (auto no macOS: prefere ffplay; muitos /usr/local/bin/ffmpeg vêm sem muxer coreaudio.
 *     Força saída CoreAudio: INEAR_PLAY_BACKEND=ffmpeg e ffmpeg completo, ex.: brew install ffmpeg.)
 *
 *   Nota: --play só toca no computador onde corres este script; não envia áudio para o telemóvel.
 */
const dgram = require('node:dgram')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { spawn, execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')

const req = createRequire(path.join(__dirname, '..', 'package.json'))
const { decodeAudioFrame, MVP_SAMPLE_RATE_HZ } = req('@inear/protocol')

function arg(name, def) {
  const i = process.argv.indexOf(name)
  if (i === -1 || !process.argv[i + 1]) return def
  return process.argv[i + 1]
}

function flag(name) {
  return process.argv.includes(name)
}

function readJwtPayload(token) {
  try {
    const p = token.split('.')[1]
    if (!p) return {}
    const b = p.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b.length % 4 === 0 ? '' : '='.repeat(4 - (b.length % 4))
    return JSON.parse(Buffer.from(b + pad, 'base64').toString('utf8'))
  } catch {
    return {}
  }
}

const HTTP = process.env.INEAR_HTTP || 'http://127.0.0.1:3847'
const wantPlay = flag('--play')
const runSeconds = Number(arg('--seconds', '120')) || 120

let httpUrl
try {
  httpUrl = new URL(HTTP)
} catch (e) {
  console.error('[inear] INEAR_HTTP inválido:', HTTP)
  process.exit(1)
}
const udpHost = httpUrl.hostname
const defaultHttpPort = httpUrl.protocol === 'https:' ? 443 : 80
const httpPort = Number(httpUrl.port) || defaultHttpPort

function httpJson(urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, HTTP)
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : httpPort,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: opts.headers || {},
      },
      (res) => {
        let b = ''
        res.on('data', (c) => (b += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(b || res.statusMessage))
          } else {
            try {
              resolve(b ? JSON.parse(b) : {})
            } catch {
              resolve(b)
            }
          }
        })
      },
    )
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

async function resolveToken() {
  const fromArg = arg('--token', undefined)
  if (fromArg) return fromArg
  if (process.env.INEAR_TOKEN) return process.env.INEAR_TOKEN
  const user = process.env.INEAR_LOGIN_USER || 'musician1'
  const pass = process.env.INEAR_LOGIN_PASS || 'musician1'
  console.info(`[inear] login HTTP como ${user} (POST /api/auth/login)…`)
  const r = await httpJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  })
  if (!r.token) throw new Error('Resposta de login sem token')
  if (r.role && r.role !== 'musician') {
    throw new Error(
      `Login devolveu role "${r.role}". Usa INEAR_LOGIN_USER=musician1 ou --token com JWT de músico.`,
    )
  }
  return r.token
}

function augmentPath(env) {
  const extra = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    process.env.HOME ? path.join(process.env.HOME, '.nix-profile/bin') : '',
  ].filter(Boolean)
  return {
    ...env,
    PATH: [...extra, env.PATH || ''].join(path.delimiter),
  }
}

/** Procura `name` em pastas típicas + PATH (útil quando npm não herda Homebrew). */
function findBinary(name, envOverrideKey) {
  if (envOverrideKey && process.env[envOverrideKey]) {
    const p = process.env[envOverrideKey]
    if (fs.existsSync(p)) return p
    console.warn(`[inear] ${envOverrideKey} ignorado (inexistente):`, p)
  }
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    process.env.HOME ? path.join(process.env.HOME, '.nix-profile/bin') : '',
  ].filter(Boolean)
  for (const d of dirs) {
    const p = path.join(d, name)
    if (fs.existsSync(p)) return p
  }
  const env = augmentPath(process.env)
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('where', [name], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env,
      })
      const line = out.split(/\r?\n/).find((l) => l.trim())
      if (line && fs.existsSync(line.trim())) return line.trim()
    } catch {
      /* */
    }
    return null
  }
  try {
    const out = execFileSync('sh', ['-c', `command -v ${name}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
    })
    const line = out.trim().split('\n')[0]
    if (line && fs.existsSync(line)) return line
  } catch {
    /* */
  }
  return null
}

/** Opções de entrada PCM s16le estéreo (evita `-ac` em ffplay antigo / builds SDL estranhos). */
function pcmInputArgs(sampleRateHz) {
  return [
    '-f',
    's16le',
    '-ar',
    String(sampleRateHz),
    '-channel_layout',
    'stereo',
    '-i',
    '-',
  ]
}

function spawnFfmpegCoreAudio(ffmpegBin, sampleRateHz, env) {
  const device = process.env.INEAR_COREAUDIO_DEVICE || 'default'
  const proc = spawn(
    ffmpegBin,
    [
      '-nostats',
      '-loglevel',
      'warning',
      ...pcmInputArgs(sampleRateHz),
      '-f',
      'coreaudio',
      device,
    ],
    { stdio: ['pipe', 'pipe', 'inherit'], env },
  )
  proc.stderr?.on('data', (b) => process.stderr.write(b))
  return {
    proc,
    stdin: proc.stdin,
    label: `ffmpeg → coreaudio "${device}" (${ffmpegBin})`,
  }
}

function spawnFfmpegPulse(ffmpegBin, sampleRateHz, env) {
  const sink = process.env.INEAR_PULSE_SINK || 'default'
  const proc = spawn(
    ffmpegBin,
    [
      '-nostats',
      '-loglevel',
      'warning',
      ...pcmInputArgs(sampleRateHz),
      '-f',
      'pulse',
      sink,
    ],
    { stdio: ['pipe', 'pipe', 'inherit'], env },
  )
  proc.stderr?.on('data', (b) => process.stderr.write(b))
  return {
    proc,
    stdin: proc.stdin,
    label: `ffmpeg → pulse "${sink}" (${ffmpegBin})`,
  }
}

function spawnFfplay(ffplayBin, sampleRateHz, env) {
  const proc = spawn(
    ffplayBin,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nodisp',
      ...pcmInputArgs(sampleRateHz),
    ],
    { stdio: ['pipe', 'inherit', 'inherit'], env },
  )
  return { proc, stdin: proc.stdin, label: `ffplay (${ffplayBin})` }
}

/**
 * Reprodução PCM s16le estéreo (stdin).
 * macOS + auto: ffplay primeiro (ffmpeg em /usr/local costuma vir sem muxer coreaudio).
 * @returns {{ proc: import('child_process').ChildProcess, stdin: NodeJS.WritableStream, label: string } | null}
 */
function spawnAudioPlayer(sampleRateHz) {
  const env = augmentPath(process.env)
  const backend = (process.env.INEAR_PLAY_BACKEND || 'auto').toLowerCase()
  const ffmpegBin = findBinary('ffmpeg', 'INEAR_FFMPEG')
  const ffplayBin = findBinary('ffplay', 'INEAR_FFPLAY')

  if (backend === 'ffplay') {
    if (ffplayBin) return spawnFfplay(ffplayBin, sampleRateHz, env)
    return null
  }

  if (backend === 'ffmpeg') {
    if (!ffmpegBin) return null
    if (process.platform === 'darwin') {
      return spawnFfmpegCoreAudio(ffmpegBin, sampleRateHz, env)
    }
    if (process.platform === 'linux') {
      return spawnFfmpegPulse(ffmpegBin, sampleRateHz, env)
    }
    return null
  }

  // auto
  if (process.platform === 'darwin') {
    if (ffplayBin) return spawnFfplay(ffplayBin, sampleRateHz, env)
    if (ffmpegBin) return spawnFfmpegCoreAudio(ffmpegBin, sampleRateHz, env)
    return null
  }

  if (process.platform === 'linux') {
    if (ffplayBin) return spawnFfplay(ffplayBin, sampleRateHz, env)
    if (ffmpegBin) return spawnFfmpegPulse(ffmpegBin, sampleRateHz, env)
    return null
  }

  if (ffplayBin) return spawnFfplay(ffplayBin, sampleRateHz, env)
  return null
}

async function main() {
  const token = await resolveToken()
  const jwtPayload = readJwtPayload(token)
  if (jwtPayload.role && jwtPayload.role !== 'musician') {
    console.error(
      `[inear] O token tem role "${jwtPayload.role}". Usa músico (musician1), não admin.`,
    )
    process.exit(1)
  }

  const sess = await httpJson('/api/session', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  console.info('[session]', sess)

  const controlPort = sess.udpControlPort || 9877

  /** @type {{ proc: import('child_process').ChildProcess, stdin: NodeJS.WritableStream, label: string } | null} */
  let audioOut = null
  if (wantPlay) {
    audioOut = spawnAudioPlayer(MVP_SAMPLE_RATE_HZ)
    if (!audioOut) {
      console.error(
        '[inear] Não encontrei ffplay nem ffmpeg no PATH (nem em /opt/homebrew/bin, /usr/local/bin, /opt/local/bin).\n' +
          '  Instala:  brew install ffmpeg\n' +
          '  Depois confirma:  which ffmpeg   (ou export INEAR_FFMPEG=/caminho/ffmpeg)\n' +
          '  Sem --play o receptor só imprime métricas.',
      )
      process.exit(1)
    }
    console.info('[inear] reprodução:', audioOut.label)
    audioOut.proc.on('error', (err) => {
      console.error('[inear] falha ao iniciar reprodução:', err.message)
      process.exit(1)
    })
    audioOut.stdin.on('error', (err) => {
      const c = /** @type {NodeJS.ErrnoException} */ (err).code
      if (c === 'EPIPE' || c === 'ERR_STREAM_DESTROYED') return
      console.error('[inear] stdin reprodução:', err.message)
    })
    audioOut.proc.once('close', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.warn(
          `[inear] reprodutor terminou (code=${code} signal=${signal ?? '—'}). Áudio deixa de tocar; métricas UDP continuam.`,
        )
      }
    })
  }

  const sock = dgram.createSocket('udp4')

  let expectedSeq = null
  let lastPcm = new Int16Array(0)
  let gaps = 0
  let frames = 0

  const watchdog = setTimeout(() => {
    if (frames === 0) {
      console.error(
        '[inear] Nenhum frame de áudio recebido. Verifica:\n' +
          '  • Token de MÚSICO (musician1), não admin.\n' +
          `  • Registo UDP → ${udpHost}:${controlPort} (INEAR_HTTP=${HTTP}).\n` +
          '  • Firewall UDP 9876/9877.\n' +
          '  • npm run dev no desktop.',
      )
    }
  }, 3000)

  sock.on('message', (msg, rinfo) => {
    const dec = decodeAudioFrame(new Uint8Array(msg))
    if (!dec) {
      try {
        const j = JSON.parse(msg.toString())
        if (j.t === 'ack') {
          console.info('[ctrl] ack', j, 'from', `${rinfo.address}:${rinfo.port}`)
        } else {
          console.info('[ctrl]', j)
        }
      } catch {
        /* ignore */
      }
      return
    }
    frames += 1
    if (frames === 1) {
      clearTimeout(watchdog)
      console.info(
        `[audio] primeiro frame seq=${dec.sequence} from ${rinfo.address}:${rinfo.port}`,
      )
    }
    if (expectedSeq !== null && dec.sequence !== expectedSeq + 1) {
      gaps += 1
      if (lastPcm.length && dec.pcmInterleavedS16.length === lastPcm.length) {
        dec.pcmInterleavedS16.set(lastPcm)
      }
    }
    expectedSeq = dec.sequence
    lastPcm = Int16Array.from(dec.pcmInterleavedS16)
    const now = process.hrtime.bigint()
    const oneWayNs =
      now > dec.serverTimestampNs ? now - dec.serverTimestampNs : 0n
    const ms = Number(oneWayNs) / 1e6
    if (wantPlay && audioOut) {
      const st = audioOut.stdin
      if (!st.destroyed && st.writable) {
        const pcm = dec.pcmInterleavedS16
        try {
          st.write(
            Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
            (err) => {
              if (err && /** @type {NodeJS.ErrnoException} */ (err).code !== 'EPIPE') {
                console.error('[inear] escrita PCM:', err.message)
              }
            },
          )
        } catch (e) {
          const c = /** @type {NodeJS.ErrnoException} */ (e).code
          if (c !== 'EPIPE' && c !== 'ERR_STREAM_DESTROYED') {
            console.error('[inear] escrita PCM:', /** @type {Error} */ (e).message)
          }
        }
      }
    }
    if (dec.sequence % 50 === 0) {
      console.info(
        `[audio] seq=${dec.sequence} samples/ch=${dec.samplesPerChannel} ~Δ=${ms.toFixed(2)}ms gaps=${gaps} from=${rinfo.address}:${rinfo.port}`,
      )
    }
  })

  sock.bind(0, () => {
    const addr = sock.address()
    const reg = Buffer.from(JSON.stringify({ t: 'reg', token }))
    sock.send(reg, controlPort, udpHost, (err) => {
      if (err) {
        console.error('[reg] erro ao enviar:', err.message)
        return
      }
      console.info(
        `[reg] enviado para ${udpHost}:${controlPort} a partir da porta local ${addr.port}`,
      )
    })
  })

  setInterval(async () => {
    try {
      await httpJson('/api/telemetry', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gaps, underruns: 0, rttMs: null }),
      })
    } catch {
      /* ignore */
    }
  }, 5000)

  const done = () => {
    clearTimeout(watchdog)
    if (audioOut?.stdin) audioOut.stdin.end()
    console.info('[done]', { frames, gaps, seconds: runSeconds })
    process.exit(0)
  }

  if (wantPlay) {
    process.on('SIGINT', done)
  }

  setTimeout(done, runSeconds * 1000)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
