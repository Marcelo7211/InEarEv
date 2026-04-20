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

  useEffect(() => {
    setLocal(value)
  }, [value])

  const clamp = (v: number) =>
    Math.max(min, Math.min(max, +v.toFixed(3)))

  const setFromDx = (dx: number) => {
    if (trackW < 1) return
    const span = max - min
    const v = clamp(startVRef.current + (dx / trackW) * span)
    setLocal(v)
    onCommit(v)
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startVRef.current = local
        },
        onPanResponderMove: (_e, gestureState) => {
          setFromDx(gestureState.dx)
        },
      }),
    [local],
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
    borderRadius: 10,
    backgroundColor: '#151b24',
    overflow: 'hidden',
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
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
    backgroundColor: '#1b2431',
  },
  fill: {
    position: 'absolute',
    left: 6,
    top: 7,
    bottom: 7,
    backgroundColor: '#238636',
    borderRadius: 999,
  },
  thumb: {
    position: 'absolute',
    top: 4,
    marginLeft: -10,
    width: 20,
    height: 28,
    borderRadius: 9,
    backgroundColor: '#c4ccd6',
    borderWidth: 1,
    borderColor: '#6a7381',
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
    backgroundColor: '#30363d',
    borderRadius: 6,
  },
  stepBtnCompact: {
    minWidth: 26,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  stepTxt: { color: '#e6edf3', fontSize: 18, fontWeight: '700' },
  stepTxtCompact: { fontSize: 12 },
  val: { color: '#8b949e', fontSize: 12, minWidth: 44, textAlign: 'center' },
  valCompact: { fontSize: 10, minWidth: 28 },
})
