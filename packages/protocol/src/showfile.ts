import { channelAccentColor } from './channelVisuals.js'

export type WifiNetworkProfile = 'wifi_2_4' | 'wifi_5' | 'auto'

/** Origem mono no PCM estéreo da captura (MVP: L/R/soma). */
export type ChannelSourceTap = 'L' | 'R' | 'sum'

export interface Eq3 {
  lowDb: number
  midDb: number
  highDb: number
}

export interface ChannelStrip {
  id: string
  name: string
  /** id visual do badge/icone do canal (ex.: kick, snare, vocal) */
  icon?: string
  /** cor de destaque em HEX (#rrggbb); omitido = paleta default */
  color?: string
  /** linear gain 0..4 */
  gain: number
  pan: number
  mute: boolean
  eq: Eq3
  /** quando true, músico não altera EQ (somente admin) */
  lockEq: boolean
  /**
   * Índice 0..N-1 no PCM intercalado da captura (dispositivo agregado com N entradas).
   * Se omitido, usa-se `sourceTap` / `assign` (legado estéreo).
   */
  captureInputIndex?: number
  /** ligação ao PCM estéreo da interface; omitido em canais legados (tratado como sum + matriz no servidor) */
  sourceTap?: ChannelSourceTap
}

export interface GroupBus {
  id: string
  name: string
  /** channel ids summed into this group before musician matrix */
  channelIds: string[]
  gain: number
  mute: boolean
}

export interface MusicianScope {
  /** empty = none; if both empty, server treats as all channels (capped by MVP) */
  channelIds: string[]
  groupIds: string[]
}

export interface MusicianStrip {
  id: string
  name: string
  username: string
  role: 'admin' | 'musician'
  /** per-source gain for elements visible in scope (channel or group id) */
  sendGains: Record<string, number>
  /** mute por source visível (channel/group id) na mistura deste músico */
  sendMutes?: Record<string, boolean>
  mute: boolean
  scope: MusicianScope
  /** EQ por canal só neste ouvido / telemóvel (mistura individual). Chave = channel id. */
  eqByChannel?: Record<string, Eq3>
}

export interface Showfile {
  version: 1
  name: string
  networkProfile: WifiNetworkProfile
  channels: ChannelStrip[]
  groups: GroupBus[]
  musicians: MusicianStrip[]
}

/** Pelo menos um id de canal ou de grupo do escopo existe no showfile atual. */
export function musicianScopeHasValidTarget(
  sf: Showfile,
  m: MusicianStrip,
): boolean {
  const chSet = new Set(sf.channels.map((c) => c.id))
  for (const cid of m.scope.channelIds) {
    if (chSet.has(cid)) return true
  }
  for (const gid of m.scope.groupIds) {
    if (sf.groups.some((g) => g.id === gid)) return true
  }
  return false
}

/** ids `if_0`…`if_n` ordenados por índice numérico */
export function sortedInterfaceInputIds(allChannelIds: string[]): string[] {
  return allChannelIds
    .filter((id) => /^if_\d+$/.test(id))
    .sort((a, b) => {
      const na = Number(/^if_(\d+)$/.exec(a)?.[1] ?? 0)
      const nb = Number(/^if_(\d+)$/.exec(b)?.[1] ?? 0)
      return na - nb
    })
}

/**
 * Canais cujo send/EQ o músico deve ver.
 * Escopo vazio = todos. Escopo com ids órfãos (canais antigos) → todos os canais atuais.
 * Se o escopo lista só um subconjunto de entradas `if_*` mas o showfile tem mais `if_*`,
 * expande para todas as entradas da interface (evita ficar preso a 2 faders após aumentar N).
 */
export function visibleChannelIdsForMusician(
  sf: Showfile,
  m: MusicianStrip,
): string[] {
  const all = sf.channels.map((c) => c.id)
  if (all.length === 0) return []
  const explicit =
    m.scope.channelIds.length > 0 || m.scope.groupIds.length > 0
  if (!explicit || !musicianScopeHasValidTarget(sf, m)) return all
  const set = new Set<string>()
  for (const cid of m.scope.channelIds) {
    if (all.includes(cid)) set.add(cid)
  }
  for (const gid of m.scope.groupIds) {
    const g = sf.groups.find((x) => x.id === gid)
    if (g) {
      for (const cid of g.channelIds) {
        if (all.includes(cid)) set.add(cid)
      }
    }
  }
  const resolved = [...set]
  if (resolved.length === 0) return all

  const allIf = sortedInterfaceInputIds(all)
  const resIf = resolved.filter((id) => /^if_\d+$/.test(id))
  const onlyIfInResolved = resIf.length === resolved.length
  const subsetOfAllIf =
    onlyIfInResolved &&
    allIf.length > 0 &&
    resIf.length > 0 &&
    resIf.length < allIf.length &&
    resIf.every((id) => allIf.includes(id))

  if (subsetOfAllIf) {
    return allIf
  }

  return resolved
}

/**
 * Ordem de canais no mixer de retorno (móvel): **todas** as entradas `if_*` do showfile
 * (agregado N canais), depois os restantes visíveis pelo escopo (ex. aux) sem duplicar.
 * Evita ficar só com 2 faders quando o escopo mistura `if_*` com outros ids.
 */
export function retornoMixerChannelOrder(sf: Showfile, m: MusicianStrip): string[] {
  const allIf = sortedInterfaceInputIds(sf.channels.map((c) => c.id))
  const vis = visibleChannelIdsForMusician(sf, m)
  const rest = vis.filter((id) => !/^if_\d+$/.test(id))
  return [...allIf, ...rest]
}

function inferCaptureInputIndex(c: ChannelStrip): void {
  if (
    typeof c.captureInputIndex === 'number' &&
    Number.isFinite(c.captureInputIndex) &&
    c.captureInputIndex >= 0
  ) {
    c.captureInputIndex = Math.floor(c.captureInputIndex)
    return
  }
  const idNum = /^if_(\d+)$/.exec(c.id)
  if (idNum) {
    c.captureInputIndex = Number(idNum[1])
    return
  }
  if (c.id === 'if_l') {
    c.captureInputIndex = 0
    return
  }
  if (c.id === 'if_r') {
    c.captureInputIndex = 1
    return
  }
  if (c.sourceTap === 'L') c.captureInputIndex = 0
  else if (c.sourceTap === 'R') c.captureInputIndex = 1
}

export function migrateShowfile(sf: Showfile): Showfile {
  for (const c of sf.channels) {
    if (typeof c.lockEq !== 'boolean') c.lockEq = false
    if (typeof c.icon !== 'string' || !c.icon.trim()) delete c.icon
    if (typeof c.color !== 'string' || !c.color.trim()) delete c.color
    inferCaptureInputIndex(c)
  }
  for (const m of sf.musicians) {
    if (!m.eqByChannel || typeof m.eqByChannel !== 'object') {
      m.eqByChannel = {}
    }
    if (!m.sendMutes || typeof m.sendMutes !== 'object') {
      m.sendMutes = {}
    }
    const explicit =
      m.scope.channelIds.length > 0 || m.scope.groupIds.length > 0
    if (
      explicit &&
      (sf.channels.length > 0 || sf.groups.length > 0) &&
      !musicianScopeHasValidTarget(sf, m)
    ) {
      m.scope = { channelIds: [], groupIds: [] }
    }
  }
  return sf
}

function emptyEq(): Eq3 {
  return { lowDb: 0, midDb: 0, highDb: 0 }
}

export function defaultShowfile(): Showfile {
  return {
    version: 1,
    name: 'Default',
    networkProfile: 'auto',
    channels: [],
    groups: [],
    musicians: [
      {
        id: 'm1',
        name: 'Músico 1',
        username: 'musician1',
        role: 'musician',
        sendGains: {},
        sendMutes: {},
        mute: false,
        scope: { channelIds: [], groupIds: [] },
        eqByChannel: {},
      },
      {
        id: 'm2',
        name: 'Músico 2',
        username: 'musician2',
        role: 'musician',
        sendGains: {},
        sendMutes: {},
        mute: false,
        scope: { channelIds: [], groupIds: [] },
        eqByChannel: {},
      },
    ],
  }
}

export function syncInterfaceChannels(
  sf: Showfile,
  params: { channelCount: number; baseName: string },
): Showfile {
  const n = Math.max(1, Math.floor(Number(params.channelCount) || 0))
  const baseName = String(params.baseName || '').trim() || 'Interface'

  const prevByIndex = new Map<number, ChannelStrip>()
  for (const c of sf.channels) {
    let k: number | null = null
    const mm = /^if_(\d+)$/.exec(c.id)
    if (mm) k = Number(mm[1])
    else if (c.id === 'if_l') k = 0
    else if (c.id === 'if_r') k = 1
    if (k !== null && k >= 0 && k < n) prevByIndex.set(k, c)
  }

  const channels: ChannelStrip[] = []
  for (let k = 0; k < n; k++) {
    const prev = prevByIndex.get(k)
    const name = `Entrada ${k + 1} · ${baseName}`
    channels.push({
      id: `if_${k}`,
      name,
      icon: typeof prev?.icon === 'string' ? prev.icon : undefined,
      color: channelAccentColor({
        id: `if_${k}`,
        color: typeof prev?.color === 'string' ? prev.color : undefined,
        captureInputIndex: k,
      }),
      gain: typeof prev?.gain === 'number' ? prev.gain : 1,
      pan: typeof prev?.pan === 'number' ? prev.pan : 0,
      mute: Boolean(prev?.mute),
      eq:
        prev?.eq &&
        typeof prev.eq.lowDb === 'number' &&
        typeof prev.eq.midDb === 'number' &&
        typeof prev.eq.highDb === 'number'
          ? {
              lowDb: prev.eq.lowDb,
              midDb: prev.eq.midDb,
              highDb: prev.eq.highDb,
            }
          : emptyEq(),
      lockEq: Boolean(prev?.lockEq),
      captureInputIndex: k,
      sourceTap: k === 0 ? 'L' : k === 1 ? 'R' : undefined,
    })
  }

  sf.channels = channels
  sf.groups = []
  const ids = channels.map((c) => c.id)
  for (const m of sf.musicians) {
    m.scope = { channelIds: [...ids], groupIds: [] }
    const nextGains: Record<string, number> = {}
    const nextMutes: Record<string, boolean> = {}
    for (const id of ids) {
      nextGains[id] = m.sendGains[id] ?? 1
      nextMutes[id] = Boolean(m.sendMutes?.[id])
    }
    m.sendGains = nextGains
    m.sendMutes = nextMutes
    if (!m.eqByChannel) m.eqByChannel = {}
    const nextEq: Record<string, Eq3> = {}
    for (const id of ids) {
      if (m.eqByChannel[id]) nextEq[id] = m.eqByChannel[id]!
    }
    m.eqByChannel = nextEq
  }

  return migrateShowfile(sf)
}
