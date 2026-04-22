import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { RetornoFader } from './RetornoFader'
import { type NativeRetornoStats, nativeRetornoAudio } from './nativeRetornoAudio'

type Props = {
  wsUrl: string | null
  latencyProfile: 'pro' | 'low' | 'stable' | 'wifi24'
  masterGain: number
  onMasterGainChange: (value: number) => void
}

const emptyStats: NativeRetornoStats = {
  connected: false,
  playing: false,
  profile: 'stable',
  sampleRateHz: 48000,
  bufferFrames: 256,
  queuedFrames: 0,
  drops: 0,
  underruns: 0,
  gaps: 0,
  reconnects: 0,
  lastError: null,
}

export function RetornoNativeConsole({
  wsUrl,
  latencyProfile,
  masterGain,
  onMasterGainChange,
}: Props) {
  const [stats, setStats] = useState<NativeRetornoStats>(emptyStats)
  const [busy, setBusy] = useState(false)
  const isAvailable = nativeRetornoAudio.isAvailable()

  useEffect(() => {
    if (!isAvailable) return
    nativeRetornoAudio.setLatencyProfile(latencyProfile)
  }, [isAvailable, latencyProfile])

  useEffect(() => {
    if (!isAvailable) return
    nativeRetornoAudio.setMasterGain(masterGain)
  }, [isAvailable, masterGain])

  useEffect(() => {
    if (!isAvailable) return
    const emitter = nativeRetornoAudio.createEmitter()
    if (!emitter) return
    const sub = emitter.addListener('retornoAudioStats', (next: NativeRetornoStats) => {
      setStats(next)
    })
    void nativeRetornoAudio.getCurrentStats().then((next) => {
      if (next) setStats(next)
    })
    return () => sub.remove()
  }, [isAvailable])

  useEffect(() => {
    return () => {
      void nativeRetornoAudio.stop()
    }
  }, [])

  const statusText = useMemo(() => {
    if (!isAvailable) return 'Audio nativo indisponivel'
    if (stats.playing && stats.connected) return 'Transmitindo'
    if (stats.playing) return 'Conectando'
    return 'Parado'
  }, [isAvailable, stats.connected, stats.playing])

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>InEar Monitor Console</Text>
          <Text style={s.sub}>
            {isAvailable ? 'Motor nativo ativo' : 'Fallback necessario'}
          </Text>
        </View>
        <View style={[s.badge, stats.playing ? s.badgeLive : s.badgeIdle]}>
          <Text style={s.badgeTxt}>{statusText}</Text>
        </View>
      </View>

      <View style={s.transportRow}>
        <Pressable
          style={[s.actionBtn, (!wsUrl || busy || !isAvailable) && s.actionBtnDisabled]}
          disabled={!wsUrl || busy || !isAvailable}
          onPress={async () => {
            if (!wsUrl) return
            setBusy(true)
            try {
              await nativeRetornoAudio.start(wsUrl, latencyProfile)
            } finally {
              setBusy(false)
            }
          }}
        >
          <Text style={s.actionTxt}>{busy ? '...' : 'Iniciar retorno'}</Text>
        </Pressable>
        <Pressable
          style={[s.ghostBtn, !isAvailable && s.actionBtnDisabled]}
          disabled={!isAvailable}
          onPress={() => void nativeRetornoAudio.stop()}
        >
          <Text style={s.ghostTxt}>Parar</Text>
        </Pressable>
      </View>

      <View style={s.masterBox}>
        <Text style={s.section}>Master</Text>
        <RetornoFader value={masterGain} min={0} max={4} onCommit={onMasterGainChange} />
        <Text style={s.masterValue}>{masterGain.toFixed(2)}x</Text>
      </View>

      <View style={s.statsGrid}>
        <View style={s.statCell}>
          <Text style={s.statLabel}>Perfil</Text>
          <Text style={s.statValue}>
            {stats.profile === 'pro'
              ? '5 GHz PRO'
              : stats.profile === 'low'
                ? '5 GHz'
                : stats.profile === 'wifi24'
                  ? '2.4 GHz'
                  : 'estavel'}
          </Text>
        </View>
        <View style={s.statCell}>
          <Text style={s.statLabel}>Buffer</Text>
          <Text style={s.statValue}>{stats.bufferFrames} smp</Text>
        </View>
        <View style={s.statCell}>
          <Text style={s.statLabel}>Fila</Text>
          <Text style={s.statValue}>{stats.queuedFrames}</Text>
        </View>
        <View style={s.statCell}>
          <Text style={s.statLabel}>SR</Text>
          <Text style={s.statValue}>{stats.sampleRateHz} Hz</Text>
        </View>
        <View style={s.statCell}>
          <Text style={s.statLabel}>Drops</Text>
          <Text style={s.statValue}>{stats.drops}</Text>
        </View>
        <View style={s.statCell}>
          <Text style={s.statLabel}>Underruns</Text>
          <Text style={s.statValue}>{stats.underruns}</Text>
        </View>
        <View style={s.statCell}>
          <Text style={s.statLabel}>Gaps</Text>
          <Text style={s.statValue}>{stats.gaps}</Text>
        </View>
        <View style={s.statCell}>
          <Text style={s.statLabel}>Reconexoes</Text>
          <Text style={s.statValue}>{stats.reconnects}</Text>
        </View>
      </View>

      {stats.lastError ? <Text style={s.error}>{stats.lastError}</Text> : null}
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#233044',
    backgroundColor: '#0b1018',
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 10,
  },
  title: {
    color: '#f0f6fc',
    fontSize: 16,
    fontWeight: '800',
  },
  sub: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeLive: {
    backgroundColor: '#163d2a',
  },
  badgeIdle: {
    backgroundColor: '#1f2937',
  },
  badgeTxt: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 11,
  },
  transportRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#2f81f7',
    paddingVertical: 11,
    alignItems: 'center',
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
  actionTxt: {
    color: '#fff',
    fontWeight: '800',
  },
  ghostBtn: {
    minWidth: 92,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d3a4f',
    backgroundColor: '#101720',
    paddingVertical: 11,
    alignItems: 'center',
  },
  ghostTxt: {
    color: '#dbe4ef',
    fontWeight: '700',
  },
  masterBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2a3a',
    backgroundColor: '#0e1622',
    padding: 10,
    marginBottom: 12,
  },
  section: {
    color: '#79c0ff',
    fontWeight: '800',
    marginBottom: 6,
  },
  masterValue: {
    color: '#dbe4ef',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCell: {
    width: '23%',
    minWidth: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f1724',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 10,
    marginBottom: 4,
  },
  statValue: {
    color: '#f8fafc',
    fontWeight: '800',
    fontSize: 12,
  },
  error: {
    marginTop: 10,
    color: '#f87171',
    fontSize: 11,
    lineHeight: 16,
  },
})
