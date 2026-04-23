#!/usr/bin/env node
const { setTimeout: delay } = require('node:timers/promises')

function arg(name, def = '') {
  const i = process.argv.indexOf(name)
  if (i === -1 || !process.argv[i + 1]) return def
  return process.argv[i + 1]
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function parseBlocks(raw) {
  const vals = String(raw || '128,256,512')
    .split(',')
    .map((v) => Math.floor(Number(v.trim())))
    .filter((v) => Number.isFinite(v) && v > 0)
  const uniq = [...new Set(vals)]
  return uniq.length ? uniq : [128, 256, 512]
}

function pct(values, p) {
  const arr = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (!arr.length) return null
  const idx = Math.min(arr.length - 1, Math.max(0, Math.ceil((p / 100) * arr.length) - 1))
  return arr[idx]
}

function avg(values) {
  const arr = values.filter((v) => Number.isFinite(v))
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

async function api(base, path, opts = {}) {
  const url = new URL(path, base)
  const headers = { Accept: 'application/json', ...(opts.headers || {}) }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg =
      (json && (json.error || json.message)) ||
      text ||
      `${res.status} ${res.statusText}`
    throw new Error(`${opts.method || 'GET'} ${path} -> ${msg}`)
  }
  return json
}

function pickTeleTarget(byUsername, forced) {
  if (!byUsername || typeof byUsername !== 'object') return null
  if (forced && byUsername[forced]) return { username: forced, data: byUsername[forced] }
  let best = null
  for (const [username, data] of Object.entries(byUsername)) {
    const score = Number(data && data.sampleCount) || 0
    if (!best || score > best.score) {
      best = { username, data, score }
    }
  }
  return best ? { username: best.username, data: best.data } : null
}

async function ensureMusician(base, token, username, password) {
  const sf = await api(base, '/api/showfile', { token })
  const existing = Array.isArray(sf?.musicians)
    ? sf.musicians.find((m) => m && m.username === username)
    : null
  if (existing) {
    return { created: false, musician: existing }
  }
  const created = await api(base, '/api/admin/musicians', {
    method: 'POST',
    token,
    body: { username, password, name: username },
  })
  return { created: true, musician: created.musician }
}

async function maybeSelectDevice(base, token, needle) {
  if (!needle) return null
  const list = await api(base, '/api/audio-capture-devices?probe=all&dshowOptions=1', { token })
  const devices = Array.isArray(list?.devices) ? list.devices : []
  const hit = devices.find((d) =>
    String(d.name || '')
      .toLowerCase()
      .includes(String(needle).toLowerCase()),
  )
  if (!hit) {
    const names = devices.map((d) => `${d.index}:${d.name}`).join(' | ')
    throw new Error(`Dispositivo não encontrado para "${needle}". Disponíveis: ${names}`)
  }
  await api(base, '/api/audio-capture-device', {
    method: 'PATCH',
    token,
    body: {
      captureAvfoundationMode: 'manual',
      avfoundationAudioIndex: hit.index,
    },
  })
  return hit
}

async function sampleOnce(base, token, forcedMusician) {
  const [session, debug, levels, quality] = await Promise.all([
    api(base, '/api/session', { token }),
    api(base, '/api/audio-debug', { token }),
    api(base, '/api/audio-input-levels', { token }),
    api(base, '/api/network-quality', { token }),
  ])
  const tele = pickTeleTarget(quality?.byUsername, forcedMusician)
  const levelValues = Object.values(levels?.levelsByIndex || {}).map((v) => Number(v) || 0)
  return {
    t: Date.now(),
    session,
    debug,
    levels,
    quality,
    teleUsername: tele ? tele.username : null,
    tele: tele ? tele.data : null,
    levelPeak: levelValues.length ? Math.max(...levelValues) : 0,
  }
}

function summarizeRun(block, snaps) {
  const first = snaps[0]
  const last = snaps[snaps.length - 1]
  const receivingRatio =
    snaps.filter((s) => s.debug?.receiving && s.session?.pcAudioCaptureReceiving).length /
    Math.max(1, snaps.length)
  const peaks = snaps.map((s) => s.levelPeak)
  const teleSnaps = snaps.map((s) => s.tele).filter(Boolean)
  const lastTele = teleSnaps.length ? teleSnaps[teleSnaps.length - 1] : null
  const firstUnderruns = Number(first?.debug?.captureUnderruns) || 0
  const lastUnderruns = Number(last?.debug?.captureUnderruns) || 0
  const scoreBase =
    (receivingRatio < 0.95 ? 1_000_000 : 0) +
    ((Math.max(0, lastUnderruns - firstUnderruns) || 0) * 200) +
    (Math.max(0, 0.02 - (avg(peaks) || 0)) * 100_000)
  const e2eP95 = Number(lastTele?.estimatedE2eP95Ms) || Number(lastTele?.estimatedE2eMs) || null
  const gapsPm = Number(lastTele?.gapsPerMinute) || 0
  const slaBreaches = Number(lastTele?.slaBreaches) || 0
  const score =
    scoreBase +
    (e2eP95 == null ? 50_000 : e2eP95 * 10) +
    gapsPm * 500 +
    slaBreaches * 20_000
  return {
    block,
    receivingRatio,
    levelPeakAvg: avg(peaks),
    levelPeakP95: pct(peaks, 95),
    underrunsDelta: Math.max(0, lastUnderruns - firstUnderruns),
    teleUsername: last?.teleUsername || null,
    tele: lastTele,
    score,
  }
}

function recommendLatencyProfile(summary) {
  const tele = summary.tele
  if (!tele) return 'low'
  if ((tele.slaBreaches || 0) > 0 || (tele.gapsPerMinute || 0) > 6 || (tele.estimatedE2eP95Ms || 0) > 260) {
    return 'stable'
  }
  if ((tele.gapsPerMinute || 0) > 2 || (tele.estimatedE2eP95Ms || 0) > 130) {
    return 'low'
  }
  return 'pro'
}

function printSummary(label, summary) {
  const tele = summary.tele
  console.log(
    JSON.stringify(
      {
        etapa: label,
        audioBlockSamples: summary.block,
        capturaRecebendoPct: Math.round(summary.receivingRatio * 1000) / 10,
        picoEntradaMedio: summary.levelPeakAvg == null ? null : Math.round(summary.levelPeakAvg * 10000) / 10000,
        picoEntradaP95: summary.levelPeakP95 == null ? null : Math.round(summary.levelPeakP95 * 10000) / 10000,
        captureUnderrunsDelta: summary.underrunsDelta,
        telemetriaUsuario: summary.teleUsername,
        e2eP95Ms: tele?.estimatedE2eP95Ms ?? null,
        gapsPorMin: tele?.gapsPerMinute ?? null,
        slaUnder1s: tele?.slaUnder1s ?? null,
        slaBreaches: tele?.slaBreaches ?? null,
        hint: tele?.hint ?? null,
        score: Math.round(summary.score),
      },
      null,
      2,
    ),
  )
}

async function main() {
  const base = String(arg('--base', 'http://127.0.0.1:3847')).trim().replace(/\/+$/, '')
  const adminUser = arg('--admin-user', 'admin')
  const adminPass = arg('--admin-pass', 'admin123')
  const musician = arg('--musician', '')
  const musicianPass = arg('--musician-pass', 'soundcheck123')
  const device = arg('--device', '')
  const blocks = parseBlocks(arg('--blocks', '128,256'))
  const sampleSeconds = Math.max(8, Math.floor(Number(arg('--seconds', '18')) || 18))
  const sampleEveryMs = Math.max(1000, Math.floor(Number(arg('--interval-ms', '2000')) || 2000))
  const applyBest = !hasFlag('--no-apply-best')

  console.log(`[soundcheck] base=${base} blocks=${blocks.join(',')} janela=${sampleSeconds}s`)
  const login = await api(base, '/api/auth/login', {
    method: 'POST',
    body: { username: adminUser, password: adminPass },
  })
  const token = login.token
  if (!token) throw new Error('Falha no login admin')

  if (musician) {
    const ensured = await ensureMusician(base, token, musician, musicianPass)
    console.log(
      `[soundcheck] musico=${musician} ${ensured.created ? 'criado' : 'ja-existente'} senha=${musicianPass}`,
    )
  }

  if (device) {
    const hit = await maybeSelectDevice(base, token, device)
    console.log(
      `[soundcheck] dispositivo selecionado index=${hit.index} nome="${hit.name}" canaisProbe=${hit.inputChannels}`,
    )
    await delay(1200)
  }

  const results = []
  for (const block of blocks) {
    await api(base, '/api/audio-engine', {
      method: 'PATCH',
      token,
      body: { audioBlockSamples: block },
    })
    console.log(`[soundcheck] testando audioBlockSamples=${block}`)
    await delay(1200)
    const snaps = []
    const loops = Math.max(1, Math.ceil((sampleSeconds * 1000) / sampleEveryMs))
    for (let i = 0; i < loops; i++) {
      const sample = await sampleOnce(base, token, musician || '')
      snaps.push(sample)
      await delay(sampleEveryMs)
    }
    const summary = summarizeRun(block, snaps)
    printSummary(`bloco-${block}`, summary)
    results.push(summary)
  }

  results.sort((a, b) => a.score - b.score)
  const best = results[0]
  if (!best) throw new Error('Nenhum resultado coletado')

  if (applyBest) {
    await api(base, '/api/audio-engine', {
      method: 'PATCH',
      token,
      body: { audioBlockSamples: best.block },
    })
  }

  const recommendation = {
    melhorAudioBlockSamples: best.block,
    aplicarNoServidor: applyBest,
    perfilRecomendadoNoApp: recommendLatencyProfile(best),
    capturaOk: best.receivingRatio >= 0.95,
    sinalOk: (best.levelPeakP95 || 0) >= 0.02,
    underrunsControlados: best.underrunsDelta === 0,
    telemetriaRecebida: Boolean(best.tele),
    metaUnder1s: Boolean(best.tele?.slaUnder1s),
    e2eP95Ms: best.tele?.estimatedE2eP95Ms ?? null,
    gapsPorMin: best.tele?.gapsPerMinute ?? null,
    observacao:
      !best.tele
        ? 'Sem telemetria do app; abra o retorno no telemovel e rode novamente para validar latencia real.'
        : best.tele?.slaUnder1s
          ? 'Fluxo dentro da meta de <1 s; confirme auditivamente se ainda ha artefactos.'
          : 'Ainda fora da meta; troque para perfil mais estavel no app e repita o soundcheck.',
  }
  console.log(JSON.stringify({ recomendacaoFinal: recommendation }, null, 2))
}

main().catch((err) => {
  console.error('[soundcheck] erro:', err && err.stack ? err.stack : err)
  process.exit(1)
})
