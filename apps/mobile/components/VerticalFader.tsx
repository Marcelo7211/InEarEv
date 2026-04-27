import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, Text, View } from 'react-native'

import {
  consolePalette,
  consoleRadius,
  consoleSpacing,
  consoleType,
} from '@inear/design-system'

import { FaderScale } from './FaderScale'

type Props = {
  value: number
  min?: number
  max?: number
  onCommit: (v: number) => void
  onLiveChange?: (v: number) => void
  /** Cor de canal usada na metade superior do preenchimento. */
  accent?: string
  /** Altura do trilho. */
  trackHeight?: number
  /** Mostrar escala de dB. */
  showScale?: boolean
  /** Mostrar leitura textual sob o cap. */
  showReadout?: boolean
  /** Reset com double-tap. */
  resetValue?: number
}

/**
 * Fader vertical estilo console — trilho recessed, cap com guia central,
 * preenchimento gradiente verde→âmbar→vermelho, escala de dB opcional.
 */
export function VerticalFader({
  value,
  min = 0,
  max = 2,
  onCommit,
  onLiveChange,
  accent = consolePalette.faderFill,
  trackHeight = consoleSpacing.faderTrackHeight,
  showScale = true,
  showReadout = true,
  resetValue,
}: Props) {
  const [local, setLocal] = useState(value)
  const localRef = useRef(value)
  const startVRef = useRef(value)
  const draggingRef = useRef(false)
  const heightRef = useRef(trackHeight)
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
      const h = heightRef.current
      if (h < 8) return
      const span = max - min
      const v = clamp(startVRef.current + (-dy / h) * span)
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
          const now = Date.now()
          if (now - lastTapAt.current < 250 && resetValue != null) {
            const v = clamp(resetValue)
            setLocal(v)
            onCommit(v)
          }
          lastTapAt.current = now
          draggingRef.current = true
          startVRef.current = localRef.current
        },
        onPanResponderMove: (_e, g) => setFromDy(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: flushCommit,
        onPanResponderTerminate: flushCommit,
      }),
    [clamp, flushCommit, onCommit, resetValue, setFromDy],
  )

  const span = max - min
  const pct = span > 1e-6 ? Math.max(0, Math.min(1, (local - min) / span)) : 0.5
  const fillH = Math.round(trackHeight * pct)
  const capBottom = Math.max(
    0,
    Math.min(trackHeight - consoleSpacing.faderCapHeight, fillH - consoleSpacing.faderCapHeight / 2),
  )
  const overUnity = local > (min + max) / 1.4

  return (
    <View style={s.row}>
      <View
        style={[s.track, { height: trackHeight }]}
        onLayout={(e) => {
          heightRef.current = e.nativeEvent.layout.height
        }}
        {...panResponder.panHandlers}
      >
        <View style={s.rail} />
        {/* faixa colorida (gradiente discreto via duas camadas) */}
        <View
          style={[
            s.fill,
            {
              height: fillH,
              backgroundColor: overUnity ? consolePalette.faderFillOver : accent,
            },
          ]}
        />
        <View
          style={[
            s.fillTop,
            {
              height: Math.max(0, fillH - 14),
              backgroundColor: accent,
              opacity: 0.55,
            },
          ]}
        />
        {/* tick central (0 dB) */}
        <View style={[s.zeroTick, { bottom: trackHeight * 0.7 - 0.5 }]} />
        {/* cap (thumb) com sulco central */}
        <View
          style={[
            s.cap,
            {
              bottom: capBottom,
              shadowColor: accent,
              shadowOpacity: 0.5,
              shadowRadius: 4,
            },
          ]}
        >
          <View style={s.capLine} />
          <View style={s.capLine} />
          <View style={s.capLine} />
        </View>
      </View>
      {showScale ? <FaderScale height={trackHeight} side="right" /> : null}
      {showReadout ? (
        <Text
          style={[
            s.readout,
            { left: -4, top: trackHeight + 2, color: accent },
          ]}
        >
          {local.toFixed(2)}
        </Text>
      ) : null}
    </View>
  )
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  track: {
    width: consoleSpacing.faderTrackWidth + 12,
    backgroundColor: consolePalette.faderTrack,
    borderRadius: consoleRadius.strip,
    borderWidth: 1,
    borderColor: consolePalette.borderMetal,
    overflow: 'hidden',
    paddingHorizontal: 0,
    position: 'relative',
  },
  rail: {
    position: 'absolute',
    left: '50%',
    marginLeft: -1,
    top: 4,
    bottom: 4,
    width: 2,
    backgroundColor: consolePalette.faderTrackInner,
    borderRadius: 1,
  },
  fill: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 0,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  fillTop: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 14,
    borderRadius: 2,
  },
  zeroTick: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: consolePalette.textMid,
    opacity: 0.6,
  },
  cap: {
    position: 'absolute',
    left: -3,
    right: -3,
    height: consoleSpacing.faderCapHeight,
    backgroundColor: consolePalette.faderCap,
    borderRadius: 4,
    borderTopWidth: 1,
    borderTopColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: consolePalette.faderCapEdge,
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 3,
    elevation: 4,
  },
  capLine: {
    height: 1,
    backgroundColor: consolePalette.faderCapEdge,
    marginVertical: 1,
    opacity: 0.5,
  },
  readout: {
    position: 'absolute',
    fontFamily: consoleType.fontDigit,
    fontSize: 10,
    fontWeight: '800',
    minWidth: 36,
    textAlign: 'center',
  },
})
