#!/usr/bin/env node
/**
 * macOS: lista dispositivos AVFoundation e sugere INEAR_CAPTURE_CMD para o inEar.
 *
 * O macOS NÃO oferece "capturar o que sai na placa" direto no ffmpeg — o som do
 * sistema (YouTube, Spotify) tem de ir para um dispositivo que o ffmpeg consiga
 * ler como *entrada* (quase sempre BlackHole 2ch + Multi-Output no MIDI Setup).
 *
 * Uso:
 *   npm run inear:mac:capture-cmd
 *   node tools/mac-print-capture-cmd.cjs --index 2   # força índice de áudio
 *   npm run inear:mac:capture-cmd -- --listen 6 --index 1   # ouve 6s do dispositivo [1] (valida pipeline)
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn, spawnSync } = require('node:child_process')

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

function findFfmpeg() {
  if (process.env.INEAR_FFMPEG && fs.existsSync(process.env.INEAR_FFMPEG)) {
    return process.env.INEAR_FFMPEG
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
      env: augmentPath(process.env),
    })
    const line = out.trim().split('\n')[0]
    if (line && fs.existsSync(line)) return line
  } catch {
    /* */
  }
  return null
}

function argFlag(name) {
  const i = process.argv.indexOf(name)
  if (i === -1 || !process.argv[i + 1]) return null
  return process.argv[i + 1]
}

/** `--listen` ou `--listen 12` → segundos (default 8). */
function parseListenSeconds() {
  const i = process.argv.indexOf('--listen')
  if (i === -1) return null
  const next = process.argv[i + 1]
  if (next && /^\d+$/.test(next)) return Math.min(120, Math.max(1, Number(next, 10)))
  return 8
}

/**
 * Grava `seconds` de áudio do dispositivo AVFoundation e reproduz com `afplay`
 * (evita ffplay com builds que não aceitam -channel_layout / -ac no stdin).
 */
function listenCaptureProbe(ffmpegBin, audioIndex, seconds) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(
      os.tmpdir(),
      `inear-listen-${process.pid}-${Date.now()}.wav`,
    )
    console.info(
      `[inear] A gravar ${seconds}s do dispositivo none:${audioIndex} → WAV temporário; a seguir afplay reproduz nos altifalantes…`,
    )
    const ffArgs = [
      '-nostats',
      '-loglevel',
      'warning',
      '-t',
      String(seconds),
      '-f',
      'avfoundation',
      '-i',
      `none:${audioIndex}`,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-y',
      tmp,
    ]
    const p = spawn(ffmpegBin, ffArgs, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: augmentPath(process.env),
    })
    p.on('error', (err) => reject(err))
    p.on('close', (code) => {
      if (code !== 0 && code !== null) {
        try {
          fs.unlinkSync(tmp)
        } catch {
          /* */
        }
        reject(new Error(`ffmpeg terminou com code ${code}`))
        return
      }
      const ap = spawnSync('afplay', [tmp], {
        stdio: 'inherit',
        env: augmentPath(process.env),
      })
      if (ap.error) {
        try {
          fs.unlinkSync(tmp)
        } catch {
          /* */
        }
        reject(ap.error)
        return
      }
      if (ap.status !== 0) {
        try {
          fs.unlinkSync(tmp)
        } catch {
          /* */
        }
        reject(new Error(`afplay exit ${ap.status}`))
        return
      }
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* */
      }
      console.info(
        '\n[inear] Se ouviste som (voz, música, silêncio estável), o ffmpeg está a ler esse dispositivo.',
      )
      console.info(
        '[inear] Se esperavas o YouTube mas não ouviste: [N] não é a saída do sistema — usa BlackHole + Multi-Output (README).',
      )
      resolve()
    })
  })
}

/** @returns {Array<{ index: number, name: string }>} */
function parseAvfAudioDevices(stderr) {
  const lines = stderr.split(/\r?\n/)
  const aIdx = lines.findIndex((l) => l.includes('AVFoundation audio devices'))
  if (aIdx === -1) return []
  const vIdx = lines.findIndex((l) => l.includes('AVFoundation video devices'))
  /** Ex.: `[AVFoundation indev @ 0x...] [0] BlackHole 2ch` */
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

function pickPreferredIndex(devices) {
  const prefer = [
    /blackhole/i,
    /soundflower/i,
    /loopback/i,
    /aggregate/i,
    /multi-?output/i,
  ]
  for (const re of prefer) {
    const d = devices.find((x) => re.test(x.name))
    if (d) return d
  }
  return null
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.info(`mac-print-capture-cmd — macOS AVFoundation + inEar

  npm run inear:mac:capture-cmd
      Lista entradas de áudio e sugere export INEAR_CAPTURE_CMD (se detetar BlackHole).

  npm run inear:mac:capture-cmd -- --index N
      Imprime o export usando o índice [N].

  npm run inear:mac:capture-cmd -- --listen [segundos] --index N
      Grava esse tempo em WAV e reproduz com afplay (sem ffplay).
      Assim sabes se o dispositivo [N] está certo antes de npm run dev.

Como saber se o retorno no telemóvel está “real”:
  1) Corre --listen com o mesmo --index que vais usar no export.
  2) npm run dev com INEAR_CAPTURE_CMD; no terminal do Electron não deve aparecer
     a cada instante “captura: poucos dados do ffmpeg”.
  3) No telemóvel, login músico → retorno: o aviso verde “Captura do PC ativa”
     (API /api/session: pcAudioCaptureReceiving).
`)
    process.exit(0)
  }

  if (process.platform !== 'darwin') {
    console.error(
      '[inear] Este script é só para macOS. Em Windows usa WASAPI loopback no README.',
    )
    process.exit(1)
  }

  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    console.error('[inear] ffmpeg não encontrado. Instala: brew install ffmpeg')
    process.exit(1)
  }

  const listed = spawnSync(
    ffmpeg,
    ['-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
    {
      encoding: 'utf8',
      env: augmentPath(process.env),
    },
  )
  const stderr = `${listed.stderr || ''}${listed.stdout || ''}`

  const devices = parseAvfAudioDevices(stderr)
  console.info('[inear] ffmpeg:', ffmpeg)
  console.info('[inear] Dispositivos de áudio (entrada) AVFoundation:\n')
  if (devices.length === 0) {
    console.info(stderr.slice(-8000) || '(sem stderr)')
    console.info(
      '\n[inear] Não consegui parsear a lista. Procura manualmente por BlackHole e o número [N].',
    )
  } else {
    for (const d of devices) {
      console.info(`  [${d.index}] ${d.name}`)
    }
  }

  const listenSec = parseListenSeconds()
  const forced = argFlag('--index')
  let audioIndex = forced != null ? Number(forced, 10) : NaN
  if (forced != null && (!Number.isInteger(audioIndex) || audioIndex < 0)) {
    console.error('[inear] --index tem de ser um inteiro >= 0')
    process.exit(1)
  }

  if (listenSec != null) {
    if (forced == null) {
      const picked = pickPreferredIndex(devices)
      if (!picked) {
        console.error(
          '[inear] --listen precisa de --index N (ex.: microfone [1]) ou instala BlackHole para deteção automática.',
        )
        process.exit(1)
      }
      audioIndex = picked.index
      console.info(
        `[inear] --listen: a usar índice ${audioIndex} (${picked.name}) (detetado automaticamente).`,
      )
    }
    try {
      await listenCaptureProbe(ffmpeg, audioIndex, listenSec)
    } catch (e) {
      console.error('[inear]', (e && e.message) || e)
      process.exit(1)
    }
    return
  }

  if (forced == null) {
    const picked = pickPreferredIndex(devices)
    if (picked) {
      audioIndex = picked.index
      console.info(
        `\n[inear] Sugestão automática: índice ${audioIndex} (${picked.name})`,
      )
    } else {
      console.info(
        '\n[inear] Não encontrámos BlackHole / virtual na lista. Para ouvir o YouTube no retorno:',
      )
      console.info(
        '  1) Instala BlackHole 2ch (existential.audio/blackhole).',
      )
      console.info(
        '  2) Audio MIDI Setup → Multi-Output Device = Saída integrada + BlackHole; define o Mac a usar esse dispositivo como saída.',
      )
      console.info(
        '  3) Corre de novo este script; ou: node tools/mac-print-capture-cmd.cjs --index N',
      )
      console.info(
        '\n[inear] Para testar o microfone (ou outro [N]) sem BlackHole: npm run inear:mac:capture-cmd -- --listen 5 --index 1',
      )
      process.exit(0)
    }
  }

  const cmd = `ffmpeg -nostats -loglevel error -f avfoundation -i "none:${audioIndex}" -ar 48000 -ac 2 -f s16le -`
  console.info('\n--- Copia para o terminal onde vais correr npm run dev ---\n')
  console.info(`export INEAR_CAPTURE_CMD='${cmd}'`)
  console.info('npm run dev')
  console.info(
    '\n--- O "none:N" é só áudio (vídeo desligado). O mix do inEar usa este PCM como fonte dos canais. ---\n',
  )
  console.info(
    '--- Teste rápido (ouves o mesmo PCM que o servidor): npm run inear:mac:capture-cmd -- --listen 5 --index ' +
      audioIndex +
      ' ---\n',
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
