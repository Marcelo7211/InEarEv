import type {
  ChannelStrip as ChannelStripData,
  CompressorSettings,
  DelaySettings,
  MusicianStrip,
  PeqSettings,
  ReverbSettings,
  Showfile,
} from '@inear/protocol'
import {
  channelAccentColor,
  retornoMixerChannelOrder,
} from '@inear/protocol'
import {
  consolePalette,
  consoleRadius,
  consoleSpacing,
  consoleType,
} from '@inear/design-system'
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
import {
  ChannelStrip,
  FxModalMobile,
  LedButton,
  Meter,
  VerticalFader,
  type CompressorUi,
  type DelayUi,
  type PeqBandUi,
  type ReverbUi,
} from './components'

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

function pcmIndexFromChannel(ch: ChannelStripData): number | null {
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

/** Título principal + linha de ajuda: prioriza «Entrada PCM n» para faixas do agregado. */
function stripTitles(ch: ChannelStripData): { primary: string; secondary: string } {
  const legacySubtitle = (): string => {
    if (typeof ch.captureInputIndex === 'number' && Number.isFinite(ch.captureInputIndex)) {
      return `IN ${ch.captureInputIndex}`
    }
    if (ch.sourceTap === 'L') return 'Mix L'
    if (ch.sourceTap === 'R') return 'Mix R'
    if (ch.sourceTap === 'sum') return 'Sum L+R'
    return ''
  }
  const pcm = pcmIndexFromChannel(ch)
  if (pcm != null && /^if_\d+$/.test(ch.id)) {
    const customName = ch.name && ch.name.trim() ? ch.name.trim() : ''
    return {
      primary:
        customName && !/^if_\d+$/i.test(customName)
          ? customName
          : `IN ${pcm}`,
      secondary: `IN ${pcm}`,
    }
  }
  if (pcm != null) {
    return {
      primary: ch.name || `IN ${pcm}`,
      secondary: `IN ${pcm}`,
    }
  }
  return { primary: ch.name, secondary: legacySubtitle() }
}

export type NetworkQualityUi = {
  level: 'good' | 'warn' | 'bad'
  rttMs: number | null
  jitterMs?: number | null
  gapsPerMinute?: number
  estimatedE2eMs?: number | null
  estimatedE2eP95Ms?: number | null
  aheadP95Ms?: number | null
  queueDepthP95?: number | null
  sampleCount?: number
  slaBreaches?: number
  slaUnder1s?: boolean
  recommendations?: string[]
  hint?: string
}

export type AudioInputLevelsUi = {
  receiving: boolean
  levelsByIndex: Record<string, number>
}

function defaultPeqSettings(): PeqSettings {
  return {
    enabled: true,
    bands: [
      { type: 'hpf', enabled: true, freqHz: 80, q: 0.707, gainDb: 0 },
      { type: 'bell', enabled: true, freqHz: 250, q: 1.0, gainDb: 0 },
      { type: 'bell', enabled: true, freqHz: 800, q: 1.0, gainDb: 0 },
      { type: 'bell', enabled: true, freqHz: 2500, q: 1.0, gainDb: 0 },
      { type: 'highshelf', enabled: true, freqHz: 9000, q: 0.707, gainDb: 0 },
      { type: 'lpf', enabled: false, freqHz: 18000, q: 0.707, gainDb: 0 },
    ],
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
  audioInputLevels?: AudioInputLevelsUi | null
  /** Retorno WebSocket/Web Audio ativo (para LED "power"). */
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
  audioInputLevels = null,
  streamConnected = false,
  networkQuality = null,
  onLocalMixInteraction,
}: Props) {
  const [mixerTab, setMixerTab] = useState<'channels' | 'groups' | 'overview'>(
    'channels',
  )
  /** Canal cujo modal de FX está aberto. */
  const [fxModalChannelId, setFxModalChannelId] = useState<string | null>(null)
  const [localSendMutes, setLocalSendMutes] = useState<Record<string, boolean>>({})
  const [bank, setBank] = useState(0)
  const channelsById = useMemo(() => {
    if (!showfile) return new Map<string, ChannelStripData>()
    return new Map(showfile.channels.map((c) => [c.id, c]))
  }, [showfile])
  const channelIds = useMemo(() => {
    if (!showfile || !musician) return []
    return retornoMixerChannelOrder(showfile, musician)
  }, [showfile, musician])
  const pageSize = 8
  const bankCount = Math.max(1, Math.ceil(channelIds.length / pageSize))
  const pagedChannelIds = useMemo(() => {
    const safe = Math.max(0, Math.min(bank, bankCount - 1))
    const start = safe * pageSize
    return channelIds.slice(start, start + pageSize)
  }, [bank, bankCount, channelIds])
  const levelsByIndex = audioInputLevels?.levelsByIndex ?? {}

  useEffect(() => {
    setBank(0)
  }, [musician?.id])

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

  const patchSendLive = useCallback(
    async (key: string, value: number) => {
      if (!musician) return
      const now = Date.now()
      const last = sendThrottleAt.current[key] ?? 0
      if (now - last < 60) return
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
          return
        }
        const m = (await r.json()) as MusicianStrip
        onMusicianUpdated(m)
        onLocalMixInteraction?.()
      } catch {
        setLocalSendMutes((prev) => ({ ...prev, [key]: !muted }))
      }
    },
    [apiBase, musician, onLocalMixInteraction, onMusicianUpdated, token],
  )

  const patchBypass = useCallback(
    async (channelId: string, next: boolean) => {
      if (!musician) return
      const base = apiBase.trim().replace(/\/$/, '')
      try {
        const r = await fetch(`${base}/api/showfile/musician/${musician.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fxBypassByChannel: { [channelId]: next } }),
        })
        if (!r.ok) return
        const m = (await r.json()) as MusicianStrip
        onMusicianUpdated(m)
        onLocalMixInteraction?.()
      } catch {
        /* ignore */
      }
    },
    [apiBase, musician, onLocalMixInteraction, onMusicianUpdated, token],
  )

  const patchMusicianBus = useCallback(
    async (body: Record<string, unknown>) => {
      if (!musician) return
      const base = apiBase.trim().replace(/\/$/, '')
      try {
        const r = await fetch(`${base}/api/showfile/musician/${musician.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        if (!r.ok) return
        const m = (await r.json()) as MusicianStrip
        onMusicianUpdated(m)
        onLocalMixInteraction?.()
      } catch {
        /* ignore */
      }
    },
    [apiBase, musician, onLocalMixInteraction, onMusicianUpdated, token],
  )

  const patchMasterComp = useCallback(
    (next: CompressorSettings) => void patchMusicianBus({ masterComp: next }),
    [patchMusicianBus],
  )
  const patchMasterDelay = useCallback(
    (next: DelaySettings) => void patchMusicianBus({ masterDelay: next }),
    [patchMusicianBus],
  )
  const patchMasterReverb = useCallback(
    (next: ReverbSettings) => void patchMusicianBus({ masterReverb: next }),
    [patchMusicianBus],
  )

  const patchPeq = useCallback(
    async (channelId: string, nextPeq: PeqSettings) => {
      if (!musician) return
      const base = apiBase.trim().replace(/\/$/, '')
      try {
        const r = await fetch(`${base}/api/showfile/musician/${musician.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ peqByChannel: { [channelId]: nextPeq } }),
        })
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
          Ainda não há canais no mix. O áudio da mesa é captado no PC; no painel
          admin do desktop usa &quot;Sincronizar faixas&quot; (dispositivo agregado, N
          canais) para criar as entradas.
        </Text>
      </View>
    )
  }

  const netDot =
    networkQuality == null
      ? consolePalette.textLo
      : networkQuality.level === 'good'
        ? consolePalette.ledGreen
        : networkQuality.level === 'warn'
          ? consolePalette.ledAmber
          : consolePalette.ledRed

  const fxModalChannel = fxModalChannelId
    ? channelsById.get(fxModalChannelId) ?? null
    : null
  const fxModalAccent = fxModalChannel ? channelAccentColor(fxModalChannel) : consolePalette.ledGreen
  const fxModalPeq = fxModalChannelId
    ? (musician.peqByChannel?.[fxModalChannelId] ?? null)
    : null
  const fxModalBypassed = fxModalChannelId
    ? Boolean(musician.fxBypassByChannel?.[fxModalChannelId])
    : false

  return (
    <View style={s.wrap}>
      {/* CABEÇALHO — barra do gabinete: marca, segmento de modo, LEDs power/net */}
      <View style={s.topBar}>
        <View style={s.brandBlock}>
          <View style={[s.brandLed, { backgroundColor: consolePalette.ledGreen }]} />
          <Text style={s.brandTxt}>STAGE • MIX</Text>
        </View>
        <View style={s.segment}>
          <SegBtn
            label="Canais"
            active={mixerTab === 'channels'}
            onPress={() => setMixerTab('channels')}
          />
          <SegBtn
            label="Grupos"
            active={mixerTab === 'groups'}
            onPress={() => setMixerTab('groups')}
          />
          <SegBtn
            label="Overview"
            active={mixerTab === 'overview'}
            onPress={() => setMixerTab('overview')}
          />
        </View>
        <View style={s.topBarRight}>
          <View style={[s.led, { backgroundColor: streamConnected ? consolePalette.ledGreen : '#1c2531' }]} />
          <Text style={s.ledLbl}>PWR</Text>
          <View style={[s.led, { backgroundColor: netDot }]} />
          <Text style={s.ledLbl}>NET</Text>
        </View>
      </View>

      {networkQuality?.hint ? (
        <Text style={s.netHint} numberOfLines={2}>
          {networkQuality.hint}
          {networkQuality.rttMs != null ? ` · RTT ~${networkQuality.rttMs} ms` : ''}
        </Text>
      ) : null}

      {/* BANCOS — apenas no modo de canais */}
      {mixerTab === 'channels' && bankCount > 1 ? (
        <View style={s.bankRow}>
          {Array.from({ length: bankCount }, (_, i) => i).map((i) => {
            const lo = i * pageSize + 1
            const hi = Math.min((i + 1) * pageSize, channelIds.length)
            return (
              <Pressable
                key={String(i)}
                onPress={() => setBank(i)}
                style={[s.bankBtn, bank === i && s.bankBtnOn]}
              >
                <Text style={[s.bankTxt, bank === i && s.bankTxtOn]}>
                  {lo}-{hi}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}

      {/* CORPO PRINCIPAL */}
      {mixerTab === 'channels' ? (
        <ScrollView
          horizontal
          style={s.stripsScroll}
          contentContainerStyle={s.stripsRow}
          showsHorizontalScrollIndicator
          nestedScrollEnabled
        >
          {pagedChannelIds.map((cid, idx) => {
            const ch = channelsById.get(cid)
            if (!ch) return null
            const send = musician.sendGains[cid] ?? 1
            const sendMuted = Boolean(localSendMutes[cid] ?? musician.sendMutes?.[cid])
            const accent = channelAccentColor(ch)
            const { primary, secondary } = stripTitles(ch)
            const globalIdx = bank * pageSize + idx
            const num = String(globalIdx + 1).padStart(2, '0')
            const expanded = fxModalChannelId === cid
            const pcm = pcmIndexFromChannel(ch)
            const lvl = pcm != null ? Math.max(0, Math.min(1, Number(levelsByIndex[String(pcm)]) || 0)) : 0
            return (
              <ChannelStrip
                key={cid}
                accent={accent}
                number={num}
                name={primary}
                subtitle={secondary}
                sendValue={send}
                onSendCommit={(v) => void patchSend(cid, v)}
                onSendLive={(v) => void patchSendLive(cid, v)}
                muted={sendMuted}
                onToggleMute={() => void patchSendMute(cid, !sendMuted)}
                soloAvailable={false}
                fxOn={expanded}
                onToggleFx={() => setFxModalChannelId(cid)}
                pan={ch.pan}
                inputLevel={lvl}
              />
            )
          })}
        </ScrollView>
      ) : mixerTab === 'overview' ? (
        <ScrollView
          style={s.overviewScroll}
          contentContainerStyle={s.overviewGrid}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          {channelIds.map((cid, idx) => {
            const ch = channelsById.get(cid)
            if (!ch) return null
            const send = musician.sendGains[cid] ?? 1
            const sendMuted = Boolean(localSendMutes[cid] ?? musician.sendMutes?.[cid])
            const accent = channelAccentColor(ch)
            const { primary } = stripTitles(ch)
            const num = String(idx + 1).padStart(2, '0')
            const pcm = pcmIndexFromChannel(ch)
            const lvl = pcm != null ? Math.max(0, Math.min(1, Number(levelsByIndex[String(pcm)]) || 0)) : 0
            return (
              <Pressable
                key={cid}
                style={[
                  s.miniStrip,
                  { borderColor: sendMuted ? consolePalette.ledRed : consolePalette.borderMetal },
                ]}
                onPress={() => {
                  const targetBank = Math.floor(idx / pageSize)
                  setBank(targetBank)
                  setMixerTab('channels')
                }}
              >
                <View style={[s.miniBar, { backgroundColor: accent }]}>
                  <Text style={s.miniNum}>{num}</Text>
                </View>
                <Text style={s.miniName} numberOfLines={1}>
                  {primary}
                </Text>
                <View style={s.miniMeterRow}>
                  <Meter level={lvl} height={36} width={6} />
                  <Text style={[s.miniVol, { color: accent }]}>
                    {Math.round(send * 100)}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : (
        <ScrollView
          style={s.listScroll}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {musician.scope.groupIds.length === 0 ? (
            <Text style={s.groupsEmpty}>
              Sem subgrupos no teu escopo. O técnico pode associar um Aux/grupo no
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
                    <Text style={s.volPill}>VOL {Math.round(v * 100)}%</Text>
                  </View>
                  <RetornoFader
                    value={v}
                    min={0}
                    max={4}
                    onCommit={(nv) => void patchSend(gid, nv)}
                  />
                  <View style={s.rowActions}>
                    <LedButton
                      label="MUTE"
                      color="red"
                      on={gm}
                      onPress={() => void patchSendMute(gid, !gm)}
                      width={64}
                    />
                  </View>
                </View>
              )
            })
          )}
        </ScrollView>
      )}

      {/* MODAL DE FX (PEQ gráfico + Comp/Delay/Reverb em accordions + Bypass). */}
      <FxModalMobile
        visible={fxModalChannelId != null && fxModalChannel != null}
        channelName={fxModalChannel?.name ?? ''}
        channelId={fxModalChannelId ?? ''}
        accent={fxModalAccent}
        peq={fxModalPeq as { enabled?: boolean; bands?: PeqBandUi[] } | null}
        comp={(musician.masterComp as CompressorUi | undefined) ?? null}
        delay={(musician.masterDelay as DelayUi | undefined) ?? null}
        reverb={(musician.masterReverb as ReverbUi | undefined) ?? null}
        bypassed={fxModalBypassed}
        onClose={() => setFxModalChannelId(null)}
        onPeqCommit={(next) => {
          if (!fxModalChannelId) return
          void patchPeq(fxModalChannelId, next as PeqSettings)
        }}
        onPeqLive={(next) => {
          if (!fxModalChannelId) return
          void patchPeq(fxModalChannelId, next as PeqSettings)
        }}
        onCompCommit={(next) => patchMasterComp(next as CompressorSettings)}
        onDelayCommit={(next) => patchMasterDelay(next as DelaySettings)}
        onReverbCommit={(next) => patchMasterReverb(next as ReverbSettings)}
        onToggleBypass={(next) => {
          if (!fxModalChannelId) return
          void patchBypass(fxModalChannelId, next)
        }}
        onCreateDefaultPeq={() => {
          if (!fxModalChannelId) return
          void patchPeq(fxModalChannelId, defaultPeqSettings())
        }}
      />

      {/* FAIXA DE MASTER */}
      <View style={s.masterBar}>
        <View style={s.masterLabelCol}>
          <Text style={s.masterLbl}>MASTER</Text>
          <Text style={s.masterSub}>monitor</Text>
        </View>
        <View style={s.masterFader}>
          <VerticalFader
            value={masterGain}
            min={0}
            max={2}
            accent={consolePalette.ledBlue}
            trackHeight={120}
            resetValue={1}
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

function SegBtn({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} style={[s.segBtn, active && s.segBtnOn]}>
      <Text style={[s.segTxt, active && s.segTxtOn]}>{label}</Text>
    </Pressable>
  )
}


const s = StyleSheet.create({
  wrap: {
    marginHorizontal: 6,
    marginBottom: 8,
    borderRadius: consoleRadius.panel + 4,
    borderWidth: 1,
    borderColor: consolePalette.borderMetal,
    backgroundColor: consolePalette.bgChassis,
    padding: 8,
  },
  boxWarn: { paddingHorizontal: 12, paddingBottom: 8 },
  hint: { color: consolePalette.textMid, paddingHorizontal: 12, paddingBottom: 8 },
  warn: { color: consolePalette.ledAmber, fontSize: 12, lineHeight: 18 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
    backgroundColor: consolePalette.bgPanel,
    borderRadius: consoleRadius.panel,
    borderWidth: 1,
    borderColor: consolePalette.border,
  },
  brandBlock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandLed: {
    width: 7,
    height: 7,
    borderRadius: consoleRadius.led,
    shadowColor: consolePalette.ledGreen,
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  brandTxt: {
    color: consolePalette.textMid,
    fontFamily: consoleType.fontDigit,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: consolePalette.bgRecess,
    borderRadius: consoleRadius.capsule,
    borderWidth: 1,
    borderColor: consolePalette.border,
    overflow: 'hidden',
  },
  segBtn: { paddingVertical: 6, paddingHorizontal: 12 },
  segBtnOn: { backgroundColor: consolePalette.bgScribble },
  segTxt: {
    color: consolePalette.textMid,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  segTxtOn: { color: consolePalette.textHi },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  led: {
    width: 8,
    height: 8,
    borderRadius: consoleRadius.led,
    borderWidth: 1,
    borderColor: '#1c2531',
  },
  ledLbl: {
    color: consolePalette.textLo,
    fontFamily: consoleType.fontDigit,
    fontSize: 8,
    fontWeight: '800',
    marginRight: 4,
    letterSpacing: 0.6,
  },
  netHint: {
    color: consolePalette.textMid,
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 8,
    paddingHorizontal: 4,
  },

  bankRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 2,
    paddingBottom: 8,
  },
  bankBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: consoleRadius.strip,
    borderWidth: 1,
    borderColor: consolePalette.border,
    backgroundColor: consolePalette.bgRecess,
  },
  bankBtnOn: {
    borderColor: consolePalette.ledBlue,
    backgroundColor: consolePalette.ledBlueDim,
  },
  bankTxt: {
    color: consolePalette.textMid,
    fontFamily: consoleType.fontDigit,
    fontSize: 11,
    fontWeight: '800',
  },
  bankTxtOn: { color: consolePalette.textHi },

  stripsScroll: {
    backgroundColor: consolePalette.bgRecess,
    borderRadius: consoleRadius.panel,
    borderWidth: 1,
    borderColor: consolePalette.border,
  },
  stripsRow: {
    flexDirection: 'row',
    gap: consoleSpacing.stripGap,
    padding: 6,
  },

  overviewScroll: {
    backgroundColor: consolePalette.bgRecess,
    borderRadius: consoleRadius.panel,
    borderWidth: 1,
    borderColor: consolePalette.border,
    maxHeight: 360,
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    padding: 6,
  },
  miniStrip: {
    width: 60,
    backgroundColor: consolePalette.bgPanel,
    borderRadius: consoleRadius.strip,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'stretch',
  },
  miniBar: { paddingVertical: 2, alignItems: 'center' },
  miniNum: {
    color: consolePalette.textOnAccent,
    fontFamily: consoleType.fontDigit,
    fontSize: 9,
    fontWeight: '900',
  },
  miniName: {
    color: consolePalette.textHi,
    fontFamily: consoleType.fontScribble,
    fontSize: 9,
    fontWeight: '700',
    paddingHorizontal: 3,
    paddingVertical: 3,
    minHeight: 20,
    textAlign: 'center',
  },
  miniMeterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 3,
    paddingVertical: 3,
    justifyContent: 'space-between',
  },
  miniVol: {
    fontFamily: consoleType.fontDigit,
    fontSize: 9,
    fontWeight: '900',
  },

  listScroll: {
    maxHeight: 380,
    backgroundColor: consolePalette.bgRecess,
    borderRadius: consoleRadius.panel,
    borderWidth: 1,
    borderColor: consolePalette.border,
    padding: 6,
  },
  groupsEmpty: {
    color: consolePalette.textMid,
    fontSize: 12,
    lineHeight: 18,
    padding: 12,
  },
  groupCard: {
    backgroundColor: consolePalette.bgPanel,
    borderRadius: consoleRadius.panel,
    borderWidth: 1,
    borderColor: consolePalette.border,
    borderLeftWidth: 4,
    borderLeftColor: consolePalette.ledBlue,
    padding: 10,
    marginBottom: 8,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  groupTitle: {
    color: consolePalette.textHi,
    fontFamily: consoleType.fontScribble,
    fontSize: 13,
    fontWeight: '800',
  },
  volPill: {
    color: consolePalette.ledBlue,
    fontFamily: consoleType.fontDigit,
    fontSize: 11,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  rowActions: { flexDirection: 'row', marginTop: 8, gap: 8 },

  masterBar: {
    marginTop: 10,
    paddingTop: 10,
    paddingHorizontal: 10,
    paddingBottom: 14,
    backgroundColor: consolePalette.bgPanel,
    borderRadius: consoleRadius.panel,
    borderWidth: 1,
    borderColor: consolePalette.borderHi,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  masterLabelCol: { width: 90 },
  masterLbl: {
    color: consolePalette.ledBlue,
    fontFamily: consoleType.fontDigit,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  masterSub: {
    color: consolePalette.textLo,
    fontFamily: consoleType.fontUi,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  masterFader: { flex: 1, height: 140 },
})
