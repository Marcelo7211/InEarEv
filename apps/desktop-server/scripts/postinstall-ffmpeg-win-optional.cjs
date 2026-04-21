/**
 * Após npm install no Windows: tenta descarregar ffmpeg/ffprobe para resources/ffmpeg-win/.
 * Falhas (rede, antivírus) não quebram o install — só avisam no log.
 */
const { spawnSync } = require('child_process')
const path = require('path')

if (process.platform !== 'win32') {
  process.exit(0)
}

const script = path.join(__dirname, 'download-ffmpeg-windows.cjs')
const r = spawnSync(process.execPath, [script], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env: process.env,
  windowsHide: true,
})

if (r.status !== 0) {
  console.warn(
    '[inear] postinstall: ffmpeg-win não foi preparado (rede ou extração). ' +
      'Corre manualmente: node scripts/download-ffmpeg-windows.cjs em apps/desktop-server, ' +
      'ou define INEAR_FFMPEG / INEAR_FFPROBE.',
  )
}
process.exit(0)
