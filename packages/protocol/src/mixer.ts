import {
  type ChannelStrip,
  type Eq3,
  type GroupBus,
  type MusicianStrip,
  type Showfile,
  musicianScopeHasValidTarget,
} from './showfile.js'

function dbToLinear(db: number): number {
  return 10 ** (db / 20)
}

/**
 * MVP: “cor” derivada das 3 bandas (substituir por biquads depois).
 * Limita o boost/corte médio para evitar exagerar ruído de quantização / chiado.
 */
function channelEqLinearFromEq(eq: Eq3): number {
  const avg = (eq.lowDb + eq.midDb + eq.highDb) / 3
  const adb = Math.max(-6, Math.min(6, avg))
  return dbToLinear(adb)
}

/** Pan -1..1 → leis constant-power L/R */
function panWeights(pan: number): { wl: number; wr: number } {
  const p = Math.max(-1, Math.min(1, pan))
  const wl = Math.cos((p + 1) * (Math.PI / 4))
  const wr = Math.sin((p + 1) * (Math.PI / 4))
  return { wl, wr }
}

function effectiveEqForChannel(
  ch: ChannelStrip,
  m: MusicianStrip,
  channelId: string,
): Eq3 {
  const per = m.eqByChannel?.[channelId]
  if (
    per &&
    typeof per.lowDb === 'number' &&
    typeof per.midDb === 'number' &&
    typeof per.highDb === 'number'
  ) {
    return per
  }
  return ch.eq
}

function isSourceMutedForMusician(m: MusicianStrip, sourceId: string): boolean {
  return Boolean(m.sendMutes?.[sourceId])
}

export type MixSourceOptions = {
  getSourceGainMultiplier?: (sourceId: string) => number
}

export function channelStereoFromMono(
  ch: ChannelStrip,
  mono: number,
  m?: MusicianStrip,
  channelId?: string,
): { l: number; r: number } {
  if (ch.mute) return { l: 0, r: 0 }
  const { wl, wr } = panWeights(ch.pan)
  const eq =
    m && channelId ? effectiveEqForChannel(ch, m, channelId) : ch.eq
  const gainLin = channelEqLinearFromEq(eq)
  const mm = mono * ch.gain * gainLin
  return { l: mm * wl, r: mm * wr }
}

export function groupStereoFromMono(
  g: GroupBus,
  channels: ChannelStrip[],
  monoById: Record<string, number>,
  m: MusicianStrip,
): { l: number; r: number } {
  if (g.mute) return { l: 0, r: 0 }
  let l = 0
  let r = 0
  for (const id of g.channelIds) {
    const ch = channels.find((c) => c.id === id)
    if (!ch) continue
    const mn = monoById[id] ?? 0
    const lr = channelStereoFromMono(ch, mn, m, id)
    l += lr.l
    r += lr.r
  }
  return { l: l * g.gain, r: r * g.gain }
}

/** Saturação por canal (L/R), sem limitador “de bus” que reparte ganho entre fontes. */
function clip(l: number, r: number): { l: number; r: number } {
  return {
    l: Math.tanh(l),
    r: Math.tanh(r),
  }
}

/** Mix a partir de amostras mono por canal (entrada “microfone” / ASIO futuro). */
export function mixMusicianStereoFromMonoSources(
  sf: Showfile,
  m: MusicianStrip,
  monoById: Record<string, number>,
  options?: MixSourceOptions,
): { l: number; r: number } {
  if (m.mute) return { l: 0, r: 0 }
  let l = 0
  let r = 0
  const chMap = new Map(sf.channels.map((c) => [c.id, c]))
  const grMap = new Map(sf.groups.map((g) => [g.id, g]))

  const scopedExplicit =
    m.scope.channelIds.length > 0 || m.scope.groupIds.length > 0
  const scopedUsable =
    scopedExplicit && musicianScopeHasValidTarget(sf, m)

  if (!scopedExplicit || !scopedUsable) {
    for (const ch of sf.channels) {
      const mn = monoById[ch.id] ?? 0
      const lr = channelStereoFromMono(ch, mn, m, ch.id)
      const g =
        (isSourceMutedForMusician(m, ch.id) ? 0 : m.sendGains[ch.id] ?? 1) *
        (options?.getSourceGainMultiplier?.(ch.id) ?? 1)
      l += lr.l * g
      r += lr.r * g
    }
    return clip(l, r)
  }

  const groupIdsResolved = m.scope.groupIds.filter((gid) => grMap.has(gid))
  const channelIdsResolved = m.scope.channelIds.filter((cid) =>
    chMap.has(cid),
  )

  for (const gid of groupIdsResolved) {
    const g = grMap.get(gid)!
    const lr = groupStereoFromMono(g, sf.channels, monoById, m)
    const sg =
      (isSourceMutedForMusician(m, gid) ? 0 : m.sendGains[gid] ?? 1) *
      (options?.getSourceGainMultiplier?.(gid) ?? 1)
    l += lr.l * sg
    r += lr.r * sg
  }
  for (const cid of channelIdsResolved) {
    const ch = chMap.get(cid)!
    const mn = monoById[cid] ?? 0
    const lr = channelStereoFromMono(ch, mn, m, cid)
    const sg =
      (isSourceMutedForMusician(m, cid) ? 0 : m.sendGains[cid] ?? 1) *
      (options?.getSourceGainMultiplier?.(cid) ?? 1)
    l += lr.l * sg
    r += lr.r * sg
  }
  return clip(l, r)
}

/** Entrada unitária (1.0) em cada canal — útil para testes sem sintetizador. */
export function mixMusicianStereo(
  sf: Showfile,
  m: MusicianStrip,
): { l: number; r: number } {
  const unity = Object.fromEntries(sf.channels.map((c) => [c.id, 1]))
  return mixMusicianStereoFromMonoSources(sf, m, unity)
}

export function floatToS16Stereo(
  l: number,
  r: number,
  samples: number,
): Int16Array {
  const out = new Int16Array(samples * 2)
  for (let i = 0; i < samples; i++) {
    out[i * 2] = Math.max(-32768, Math.min(32767, Math.round(l * 30000)))
    out[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 30000)))
  }
  return out
}
