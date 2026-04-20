import type { ChannelStrip, Eq3, MusicianStrip, Showfile } from '@inear/protocol'
import {
  channelAccentColor,
  channelIconBadge,
  retornoMixerChannelOrder,
} from '@inear/protocol'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ScrollView,
  StyleSheet,
  Text,
  Pressable,
  View,
} from 'react-native'
import WebView from 'react-native-webview'
import type { RefObject } from 'react'

import { RetornoFader } from './RetornoFader'
import { RetornoVerticalFader } from './RetornoVerticalFader'

export function parseJwtSub(token: string): string {
  try {
    const p = token.split('.')[1]
    if (!p) return ''
    const pad = '='.repeat((4 - (p.length % 4)) % 4)
    const json = JSON.parse(
      atob(p.replace(/-/g, '+').replace(/_/g, '/') + pad),
    ) as { sub?: string }
    return String(json.sub ?? '')
  } catch {
    return ''
  }
}

function pcmIndexFromChannel(ch: ChannelStrip): number | null {
  if (typeof ch.captureInputIndex === 'number' && Number.isFinite(ch.captureInputIndex)) {
    return Math.floor(ch.captureInputIndex)
  }
  const mm = /^if_(\d+)$/.exec(ch.id)
  if (mm) {
    const n = Number(mm[1])
    return Number.isFinite(n) ? Math.floor(n) : null
  }
  return null
}

function levelToDb(level: number): number {
  const safe = Math.max(1e-4, level)
  return Math.max(-80, Math.min(6, 20 * Math.log10(safe)))
}

function dbToVuFill(db: number): `${number}%` {
  const pct = ((db + 80) / 86) * 100
  return `${Math.max(0, Math.min(100, Math.round(pct)))}%` as `${number}%`
}

function eqGainLinear(eq: Eq3): number {
  const avg = (eq.lowDb + eq.midDb + eq.highDb) / 3
  const adb = Math.max(-6, Math.min(6, avg))
  return 10 ** (adb / 20)
}

function lightenHexColor(hex: string, amount = 0.46): string {
  const raw = hex.trim().replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return hex
  const to = (s: string) => Number.parseInt(s, 16)
  const r = to(raw.slice(0, 2))
  const g = to(raw.slice(2, 4))
  const b = to(raw.slice(4, 6))
  const mix = (v: number) => Math.round(v + (255 - v) * amount)
  return `#${[mix(r), mix(g), mix(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

/** Título principal + linha de ajuda: prioriza «Entrada PCM n» para faixas do agregado. */
function stripTitles(ch: ChannelStrip): { primary: string; secondary: string } {
  const legacySubtitle = (): string => {
    if (typeof ch.captureInputIndex === 'number' && Number.isFinite(ch.captureInputIndex)) {
      return `Índice captura ${ch.captureInputIndex}`
    }
    if (ch.sourceTap === 'L') return 'Legado: mistura L'
    if (ch.sourceTap === 'R') return 'Legado: mistura R'
    if (ch.sourceTap === 'sum') return 'Soma L+R'
    return ''
  }
  const pcm = pcmIndexFromChannel(ch)
  if (pcm != null && /^if_\d+$/.test(ch.id)) {
    const customName = ch.name && ch.name.trim() ? ch.name.trim() : ''
    return {
      primary:
        customName && !/^if_\d+$/i.test(customName)
          ? customName
          : `Entrada PCM ${pcm}`,
      secondary: `Entrada PCM ${pcm}`,
    }
  }
  if (pcm != null) {
    return {
      primary: ch.name || `Entrada PCM ${pcm}`,
      secondary: `Entrada PCM ${pcm}`,
    }
  }
  return { primary: ch.name, secondary: legacySubtitle() }
}

type ChannelStripProps = {
  ch: ChannelStrip
  send: number
  eqLow: number
  eqMid: number
  eqHigh: number
  inputLevel?: number
  accentColor: string
  sendMuted: boolean
  lockEq: boolean
  onSend: (v: number) => void
  onSendLive?: (v: number) => void
  onToggleMute: () => void
  onEqBand: (band: keyof Eq3, v: number) => void
}

const RetornoMixerChannelStrip = memo(function RetornoMixerChannelStrip({
  ch,
  send,
  eqLow,
  eqMid,
  eqHigh,
  inputLevel = 0,
  accentColor,
  sendMuted,
  lockEq,
  onSend,
  onSendLive,
  onToggleMute,
  onEqBand,
}: ChannelStripProps) {
  const { primary, secondary } = stripTitles(ch)
  const effectiveEq = { lowDb: eqLow, midDb: eqMid, highDb: eqHigh }
  const channelOpen = ch.mute || sendMuted ? 0 : 1
  const effectiveLevel = Math.max(
    0,
    Math.min(
      1,
      Math.max(
        inputLevel * 1.6 * channelOpen,
        inputLevel * ch.gain * send * eqGainLinear(effectiveEq) * 1.8 * channelOpen,
      ),
    ),
  )
  const outputDb = levelToDb(effectiveLevel)
  const vuFill = dbToVuFill(outputDb)
  const vuColor =
    outputDb > -6 ? '#f85149' : outputDb > -18 ? '#d29922' : '#2ea043'
  const badge = channelIconBadge(ch.icon)
  const iconBg = sendMuted ? lightenHexColor(accentColor, 0.48) : accentColor
  return (
    <View
      style={[
        s.strip,
        {
          borderColor: accentColor,
          backgroundColor: sendMuted ? '#131821' : '#171d28',
          opacity: ch.mute ? 0.56 : 1,
        },
      ]}
    >
      <ScrollView
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={s.stripScroll}
        contentContainerStyle={s.stripScrollContent}
      >
        <Pressable
          onPress={onToggleMute}
          style={[
            s.iconBadge,
            {
              backgroundColor: iconBg,
              borderColor: sendMuted ? '#f85149' : accentColor,
            },
          ]}
        >
          <Text style={s.iconBadgeText}>{badge}</Text>
          {sendMuted ? <View style={s.iconMuteSlash} /> : null}
        </Pressable>
        <Text style={s.stripTitle} numberOfLines={2}>
          {primary}
        </Text>
        {secondary ? <Text style={s.stripSub}>{secondary}</Text> : null}
        <View style={s.levelRow}>
          {pcmIndexFromChannel(ch) != null ? (
            <View style={s.vuCol}>
              <Text style={s.vuLabel}>dB</Text>
              <View style={s.vuTrack}>
                <View style={[s.vuFill, { height: vuFill, backgroundColor: vuColor }]} />
              </View>
              <Text style={s.vuValue}>{outputDb.toFixed(1)}</Text>
            </View>
          ) : null}
          <RetornoVerticalFader
            value={send}
            min={0}
            max={4}
            onLiveChange={onSendLive}
            onCommit={onSend}
          />
        </View>
        <Text style={s.scrollCue}>Role para baixo para ver o EQ</Text>
        {lockEq ? (
          <Text style={s.locked}>EQ bloqueado (admin)</Text>
        ) : (
          <View style={s.eqCol}>
            <Text style={s.eqHdr}>
              {pcmIndexFromChannel(ch) != null ? 'EQ deste PCM' : 'EQ'}
            </Text>
            <View style={s.eqRow}>
              <Text style={s.eqLbl}>Graves</Text>
              <RetornoFader
                compact
                value={eqLow}
                min={-12}
                max={12}
                onCommit={(nv) => onEqBand('lowDb', nv)}
              />
            </View>
            <View style={s.eqRow}>
              <Text style={s.eqLbl}>Médios</Text>
              <RetornoFader
                compact
                value={eqMid}
                min={-12}
                max={12}
                onCommit={(nv) => onEqBand('midDb', nv)}
              />
            </View>
            <View style={s.eqRow}>
              <Text style={s.eqLbl}>Agudos</Text>
              <RetornoFader
                compact
                value={eqHigh}
                min={-12}
                max={12}
                onCommit={(nv) => onEqBand('highDb', nv)}
              />
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  )
})

function effectiveEq(
  ch: ChannelStrip,
  musician: MusicianStrip,
  cid: string,
): Eq3 {
  const ear = musician.eqByChannel?.[cid]
  return {
    lowDb: ear?.lowDb ?? ch.eq.lowDb,
    midDb: ear?.midDb ?? ch.eq.midDb,
    highDb: ear?.highDb ?? ch.eq.highDb,
  }
}

type Props = {
  apiBase: string
  token: string
  showfile: Showfile | null
  musician: MusicianStrip | null
  onMusicianUpdated: (m: MusicianStrip) => void
  webViewRef: RefObject<InstanceType<typeof WebView> | null>
  masterGain: number
  onMasterGainChange: (v: number) => void
  /** Nível atual por entrada física PCM (índice 0..N-1). */
  inputLevelsByIndex?: Record<string, number>
}

export function RetornoMixerControls({
  apiBase,
  token,
  showfile,
  musician,
  onMusicianUpdated,
  webViewRef,
  masterGain,
  onMasterGainChange,
  inputLevelsByIndex,
}: Props) {
  const [localSendMutes, setLocalSendMutes] = useState<Record<string, boolean>>({})
  const channelIds = useMemo(() => {
    if (!showfile || !musician) return []
    return retornoMixerChannelOrder(showfile, musician)
  }, [showfile, musician])

  const sendThrottleAt = useRef<Record<string, number>>({})
  const muteTapAt = useRef<Record<string, number>>({})

  useEffect(() => {
    setLocalSendMutes(musician?.sendMutes ?? {})
  }, [musician?.id, musician?.sendMutes])

  const patchSend = useCallback(
    async (key: string, value: number) => {
      if (!musician) return
      const g = Math.max(0, Math.min(4, value))
      const base = apiBase.trim().replace(/\/$/, '')
      try {
        const r = await fetch(
          `${base}/api/showfile/musician/${musician.id}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sendGains: { [key]: g } }),
          },
        )
        if (!r.ok) return
        const m = (await r.json()) as MusicianStrip
        onMusicianUpdated(m)
      } catch {
        /* ignore */
      }
    },
    [apiBase, token, musician, onMusicianUpdated],
  )

  /** PATCH durante o arrasto (~12/s por faixa). */
  const patchSendLive = useCallback(
    async (key: string, value: number) => {
      if (!musician) return
      const now = Date.now()
      const last = sendThrottleAt.current[key] ?? 0
      if (now - last < 40) return
      sendThrottleAt.current[key] = now
      const g = Math.max(0, Math.min(4, value))
      const base = apiBase.trim().replace(/\/$/, '')
      try {
        await fetch(`${base}/api/showfile/musician/${musician.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sendGains: { [key]: g } }),
        })
      } catch {
        /* ignore */
      }
    },
    [apiBase, musician, token],
  )

  const patchSendMute = useCallback(
    async (key: string, muted: boolean) => {
      if (!musician) return
      const now = Date.now()
      const last = muteTapAt.current[key] ?? 0
      if (now - last < 100) return
      muteTapAt.current[key] = now
      setLocalSendMutes((prev) => ({ ...prev, [key]: muted }))
      const label = `mute:${key}:${now}`
      console.time(label)
      const base = apiBase.trim().replace(/\/$/, '')
      try {
        const r = await fetch(`${base}/api/showfile/musician/${musician.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sendMutes: { [key]: muted } }),
        })
        if (!r.ok) {
          setLocalSendMutes((prev) => ({ ...prev, [key]: !muted }))
          console.timeEnd(label)
          return
        }
        const m = (await r.json()) as MusicianStrip
        console.timeEnd(label)
        onMusicianUpdated(m)
      } catch {
        setLocalSendMutes((prev) => ({ ...prev, [key]: !muted }))
        console.timeEnd(label)
      }
    },
    [apiBase, musician, onMusicianUpdated, token],
  )

  const patchEqBand = useCallback(
    async (
      channelId: string,
      band: keyof Eq3,
      valueDb: number,
    ) => {
      if (!musician) return
      const base = apiBase.trim().replace(/\/$/, '')
      try {
        const r = await fetch(
          `${base}/api/showfile/musician/${musician.id}`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              eqByChannel: { [channelId]: { [band]: valueDb } },
            }),
          },
        )
        if (!r.ok) return
        const m = (await r.json()) as MusicianStrip
        onMusicianUpdated(m)
      } catch {
        /* ignore */
      }
    },
    [apiBase, token, musician, onMusicianUpdated],
  )

  const masterWebThrottle = useRef(0)

  const pushMasterToWeb = useCallback(
    (v: number) => {
      const g = Math.max(0, Math.min(4, v))
      webViewRef.current?.injectJavaScript(
        `typeof window.__inearSetMaster==='function'&&window.__inearSetMaster(${g});true;`,
      )
    },
    [webViewRef],
  )

  const pushMasterToWebLive = useCallback(
    (v: number) => {
      const now = Date.now()
      if (now - masterWebThrottle.current < 80) return
      masterWebThrottle.current = now
      pushMasterToWeb(v)
    },
    [pushMasterToWeb],
  )

  if (!showfile) {
    return <Text style={s.hint}>A carregar mix (showfile)…</Text>
  }

  if (!musician) {
    return (
      <Text style={s.warn}>
        Utilizador do token não corresponde a um músico neste showfile.
      </Text>
    )
  }

  if (showfile.channels.length === 0) {
    return (
      <View style={s.boxWarn}>
        <Text style={s.warn}>
          Ainda não há canais no mix. O áudio da mesa (ex.: Avid Fast Track ligado ao{' '}
          <Text style={s.bold}>Mac</Text>) é captado no PC; no painel admin do desktop
          usa &quot;Sincronizar faixas&quot; no Mac (dispositivo agregado, N canais) para criar
          as entradas.
          O telemóvel só controla sends e EQ do teu ouvido — não vê a interface USB do Mac
          como entrada física.
        </Text>
      </View>
    )
  }

  return (
    <View style={s.wrap}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={s.hScroll}
        contentContainerStyle={s.hScrollInner}
      >
        {musician.scope.groupIds.map((gid) => {
          const g = showfile.groups.find((x) => x.id === gid)
          if (!g) return null
          const v = musician.sendGains[gid] ?? 1
          return (
            <View key={gid} style={[s.strip, s.stripGroup]}>
              <Text style={s.stripTitle} numberOfLines={2}>
                {g.name}
              </Text>
              <Text style={s.stripSub}>Grupo</Text>
              <RetornoVerticalFader
                value={v}
                min={0}
                max={4}
                onLiveChange={(nv) => patchSendLive(gid, nv)}
                onCommit={(nv) => void patchSend(gid, nv)}
              />
            </View>
          )
        })}

        {channelIds.map((cid) => {
          const ch = showfile.channels.find((c) => c.id === cid)
          if (!ch) return null
          const send = musician.sendGains[cid] ?? 1
          const sendMuted = Boolean(localSendMutes[cid] ?? musician.sendMutes?.[cid])
          const eq = effectiveEq(ch, musician, cid)
          const accentColor = channelAccentColor(ch)
          return (
            <RetornoMixerChannelStrip
              key={cid}
              ch={ch}
              send={send}
              eqLow={eq.lowDb}
              eqMid={eq.midDb}
              eqHigh={eq.highDb}
              inputLevel={typeof ch.captureInputIndex === 'number'
                ? inputLevelsByIndex?.[String(ch.captureInputIndex)] ?? 0
                : 0}
              accentColor={accentColor}
              sendMuted={sendMuted}
              lockEq={ch.lockEq}
              onSendLive={(nv) => patchSendLive(cid, nv)}
              onSend={(nv) => void patchSend(cid, nv)}
              onToggleMute={() => void patchSendMute(cid, !sendMuted)}
              onEqBand={(band, nv) => void patchEqBand(cid, band, nv)}
            />
          )
        })}

        <View style={[s.strip, s.stripMaster]}>
          <Text style={s.stripTitle}>MASTER</Text>
          <Text style={s.stripSub}>Retorno local</Text>
          <RetornoVerticalFader
            value={masterGain}
            min={0}
            max={2}
            onLiveChange={(v) => {
              onMasterGainChange(v)
              pushMasterToWebLive(v)
            }}
            onCommit={(v) => {
              onMasterGainChange(v)
              pushMasterToWeb(v)
            }}
          />
        </View>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: {
    marginHorizontal: 6,
    marginBottom: 8,
  },
  syncWarnBox: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#9e6a03',
    backgroundColor: '#342c1d',
  },
  syncWarn: { color: '#f0883e', fontSize: 11, lineHeight: 16 },
  syncWarnCode: { fontFamily: 'monospace', color: '#ffa657' },
  syncWarnEm: { fontWeight: '700', color: '#ffa657' },
  boxWarn: { paddingHorizontal: 12, paddingBottom: 8 },
  hint: { color: '#8b949e', paddingHorizontal: 12, paddingBottom: 8 },
  warn: { color: '#f0883e', fontSize: 12, lineHeight: 18 },
  bold: { fontWeight: '700', color: '#f0883e' },
  hScroll: { flexGrow: 0, minHeight: 240 },
  hScrollInner: {
    paddingVertical: 4,
    paddingRight: 12,
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  strip: {
    width: 148,
    marginRight: 8,
    height: 258,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 16,
    backgroundColor: '#171d28',
    borderWidth: 1,
    borderColor: '#2a3445',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  stripScroll: {
    width: '100%',
    flex: 1,
  },
  stripScrollContent: {
    alignItems: 'center',
    paddingBottom: 12,
  },
  stripGroup: {
    borderColor: '#6e40c9',
    backgroundColor: '#21172c',
  },
  stripMaster: {
    width: 82,
    borderColor: '#2f81f7',
    backgroundColor: '#102440',
  },
  stripTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    minHeight: 20,
  },
  stripSub: {
    color: '#94a3b8',
    fontSize: 10,
    marginBottom: 6,
    textAlign: 'center',
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  iconBadgeText: {
    color: '#081018',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.6,
  },
  iconMuteSlash: {
    position: 'absolute',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#f85149',
    transform: [{ rotate: '-45deg' }],
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 8,
  },
  scrollCue: {
    color: '#7d8590',
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 10,
  },
  vuCol: {
    alignItems: 'center',
    width: 24,
  },
  vuWrap: {
    width: 24,
    marginBottom: 8,
  },
  vuHeadRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  vuLabel: {
    color: '#6e7681',
    fontSize: 9,
    fontWeight: '600',
  },
  vuValue: {
    color: '#8b949e',
    fontSize: 9,
    fontVariant: ['tabular-nums'],
  },
  vuTrack: {
    width: 14,
    height: 106,
    borderRadius: 999,
    backgroundColor: '#0f141b',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2c3747',
    marginVertical: 4,
  },
  vuFill: {
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#2ea043',
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  locked: {
    color: '#8b949e',
    fontSize: 9,
    marginTop: 6,
    textAlign: 'center',
  },
  eqCol: {
    width: '100%',
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: '#2a3445',
    paddingTop: 6,
  },
  eqHdr: {
    color: '#79c0ff',
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 6,
    alignSelf: 'center',
  },
  eqRow: { width: '100%', marginBottom: 6 },
  eqLbl: {
    color: '#98a6bc',
    fontSize: 9,
    marginBottom: 3,
    fontWeight: '700',
  },
})
