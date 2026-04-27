import { StyleSheet, Text, View } from 'react-native'

import { consolePalette, consoleType, faderScaleTicks } from '@inear/design-system'

type Props = {
  /** Altura igual à do trilho do fader, para os ticks alinharem. */
  height: number
  /** Lado em que a escala fica relativa ao fader. */
  side?: 'left' | 'right'
}

/** Escala de dB com ticks (major/minor) alinhada ao trilho do fader. */
export function FaderScale({ height, side = 'right' }: Props) {
  return (
    <View style={[s.col, { height }]}>
      {faderScaleTicks.map((t) => (
        <View
          key={t.label}
          style={[
            s.row,
            { top: Math.round((1 - t.pct) * height) - 6 },
            side === 'left' ? s.rowLeft : s.rowRight,
          ]}
        >
          {side === 'right' ? (
            <>
              <View style={[s.tick, t.major && s.tickMajor]} />
              <Text style={[s.label, t.major && s.labelMajor]}>{t.label}</Text>
            </>
          ) : (
            <>
              <Text style={[s.label, s.labelLeft, t.major && s.labelMajor]}>{t.label}</Text>
              <View style={[s.tick, t.major && s.tickMajor]} />
            </>
          )}
        </View>
      ))}
    </View>
  )
}

const s = StyleSheet.create({
  col: {
    width: 22,
    position: 'relative',
  },
  row: {
    position: 'absolute',
    height: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowRight: { left: 0 },
  rowLeft: { right: 0 },
  tick: {
    width: 5,
    height: 1,
    backgroundColor: consolePalette.textLo,
  },
  tickMajor: {
    width: 8,
    height: 1.5,
    backgroundColor: consolePalette.textMid,
  },
  label: {
    fontFamily: consoleType.fontDigit,
    fontSize: 8,
    color: consolePalette.textLo,
    marginLeft: 2,
    minWidth: 14,
  },
  labelLeft: {
    marginLeft: 0,
    marginRight: 2,
    textAlign: 'right',
  },
  labelMajor: {
    color: consolePalette.textMid,
    fontWeight: '700',
  },
})
