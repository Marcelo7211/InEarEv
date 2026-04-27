import { StyleSheet, Text, View } from 'react-native'

import {
  consolePalette,
  consoleRadius,
  consoleSpacing,
  consoleType,
} from '@inear/design-system'

type Props = {
  /** Cor de canal (top stripe). */
  accent: string
  /** Número do canal "01"..."32". */
  number?: string
  /** Nome do canal (linha grande). */
  name: string
  /** Linha auxiliar pequena (ex.: "Entrada PCM 3"). */
  subtitle?: string
  /** Largura externa do strip (default = stripWidth do tema). */
  width?: number
  /** Variante para overview (mais compacta). */
  compact?: boolean
}

/**
 * Etiqueta de canal estilo "scribble strip" das mesas analógicas.
 * Topo: faixa colorida com o número.
 * Corpo: nome (mono) + subtítulo opcional.
 */
export function ScribbleStrip({
  accent,
  number,
  name,
  subtitle,
  width,
  compact = false,
}: Props) {
  const w = width ?? (compact ? consoleSpacing.stripWidthCompact : consoleSpacing.stripWidth)
  return (
    <View style={[s.box, { width: w }]}>
      <View style={[s.bar, { backgroundColor: accent }]}>
        {number ? <Text style={s.barTxt}>{number}</Text> : null}
      </View>
      <View style={[s.body, compact && s.bodyCompact]}>
        <Text
          style={[s.name, compact && s.nameCompact]}
          numberOfLines={compact ? 1 : 2}
        >
          {name}
        </Text>
        {!compact && subtitle ? (
          <Text style={s.sub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  box: {
    borderRadius: consoleRadius.strip,
    overflow: 'hidden',
    backgroundColor: consolePalette.bgScribble,
    borderWidth: 1,
    borderColor: consolePalette.border,
  },
  bar: {
    paddingVertical: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTxt: {
    color: consolePalette.textOnAccent,
    fontFamily: consoleType.fontDigit,
    fontSize: consoleType.sizeDigit,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  body: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyCompact: { minHeight: 18, paddingVertical: 2 },
  name: {
    color: consolePalette.textHi,
    fontFamily: consoleType.fontScribble,
    fontSize: consoleType.sizeScribble,
    fontWeight: '700',
    textAlign: 'center',
  },
  nameCompact: { fontSize: 9 },
  sub: {
    color: consolePalette.textMid,
    fontFamily: consoleType.fontScribble,
    fontSize: 9,
    marginTop: 2,
    textAlign: 'center',
  },
})
