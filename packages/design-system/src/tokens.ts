/**
 * Tokens visuais "console" compartilhados entre mobile (RN) e desktop (web).
 * Sem dependência de runtime — só constantes — para poderem ser importadas
 * tanto em StyleSheet (RN) quanto em CSSProperties (React DOM).
 */

export const consolePalette = {
  /** Fundo profundo do gabinete da mesa (quase preto). */
  bgChassis: '#05080d',
  /** Painel do channel strip. */
  bgPanel: '#0b1118',
  /** Painel elevado / scribble strip (cor do bloco de etiqueta). */
  bgScribble: '#0e1825',
  /** Linhas / chanfros internos. */
  bgRail: '#121a26',
  /** Sub-superfície (recessed). */
  bgRecess: '#070b11',
  /** Borda padrão de strips e cartões. */
  border: '#1e2a3c',
  /** Borda "metalizada" (separação entre strips). */
  borderMetal: '#2a394f',
  /** Borda destacada (foco / strip selecionado). */
  borderHi: '#3d5a8a',

  /** Texto principal (display). */
  textHi: '#e8eef7',
  /** Texto secundário (labels / unidades). */
  textMid: '#9caec6',
  /** Texto muted (off / desativado). */
  textLo: '#5b6a82',
  /** Texto sobre cor de canal (escuro). */
  textOnAccent: '#06090f',

  /** LED verde aceso (sinal/power). */
  ledGreen: '#39ff14',
  ledGreenDim: '#143a1a',
  /** LED âmbar (warn / pré-clip). */
  ledAmber: '#ffb020',
  ledAmberDim: '#3a2a0a',
  /** LED vermelho (clip / mute / over). */
  ledRed: '#ff3b3b',
  ledRedDim: '#3a1414',
  /** LED azul (status info / solo isolation). */
  ledBlue: '#4ea3ff',
  ledBlueDim: '#0e2542',

  /** Cobertura do knob. */
  knobBody: '#15202e',
  knobBezel: '#3a4a63',
  knobIndicator: '#f0f6fc',

  /** Cap do fader (thumb). */
  faderCap: '#cfd5df',
  faderCapEdge: '#3b4356',
  /** Trilho do fader. */
  faderTrack: '#070b11',
  faderTrackInner: '#13202e',

  /** Verde "preenchimento" padrão dos faders verticais. */
  faderFill: '#33b04a',
  faderFillTop: '#7af07a',
  /** Vermelho topo do fader (zona acima de 0 dB). */
  faderFillOver: '#ff3b3b',

  /** Fundo do segmento de meter "off". */
  meterOff: '#0a131e',
} as const

export type ConsoleColor = keyof typeof consolePalette

/** Cores "da mesa" para o accent de canal — versão calibrada para LED look. */
export const channelAccents = [
  '#5cc8ff', // ciano
  '#39ff14', // verde
  '#ffb020', // âmbar
  '#ff5252', // vermelho
  '#bf7af0', // violeta
  '#41e0d4', // turquesa
  '#ff7ab8', // magenta
  '#ff8a3d', // laranja
] as const

export const consoleSpacing = {
  /** Gap padrão entre strips. */
  stripGap: 4,
  /** Padding interno de cada strip. */
  stripPadding: 6,
  /** Largura padrão do channel strip vertical (mobile). */
  stripWidth: 76,
  /** Largura compacta (overview). */
  stripWidthCompact: 44,
  /** Altura do scribble strip. */
  scribbleHeight: 28,
  /** Altura padrão do trilho do fader vertical. */
  faderTrackHeight: 200,
  /** Altura do cap (thumb) do fader. */
  faderCapHeight: 22,
  /** Largura do cap do fader. */
  faderCapWidth: 38,
  /** Largura do trilho do fader vertical. */
  faderTrackWidth: 16,
  /** Largura do meter LED ao lado do fader. */
  meterWidth: 8,
  /** Tamanho do botão M/S/FX. */
  ledButton: 26,
  /** Diâmetro padrão do knob. */
  knobSize: 44,
} as const

export const consoleType = {
  /** Tipografia "scribble" (etiqueta), monoespaçada para evocar Dymo. */
  fontScribble:
    'ui-monospace, Menlo, Consolas, "Roboto Mono", "Courier New", monospace',
  /** Display digital (números). */
  fontDigit:
    'ui-monospace, Menlo, Consolas, "Roboto Mono", "Courier New", monospace',
  fontUi:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',

  sizeScribble: 11,
  sizeLabel: 10,
  sizeDigit: 11,
  sizeBadge: 10,
  sizeChName: 12,
} as const

export const consoleRadius = {
  strip: 6,
  panel: 10,
  led: 999,
  knob: 999,
  capsule: 999,
} as const

/**
 * Escala de dB padrão (fader vertical 0..2 linear ↔ -∞..+6 dB).
 * Cada tick é fração 0..1 a partir do fundo.
 */
export const faderScaleTicks: { pct: number; label: string; major?: boolean }[] = [
  { pct: 1.0, label: '+6', major: true },
  { pct: 0.85, label: '+3' },
  { pct: 0.7, label: '0', major: true },
  { pct: 0.55, label: '-5' },
  { pct: 0.42, label: '-10', major: true },
  { pct: 0.3, label: '-20' },
  { pct: 0.18, label: '-30' },
  { pct: 0.08, label: '-50' },
  { pct: 0.0, label: '-∞', major: true },
]

/**
 * Segmentos de um meter LED 0..1 (linear) — 12 LEDs.
 * Cor por nível: verde, verde, verde, verde, verde, verde, verde, âmbar, âmbar, âmbar, vermelho, vermelho.
 */
export type MeterSegmentColor = 'green' | 'amber' | 'red'

export const meterSegments: { threshold: number; color: MeterSegmentColor }[] = [
  { threshold: 0.04, color: 'green' },
  { threshold: 0.1, color: 'green' },
  { threshold: 0.18, color: 'green' },
  { threshold: 0.28, color: 'green' },
  { threshold: 0.4, color: 'green' },
  { threshold: 0.52, color: 'green' },
  { threshold: 0.64, color: 'green' },
  { threshold: 0.74, color: 'amber' },
  { threshold: 0.83, color: 'amber' },
  { threshold: 0.9, color: 'amber' },
  { threshold: 0.96, color: 'red' },
  { threshold: 0.99, color: 'red' },
]

export function meterSegmentColor(seg: MeterSegmentColor): string {
  if (seg === 'red') return consolePalette.ledRed
  if (seg === 'amber') return consolePalette.ledAmber
  return consolePalette.ledGreen
}

export function meterSegmentDimColor(seg: MeterSegmentColor): string {
  if (seg === 'red') return consolePalette.ledRedDim
  if (seg === 'amber') return consolePalette.ledAmberDim
  return consolePalette.ledGreenDim
}
