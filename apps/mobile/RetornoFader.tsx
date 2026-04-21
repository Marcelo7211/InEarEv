import { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native'

type Props = {
  value: number
  min?: number
  max?: number
  onCommit: (v: number) => void
  /** Barra mais baixa (EQ em faixa estreita). */
  compact?: boolean
}

/**
 * Fader táctil sem dependências extra (evita Invalid hook call com React 19 no monorepo).
 */
export function RetornoFader({
  value,
  min = 0,
  max = 2,
  onCommit,
  compact = false,
}: Props) {
  const [local, setLocal] = useState(value)
  const [trackW, setTrackW] = useState(1)
  const startVRef = useRef(value)
  const localRef = useRef(value)
  const draggingRef = useRef(false)
  const onCommitRef = useRef(onCommit)

  localRef.current = local
  onCommitRef.current = onCommit

  useEffect(() => {
    if (draggingRef.current) return
    setLocal(value)
  }, [value])

  const clamp = (v: number) =>
    Math.max(min, Math.min(max, +v.toFixed(3)))

  const setFromDx = (dx: number) => {
    if (trackW < 1) return
    const span = max - min
    const v = clamp(startVRef.current + (dx / trackW) * span)
    setLocal(v)
    onCommitRef.current(v)
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          draggingRef.current = true
          startVRef.current = localRef.current
        },
        onPanResponderMove: (_e, gestureState) => {
          setFromDx(gestureState.dx)
        },
        onPanResponderRelease: () => {
          draggingRef.current = false
        },
        onPanResponderTerminate: () => {
          draggingRef.current = false
        },
      }),
    [trackW, min, max],
  )

  const pct = (local - min) / (max - min)
  const safePct = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0
  const thumbLeft = `${safePct * 100}%` as `${number}%`

  return (
    <View style={s.wrap}>
      <View
        style={[s.track, compact && s.trackCompact]}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        <View style={s.trackInner} />
        <View style={[s.fill, { width: `${pct * 100}%` }]} />
        <View style={[s.thumb, { left: thumbLeft }]} />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => {
            if (trackW < 1) return
            const t = Math.max(0, Math.min(1, e.nativeEvent.locationX / trackW))
            const v = clamp(min + t * (max - min))
            setLocal(v)
            onCommit(v)
          }}
          {...panResponder.panHandlers}
        />
      </View>
      <View style={[s.row, compact && s.rowCompact]}>
        <Pressable
          onPress={() => {
            const step = compact ? 0.5 : 0.05
            const v = clamp(local - step)
            setLocal(v)
            onCommit(v)
          }}
          style={[s.stepBtn, compact && s.stepBtnCompact]}
        >
          <Text style={[s.stepTxt, compact && s.stepTxtCompact]}>−</Text>
        </Pressable>
        <Text style={[s.val, compact && s.valCompact]}>
          {compact ? local.toFixed(0) : local.toFixed(2)}
        </Text>
        <Pressable
          onPress={() => {
            const step = compact ? 0.5 : 0.05
            const v = clamp(local + step)
            setLocal(v)
            onCommit(v)
          }}
          style={[s.stepBtn, compact && s.stepBtnCompact]}
        >
          <Text style={[s.stepTxt, compact && s.stepTxtCompact]}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { width: '100%' },
  track: {
    height: 36,
    borderRadius: 12,
    backgroundColor: '#0f1621',
    overflow: 'hidden',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2c394d',
  },
  trackCompact: {
    height: 22,
    marginBottom: 2,
  },
  trackInner: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: 7,
    bottom: 7,
    borderRadius: 999,
    backgroundColor: '#172232',
  },
  fill: {
    position: 'absolute',
    left: 6,
    top: 7,
    bottom: 7,
    backgroundColor: '#2ea043',
    borderRadius: 999,
  },
  thumb: {
    position: 'absolute',
    top: 4,
    marginLeft: -10,
    width: 20,
    height: 28,
    borderRadius: 10,
    backgroundColor: '#d6dce6',
    borderWidth: 1,
    borderColor: '#7d8796',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  rowCompact: { gap: 4 },
  stepBtn: {
    minWidth: 40,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#1c2736',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#314258',
  },
  stepBtnCompact: {
    minWidth: 26,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  stepTxt: { color: '#e6edf3', fontSize: 18, fontWeight: '700' },
  stepTxtCompact: { fontSize: 12 },
  val: { color: '#9eb0c7', fontSize: 12, minWidth: 44, textAlign: 'center' },
  valCompact: { fontSize: 10, minWidth: 28 },
})
