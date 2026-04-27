import { useEffect, useState } from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'

import {
  consolePalette,
  consoleRadius,
  consoleType,
} from '@inear/design-system'

import { LedButton } from './LedButton'
import { PeqGraphMobile, type PeqBandUi } from './PeqGraphMobile'

export type CompressorUi = {
  enabled: boolean
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  kneeDb: number
  makeupDb: number
}

export type DelayUi = {
  enabled: boolean
  timeMs: number
  feedback: number
  mix: number
  outputDb: number
}

export type ReverbUi = {
  enabled: boolean
  size: number
  decayS: number
  damping: number
  mix: number
  preDelayMs: number
}

const DEFAULT_COMP: CompressorUi = {
  enabled: false,
  thresholdDb: -12,
  ratio: 3,
  attackMs: 12,
  releaseMs: 120,
  kneeDb: 3,
  makeupDb: 0,
}

const DEFAULT_DELAY: DelayUi = {
  enabled: false,
  timeMs: 220,
  feedback: 0.3,
  mix: 0.25,
  outputDb: 0,
}

const DEFAULT_REVERB: ReverbUi = {
  enabled: false,
  size: 0.5,
  decayS: 1.4,
  damping: 0.45,
  mix: 0.2,
  preDelayMs: 12,
}

type Props = {
  visible: boolean
  channelName: string
  channelId: string
  accent: string
  peq: { enabled?: boolean; bands?: PeqBandUi[] } | null
  comp: CompressorUi | null
  delay: DelayUi | null
  reverb: ReverbUi | null
  bypassed: boolean
  onClose: () => void
  onPeqCommit: (next: { enabled: boolean; bands: PeqBandUi[] }) => void
  onPeqLive?: (next: { enabled: boolean; bands: PeqBandUi[] }) => void
  onCompCommit: (next: CompressorUi) => void
  onDelayCommit: (next: DelayUi) => void
  onReverbCommit: (next: ReverbUi) => void
  onToggleBypass: (next: boolean) => void
  onCreateDefaultPeq: () => void
}

/** Modal de FX no mobile: PEQ gráfico + Compressor/Delay/Reverb (accordions) + Bypass. */
export function FxModalMobile({
  visible,
  channelName,
  channelId,
  accent,
  peq,
  comp,
  delay,
  reverb,
  bypassed,
  onClose,
  onPeqCommit,
  onPeqLive,
  onCompCommit,
  onDelayCommit,
  onReverbCommit,
  onToggleBypass,
  onCreateDefaultPeq,
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions()
  const [compOpen, setCompOpen] = useState(false)
  const [delayOpen, setDelayOpen] = useState(false)
  const [reverbOpen, setReverbOpen] = useState(false)
  const peqEnabled = Boolean(peq?.enabled)
  const peqBands = Array.isArray(peq?.bands) ? peq.bands.slice(0, 6) : []
  const compState = comp ?? DEFAULT_COMP
  const delayState = delay ?? DEFAULT_DELAY
  const reverbState = reverb ?? DEFAULT_REVERB

  useEffect(() => {
    if (!visible) {
      setCompOpen(false)
      setDelayOpen(false)
      setReverbOpen(false)
    }
  }, [visible])

  // Largura do gráfico = largura útil do modal (com padding).
  const chartW = Math.min(winW - 32, 520)
  const chartH = Math.max(160, Math.min(220, Math.round(winH * 0.32)))

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <View style={[s.dialog, { borderColor: accent }]}>
          {/* HEADER */}
          <View style={s.header}>
            <View style={[s.headerBar, { backgroundColor: accent }]} />
            <View style={s.headerCol}>
              <Text style={s.headerKicker}>FX · {channelId}</Text>
              <Text style={s.headerTitle} numberOfLines={1}>
                {channelName}
              </Text>
            </View>
            <Pressable
              style={[
                s.bypassBtn,
                bypassed && {
                  borderColor: consolePalette.ledAmber,
                  backgroundColor: 'rgba(255,176,32,0.18)',
                },
              ]}
              onPress={() => onToggleBypass(!bypassed)}
            >
              <Text
                style={[
                  s.bypassBtnTxt,
                  bypassed && { color: consolePalette.ledAmber },
                ]}
              >
                {bypassed ? 'BYPASS ON' : 'BYPASS'}
              </Text>
            </Pressable>
            <Pressable style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeBtnTxt}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            style={s.body}
            contentContainerStyle={{ paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            {bypassed ? (
              <View style={s.warn}>
                <Text style={s.warnTxt}>
                  BYPASS ATIVO — o sinal original (sem PEQ/FX) está indo direto ao
                  fone deste canal. Os ajustes abaixo ficam guardados mas inativos.
                </Text>
              </View>
            ) : null}

            {/* PEQ GRAPH ou botão de criar */}
            <View style={[s.section, bypassed && { opacity: 0.55 }]}>
              <View style={s.sectionHeader}>
                <View
                  style={[
                    s.sectionLed,
                    { backgroundColor: peqEnabled ? accent : '#1c2531' },
                  ]}
                />
                <Text style={s.sectionTitle}>EQUALIZER · PARAMÉTRICO</Text>
                <LedButton
                  label={peqEnabled ? 'ON' : 'OFF'}
                  color="green"
                  on={peqEnabled}
                  width={48}
                  onPress={() => {
                    if (peqBands.length === 0) onCreateDefaultPeq()
                    else onPeqCommit({ enabled: !peqEnabled, bands: peqBands })
                  }}
                />
              </View>

              {peqBands.length === 0 ? (
                <Pressable
                  style={[s.createBtn, { borderColor: accent }]}
                  onPress={onCreateDefaultPeq}
                >
                  <Text style={[s.createBtnTxt, { color: accent }]}>
                    ＋ CRIAR EQ GRÁFICO (6 BANDAS)
                  </Text>
                </Pressable>
              ) : (
                <PeqGraphMobile
                  bands={peqBands}
                  enabled={peqEnabled}
                  accent={accent}
                  width={chartW}
                  height={chartH}
                  onLiveBandsChange={(next) =>
                    onPeqLive?.({ enabled: peqEnabled, bands: next })
                  }
                  onBandsCommit={(next) =>
                    onPeqCommit({ enabled: peqEnabled, bands: next })
                  }
                />
              )}

              {/* Lista compacta com Hz/Gain/Q + toggle por banda */}
              {peqBands.length > 0 ? (
                <View style={s.bandList}>
                  {peqBands.map((b, i) => {
                    const off = b.enabled === false
                    const tint = off
                      ? '#3a4a63'
                      : ['#39ff14', '#5cc8ff', '#ffb020', '#ff5252', '#bf7af0', '#41e0d4'][
                          i % 6
                        ]!
                    return (
                      <View key={`row-${i}`} style={s.bandRow}>
                        <Pressable
                          style={[s.bandNum, { backgroundColor: tint, opacity: off ? 0.5 : 1 }]}
                          onPress={() => {
                            const next = peqBands.map((x, j) =>
                              j === i ? { ...x, enabled: !(x.enabled !== false) } : x,
                            )
                            onPeqCommit({ enabled: peqEnabled, bands: next })
                          }}
                        >
                          <Text style={s.bandNumTxt}>{i + 1}</Text>
                        </Pressable>
                        <Text style={s.bandLbl}>
                          {String(b.type).toUpperCase()}
                        </Text>
                        <View style={s.bandReadout}>
                          <Text style={s.bandReadoutLbl}>FREQ</Text>
                          <Text style={[s.bandReadoutVal, { color: tint }]}>
                            {Math.round(b.freqHz)} Hz
                          </Text>
                        </View>
                        <View style={s.bandReadout}>
                          <Text style={s.bandReadoutLbl}>GAIN</Text>
                          <Text style={[s.bandReadoutVal, { color: tint }]}>
                            {b.gainDb >= 0 ? '+' : ''}
                            {b.gainDb.toFixed(1)} dB
                          </Text>
                        </View>
                        <View style={s.bandReadout}>
                          <Text style={s.bandReadoutLbl}>Q</Text>
                          <Text style={[s.bandReadoutVal, { color: tint }]}>
                            {b.q.toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    )
                  })}
                </View>
              ) : null}
            </View>

            {/* COMPRESSOR ACCORDION */}
            <View style={[s.section, bypassed && { opacity: 0.55 }]}>
              <Pressable
                style={[s.accordionHead, compOpen && s.accordionHeadOpen]}
                onPress={() => setCompOpen((v) => !v)}
              >
                <View
                  style={[
                    s.sectionLed,
                    { backgroundColor: compState.enabled ? accent : '#1c2531' },
                  ]}
                />
                <Text style={s.sectionTitle}>COMPRESSOR (master)</Text>
                <Text style={[s.chevron, compOpen && s.chevronOpen]}>▾</Text>
              </Pressable>

              {compOpen ? (
                <View style={s.accordionBody}>
                  <View style={s.compToggleRow}>
                    <LedButton
                      label={compState.enabled ? 'ON' : 'OFF'}
                      color="green"
                      on={compState.enabled}
                      width={64}
                      onPress={() =>
                        onCompCommit({
                          ...compState,
                          enabled: !compState.enabled,
                        })
                      }
                    />
                    <Text style={s.compHint}>
                      Limita o nível final do mix antes de ir para o fone (proteção
                      auditiva).
                    </Text>
                  </View>
                  <CompRow
                    label="THRESHOLD"
                    accent={accent}
                    value={compState.thresholdDb}
                    min={-60}
                    max={0}
                    unit="dB"
                    onCommit={(v) =>
                      onCompCommit({ ...compState, thresholdDb: v })
                    }
                  />
                  <CompRow
                    label="RATIO"
                    accent={accent}
                    value={compState.ratio}
                    min={1}
                    max={20}
                    unit=":1"
                    onCommit={(v) => onCompCommit({ ...compState, ratio: v })}
                  />
                  <CompRow
                    label="ATTACK"
                    accent={accent}
                    value={compState.attackMs}
                    min={0.1}
                    max={200}
                    unit="ms"
                    onCommit={(v) =>
                      onCompCommit({ ...compState, attackMs: v })
                    }
                  />
                  <CompRow
                    label="RELEASE"
                    accent={accent}
                    value={compState.releaseMs}
                    min={5}
                    max={2000}
                    unit="ms"
                    onCommit={(v) =>
                      onCompCommit({ ...compState, releaseMs: v })
                    }
                  />
                  <CompRow
                    label="MAKEUP"
                    accent={accent}
                    value={compState.makeupDb}
                    min={-12}
                    max={24}
                    unit="dB"
                    onCommit={(v) =>
                      onCompCommit({ ...compState, makeupDb: v })
                    }
                  />
                </View>
              ) : null}
            </View>

            {/* DELAY ACCORDION */}
            <View style={[s.section, bypassed && { opacity: 0.55 }]}>
              <Pressable
                style={[s.accordionHead, delayOpen && s.accordionHeadOpen]}
                onPress={() => setDelayOpen((v) => !v)}
              >
                <View
                  style={[
                    s.sectionLed,
                    {
                      backgroundColor: delayState.enabled
                        ? consolePalette.ledRed
                        : '#1c2531',
                    },
                  ]}
                />
                <Text style={s.sectionTitle}>DELAY (master)</Text>
                <Text style={[s.chevron, delayOpen && s.chevronOpen]}>▾</Text>
              </Pressable>
              {delayOpen ? (
                <View style={s.accordionBody}>
                  <View style={s.compToggleRow}>
                    <LedButton
                      label={delayState.enabled ? 'ON' : 'OFF'}
                      color="red"
                      on={delayState.enabled}
                      width={64}
                      onPress={() =>
                        onDelayCommit({
                          ...delayState,
                          enabled: !delayState.enabled,
                        })
                      }
                    />
                    <Text style={s.compHint}>
                      Eco com tempo, feedback e mistura. Útil para vocais e leads.
                    </Text>
                  </View>
                  <CompRow
                    label="TIME"
                    accent={consolePalette.ledRed}
                    value={delayState.timeMs}
                    min={5}
                    max={1500}
                    unit="ms"
                    onCommit={(v) =>
                      onDelayCommit({ ...delayState, timeMs: v })
                    }
                  />
                  <CompRow
                    label="FEEDBACK"
                    accent={consolePalette.ledRed}
                    value={delayState.feedback * 100}
                    min={0}
                    max={95}
                    unit="%"
                    onCommit={(v) =>
                      onDelayCommit({ ...delayState, feedback: v / 100 })
                    }
                  />
                  <CompRow
                    label="MIX"
                    accent={consolePalette.ledRed}
                    value={delayState.mix * 100}
                    min={0}
                    max={100}
                    unit="%"
                    onCommit={(v) =>
                      onDelayCommit({ ...delayState, mix: v / 100 })
                    }
                  />
                  <CompRow
                    label="OUTPUT"
                    accent={consolePalette.ledRed}
                    value={delayState.outputDb}
                    min={-24}
                    max={6}
                    unit="dB"
                    onCommit={(v) =>
                      onDelayCommit({ ...delayState, outputDb: v })
                    }
                  />
                </View>
              ) : null}
            </View>

            {/* REVERB ACCORDION */}
            <View style={[s.section, bypassed && { opacity: 0.55 }]}>
              <Pressable
                style={[s.accordionHead, reverbOpen && s.accordionHeadOpen]}
                onPress={() => setReverbOpen((v) => !v)}
              >
                <View
                  style={[
                    s.sectionLed,
                    {
                      backgroundColor: reverbState.enabled
                        ? consolePalette.ledBlue
                        : '#1c2531',
                    },
                  ]}
                />
                <Text style={s.sectionTitle}>REVERB (master)</Text>
                <Text style={[s.chevron, reverbOpen && s.chevronOpen]}>▾</Text>
              </Pressable>
              {reverbOpen ? (
                <View style={s.accordionBody}>
                  <View style={s.compToggleRow}>
                    <LedButton
                      label={reverbState.enabled ? 'ON' : 'OFF'}
                      color="blue"
                      on={reverbState.enabled}
                      width={64}
                      onPress={() =>
                        onReverbCommit({
                          ...reverbState,
                          enabled: !reverbState.enabled,
                        })
                      }
                    />
                    <Text style={s.compHint}>
                      Ambiência de sala. Use mix baixo para preservar inteligibilidade.
                    </Text>
                  </View>
                  <CompRow
                    label="SIZE"
                    accent={consolePalette.ledBlue}
                    value={reverbState.size * 100}
                    min={0}
                    max={100}
                    unit="%"
                    onCommit={(v) =>
                      onReverbCommit({ ...reverbState, size: v / 100 })
                    }
                  />
                  <CompRow
                    label="DECAY"
                    accent={consolePalette.ledBlue}
                    value={reverbState.decayS}
                    min={0.2}
                    max={6}
                    unit="s"
                    onCommit={(v) =>
                      onReverbCommit({ ...reverbState, decayS: v })
                    }
                  />
                  <CompRow
                    label="DAMPING"
                    accent={consolePalette.ledBlue}
                    value={reverbState.damping * 100}
                    min={0}
                    max={100}
                    unit="%"
                    onCommit={(v) =>
                      onReverbCommit({ ...reverbState, damping: v / 100 })
                    }
                  />
                  <CompRow
                    label="MIX"
                    accent={consolePalette.ledBlue}
                    value={reverbState.mix * 100}
                    min={0}
                    max={100}
                    unit="%"
                    onCommit={(v) =>
                      onReverbCommit({ ...reverbState, mix: v / 100 })
                    }
                  />
                  <CompRow
                    label="PRE-DELAY"
                    accent={consolePalette.ledBlue}
                    value={reverbState.preDelayMs}
                    min={0}
                    max={200}
                    unit="ms"
                    onCommit={(v) =>
                      onReverbCommit({ ...reverbState, preDelayMs: v })
                    }
                  />
                </View>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function CompRow({
  label,
  accent,
  value,
  min,
  max,
  unit,
  onCommit,
}: {
  label: string
  accent: string
  value: number
  min: number
  max: number
  unit: string
  onCommit: (v: number) => void
}) {
  const fillPct = ((value - min) / (max - min)) * 100
  const display =
    Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(1)
  const dec = () => onCommit(Math.max(min, +(value - (max - min) * 0.05).toFixed(2)))
  const inc = () => onCommit(Math.min(max, +(value + (max - min) * 0.05).toFixed(2)))
  return (
    <View style={s.compRow}>
      <View style={s.compRowHead}>
        <Text style={s.compRowLbl}>{label}</Text>
        <Text style={[s.compRowVal, { color: accent }]}>
          {display} {unit}
        </Text>
      </View>
      <View style={s.compRowControls}>
        <Pressable style={s.compStep} onPress={dec}>
          <Text style={s.compStepTxt}>−</Text>
        </Pressable>
        <View style={s.compTrackOuter}>
          <View
            style={[
              s.compTrackFill,
              { width: `${fillPct}%`, backgroundColor: accent },
            ]}
          />
        </View>
        <Pressable style={s.compStep} onPress={inc}>
          <Text style={s.compStepTxt}>＋</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,4,8,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  dialog: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '94%',
    backgroundColor: consolePalette.bgChassis,
    borderWidth: 1,
    borderRadius: consoleRadius.panel,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: consolePalette.bgScribble,
    borderBottomWidth: 1,
    borderBottomColor: consolePalette.border,
  },
  headerBar: { width: 6, height: 22, borderRadius: 2 },
  headerCol: { flex: 1, minWidth: 0 },
  headerKicker: {
    color: consolePalette.textLo,
    fontFamily: consoleType.fontDigit,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  headerTitle: {
    color: consolePalette.textHi,
    fontFamily: consoleType.fontScribble,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  bypassBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: consolePalette.border,
    backgroundColor: consolePalette.bgRecess,
  },
  bypassBtnTxt: {
    color: consolePalette.textMid,
    fontFamily: consoleType.fontDigit,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 999,
    backgroundColor: consolePalette.bgRecess,
    borderWidth: 1,
    borderColor: consolePalette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnTxt: {
    color: consolePalette.textHi,
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '900',
  },
  body: { paddingHorizontal: 10, paddingTop: 10 },
  warn: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: consolePalette.ledAmber,
    backgroundColor: 'rgba(255,176,32,0.10)',
  },
  warnTxt: {
    color: consolePalette.ledAmber,
    fontFamily: consoleType.fontDigit,
    fontSize: 11,
    lineHeight: 15,
  },
  section: {
    backgroundColor: consolePalette.bgPanel,
    borderRadius: consoleRadius.panel,
    borderWidth: 1,
    borderColor: consolePalette.border,
    padding: 10,
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionLed: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  sectionTitle: {
    color: consolePalette.textMid,
    fontFamily: consoleType.fontDigit,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    flex: 1,
  },
  createBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: consolePalette.bgRecess,
    alignItems: 'center',
    marginVertical: 6,
  },
  createBtnTxt: {
    fontFamily: consoleType.fontDigit,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  bandList: { marginTop: 12, gap: 6 },
  bandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: consolePalette.bgRecess,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  bandNum: {
    width: 22,
    height: 22,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandNumTxt: {
    color: '#06090f',
    fontWeight: '900',
    fontSize: 11,
  },
  bandLbl: {
    color: consolePalette.textHi,
    fontFamily: consoleType.fontDigit,
    fontSize: 10,
    fontWeight: '800',
    width: 56,
  },
  bandReadout: {
    flex: 1,
    backgroundColor: '#040608',
    borderWidth: 1,
    borderColor: '#11202d',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  bandReadoutLbl: {
    color: consolePalette.textLo,
    fontFamily: consoleType.fontDigit,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  bandReadoutVal: {
    fontFamily: consoleType.fontDigit,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 1,
  },
  accordionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  accordionHeadOpen: {
    paddingBottom: 4,
  },
  accordionState: {
    fontFamily: consoleType.fontDigit,
    fontSize: 11,
    fontWeight: '900',
  },
  chevron: {
    color: consolePalette.textLo,
    fontSize: 14,
    width: 14,
    textAlign: 'center',
  },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  accordionBody: {
    marginTop: 6,
    gap: 8,
    backgroundColor: consolePalette.bgRecess,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: consolePalette.border,
    padding: 10,
  },
  compToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  compHint: {
    flex: 1,
    color: consolePalette.textLo,
    fontFamily: consoleType.fontDigit,
    fontSize: 10,
    lineHeight: 14,
  },
  compRow: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: consolePalette.border,
  },
  compRowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  compRowLbl: {
    color: consolePalette.textLo,
    fontFamily: consoleType.fontDigit,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  compRowVal: {
    fontFamily: consoleType.fontDigit,
    fontSize: 11,
    fontWeight: '800',
  },
  compRowControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  compStep: {
    width: 32,
    height: 26,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: consolePalette.border,
    backgroundColor: consolePalette.bgPanel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compStepTxt: {
    color: consolePalette.textHi,
    fontSize: 16,
    lineHeight: 16,
    fontWeight: '900',
  },
  compTrackOuter: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#040608',
    borderWidth: 1,
    borderColor: '#11202d',
    overflow: 'hidden',
  },
  compTrackFill: { height: '100%' },
})
