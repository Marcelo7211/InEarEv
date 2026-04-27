import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'

import {
  consolePalette,
  consoleRadius,
  consoleSpacing,
  consoleType,
} from '@inear/design-system'

type Props = {
  /** Valor atual. */
  value: number
  /** Mínimo (default 0). */
  min?: number
  /** Máximo (default 1). */
  max?: number
  /** Valor "centro" exibido no LED de centro (default = (min+max)/2). */
  center?: number
  /** Tamanho diâmetro. */
  size?: number
  /** Cor de canal usada como anel ativo. */
  accent?: string
  /** Label sob o knob (ex.: "PAN", "Q"). */
  label?: string
  /** Display textual no centro (ex.: "L", "R", "C", "+3 dB"). */
  display?: string
  /** Commit no soltar. */
  onCommit: (v: number) => void
  /** Live (durante arrasto). */
  onLiveChange?: (v: number) => void
  /** Reset com double-tap. */
  resetValue?: number
}

/**
 * Knob com arrasto vertical (1px ≈ 0.6% do range).
 * Indicador é uma linha radial que gira de -135° (min) a +135° (max).
 */
export function Knob({
  value,
  min = 0,
  max = 1,
  center,
  size = consoleSpacing.knobSize,
  accent = consolePalette.ledGreen,
  label,
  display,
  onCommit,
  onLiveChange,
  resetValue,
}: Props) {
  const [local, setLocal] = useState(value)
  const localRef = useRef(value)
  const startVRef = useRef(value)
  const draggingRef = useRef(false)
  const lastTapAt = useRef(0)
  localRef.current = local

  useEffect(() => {
    if (draggingRef.current) return
    setLocal(value)
  }, [value])

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, +v.toFixed(4))),
    [min, max],
  )

  const setFromDy = useCallback(
    (dy: number) => {
      const span = max - min
      // 200 px de arrasto vertical = todo o range
      const v = clamp(startVRef.current + (-dy / 200) * span)
      setLocal(v)
      onLiveChange?.(v)
    },
    [clamp, max, min, onLiveChange],
  )

  const flushCommit = useCallback(() => {
    draggingRef.current = false
    onCommit(localRef.current)
  }, [onCommit])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          draggingRef.current = true
          startVRef.current = localRef.current
        },
        onPanResponderMove: (_e, g) => setFromDy(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: flushCommit,
        onPanResponderTerminate: flushCommit,
      }),
    [flushCommit, setFromDy],
  )

  const span = max - min
  const pct = span > 1e-6 ? (local - min) / span : 0.5
  const angle = -135 + pct * 270

  const ctr = center ?? (min + max) / 2
  const atCenter = Math.abs(local - ctr) < (max - min) * 0.02

  return (
    <View style={s.col}>
      <View
        style={[s.knob, { width: size, height: size, borderRadius: size / 2 }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            const now = Date.now()
            if (now - lastTapAt.current < 250 && resetValue != null) {
              const v = clamp(resetValue)
              setLocal(v)
              onCommit(v)
            }
            lastTapAt.current = now
          }}
        >
          <View
            style={[
              s.arc,
              {
                borderColor: accent,
                width: size - 4,
                height: size - 4,
                borderRadius: (size - 4) / 2,
                opacity: pct,
              },
            ]}
          />
          <View
            style={[
              s.indicator,
              {
                width: 2,
                height: size * 0.4,
                marginLeft: -1,
                left: '50%',
                top: 4,
                transform: [{ rotate: `${angle}deg` }, { translateY: 0 }],
                backgroundColor: accent,
              },
            ]}
          />
          {atCenter ? (
            <View style={[s.centerDot, { borderColor: accent }]} />
          ) : null}
        </Pressable>
      </View>
      {display ? <Text style={[s.display, { color: accent }]}>{display}</Text> : null}
      {label ? <Text style={s.label}>{label}</Text> : null}
    </View>
  )
}

const s = StyleSheet.create({
  col: { alignItems: 'center', justifyContent: 'center' },
  knob: {
    backgroundColor: consolePalette.knobBody,
    borderWidth: 2,
    borderColor: consolePalette.knobBezel,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  arc: {
    position: 'absolute',
    top: 2,
    left: 2,
    borderWidth: 2,
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  indicator: {
    position: 'absolute',
    borderRadius: 1,
  },
  centerDot: {
    position: 'absolute',
    top: '45%',
    left: '45%',
    width: 4,
    height: 4,
    borderRadius: consoleRadius.led,
    borderWidth: 1,
  },
  display: {
    fontFamily: consoleType.fontDigit,
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  label: {
    fontFamily: consoleType.fontUi,
    fontSize: 8,
    color: consolePalette.textLo,
    marginTop: 1,
    letterSpacing: 0.6,
  },
})
