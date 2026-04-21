import type { ChannelStrip, Eq3, MusicianStrip, Showfile } from '@inear/protocol'
import {
  channelAccentColor,
  channelIconBadge,
  retornoMixerChannelOrder,
} from '@inear/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

export type NetworkQualityUi = {
  level: 'good' | 'warn' | 'bad'
  rttMs: number | null
  jitterMs?: number | null
  gapsPerMinute?: number
  hint?: string
}

function panShortLabel(pan: number): string {
  const p = Math.max(-1, Math.min(1, pan))
  if (p < -0.35) return 'L'
  if (p > 0.35) return 'R'
  return 'C'
}

function groupBadgeLabel(sf: Showfile, channelId: string): string | null {
  const idx = sf.groups.findIndex((g) => g.channelIds.includes(channelId))
  if (idx < 0) return null
  return `G${String(idx + 1).padStart(2, '0')}`
}

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
  /** Retorno WebSocket/Web Audio ativo (para LED “power”). */
  streamConnected?: boolean
  /** Medidor agregado no servidor (GET /api/network-quality). */
  networkQuality?: NetworkQualityUi | null
  /** Chamado ao mudar send/EQ local — o pai pode acelerar o poll do showfile. */
  onLocalMixInteraction?: () => void
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
  streamConnected = false,
  networkQuality = null,
  onLocalMixInteraction,
}: Props) {
  const [mixerTab, setMixerTab] = useState<'channels' | 'groups'>('channels')
  const [expandedFxId, setExpandedFxId] = useState<string | null>(null)
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
        onLocalMixInteraction?.()
      } catch {
        /* ignore */
      }
    },
    [apiBase, token, musician, onLocalMixInteraction, onMusicianUpdated],
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
        onLocalMixInteraction?.()
      } catch {
        setLocalSendMutes((prev) => ({ ...prev, [key]: !muted }))
        console.timeEnd(label)
      }
    },
    [apiBase, musician, onLocalMixInteraction, onMusicianUpdated, token],
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
        onLocalMixInteraction?.()
      } catch {
        /* ignore */
      }
    },
    [apiBase, token, musician, onLocalMixInteraction, onMusicianUpdated],
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

  const netDot =
    networkQuality == null
      ? '#484f58'
      : networkQuality.level === 'good'
        ? '#39ff14'
        : networkQuality.level === 'warn'
          ? '#d29922'
          : '#f85149'

  return (
    <View style={s.wrap}>
      <View style={s.topBar}>
        <Pressable style={s.iconBtn} hitSlop={8}>
          <Text style={s.iconBtnTxt}>☰</Text>
        </Pressable>
        <View style={s.segment}>
          <Pressable
            onPress={() => setMixerTab('channels')}
            style={[s.segBtn, mixerTab === 'channels' && s.segBtnOn]}
          >
            <Text style={[s.segTxt, mixerTab === 'channels' && s.segTxtOn]}>
              Canais
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMixerTab('groups')}
            style={[s.segBtn, mixerTab === 'groups' && s.segBtnOn]}
          >
            <Text style={[s.segTxt, mixerTab === 'groups' && s.segTxtOn]}>
              Grupos
            </Text>
          </Pressable>
        </View>
        <View style={s.topBarRight}>
          <Text style={s.powerIcon}>⏻</Text>
          <View
            style={[
              s.powerLed,
              { backgroundColor: streamConnected ? '#2ea043' : '#30363d' },
            ]}
          />
          <View style={[s.netDot, { backgroundColor: netDot }]} />
        </View>
      </View>
      {networkQuality ? (
        <Text style={s.netHint} numberOfLines={2}>
          {networkQuality.hint ?? ''}
          {networkQuality.rttMs != null
            ? ` · RTT ~${networkQuality.rttMs} ms`
            : ''}
        </Text>
      ) : null}

      {mixerTab === 'groups' ? (
        <ScrollView
          style={s.listScroll}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {musician.scope.groupIds.length === 0 ? (
            <Text style={s.groupsEmpty}>
              Sem subgrupos no teu escopo. O técnico pode associar um Aux / grupo no
              desktop para misturares só esse bus com o teu ouvido.
            </Text>
          ) : (
            musician.scope.groupIds.map((gid) => {
              const g = showfile.groups.find((x) => x.id === gid)
              if (!g) return null
              const v = musician.sendGains[gid] ?? 1
              const gm = Boolean(
                localSendMutes[gid] ?? musician.sendMutes?.[gid],
              )
              return (
                <View key={gid} style={s.groupCard}>
                  <View style={s.rowTop}>
                    <Text style={s.groupTitle}>{g.name}</Text>
                    <Text style={s.volPill}>Vol {Math.round(v * 100)}%</Text>
                  </View>
                  <RetornoFader
                    value={v}
                    min={0}
                    max={4}
                    onCommit={(nv) => void patchSend(gid, nv)}
                  />
                  <View style={s.rowActions}>
                    <Pressable
                      style={[s.msBtn, gm && s.msBtnOn]}
                      onPress={() => void patchSendMute(gid, !gm)}
                    >
                      <Text style={s.msBtnTxt}>M</Text>
                    </Pressable>
                  </View>
                </View>
              )
            })
          )}
        </ScrollView>
      ) : (
        <ScrollView
          style={s.listScroll}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {channelIds.map((cid, idx) => {
            const ch = showfile.channels.find((c) => c.id === cid)
            if (!ch) return null
            const send = musician.sendGains[cid] ?? 1
            const sendMuted = Boolean(
              localSendMutes[cid] ?? musician.sendMutes?.[cid],
            )
            const eq = effectiveEq(ch, musician, cid)
            const accentColor = channelAccentColor(ch)
            const { primary } = stripTitles(ch)
            const badge = channelIconBadge(ch.icon)
            const gBadge = groupBadgeLabel(showfile, cid)
            const num = String(idx + 1).padStart(2, '0')
            const expanded = expandedFxId === cid
            return (
              <View key={cid} style={[s.channelCard, { borderLeftColor: accentColor }]}>
                <View style={s.channelRow}>
                  <View style={s.channelLeft}>
                    <Text style={s.chNum}>{num}</Text>
                    <View
                      style={[
                        s.chIcon,
                        {
                          backgroundColor: sendMuted
                            ? lightenHexColor(accentColor, 0.5)
                            : accentColor,
                        },
                      ]}
                    >
                      <Text style={s.chIconTxt}>{badge}</Text>
                    </View>
                    <View style={s.chTitles}>
                      <Text style={s.chName} numberOfLines={1}>
                        {primary}
                      </Text>
                      <View style={s.chMeta}>
                        {gBadge ? (
                          <Text style={[s.gBadge, { color: accentColor }]}>
                            {gBadge}
                          </Text>
                        ) : (
                          <Text style={s.gBadgeMuted}>—</Text>
                        )}
                      </View>
                    </View>
                  </View>
                  <View style={s.msFx}>
                    <Pressable
                      style={[s.msBtn, sendMuted && s.msBtnOn]}
                      onPress={() => void patchSendMute(cid, !sendMuted)}
                    >
                      <Text style={s.msBtnTxt}>M</Text>
                    </Pressable>
                    <View style={[s.msBtn, s.msBtnDisabled]}>
                      <Text style={s.msBtnTxtDim}>S</Text>
                    </View>
                    <Pressable
                      style={[s.msBtn, expanded && s.msBtnOn]}
                      onPress={() =>
                        setExpandedFxId((x) => (x === cid ? null : cid))
                      }
                    >
                      <Text style={s.msBtnTxt}>FX</Text>
                    </Pressable>
                  </View>
                  <View style={s.faderCol}>
                    <RetornoFader
                      value={send}
                      min={0}
                      max={4}
                      onCommit={(nv) => void patchSend(cid, nv)}
                    />
                    <Text style={[s.volReadout, { color: accentColor }]}>
                      Vol {Math.round(send * 100)}%
                    </Text>
                  </View>
                </View>
                <View style={s.panRow}>
                  <Text style={s.panLbl}>Pan (mesa)</Text>
                  <Text style={[s.panVal, { color: accentColor }]}>
                    {panShortLabel(ch.pan)}
                  </Text>
                </View>
                {expanded ? (
                  ch.lockEq ? (
                    <Text style={s.eqLocked}>EQ bloqueado pelo técnico</Text>
                  ) : (
                    <View style={s.eqBlock}>
                      <Text style={s.eqHdrSm}>EQ neste ouvido</Text>
                      <View style={s.eqRowSm}>
                        <Text style={s.eqLblSm}>L</Text>
                        <RetornoFader
                          compact
                          value={eq.lowDb}
                          min={-12}
                          max={12}
                          onCommit={(nv) => void patchEqBand(cid, 'lowDb', nv)}
                        />
                      </View>
                      <View style={s.eqRowSm}>
                        <Text style={s.eqLblSm}>M</Text>
                        <RetornoFader
                          compact
                          value={eq.midDb}
                          min={-12}
                          max={12}
                          onCommit={(nv) => void patchEqBand(cid, 'midDb', nv)}
                        />
                      </View>
                      <View style={s.eqRowSm}>
                        <Text style={s.eqLblSm}>H</Text>
                        <RetornoFader
                          compact
                          value={eq.highDb}
                          min={-12}
                          max={12}
                          onCommit={(nv) =>
                            void patchEqBand(cid, 'highDb', nv)
                          }
                        />
                      </View>
                    </View>
                  )
                ) : null}
              </View>
            )
          })}
        </ScrollView>
      )}

      <View style={s.masterRow}>
        <Text style={s.masterLbl}>MASTER</Text>
        <View style={s.masterFader}>
          <RetornoVerticalFader
            value={masterGain}
            min={0}
            max={2}
            onLiveChange={(v) => {
              onMasterGainChange(v)
              pushMasterToWebLive(v)
              onLocalMixInteraction?.()
            }}
            onCommit={(v) => {
              onMasterGainChange(v)
              pushMasterToWeb(v)
              onLocalMixInteraction?.()
            }}
          />
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: {
    marginHorizontal: 6,
    marginBottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f2a3a',
    backgroundColor: '#0a1018',
    padding: 10,
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  iconBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#273446',
    backgroundColor: '#131a26',
  },
  iconBtnTxt: { color: '#e6edf3', fontSize: 16, fontWeight: '800' },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#0f1621',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#33445d',
    overflow: 'hidden',
  },
  segBtn: { paddingVertical: 8, paddingHorizontal: 17 },
  segBtnOn: { backgroundColor: '#1e3147' },
  segTxt: { color: '#8fa1b7', fontSize: 13, fontWeight: '800' },
  segTxtOn: { color: '#f0f6fc' },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  powerIcon: { color: '#2ea043', fontSize: 18, fontWeight: '900' },
  powerLed: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  netDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#30363d',
  },
  netHint: {
    color: '#9ab0c8',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  listScroll: { maxHeight: 450 },
  groupsEmpty: {
    color: '#8b949e',
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
  },
  groupCard: {
    backgroundColor: '#101722',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#6e40c9',
    padding: 12,
    marginBottom: 10,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  groupTitle: { color: '#e6edf3', fontSize: 15, fontWeight: '800' },
  volPill: {
    color: '#d2a8ff',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowActions: { flexDirection: 'row', marginTop: 8, gap: 8 },
  channelCard: {
    backgroundColor: '#0f151f',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#223143',
    borderLeftWidth: 3,
    padding: 11,
    marginBottom: 11,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  channelLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  chNum: {
    color: '#90a4bb',
    fontSize: 11,
    fontWeight: '800',
    width: 22,
    fontVariant: ['tabular-nums'],
  },
  chIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#212c3b',
  },
  chIconTxt: { color: '#081018', fontWeight: '900', fontSize: 11 },
  chTitles: { flex: 1, minWidth: 0 },
  chName: { color: '#f0f6fc', fontSize: 14, fontWeight: '800' },
  chMeta: { flexDirection: 'row', marginTop: 2 },
  gBadge: { fontSize: 11, fontWeight: '800' },
  gBadgeMuted: { color: '#484f58', fontSize: 11 },
  msFx: { flexDirection: 'row', gap: 4 },
  msBtn: {
    minWidth: 32,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: '#1a2331',
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
  },
  msBtnOn: { borderColor: '#f85149', backgroundColor: '#372325' },
  msBtnDisabled: { opacity: 0.45 },
  msBtnTxt: { color: '#e6edf3', fontSize: 12, fontWeight: '900' },
  msBtnTxtDim: { color: '#6e7681', fontSize: 12, fontWeight: '800' },
  faderCol: { width: 144 },
  volReadout: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 4,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  panRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 9,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#21262d',
  },
  panLbl: { color: '#8ea1b7', fontSize: 10 },
  panVal: { fontSize: 12, fontWeight: '800' },
  eqLocked: { color: '#8b949e', fontSize: 11, marginTop: 8 },
  eqBlock: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#21262d',
    backgroundColor: '#0b1018',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  eqHdrSm: {
    color: '#79c0ff',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
  },
  eqRowSm: { marginBottom: 6 },
  eqLblSm: {
    color: '#98a6bc',
    fontSize: 10,
    marginBottom: 2,
    fontWeight: '700',
  },
  masterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#21262d',
    gap: 12,
  },
  masterLbl: {
    color: '#58a6ff',
    fontSize: 13,
    fontWeight: '900',
    width: 72,
  },
  masterFader: { height: 210 },
})
