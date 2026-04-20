export type ChannelIconId =
  | 'kick'
  | 'snare'
  | 'tom1'
  | 'tom2'
  | 'floor'
  | 'hihat'
  | 'crash'
  | 'ride'
  | 'overhead'
  | 'bass'
  | 'guitar'
  | 'keys'
  | 'vocal'
  | 'click'
  | 'track'
  | 'mic'

export type ChannelIconOption = {
  id: ChannelIconId
  badge: string
  label: string
}

export const CHANNEL_ICON_OPTIONS: ChannelIconOption[] = [
  { id: 'kick', badge: 'KD', label: 'Kick' },
  { id: 'snare', badge: 'SD', label: 'Caixa' },
  { id: 'tom1', badge: 'T1', label: 'Tom 1' },
  { id: 'tom2', badge: 'T2', label: 'Tom 2' },
  { id: 'floor', badge: 'FT', label: 'Surdo' },
  { id: 'hihat', badge: 'HH', label: 'Chimbal' },
  { id: 'crash', badge: 'CR', label: 'Crash' },
  { id: 'ride', badge: 'RD', label: 'Ride' },
  { id: 'overhead', badge: 'OH', label: 'Overhead' },
  { id: 'bass', badge: 'BS', label: 'Baixo' },
  { id: 'guitar', badge: 'GT', label: 'Guitarra' },
  { id: 'keys', badge: 'KY', label: 'Teclado' },
  { id: 'vocal', badge: 'VO', label: 'Voz' },
  { id: 'click', badge: 'CL', label: 'Click' },
  { id: 'track', badge: 'TR', label: 'Track' },
  { id: 'mic', badge: 'MC', label: 'Mic' },
]

export const DEFAULT_CHANNEL_COLORS = [
  '#58a6ff',
  '#2ea043',
  '#d29922',
  '#f85149',
  '#a371f7',
  '#39c5cf',
  '#db61a2',
  '#f0883e',
] as const

function normalizeHex(input?: string): string | undefined {
  if (typeof input !== 'string') return undefined
  const raw = input.trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(raw)) return undefined
  return raw.startsWith('#') ? raw.toLowerCase() : `#${raw.toLowerCase()}`
}

function hashText(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0
  }
  return h
}

export function channelIconBadge(icon?: string): string {
  return CHANNEL_ICON_OPTIONS.find((x) => x.id === icon)?.badge ?? 'CH'
}

export function channelIconLabel(icon?: string): string {
  return CHANNEL_ICON_OPTIONS.find((x) => x.id === icon)?.label ?? 'Canal'
}

export function channelAccentColor(input: {
  id: string
  color?: string
  captureInputIndex?: number
}): string {
  const explicit = normalizeHex(input.color)
  if (explicit) return explicit
  if (
    typeof input.captureInputIndex === 'number' &&
    Number.isFinite(input.captureInputIndex) &&
    input.captureInputIndex >= 0
  ) {
    return DEFAULT_CHANNEL_COLORS[
      Math.floor(input.captureInputIndex) % DEFAULT_CHANNEL_COLORS.length
    ]!
  }
  return DEFAULT_CHANNEL_COLORS[hashText(input.id) % DEFAULT_CHANNEL_COLORS.length]!
}

export function normalizeChannelColor(color?: string): string | undefined {
  return normalizeHex(color)
}
