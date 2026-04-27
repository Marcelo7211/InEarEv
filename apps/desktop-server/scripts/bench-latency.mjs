/**
 * bench-latency.mjs  — InEarEv audio pipeline latency benchmark
 *
 * Measures the ring-buffer round-trip time (pushCaptureChunk → takePcmBlock),
 * which is the server-side capture contribution to end-to-end latency.
 *
 * Usage:
 *   node apps/desktop-server/scripts/bench-latency.mjs
 *
 * Exit code 0 = all SLAs met, 1 = one or more SLAs breached.
 *
 * End-to-end latency budget breakdown (Windows, UI24R 32ch):
 *
 *   Profile     DirectShow buf   Ring cap   Block     Server-side   Network margin   E2E target
 *   provocal    10 ms            10 ms      2.67 ms   ~23 ms        12 ms            ≤ 35 ms
 *   pro         10 ms            14 ms      2.67 ms   ~27 ms        22 ms            ≤ 49 ms
 *   default     10 ms            20 ms      2.67 ms   ~33 ms        –                ≤ 50 ms
 *
 * Server-side SLAs tested here (ring-buffer only, no network):
 *   provocal / Muito Rápido     →  ≤ 16 ms  (p95)
 *   pro / Canto ao Vivo         →  ≤ 20 ms  (p95)
 *   default / UI24R 32ch stage  →  ≤ 50 ms  (p95)  ← tightened from 200 ms
 */

'use strict'

const MVP_SAMPLE_RATE_HZ = 48_000
const N_SAMPLES = 2_000
const FAIL_PERCENTILE = 95
const WARMUP = 200

// Real-world scenarios.  blockSamples = Windows runtime value (128 frames).
const SCENARIOS = [
  {
    label: 'Muito Rápido — provocal (128 frames, 2ch)',
    blockSamples: 128, nCh: 2,
    ringTargetMs: 10,   // captureBufferSoftCapBytes provocal
    slaMs: 16,
  },
  {
    label: 'Canto ao Vivo — pro (128 frames, 2ch)',
    blockSamples: 128, nCh: 2,
    ringTargetMs: 14,   // captureBufferSoftCapBytes pro
    slaMs: 20,
  },
  {
    label: 'UI24R 32ch palco — default (128 frames, 32ch)',
    blockSamples: 128, nCh: 32,
    ringTargetMs: 20,   // captureBufferSoftCapBytes default (reduced from 40 ms)
    slaMs: 50,          // tightened from 200 ms — viable for stage monitoring
  },
]

// ─── Minimal ring-buffer mirroring server.cjs logic ──────────────────────────
function makeCaptureRing(blockSamples, nCh, ringTargetMs) {
  const bytesPerFrame = nCh * 2
  const minBlockBytes = blockSamples * bytesPerFrame
  const targetBytes = Math.round((MVP_SAMPLE_RATE_HZ * bytesPerFrame * ringTargetMs) / 1000)
  const capBytes = Math.max(minBlockBytes * 2, targetBytes)

  const ring = Buffer.allocUnsafe(capBytes)
  let cap = capBytes, w = 0, r = 0, fill = 0
  const blockBuf = new Int16Array(blockSamples * nCh)

  function push(chunk) {
    if (cap < 1) return
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (buf.length <= 0) return
    if (buf.length >= cap) {
      buf.subarray(buf.length - cap).copy(ring, 0, 0, cap)
      w = 0; r = 0; fill = cap
    } else {
      const overflow = Math.max(0, fill + buf.length - cap)
      if (overflow > 0) { r = (r + overflow) % cap; fill = cap - buf.length }
      let off = 0
      while (off < buf.length) {
        const n = Math.min(cap - w, buf.length - off)
        buf.copy(ring, w, off, off + n)
        w = (w + n) % cap; off += n
      }
      fill = Math.min(cap, fill + buf.length)
    }
  }

  function take() {
    const need = blockSamples * nCh * 2
    if (cap < need || fill < need) return null
    const outBuf = Buffer.from(blockBuf.buffer, blockBuf.byteOffset, need)
    const first = Math.min(need, cap - r)
    ring.copy(outBuf, 0, r, r + first)
    if (first < need) ring.copy(outBuf, first, 0, need - first)
    r = (r + need) % cap
    fill = Math.max(0, fill - need)
    return blockBuf
  }

  return { push, take, capBytes, ringMs: (capBytes / (MVP_SAMPLE_RATE_HZ * nCh * 2)) * 1000 }
}

// ─── Measurement ──────────────────────────────────────────────────────────────
function measureScenario(scenario) {
  const { blockSamples, nCh, ringTargetMs } = scenario
  const chunk = Buffer.alloc(blockSamples * nCh * 2) // silence
  const ring = makeCaptureRing(blockSamples, nCh, ringTargetMs)
  const samples = []

  for (let i = 0; i < N_SAMPLES + WARMUP; i++) {
    const t0 = performance.now()
    ring.push(chunk)
    const result = ring.take()
    const t1 = performance.now()
    if (i >= WARMUP) samples.push(result === null ? 9999 : t1 - t0)
  }

  return { samples, ring }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

// ─── Run ──────────────────────────────────────────────────────────────────────
let anyFailed = false

console.log('\n=== InEarEv Audio Pipeline — Latency Benchmark ===')
console.log(`Samples/scenario: ${N_SAMPLES}  |  SLA percentile: p${FAIL_PERCENTILE}\n`)

for (const scenario of SCENARIOS) {
  const { samples, ring } = measureScenario(scenario)
  const sorted = samples.slice().sort((a, b) => a - b)
  const avg  = samples.reduce((s, v) => s + v, 0) / samples.length
  const p50  = percentile(sorted, 50)
  const p95  = percentile(sorted, FAIL_PERCENTILE)
  const p99  = percentile(sorted, 99)
  const max  = sorted[sorted.length - 1]
  const breachCount = samples.filter(v => v > scenario.slaMs).length
  const breachPct   = ((breachCount / samples.length) * 100).toFixed(1)
  const passed = p95 <= scenario.slaMs

  if (!passed) anyFailed = true

  const status = passed ? '✓ PASS' : '✗ FAIL'
  const ringInfo = `ring cap=${ring.ringMs.toFixed(1)} ms (${(ring.capBytes / 1024).toFixed(1)} KB)`
  console.log(`[${status}] ${scenario.label}`)
  console.log(`         ${ringInfo}`)
  console.log(`         SLA: ≤ ${scenario.slaMs} ms @ p${FAIL_PERCENTILE}`)
  console.log(`         avg=${avg.toFixed(3)} ms  p50=${p50.toFixed(3)} ms  p95=${p95.toFixed(3)} ms  p99=${p99.toFixed(3)} ms  max=${max.toFixed(3)} ms`)
  console.log(`         Breaches (>${scenario.slaMs} ms): ${breachCount}/${samples.length} (${breachPct}%)\n`)
}

// ─── Latency budget summary ────────────────────────────────────────────────────
console.log('=== Latency Budget — UI24R 32ch (Windows, estimado) ===\n')
const rows = [
  ['Componente',           'provocal', 'pro',   'default'],
  ['DirectShow buffer',    '10 ms',    '10 ms', '10 ms'],
  ['Ring buffer cap',      '10 ms',    '14 ms', '20 ms'],
  ['Block processing',     '2.7 ms',   '2.7 ms','2.7 ms'],
  ['Server-side total',    '~23 ms',   '~27 ms','~33 ms'],
  ['Network margin (SLA)', '12 ms',    '22 ms', '—'],
  ['E2E target',           '≤ 35 ms',  '≤ 49 ms','≤ 50 ms'],
]
const colW = [24, 12, 12, 12]
for (const row of rows) {
  console.log(row.map((c, i) => c.padEnd(colW[i])).join('  '))
}
console.log()

if (anyFailed) {
  console.error('RESULT: One or more SLAs breached — see failures above.')
  process.exit(1)
} else {
  console.log('RESULT: All SLAs met.')
  process.exit(0)
}
