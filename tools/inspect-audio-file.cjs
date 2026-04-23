#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')

function arg(name, def) {
  const i = process.argv.indexOf(name)
  if (i === -1 || !process.argv[i + 1]) return def
  return process.argv[i + 1]
}

function findFfprobe() {
  if (process.env.INEAR_FFPROBE && fs.existsSync(process.env.INEAR_FFPROBE)) {
    return process.env.INEAR_FFPROBE
  }
  const bundled = path.join(
    __dirname,
    '..',
    'apps',
    'desktop-server',
    'resources',
    'ffmpeg-win',
    'ffprobe.exe',
  )
  if (process.platform === 'win32' && fs.existsSync(bundled)) return bundled
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('where', ['ffprobe'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const line = out.split(/\r?\n/).find((l) => l.trim())
      if (line && fs.existsSync(line.trim())) return line.trim()
    } catch {
    }
  }
  return null
}

function sniffHeader(p) {
  try {
    const fd = fs.openSync(p, 'r')
    try {
      const buf = Buffer.allocUnsafe(64)
      const n = fs.readSync(fd, buf, 0, buf.length, 0)
      const b = buf.subarray(0, Math.max(0, n))
      const ascii = b.toString('ascii')
      if (ascii.startsWith('RIFF') && ascii.includes('WAVE')) return { kind: 'wav', head: ascii.slice(0, 16) }
      if (ascii.startsWith('ID3')) return { kind: 'mp3', head: ascii.slice(0, 16) }
      if (b.length >= 8 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { kind: 'mp3', head: b.subarray(0, 8).toString('hex') }
      if (ascii.includes('ftyp')) return { kind: 'mp4/m4a', head: b.subarray(0, 24).toString('ascii').replace(/[^\x20-\x7E]/g, '.') }
      if (ascii.startsWith('OggS')) return { kind: 'ogg', head: ascii.slice(0, 16) }
      if (ascii.startsWith('fLaC')) return { kind: 'flac', head: ascii.slice(0, 16) }
      return { kind: 'unknown', head: b.subarray(0, 24).toString('hex') }
    } finally {
      fs.closeSync(fd)
    }
  } catch (e) {
    return { kind: 'error', head: String(e && e.message ? e.message : e) }
  }
}

function main() {
  const p = arg('--file', arg('-f', ''))
  if (!p) {
    process.stderr.write('Uso: node tools/inspect-audio-file.cjs --file <caminho>\\n')
    process.exit(2)
  }
  const abs = path.resolve(process.cwd(), p)
  if (!fs.existsSync(abs)) {
    process.stderr.write('Arquivo inexistente: ' + abs + '\\n')
    process.exit(2)
  }
  const st = fs.statSync(abs)
  const sniff = sniffHeader(abs)
  const ffprobe = findFfprobe()
  const out = {
    file: abs,
    bytes: st.size,
    header: sniff,
    ffprobe: ffprobe ? { found: true, path: ffprobe } : { found: false, path: null },
    probe: null,
    probeError: null,
  }
  if (!ffprobe) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\\n')
    process.exit(0)
  }
  const r = spawnSync(
    ffprobe,
    [
      '-hide_banner',
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      abs,
    ],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true, cwd: path.dirname(ffprobe) },
  )
  if (r.error) {
    out.probeError = String(r.error.message || r.error)
  } else if (r.status !== 0) {
    out.probeError = String((r.stderr || r.stdout || '').trim() || ('ffprobe exit ' + r.status))
  } else {
    try {
      out.probe = JSON.parse(r.stdout || '{}')
    } catch (e) {
      out.probeError = 'ffprobe JSON inválido'
    }
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\\n')
}

main()

