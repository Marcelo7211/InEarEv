import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'

import { PeqGraph, type PeqBandUi } from './PeqGraph'

export type CompressorUi = {
  enabled: boolean
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  kneeDb: number
  makeupDb: number
}

type FxModalProps = {
  open: boolean
  /** Nome do canal exibido no header. */
  channelName: string
  channelId: string
  accent: string
  /** Estado atual do PEQ deste canal. */
  peq: { enabled?: boolean; bands?: PeqBandUi[] } | null
  /** Estado atual do Compressor master do músico (já é per-músico no protocol). */
  comp: CompressorUi | null
  /** Bypass por canal (skip PEQ/FX no servidor). */
  bypassed: boolean
  /** Fechar modal. */
  onClose: () => void
  /** Persiste mudança no PEQ. */
  onPeqCommit: (next: { enabled: boolean; bands: PeqBandUi[] }) => void
  /** Live (com throttle) durante drag. */
  onPeqLive?: (next: { enabled: boolean; bands: PeqBandUi[] }) => void
  /** Persiste compressor master. */
  onCompCommit: (next: CompressorUi) => void
  /** Liga/desliga bypass por canal. */
  onToggleBypass: (next: boolean) => void
  /** Cria PEQ default quando vazio. */
  onCreateDefaultPeq: () => void
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

export function FxModal({
  open,
  channelName,
  channelId,
  accent,
  peq,
  comp,
  bypassed,
  onClose,
  onPeqCommit,
  onPeqLive,
  onCompCommit,
  onToggleBypass,
  onCreateDefaultPeq,
}: FxModalProps) {
  const [compOpen, setCompOpen] = useState(false)

  const peqEnabled = Boolean(peq?.enabled)
  const peqBands: PeqBandUi[] = useMemo(() => {
    if (Array.isArray(peq?.bands)) {
      return peq.bands.slice(0, 6).map((b) => ({
        type: b.type,
        enabled: b.enabled,
        freqHz: Number(b.freqHz),
        q: Number(b.q),
        gainDb: Number(b.gainDb),
      }))
    }
    return []
  }, [peq])

  const compState = comp ?? DEFAULT_COMP

  // Esc para fechar
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const overlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(2, 4, 8, 0.78)',
    backdropFilter: 'blur(2px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: 24,
  }

  const dialog: CSSProperties = {
    width: 'min(820px, 96vw)',
    maxHeight: '92vh',
    overflowY: 'auto',
    background: 'linear-gradient(180deg,#0e151f 0%, #070b13 100%)',
    border: `1px solid ${accent}`,
    borderRadius: 12,
    boxShadow: `0 30px 80px rgba(0,0,0,.6), 0 0 0 1px ${accent}33`,
    padding: 0,
    color: '#e8eef7',
  }

  return (
    <div
      style={overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div style={dialog} role="dialog" aria-modal="true" aria-label={`FX do canal ${channelName}`}>
        {/* HEADER do modal — barra colorida e botões. */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 14px',
            borderBottom: '1px solid #1e2a3c',
            background: '#0e1825',
          }}
        >
          <span
            style={{
              width: 8,
              height: 26,
              background: accent,
              borderRadius: 2,
              boxShadow: `0 0 8px ${accent}aa`,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                fontSize: 11,
                fontWeight: 900,
                color: '#5b6a82',
                letterSpacing: '0.2em',
              }}
            >
              FX · {channelId}
            </div>
            <div
              style={{
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                fontSize: 16,
                fontWeight: 800,
                color: '#e8eef7',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {channelName}
            </div>
          </div>
          {/* Toggle BYPASS */}
          <button
            type="button"
            onClick={() => onToggleBypass(!bypassed)}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: `1px solid ${bypassed ? '#ffb020' : '#1e2a3c'}`,
              background: bypassed ? 'rgba(255,176,32,0.18)' : '#0a131e',
              color: bypassed ? '#ffb020' : '#9caec6',
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: '0.16em',
              cursor: 'pointer',
              touchAction: 'manipulation',
            }}
            title="Bypass: envia o som original (sem PEQ) para o fone deste canal"
          >
            {bypassed ? '⏸ BYPASS ON' : 'BYPASS'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              border: '1px solid #1e2a3c',
              background: '#0a131e',
              color: '#e8eef7',
              fontSize: 18,
              cursor: 'pointer',
              touchAction: 'manipulation',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        {/* AVISO quando bypass está ON */}
        {bypassed ? (
          <div
            style={{
              margin: 14,
              padding: 10,
              borderRadius: 6,
              background: 'rgba(255,176,32,0.10)',
              border: '1px solid #ffb020',
              color: '#ffb020',
              fontSize: 12,
              fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
              letterSpacing: '0.04em',
            }}
          >
            BYPASS ATIVO — o sinal original (sem PEQ/FX) está indo direto ao fone
            deste canal. Os ajustes abaixo ficam guardados mas inativos.
          </div>
        ) : null}

        {/* PEQ GRÁFICO */}
        <div style={{ padding: 14, opacity: bypassed ? 0.55 : 1 }}>
          {peqBands.length === 0 ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                background: '#0a131e',
                border: '1px dashed #1e2a3c',
                borderRadius: 8,
              }}
            >
              <p
                style={{
                  margin: '0 0 12px',
                  color: '#9caec6',
                  fontSize: 13,
                  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                }}
              >
                Este canal ainda não tem EQ paramétrico configurado.
              </p>
              <button
                type="button"
                onClick={onCreateDefaultPeq}
                style={{
                  padding: '10px 18px',
                  borderRadius: 999,
                  border: `1px solid ${accent}`,
                  background: `${accent}22`,
                  color: accent,
                  fontWeight: 800,
                  fontSize: 12,
                  letterSpacing: '0.14em',
                  cursor: 'pointer',
                  touchAction: 'manipulation',
                }}
              >
                ＋ CRIAR EQ GRÁFICO (6 BANDAS)
              </button>
            </div>
          ) : (
            <PeqGraph
              bands={peqBands}
              enabled={peqEnabled}
              accent={accent}
              height={260}
              width={760}
              onLiveBandsChange={(bands) =>
                onPeqLive?.({ enabled: peqEnabled, bands })
              }
              onBandsCommit={(bands) =>
                onPeqCommit({ enabled: peqEnabled, bands })
              }
              onToggleEnabled={(enabled) =>
                onPeqCommit({ enabled, bands: peqBands })
              }
            />
          )}
        </div>

        {/* COMPRESSOR ACCORDION */}
        <div style={{ padding: '0 14px 14px', opacity: bypassed ? 0.55 : 1 }}>
          <button
            type="button"
            onClick={() => setCompOpen((v) => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 14px',
              background: '#0e1825',
              border: '1px solid #1e2a3c',
              borderRadius: compOpen ? '8px 8px 0 0' : 8,
              color: '#e8eef7',
              cursor: 'pointer',
              touchAction: 'manipulation',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: compState.enabled ? accent : '#1c2531',
                boxShadow: compState.enabled ? `0 0 6px ${accent}` : 'none',
              }}
            />
            <span
              style={{
                fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: '0.16em',
                color: '#9caec6',
                flex: 1,
              }}
            >
              COMPRESSOR (master · este músico)
            </span>
            <span
              style={{
                color: '#5b6a82',
                fontSize: 14,
                transform: compOpen ? 'rotate(180deg)' : 'rotate(0)',
                transition: 'transform 0.15s ease',
              }}
            >
              ▾
            </span>
          </button>

          {compOpen ? (
            <div
              style={{
                background: '#070b13',
                border: '1px solid #1e2a3c',
                borderTop: 'none',
                borderRadius: '0 0 8px 8px',
                padding: 14,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 14,
              }}
            >
              <CompToggle
                accent={accent}
                value={compState.enabled}
                onChange={(v) => onCompCommit({ ...compState, enabled: v })}
              />
              <CompSlider
                label="THRESHOLD"
                accent={accent}
                value={compState.thresholdDb}
                min={-60}
                max={0}
                step={0.5}
                unit="dB"
                onCommit={(v) => onCompCommit({ ...compState, thresholdDb: v })}
              />
              <CompSlider
                label="RATIO"
                accent={accent}
                value={compState.ratio}
                min={1}
                max={20}
                step={0.1}
                unit=":1"
                onCommit={(v) => onCompCommit({ ...compState, ratio: v })}
              />
              <CompSlider
                label="ATTACK"
                accent={accent}
                value={compState.attackMs}
                min={0.1}
                max={200}
                step={0.5}
                unit="ms"
                onCommit={(v) => onCompCommit({ ...compState, attackMs: v })}
              />
              <CompSlider
                label="RELEASE"
                accent={accent}
                value={compState.releaseMs}
                min={5}
                max={2000}
                step={5}
                unit="ms"
                onCommit={(v) => onCompCommit({ ...compState, releaseMs: v })}
              />
              <CompSlider
                label="KNEE"
                accent={accent}
                value={compState.kneeDb}
                min={0}
                max={24}
                step={0.5}
                unit="dB"
                onCommit={(v) => onCompCommit({ ...compState, kneeDb: v })}
              />
              <CompSlider
                label="MAKEUP"
                accent={accent}
                value={compState.makeupDb}
                min={-12}
                max={24}
                step={0.5}
                unit="dB"
                onCommit={(v) => onCompCommit({ ...compState, makeupDb: v })}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CompToggle({
  accent,
  value,
  onChange,
}: {
  accent: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div
      style={{
        background: '#040608',
        border: '1px solid #11202d',
        borderRadius: 6,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <span
        style={{
          color: '#5b6a82',
          fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
          fontSize: 9,
          fontWeight: 900,
          letterSpacing: '0.18em',
        }}
      >
        ENABLED
      </span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        style={{
          padding: '8px 18px',
          borderRadius: 999,
          border: `1px solid ${value ? accent : '#1e2a3c'}`,
          background: value ? `${accent}22` : '#0a131e',
          color: value ? accent : '#5b6a82',
          fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: '0.16em',
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
      >
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}

function CompSlider({
  label,
  accent,
  value,
  min,
  max,
  step,
  unit,
  onCommit,
}: {
  label: string
  accent: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  draftRef.current = draft

  useEffect(() => {
    setDraft(value)
  }, [value])

  const fillPct = ((draft - min) / (max - min)) * 100
  const display =
    Math.abs(draft) >= 100 ? Math.round(draft).toString() : draft.toFixed(1)

  const flush = useCallback(() => onCommit(draftRef.current), [onCommit])

  return (
    <div
      style={{
        background: '#040608',
        border: '1px solid #11202d',
        borderRadius: 6,
        padding: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            color: '#5b6a82',
            fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            fontSize: 9,
            fontWeight: 900,
            letterSpacing: '0.16em',
          }}
        >
          {label}
        </span>
        <span
          style={{
            color: accent,
            fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
            fontSize: 10,
            fontWeight: 800,
            textShadow: `0 0 4px ${accent}66`,
          }}
        >
          {display} {unit}
        </span>
      </div>
      <input
        type="range"
        className="inearRange"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={flush}
        onMouseUp={flush}
        onKeyUp={flush}
        style={
          {
            width: '100%',
            ['--fill' as string]: `${fillPct}%`,
            ['--ch-accent' as string]: accent,
          } as CSSProperties
        }
      />
    </div>
  )
}
