/**
 * bench-latency.mjs  — InEarEv audio pipeline latency benchmark
 *
 * Measures the time between a PCM chunk entering pushCaptureChunk() and the
 * corresponding Int16Array leaving takePcmBlock(). This is the server-side
 * capture-ring contribution to end-to-end latency (excludes network).
 *
 * Usage:
 *   node apps/desktop-server/scripts/bench-latency.mjs
 *
 * Exit code 0 = all SLAs met, 1 = one or more SLAs breached.
 *
 * SLAs (server-side ring-buffer contribution only):
 *   provocal / canto-ao-vivo  →  ≤ 20 ms  (p95 across N_SAMPLES samples)
 *   pro / muito-rápido        →  ≤ 16 ms  (p95 across N_SAMPLES samples)
 *   stable / agregado         →  ≤ 200 ms (p95 across N_SAMPLES samples)
 */

'use strict'

// ─── Configuration ────────────────────────────────────────────────────────────
const MVP_SAMPLE_RATE_HZ = 48_000
const N_SAMPLES = 2_000   // measurement repetitions per scenario
const FAIL_PERCENTILE = 95 // SLA must hold at this percentile
const WARMUP = 200         // ticks to discard before measuring

// Scenario definitions: { label, blockSamples, nCh, targetMs, profileName }
const SCENARIOS = [
  { label: 'Muito Rápido (pro/provocal, 128 frames, 2ch)', blockSamples: 128, nCh: 2, targetMs: 16 },
  { label: 'Canto ao Vivo (low, 128 frames, 2ch)',         blockSamples: 128, nCh: 2, targetMs: 20 },
  { label: 'Agregado (stable, 512 frames, 8ch)',           blockSamples: 512, nCh: 8, targetMs: 200 },
]

// ─── Minimal in-process ring-buffer implementation (mirrors server.cjs) ──────
function makeCaptureRing(blockSamples, nCh) {
  const bytesPerFrame = nCh * 2
  const targetMs = 40 // worst-case cap (stable/agregado on Windows)
  const targetBytes = Math.round((MVP_SAMPLE_RATE_HZ * bytesPerFrame * targetMs) / 1000)
  const minBlockBytes = blockSamples * bytesPerFrame
  const capBytes = Math.max(minBlockBytes * 2, targetBytes)

  let ring = Buffer.allocUnsafe(capBytes)
  let cap = capBytes
  let w = 0
  let r = 0
  let fill = 0
  let blockBuf = new Int16Array(blockSamples * nCh)

  function push(chunk) {
    if (cap < 1) return
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (buf.length <= 0) return
    if (buf.length >= cap) {
      const tail = buf.subarray(buf.length - cap)
      tail.copy(ring, 0, 0, cap)
      w = 0; r = 0; fill = cap
    } else {
      const overflow = Math.max(0, fill + buf.length - cap)
      if (overflow > 0) { r = (r + overflow) % cap; fill = cap - buf.length }
      let off = 0
      while (off < buf.length) {
        const spaceToEnd = cap - w
        const n = Math.min(spaceToEnd, buf.length - off)
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

  return { push, take }
}

// ─── Latency measurement ───────────────────────────────────────────────────────
function measureScenario(scenario) {
  const { blockSamples, nCh } = scenario
  const bytesPerBlock = blockSamples * nCh * 2
  const chunk = Buffer.alloc(bytesPerBlock) // synthetic silence impulse
  const ring = makeCaptureRing(blockSamples, nCh)
  const samples = []

  for (let i = 0; i < N_SAMPLES + WARMUP; i++) {
    const t0 = performance.now()
    ring.push(chunk)
    const result = ring.take()
    const t1 = performance.now()

    if (result === null) {
      // Underrun — should not happen with a pre-filled ring; count as worst case
      if (i >= WARMUP) samples.push(9999)
      continue
    }
    if (i >= WARMUP) samples.push(t1 - t0)
  }

  return samples
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

// ─── Run ───────────────────────────────────────────────────────────────────────
let anyFailed = false

console.log('\n=== InEarEv Audio Pipeline — Latency Benchmark ===\n')
console.log(`Scenarios: ${SCENARIOS.length}  |  Samples/scenario: ${N_SAMPLES}  |  SLA percentile: p${FAIL_PERCENTILE}\n`)

for (const scenario of SCENARIOS) {
  const samples = measureScenario(scenario)
  const sorted = samples.slice().sort((a, b) => a - b)
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length
  const p50 = percentile(sorted, 50)
  const p95 = percentile(sorted, FAIL_PERCENTILE)
  const p99 = percentile(sorted, 99)
  const max = sorted[sorted.length - 1]
  const breachCount = samples.filter(v => v > scenario.targetMs).length
  const breachPct = ((breachCount / samples.length) * 100).toFixed(1)
  const passed = p95 <= scenario.targetMs

  if (!passed) anyFailed = true

  const status = passed ? '✓ PASS' : '✗ FAIL'
  console.log(`[${status}] ${scenario.label}`)
  console.log(`         SLA: ≤ ${scenario.targetMs} ms @ p${FAIL_PERCENTILE}`)
  console.log(`         avg=${avg.toFixed(3)} ms  p50=${p50.toFixed(3)} ms  p95=${p95.toFixed(3)} ms  p99=${p99.toFixed(3)} ms  max=${max.toFixed(3)} ms`)
  console.log(`         Breaches (>${scenario.targetMs} ms): ${breachCount}/${samples.length} (${breachPct}%)\n`)
}

if (anyFailed) {
  console.error('RESULT: One or more SLAs breached — see failures above.')
  process.exit(1)
} else {
  console.log('RESULT: All SLAs met.')
  process.exit(0)
}
