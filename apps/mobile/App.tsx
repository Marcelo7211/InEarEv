import { type MusicianStrip, type Showfile } from '@inear/protocol'
import { StatusBar as ExpoStatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { WebView } from 'react-native-webview'

import {
  RetornoMixerControls,
  parseJwtSub,
  type NetworkQualityUi,
} from './RetornoMixerControls'
import { RetornoNativeConsole } from './RetornoNativeConsole'
import { nativeRetornoAudio } from './nativeRetornoAudio'
import {
  buildStreamRetornoPlayerHtml,
  type StreamRetornoLatency,
} from './streamRetornoPlayerHtml'

function mergeMusicianInShowfile(
  sf: Showfile,
  updated: MusicianStrip,
): Showfile {
  return {
    ...sf,
    musicians: sf.musicians.map((x) =>
      x.id === updated.id ? updated : x,
    ),
  }
}

type Role = 'admin' | 'musician'

function initialApiBase(): string {
  return ''
}

function normalizeApiBase(raw: string): string {
  const base = raw.trim().replace(/\/$/, '')
  if (!base) return ''
  if (base.startsWith('http://') || base.startsWith('https://')) return base
  const withPort = /:\d+$/.test(base) ? base : `${base}:3847`
  return `http://${withPort}`
}

function formatApiFieldValue(raw: string): string {
  const base = raw.trim().replace(/\/$/, '')
  if (!base) return ''
  return base.replace(/^https?:\/\//, '')
}

/** UI Vite (mesmo host que a API, porta 5173). Requer `npm run dev` no desktop. */
type PcAudioStatus = {
  configured: boolean
  receiving: boolean
  audioCaptureSource?: 'env' | 'avfoundation' | 'dshow' | 'none'
  captureAvfoundationAudioIndex?: number | null
  captureAvfoundationMode?: 'auto' | 'manual' | 'off'
  captureAvfoundationAutoPicked?: boolean
  winDshowCaptureMode?: 'single' | 'aggregate'
  winDshowAggregateInputCount?: number
  winDshowAggregateActive?: boolean
}

type CaptureAssignMode = 'sum' | 'L' | 'R'

type CaptureInputMatrix = {
  gainL: number
  gainR: number
  assign: Record<string, CaptureAssignMode>
  gainByIndex?: Record<string, number>
}

type AudioCaptureDevicesRes = {
  platform: string
  ffmpegFound?: boolean
  usingBundledWinFfmpeg?: boolean
  ffprobeFound?: boolean
  dshowListDiag?: {
    exitCode: number | null
    combinedLen: number
    outputTail: string
    ffmpegDevicesExitCode?: number | null
    ffmpegDevicesTail?: string
    ffmpegHasDshowInDevices?: boolean | null
  } | null
  devices: {
    index: number
    name: string
    inputChannels: number | null
    probeError?: string | null
    dshowOptionsTail?: string | null
  }[]
  captureSource: 'env' | 'avfoundation' | 'dshow' | 'none'
  captureMode: 'auto' | 'manual' | 'off'
  manualAvfoundationAudioIndex: number | null
  effectiveAvfoundationAudioIndex: number | null
  effectiveDeviceName: string | null
  autoPicked: boolean
  suggestedDevice: { index: number; name: string } | null
  effectiveProbedInputChannels: number | null
  effectiveProbeError?: string | null
  captureChannelCount: number
  captureChannelCountAuto: boolean
  captureInputMatrix: CaptureInputMatrix
  mixerChannels: { id: string; name: string; captureInputIndex?: number }[]
  winDshowCaptureMode?: 'single' | 'aggregate'
  winDshowAggregateInputs?: { name: string }[]
  winDshowAggregateActive?: boolean
  aggregateTotalChannels?: number | null
}

type AudioInputLevelsRes = {
  captureChannelCount: number
  updatedAt: number
  receiving: boolean
  levelsByIndex: Record<string, number>
}

async function loadPcAudioStatus(
  apiBase: string,
  bearerToken: string,
): Promise<PcAudioStatus | null> {
  try {
    const base = apiBase.trim().replace(/\/$/, '')
    const r = await fetch(`${base}/api/session`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    })
    if (!r.ok) return null
    const j = (await r.json()) as {
      pcAudioCaptureConfigured?: boolean
      pcAudioCaptureReceiving?: boolean
      audioCaptureSource?: 'env' | 'avfoundation' | 'dshow' | 'none'
      captureAvfoundationAudioIndex?: number | null
      captureAvfoundationMode?: 'auto' | 'manual' | 'off'
      captureAvfoundationAutoPicked?: boolean
      winDshowCaptureMode?: 'single' | 'aggregate'
      winDshowAggregateInputCount?: number
      winDshowAggregateActive?: boolean
    }
    return {
      configured: Boolean(j.pcAudioCaptureConfigured),
      receiving: Boolean(j.pcAudioCaptureReceiving),
      audioCaptureSource: j.audioCaptureSource,
      captureAvfoundationAudioIndex: j.captureAvfoundationAudioIndex ?? null,
      captureAvfoundationMode: j.captureAvfoundationMode,
      captureAvfoundationAutoPicked: Boolean(j.captureAvfoundationAutoPicked),
      winDshowCaptureMode: j.winDshowCaptureMode,
      winDshowAggregateInputCount: j.winDshowAggregateInputCount,
      winDshowAggregateActive: j.winDshowAggregateActive,
    }
  } catch {
    return null
  }
}

async function loadAudioCaptureDevices(
  apiBase: string,
  bearerToken: string,
): Promise<AudioCaptureDevicesRes | null> {
  try {
    const base = apiBase.trim().replace(/\/$/, '')
    const r = await fetch(`${base}/api/audio-capture-devices`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    })
    if (!r.ok) return null
    return (await r.json()) as AudioCaptureDevicesRes
  } catch {
    return null
  }
}

async function loadAudioInputLevels(
  apiBase: string,
  bearerToken: string,
): Promise<AudioInputLevelsRes | null> {
  try {
    const base = apiBase.trim().replace(/\/$/, '')
    const r = await fetch(`${base}/api/audio-input-levels`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    })
    if (!r.ok) return null
    return (await r.json()) as AudioInputLevelsRes
  } catch {
    return null
  }
}

function PcAudioBanner({ status }: { status: PcAudioStatus | null }) {
  if (status === null) {
    return (
      <Text style={styles.warnBanner}>
        A carregar estado da captura do PC…
      </Text>
    )
  }
  if (!status.configured) {
    return (
      <Text style={styles.warnBanner}>
        O servidor não está a capturar entrada de áudio — só envia tons de teste. No
        Mac: no painel &quot;Entrada Mac&quot; (modo automático reconhece interfaces
        como STUDIO M), ou define INEAR_CAPTURE_CMD antes de arrancar o servidor (ver
        README).
      </Text>
    )
  }
  if (!status.receiving) {
    return (
      <Text style={styles.warnBanner}>
        A captura está configurada mas o ffmpeg não está a entregar PCM ao servidor
        (processo morto ou índice errado). Vê o terminal do desktop e o painel Entrada
        Mac.
      </Text>
    )
  }
  const src = status.audioCaptureSource
  if (src === 'avfoundation' || src === 'dshow') {
    const auto = status.captureAvfoundationAutoPicked
    const label = src === 'dshow' ? 'DirectShow (Windows)' : 'AVFoundation (macOS)'
    return (
      <Text style={styles.okBanner}>
        Captura {label} ativa
        {auto ? ' (detetada automaticamente)' : ' (modo manual)'}
        {status.captureAvfoundationAudioIndex != null
          ? ` · [${status.captureAvfoundationAudioIndex}]`
          : ''}
        . O mix usa essa entrada.
      </Text>
    )
  }
  return (
    <Text style={styles.okBanner}>
      Captura do PC ativa (INEAR_CAPTURE_CMD): o mix inclui o que o ffmpeg capta. O
      YouTube tem de sair para o dispositivo que estás a capturar (ex. BlackHole), não
      só para os altifalantes sem loopback.
    </Text>
  )
}

function MacAudioDevicesReadonly({
  data,
  dark,
}: {
  data: AudioCaptureDevicesRes | null
  dark?: boolean
}) {
  const hint = dark ? styles.deviceListHintDark : styles.deviceListHint
  if (!data) {
    return <Text style={hint}>A carregar entradas do Mac…</Text>
  }
  if (data.platform !== 'darwin' && data.platform !== 'win32') {
    return (
      <Text style={hint}>
        Lista de entradas só quando o servidor corre em macOS (AVFoundation) ou Windows
        (DirectShow).
      </Text>
    )
  }
  if (data.captureSource === 'env') {
    return (
      <Text style={hint}>
        Captura via INEAR_CAPTURE_CMD no PC (prioridade sobre a lista abaixo).
      </Text>
    )
  }
  const eff = data.effectiveAvfoundationAudioIndex
  let active: string
  if ((data.captureSource === 'avfoundation' || data.captureSource === 'dshow') && eff != null) {
    active =
      data.effectiveDeviceName != null
        ? `[${eff}] ${data.effectiveDeviceName}`
        : `índice [${eff}]`
  } else if (data.captureMode === 'off') {
    active = 'desligado — tons de teste'
  } else if (data.captureMode === 'manual') {
    active = 'manual sem captura ativa — rever índice no painel do PC'
  } else if (data.suggestedDevice) {
    active = `automático: heurística sugeriu [${data.suggestedDevice.index}] ${data.suggestedDevice.name} (sem PCM — dispositivo ausente ou ffmpeg)`
  } else {
    active =
      'automático: nenhuma entrada reconhecida (define INEAR_CAPTURE_DEVICE_SUBSTRING ou modo manual no PC)'
  }
  const box = dark ? styles.deviceListBoxDark : styles.deviceListBox
  const title = dark ? styles.deviceListTitleDark : styles.deviceListTitle
  const activeStyle = dark ? styles.deviceListActiveDark : styles.deviceListActive
  const line = dark ? styles.deviceLineDark : styles.deviceLine
  const foot = dark ? styles.deviceListFootDark : styles.deviceListFoot
  return (
    <View style={box}>
      <Text style={title}>Modo no servidor</Text>
      <Text style={activeStyle}>
        {data.captureMode}
        {data.autoPicked ? ' · entrada detetada automaticamente' : ''}
      </Text>
      <Text style={title}>Entrada efetiva (captura)</Text>
      <Text style={activeStyle}>{active}</Text>
      <Text style={title}>Entradas listadas no Mac (AVFoundation)</Text>
      <Text style={hint}>
        Cada linha é um dispositivo lógico (AVFoundation), não cada jack XLR. O Studio M
        costuma ser 2 canais (L/R). Para mais entradas num só fluxo, usa um dispositivo
        agregado no Mac e define N no painel admin.
      </Text>
      {data.ffprobeFound === false ? (
        <Text style={hint}>
          ffprobe indisponível no PATH do servidor — no painel admin usa «Provar todos» ou
          define INEAR_FFPROBE.
        </Text>
      ) : null}
      {data.devices.length === 0 ? (
        <Text style={hint}>Lista vazia ou ffmpeg indisponível no PC.</Text>
      ) : (
        data.devices.map((d) => (
          <Text key={d.index} style={line}>
            [{d.index}] {d.name}
            {typeof d.inputChannels === 'number'
              ? ` · ${d.inputChannels} entrada(s) PCM (ffprobe)`
              : d.probeError
                ? ` · ffprobe: ${d.probeError}`
                : ''}
          </Text>
        ))
      )}
      {typeof data.effectiveProbedInputChannels === 'number' ? (
        <Text style={[title, { marginTop: 8 }]}>Deteção na captura ativa</Text>
      ) : null}
      {typeof data.effectiveProbedInputChannels === 'number' ? (
        <Text style={activeStyle}>
          ffprobe: {data.effectiveProbedInputChannels} canal(is) · N guardado:{' '}
          {data.captureChannelCount}
          {data.captureChannelCountAuto ? ' (automático)' : ' (manual)'}
        </Text>
      ) : data.effectiveProbeError ? (
        <Text style={[hint, { marginTop: 8 }]}>
          ffprobe (entrada efetiva): {data.effectiveProbeError}
        </Text>
      ) : null}
      {data.captureInputMatrix && data.mixerChannels?.length ? (
        <>
          <Text style={title}>Captura → mesa</Text>
          <Text style={activeStyle}>
            N = {data.captureChannelCount} canais no PCM · ganho índice 0{' '}
            {data.captureInputMatrix.gainL.toFixed(2)} · índice 1{' '}
            {data.captureInputMatrix.gainR.toFixed(2)}
          </Text>
          {data.mixerChannels.map((ch) => {
            const a = data.captureInputMatrix.assign[ch.id] ?? 'sum'
            const legacy =
              a === 'L' ? 'só L' : a === 'R' ? 'só R' : 'soma L+R'
            const tap =
              typeof ch.captureInputIndex === 'number'
                ? `entrada física ${ch.captureInputIndex + 1}`
                : legacy
            return (
              <Text key={ch.id} style={line}>
                {ch.name}: {tap}
              </Text>
            )
          })}
        </>
      ) : null}
      <Text style={foot}>
        Entrada física: painel admin no PC (Entrada Mac). Volume para o telemóvel:
        separador Músicos → sends por canal.
      </Text>
    </View>
  )
}

function buildPanelUrl(apiBase: string, token: string, role: string): string {
  const base = apiBase.trim().replace(/\/$/, '')
  const { hostname } = new URL(base)
  const qs = new URLSearchParams({
    api: base,
    inear_token: token,
    inear_role: role,
  })
  return `http://${hostname}:5173/?${qs.toString()}`
}

export default function App() {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions()
  const isLandscape = windowWidth > windowHeight
  const topInset = Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0
  const [apiBase, setApiBase] = useState(initialApiBase)
  const normalizedApiBase = useMemo(() => normalizeApiBase(apiBase), [apiBase])
  const webPanelWebViewHeight = Math.max(360, windowHeight - 120)
  const webRetornoWebViewHeight = isLandscape
    ? Math.max(180, Math.min(240, Math.floor(windowHeight * 0.34)))
    : Math.max(240, Math.min(480, Math.floor(windowHeight * 0.42)))
  const [user, setUser] = useState('musician1')
  const [pass, setPass] = useState('musician1')
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState<{ token: string; role: Role } | null>(
    null,
  )
  const [showPanel, setShowPanel] = useState(false)
  const [webErr, setWebErr] = useState<string | null>(null)
  const [retornoOpen, setRetornoOpen] = useState(false)
  const [retornoLatency, setRetornoLatency] =
    useState<StreamRetornoLatency>('pro')
  const [pcAudioStatus, setPcAudioStatus] = useState<PcAudioStatus | null>(null)
  const [audioDevices, setAudioDevices] = useState<AudioCaptureDevicesRes | null>(null)
  const [audioInputLevels, setAudioInputLevels] = useState<AudioInputLevelsRes | null>(
    null,
  )
  const retornoWebRef = useRef<WebView>(null)
  const [retornoShowfile, setRetornoShowfile] = useState<Showfile | null>(null)
  const [retornoMasterGain, setRetornoMasterGain] = useState(1)
  const [networkQuality, setNetworkQuality] = useState<NetworkQualityUi | null>(
    null,
  )
  const mixPollBoostUntil = useRef(0)

  const retornoMusician = useMemo(() => {
    if (!retornoShowfile || !session) return null
    const sub = parseJwtSub(session.token)
    return retornoShowfile.musicians.find((m) => m.username === sub) ?? null
  }, [retornoShowfile, session])

  useEffect(() => {
    if (nativeRetornoAudio.isAvailable()) return
    if (
      retornoShowfile?.networkProfile === 'wifi_2_4' &&
      (retornoLatency === 'pro' || retornoLatency === 'low')
    ) {
      setRetornoLatency('wifi24')
      return
    }
    if (retornoShowfile?.networkProfile === 'wifi_5' && retornoLatency === 'wifi24') {
      setRetornoLatency('pro')
    }
  }, [retornoShowfile?.networkProfile, retornoLatency])

  const retornoInterfaceIfCount = useMemo(() => {
    if (!retornoShowfile) return 0
    return retornoShowfile.channels.filter((c) => /^if_\d+$/.test(c.id)).length
  }, [retornoShowfile])

  const retornoExpectedPcmCount = useMemo(() => {
    const n = audioDevices?.captureChannelCount
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null
    return Math.floor(n)
  }, [audioDevices])

  const retornoHasAllPcmChannels = useMemo(() => {
    if (!retornoShowfile || !retornoMusician) return false
    if (retornoExpectedPcmCount == null) return true
    return retornoInterfaceIfCount >= retornoExpectedPcmCount
  }, [
    retornoExpectedPcmCount,
    retornoInterfaceIfCount,
    retornoMusician,
    retornoShowfile,
  ])

  const retornoHasVisibleMixerChannels = useMemo(() => {
    if (!retornoShowfile || !retornoMusician) return false
    return retornoShowfile.channels.length > 0
  }, [retornoMusician, retornoShowfile])

  const retornoActive = retornoOpen || session?.role === 'musician'

  const refetchRetornoShowfile = useCallback(async () => {
    if (!session || session.role !== 'musician') return
    const base = normalizedApiBase
    if (!base.startsWith('http://') && !base.startsWith('https://')) return
    const r = await fetch(`${base}/api/showfile`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
    if (r.ok) setRetornoShowfile((await r.json()) as Showfile)
  }, [normalizedApiBase, session])

  const bumpMixPoll = useCallback(() => {
    mixPollBoostUntil.current = Date.now() + 6000
    void refetchRetornoShowfile()
  }, [refetchRetornoShowfile])

  const effectiveRetornoLatency: StreamRetornoLatency = retornoLatency

  const streamWsUrl = useMemo(() => {
    if (!session || session.role !== 'musician') return null
    try {
      const u = new URL(normalizedApiBase)
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${u.origin}/api/stream/audio?token=${encodeURIComponent(session.token)}&latency=${encodeURIComponent(effectiveRetornoLatency)}`
    } catch {
      return null
    }
  }, [session, normalizedApiBase, effectiveRetornoLatency])

  /** Libera o retorno assim que a mesa já tiver canais visíveis; divergência de N vira só aviso. */
  const retornoWebPlayerReady = Boolean(
    streamWsUrl &&
      retornoShowfile &&
      retornoMusician &&
      retornoHasVisibleMixerChannels,
  )

  const retornoHtml = useMemo(
    () =>
      streamWsUrl && session?.token
        ? buildStreamRetornoPlayerHtml(streamWsUrl, effectiveRetornoLatency, {
            apiBase: normalizedApiBase.replace(/\/$/, ''),
            token: session.token,
          })
        : '',
    [streamWsUrl, effectiveRetornoLatency, normalizedApiBase, session?.token],
  )

  const panelUri = useMemo(() => {
    if (!session) return null
    try {
      return buildPanelUrl(normalizedApiBase, session.token, session.role)
    } catch {
      return null
    }
  }, [session, normalizedApiBase])

  const append = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-50), line])
  }, [])

  const connectHttp = useCallback(async () => {
    const base = normalizedApiBase
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      append(
        'URL inválida. Use http://IP-DO-SEU-PC:3847 (Wi‑Fi). No telefone físico Android, 10.0.2.2 NÃO é o teu Mac — troca pelo IP da LAN.',
      )
      return
    }
    setBusy(true)
    setLog([])
    setWebErr(null)
    try {
      append(`POST login → ${base}/api/auth/login`)
      const login = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      })
      const loginText = await login.text()
      if (!login.ok) {
        append(`login ${login.status}: ${loginText}`)
        return
      }
      const { token, role } = JSON.parse(loginText) as {
        token: string
        role: Role
      }
      append(`login OK (${role})`)
      setSession({ token, role })

      const audioSt = await loadPcAudioStatus(base, token)
      setPcAudioStatus(audioSt)
      const devList = await loadAudioCaptureDevices(base, token)
      setAudioDevices(devList)
      if (audioSt) {
        if (!audioSt.configured) {
          append(
            'Áudio: sem captura (tons de teste). No Mac: painel admin → Entrada Mac ou INEAR_CAPTURE_CMD.',
          )
        } else if (!audioSt.receiving) {
          append(
            'Áudio: captura configurada mas sem PCM do ffmpeg — rever terminal do PC.',
          )
        } else if (
          audioSt.audioCaptureSource === 'avfoundation' ||
          audioSt.audioCaptureSource === 'dshow'
        ) {
          const srcLabel =
            audioSt.audioCaptureSource === 'dshow' ? 'DirectShow' : 'AVFoundation'
          append(
            `Áudio: ${srcLabel} [${audioSt.captureAvfoundationAudioIndex ?? '?'}] a alimentar o mix.`,
          )
        } else {
          append('Áudio: INEAR_CAPTURE_CMD a alimentar o mix.')
        }
      }
      if (devList?.devices?.length) {
        append(`Entradas de áudio (${devList.devices.length}): ver bloco abaixo.`)
      }

      const sf = await fetch(`${base}/api/showfile`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const sfText = await sf.text()
      if (!sf.ok) {
        append(`showfile ${sf.status}: ${sfText}`)
      } else {
        const body = JSON.parse(sfText) as {
          name?: string
          networkProfile?: string
          channels?: unknown[]
        }
        const nCh = body.channels?.length ?? 0
        append(
          `showfile OK — nome=${body.name ?? '?'} · rede=${body.networkProfile ?? '?'} · canais=${nCh}`,
        )
        if (nCh === 0) {
          append(
            'Sem canais no mix até o admin sincronizar no Mac (Sessão → Sincronizar canais da interface).',
          )
        }
      }

      setShowPanel(role === 'admin')
      if (role === 'admin') {
        append(
          'A abrir painel web (porta 5173). Confirma que o desktop está com `npm run dev` (Vite + Electron).',
        )
      }
      if (role === 'musician') {
        append(
          'Retorno no telemóvel: abre "Retorno de palco" (WebSocket, mesmo mix que o UDP).',
        )
      }
    } catch (e) {
      const msg = (e as Error).message
      append(
        msg.includes('Network request failed') || msg.includes('Failed to fetch')
          ? `rede: ${msg} — confirma URL, mesmo Wi‑Fi, firewall e se o desktop está a correr (porta 3847).`
          : `erro: ${msg}`,
      )
    } finally {
      setBusy(false)
    }
  }, [normalizedApiBase, user, pass, append])

  useEffect(() => {
    if (!retornoActive || !session) return
    void (async () => {
      const st = await loadPcAudioStatus(normalizedApiBase, session.token)
      setPcAudioStatus(st)
      const dev = await loadAudioCaptureDevices(normalizedApiBase, session.token)
      setAudioDevices(dev)
      const levels = await loadAudioInputLevels(normalizedApiBase, session.token)
      setAudioInputLevels(levels)
    })()
  }, [retornoActive, session, normalizedApiBase])

  useEffect(() => {
    if (!retornoActive || !session || session.role !== 'musician') {
      setRetornoShowfile(null)
      return
    }
    const base = normalizedApiBase
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      setRetornoShowfile(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`${base}/api/showfile`, {
          headers: { Authorization: `Bearer ${session.token}` },
        })
        if (!r.ok || cancelled) return
        const sf = (await r.json()) as Showfile
        if (!cancelled) setRetornoShowfile(sf)
      } catch {
        if (!cancelled) setRetornoShowfile(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [retornoActive, session, normalizedApiBase])

  useEffect(() => {
    if (!retornoActive || !session || session.role !== 'musician') {
      return
    }
    let cancelled = false
    let handle: ReturnType<typeof setTimeout>
    const schedule = () => {
      const fast = Date.now() < mixPollBoostUntil.current
      const delay = fast
        ? 500
        : retornoHasAllPcmChannels
          ? 3000
          : 1500
      handle = setTimeout(async () => {
        if (cancelled) return
        await refetchRetornoShowfile()
        schedule()
      }, delay)
    }
    schedule()
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [
    refetchRetornoShowfile,
    retornoHasAllPcmChannels,
    retornoActive,
    session,
  ])

  useEffect(() => {
    if (!retornoActive || !session || session.role !== 'musician') {
      setNetworkQuality(null)
      return
    }
    const base = normalizedApiBase
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      setNetworkQuality(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const r = await fetch(`${base}/api/network-quality`, {
          headers: { Authorization: `Bearer ${session.token}` },
        })
        if (!r.ok || cancelled) return
        const j = (await r.json()) as { self: NetworkQualityUi | null }
        if (!cancelled) setNetworkQuality(j.self ?? null)
      } catch {
        if (!cancelled) setNetworkQuality(null)
      }
    }
    void load()
    const t = setInterval(load, 3000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [normalizedApiBase, retornoActive, session])

  useEffect(() => {
    if (!retornoActive || !session || session.role !== 'musician') {
      setAudioInputLevels(null)
      return
    }
    let cancelled = false
    const load = async () => {
      const levels = await loadAudioInputLevels(normalizedApiBase, session.token)
      if (!cancelled) setAudioInputLevels(levels)
    }
    void load()
    const timer = setInterval(() => {
      void load()
    }, 500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [normalizedApiBase, retornoActive, session])

  useEffect(() => {
    if (!retornoActive) return
    retornoWebRef.current?.injectJavaScript(
      `typeof window.__inearSetMaster==='function'&&window.__inearSetMaster(${retornoMasterGain});true;`,
    )
  }, [retornoActive, retornoMasterGain, retornoLatency])

  if (showPanel && session && panelUri) {
    return (
      <SafeAreaView style={[styles.safeRoot, styles.shell]}>
        <ExpoStatusBar style="dark" />
        <Modal visible={retornoOpen} animationType="slide">
          <SafeAreaView style={[styles.retornoModal, { paddingTop: topInset }]}>
            <View style={styles.retornoBar}>
              <Button title="Fechar retorno" onPress={() => setRetornoOpen(false)} />
            </View>
            <ScrollView
              style={styles.retornoScroll}
              contentContainerStyle={[
                styles.retornoScrollContent,
                isLandscape && styles.retornoScrollContentLandscape,
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              persistentScrollbar={Platform.OS === 'android'}
              nestedScrollEnabled
            >
              <View style={styles.retornoLatencyRow}>
                <Button title="Latência: palco PRO" onPress={() => setRetornoLatency('pro')} />
                <Button
                  title="Latência: 2.4 otimizada"
                  onPress={() => setRetornoLatency('wifi24')}
                />
              </View>
              <Text style={styles.retornoLatencyHint}>
                Buffer Web: {retornoLatency} (toca &quot;Iniciar&quot; outra vez se mudares).
              </Text>
              {session.role === 'musician' ? (
                <RetornoMixerControls
                  apiBase={normalizedApiBase}
                  token={session.token}
                  showfile={retornoShowfile}
                  musician={retornoMusician}
                  onMusicianUpdated={(m) =>
                    setRetornoShowfile((prev) =>
                      prev ? mergeMusicianInShowfile(prev, m) : null,
                    )
                  }
                  webViewRef={retornoWebRef}
                  masterGain={retornoMasterGain}
                  onMasterGainChange={setRetornoMasterGain}
                  streamConnected={Boolean(streamWsUrl && retornoWebPlayerReady)}
                  networkQuality={networkQuality}
                  onLocalMixInteraction={bumpMixPoll}
                />
              ) : null}
              {retornoWebPlayerReady ? (
                <WebView
                  ref={retornoWebRef}
                  key={retornoLatency}
                  originWhitelist={['*']}
                  source={{ html: retornoHtml }}
                  style={[styles.retornoWeb, { height: webRetornoWebViewHeight }]}
                  javaScriptEnabled
                  domStorageEnabled
                  scrollEnabled
                  mediaPlaybackRequiresUserAction={false}
                  onLoadEnd={() => {
                    retornoWebRef.current?.injectJavaScript(
                      `typeof window.__inearSetMaster==='function'&&window.__inearSetMaster(${retornoMasterGain});true;`,
                    )
                  }}
                />
              ) : streamWsUrl && retornoShowfile && retornoMusician && !retornoHasVisibleMixerChannels ? (
                <View style={styles.retornoSyncGateBox}>
                  <Text style={styles.retornoSyncGateTitle}>
                    Aguardando a mesa carregar
                  </Text>
                  <Text style={styles.retornoSyncGateText}>
                    O botão de ativar áudio aparece assim que os canais da mesa forem
                    carregados no app. Se o desktop acabou de sincronizar as faixas,
                    esta tela recarrega automaticamente.
                  </Text>
                </View>
              ) : streamWsUrl ? (
                <Text style={styles.retornoWebGate}>
                  A carregar a mesa com as entradas PCM (0, 1, 2…) e o equalizador por canal…
                </Text>
              ) : null}
              <PcAudioBanner status={pcAudioStatus} />
              <MacAudioDevicesReadonly data={audioDevices} dark />
            </ScrollView>
          </SafeAreaView>
        </Modal>
        <ScrollView
          style={styles.scrollRoot}
          contentContainerStyle={styles.panelScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          persistentScrollbar={Platform.OS === 'android'}
          nestedScrollEnabled
        >
          <View style={styles.webToolbar}>
            <Button title="← Voltar" onPress={() => setShowPanel(false)} />
            <Text style={styles.webHint} numberOfLines={2} selectable>
              Painel: mesma máquina que a API, porta 5173 (Vite).
            </Text>
            {session.role === 'musician' && streamWsUrl ? (
              <Button title="Retorno" onPress={() => setRetornoOpen(true)} />
            ) : null}
          </View>
          {webErr ? (
            <Text style={[styles.err, styles.webErrPad]}>{webErr}</Text>
          ) : null}
          <WebView
            source={{ uri: panelUri }}
            style={[styles.webview, { height: webPanelWebViewHeight }]}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            onError={(e) =>
              setWebErr(
                e.nativeEvent.description ||
                  'Falha ao carregar. O Vite está a correr na porta 5173?',
              )
            }
            onHttpError={(e) =>
              setWebErr(`HTTP ${e.nativeEvent.statusCode} ao carregar o painel`)
            }
          />
        </ScrollView>
      </SafeAreaView>
    )
  }

  if (session?.role === 'musician') {
    const musicianLabel =
      retornoMusician?.name?.trim() || parseJwtSub(session.token) || 'Musico'
    return (
      <SafeAreaView style={[styles.safeRoot, styles.musicianShell]}>
        <ExpoStatusBar style="light" />
        <View style={[styles.musicianHeader, { paddingTop: topInset + 4 }]}>
          <View style={styles.musicianIdentity}>
            <Text style={styles.musicianTitle}>Ola, {musicianLabel}</Text>
          </View>
          <View style={styles.musicianHeaderActions}>
            <Pressable style={styles.headerGhostBtn} onPress={() => void refetchRetornoShowfile()}>
              <Text style={styles.headerGhostTxt}>Recarregar</Text>
            </Pressable>
            <Pressable
              style={styles.headerPrimaryBtn}
              onPress={() => {
                setSession(null)
                setRetornoShowfile(null)
                setAudioInputLevels(null)
              }}
            >
              <Text style={styles.headerPrimaryTxt}>Sair</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView
          style={styles.musicianBodyScroll}
          contentContainerStyle={styles.musicianBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          persistentScrollbar={Platform.OS === 'android'}
          nestedScrollEnabled
        >
          <View style={styles.musicianMixerShell}>
            <Text style={styles.musicianSectionTitle}>Mesa</Text>
            <View style={styles.musicianMixerPane}>
              <RetornoMixerControls
                apiBase={normalizedApiBase}
                token={session.token}
                showfile={retornoShowfile}
                musician={retornoMusician}
                onMusicianUpdated={(m) =>
                  setRetornoShowfile((prev) => (prev ? mergeMusicianInShowfile(prev, m) : null))
                }
                webViewRef={retornoWebRef}
                masterGain={retornoMasterGain}
                onMasterGainChange={setRetornoMasterGain}
                streamConnected={Boolean(streamWsUrl && retornoWebPlayerReady)}
                networkQuality={networkQuality}
                onLocalMixInteraction={bumpMixPoll}
              />
            </View>
          </View>
          <View style={styles.musicianControlPane}>
            <View style={styles.musicianLatencyBar}>
              <Pressable
                style={[
                  styles.latencyPill,
                  retornoLatency === 'wifi24' && styles.latencyPillActive,
                ]}
                onPress={() => setRetornoLatency('wifi24')}
              >
                <Text style={styles.latencyPillTxt}>2.4 - otimizada</Text>
              </Pressable>
              <Pressable
                style={[styles.latencyPill, retornoLatency === 'pro' && styles.latencyPillActive]}
                onPress={() => setRetornoLatency('pro')}
              >
                <Text style={styles.latencyPillTxt}>5 - palco PRO</Text>
              </Pressable>
            </View>
            {streamWsUrl && nativeRetornoAudio.isAvailable() ? (
              <RetornoNativeConsole
                wsUrl={streamWsUrl}
                latencyProfile={effectiveRetornoLatency}
                masterGain={retornoMasterGain}
                onMasterGainChange={setRetornoMasterGain}
              />
            ) : retornoWebPlayerReady ? (
              <WebView
                ref={retornoWebRef}
                key={retornoLatency}
                originWhitelist={['*']}
                source={{ html: retornoHtml }}
                style={[styles.retornoWeb, styles.retornoWebFixed, { height: webRetornoWebViewHeight + 20 }]}
                javaScriptEnabled
                domStorageEnabled
                scrollEnabled
                nestedScrollEnabled
                mediaPlaybackRequiresUserAction={false}
                onLoadEnd={() => {
                  retornoWebRef.current?.injectJavaScript(
                    `typeof window.__inearSetMaster==='function'&&window.__inearSetMaster(${retornoMasterGain});true;`,
                  )
                }}
              />
            ) : (
              <Text style={styles.retornoWebGate}>Carregando a mesa...</Text>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.safeRoot, styles.safeLight]}>
      <ScrollView
        style={styles.scrollFill}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        persistentScrollbar={Platform.OS === 'android'}
        nestedScrollEnabled
      >
      <ExpoStatusBar style="auto" />
      <Text style={styles.title}>inEar</Text>
      <Text style={styles.note}>
        Entre com o IP do computador na rede local. A porta padrao ja e {`3847`}, entao voce pode
        digitar apenas o IP.
      </Text>
      <View style={styles.loginCard}>
      <Text style={styles.label}>IP do servidor</Text>
      <TextInput
        value={formatApiFieldValue(apiBase)}
        onChangeText={(text) => setApiBase(text)}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
        placeholder="192.168.0.10"
      />
      <Text style={styles.fieldHint}>Porta padrao: 3847</Text>
      <Text style={styles.label}>Usuário</Text>
      <TextInput value={user} onChangeText={setUser} style={styles.input} />
      <Text style={styles.label}>Senha</Text>
      <TextInput
        value={pass}
        onChangeText={setPass}
        style={styles.input}
        secureTextEntry
      />
      <View style={styles.row}>
        <Button
          title={busy ? '...' : 'Entrar'}
          onPress={() => void connectHttp()}
          disabled={busy}
        />
      </View>
      </View>
      <Modal visible={retornoOpen} animationType="slide">
        <SafeAreaView style={[styles.retornoModal, { paddingTop: topInset }]}>
          <View style={styles.retornoBar}>
            <Button title="Fechar retorno" onPress={() => setRetornoOpen(false)} />
          </View>
          <ScrollView
            style={styles.retornoScroll}
            contentContainerStyle={[
              styles.retornoScrollContent,
              isLandscape && styles.retornoScrollContentLandscape,
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            persistentScrollbar={Platform.OS === 'android'}
            nestedScrollEnabled
          >
            <View style={styles.retornoLatencyRow}>
              <Button title="5 - palco PRO" onPress={() => setRetornoLatency('pro')} />
              <Button title="2.4 - otimizada" onPress={() => setRetornoLatency('wifi24')} />
            </View>
            {session ? (
              <RetornoMixerControls
                apiBase={normalizedApiBase}
                token={session.token}
                showfile={retornoShowfile}
                musician={retornoMusician}
                onMusicianUpdated={(m) =>
                  setRetornoShowfile((prev) =>
                    prev ? mergeMusicianInShowfile(prev, m) : null,
                  )
                }
                webViewRef={retornoWebRef}
                masterGain={retornoMasterGain}
                onMasterGainChange={setRetornoMasterGain}
                streamConnected={Boolean(streamWsUrl && retornoWebPlayerReady)}
                networkQuality={networkQuality}
                onLocalMixInteraction={bumpMixPoll}
              />
            ) : null}
            {retornoWebPlayerReady ? (
              <WebView
                ref={retornoWebRef}
                key={retornoLatency}
                originWhitelist={['*']}
                source={{ html: retornoHtml }}
                style={[styles.retornoWeb, { height: webRetornoWebViewHeight }]}
                javaScriptEnabled
                domStorageEnabled
                scrollEnabled
                nestedScrollEnabled
                mediaPlaybackRequiresUserAction={false}
                onLoadEnd={() => {
                  retornoWebRef.current?.injectJavaScript(
                    `typeof window.__inearSetMaster==='function'&&window.__inearSetMaster(${retornoMasterGain});true;`,
                  )
                }}
              />
            ) : streamWsUrl && retornoShowfile && retornoMusician && !retornoHasVisibleMixerChannels ? (
              <View style={styles.retornoSyncGateBox}>
                <Text style={styles.retornoSyncGateTitle}>
                  Aguardando a mesa carregar
                </Text>
                <Text style={styles.retornoSyncGateText}>
                  O botão de ativar áudio aparece assim que os canais da mesa forem
                  carregados no app. Se o desktop acabou de sincronizar as faixas,
                  esta tela recarrega automaticamente.
                </Text>
              </View>
            ) : streamWsUrl ? (
              <Text style={styles.retornoWebGate}>
                Carregando a mesa...
              </Text>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {session ? <MacAudioDevicesReadonly data={audioDevices} /> : null}
      {session && !showPanel ? (
        <Button title="Reabrir painel web" onPress={() => setShowPanel(true)} />
      ) : null}
      {log.map((line, i) => (
        <Text key={i} style={styles.log}>
          {line}
        </Text>
      ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeRoot: { flex: 1 },
  safeLight: { backgroundColor: '#fff' },
  musicianShell: { backgroundColor: '#050910' },
  scrollRoot: { flex: 1 },
  scrollFill: { flex: 1 },
  panelScrollContent: { flexGrow: 1, paddingBottom: 24 },
  retornoScroll: { flex: 1 },
  retornoScrollContent: { paddingBottom: 24 },
  retornoScrollContentLandscape: { paddingHorizontal: 10 },
  musicianScreenContent: { paddingTop: 10, paddingBottom: 16 },
  musicianBodyScroll: {
    flex: 1,
  },
  musicianBody: {
    flexGrow: 1,
    gap: 12,
    padding: 10,
    paddingBottom: 28,
  },
  musicianMixerShell: {
    borderRadius: 22,
    backgroundColor: '#080e16',
    borderWidth: 1,
    borderColor: '#1c2a3b',
    paddingTop: 10,
    minHeight: 300,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  musicianSectionTitle: {
    color: '#f0f6fc',
    fontSize: 15,
    fontWeight: '800',
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  musicianControlPane: {
    width: '100%',
    borderRadius: 22,
    backgroundColor: '#0a1018',
    borderWidth: 1,
    borderColor: '#1f3044',
    padding: 10,
    marginTop: 0,
  },
  musicianMixerPane: {
    borderRadius: 18,
  },
  webErrPad: { marginHorizontal: 8, marginBottom: 8 },
  shell: { flex: 1, backgroundColor: '#fff' },
  musicianHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#182230',
    backgroundColor: '#0a111a',
    minHeight: 46,
  },
  musicianIdentity: { flex: 1, paddingRight: 12 },
  musicianTitle: {
    color: '#f0f6fc',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 0,
  },
  musicianHeaderActions: {
    flexDirection: 'row',
    gap: 6,
    marginRight: '3%',
  },
  headerGhostBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 11,
    backgroundColor: '#101722',
    borderWidth: 1,
    borderColor: '#293548',
  },
  headerGhostTxt: {
    color: '#e6edf3',
    fontWeight: '700',
    fontSize: 12,
  },
  headerPrimaryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 11,
    backgroundColor: '#1874da',
  },
  headerPrimaryTxt: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  musicianLatencyBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  latencyPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#121b28',
    borderWidth: 1,
    borderColor: '#263246',
  },
  latencyPillActive: {
    backgroundColor: '#15324f',
    borderColor: '#6cb6ff',
  },
  latencyPillTxt: {
    color: '#dbe8f6',
    fontWeight: '800',
  },
  webToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
  },
  webHint: { flex: 1, fontSize: 11, color: '#555' },
  webview: { width: '100%' },
  container: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  note: { color: '#444', marginBottom: 14, fontSize: 13, lineHeight: 20 },
  loginCard: {
    backgroundColor: '#f7faff',
    borderWidth: 1,
    borderColor: '#d8e5f6',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  fieldHint: {
    color: '#64748b',
    fontSize: 11,
    marginBottom: 6,
  },
  bold: { fontWeight: '700' },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  box: {
    backgroundColor: '#eef6ff',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#c8d8f0',
  },
  boxTitle: { fontWeight: '700', marginBottom: 6 },
  line: { fontSize: 13, marginTop: 2 },
  label: { fontSize: 12, color: '#444', marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  row: { flexDirection: 'row', gap: 12, marginTop: 12, flexWrap: 'wrap' },
  retornoRow: { marginTop: 12 },
  retornoModal: { flex: 1, backgroundColor: '#0d1117' },
  retornoBar: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  retornoWeb: { width: '100%' },
  retornoWebFixed: {
    flex: 1,
    minHeight: 220,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#25384e',
  },
  retornoWebGate: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 20,
    paddingHorizontal: 14,
    minHeight: 100,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
    color: '#8b949e',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  retornoSyncGateBox: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9e6a03',
    backgroundColor: '#342c1d',
  },
  retornoSyncGateTitle: {
    color: '#ffa657',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  retornoSyncGateText: {
    color: '#f0883e',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  retornoLatencyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 10,
    paddingBottom: 6,
    alignItems: 'center',
  },
  retornoLatencyHint: {
    fontSize: 11,
    color: '#888',
    paddingHorizontal: 10,
    paddingBottom: 4,
  },
  warnBanner: {
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fff3cd',
    color: '#664d03',
    fontSize: 12,
    lineHeight: 18,
  },
  okBanner: {
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#d1e7dd',
    color: '#0f5132',
    fontSize: 12,
    lineHeight: 18,
  },
  deviceListBox: {
    marginBottom: 12,
    marginTop: 4,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f6f8fa',
    borderWidth: 1,
    borderColor: '#d0d7de',
  },
  deviceListBoxDark: {
    marginHorizontal: 10,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#161b22',
    borderWidth: 1,
    borderColor: '#30363d',
  },
  deviceListTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#57606a',
    marginTop: 6,
    marginBottom: 4,
  },
  deviceListTitleDark: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8b949e',
    marginTop: 6,
    marginBottom: 4,
  },
  deviceListActive: { fontSize: 13, color: '#24292f', marginBottom: 4 },
  deviceListActiveDark: { fontSize: 13, color: '#c9d1d9', marginBottom: 4 },
  deviceLine: {
    fontSize: 12,
    color: '#24292f',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  deviceLineDark: {
    fontSize: 12,
    color: '#8b949e',
    fontFamily: 'monospace',
    marginBottom: 2,
  },
  deviceListHint: {
    marginBottom: 8,
    fontSize: 11,
    color: '#57606a',
  },
  deviceListHintDark: {
    marginHorizontal: 10,
    marginBottom: 6,
    fontSize: 11,
    color: '#8b949e',
  },
  deviceListFoot: { fontSize: 10, color: '#6e7781', marginTop: 8 },
  deviceListFootDark: { fontSize: 10, color: '#6e7681', marginTop: 8 },
  log: {
    marginTop: 6,
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#111',
  },
  ok: { marginTop: 8, color: '#0a6b0a', fontWeight: '600' },
  err: { marginTop: 8, color: '#a00', fontWeight: '600', padding: 8 },
})
