import { StyleSheet, View } from 'react-native'

import {
  consolePalette,
  consoleRadius,
  meterSegmentColor,
  meterSegmentDimColor,
  meterSegments,
} from '@inear/design-system'

type Props = {
  /** Nível 0..1. */
  level: number
  /** Altura total do meter. */
  height?: number
  /** Largura total do meter. */
  width?: number
  /** Modo "single column" (gravado um canal) ou "stereo" (duas colunas L/R). */
  stereo?: boolean
  /** Quando dado, mostra também um ponto de "peak hold". */
  peak?: number
}

/** LED segmentado vertical — preenche de baixo para cima. */
export function Meter({
  level,
  height = 110,
  width = 8,
  stereo = false,
  peak,
}: Props) {
  const safe = Math.max(0, Math.min(1, Number(level) || 0))
  const peakSafe = peak == null ? null : Math.max(0, Math.min(1, peak))
  return (
    <View style={[s.box, { width: stereo ? width * 2 + 2 : width, height }]}>
      <MeterColumn level={safe} peak={peakSafe} />
      {stereo ? (
        <>
          <View style={s.gap} />
          <MeterColumn level={safe} peak={peakSafe} />
        </>
      ) : null}
    </View>
  )
}

function MeterColumn({ level, peak }: { level: number; peak: number | null }) {
  return (
    <View style={s.column}>
      {meterSegments
        .slice()
        .reverse()
        .map((seg) => {
          const lit = level >= seg.threshold
          const peakLit = peak != null && peak >= seg.threshold && peak < seg.threshold + 0.06
          const c = lit ? meterSegmentColor(seg.color) : meterSegmentDimColor(seg.color)
          return (
            <View
              key={String(seg.threshold)}
              style={[
                s.seg,
                {
                  backgroundColor: c,
                  shadowColor: meterSegmentColor(seg.color),
                  shadowOpacity: lit ? 0.5 : 0,
                  shadowRadius: lit ? 3 : 0,
                  borderColor: peakLit ? meterSegmentColor(seg.color) : 'transparent',
                  borderWidth: peakLit ? 1 : 0,
                },
              ]}
            />
          )
        })}
    </View>
  )
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    backgroundColor: consolePalette.meterOff,
    borderRadius: consoleRadius.strip,
    borderWidth: 1,
    borderColor: consolePalette.border,
    padding: 1,
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  column: { flex: 1, justifyContent: 'space-between' },
  gap: { width: 2 },
  seg: {
    flex: 1,
    marginVertical: 0.5,
    borderRadius: 1,
  },
})
