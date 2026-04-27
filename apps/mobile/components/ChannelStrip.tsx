import { StyleSheet, Text, View } from 'react-native'

import {
  consolePalette,
  consoleRadius,
  consoleSpacing,
  consoleType,
} from '@inear/design-system'

import { LedButton } from './LedButton'
import { Meter } from './Meter'
import { ScribbleStrip } from './ScribbleStrip'
import { VerticalFader } from './VerticalFader'

type Props = {
  /** Cor do canal (LED stripe). */
  accent: string
  number?: string
  name: string
  subtitle?: string

  /** Volume do send (deste canal para o ouvido do músico). */
  sendValue: number
  sendMin?: number
  sendMax?: number
  onSendCommit: (v: number) => void
  onSendLive?: (v: number) => void

  /** Mute do send. */
  muted: boolean
  onToggleMute: () => void

  /** Solo (visual apenas — recurso pode estar desabilitado). */
  soloAvailable?: boolean
  soloOn?: boolean
  onToggleSolo?: () => void

  /** FX expandido. */
  fxOn?: boolean
  onToggleFx?: () => void

  /** Pan da mesa (-1..1) — knob interativo se onPanCommit definido. */
  pan?: number
  onPanCommit?: (v: number) => void

  /** Nível de input PCM (0..1) para o meter. */
  inputLevel?: number

  /** Largura do strip. */
  width?: number

  /** Callbacks de gestos extras. */
  onLongPressName?: () => void
}

/**
 * Channel strip vertical estilo console (mobile).
 * Layout (de cima para baixo):
 *   ScribbleStrip (cor + número + nome)
 *   Knob de pan (opcional)
 *   LEDs M / S / FX
 *   [Fader vertical | Meter LED | Escala dB]
 */
export function ChannelStrip({
  accent,
  number,
  name,
  subtitle,
  sendValue,
  sendMin = 0,
  sendMax = 4,
  onSendCommit,
  onSendLive,
  muted,
  onToggleMute,
  soloAvailable = false,
  soloOn = false,
  onToggleSolo,
  fxOn = false,
  onToggleFx,
  pan,
  onPanCommit,
  inputLevel = 0,
  width = consoleSpacing.stripWidth,
  onLongPressName,
}: Props) {
  return (
    <View style={[s.box, { width, borderColor: muted ? consolePalette.ledRed : consolePalette.borderMetal }]}>
      <View style={{ alignItems: 'center' }}>
        <ScribbleStrip
          accent={accent}
          number={number}
          name={name}
          subtitle={subtitle}
          width={width - consoleSpacing.stripPadding * 2}
        />
      </View>

      {pan != null && onPanCommit ? (
        <View style={s.knobRow}>
          <PanKnobBadge pan={pan} accent={accent} onCommit={onPanCommit} />
        </View>
      ) : (
        <View style={s.knobSpacer} />
      )}

      <View style={s.btnRow}>
        <LedButton
          label="M"
          color="red"
          on={muted}
          onPress={onToggleMute}
          width={(width - consoleSpacing.stripPadding * 2) / 3 - 2}
        />
        <LedButton
          label="S"
          color="amber"
          on={soloOn}
          disabled={!soloAvailable}
          onPress={onToggleSolo}
          width={(width - consoleSpacing.stripPadding * 2) / 3 - 2}
        />
        <LedButton
          label="FX"
          color="blue"
          on={fxOn}
          onPress={onToggleFx}
          width={(width - consoleSpacing.stripPadding * 2) / 3 - 2}
        />
      </View>

      <View style={s.faderArea}>
        <VerticalFader
          value={sendValue}
          min={sendMin}
          max={sendMax}
          onCommit={onSendCommit}
          onLiveChange={onSendLive}
          accent={accent}
          showScale
          showReadout
          resetValue={1}
        />
        <View style={s.meterCol}>
          <Meter level={inputLevel} height={consoleSpacing.faderTrackHeight} width={consoleSpacing.meterWidth} />
        </View>
      </View>

      {onLongPressName ? (
        <Text
          onLongPress={onLongPressName}
          numberOfLines={1}
          style={s.footerLabel}
        >
          {name}
        </Text>
      ) : null}
    </View>
  )
}

function PanKnobBadge({
  pan,
  accent,
  onCommit,
}: {
  pan: number
  accent: string
  onCommit: (v: number) => void
}) {
  const display = pan < -0.35 ? 'L' : pan > 0.35 ? 'R' : 'C'
  return (
    <View style={s.panBadgeBox}>
      <View style={[s.panLabelBar, { backgroundColor: '#0d1825' }]}>
        <Text style={s.panLbl}>PAN</Text>
        <Text style={[s.panVal, { color: accent }]}>{display}</Text>
      </View>
      <View style={s.panBar}>
        <View
          style={[
            s.panFill,
            {
              backgroundColor: accent,
              left: pan < 0 ? `${50 + pan * 50}%` : '50%',
              width: `${Math.abs(pan) * 50}%`,
            },
          ]}
        />
        <View style={s.panCenter} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  box: {
    backgroundColor: consolePalette.bgPanel,
    borderRadius: consoleRadius.panel,
    borderWidth: 1,
    padding: consoleSpacing.stripPadding,
    alignItems: 'center',
    gap: 6,
  },
  knobRow: { width: '100%' },
  knobSpacer: { height: 6 },
  btnRow: {
    flexDirection: 'row',
    gap: 2,
    width: '100%',
    justifyContent: 'space-between',
  },
  faderArea: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingTop: 4,
  },
  meterCol: { marginLeft: 2 },
  footerLabel: {
    color: consolePalette.textLo,
    fontSize: 9,
    fontFamily: consoleType.fontScribble,
    marginTop: 2,
  },
  panBadgeBox: {
    width: '100%',
    backgroundColor: consolePalette.bgRecess,
    borderRadius: consoleRadius.strip,
    borderWidth: 1,
    borderColor: consolePalette.border,
    overflow: 'hidden',
  },
  panLabelBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  panLbl: {
    color: consolePalette.textLo,
    fontFamily: consoleType.fontUi,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  panVal: {
    fontFamily: consoleType.fontDigit,
    fontSize: 10,
    fontWeight: '900',
  },
  panBar: {
    height: 4,
    backgroundColor: consolePalette.faderTrackInner,
    position: 'relative',
  },
  panFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  panCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '50%',
    width: 1,
    marginLeft: -0.5,
    backgroundColor: consolePalette.textMid,
    opacity: 0.4,
  },
})
