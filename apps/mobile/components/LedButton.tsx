import { Pressable, StyleSheet, Text, View } from 'react-native'

import {
  consolePalette,
  consoleRadius,
  consoleSpacing,
  consoleType,
} from '@inear/design-system'

export type LedColor = 'red' | 'amber' | 'green' | 'blue'

type Props = {
  label: string
  /** Estado latch — pintura forte quando true. */
  on?: boolean
  /** Cor do LED quando aceso (default red para mute). */
  color?: LedColor
  disabled?: boolean
  onPress?: () => void
  onLongPress?: () => void
  /** Largura customizada (default ledButton size). */
  width?: number
  /** Mostrar indicador LED separado em vez de pintar todo o corpo. */
  withDot?: boolean
}

const ledOnColor = (c: LedColor): string => {
  if (c === 'green') return consolePalette.ledGreen
  if (c === 'amber') return consolePalette.ledAmber
  if (c === 'blue') return consolePalette.ledBlue
  return consolePalette.ledRed
}

const ledDimColor = (c: LedColor): string => {
  if (c === 'green') return consolePalette.ledGreenDim
  if (c === 'amber') return consolePalette.ledAmberDim
  if (c === 'blue') return consolePalette.ledBlueDim
  return consolePalette.ledRedDim
}

/**
 * Botão "latch" estilo console com LED.
 * - Idle: superfície escura.
 * - On: borda + LED brilhantes da cor selecionada.
 */
export function LedButton({
  label,
  on = false,
  color = 'red',
  disabled = false,
  onPress,
  onLongPress,
  width,
  withDot = true,
}: Props) {
  const accent = ledOnColor(color)
  const dim = ledDimColor(color)
  const w = width ?? consoleSpacing.ledButton
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || (!onPress && !onLongPress)}
      style={({ pressed }) => [
        s.btn,
        { width: w },
        on && {
          borderColor: accent,
          backgroundColor: dim,
          shadowColor: accent,
          shadowOpacity: 0.6,
          shadowRadius: 4,
        },
        pressed && s.pressed,
        disabled && s.disabled,
      ]}
    >
      <Text style={[s.label, on && { color: accent }, disabled && s.labelDisabled]}>
        {label}
      </Text>
      {withDot ? (
        <View
          style={[
            s.dot,
            { backgroundColor: on ? accent : '#1b2531', borderColor: on ? accent : '#283449' },
          ]}
        />
      ) : null}
    </Pressable>
  )
}

const s = StyleSheet.create({
  btn: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: consoleRadius.strip,
    backgroundColor: '#0d141d',
    borderWidth: 1,
    borderColor: '#1f2a3a',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  label: {
    color: consolePalette.textMid,
    fontFamily: consoleType.fontUi,
    fontSize: consoleType.sizeBadge,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  labelDisabled: { color: consolePalette.textLo },
  dot: {
    marginTop: 2,
    width: 5,
    height: 5,
    borderRadius: consoleRadius.led,
    borderWidth: 1,
  },
})
