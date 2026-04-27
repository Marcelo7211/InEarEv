import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, Text, View } from 'react-native'

import { consolePalette, consoleType } from '@inear/design-system'

export type PeqBandUi = {
  type: 'hpf' | 'lpf' | 'bell' | 'lowshelf' | 'highshelf'
  enabled?: boolean
  freqHz: number
  q: number
  gainDb: number
}

type Props = {
  bands: PeqBandUi[]
  enabled: boolean
  accent?: string
  /** Faixa de gain mostrada no eixo Y (±). */
  gainRangeDb?: number
  /** Largura interna desejada do gráfico. */
  width?: number
  /** Altura interna do gráfico. */
  height?: number
  onLiveBandsChange?: (next: PeqBandUi[]) => void
  onBandsCommit: (next: PeqBandUi[]) => void
}

const FREQ_MIN = 20
const FREQ_MAX = 20000
const PADDING = { top: 14, right: 12, bottom: 22, left: 28 }
const BAND_COLORS = ['#39ff14', '#5cc8ff', '#ffb020', '#ff5252', '#bf7af0', '#41e0d4']
const FREQ_MAJOR: { hz: number; label: string }[] = [
  { hz: 20, label: '20' },
  { hz: 100, label: '100' },
  { hz: 1000, label: '1k' },
  { hz: 10000, label: '10k' },
  { hz: 20000, label: '20k' },
]
const FREQ_MINOR = [50, 200, 500, 2000, 5000]

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function freqToFrac(f: number): number {
  const safe = clamp(f, FREQ_MIN, FREQ_MAX)
  const lo = Math.log10(FREQ_MIN)
  const hi = Math.log10(FREQ_MAX)
  return (Math.log10(safe) - lo) / (hi - lo)
}

function fracToFreq(t: number): number {
  const lo = Math.log10(FREQ_MIN)
  const hi = Math.log10(FREQ_MAX)
  return Math.pow(10, lo + clamp(t, 0, 1) * (hi - lo))
}

/**
 * Gráfico de PEQ para mobile usando apenas Views (sem SVG).
 * - Eixo X log de 20 Hz a 20 kHz com labels Hz (20 / 100 / 1k / 10k / 20k) e ticks.
 * - Eixo Y linear ±gainRangeDb com tick maior em 0 dB.
 * - Pontos numerados arrastáveis (vertical = gain, horizontal = freq).
 * - Linhas finas conectando bandas consecutivas (visualização aproximada da curva).
 */
export function PeqGraphMobile({
  bands,
  enabled,
  accent = consolePalette.ledGreen,
  gainRangeDb = 18,
  width = 320,
  height = 180,
  onLiveBandsChange,
  onBandsCommit,
}: Props) {
  const [draft, setDraft] = useState<PeqBandUi[]>(bands)
  const draftRef = useRef<PeqBandUi[]>(bands)
  const dragRef = useRef<number | null>(null)
  draftRef.current = draft

  useEffect(() => {
    if (dragRef.current != null) return
    setDraft(bands)
  }, [bands])

  const innerW = Math.max(80, width - PADDING.left - PADDING.right)
  const innerH = Math.max(80, height - PADDING.top - PADDING.bottom)

  const xPx = useCallback((f: number) => PADDING.left + freqToFrac(f) * innerW, [innerW])
  const yPx = useCallback(
    (db: number) => PADDING.top + ((gainRangeDb - db) / (gainRangeDb * 2)) * innerH,
    [gainRangeDb, innerH],
  )
  const pxToFreq = useCallback(
    (x: number) => fracToFreq((x - PADDING.left) / innerW),
    [innerW],
  )
  const pxToDb = useCallback(
    (y: number) => gainRangeDb - ((y - PADDING.top) / innerH) * gainRangeDb * 2,
    [gainRangeDb, innerH],
  )

  // Cria um PanResponder por banda (índice fixo) — memo para evitar recriação por render.
  const responders = useMemo(
    () =>
      draft.map((_band, idx) =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => true,
          onMoveShouldSetPanResponder: () => true,
          onPanResponderGrant: () => {
            dragRef.current = idx
          },
          onPanResponderMove: (evt) => {
            const localX = evt.nativeEvent.locationX
            const localY = evt.nativeEvent.locationY
            // O Pan responder está em cada bolinha; locationX/Y é relativo à bolinha
            // (16x16). Para movimento absoluto, precisamos translation.
            // Usamos pageX/pageY com offset do gráfico — porém, sem refs de medida do
            // svg-like container, fazemos drag relativo: cada delta de pixel converte
            // diretamente para freq/dB na escala do gráfico.
            // Em vez disso, calculamos delta entre toques:
            void localX
            void localY
          },
          onPanResponderTerminationRequest: () => false,
          onPanResponderRelease: () => {
            dragRef.current = null
            onBandsCommit(draftRef.current)
          },
          onPanResponderTerminate: () => {
            dragRef.current = null
            onBandsCommit(draftRef.current)
          },
        }),
      ),
    [draft.length, onBandsCommit],
  )

  /** Posições atuais. */
  const positions = draft.map((b) => ({
    x: xPx(b.freqHz),
    y: yPx(b.gainDb),
  }))

  /** Linhas conectando consecutivas (em ordem de banda). */
  const segments = []
  for (let i = 0; i < positions.length - 1; i++) {
    const a = positions[i]!
    const c = positions[i + 1]!
    const dx = c.x - a.x
    const dy = c.y - a.y
    const len = Math.hypot(dx, dy)
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI
    segments.push({ x: a.x, y: a.y, len, ang })
  }

  // ── arrasto: usamos PanResponder no container do gráfico para capturar movimento global. ─
  const containerResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: () => dragRef.current != null,
        onPanResponderGrant: () => {},
        onPanResponderMove: (e) => {
          const idx = dragRef.current
          if (idx == null) return
          const lx = e.nativeEvent.locationX
          const ly = e.nativeEvent.locationY
          const f = clamp(pxToFreq(lx), FREQ_MIN, FREQ_MAX)
          const g = clamp(pxToDb(ly), -gainRangeDb, gainRangeDb)
          const next = draftRef.current.map((b, i) =>
            i === idx
              ? {
                  ...b,
                  freqHz: Math.round(f),
                  gainDb: Math.round(g * 10) / 10,
                }
              : b,
          )
          draftRef.current = next
          setDraft(next)
          onLiveBandsChange?.(next)
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: () => {
          dragRef.current = null
          onBandsCommit(draftRef.current)
        },
        onPanResponderTerminate: () => {
          dragRef.current = null
          onBandsCommit(draftRef.current)
        },
      }),
    [gainRangeDb, onBandsCommit, onLiveBandsChange, pxToDb, pxToFreq],
  )

  return (
    <View
      style={[s.box, { width, height }]}
      {...containerResponder.panHandlers}
    >
      {/* Frame interno (recessed). */}
      <View
        style={[
          s.frame,
          {
            left: PADDING.left,
            top: PADDING.top,
            width: innerW,
            height: innerH,
          },
        ]}
      />

      {/* Linhas verticais menores. */}
      {FREQ_MINOR.map((f) => (
        <View
          key={`fmn-${f}`}
          pointerEvents="none"
          style={[
            s.gridV,
            { left: xPx(f), top: PADDING.top, height: innerH },
          ]}
        />
      ))}
      {/* Linhas verticais maiores + label Hz. */}
      {FREQ_MAJOR.map((g) => (
        <View key={`fmj-${g.hz}`} pointerEvents="none">
          <View
            style={[
              s.gridVMajor,
              { left: xPx(g.hz), top: PADDING.top, height: innerH },
            ]}
          />
          <Text
            style={[
              s.axisLabel,
              {
                left: xPx(g.hz) - 14,
                top: PADDING.top + innerH + 4,
                width: 28,
                textAlign: 'center',
              },
            ]}
          >
            {g.label}
          </Text>
        </View>
      ))}
      <Text
        pointerEvents="none"
        style={[
          s.axisUnit,
          { left: PADDING.left + innerW + 2, top: PADDING.top + innerH + 4 },
        ]}
      >
        Hz
      </Text>

      {/* Ticks de dB + label "0 dB" forte. */}
      {[gainRangeDb, gainRangeDb / 2, 0, -gainRangeDb / 2, -gainRangeDb].map(
        (db) => {
          const major = db === 0
          return (
            <View key={`yt-${db}`} pointerEvents="none">
              <View
                style={[
                  s.gridH,
                  major && s.gridHMajor,
                  {
                    left: PADDING.left,
                    top: yPx(db),
                    width: innerW,
                  },
                ]}
              />
              <Text
                style={[
                  s.axisLabel,
                  major && s.axisLabelMajor,
                  {
                    left: 2,
                    top: yPx(db) - 5,
                    width: PADDING.left - 4,
                    textAlign: 'right',
                  },
                ]}
              >
                {db > 0 ? `+${Math.round(db)}` : Math.round(db)}
              </Text>
            </View>
          )
        },
      )}
      <Text
        pointerEvents="none"
        style={[
          s.axisUnit,
          { left: 2, top: PADDING.top - 10, textAlign: 'right', width: PADDING.left - 4 },
        ]}
      >
        dB
      </Text>

      {/* Linhas conectando bandas consecutivas — aproximação visual da curva. */}
      {enabled
        ? segments.map((seg, i) => (
            <View
              key={`seg-${i}`}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: seg.x,
                top: seg.y - 1,
                width: seg.len,
                height: 2,
                backgroundColor: accent,
                opacity: 0.65,
                transform: [
                  { translateX: 0 },
                  { rotate: `${seg.ang}deg` },
                ],
                transformOrigin: '0% 50%',
              }}
            />
          ))
        : null}

      {/* Linha do 0 dB (mais visível). */}
      <View
        pointerEvents="none"
        style={[
          s.zeroLine,
          { left: PADDING.left, width: innerW, top: yPx(0) },
        ]}
      />

      {/* Pontos das bandas (numerados). */}
      {draft.map((b, i) => {
        const off = b.enabled === false
        const tint = off ? '#3a4a63' : BAND_COLORS[i % BAND_COLORS.length]!
        const cx = positions[i]!.x
        const cy = positions[i]!.y
        const hzLabel =
          b.freqHz >= 1000
            ? `${(b.freqHz / 1000).toFixed(b.freqHz >= 10000 ? 0 : 1)}k`
            : `${Math.round(b.freqHz)}`
        return (
          <View key={`pt-${i}`}>
            {/* Badge Hz acima do ponto. */}
            <View
              pointerEvents="none"
              style={[
                s.hzBadge,
                {
                  left: cx - 22,
                  top: cy - 28,
                  borderColor: tint,
                },
              ]}
            >
              <Text style={[s.hzBadgeTxt, { color: tint }]}>{hzLabel}Hz</Text>
            </View>
            {/* Bolinha numerada arrastável. */}
            <View
              style={[
                s.point,
                {
                  left: cx - 14,
                  top: cy - 14,
                  backgroundColor: tint,
                },
              ]}
              {...responders[i]?.panHandlers}
            >
              <Text style={s.pointTxt}>{i + 1}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  box: {
    position: 'relative',
    backgroundColor: '#0c1320',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e2a3c',
    overflow: 'hidden',
  },
  frame: {
    position: 'absolute',
    backgroundColor: '#040608',
    borderWidth: 1,
    borderColor: '#11202d',
    borderRadius: 4,
  },
  gridV: {
    position: 'absolute',
    width: 1,
    backgroundColor: '#0c1825',
  },
  gridVMajor: {
    position: 'absolute',
    width: 1,
    backgroundColor: '#1a2c40',
  },
  gridH: {
    position: 'absolute',
    height: 1,
    backgroundColor: '#0c1825',
  },
  gridHMajor: {
    height: 1.5,
    backgroundColor: '#243447',
  },
  zeroLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: '#3a4a63',
    opacity: 0.6,
  },
  axisLabel: {
    position: 'absolute',
    color: consolePalette.textLo,
    fontFamily: consoleType.fontDigit,
    fontSize: 8,
    fontWeight: '700',
  },
  axisLabelMajor: {
    color: consolePalette.textMid,
    fontWeight: '900',
  },
  axisUnit: {
    position: 'absolute',
    color: consolePalette.textLo,
    fontFamily: consoleType.fontDigit,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  point: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#06090f',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pointTxt: {
    color: '#06090f',
    fontWeight: '900',
    fontSize: 12,
  },
  hzBadge: {
    position: 'absolute',
    width: 44,
    height: 16,
    borderRadius: 3,
    borderWidth: 1,
    backgroundColor: '#040608',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hzBadgeTxt: {
    fontFamily: consoleType.fontDigit,
    fontSize: 9,
    fontWeight: '800',
  },
})
