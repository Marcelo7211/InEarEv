import { useMemo } from 'react'

export type SpectrumData = {
  frequencies: number[]
  magnitudes: number[]
  updatedAt: number
}

export type RtaOverlayProps = {
  spectrum: SpectrumData | null
  enabled: boolean
  accent?: string
  width?: number
  height?: number
  gainRangeDb?: number
}

const FREQ_MIN = 20
const FREQ_MAX = 20000

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function freqToX(f: number): number {
  const safe = clamp(f, FREQ_MIN, FREQ_MAX)
  const lo = Math.log10(FREQ_MIN)
  const hi = Math.log10(FREQ_MAX)
  return (Math.log10(safe) - lo) / (hi - lo)
}

export function RtaOverlay({
  spectrum,
  enabled,
  accent = '#39ff14',
  width = 640,
  height = 260,
  gainRangeDb = 18,
}: RtaOverlayProps) {
  const PADDING = { top: 18, right: 22, bottom: 32, left: 38 }
  const innerW = Math.max(120, width - PADDING.left - PADDING.right)
  const innerH = Math.max(80, height - PADDING.top - PADDING.bottom)

  const dbToPx = (db: number) => {
    const t = (gainRangeDb - db) / (gainRangeDb * 2)
    return PADDING.top + clamp(t, 0, 1) * innerH
  }

  const xToPx = (x: number) => PADDING.left + x * innerW

  // Construir curva do espectro (suavizada)
  const spectrumPath = useMemo(() => {
    if (!spectrum || !enabled || spectrum.frequencies.length < 2) return ''

    let d = ''
    const samples = spectrum.frequencies.length

    for (let i = 0; i < samples; i++) {
      const f = spectrum.frequencies[i]
      const mag = spectrum.magnitudes[i] ?? 0
      const db = mag > 0 ? 20 * Math.log10(mag) : -90
      const clampedDb = clamp(db, -gainRangeDb, gainRangeDb)

      const x = freqToX(f)
      const px = xToPx(x)
      const py = dbToPx(clampedDb)

      d += i === 0 ? `M ${px.toFixed(1)} ${py.toFixed(1)}` : ` L ${px.toFixed(1)} ${py.toFixed(1)}`
    }

    return d
  }, [spectrum, enabled, gainRangeDb])

  // Fill área abaixo da curva
  const fillPath = useMemo(() => {
    if (!spectrumPath) return ''
    const baseY = dbToPx(0)
    const lastX = xToPx(1)
    const firstX = xToPx(0)
    return `${spectrumPath} L ${lastX.toFixed(1)} ${baseY.toFixed(1)} L ${firstX.toFixed(1)} ${baseY.toFixed(1)} Z`
  }, [spectrumPath])

  // Cores com transparência
  const rtaColor = enabled ? accent : '#5b6a82'
  const fillColor = enabled ? accent : '#3a4a63'

  return (
    <>
      {/* Preenchimento abaixo da curva do RTA. */}
      {fillPath && (
        <path
          d={fillPath}
          fill={fillColor}
          fillOpacity={0.08}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {/* Curva do RTA. */}
      {spectrumPath && (
        <path
          d={spectrumPath}
          fill="none"
          stroke={rtaColor}
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{
            filter: enabled ? `drop-shadow(0 0 3px ${rtaColor}66)` : 'grayscale(1) opacity(.3)',
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  )
}
