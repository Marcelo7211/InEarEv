import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, getApiBase } from './api'
import type { Showfile } from '@inear/protocol'
import {
  CHANNEL_ICON_OPTIONS,
  channelAccentColor,
  channelIconBadge,
  MVP_MAX_CAPTURE_CHANNELS,
  retornoMixerChannelOrder,
} from '@inear/protocol'

type Role = 'admin' | 'musician'

/** Sessão vinda da URL (Expo Go / WebView) — evita segundo login no painel web. */
function readUrlAuth():
  | { token: string; role: Role }
  | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search)
  const t = p.get('inear_token')
  const r = p.get('inear_role')
  if (!t || (r !== 'admin' && r !== 'musician')) return null
  return { token: t, role: r }
}

export function AdminApp() {
  const [token, setToken] = useState<string | null>(() => {
    const url = readUrlAuth()
    if (url) {
      localStorage.setItem('inear_token', url.token)
      localStorage.setItem('inear_role', url.role)
      return url.token
    }
    return localStorage.getItem('inear_token')
  })
  const [role, setRole] = useState<Role | null>(() => {
    const url = readUrlAuth()
    if (url) return url.role
    return (localStorage.getItem('inear_role') as Role | null) ?? null
  })
  const [showfile, setShowfile] = useState<Showfile | null>(null)
  const [pairCode, setPairCode] = useState<string | null>(null)
  const [pairExpiry, setPairExpiry] = useState<number | null>(null)
  const [tab, setTab] = useState<
    | 'session'
    | 'channels'
    | 'musicians'
    | 'network'
    | 'pairing'
    | 'audio'
  >('session')
  const [error, setError] = useState<string | null>(null)
  const [loginUser, setLoginUser] = useState('admin')
  const [loginPass, setLoginPass] = useState('admin123')
  const [pairLoginCode, setPairLoginCode] = useState('')
  const [pairLoginUser, setPairLoginUser] = useState('musician1')

  const authHeaders = useMemo(() => ({ token }), [token])

  const refreshShowfile = useCallback(async () => {
    if (!token) return
    const sf = await api<Showfile>('/api/showfile', { ...authHeaders })
    setShowfile(sf)
  }, [token, authHeaders])

  useEffect(() => {
    if (token) {
      refreshShowfile().catch((e) => setError(String(e.message)))
    }
  }, [token, refreshShowfile])

  /** Remove JWT da barra de endereço após consumir (mantém ?api= para refresh). */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (!url.searchParams.has('inear_token')) return
    url.searchParams.delete('inear_token')
    url.searchParams.delete('inear_role')
    const q = url.searchParams.toString()
    window.history.replaceState({}, document.title, url.pathname + (q ? `?${q}` : ''))
  }, [])

  async function login() {
    setError(null)
    try {
      const r = await api<{ token: string; role: Role }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: loginUser,
          password: loginPass,
        }),
      })
      setToken(r.token)
      setRole(r.role)
      localStorage.setItem('inear_token', r.token)
      localStorage.setItem('inear_role', r.role)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  async function pairLogin() {
    setError(null)
    try {
      const r = await api<{ token: string; role: Role }>(
        '/api/auth/pair-login',
        {
          method: 'POST',
          body: JSON.stringify({
            code: pairLoginCode,
            username: pairLoginUser,
          }),
        },
      )
      setToken(r.token)
      setRole(r.role)
      localStorage.setItem('inear_token', r.token)
      localStorage.setItem('inear_role', r.role)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  async function generatePairing() {
    setError(null)
    try {
      const r = await api<{ code: string; expiresAt: number }>(
        '/api/admin/pairing-code',
        { method: 'POST', ...authHeaders, body: JSON.stringify({}) },
      )
      setPairCode(r.code)
      setPairExpiry(r.expiresAt)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  async function saveNetworkProfile(
    networkProfile: Showfile['networkProfile'],
  ) {
    setError(null)
    try {
      await api('/api/showfile/meta', {
        method: 'PATCH',
        ...authHeaders,
        body: JSON.stringify({ networkProfile }),
      })
      await refreshShowfile()
    } catch (e) {
      setError(String((e as Error).message))
    }
  }

  function logout() {
    setToken(null)
    setRole(null)
    setShowfile(null)
    localStorage.removeItem('inear_token')
    localStorage.removeItem('inear_role')
  }

  if (!token || !role) {
    return (
      <main
        style={{
          padding: 24,
          maxWidth: 480,
          margin: '0 auto',
          minHeight: '100vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <h1 style={{ marginTop: 0 }}>inEar — login</h1>
        <p style={{ color: '#9aa0a6' }}>API: {getApiBase()}</p>
        <aside
          style={{
            background: '#1a2332',
            border: '1px solid #394457',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
            color: '#bdc1c6',
          }}
        >
          <strong>Contas de teste (primeira execução)</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li>
              <strong>Admin:</strong> usuário <code>admin</code> · senha{' '}
              <code>admin123</code>
            </li>
            <li>
              <strong>Músico 1:</strong> <code>musician1</code> · senha{' '}
              <code>musician1</code>
            </li>
            <li>
              <strong>Músico 2:</strong> <code>musician2</code> · senha{' '}
              <code>musician2</code>
            </li>
          </ul>
          <p style={{ margin: '8px 0 0', color: '#9aa0a6' }}>
            O JWT aparece no navegador após entrar (localStorage). Para o app
            Android/Expo preview, use login abaixo — o token é retornado no JSON
            da API.
          </p>
        </aside>
        {error && <p style={{ color: '#f28b82' }}>{error}</p>}
        <h2>Admin / músico (senha)</h2>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Usuário
          <input
            style={{ width: '100%', marginTop: 4 }}
            value={loginUser}
            onChange={(e) => setLoginUser(e.target.value)}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Senha
          <input
            type="password"
            style={{ width: '100%', marginTop: 4 }}
            value={loginPass}
            onChange={(e) => setLoginPass(e.target.value)}
          />
        </label>
        <button type="button" onClick={login}>
          Entrar
        </button>
        <hr style={{ margin: '24px 0', borderColor: '#333' }} />
        <h2>Músico — pairing</h2>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Código (6 dígitos)
          <input
            style={{ width: '100%', marginTop: 4 }}
            value={pairLoginCode}
            onChange={(e) => setPairLoginCode(e.target.value)}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Usuário músico
          <input
            style={{ width: '100%', marginTop: 4 }}
            value={pairLoginUser}
            onChange={(e) => setPairLoginUser(e.target.value)}
          />
        </label>
        <button type="button" onClick={pairLogin}>
          Entrar com código
        </button>
      </main>
    )
  }

  const selfMusician = showfile?.musicians.find(
    (m) => m.username === (token ? parseJwtSub(token) : ''),
  )

  return (
    <main
      style={{
        padding: 24,
        minHeight: '100vh',
        overflowY: 'auto',
        boxSizing: 'border-box',
        background:
          'radial-gradient(circle at top left, rgba(88,166,255,.10), transparent 22%), linear-gradient(180deg,#0b0f15 0%,#10151d 100%)',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          padding: 16,
          border: '1px solid #273244',
          borderRadius: 18,
          background: 'linear-gradient(180deg,#171e29 0%,#10151d 100%)',
        }}
      >
        <h1 style={{ margin: 0 }}>inEar — painel ({role})</h1>
        <button type="button" onClick={logout}>
          Sair
        </button>
      </header>
      {error && <p style={{ color: '#f28b82' }}>{error}</p>}
      <nav
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 16,
          flexWrap: 'wrap',
          padding: 10,
          border: '1px solid #273244',
          borderRadius: 18,
          background: '#121923',
        }}
      >
        {role === 'admin' && (
          <>
            {(
              [
                ['session', 'Sessão'],
                ['channels', 'Canais'],
                ['musicians', 'Músicos'],
                ['network', 'Rede'],
                ['audio', 'Entrada Mac'],
                ['pairing', 'Pairing'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                style={{
                  fontWeight: tab === k ? 700 : 400,
                  background: tab === k ? '#394457' : '#252a33',
                  color: '#e8eaed',
                  border: '1px solid #444',
                  borderRadius: 6,
                  padding: '6px 12px',
                }}
              >
                {label}
              </button>
            ))}
          </>
        )}
        {role === 'musician' && (
          <span style={{ color: '#9aa0a6' }}>
            Mix: faders de send por canal abaixo (após o técnico sincronizar as faixas
            no Mac). Retorno WebSocket no app móvel.
          </span>
        )}
      </nav>

      {!showfile && <p>Carregando showfile…</p>}

      {showfile && role === 'admin' && tab === 'session' && (
        <section
          style={{
            border: '1px solid #2d394d',
            borderRadius: 18,
            padding: 18,
            background: 'linear-gradient(180deg,#171d28 0%,#0f141c 100%)',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Sessão</h2>
          <p>
            HTTP <code>{getApiBase()}</code> · UDP áudio{' '}
            <code>:9876</code> · UDP controle <code>:9877</code>
          </p>
          <p>Showfile: {showfile.name}</p>
          <p>Perfil Wi‑Fi: {showfile.networkProfile}</p>
          <p style={{ color: '#9aa0a6', maxWidth: 640 }}>
            Canais da mesa: com a captura ativa, <strong>Sincronizar canais da interface</strong>{' '}
            cria <code>if_0</code>… conforme o N definido em <strong>Entrada Mac</strong>. Depois
            abre <strong>Canais</strong> para gain/pan (admin) e entra como músico para sends no
            ouvido.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={() => refreshShowfile()}>
              Recarregar showfile
            </button>
            <button
              type="button"
              onClick={async () => {
                setError(null)
                try {
                  const sess = await api<{ captureChannelCount?: number }>(
                    '/api/session',
                    { token },
                  )
                  const serverN = Math.max(
                    1,
                    Math.min(
                      MVP_MAX_CAPTURE_CHANNELS,
                      Math.floor(Number(sess.captureChannelCount)) || 2,
                    ),
                  )
                  const nFromSf = showfile.channels.filter((c) =>
                    /^if_\d+$/.test(c.id),
                  ).length
                  const channelCount = Math.max(
                    1,
                    Math.min(
                      MVP_MAX_CAPTURE_CHANNELS,
                      Math.max(serverN, nFromSf > 0 ? nFromSf : 0, 2),
                    ),
                  )
                  await api('/api/showfile/sync-interface-channels', {
                    method: 'POST',
                    token,
                    body: JSON.stringify({ channelCount }),
                  })
                  await refreshShowfile()
                } catch (e) {
                  setError(String((e as Error).message))
                }
              }}
            >
              Sincronizar faixas (N = max. showfile if_* e N do servidor)
            </button>
          </div>
        </section>
      )}

      {showfile && role === 'admin' && tab === 'channels' && (
        <ChannelTable
          token={token}
          showfile={showfile}
          onSaved={refreshShowfile}
        />
      )}

      {showfile && role === 'admin' && tab === 'musicians' && (
        <MusicianTable showfile={showfile} token={token} onSaved={refreshShowfile} />
      )}

      {showfile && role === 'admin' && tab === 'audio' && (
        <section
          style={{
            border: '1px solid #2d394d',
            borderRadius: 18,
            padding: 18,
            background: 'linear-gradient(180deg,#171d28 0%,#0f141c 100%)',
          }}
        >
          <MacAudioInputsPanel
            token={token}
            role={role}
            onError={setError}
            onSyncedShowfile={refreshShowfile}
          />
        </section>
      )}

      {showfile && role === 'admin' && tab === 'network' && (
        <section
          style={{
            border: '1px solid #2d394d',
            borderRadius: 18,
            padding: 18,
            background: 'linear-gradient(180deg,#171d28 0%,#0f141c 100%)',
          }}
        >
          <h2>Perfil de rede (MVP)</h2>
          <p style={{ color: '#9aa0a6', maxWidth: 640 }}>
            2,4 GHz usa blocos maiores (mais latência, mais robustez). 5 GHz /
            auto usam blocos menores. Documentação em README (projeto).
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['wifi_2_4', 'wifi_5', 'auto'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => saveNetworkProfile(p)}
                style={{
                  background: showfile.networkProfile === p ? '#394457' : '#252a33',
                  color: '#e8eaed',
                  border: '1px solid #555',
                  borderRadius: 6,
                  padding: '8px 14px',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </section>
      )}

      {showfile && role === 'admin' && tab === 'pairing' && (
        <section
          style={{
            border: '1px solid #2d394d',
            borderRadius: 18,
            padding: 18,
            background: 'linear-gradient(180deg,#171d28 0%,#0f141c 100%)',
          }}
        >
          <h2>Código para músicos</h2>
          <button type="button" onClick={generatePairing}>
            Gerar código (6 dígitos)
          </button>
          {pairCode && (
            <p style={{ fontSize: 28, letterSpacing: 6 }}>{pairCode}</p>
          )}
          {pairExpiry && (
            <p style={{ color: '#9aa0a6' }}>
              expira em {new Date(pairExpiry).toLocaleString()}
            </p>
          )}
        </section>
      )}

      {showfile && role === 'musician' && !selfMusician && (
        <section
          style={{
            border: '1px solid #a371f7',
            borderRadius: 8,
            padding: 16,
            background: '#1f1a2e',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Perfil de músico não encontrado</h2>
          <p style={{ color: '#e8eaed' }}>
            O token não corresponde a nenhum <code>username</code> em{' '}
            <code>showfile.musicians</code>. Volta a entrar com{' '}
            <code>musician1</code> / <code>musician1</code> (ou o par correto deste
            showfile).
          </p>
        </section>
      )}

      {showfile && role === 'musician' && selfMusician && (
        <>
          <MacAudioInputsPanel
            token={token}
            role={role}
            onError={setError}
            onSyncedShowfile={refreshShowfile}
          />
          <MusicianControls
            token={token}
            showfile={showfile}
            musician={selfMusician}
            onSaved={refreshShowfile}
          />
        </>
      )}
    </main>
  )
}

type CaptureInputMatrix = {
  gainL: number
  gainR: number
  assign: Record<string, 'sum' | 'L' | 'R'>
  gainByIndex?: Record<string, number>
}

type AudioCaptureDevicesRes = {
  platform: string
  ffprobeFound?: boolean
  devices: {
    index: number
    name: string
    inputChannels: number | null
    probeError?: string | null
  }[]
  captureSource: 'env' | 'avfoundation' | 'none'
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
}

const SEL_AUTO = '__auto__'
const SEL_OFF = '__off__'

function MacAudioInputsPanel({
  token,
  role,
  onError,
  onSyncedShowfile,
}: {
  token: string
  role: Role
  onError: (msg: string | null) => void
  onSyncedShowfile?: () => void | Promise<void>
}) {
  const canEdit = role === 'admin'
  const [data, setData] = useState<AudioCaptureDevicesRes | null>(null)
  const [selectVal, setSelectVal] = useState<string>(SEL_AUTO)
  const [busy, setBusy] = useState(false)
  const [loadHint, setLoadHint] = useState<string | null>(null)
  const [captureChCount, setCaptureChCount] = useState(2)
  const [gainByIndex, setGainByIndex] = useState<Record<string, number>>({})
  const [channelCountAuto, setChannelCountAuto] = useState(true)

  useEffect(() => {
    if (!data?.captureInputMatrix) return
    const m = data.captureInputMatrix
    setChannelCountAuto(data.captureChannelCountAuto !== false)
    const n = Math.max(
      1,
      Math.min(
        MVP_MAX_CAPTURE_CHANNELS,
        Math.floor(Number(data.captureChannelCount)) || 2,
      ),
    )
    setCaptureChCount(n)
    const gi = { ...(m.gainByIndex && typeof m.gainByIndex === 'object' ? m.gainByIndex : {}) }
    for (let i = 0; i < n; i++) {
      const k = String(i)
      if (typeof gi[k] === 'number') {
        gi[k] = Math.max(0, Math.min(4, gi[k]))
      } else if (i === 0) {
        gi[k] = Math.max(0, Math.min(4, Number(m.gainL) || 1))
      } else if (i === 1) {
        gi[k] = Math.max(0, Math.min(4, Number(m.gainR) || 1))
      } else {
        gi[k] = 1
      }
    }
    setGainByIndex(gi)
  }, [data])

  const load = useCallback(
    async (refreshList = false, probeAllDevices = false) => {
      const showBusy = refreshList || probeAllDevices
      if (showBusy) {
        setBusy(true)
        setLoadHint(
          probeAllDevices
            ? 'A correr ffprobe em todos os dispositivos (o pedido pode demorar alguns segundos; aguarda)…'
            : 'A atualizar a lista de entradas…',
        )
      }
      onError(null)
      try {
        const qs = new URLSearchParams()
        if (refreshList) qs.set('refresh', '1')
        if (probeAllDevices) qs.set('probe', 'all')
        const q = qs.toString()
        const path =
          q.length > 0
            ? `/api/audio-capture-devices?${q}`
            : '/api/audio-capture-devices'
        const j = await api<AudioCaptureDevicesRes>(path, {
          token,
        })
        setData(j)
        const m = j.captureMode
        if (m === 'manual' && j.manualAvfoundationAudioIndex != null) {
          setSelectVal(String(j.manualAvfoundationAudioIndex))
        } else if (m === 'auto') {
          setSelectVal(SEL_AUTO)
        } else {
          setSelectVal(SEL_OFF)
        }
      } catch (e) {
        onError(String((e as Error).message))
      } finally {
        if (showBusy) {
          setBusy(false)
          setLoadHint(null)
        }
      }
    },
    [token, onError],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function applySelection(mode: 'save' | 'clear') {
    if (!canEdit) return
    setBusy(true)
    onError(null)
    try {
      if (mode === 'clear') {
        await api('/api/audio-capture-device', {
          method: 'PATCH',
          token,
          body: JSON.stringify({ captureAvfoundationMode: 'off' }),
        })
        setSelectVal(SEL_OFF)
        await load(true)
        return
      }
      if (selectVal === SEL_AUTO) {
        await api('/api/audio-capture-device', {
          method: 'PATCH',
          token,
          body: JSON.stringify({ captureAvfoundationMode: 'auto' }),
        })
      } else if (selectVal === SEL_OFF) {
        await api('/api/audio-capture-device', {
          method: 'PATCH',
          token,
          body: JSON.stringify({ captureAvfoundationMode: 'off' }),
        })
      } else {
        const n = Number(selectVal)
        if (!Number.isInteger(n) || n < 0) {
          onError('Escolhe uma entrada na lista ou automático / desligado.')
          return
        }
        await api('/api/audio-capture-device', {
          method: 'PATCH',
          token,
          body: JSON.stringify({
            captureAvfoundationMode: 'manual',
            avfoundationAudioIndex: n,
          }),
        })
      }
      await load(true)
    } catch (e) {
      onError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  async function applyCaptureGains() {
    if (!canEdit) return
    setBusy(true)
    onError(null)
    try {
      const n = Math.max(
        1,
        Math.min(MVP_MAX_CAPTURE_CHANNELS, Math.floor(captureChCount) || 2),
      )
      const g0 = gainByIndex['0'] ?? 1
      const g1 = gainByIndex['1'] ?? 1
      await api('/api/audio-capture-routing', {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          gainL: g0,
          gainR: g1,
          captureChannelCount: n,
          gainByIndex,
          captureChannelCountAuto: channelCountAuto,
        }),
      })
      await load()
    } catch (e) {
      onError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  async function syncInterfaceChannels() {
    if (!canEdit) return
    setBusy(true)
    onError(null)
    try {
      const n = Math.max(
        1,
        Math.min(MVP_MAX_CAPTURE_CHANNELS, Math.floor(captureChCount) || 2),
      )
      await api('/api/showfile/sync-interface-channels', {
        method: 'POST',
        token,
        body: JSON.stringify({ channelCount: n }),
      })
      await onSyncedShowfile?.()
      await load(true)
    } catch (e) {
      onError(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    return (
      <section>
        <h2>Entrada de áudio no Mac (AVFoundation)</h2>
        <p>A carregar…</p>
      </section>
    )
  }

  return (
    <section>
      <h2>Entrada de áudio no Mac (AVFoundation)</h2>
      <p style={{ color: '#9aa0a6', maxWidth: 720 }}>
        O servidor <strong>lista as entradas</strong> com o <code>ffmpeg</code> e, em modo{' '}
        <strong>automático</strong>, tenta reconhecer interfaces comuns (ex.{' '}
        <strong>STUDIO M</strong>, Focusrite, Zoom, BlackHole…). Para várias interfaces
        ao mesmo tempo, cria um <strong>dispositivo agregado</strong> no Utilitário Áudio
        MIDI do macOS e escolhe-o aqui; define o <strong>número de canais (N)</strong> do
        agregado e sincroniza a mesa. Opcional:{' '}
        <code>INEAR_CAPTURE_DEVICE_SUBSTRING=nome</code>. Estado em <code>inear-state.json</code>
        . Se <code>INEAR_CAPTURE_CMD</code> existir, tem prioridade — o teu comando deve
        usar o mesmo <code>-ac N</code> que o N configurado.
      </p>
      {data.platform === 'darwin' && data.captureSource !== 'env' ? (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 8,
            border: '1px solid #3d4f7c',
            background: '#161b22',
            maxWidth: 820,
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 15, color: '#58a6ff' }}>
            Avid + Studio M ao mesmo tempo (porque só vês L/R de um dispositivo)
          </h3>
          <p style={{ color: '#e8eaed', lineHeight: 1.55, marginBottom: 10 }}>
            O inEar captura <strong>um único</strong> fluxo PCM por vez. Se escolheres só a{' '}
            <strong>Studio M</strong>, o macOS entrega em geral <strong>2 canais</strong>{' '}
            (L/R) — não há como “somar” a Avid nesse mesmo fluxo sem um passo no Mac.
          </p>
          <ol
            style={{
              color: '#c9d1d9',
              lineHeight: 1.65,
              margin: 0,
              paddingLeft: 22,
            }}
          >
            <li>
              Abre <strong>Configuração de áudio MIDI</strong> (Audio MIDI Setup) no Mac.
            </li>
            <li>
              Cria um <strong>Dispositivo de áudio agregado</strong> (+ no canto inferior
              esquerdo → Create Aggregate Device).
            </li>
            <li>
              No agregado, marca as entradas da <strong>Avid</strong> e da <strong>Studio M</strong>{' '}
              (ordem importa: o primeiro bloco de canais no agregado = índices PCM 0, 1…;
              o segundo = seguintes). Dá um nome claro, ex. <code>Agregado Avid+Studio</code>.
            </li>
            <li>
              Volta aqui: em <strong>Usar entrada</strong> escolhe o <strong>agregado</strong>{' '}
              (modo manual ou ajusta <code>INEAR_CAPTURE_DEVICE_SUBSTRING</code> ao nome).
            </li>
            <li>
              Clica <strong>Provar todos (ffprobe)</strong> e confirma quantas entradas PCM
              aparecem (ex. 4 se forem 2+2 estéreo). Liga <strong>N automático</strong> ou
              escreve <strong>N</strong> à mão.
            </li>
            <li>
              <strong>Aplicar N + ganhos</strong>, depois <strong>Sincronizar faixas</strong> —
              no separador <strong>Canais</strong> renomeia <code>if_0</code>… para saberes qual
              é Avid L, Avid R, Studio L, Studio R (conferir ordem no agregado).
            </li>
          </ol>
        </div>
      ) : null}
      {loadHint ? (
        <p
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 8,
            border: '1px solid #1f6feb',
            background: '#0d1b33',
            color: '#79c0ff',
            maxWidth: 820,
            lineHeight: 1.5,
          }}
        >
          {loadHint}
        </p>
      ) : null}
      {data.platform !== 'darwin' ? (
        <p style={{ color: '#bdc1c6' }}>
          O servidor não está em macOS — não há lista AVFoundation nesta máquina.
        </p>
      ) : null}
      {data.captureSource === 'env' ? (
        <p style={{ color: '#fdd663', marginTop: 12 }}>
          Captura ativa via variável de ambiente <code>INEAR_CAPTURE_CMD</code> (prioridade
          sobre a escolha abaixo).
        </p>
      ) : null}
      {data.suggestedDevice && data.captureMode === 'auto' ? (
        <p style={{ marginTop: 12, color: '#81c995' }}>
          <strong>Heurística (automático):</strong> sugerido{' '}
          <code>[{data.suggestedDevice.index}]</code> {data.suggestedDevice.name}
        </p>
      ) : null}
      {data.captureSource === 'avfoundation' ? (
        <p style={{ marginTop: 12 }}>
          <strong>Captura ativa:</strong>{' '}
          {data.effectiveDeviceName != null
            ? `[${data.effectiveAvfoundationAudioIndex}] ${data.effectiveDeviceName}`
            : `índice :${data.effectiveAvfoundationAudioIndex}`}
          {data.autoPicked ? (
            <span style={{ color: '#9aa0a6' }}> · detetado automaticamente</span>
          ) : null}
          <span style={{ color: '#9aa0a6' }}>
            {' '}
            · modo <code>{data.captureMode}</code>
          </span>
          {typeof data.effectiveProbedInputChannels === 'number' ? (
            <span style={{ color: '#81c995', display: 'block', marginTop: 6 }}>
              ffprobe: esta entrada expõe <strong>{data.effectiveProbedInputChannels}</strong>{' '}
              canal(is) PCM ao ffmpeg. Com &quot;N automático&quot; ligado, o servidor usa este
              valor ao reiniciar a captura.
            </span>
          ) : data.effectiveProbeError ? (
            <span style={{ color: '#f0883e', display: 'block', marginTop: 6 }}>
              ffprobe (entrada efetiva): {data.effectiveProbeError}
            </span>
          ) : null}
        </p>
      ) : data.platform === 'darwin' && data.captureSource === 'none' ? (
        <p style={{ marginTop: 12, color: '#9aa0a6' }}>
          Sem entrada AVFoundation resolvida (modo <code>{data.captureMode}</code>
          {data.captureMode === 'auto'
            ? ' — nenhum dispositivo correspondeu à heurística'
            : ''}
          ). O mix usa tons de teste ou define <code>INEAR_CAPTURE_CMD</code>.
        </p>
      ) : null}
      {data.devices.length === 0 && data.platform === 'darwin' ? (
        <p style={{ color: '#f28b82', marginTop: 8 }}>
          Lista vazia ou <code>ffmpeg</code> não encontrado no PATH do processo Electron.
          Instala com <code>brew install ffmpeg</code> ou define <code>INEAR_FFMPEG</code>.
        </p>
      ) : null}
      {data.devices.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>
            Dispositivos de entrada — entradas PCM (ffprobe)
          </h3>
          {data.ffprobeFound === false ? (
            <p
              style={{
                margin: '0 0 12px',
                padding: 12,
                borderRadius: 8,
                border: '1px solid #9e6a03',
                background: '#342c1d',
                color: '#f0883e',
                maxWidth: 820,
                lineHeight: 1.5,
              }}
            >
              <strong>ffprobe não está acessível</strong> a este processo (PATH do Electron).
              Instala <code>ffmpeg</code> (inclui ffprobe), ou define{' '}
              <code>INEAR_FFPROBE=/caminho/completo/ffprobe</code> antes de arrancar o servidor.
              Sem ffprobe, a coluna PCM fica vazia mesmo após &quot;Provar todos&quot;.
            </p>
          ) : null}
          <div
            style={{
              maxHeight: 320,
              overflow: 'auto',
              border: '1px solid #394457',
              borderRadius: 8,
              background: '#0d1117',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
                color: '#e8eaed',
              }}
            >
              <thead>
                <tr style={{ background: '#21262d', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #394457' }}>
                    #
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #394457' }}>
                    Dispositivo
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #394457' }}>
                    Entradas PCM
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #394457' }}>
                    Nota
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((d) => {
                  const n = typeof d.inputChannels === 'number' ? d.inputChannels : null
                  const err = d.probeError || null
                  const note =
                    n != null
                      ? 'Medido com ffprobe nesta carga (ou em cache recente).'
                      : err
                        ? err
                        : 'Sem medição para este índice nesta carga — clica «Provar todos (ffprobe)».'
                  return (
                    <tr key={d.index} style={{ borderBottom: '1px solid #30363d' }}>
                      <td style={{ padding: '8px 12px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                        <code>[{d.index}]</code>
                      </td>
                      <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>{d.name}</td>
                      <td
                        style={{
                          padding: '8px 12px',
                          verticalAlign: 'top',
                          fontWeight: 700,
                          color: n != null ? '#81c995' : '#6e7681',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {n != null ? n : '—'}
                      </td>
                      <td
                        style={{
                          padding: '8px 12px',
                          verticalAlign: 'top',
                          color: n != null ? '#9aa0a6' : err ? '#f0883e' : '#6e7681',
                          lineHeight: 1.45,
                          maxWidth: 420,
                        }}
                      >
                        {note}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#9aa0a6', maxWidth: 820 }}>
            «<strong>Provar todos</strong>» corre ffprobe em <em>cada</em> linha (pode demorar). Sem
            isso, só aparecem medições para a entrada em uso, a sugerida pela heurística, ou valores
            em cache de há poucos segundos.
          </p>
        </div>
      ) : null}
      {canEdit && data.platform === 'darwin' && data.captureSource !== 'env' ? (
        <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Usar entrada
            <select
              value={selectVal}
              onChange={(e) => setSelectVal(e.target.value)}
              style={{
                minWidth: 260,
                padding: '6px 8px',
                background: '#252a33',
                color: '#e8eaed',
                border: '1px solid #555',
                borderRadius: 6,
              }}
            >
              <option value={SEL_AUTO}>— deteção automática (reconhece interface) —</option>
              <option value={SEL_OFF}>— desligado (tons de teste) —</option>
              {data.devices.map((d) => (
                <option key={d.index} value={String(d.index)}>
                  [{d.index}] {d.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={() => void applySelection('save')}>
            Aplicar
          </button>
          <button type="button" disabled={busy} onClick={() => void applySelection('clear')}>
            Só desligar
          </button>
          <button type="button" disabled={busy} onClick={() => void load(true)}>
            Atualizar lista
          </button>
          <button
            type="button"
            disabled={busy}
            title="Corre ffprobe em cada dispositivo (pode demorar)"
            onClick={() => void load(true, true)}
          >
            Provar todos (ffprobe)
          </button>
        </div>
      ) : null}
      {!canEdit && data.platform === 'darwin' && data.devices.length > 0 ? (
        <p style={{ marginTop: 16, fontSize: 13, color: '#9aa0a6' }}>
          Só o admin pode alterar a entrada; acima vês a lista que o Mac expõe ao servidor.
        </p>
      ) : null}

      {data.captureInputMatrix ? (
        <div
          style={{
            marginTop: 28,
            borderTop: '1px solid #394457',
            paddingTop: 20,
          }}
        >
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Mesa multi-canal (captura única)</h3>
          <p style={{ color: '#9aa0a6', maxWidth: 760, marginBottom: 14, lineHeight: 1.5 }}>
            <strong>N</strong> = canais no fluxo PCM (dispositivo agregado). Ganhos por entrada
            física (índice 0…N−1) aplicam-se antes do mix. <strong>Sincronizar</strong> cria
            faixas <code>if_0</code>…<code>if_{Math.max(0, captureChCount - 1)}</code> com nomes
            no separador Canais. O macOS lista <strong>um dispositivo por interface</strong> (ex.{' '}
            Studio M = muitas vezes só 2 canais L/R); microfone integrado aparece como outra
            linha — combina tudo num <strong>agregado</strong> se precisares de N maior.
          </p>
          {canEdit ? (
            <label style={{ color: '#e8eaed', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={channelCountAuto}
                onChange={(e) => setChannelCountAuto(e.target.checked)}
              />
              Ajustar N automaticamente com ffprobe ao reiniciar captura
            </label>
          ) : null}
          {canEdit ? (
            <label style={{ color: '#e8eaed', display: 'block', marginBottom: 16 }}>
              Número de entradas no PCM (N), 1–{MVP_MAX_CAPTURE_CHANNELS}
              <input
                type="number"
                min={1}
                max={MVP_MAX_CAPTURE_CHANNELS}
                disabled={!canEdit}
                value={captureChCount}
                onChange={(e) =>
                  setCaptureChCount(
                    Math.max(
                      1,
                      Math.min(
                        MVP_MAX_CAPTURE_CHANNELS,
                        Math.floor(Number(e.target.value)) || 1,
                      ),
                    ),
                  )
                }
                style={{
                  display: 'block',
                  marginTop: 6,
                  width: 120,
                  padding: 8,
                  background: '#252a33',
                  color: '#e8eaed',
                  border: '1px solid #555',
                  borderRadius: 6,
                }}
              />
            </label>
          ) : (
            <p style={{ color: '#9aa0a6', marginBottom: 12 }}>
              N = {data.captureChannelCount} canais na captura
            </p>
          )}
          <div
            style={{
              marginBottom: 16,
              maxHeight: 360,
              overflowY: 'auto',
              border: '1px solid #394457',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ color: '#9aa0a6', fontSize: 12, marginBottom: 10, lineHeight: 1.45 }}>
              Ganhos por entrada PCM (uma barra por índice 0…N−1). Com N=5 vês cinco faders; em
              <strong> Canais</strong> ajustas gain/pan por faixa <code>if_*</code>. Aplica com o
              botão abaixo.
            </div>
            {Array.from({ length: captureChCount }, (_, i) => (
              <label
                key={i}
                style={{ color: '#e8eaed', display: 'block', marginBottom: 10 }}
              >
                Entrada PCM {i}
                {captureChCount === 2 && (i === 0 || i === 1) ? (
                  <span style={{ color: '#6e7681', fontSize: 11 }}>
                    {' '}
                    ({i === 0 ? 'L' : 'R'} estéreo)
                  </span>
                ) : null}
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={0.01}
                  disabled={!canEdit}
                  value={gainByIndex[String(i)] ?? 1}
                  onChange={(e) =>
                    setGainByIndex((prev) => ({
                      ...prev,
                      [String(i)]: Number(e.target.value),
                    }))
                  }
                  style={{ display: 'block', width: '100%', maxWidth: 420, marginTop: 4 }}
                />
                <span style={{ fontSize: 12, color: '#9aa0a6' }}>
                  {(gainByIndex[String(i)] ?? 1).toFixed(2)}
                </span>
              </label>
            ))}
          </div>
          {canEdit ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <button type="button" disabled={busy} onClick={() => void applyCaptureGains()}>
                Aplicar N + ganhos (reinicia captura)
              </button>
              <button type="button" disabled={busy} onClick={() => void syncInterfaceChannels()}>
                Sincronizar faixas da mesa (if_0 …)
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function parseJwtSub(token: string): string {
  try {
    const p = token.split('.')[1]
    const pad = '='.repeat((4 - (p.length % 4)) % 4)
    const b = JSON.parse(
      atob(p.replace(/-/g, '+').replace(/_/g, '/') + pad),
    )
    return String(b.sub ?? '')
  } catch {
    return ''
  }
}

function ChannelTable({
  token,
  showfile,
  onSaved,
}: {
  token: string
  showfile: Showfile
  onSaved: () => void
}) {
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [iconDrafts, setIconDrafts] = useState<Record<string, string>>({})
  const [colorDrafts, setColorDrafts] = useState<Record<string, string>>({})

  const nameFor = useCallback(
    (id: string, fallback: string) => nameDrafts[id] ?? fallback,
    [nameDrafts],
  )
  const iconFor = useCallback((id: string, fallback?: string) => iconDrafts[id] ?? fallback ?? '', [iconDrafts])
  const colorFor = useCallback(
    (id: string, fallback?: string, idx?: number) =>
      colorDrafts[id] ?? channelAccentColor({ id, color: fallback, captureInputIndex: idx }),
    [colorDrafts],
  )

  const saveChannelVisuals = useCallback(
    async (
      channelId: string,
      nextName: string,
      nextIcon: string,
      nextColor: string,
    ) => {
      await api(`/api/showfile/channel/${channelId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({
          name: nextName.trim() || channelId,
          icon: nextIcon || undefined,
          color: nextColor || undefined,
        }),
      })
      onSaved()
    },
    [onSaved, token],
  )

  if (showfile.channels.length === 0) {
    return (
      <section style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Canais (0)</h2>
        <p style={{ color: '#e8eaed', lineHeight: 1.5 }}>
          Ainda não há faixas da mesa neste projeto. Ligue a captura (Entrada Mac ou{' '}
          <code>INEAR_CAPTURE_CMD</code>) e use{' '}
          <strong>Sincronizar faixas</strong> em <strong>Sessão</strong> ou{' '}
          <strong>Entrada Mac</strong> (define N) — surgem <code>if_0</code>… com faders
          gain/pan/EQ aqui.
        </p>
        <button type="button" onClick={() => onSaved()}>
          Recarregar
        </button>
      </section>
    )
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 14,
      }}
    >
      {showfile.channels.map((ch) => {
        const accent = channelAccentColor(ch)
        const verticalSliderStyle = {
          width: 150,
          transform: 'rotate(-90deg)',
        }
        return (
          <div
            key={ch.id}
            style={{
              border: `1px solid ${accent}`,
              borderRadius: 16,
              padding: 14,
              background: 'linear-gradient(180deg,#1a212d 0%,#11161f 100%)',
              boxShadow: '0 10px 24px rgba(0,0,0,.22)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: accent,
                  color: '#07111a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 900,
                }}
              >
                {channelIconBadge(ch.icon)}
              </div>
              <div style={{ flex: 1 }}>
                <strong style={{ display: 'block', fontSize: 16 }}>{ch.name}</strong>
                <small style={{ color: '#9aa0a6' }}>{ch.id}</small>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              <input
                value={nameFor(ch.id, ch.name)}
                onChange={(e) =>
                  setNameDrafts((prev) => ({
                    ...prev,
                    [ch.id]: e.target.value,
                  }))
                }
                placeholder={ch.id}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: '#252a33',
                  color: '#e8eaed',
                  border: '1px solid #555',
                  borderRadius: 8,
                }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px', gap: 8 }}>
                <select
                  value={iconFor(ch.id, ch.icon)}
                  onChange={(e) =>
                    setIconDrafts((prev) => ({
                      ...prev,
                      [ch.id]: e.target.value,
                    }))
                  }
                  style={{
                    padding: '8px 10px',
                    background: '#252a33',
                    color: '#e8eaed',
                    border: '1px solid #555',
                    borderRadius: 8,
                  }}
                >
                  <option value="">Icone padrao</option>
                  {CHANNEL_ICON_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.badge} - {opt.label}
                    </option>
                  ))}
                </select>
                <input
                  type="color"
                  value={colorFor(ch.id, ch.color, ch.captureInputIndex)}
                  onChange={(e) =>
                    setColorDrafts((prev) => ({
                      ...prev,
                      [ch.id]: e.target.value,
                    }))
                  }
                  style={{
                    width: '100%',
                    height: 42,
                    background: 'transparent',
                    border: '1px solid #555',
                    borderRadius: 8,
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={async () => {
                    await saveChannelVisuals(
                      ch.id,
                      nameFor(ch.id, ch.name),
                      iconFor(ch.id, ch.icon),
                      colorFor(ch.id, ch.color, ch.captureInputIndex),
                    )
                  }}
                >
                  Salvar visual
                </button>
                <label style={{ color: '#e8eaed' }}>
                  <input
                    type="checkbox"
                    checked={ch.mute}
                    onChange={async (e) => {
                      await api(`/api/showfile/channel/${ch.id}`, {
                        method: 'PATCH',
                        token,
                        body: JSON.stringify({ mute: e.target.checked }),
                      })
                      onSaved()
                    }}
                  />{' '}
                  mute
                </label>
              </div>
            </div>

            <small style={{ color: '#9aa0a6', display: 'block', marginBottom: 12 }}>
              {typeof ch.captureInputIndex === 'number'
                ? `Entrada PCM ${ch.captureInputIndex}`
                : ch.sourceTap === 'L'
                  ? 'PCM L'
                  : ch.sourceTap === 'R'
                    ? 'PCM R'
                    : ch.sourceTap === 'sum'
                      ? 'Soma'
                      : (ch.sourceTap ?? '—')}
            </small>

            <div style={{ display: 'flex', gap: 18, alignItems: 'flex-end' }}>
              {[
                { key: 'gain', label: 'Gain', min: 0, max: 4, step: 0.01, value: ch.gain },
                { key: 'pan', label: 'Pan', min: -1, max: 1, step: 0.01, value: ch.pan },
              ].map((slider) => (
                <label
                  key={slider.key}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
                >
                  <span style={{ fontSize: 12, color: '#c9d1d9', fontWeight: 700 }}>{slider.label}</span>
                  <div style={{ width: 28, height: 170, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="range"
                      min={slider.min}
                      max={slider.max}
                      step={slider.step}
                      value={slider.value}
                      style={verticalSliderStyle}
                      onChange={async (e) => {
                        await api(`/api/showfile/channel/${ch.id}`, {
                          method: 'PATCH',
                          token,
                          body: JSON.stringify({
                            [slider.key]: Number(e.target.value),
                          }),
                        })
                        onSaved()
                      }}
                    />
                  </div>
                  <small style={{ color: '#8b949e' }}>{Number(slider.value).toFixed(2)}</small>
                </label>
              ))}
              {(['lowDb', 'midDb', 'highDb'] as const).map((k) => (
                <label
                  key={k}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
                >
                  <span style={{ fontSize: 12, color: '#c9d1d9', fontWeight: 700 }}>
                    {k === 'lowDb' ? 'Low' : k === 'midDb' ? 'Mid' : 'High'}
                  </span>
                  <div style={{ width: 28, height: 170, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={ch.eq[k]}
                      style={verticalSliderStyle}
                      onChange={async (e) => {
                        await api(`/api/showfile/channel/${ch.id}`, {
                          method: 'PATCH',
                          token,
                          body: JSON.stringify({
                            eq: { ...ch.eq, [k]: Number(e.target.value) },
                          }),
                        })
                        onSaved()
                      }}
                    />
                  </div>
                  <small style={{ color: '#8b949e' }}>{ch.eq[k].toFixed(1)} dB</small>
                </label>
              ))}
            </div>

            <label style={{ display: 'block', marginTop: 12, color: '#e8eaed' }}>
              <input
                type="checkbox"
                checked={ch.lockEq}
                onChange={async (e) => {
                  await api(`/api/showfile/channel/${ch.id}`, {
                    method: 'PATCH',
                    token,
                    body: JSON.stringify({ lockEq: e.target.checked }),
                  })
                  onSaved()
                }}
              />{' '}
              bloquear EQ do musico
            </label>
          </div>
        )
      })}
    </div>
  )
}

function MusicianTable({
  showfile,
  token,
  onSaved,
}: {
  showfile: Showfile
  token: string
  onSaved: () => void
}) {
  const [selectedMusicianId, setSelectedMusicianId] = useState<string | null>(
    showfile.musicians[0]?.id ?? null,
  )
  const [newName, setNewName] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [editName, setEditName] = useState<Record<string, string>>({})
  const [editUsername, setEditUsername] = useState<Record<string, string>>({})
  const [editPassword, setEditPassword] = useState<Record<string, string>>({})

  const selectedMusician =
    showfile.musicians.find((m) => m.id === selectedMusicianId) ?? showfile.musicians[0] ?? null

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section
        style={{
          border: '1px solid #2d394d',
          borderRadius: 18,
          padding: 16,
          background: 'linear-gradient(180deg,#1a2230 0%,#10161f 100%)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Cadastrar músico</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 1fr 1fr auto',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Nome</span>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Usuário</span>
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Senha</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              await api('/api/admin/musicians', {
                method: 'POST',
                token,
                body: JSON.stringify({
                  name: newName,
                  username: newUsername,
                  password: newPassword,
                }),
              })
              setNewName('')
              setNewUsername('')
              setNewPassword('')
              onSaved()
            }}
          >
            Cadastrar
          </button>
        </div>
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(300px, 380px) 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <section
          style={{
            border: '1px solid #2d394d',
            borderRadius: 18,
            padding: 16,
            background: 'linear-gradient(180deg,#171d28 0%,#0f141c 100%)',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Perfis de músicos</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {showfile.musicians.map((m) => (
              <div
                key={m.id}
                style={{
                  border: selectedMusician?.id === m.id ? '1px solid #58a6ff' : '1px solid #30363d',
                  borderRadius: 14,
                  padding: 12,
                  background: selectedMusician?.id === m.id ? '#132033' : '#11161f',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <strong>{m.name}</strong>
                    <div style={{ color: '#9aa0a6', fontSize: 13 }}>{m.username}</div>
                  </div>
                  <button type="button" onClick={() => setSelectedMusicianId(m.id)}>
                    Abrir mix
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  <input
                    value={editName[m.id] ?? m.name}
                    onChange={(e) =>
                      setEditName((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder="Nome"
                  />
                  <input
                    value={editUsername[m.id] ?? m.username}
                    onChange={(e) =>
                      setEditUsername((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder="Usuário"
                  />
                  <input
                    type="password"
                    value={editPassword[m.id] ?? ''}
                    onChange={(e) =>
                      setEditPassword((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder="Nova senha (opcional)"
                  />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={async () => {
                        await api(`/api/admin/musicians/${m.id}`, {
                          method: 'PATCH',
                          token,
                          body: JSON.stringify({
                            name: editName[m.id] ?? m.name,
                            username: editUsername[m.id] ?? m.username,
                            password: editPassword[m.id] ?? '',
                          }),
                        })
                        setEditPassword((prev) => ({ ...prev, [m.id]: '' }))
                        onSaved()
                      }}
                    >
                      Salvar perfil
                    </button>
                    <label style={{ color: '#e8eaed' }}>
                      <input
                        type="checkbox"
                        checked={m.mute}
                        onChange={async (e) => {
                          await api(`/api/showfile/musician/${m.id}`, {
                            method: 'PATCH',
                            token,
                            body: JSON.stringify({ mute: e.target.checked }),
                          })
                          onSaved()
                        }}
                      />{' '}
                      mutar músico
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            border: '1px solid #2d394d',
            borderRadius: 18,
            padding: 16,
            background: 'linear-gradient(180deg,#171d28 0%,#0f141c 100%)',
          }}
        >
          {selectedMusician ? (
            <MusicianControls
              token={token}
              showfile={showfile}
              musician={selectedMusician}
              onSaved={onSaved}
            />
          ) : (
            <p style={{ color: '#9aa0a6' }}>Nenhum músico cadastrado.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function MusicianControls({
  token,
  showfile,
  musician,
  onSaved,
}: {
  token: string
  showfile: Showfile
  musician: Showfile['musicians'][0]
  onSaved: () => void
}) {
  const ids = useMemo(
    () => retornoMixerChannelOrder(showfile, musician),
    [musician, showfile],
  )
  const groupIds = musician.scope.groupIds

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Olá, {musician.name}</h2>
      <p style={{ color: '#9aa0a6' }}>
        Sends por canal da interface (e grupos, se existirem). Se não vês nada,
        pede ao técnico: <strong>Sessão</strong> ou <strong>Entrada Mac</strong> →
        &quot;Sincronizar faixas&quot; com a captura ativa (N canais no Mac).
      </p>
      {ids.length === 0 && (
        <p style={{ color: '#fbbc04' }}>
          Ainda não há canais no showfile (0). Depois da sincronização no Mac,
          recarrega esta página.
        </p>
      )}
      {groupIds.map((gid) => {
        const g = showfile.groups.find((x) => x.id === gid)
        if (!g) return null
        return (
          <label key={gid} style={{ display: 'block', marginBottom: 12 }}>
            Send {g.name}
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={musician.sendGains[gid] ?? 1}
              onChange={async (e) => {
                await api(`/api/showfile/musician/${musician.id}`, {
                  method: 'PATCH',
                  token,
                  body: JSON.stringify({
                    sendGains: { [gid]: Number(e.target.value) },
                  }),
                })
                onSaved()
              }}
              style={{ width: '100%' }}
            />
          </label>
        )
      })}
      {ids.map((cid) => {
        const ch = showfile.channels.find((c) => c.id === cid)
        if (!ch) return null
        const earEq = musician.eqByChannel?.[cid]
        const eqBase = {
          lowDb: earEq?.lowDb ?? ch.eq.lowDb,
          midDb: earEq?.midDb ?? ch.eq.midDb,
          highDb: earEq?.highDb ?? ch.eq.highDb,
        }
        return (
          <div
            key={cid}
            style={{
              border: '1px solid #333',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {ch.name}{' '}
              {ch.lockEq && (
                <span style={{ color: '#fbbc04', fontSize: 12 }}>(EQ bloqueado)</span>
              )}
            </div>
            <label style={{ display: 'block' }}>
              Send
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={musician.sendGains[cid] ?? 1}
                onChange={async (e) => {
                  await api(`/api/showfile/musician/${musician.id}`, {
                    method: 'PATCH',
                    token,
                    body: JSON.stringify({
                      sendGains: { [cid]: Number(e.target.value) },
                    }),
                  })
                  onSaved()
                }}
                style={{ width: '100%' }}
              />
            </label>
            {!ch.lockEq && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {(['lowDb', 'midDb', 'highDb'] as const).map((k) => (
                  <label key={k} style={{ flex: 1, fontSize: 12 }}>
                    {k} (teu ouvido)
                    <input
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={eqBase[k]}
                      onChange={async (e) => {
                        await api(`/api/showfile/musician/${musician.id}`, {
                          method: 'PATCH',
                          token,
                          body: JSON.stringify({
                            eqByChannel: {
                              [cid]: {
                                ...eqBase,
                                [k]: Number(e.target.value),
                              },
                            },
                          }),
                        })
                        onSaved()
                      }}
                      style={{ width: '100%' }}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <button
        type="button"
        onClick={async () => {
          await api('/api/telemetry', {
            method: 'POST',
            token,
            body: JSON.stringify({ gaps: 0, underruns: 0, rttMs: 0 }),
          })
        }}
      >
        Ping telemetria (teste)
      </button>
    </div>
  )
}
