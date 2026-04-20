import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, Text, View } from 'react-native'

const TRACK_H = 106

type Props = {
  value: number
  min?: number
  max?: number
  /** Valor final ao soltar o dedo (PATCH / estado garantido). */
  onCommit: (v: number) => void
  /** Durante o arrasto no ecrã (opcional: throttle de rede no pai). */
  onLiveChange?: (v: number) => void
}

/** Fader vertical estilo mesa (baixo = menos, cima = mais). Arrasto contínuo com o dedo. */
export function RetornoVerticalFader({
  value,
  min = 0,
  max = 2,
  onCommit,
  onLiveChange,
}: Props) {
  const [local, setLocal] = useState(value)
  const hRef = useRef(TRACK_H)
  const [trackPx, setTrackPx] = useState(TRACK_H)
  const lastVRef = useRef(value)
  const draggingRef = useRef(false)
  const startVRef = useRef(value)

  useEffect(() => {
    if (draggingRef.current) return
    setLocal(value)
    lastVRef.current = value
  }, [value])

  const clamp = useCallback(
    (v: number) => Math.max(min, Math.min(max, +v.toFixed(4))),
    [min, max],
  )

  const setFromDeltaY = useCallback(
    (dy: number) => {
      const height = hRef.current
      if (height < 8) return clamp(min)
      const span = max - min
      const delta = (-dy / height) * span
      const v = clamp(startVRef.current + delta)
      lastVRef.current = v
      setLocal(v)
      onLiveChange?.(v)
      return v
    },
    [clamp, max, min, onLiveChange],
  )

  const flushCommit = useCallback(() => {
    draggingRef.current = false
    onCommit(lastVRef.current)
  }, [onCommit])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          draggingRef.current = true
          startVRef.current = lastVRef.current
        },
        onPanResponderMove: (_e, gestureState) => {
          setFromDeltaY(gestureState.dy)
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: flushCommit,
        onPanResponderTerminate: flushCommit,
      }),
    [flushCommit, setFromDeltaY],
  )

  const span = max - min
  const fillPct =
    span > 1e-6 ? Math.max(0, Math.min(100, ((local - min) / span) * 100)) : 50
  const safePct = Number.isFinite(fillPct) ? fillPct : 0
  const th = trackPx > 8 ? trackPx : TRACK_H
  const fillPx = Math.max(2, Math.round((th * safePct) / 100))
  const thumbBottom = Math.max(0, Math.min(th - 18, fillPx - 9))

  return (
    <View style={s.col}>
      <View
        style={s.track}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height
          hRef.current = h
          if (h > 8) setTrackPx(h)
        }}
        {...panResponder.panHandlers}
      >
        <View style={s.trackRail} />
        <View style={s.trackGuideTop} />
        <View style={s.trackGuideBottom} />
        <View style={[s.fill, { height: fillPx }]} />
        <View style={[s.thumb, { bottom: thumbBottom }]} />
      </View>
      <Text style={s.val}>{local.toFixed(2)}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  col: { alignItems: 'center', width: 54 },
  track: {
    width: 44,
    height: TRACK_H,
    borderRadius: 10,
    backgroundColor: '#111720',
    overflow: 'hidden',
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3a4455',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  trackRail: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 7,
    bottom: 7,
    borderRadius: 999,
    backgroundColor: '#1b2330',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a3444',
  },
  trackGuideTop: {
    position: 'absolute',
    top: 9,
    left: 17,
    right: 17,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  trackGuideBottom: {
    position: 'absolute',
    bottom: 9,
    left: 17,
    right: 17,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  fill: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    backgroundColor: '#2f81f7',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  thumb: {
    position: 'absolute',
    left: 6,
    right: 6,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#b8c1cd',
    borderWidth: 1,
    borderColor: '#687385',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  val: { color: '#8b949e', fontSize: 10, minWidth: 40, textAlign: 'center' },
})
