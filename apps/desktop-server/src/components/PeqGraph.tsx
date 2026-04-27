import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export type PeqBandUi = {
  type: 'hpf' | 'lpf' | 'bell' | 'lowshelf' | 'highshelf'
  enabled?: boolean
  freqHz: number
  q: number
  gainDb: number
}

export type PeqGraphProps = {
  bands: PeqBandUi[]
  /** Habilita o módulo todo (LED de power). */
  enabled: boolean
  /** Cor do canal (linha da curva e pontos). */
  accent?: string
  /** Faixa de gain mostrada no eixo Y. */
  gainRangeDb?: number
  /** Comprimento horizontal interno (default: usa 100% width). */
  width?: number
  height?: number
  /** Callback durante arrasto (live, sem PATCH no backend). */
  onLiveBandsChange?: (bands: PeqBandUi[]) => void
  /** Callback no soltar — momento de persistir. */
  onBandsCommit: (bands: PeqBandUi[]) => void
  /** Toggle do enabled (LED de power). */
  onToggleEnabled?: (next: boolean) => void
}

const FREQ_MIN = 20
const FREQ_MAX = 20000

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** x normalizado [0..1] → frequência em Hz (escala log). */
function xToFreq(x: number): number {
  const t = clamp(x, 0, 1)
  const lo = Math.log10(FREQ_MIN)
  const hi = Math.log10(FREQ_MAX)
  return Math.pow(10, lo + t * (hi - lo))
}

/** frequência em Hz → x normalizado [0..1] (escala log). */
function freqToX(f: number): number {
  const safe = clamp(f, FREQ_MIN, FREQ_MAX)
  const lo = Math.log10(FREQ_MIN)
  const hi = Math.log10(FREQ_MAX)
  return (Math.log10(safe) - lo) / (hi - lo)
}

/**
 * Aproximação visual da magnitude (em dB) de cada banda.
 * Não é a resposta exata do biquad, mas é monotônica e
 * preserva ordem/forma — bom o suficiente para UI.
 */
function bandResponseDb(band: PeqBandUi, f: number): number {
  if (band.enabled === false) return 0
  const f0 = clamp(band.freqHz, FREQ_MIN, FREQ_MAX)
  const oct = Math.log2(f / f0)
  const q = clamp(band.q, 0.1, 18)
  switch (band.type) {
    case 'bell': {
      // pico/recorte com largura ~ 1/Q
      const w = 1 / q
      return band.gainDb / (1 + Math.pow(oct / w, 2))
    }
    case 'lowshelf': {
      // baixa boost/cut abaixo de f0
      const t = 1 / (1 + Math.exp(oct * 4))
      return band.gainDb * t
    }
    case 'highshelf': {
      // alta boost/cut acima de f0
      const t = 1 / (1 + Math.exp(-oct * 4))
      return band.gainDb * t
    }
    case 'hpf': {
      // -12 dB/oct abaixo, plano acima (Butterworth simplificado)
      if (oct >= 0) return 0
      return -12 * Math.abs(oct)
    }
    case 'lpf': {
      if (oct <= 0) return 0
      return -12 * oct
    }
    default:
      return 0
  }
}

function combinedResponseDb(bands: PeqBandUi[], f: number): number {
  let sum = 0
  for (const b of bands) sum += bandResponseDb(b, f)
  return sum
}

/** Pontos da curva ao longo do eixo X (valores em dB). */
function buildCurve(bands: PeqBandUi[], samples: number): number[] {
  const out: number[] = new Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = i / (samples - 1)
    const f = xToFreq(x)
    out[i] = combinedResponseDb(bands, f)
  }
  return out
}

const FREQ_GRID_LABELS: { hz: number; label: string }[] = [
  { hz: 30, label: '30' },
  { hz: 100, label: '100' },
  { hz: 300, label: '300' },
  { hz: 1000, label: '1k' },
  { hz: 3000, label: '3k' },
  { hz: 10000, label: '10k' },
]

const PADDING = { top: 18, right: 18, bottom: 26, left: 32 }
const SAMPLES = 220

/** Gerador de cor pastel a partir do índice — para diferenciar bandas quando o accent é igual. */
function bandTint(accent: string, idx: number): string {
  // Pequeno ajuste de matiz pelo índice usando hsl seria ideal, mas com accent fixo
  // vamos só intercalar verde/azul/laranja se accent for cinza; senão devolve accent.
  if (!/^#?[0-9a-fA-F]{6}$/.test(accent)) return accent
  const palette = ['#39ff14', '#5cc8ff', '#ffb020', '#ff5252', '#bf7af0', '#41e0d4']
  return palette[idx % palette.length]!
}

export function PeqGraph({
  bands,
  enabled,
  accent = '#39ff14',
  gainRangeDb = 18,
  width = 640,
  height = 260,
  onLiveBandsChange,
  onBandsCommit,
  onToggleEnabled,
}: PeqGraphProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [draftBands, setDraftBands] = useState<PeqBandUi[]>(bands)
  const draftRef = useRef<PeqBandUi[]>(bands)
  const dragRef = useRef<{ idx: number; pointerId: number } | null>(null)

  // Sincroniza props → draft quando não está arrastando.
  useEffect(() => {
    if (dragRef.current) return
    setDraftBands(bands)
    draftRef.current = bands
  }, [bands])

  const innerW = Math.max(120, width - PADDING.left - PADDING.right)
  const innerH = Math.max(80, height - PADDING.top - PADDING.bottom)

  const xToPx = useCallback((x: number) => PADDING.left + x * innerW, [innerW])
  const freqToPx = useCallback((f: number) => xToPx(freqToX(f)), [xToPx])
  const dbToPx = useCallback(
    (db: number) => {
      const t = (gainRangeDb - db) / (gainRangeDb * 2)
      return PADDING.top + clamp(t, 0, 1) * innerH
    },
    [gainRangeDb, innerH],
  )
  const pxToFreq = useCallback(
    (px: number) => {
      const x = clamp((px - PADDING.left) / innerW, 0, 1)
      return xToFreq(x)
    },
    [innerW],
  )
  const pxToDb = useCallback(
    (py: number) => {
      const t = clamp((py - PADDING.top) / innerH, 0, 1)
      return gainRangeDb - t * gainRangeDb * 2
    },
    [gainRangeDb, innerH],
  )

  const curvePts = useMemo(() => buildCurve(draftBands, SAMPLES), [draftBands])
  const curvePath = useMemo(() => {
    let d = ''
    for (let i = 0; i < SAMPLES; i++) {
      const x = i / (SAMPLES - 1)
      const px = xToPx(x)
      const py = dbToPx(curvePts[i] ?? 0)
      d += i === 0 ? `M ${px.toFixed(1)} ${py.toFixed(1)}` : ` L ${px.toFixed(1)} ${py.toFixed(1)}`
    }
    return d
  }, [curvePts, dbToPx, xToPx])

  const fillPath = useMemo(() => {
    if (!curvePath) return ''
    const baseY = dbToPx(0)
    const lastX = xToPx(1)
    const firstX = xToPx(0)
    return `${curvePath} L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`
  }, [curvePath, dbToPx, xToPx])

  // ── drag handlers ─────────────────────────────────────
  const beginDrag = useCallback(
    (idx: number, e: ReactPointerEvent<SVGCircleElement>) => {
      dragRef.current = { idx, pointerId: e.pointerId }
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      e.stopPropagation()
    },
    [],
  )

  const onMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      // Coordenadas relativas ao SVG (escala viewBox).
      const x = ((e.clientX - rect.left) / rect.width) * width
      const y = ((e.clientY - rect.top) / rect.height) * height
      const f = pxToFreq(x)
      const g = pxToDb(y)
      const next = draftRef.current.map((b, i) =>
        i === drag.idx
          ? {
              ...b,
              freqHz: Math.round(clamp(f, FREQ_MIN, FREQ_MAX)),
              gainDb: Math.round(clamp(g, -gainRangeDb, gainRangeDb) * 10) / 10,
            }
          : b,
      )
      draftRef.current = next
      setDraftBands(next)
      onLiveBandsChange?.(next)
    },
    [gainRangeDb, height, onLiveBandsChange, pxToDb, pxToFreq, width],
  )

  const endDrag = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      // Não há setPointerCapture no svg (foi no circle); ok ignorar.
      void e
      onBandsCommit(draftRef.current)
    },
    [onBandsCommit],
  )

  // dB grid ticks: -gainRange, -gainRange/2, 0, +gainRange/2, +gainRange (e linhas intermediárias)
  const dbTicks = useMemo(() => {
    const step = gainRangeDb / 3
    const out: number[] = []
    for (let v = gainRangeDb; v >= -gainRangeDb; v -= step) {
      out.push(Math.round(v))
    }
    return out
  }, [gainRangeDb])

  const cornerStyle: CSSProperties = {
    background: 'linear-gradient(180deg,#0c1320 0%, #070b13 100%)',
    border: '1px solid #1e2a3c',
    borderRadius: 8,
    padding: 14,
    boxShadow:
      'inset 0 1px 0 rgba(255,255,255,.04), inset 0 -1px 0 rgba(0,0,0,.5), 0 12px 28px rgba(0,0,0,.45)',
  }

  return (
    <div style={cornerStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px',
            background: '#0e1825',
            border: '1px solid #1e2a3c',
            borderRadius: 4,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: enabled ? accent : '#1c2531',
              boxShadow: enabled ? `0 0 6px ${accent}` : 'none',
            }}
          />
          <span
            style={{
              color: '#9caec6',
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: '0.14em',
            }}
          >
            EQUALIZER · {draftBands.filter((b) => b.enabled !== false).length} ATIVAS
          </span>
        </div>
        <button
          type="button"
          onClick={() => onToggleEnabled?.(!enabled)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '5px 12px',
            border: `1px solid ${enabled ? accent : '#1e2a3c'}`,
            borderRadius: 999,
            background: enabled ? `${accent}22` : '#0a131e',
            color: enabled ? accent : '#5b6a82',
            cursor: 'pointer',
            fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: '0.12em',
            touchAction: 'manipulation',
          }}
        >
          ⏻ {enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ display: 'block', userSelect: 'none', touchAction: 'none' }}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        {/* Fundo do gráfico (recessed). */}
        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={innerW}
          height={innerH}
          fill="#040608"
          stroke="#11202d"
          strokeWidth={1}
          rx={4}
        />
        {/* Grid de frequência (verticais). */}
        {FREQ_GRID_LABELS.map((g) => {
          const x = freqToPx(g.hz)
          return (
            <g key={g.label}>
              <line
                x1={x}
                x2={x}
                y1={PADDING.top}
                y2={PADDING.top + innerH}
                stroke="#11202d"
                strokeWidth={1}
              />
              <text
                x={x}
                y={PADDING.top + innerH + 14}
                fill="#5b6a82"
                fontSize={9}
                fontFamily="ui-monospace,SFMono-Regular,Menlo,monospace"
                textAnchor="middle"
              >
                {g.label}
              </text>
            </g>
          )
        })}
        {/* Linhas finas para 50, 200, 500, 2k, 5k, 20k (sem label). */}
        {[50, 200, 500, 2000, 5000, 20000].map((f) => {
          const x = freqToPx(f)
          return (
            <line
              key={`fl-${f}`}
              x1={x}
              x2={x}
              y1={PADDING.top}
              y2={PADDING.top + innerH}
              stroke="#0c1825"
              strokeWidth={1}
            />
          )
        })}
        {/* Grid de dB (horizontais). */}
        {dbTicks.map((dB) => {
          const y = dbToPx(dB)
          const major = dB === 0
          return (
            <g key={`db-${dB}`}>
              <line
                x1={PADDING.left}
                x2={PADDING.left + innerW}
                y1={y}
                y2={y}
                stroke={major ? '#243447' : '#0c1825'}
                strokeWidth={major ? 1.4 : 1}
                strokeDasharray={major ? undefined : '2 4'}
              />
              <text
                x={PADDING.left - 6}
                y={y + 3}
                fill={major ? '#9caec6' : '#5b6a82'}
                fontSize={9}
                fontFamily="ui-monospace,SFMono-Regular,Menlo,monospace"
                textAnchor="end"
              >
                {dB > 0 ? `+${dB}` : dB}
              </text>
            </g>
          )
        })}
        {/* Preenchimento abaixo da curva. */}
        <path
          d={fillPath}
          fill={accent}
          fillOpacity={0.12}
          style={{ pointerEvents: 'none' }}
        />
        {/* Curva combinada. */}
        <path
          d={curvePath}
          fill="none"
          stroke={accent}
          strokeWidth={2.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{
            filter: enabled ? `drop-shadow(0 0 4px ${accent}88)` : 'grayscale(1) opacity(.5)',
            pointerEvents: 'none',
          }}
        />
        {/* Pontos das bandas (numerados, arrastáveis). */}
        {draftBands.map((b, i) => {
          const off = b.enabled === false
          const cx = freqToPx(b.freqHz)
          const cy = dbToPx(b.gainDb)
          const tint = off ? '#3a4a63' : bandTint(accent, i)
          return (
            <g key={`band-${i}`}>
              <circle
                cx={cx}
                cy={cy}
                r={14}
                fill={tint}
                stroke="#06090f"
                strokeWidth={2}
                style={{
                  cursor: 'grab',
                  filter: off ? 'none' : `drop-shadow(0 0 6px ${tint}aa)`,
                  touchAction: 'none',
                }}
                onPointerDown={(e) => beginDrag(i, e)}
              />
              <text
                x={cx}
                y={cy + 4}
                fill="#06090f"
                fontWeight={900}
                fontSize={12}
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                textAnchor="middle"
                pointerEvents="none"
              >
                {i + 1}
              </text>
            </g>
          )
        })}
      </svg>
      {/* Linha de detalhes Freq/Q/Gain por banda. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${draftBands.length}, minmax(0,1fr))`,
          gap: 8,
          marginTop: 12,
        }}
      >
        {draftBands.map((b, i) => {
          const off = b.enabled === false
          const tint = off ? '#3a4a63' : bandTint(accent, i)
          const label =
            b.type === 'hpf'
              ? 'HPF'
              : b.type === 'lpf'
                ? 'LPF'
                : b.type === 'lowshelf'
                  ? 'LOW'
                  : b.type === 'highshelf'
                    ? 'HIGH'
                    : i === 1
                      ? 'L-MID'
                      : i === 2
                        ? 'H-MID'
                        : 'BELL'
          return (
            <div
              key={`band-info-${i}`}
              style={{
                background: '#0e1825',
                border: '1px solid #1e2a3c',
                borderRadius: 6,
                padding: '8px 8px 6px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: tint,
                    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: '0.06em',
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 999,
                      background: tint,
                      color: '#06090f',
                      fontSize: 10,
                      fontWeight: 900,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {i + 1}
                  </span>
                  {label}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = draftRef.current.map((bb, j) =>
                      j === i ? { ...bb, enabled: !(bb.enabled !== false) } : bb,
                    )
                    draftRef.current = next
                    setDraftBands(next)
                    onBandsCommit(next)
                  }}
                  style={{
                    border: `1px solid ${off ? '#1e2a3c' : tint}`,
                    background: off ? '#0a131e' : `${tint}22`,
                    color: off ? '#5b6a82' : tint,
                    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                    fontSize: 9,
                    fontWeight: 900,
                    letterSpacing: '0.1em',
                    padding: '2px 6px',
                    borderRadius: 999,
                    cursor: 'pointer',
                    touchAction: 'manipulation',
                  }}
                >
                  {off ? 'OFF' : 'ON'}
                </button>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 6,
                }}
              >
                <BandReadout label="FREQ" value={`${Math.round(b.freqHz)} Hz`} />
                <BandReadout
                  label="GAIN"
                  value={`${b.gainDb >= 0 ? '+' : ''}${b.gainDb.toFixed(1)} dB`}
                />
              </div>
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: '#5b6a82',
                    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                    fontSize: 9,
                    fontWeight: 800,
                    marginBottom: 2,
                    letterSpacing: '0.1em',
                  }}
                >
                  <span>Q</span>
                  <span>{Number(b.q).toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={12}
                  step={0.05}
                  value={b.q}
                  onChange={(e) => {
                    const next = draftRef.current.map((bb, j) =>
                      j === i ? { ...bb, q: Number(e.target.value) } : bb,
                    )
                    draftRef.current = next
                    setDraftBands(next)
                    onLiveBandsChange?.(next)
                  }}
                  onPointerUp={() => onBandsCommit(draftRef.current)}
                  onMouseUp={() => onBandsCommit(draftRef.current)}
                  className="inearRange"
                  style={
                    {
                      width: '100%',
                      ['--fill' as string]: `${((b.q - 0.1) / (12 - 0.1)) * 100}%`,
                      ['--ch-accent' as string]: tint,
                    } as CSSProperties
                  }
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BandReadout({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: '#040608',
        border: '1px solid #11202d',
        borderRadius: 3,
        padding: '4px 6px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          color: '#5b6a82',
          fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
          fontSize: 8,
          fontWeight: 900,
          letterSpacing: '0.14em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: '#39ff14',
          fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
          fontSize: 10,
          fontWeight: 800,
          textShadow: '0 0 4px rgba(57,255,20,.4)',
          marginTop: 1,
        }}
      >
        {value}
      </div>
    </div>
  )
}
