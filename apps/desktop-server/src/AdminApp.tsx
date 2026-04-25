import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { api, getApiBase } from './api'
import type { ChannelStrip, MusicianStrip, Showfile } from '@inear/protocol'
import {
  CHANNEL_ICON_OPTIONS,
  channelAccentColor,
  MVP_MAX_CAPTURE_CHANNELS,
  retornoMixerChannelOrder,
} from '@inear/protocol'

type Role = 'admin' | 'musician'

type AudioInputLevelsResponse = {
  captureChannelCount: number
  updatedAt: number
  receiving: boolean
  levelsByIndex: Record<string, number>
}

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
  const [networkQualityByUser, setNetworkQualityByUser] = useState<
    Record<
      string,
      {
        level: string
        rttMs: number | null
        jitterMs: number | null
        gapsPerMinute: number
        estimatedE2eMs?: number | null
        estimatedE2eP95Ms?: number | null
        aheadP95Ms?: number | null
        queueDepthP95?: number | null
        sampleCount?: number
        slaBreaches?: number
        slaUnder1s?: boolean
        recommendations?: string[]
        hint: string
      }
    >
  >({})
  const [audioBlockSamples, setAudioBlockSamples] = useState<number | null>(null)
  const [audioInputLevels, setAudioInputLevels] = useState<AudioInputLevelsResponse | null>(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [setupChecked, setSetupChecked] = useState(false)
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [serverIps, setServerIps] = useState<string[]>([])

  const authHeaders = useMemo(() => ({ token }), [token])

  /** Evita vários GET em paralelo: o último a terminar podia trazer snapshot antigo e “reverter” faders. */
  const refreshShowfileQueueRef = useRef(Promise.resolve())

  const refreshShowfile = useCallback(async () => {
    if (!token) return
    const tail = refreshShowfileQueueRef.current.then(async () => {
      const sf = await api<Showfile>('/api/showfile', { ...authHeaders })
      setShowfile(sf)
    })
    refreshShowfileQueueRef.current = tail.catch((e) => {
      setError(String((e as Error).message))
    })
    await tail
  }, [token, authHeaders])

  const mergeChannelStripIntoShowfile = useCallback((ch: ChannelStrip) => {
    setShowfile((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        channels: prev.channels.map((c) => (c.id === ch.id ? { ...c, ...ch } : c)),
      }
    })
  }, [])

  const mergeMusicianStripIntoShowfile = useCallback((m: MusicianStrip) => {
    setShowfile((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        musicians: prev.musicians.map((x) => (x.id === m.id ? { ...x, ...m } : x)),
      }
    })
  }, [])

  useEffect(() => {
    if (token) {
      refreshShowfile().catch((e) => setError(String(e.message)))
    }
  }, [token, refreshShowfile])

  /** Reconciliacao bidirecional: se o musico editar no app, o Admin reflete em poucos segundos. */
  useEffect(() => {
    if (!token || role !== 'admin') return
    const fastSyncTabs = tab === 'channels' || tab === 'musicians'
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        await refreshShowfile()
      } catch {
        /* ignore polling errors */
      }
    }
    const t = setInterval(() => {
      void tick()
    }, fastSyncTabs ? 1500 : 4000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [token, role, tab, refreshShowfile])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load = async () => {
      try {
        const nq = await api<{
          byUsername: Record<
            string,
            {
              level: string
              rttMs: number | null
              jitterMs: number | null
              gapsPerMinute: number
              hint: string
            }
          >
        }>('/api/network-quality', { token })
        const sess = await api<{ audioBlockSamples?: number }>('/api/session', {
          token,
        })
        if (cancelled) return
        setNetworkQualityByUser(nq.byUsername ?? {})
        if (typeof sess.audioBlockSamples === 'number') {
          setAudioBlockSamples(sess.audioBlockSamples)
        }
      } catch {
        if (!cancelled) setNetworkQualityByUser({})
      }
    }
    void load()
    const t = setInterval(load, 4000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    const shouldPollLevels =
      role === 'musician' ||
      tab === 'channels' ||
      tab === 'musicians'
    if (!shouldPollLevels) {
      setAudioInputLevels(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const levels = await api<AudioInputLevelsResponse>('/api/audio-input-levels', { token })
        if (!cancelled) setAudioInputLevels(levels)
      } catch {
        if (!cancelled) setAudioInputLevels(null)
      }
    }
    void load()
    const t = setInterval(load, role === 'musician' ? 220 : 300)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [token, role, tab])

  useEffect(() => {
    let cancelled = false
    const loadIps = async () => {
      try {
        const r = await api<{ httpPort: number; addresses: { iface: string; ip: string }[] }>(
          '/api/server-addresses',
        )
        if (cancelled) return
        const ips = Array.from(new Set((r.addresses || []).map((x) => x.ip).filter(Boolean)))
        setServerIps(ips)
      } catch {
        if (!cancelled) setServerIps([])
      }
    }
    void loadIps()
    return () => {
      cancelled = true
    }
  }, [])

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

  useEffect(() => {
    if (token) return
    let cancelled = false
    const loadSetupStatus = async () => {
      try {
        const s = await api<{ required: boolean }>('/api/setup/status')
        if (cancelled) return
        setSetupRequired(Boolean(s.required))
      } catch {
        if (!cancelled) setSetupRequired(false)
      } finally {
        if (!cancelled) setSetupChecked(true)
      }
    }
    void loadSetupStatus()
    return () => {
      cancelled = true
    }
  }, [token])

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

  async function bootstrapAdmin() {
    setError(null)
    try {
      const r = await api<{ token: string; role: Role }>('/api/setup/bootstrap', {
        method: 'POST',
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      })
      setToken(r.token)
      setRole(r.role)
      localStorage.setItem('inear_token', r.token)
      localStorage.setItem('inear_role', r.role)
      setSetupRequired(false)
      setSetupChecked(true)
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

  const preferredServerApiBase = useMemo(() => {
    if (serverIps.length === 0) return getApiBase()
    return `http://${serverIps[0]}:3847`
  }, [serverIps])

  const preferredDesktopAppBase = useMemo(() => {
    if (typeof window === 'undefined') return 'Somente local no PC'
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      const protocol = window.location.protocol
      const port = window.location.port ? `:${window.location.port}` : ''
      if (serverIps.length > 0) return `${protocol}//${serverIps[0]}${port}`
      return window.location.origin
    }
    return 'Somente local no PC (Electron)'
  }, [serverIps])

  const pairingUiEnabled = false
  const adminTabsBase = [
    ['session', 'Início'],
    ['channels', 'Mesa'],
    ['musicians', 'Integrantes'],
    ['network', 'Conexão'],
    ['audio', 'Entrada de áudio'],
    ['pairing', 'Código de acesso'],
  ] as const
  const adminTabs = pairingUiEnabled
    ? adminTabsBase
    : adminTabsBase.filter(([key]) => key !== 'pairing')

  if (!token || !role) {
    return (
      <main
        style={{
          padding: '40px 24px',
          maxWidth: 620,
          margin: '0 auto',
          minHeight: '100vh',
          overflowY: 'auto',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: '100%',
            border: '1px solid rgba(90,162,255,.26)',
            borderRadius: 24,
            background:
              'radial-gradient(circle at top left, rgba(88,166,255,.18), transparent 28%), linear-gradient(180deg,#121925 0%,#0b1119 100%)',
            boxShadow:
              '0 30px 80px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05), 0 0 0 1px rgba(17,24,39,.55)',
            padding: 22,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(transparent 0%, rgba(255,255,255,.02) 50%, transparent 100%)',
              backgroundSize: '100% 18px',
              opacity: 0.2,
              pointerEvents: 'none',
            }}
          />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
              <div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    borderRadius: 999,
                    border: '1px solid rgba(90,162,255,.28)',
                    background: 'rgba(12,18,28,.8)',
                    padding: '5px 12px',
                    color: '#8ab4ff',
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: '.12em',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: '#2ea043', boxShadow: '0 0 10px rgba(46,160,67,.7)' }} />
                  Console Tecnico
                </div>
                <h1 style={{ margin: 0, fontSize: 34, letterSpacing: '.03em' }}>inEar Desktop</h1>
                <p style={{ margin: '8px 0 0', color: '#9aa0a6', maxWidth: 420 }}>
                  Painel de controle com visual de palco para captacao, roteamento e monitoracao do retorno ao vivo.
                </p>
              </div>
              <div
                style={{
                  minWidth: 220,
                  border: '1px solid rgba(138,180,248,.18)',
                  borderRadius: 18,
                  background: 'rgba(8,12,18,.72)',
                  padding: 14,
                }}
              >
                <div style={{ color: '#9aa0a6', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  App desktop na rede <code style={{ color: '#f0f6fc', fontWeight: 700 }}>{preferredDesktopAppBase}</code>
                </div>
                <div style={{ color: '#9aa0a6', marginTop: 10, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  API do retorno <code style={{ color: '#81c995', fontWeight: 700 }}>{preferredServerApiBase}</code>
                </div>
              </div>
            </div>
            {setupChecked && setupRequired ? (
              <aside
                style={{
                  background: 'rgba(21,29,41,.92)',
                  border: '1px solid rgba(255,196,61,.22)',
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 18,
                  fontSize: 13,
                  color: '#dbe6f3',
                }}
              >
                <strong style={{ color: '#ffd866' }}>Primeira instalação</strong>
                <p style={{ margin: '8px 0 0', color: '#9aa0a6' }}>
                  Crie agora o acesso de administrador. O cadastro de músicos será
                  feito depois, dentro do painel Admin.
                </p>
              </aside>
            ) : null}
            {error && <p style={{ color: '#f28b82', marginBottom: 14 }}>{error}</p>}
            {setupChecked && setupRequired ? <h2 style={{ marginBottom: 14 }}>Criar Admin</h2> : <h2 style={{ marginBottom: 14 }}>Entrar no painel</h2>}
            <label style={{ display: 'block', marginBottom: 12, color: '#c9d1d9', fontWeight: 700, letterSpacing: '.02em' }}>
          Usuário
          <input
            style={{
              width: '100%',
              marginTop: 6,
              background: '#0c131d',
              color: '#e8eaed',
              border: '1px solid #34485f',
              borderRadius: 12,
              padding: '12px 14px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.03)',
            }}
            value={loginUser}
            onChange={(e) => setLoginUser(e.target.value)}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 18, color: '#c9d1d9', fontWeight: 700, letterSpacing: '.02em' }}>
          Senha
          <input
            type="password"
            style={{
              width: '100%',
              marginTop: 6,
              background: '#0c131d',
              color: '#e8eaed',
              border: '1px solid #34485f',
              borderRadius: 12,
              padding: '12px 14px',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,.03)',
            }}
            value={loginPass}
            onChange={(e) => setLoginPass(e.target.value)}
          />
        </label>
        {setupChecked && setupRequired ? (
          <button
            type="button"
            onClick={bootstrapAdmin}
            style={{
              padding: '12px 18px',
              borderRadius: 999,
              border: '1px solid #4f8fd6',
              background: 'linear-gradient(180deg,#2f5680 0%,#1a2d44 100%)',
              color: '#e8eaed',
              cursor: 'pointer',
              fontWeight: 800,
              minWidth: 210,
            }}
          >
            Criar admin e entrar
          </button>
        ) : (
          <button
            type="button"
            onClick={login}
            style={{
              padding: '12px 18px',
              borderRadius: 999,
              border: '1px solid #4f8fd6',
              background: 'linear-gradient(180deg,#2f5680 0%,#1a2d44 100%)',
              color: '#e8eaed',
              cursor: 'pointer',
              fontWeight: 800,
              minWidth: 160,
            }}
          >
            Entrar
          </button>
        )}
          </div>
        </div>
      </main>
    )
  }

  const selfMusician = showfile?.musicians.find(
    (m) => m.username === (token ? parseJwtSub(token) : ''),
  )
  const ui = {
    main: {
      padding: 24,
      minHeight: '100vh',
      overflowY: 'auto',
      boxSizing: 'border-box' as const,
      maxWidth: 1520,
      margin: '0 auto',
      background:
        'radial-gradient(circle at 8% -10%, rgba(88,166,255,.22), transparent 30%), radial-gradient(circle at 92% -18%, rgba(46,160,67,.12), transparent 32%), linear-gradient(180deg,#070b11 0%,#0d131d 100%)',
    },
    panelHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 14,
      marginBottom: 16,
      padding: 18,
      border: '1px solid rgba(80,129,186,.4)',
      borderRadius: 22,
      background:
        'radial-gradient(circle at top left, rgba(88,166,255,.14), transparent 24%), linear-gradient(180deg,#162131 0%,#0f1724 100%)',
      boxShadow: '0 18px 40px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04)',
    },
    navWrap: {
      display: 'flex',
      gap: 8,
      marginBottom: 16,
      flexWrap: 'wrap',
      padding: 12,
      border: '1px solid rgba(71,97,128,.55)',
      borderRadius: 20,
      background: 'linear-gradient(180deg,rgba(15,23,34,.95) 0%,rgba(12,18,28,.95) 100%)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04), 0 10px 24px rgba(0,0,0,.18)',
      position: 'sticky' as const,
      top: 12,
      zIndex: 5,
      backdropFilter: 'blur(12px)',
    },
    tabBtn: {
      fontWeight: 600,
      background: 'linear-gradient(180deg,#182230 0%,#101721 100%)',
      color: '#c9d1d9',
      border: '1px solid rgba(87,111,140,.7)',
      borderRadius: 999,
      padding: '9px 16px',
      letterSpacing: '.04em',
      textTransform: 'uppercase' as const,
      fontSize: 11,
    },
    tabBtnActive: {
      fontWeight: 800,
      background: 'linear-gradient(180deg,#325b89 0%,#203956 100%)',
      color: '#f0f6fc',
      border: '1px solid #5aa2ff',
      boxShadow: '0 0 0 1px rgba(88,166,255,.20) inset, 0 8px 18px rgba(0,0,0,.25)',
    },
    pillBtn: {
      borderRadius: 999,
      border: '1px solid rgba(90,122,155,.72)',
      background: 'linear-gradient(180deg,#1a2432 0%,#111824 100%)',
      color: '#e6edf3',
      padding: '9px 15px',
      fontWeight: 700,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.05)',
    },
    panelCard: {
      border: '1px solid rgba(67,94,123,.7)',
      borderRadius: 22,
      padding: 20,
      background:
        'radial-gradient(circle at top right, rgba(88,166,255,.08), transparent 22%), linear-gradient(180deg,#141d2a 0%,#0d1621 100%)',
      boxShadow: '0 16px 34px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.03)',
    },
  } as const

  const activeAdminTabLabel = adminTabs.find(([k]) => k === tab)?.[1] ?? 'Início'
  const sessionQuickStats = [
    { label: 'Perfil', value: showfile?.networkProfile || 'n/d' },
    { label: 'Músicos', value: String(showfile?.musicians.length ?? 0) },
    { label: 'Canais', value: String(showfile?.channels.length ?? 0) },
    { label: 'Bloco PCM', value: audioBlockSamples ? `${audioBlockSamples} smp` : 'auto' },
  ]

  return (
    <main style={ui.main}>
      <header style={ui.panelHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0 }}>inEar Console</h1>
              <span
                style={{
                  borderRadius: 999,
                  border: '1px solid #2ea043',
                  color: '#9be9a8',
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '4px 10px',
                  letterSpacing: '.1em',
                }}
              >
                LIVE MIX
              </span>
              <span
                style={{
                  borderRadius: 999,
                  border: '1px solid rgba(95,121,152,.75)',
                  color: '#9ab8d8',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                }}
              >
                {role}
              </span>
            </div>
            <p style={{ margin: '8px 0 0', color: '#9aa0a6' }}>
              Visual tecnico para controle rapido de palco, roteamento e retorno em tempo real.
            </p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {sessionQuickStats.map((item) => (
              <div
                key={item.label}
                style={{
                  minWidth: 108,
                  borderRadius: 16,
                  border: '1px solid rgba(88,166,255,.18)',
                  background: 'rgba(8,13,20,.58)',
                  padding: '10px 12px',
                }}
              >
                <div style={{ color: '#7f93ab', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  {item.label}
                </div>
                <div style={{ color: '#f0f6fc', fontWeight: 800, marginTop: 4 }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ color: '#8ea8c2', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            API <code>{preferredServerApiBase}</code>
          </div>
          <div style={{ color: '#8ea8c2', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            App desktop <code>{preferredDesktopAppBase}</code>
          </div>
          <button type="button" onClick={logout} style={ui.pillBtn}>
            Sair
          </button>
        </div>
      </header>
      <style>{`
        .inearRange{
          -webkit-appearance:none;appearance:none;width:100%;height:22px;background:transparent;cursor:pointer;
        }
        .inearRange::-webkit-slider-runnable-track{
          height:7px;border-radius:999px;background:linear-gradient(90deg,#2ea043 0 var(--fill,50%),#18222f var(--fill,50%) 100%);border:1px solid #425670;
        }
        .inearRange::-webkit-slider-thumb{
          -webkit-appearance:none;appearance:none;margin-top:-7px;width:16px;height:24px;border-radius:4px;
          border:1px solid #8da7c7;background:linear-gradient(180deg,#fbfcff 0%,#9ab6d6 45%,#4b627f 100%);
          box-shadow:0 0 0 2px rgba(47,129,247,.18),0 4px 10px rgba(0,0,0,.35);
        }
        .inearRange::-moz-range-track{
          height:7px;border-radius:999px;background:linear-gradient(90deg,#2ea043 0 var(--fill,50%),#18222f var(--fill,50%) 100%);border:1px solid #425670;
        }
        .inearRange::-moz-range-thumb{
          width:16px;height:24px;border-radius:4px;border:1px solid #8da7c7;
          background:linear-gradient(180deg,#fbfcff 0%,#9ab6d6 45%,#4b627f 100%);
          box-shadow:0 0 0 2px rgba(47,129,247,.18),0 4px 10px rgba(0,0,0,.35);
        }
        .inearVRange{
          -webkit-appearance:none;appearance:none;width:var(--faderLen,163px);height:26px;background:transparent;cursor:pointer;
        }
        .inearVRange::-webkit-slider-runnable-track{
          height:9px;border-radius:999px;background:linear-gradient(90deg,#2ea043 0 var(--fill,50%),#18222f var(--fill,50%) 100%);border:1px solid #425670;
        }
        .inearVRange::-webkit-slider-thumb{
          -webkit-appearance:none;appearance:none;margin-top:-8px;width:21px;height:29px;border-radius:5px;
          border:1px solid #8da7c7;background:linear-gradient(180deg,#fbfcff 0%,#9ab6d6 45%,#4b627f 100%);
          box-shadow:0 0 0 2px rgba(47,129,247,.18),0 4px 10px rgba(0,0,0,.35);
        }
        .inearVRange::-moz-range-track{
          height:9px;border-radius:999px;background:linear-gradient(90deg,#2ea043 0 var(--fill,50%),#18222f var(--fill,50%) 100%);border:1px solid #425670;
        }
        .inearVRange::-moz-range-thumb{
          width:21px;height:29px;border-radius:5px;border:1px solid #8da7c7;
          background:linear-gradient(180deg,#fbfcff 0%,#9ab6d6 45%,#4b627f 100%);
          box-shadow:0 0 0 2px rgba(47,129,247,.18),0 4px 10px rgba(0,0,0,.35);
        }
        .volCard{
          width:100%;max-width:96px;margin:0;overflow:hidden;
          display:flex;flex-direction:column;align-items:center;justify-content:flex-start;height:100%;
          background:#303030;color:rgba(255,255,255,.92);
          border:1px solid #3f4f66;border-radius:6px;padding:5px 3px 6px;
          box-shadow:inset 0 0 4px rgba(0,0,0,.75),0 8px 18px rgba(0,0,0,.3);
        }
        .volCard__title{
          font-size:9px;color:#dbe6f3;font-weight:800;text-align:center;margin-bottom:3px;width:100%;
        }
        .volCard__db{
          display:flex;justify-content:center;margin:0 0 5px;width:100%;
        }
        .volCard__db span{
          width:100%;max-width:100%;padding:.12rem .25rem;border-radius:2px;color:#2af02a;background:#202020;
          box-shadow:inset 0 0 3px 2px rgba(0,0,0,.5);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
          text-align:center;font-size:9px;letter-spacing:.02em;box-sizing:border-box;
        }
        .volCard__row{
          flex:1;min-height:0;width:100%;display:flex;justify-content:center;align-items:stretch;padding:5px 0 2px;
          gap:0;
        }
        .volCard__vuCol{
          display:flex;align-items:stretch;justify-content:center;width:31px;flex-shrink:0;
        }
        .volCard__vuFrame{
          flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;width:100%;
          padding:4px 2px;border-radius:5px;border:1px solid #2f3f55;
          background:linear-gradient(180deg,#0f141c 0%,#0b1016 100%);
          box-shadow:inset 0 0 6px rgba(0,0,0,.55);
        }
        .volCard__vuLabel{
          font-size:7px;font-weight:800;letter-spacing:.1em;color:#7f93ab;margin-bottom:3px;
        }
        .volCard__vuMeterRow{
          flex:1;display:flex;align-items:stretch;justify-content:center;width:100%;min-height:0;gap:2px;
        }
        .volCard__vuMeter{
          flex:0 0 13px;width:13px;max-width:17px;border-radius:4px;
          background:linear-gradient(-180deg,#f40000 0%,#ec9500 10%,#bade09 18%,#429321 45%);
          -webkit-mask:linear-gradient(to bottom,transparent 0,transparent calc(100% - var(--vuFill,0%)),#000 calc(100% - var(--vuFill,0%)),#000 100%);
          mask:linear-gradient(to bottom,transparent 0,transparent calc(100% - var(--vuFill,0%)),#000 calc(100% - var(--vuFill,0%)),#000 100%);
          box-shadow:inset 0 0 3px rgba(0,0,0,.45);
        }
        .volCard__marks{
          display:flex;flex-flow:column nowrap;justify-content:space-between;height:100%;
          font-size:.4rem;color:#808080;line-height:1;text-align:right;min-width:0;flex:1 1 auto;
        }
        .volCard__fader{
          flex:0 0 36px;width:36px;min-width:36px;min-height:0;height:100%;
          display:flex;align-items:center;justify-content:center;position:relative;
          margin-left:14px;overflow:visible;box-sizing:border-box;
        }
        .volCard__fader:after{
          content:"";position:absolute;left:50%;top:0;width:4px;height:100%;
          transform:translateX(-50%);
          background:#121212;border-radius:999px;
          box-shadow:inset 0 0 2px rgba(255,255,255,.06);
        }
        .mixerHStrip{
          border:1px solid #334861;border-radius:12px;padding:10px;background:#111926;margin-bottom:12px;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
        }
        .mixerHStrip .meter-head{
          display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;
        }
        .mixerHStrip .meter-name{
          color:#d2a8ff;font-weight:700;font-size:13px;
        }
        .mixerHStrip .meter-value{
          color:#9ab8d8;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
          background:#222b36;border:1px solid #3c5068;border-radius:4px;padding:2px 6px;
        }
        .mixerHEqRow{
          display:flex;align-items:center;gap:8px;margin-top:8px;
        }
        .mixerHEqRow .eq-tag{
          min-width:52px;color:#9ab8d8;font-size:11px;font-weight:700;
        }
        .faderMarks{
          display:flex;justify-content:space-between;gap:8px;margin-top:5px;padding:0 2px;
          color:#7f93ab;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
        }
        .faderMarks span{ opacity:.92; }
        .eqKnobCol{
          display:flex;flex-direction:column;flex-wrap:nowrap;gap:5px;align-items:stretch;
        }
        .chCard__mixRow{
          display:grid;grid-template-columns:minmax(28px, max-content) minmax(42px, max-content);
          column-gap:6px;align-items:stretch;justify-content:center;width:100%;max-width:100%;
        }
        .chCard__mixRow--soloVol{
          grid-template-columns:minmax(28px, max-content);
          column-gap:0;
        }
        .chBoardShell{
          min-width:0;
          width:100%;
          max-width:100%;
          box-sizing:border-box;
          overflow-x:auto;
          overflow-y:hidden;
          border:1px solid #3a516d;
          border-radius:18px;
          background:
            radial-gradient(circle at top, rgba(88,166,255,.08), transparent 24%),
            linear-gradient(180deg,#131a24 0%,#0f141c 100%);
          padding:10px 8px 14px;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 12px 28px rgba(0,0,0,.2);
        }
        .chBoard{
          display:flex;gap:10px;align-items:stretch;
          width:max-content;
          max-width:none;
          padding:2px 2px 10px;
          scroll-snap-type:x mandatory;
        }
        .deskInfoPill{
          display:grid;gap:4px;min-width:132px;padding:10px 12px;border-radius:14px;
          border:1px solid rgba(88,166,255,.18);background:rgba(8,13,20,.58);
        }
        .deskInfoPill__label{
          color:#7f93ab;font-size:11px;text-transform:uppercase;letter-spacing:.08em;
        }
        .chBoard.musicianDeskBoard{
          min-height:260px;
          align-items:stretch;
        }
        .chBoard.musicianDeskBoard .chCard{
          width:min(158px, 92vw);padding:4px 5px;gap:4px;border-radius:7px;
        }
        .chBoard.musicianDeskBoard .chCard__hdr{gap:4px;}
        .chBoard.musicianDeskBoard .chCard__badge{
          width:22px;height:22px;border-radius:6px;font-size:10px;
        }
        .chBoard.musicianDeskBoard .chCard__titles strong{font-size:10px;}
        .chBoard.musicianDeskBoard .chCard__titles small{font-size:8px;}
        .chBoard.musicianDeskBoard .chCard__mixRow{
          grid-template-columns:minmax(20px, max-content) minmax(32px, max-content);
          column-gap:4px;
        }
        .chBoard.musicianDeskBoard .chCard__mixRow--soloVol{
          grid-template-columns:minmax(20px, max-content);
        }
        .chBoard.musicianDeskBoard .eqKnob{
          width:34px;padding:3px 2px;border-radius:6px;gap:1px;
        }
        .chBoard.musicianDeskBoard .eqKnob__label{font-size:8px;}
        .chBoard.musicianDeskBoard .eqKnob__dial{width:28px;height:28px;}
        .chBoard.musicianDeskBoard .eqKnob__dial::after{height:9px;width:2px;}
        .chBoard.musicianDeskBoard .eqKnob__value{font-size:7px;padding:1px 2px;}
        .chBoard.musicianDeskBoard .volCard{
          max-width:72px;padding:4px 2px 5px;border-radius:5px;
        }
        .chBoard.musicianDeskBoard .volCard__vuCol{width:26px;}
        .chBoard.musicianDeskBoard .volCard__vuMeter{
          flex:0 0 11px;width:11px;max-width:14px;
        }
        .chBoard.musicianDeskBoard .volCard__fader{
          flex:0 0 30px;width:30px;min-width:30px;margin-left:10px;
        }
        .musicianProfilesScroll{
          max-height:min(310px, 42vh);
          min-height:0;
          overflow-y:auto;
          overflow-x:hidden;
          scroll-snap-type:y mandatory;
          overscroll-behavior-y:contain;
          display:flex;
          flex-direction:column;
          gap:12px;
          padding:4px 12px 8px 2px;
        }
        .musicianProfileCard{
          scroll-snap-align:start;
          scroll-snap-stop:always;
          flex:0 0 auto;
          box-sizing:border-box;
        }
        .chCard__mixRow .eqKnobCol{align-items:flex-end;}
        .eqKnobRow{
          display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;
        }
        .eqKnob{
          width:42px;display:flex;flex-direction:column;align-items:center;gap:2px;
          padding:4px 2px;border:1px solid color-mix(in srgb, var(--ch-accent, #58a6ff) 35%, #324a64);
          border-radius:7px;background:#101822;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
        }
        .eqKnob__label{
          font-size:9px;font-weight:800;letter-spacing:.03em;color:color-mix(in srgb, var(--ch-accent, #dbe6f3) 70%, #dbe6f3);text-transform:uppercase;
        }
        .eqKnob__dial{
          position:relative;width:34px;height:34px;border-radius:999px;
          background:
            conic-gradient(from -130deg,#2ea043 0 var(--knob-fill,50%), #243347 var(--knob-fill,50%) 100%);
          box-shadow:
            inset 0 0 0 2px #0d141d,
            0 5px 10px rgba(0,0,0,.32),
            0 0 0 1px color-mix(in srgb, var(--ch-accent, #58a6ff) 55%, transparent),
            0 0 14px color-mix(in srgb, var(--ch-accent, #58a6ff) 22%, transparent);
          border:1px solid color-mix(in srgb, var(--ch-accent, #58a6ff) 40%, #445b75);
        }
        .eqKnob__dial::after{
          content:"";position:absolute;left:50%;top:50%;width:2px;height:11px;border-radius:99px;
          background:#f6fbff;transform-origin:50% calc(100% - 2px);
          transform:translate(-50%,-90%) rotate(var(--knob-angle,-130deg));
          box-shadow:0 0 0 1px rgba(0,0,0,.35);
        }
        .eqKnob__input{
          position:absolute;inset:0;opacity:0;cursor:pointer;
        }
        .eqKnob__value{
          width:100%;max-width:100%;text-align:center;padding:1px 3px;border-radius:3px;
          border:1px solid color-mix(in srgb, var(--ch-accent, #58a6ff) 25%, #3c5068);
          background:#222b36;color:#9ab8d8;font-size:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
          box-sizing:border-box;
        }
        .chCard{
          --ch-accent:#58a6ff;
          flex:0 0 auto;width:min(218px, 88vw);scroll-snap-align:start;box-sizing:border-box;
          border-radius:16px;padding:10px 10px 9px;
          background:
            radial-gradient(circle at top right, color-mix(in srgb, var(--ch-accent, #58a6ff) 12%, transparent), transparent 28%),
            linear-gradient(180deg,#19212d 0%,#101722 100%);
          box-shadow:0 14px 28px rgba(0,0,0,.26), inset 0 1px 0 rgba(255,255,255,.03);
          display:flex;flex-direction:column;gap:8px;
        }
        .chCard__sourcePill{
          align-self:flex-start;
          padding:4px 10px;border-radius:999px;
          border:1px solid color-mix(in srgb, var(--ch-accent, #58a6ff) 35%, #3c5068);
          background:rgba(8,13,20,.68);
          color:color-mix(in srgb, var(--ch-accent, #dbe6f3) 72%, #dbe6f3);
          font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
        }
        .chCard__hdr{
          display:flex;align-items:flex-start;gap:6px;
        }
        .chCard__badge{
          position:relative;
          width:27px;height:27px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:900;
          color:#07111a;box-shadow:0 6px 14px rgba(0,0,0,.25);flex:0 0 auto;
          font-size:14px;
        }
        .chCard__badge--muted::after{
          content:"";
          position:absolute;left:50%;top:50%;
          width:2px;height:22px;border-radius:99px;background:#f85149;
          transform:translate(-50%,-50%) rotate(-35deg);
          box-shadow:0 0 8px rgba(248,81,73,.6);
        }
        .chCard__titles{min-width:0;flex:1 1 auto;}
        .chCard__titles strong{display:block;font-size:12px;line-height:1.15;color:#e8eaed;}
        .chCard__titles small{display:block;margin-top:2px;color:#9aa0a6;font-size:10px;line-height:1.25;}
        .deskFieldLabel{
          color:#8ea8c2;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
        }
        .deskField{
          width:100%;box-sizing:border-box;padding:8px 10px;border-radius:10px;border:1px solid #3c5068;
          background:#141c28;color:#e8eaed;outline:none;font-size:11px;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
        }
        .deskField:focus{border-color:color-mix(in srgb, var(--ch-accent, #58a6ff) 55%, #3c5068);box-shadow:0 0 0 2px color-mix(in srgb, var(--ch-accent, #58a6ff) 25%, transparent);}
        .deskSelect{
          width:100%;box-sizing:border-box;padding:8px 10px;border-radius:10px;border:1px solid #3c5068;
          background:#141c28;color:#e8eaed;outline:none;font-size:11px;
        }
        .deskMiniRow{display:flex;gap:8px;align-items:center;}
        .deskColor{
          width:34px;height:34px;padding:0;border-radius:10px;border:1px solid color-mix(in srgb, var(--ch-accent, #58a6ff) 35%, #3c5068);
          background:transparent;cursor:pointer;box-shadow:inset 0 0 0 2px rgba(0,0,0,.35);
        }
        .deskBtn{
          border:1px solid color-mix(in srgb, var(--ch-accent, #58a6ff) 35%, #3c5068);
          background:linear-gradient(180deg,#223047 0%,#141c28 100%);
          color:#dbe6f3;border-radius:999px;padding:7px 12px;font-weight:800;font-size:10px;cursor:pointer;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.05);
        }
        .deskBtn:hover{border-color:color-mix(in srgb, var(--ch-accent, #58a6ff) 65%, #3c5068);}
        .deskMute{
          position:relative;display:inline-flex;align-items:center;gap:6px;user-select:none;
          padding:4px 8px;border-radius:999px;border:1px solid #3c5068;background:#141c28;color:#dbe6f3;font-size:10px;font-weight:800;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
        }
        .deskMute input{
          position:absolute;opacity:0;
        }
        .deskMute__led{
          width:8px;height:8px;border-radius:999px;background:#2ea043;box-shadow:0 0 8px rgba(46,160,67,.55);
        }
        .deskMute__toggle{
          position:relative;display:inline-flex;align-items:center;justify-content:center;
          width:18px;height:18px;border-radius:999px;
          border:1px solid #5f7998;background:#172234;color:#bdd6f7;
          font-size:10px;line-height:1;
        }
        .deskMute__toggleDot{
          position:absolute;right:-2px;bottom:-2px;
          width:6px;height:6px;border-radius:999px;background:#2ea043;
          box-shadow:0 0 6px rgba(46,160,67,.55);
        }
        .deskMute--on{
          border-color:color-mix(in srgb, #f85149 55%, #3c5068);
          color:#ffb4b0;
          background:linear-gradient(180deg,#2a1a1f 0%,#141c28 100%);
        }
        .deskMute--on .deskMute__led{
          background:#f85149;box-shadow:0 0 12px rgba(248,81,73,.55);
        }
        .deskMute--on .deskMute__toggle{
          border-color:#f85149;background:#2b1a22;color:#f2f6ff;
        }
        .deskMute--on .deskMute__toggleDot{
          background:#f85149;box-shadow:0 0 8px rgba(248,81,73,.55);
        }
        .deskLatch{
          position:relative;display:inline-flex;align-items:center;gap:6px;user-select:none;width:100%;box-sizing:border-box;
          padding:5px 8px;border-radius:999px;border:1px solid #3c5068;background:#141c28;color:#dbe6f3;font-size:10px;font-weight:800;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
        }
        .deskLatch input{position:absolute;opacity:0;}
        .deskLatch__led{
          width:8px;height:8px;border-radius:999px;background:#6e7681;box-shadow:0 0 6px rgba(110,118,129,.25);
        }
        .deskLatch--on{
          border-color:color-mix(in srgb, #fbbc04 55%, #3c5068);
          color:#ffe7a8;
          background:linear-gradient(180deg,#2a2416 0%,#141c28 100%);
        }
        .deskLatch--on .deskLatch__led{
          background:#fbbc04;box-shadow:0 0 12px rgba(251,188,4,.45);
        }
        .panInline{
          margin:0 auto 4px;max-width:100%;padding:8px 10px;border:1px solid #334861;border-radius:12px;background:#111926;
          box-shadow:inset 0 1px 0 rgba(255,255,255,.03);
        }
        .panInline__head{
          display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;
          color:#dbe6f3;font-size:11px;font-weight:800;line-height:1.1;
        }
        .panInline__scale{
          display:flex;justify-content:space-between;margin-top:3px;color:#8ea8c2;font-size:10px;line-height:1.1;
          font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
        }
        .panInline .inearRange{
          height:14px;
        }
        .panInline .inearRange::-webkit-slider-runnable-track{
          height:5px;
        }
        .panInline .inearRange::-webkit-slider-thumb{
          margin-top:-5px;width:13px;height:18px;border-radius:3px;
        }
        .panInline .inearRange::-moz-range-track{
          height:5px;
        }
        .panInline .inearRange::-moz-range-thumb{
          width:13px;height:18px;border-radius:3px;
        }
      `}</style>
      {error && <p style={{ color: '#f28b82' }}>{error}</p>}
      <nav style={ui.navWrap}>
        {role === 'admin' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 8, color: '#7f93ab', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 700 }}>
              Bloco ativo
              <span style={{ color: '#f0f6fc' }}>{activeAdminTabLabel}</span>
            </div>
            {adminTabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                style={{
                  ...ui.tabBtn,
                  ...(tab === k ? ui.tabBtnActive : {}),
                }}
              >
                {label}
              </button>
            ))}
          </>
        )}
        {role === 'musician' && (
          <span style={{ color: '#9aa0a6' }}>
            Seu retorno aparece abaixo. Ajuste o que quer ouvir em cada canal depois que o
            técnico preparar a mesa.
          </span>
        )}
      </nav>

      {!showfile && <p>Carregando dados do show…</p>}

      {showfile && role === 'admin' && tab === 'session' && (
        <section style={ui.panelCard}>
          <h2 style={{ marginTop: 0 }}>Visão geral</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {[
              { title: 'Endereço principal', value: preferredServerApiBase, accent: '#58a6ff' },
              { title: 'Porta do áudio', value: ':9876', accent: '#2ea043' },
              { title: 'Porta de controle', value: ':9877', accent: '#fbbc04' },
              { title: 'Nome do show', value: showfile.name, accent: '#d2a8ff' },
            ].map((item) => (
              <div
                key={item.title}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${item.accent}33`,
                  background: 'rgba(10,15,23,.64)',
                  padding: 14,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.03)',
                }}
              >
                <div style={{ color: '#8ea8c2', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                  {item.title}
                </div>
                <div style={{ color: '#f0f6fc', fontWeight: 800, marginTop: 6, wordBreak: 'break-word' }}>{item.value}</div>
              </div>
            ))}
          </div>
          <p>
            Endereço do painel <code>{preferredServerApiBase}</code> · áudio <code>:9876</code>{' '}
            · controle <code>:9877</code>
          </p>
          <p>Show atual: {showfile.name}</p>
                  <p>Tipo de rede: {showfile.networkProfile}</p>
          <p style={{ color: '#9aa0a6', maxWidth: 640 }}>
            Quando a entrada de áudio estiver ativa, <strong>Sincronizar canais da interface</strong>{' '}
            cria automaticamente os canais do show conforme a quantidade escolhida em{' '}
            <strong>Entrada de áudio</strong>. Depois, abra <strong>Mesa</strong> para organizar os
            canais e ajustar o que cada músico vai ouvir.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
            <button type="button" onClick={() => refreshShowfile()} style={ui.pillBtn}>
              Atualizar dados
            </button>
            <button
              type="button"
              style={ui.pillBtn}
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
              Sincronizar canais da interface
            </button>
          </div>
        </section>
      )}

      {showfile && role === 'admin' && tab === 'channels' && (
        <ChannelTable
          token={token}
          showfile={showfile}
          audioInputLevels={audioInputLevels}
          onSaved={refreshShowfile}
          onChannelStripPatched={mergeChannelStripIntoShowfile}
        />
      )}

      {showfile && role === 'admin' && tab === 'musicians' && (
        <MusicianTable
          showfile={showfile}
          token={token}
          audioInputLevels={audioInputLevels}
          onSaved={refreshShowfile}
          onMusicianStripPatched={mergeMusicianStripIntoShowfile}
        />
      )}

      {showfile && role === 'admin' && tab === 'audio' && (
        <section style={ui.panelCard}>
          <MacAudioInputsPanel
            token={token}
            role={role}
            onError={setError}
            onSyncedShowfile={refreshShowfile}
          />
        </section>
      )}

      {showfile && role === 'admin' && tab === 'network' && (
        <section style={ui.panelCard}>
          <h2 style={{ marginTop: 0 }}>Conexão e resposta do som</h2>
          <div
            style={{
              display: 'grid',
              gap: 10,
              marginBottom: 16,
              maxWidth: 920,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <div
              style={{
                border: '1px solid #30363d',
                borderRadius: 12,
                padding: 12,
                background: '#0d1621',
              }}
            >
              <div style={{ color: '#8ea8c2', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Tipo de rede
              </div>
              <strong style={{ color: '#e8eaed', display: 'block', marginTop: 6 }}>
                {showfile.networkProfile === 'wifi_5'
                  ? '5 GHz recomendado'
                  : showfile.networkProfile === 'wifi_2_4'
                    ? '2.4 GHz'
                    : 'Auto'}
              </strong>
              <p style={{ color: '#9aa0a6', margin: '8px 0 0', fontSize: 13 }}>
                Use 5 GHz sempre que puder. Em 2.4 GHz, deixe a rede mais estável e sem muita disputa.
              </p>
            </div>
            <div
              style={{
                border: '1px solid #30363d',
                borderRadius: 12,
                padding: 12,
                background: '#10151d',
              }}
            >
              <div style={{ color: '#8ea8c2', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>
                Resposta do computador
              </div>
              <strong style={{ color: '#e8eaed', display: 'block', marginTop: 6 }}>
                {audioBlockSamples ?? '—'} passos de áudio
              </strong>
              <p style={{ color: '#9aa0a6', margin: '8px 0 0', fontSize: 13 }}>
                Valores menores deixam o retorno mais rápido, mas podem aumentar o risco de falhas.
              </p>
            </div>
          </div>
          <h3 style={{ color: '#e8eaed', marginBottom: 8 }}>Como está a conexão de cada integrante</h3>
          <div
          style={{
              display: 'grid',
              gap: 10,
              marginBottom: 16,
              maxWidth: 920,
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            }}
          >
            {showfile.musicians.map((m) => {
              const q = networkQualityByUser[m.username]
              const dot = !q
                ? '#484f58'
                : q.level === 'bad'
                  ? '#f85149'
                  : q.level === 'warn'
                    ? '#d29922'
                    : '#39ff14'
              return (
                <div
                  key={m.id}
                  style={{
                    border: '1px solid #30363d',
                    borderRadius: 12,
                    padding: 12,
                    background: '#11161f',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        background: dot,
                        border: '1px solid #484f58',
                      }}
                    />
                    <strong style={{ color: '#e8eaed' }}>{m.name}</strong>
                    <span style={{ color: '#8b949e', fontSize: 13 }}>({m.username})</span>
                  </div>
                  {q ? (
                    <>
                      <p style={{ color: '#9aa0a6', margin: '8px 0 0', fontSize: 13 }}>
                        {q.hint}
                        {q.rttMs != null ? ` · ida e volta ~${q.rttMs} ms` : ''}
                        {q.jitterMs != null ? ` · oscilação ~${q.jitterMs} ms` : ''}
                        {q.gapsPerMinute != null
                          ? ` · ~${q.gapsPerMinute} falhas/min`
                          : ''}
                      </p>
                      <p style={{ color: '#9aa0a6', margin: '6px 0 0', fontSize: 12 }}>
                        Meta de atraso abaixo de 1000 ms:{' '}
                        <strong
                          style={{ color: q.slaUnder1s ? '#39ff14' : '#f85149' }}
                        >
                          {q.slaUnder1s ? 'OK' : 'ATENCAO'}
                        </strong>
                        {q.estimatedE2eMs != null ? ` · média ~${q.estimatedE2eMs} ms` : ''}
                        {q.estimatedE2eP95Ms != null
                          ? ` · pico comum ~${q.estimatedE2eP95Ms} ms`
                          : ''}
                        {q.aheadP95Ms != null ? ` · sobra ~${q.aheadP95Ms} ms` : ''}
                        {q.queueDepthP95 != null ? ` · fila ~${q.queueDepthP95}` : ''}
                        {q.sampleCount != null ? ` · leituras ${q.sampleCount}` : ''}
                        {q.slaBreaches ? ` · fora da meta ${q.slaBreaches}` : ''}
                      </p>
                      {q.recommendations && q.recommendations.length > 0 ? (
                        <ul style={{ color: '#8b949e', margin: '8px 0 0', paddingLeft: 18 }}>
                          {q.recommendations.map((item) => (
                            <li key={item} style={{ marginBottom: 4 }}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : (
                    <p style={{ color: '#6e7681', margin: '8px 0 0', fontSize: 13 }}>
                      Ainda sem dados desse integrante. O retorno precisa estar aberto no celular.
                    </p>
                  )}
                </div>
              )
            })}
          </div>
          <h3 style={{ color: '#e8eaed', marginBottom: 8 }}>Velocidade de resposta do computador</h3>
          <p style={{ color: '#9aa0a6', marginTop: 0, marginBottom: 10 }}>
            Atual:{' '}
            <strong style={{ color: '#e8eaed' }}>
              {audioBlockSamples ?? '—'} passos (~
              {audioBlockSamples
                ? ((audioBlockSamples / 48000) * 1000).toFixed(2)
                : '?'}
              ms)
            </strong>
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {([64, 128, 256, 512] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={async () => {
                  setError(null)
                  try {
                    const r = await api<{ audioBlockSamples: number }>(
                      '/api/audio-engine',
                      {
                        method: 'PATCH',
                        token,
                        body: JSON.stringify({ audioBlockSamples: n }),
                      },
                    )
                    setAudioBlockSamples(r.audioBlockSamples)
                  } catch (e) {
                    setError(String((e as Error).message))
                  }
                }}
                style={{
                  ...ui.pillBtn,
                  ...(audioBlockSamples === n ? ui.tabBtnActive : {}),
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <h3 style={{ color: '#e8eaed', marginBottom: 8 }}>Tipo de rede usada no palco</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['wifi_2_4', 'wifi_5', 'auto'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => saveNetworkProfile(p)}
                style={{
                  ...ui.pillBtn,
                  ...(showfile.networkProfile === p ? ui.tabBtnActive : {}),
                }}
              >
                {p === 'wifi_5' ? '5 GHz' : p === 'wifi_2_4' ? '2.4 GHz' : 'Automático'}
              </button>
            ))}
          </div>
        </section>
      )}

      {pairingUiEnabled && showfile && role === 'admin' && tab === 'pairing' && (
        <section style={ui.panelCard}>
          <h2>Código de acesso para músicos</h2>
          <p style={{ color: '#9aa0a6', marginTop: 0 }}>
            Gere um código rápido para o músico entrar no retorno sem digitar usuário e senha.
          </p>
          <button type="button" onClick={generatePairing} style={ui.pillBtn}>
            Gerar código de 6 dígitos
          </button>
          {pairCode && (
            <p style={{ fontSize: 28, letterSpacing: 6 }}>{pairCode}</p>
          )}
          {pairExpiry && (
            <p style={{ color: '#9aa0a6' }}>
              Válido até {new Date(pairExpiry).toLocaleString()}
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
            Este acesso não combina com nenhum músico cadastrado neste show. Entre novamente com
            o usuário e a senha corretos.
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
            audioInputLevels={audioInputLevels}
            onMusicianStripPatched={mergeMusicianStripIntoShowfile}
          />
        </>
      )}
    </main>
  )
}

function linearToDb(v: number): string {
  const clamped = Math.max(0, Math.min(4, Number(v) || 0))
  if (clamped <= 0.0001) return '-80.0'
  return (20 * Math.log10(clamped)).toFixed(1)
}

function sliderFillStyle(value: number, min: number, max: number): CSSProperties {
  const span = Math.max(1e-9, max - min)
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  return { '--fill': `${pct}%` } as CSSProperties
}

function clampLin(v: number, min: number, max: number): number {
  const n = Number(v)
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min))
}

function eqBandLabel(k: 'lowDb' | 'midDb' | 'highDb'): 'Low' | 'Mid' | 'High' {
  if (k === 'lowDb') return 'Low'
  if (k === 'midDb') return 'Mid'
  return 'High'
}

function channelIconGlyph(icon?: string): string {
  switch (icon) {
    case 'kick':
    case 'snare':
    case 'tom1':
    case 'tom2':
    case 'floor':
    case 'hihat':
    case 'crash':
    case 'ride':
      return '🥁'
    case 'overhead':
    case 'mic':
      return '🎙'
    case 'bass':
    case 'guitar':
      return '🎸'
    case 'keys':
      return '🎹'
    case 'vocal':
      return '🎤'
    case 'click':
      return '⏱'
    case 'track':
      return '🎵'
    default:
      return '🎚'
  }
}

function eqKnobStyle(value: number, min: number, max: number): CSSProperties {
  const span = Math.max(1e-9, max - min)
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  const angle = -130 + pct * 2.6
  return {
    '--knob-fill': `${pct}%`,
    '--knob-angle': `${angle}deg`,
  } as CSSProperties
}

function gainFaderMarks(maxGain: number): string[] {
  if (maxGain > 1.0001) return ['+12 dB', '+6', '0', '-12', '-80']
  return ['0 dB', '-6', '-12', '-24', '-80']
}

function vuFillFromLevel(level: number): CSSProperties {
  const pct = Math.max(0, Math.min(100, Number(level || 0) * 100))
  return { '--vuFill': `${pct}%` } as CSSProperties
}

function channelVuLevel(
  ch: Pick<ChannelStrip, 'captureInputIndex'>,
  levelsByIndex: Record<string, number>,
): number {
  const idx = ch.captureInputIndex
  if (typeof idx !== 'number') return 0
  return Math.max(0, Math.min(1, Number(levelsByIndex[String(idx)] || 0)))
}

function groupVuLevel(
  showfile: Showfile,
  groupId: string,
  levelsByIndex: Record<string, number>,
): number {
  const group = showfile.groups.find((g) => g.id === groupId)
  if (!group) return 0
  let peak = 0
  for (const cid of group.channelIds) {
    const ch = showfile.channels.find((item) => item.id === cid)
    if (!ch) continue
    const next = channelVuLevel(ch, levelsByIndex)
    if (next > peak) peak = next
  }
  return peak
}

type CaptureInputMatrix = {
  gainL: number
  gainR: number
  assign: Record<string, 'sum' | 'L' | 'R'>
  gainByIndex?: Record<string, number>
}

/** Nome DirectShow típico: `Entrada (Driver / interface)`. */
function splitAudioDeviceEndpointName(name: string): {
  entrada: string
  interfaceDriver?: string
} {
  const t = String(name || '').trim()
  const m = t.match(/^(.+?)\s+\(([^)]+)\)\s*$/)
  if (m) return { entrada: m[1].trim(), interfaceDriver: m[2].trim() }
  return { entrada: t }
}

type AudioCaptureDevicesRes = {
  platform: string
  ffmpegFound?: boolean
  usingBundledWinFfmpeg?: boolean
  ffprobeFound?: boolean
  dshowListDiag?: {
    exitCode: number | null
    combinedLen: number
    outputTail: string
    ffmpegDevicesExitCode?: number | null
    ffmpegDevicesTail?: string
    ffmpegHasDshowInDevices?: boolean | null
  } | null
  devices: {
    index: number
    name: string
    inputChannels: number | null
    probeError?: string | null
    dshowOptionsTail?: string | null
  }[]
  captureSource: 'env' | 'avfoundation' | 'dshow' | 'none'
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
  winDshowCaptureMode?: 'single' | 'aggregate'
  winDshowAggregateInputs?: { name: string }[]
  winDshowAggregateActive?: boolean
  aggregateTotalChannels?: number | null
}

type AudioDebugResponse = {
  configured: boolean
  receiving: boolean
  captureSource: string | null
  captureMode: string | null
  captureDeviceName: string | null
  captureDeviceIndex: number | null
  ffmpegPath: string | null
  captureChildRunning: boolean
  captureChannelCount: number
  captureUnderruns: number
  captureBufferedBytes: number
  captureLastGoodMsAgo: number | null
  captureLastChunkMsAgo: number | null
  captureLastChunkBytes: number
  captureTotalBytes: number
  captureLastError: string | null
  captureStderrTail: string[]
  udpTargetCount: number
  wsClientCount: number
  webrtcSessionCount: number
  lastUdpSendMsAgo: number | null
  lastUdpSendMusicianId: string | null
  lastWsSendMsAgo: number | null
  lastWsSendMusicianId: string | null
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
  const [permBusy, setPermBusy] = useState(false)
  const [loadHint, setLoadHint] = useState<string | null>(null)
  const [captureChCount, setCaptureChCount] = useState(2)
  const [gainByIndex, setGainByIndex] = useState<Record<string, number>>({})
  const [channelCountAuto, setChannelCountAuto] = useState(true)
  const [audioDebug, setAudioDebug] = useState<AudioDebugResponse | null>(null)
  const [winCapMode, setWinCapMode] = useState<'single' | 'aggregate'>('single')
  const [aggOrder, setAggOrder] = useState<string[]>([])
  const compactBtnStyle: CSSProperties = {
    padding: '6px 10px',
    minHeight: 30,
    borderRadius: 6,
    border: '1px solid #4b5563',
    background: '#1f2937',
    color: '#e5e7eb',
    fontSize: 12,
    lineHeight: '16px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }

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

  useEffect(() => {
    let cancelled = false
    const loadDebug = async () => {
      try {
        const j = await api<AudioDebugResponse>('/api/audio-debug', { token })
        if (!cancelled) setAudioDebug(j)
      } catch {
        if (!cancelled) setAudioDebug(null)
      }
    }
    void loadDebug()
    const t = setInterval(loadDebug, 1600)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [token])

  const load = useCallback(
    async (refreshList = false, probeAllDevices = false, dshowListOptions = false) => {
      const showBusy = refreshList || probeAllDevices
      if (showBusy) {
        setBusy(true)
        setLoadHint(
          probeAllDevices && dshowListOptions
            ? 'A correr ffprobe e list_options DirectShow em cada dispositivo (pode demorar bastante)…'
            : probeAllDevices
              ? 'A correr ffprobe em todos os dispositivos (o pedido pode demorar alguns segundos; aguarda)…'
              : 'A atualizar a lista de entradas…',
        )
      }
      onError(null)
      try {
        const qs = new URLSearchParams()
        if (refreshList) qs.set('refresh', '1')
        if (probeAllDevices) qs.set('probe', 'all')
        if (dshowListOptions) qs.set('dshowOptions', '1')
        const q = qs.toString()
        const path =
          q.length > 0
            ? `/api/audio-capture-devices?${q}`
            : '/api/audio-capture-devices'
        const j = await api<AudioCaptureDevicesRes>(path, {
          token,
        })
        setData(j)
        if (j.platform === 'win32') {
          setWinCapMode(j.winDshowCaptureMode === 'aggregate' ? 'aggregate' : 'single')
          setAggOrder(
            (j.winDshowAggregateInputs || [])
              .map((x) => String(x?.name || '').trim())
              .filter(Boolean),
          )
        }
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

  const requestOsMicPermission = useCallback(async () => {
    const fn =
      typeof window !== 'undefined' ? window.inearDesktop?.requestCapturePermission : undefined
    if (typeof fn !== 'function') {
      onError(
        'O pedido de permissão ao sistema só está disponível na aplicação inEar Desktop (Electron), não no browser.',
      )
      return
    }
    setPermBusy(true)
    onError(null)
    try {
      const r = await fn()
      if (!r?.ok) {
        onError(
          `Permissão de microfone/captura: ${r?.detail || 'recusada ou indisponível'}. Nas definições de privacidade do sistema, permite o inEar Desktop.`,
        )
      } else {
        await load(true)
      }
    } catch (e) {
      onError(String((e as Error).message))
    } finally {
      setPermBusy(false)
    }
  }, [load, onError])

  async function applySelection(mode: 'save' | 'clear') {
    if (!canEdit || !data) return
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
      const winSingle =
        data.platform === 'win32' ? ({ winDshowCaptureMode: 'single' as const } as const) : {}
      if (selectVal === SEL_AUTO) {
        await api('/api/audio-capture-device', {
          method: 'PATCH',
          token,
          body: JSON.stringify({ captureAvfoundationMode: 'auto', ...winSingle }),
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
            ...winSingle,
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

  async function applyWinAggregate() {
    if (!canEdit || !data || data.platform !== 'win32') return
    if (aggOrder.length < 2) {
      onError('Selecciona e ordena pelo menos duas entradas DirectShow para o agregado.')
      return
    }
    setBusy(true)
    onError(null)
    try {
      const capMode = data.captureMode === 'off' ? 'auto' : data.captureMode
      const body: Record<string, unknown> = {
        winDshowCaptureMode: 'aggregate',
        winDshowAggregateInputs: aggOrder.map((name) => ({ name })),
        captureAvfoundationMode: capMode,
      }
      if (capMode === 'manual' && data.manualAvfoundationAudioIndex != null) {
        body.avfoundationAudioIndex = data.manualAvfoundationAudioIndex
      }
      await api('/api/audio-capture-device', {
        method: 'PATCH',
        token,
        body: JSON.stringify(body),
      })
      await load(true, true)
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
        <h2>Escolha da entrada de áudio</h2>
        <p>A carregar…</p>
      </section>
    )
  }

  return (
    <section>
      <h2>Escolha da entrada de áudio</h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 10,
          maxWidth: 920,
          marginBottom: 12,
        }}
      >
        <div style={{ border: '1px solid #334861', borderRadius: 12, padding: 12, background: '#0f1722' }}>
          <div style={{ color: '#8ea8c2', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>Sistema</div>
          <strong style={{ color: '#e8eaed', display: 'block', marginTop: 6 }}>{data.platform === 'win32' ? 'Windows / DirectShow' : data.platform === 'darwin' ? 'macOS / AVFoundation' : data.platform}</strong>
        </div>
        <div style={{ border: '1px solid #334861', borderRadius: 12, padding: 12, background: '#0f1722' }}>
          <div style={{ color: '#8ea8c2', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>Escolha atual</div>
          <strong style={{ color: '#e8eaed', display: 'block', marginTop: 6 }}>{data.captureMode === 'auto' ? 'Automática' : data.captureMode === 'manual' ? 'Manual' : 'Desligada'}</strong>
        </div>
        <div style={{ border: '1px solid #334861', borderRadius: 12, padding: 12, background: '#0f1722' }}>
          <div style={{ color: '#8ea8c2', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em' }}>Entrada em uso</div>
          <strong style={{ color: '#e8eaed', display: 'block', marginTop: 6 }}>{data.captureSource === 'dshow' ? 'Entrada do Windows' : data.captureSource === 'avfoundation' ? 'Entrada do macOS' : data.captureSource === 'env' ? 'Comando manual' : 'Nenhuma'}</strong>
        </div>
      </div>
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
            Quer usar duas interfaces ao mesmo tempo?
          </h3>
          <p style={{ color: '#e8eaed', lineHeight: 1.55, marginBottom: 10 }}>
            O app lê uma entrada de áudio por vez. No Mac, se quiser juntar duas interfaces, crie antes um dispositivo agregado.
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
              Clica <strong>Provar todos</strong> e confirma quantos canais
              aparecem (ex. 4 se forem 2+2 estéreo). Liga <strong>N automático</strong> ou
              escreve <strong>N</strong> à mão.
            </li>
            <li>
              <strong>Aplicar ajustes</strong>, depois <strong>Sincronizar canais</strong> —
              no separador <strong>Canais</strong> pode renomear as entradas para ficar mais fácil de identificar.
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
      {data.platform !== 'darwin' && data.platform !== 'win32' ? (
        <p style={{ color: '#bdc1c6' }}>
          Esta plataforma não suporta lista nativa de entradas (usa macOS ou Windows, ou{' '}
          <code>INEAR_CAPTURE_CMD</code>).
        </p>
      ) : null}
      {data.captureSource === 'env' ? (
        <p style={{ color: '#fdd663', marginTop: 12 }}>
          A entrada está a ser controlada por um comando manual (<code>INEAR_CAPTURE_CMD</code>).
        </p>
      ) : null}
      {data.suggestedDevice && data.captureMode === 'auto' ? (
        <p style={{ marginTop: 12, color: '#81c995' }}>
          <strong>Sugestão automática:</strong>{' '}
          <code>[{data.suggestedDevice.index}]</code> {data.suggestedDevice.name}
        </p>
      ) : null}
      {data.captureSource === 'avfoundation' || data.captureSource === 'dshow' ? (
        <p style={{ marginTop: 12 }}>
          <strong>Entrada ativa:</strong>{' '}
          {data.captureSource === 'dshow' ? (
            <span style={{ color: '#9aa0a6' }}>Windows · </span>
          ) : null}
          {data.effectiveDeviceName != null
            ? `[${data.effectiveAvfoundationAudioIndex}] ${data.effectiveDeviceName}`
            : `índice :${data.effectiveAvfoundationAudioIndex}`}
          {data.autoPicked ? (
            <span style={{ color: '#9aa0a6' }}> · escolhida automaticamente</span>
          ) : null}
          <span style={{ color: '#9aa0a6' }}>
            {' '}
            · modo <code>{data.captureMode}</code>
          </span>
          {typeof data.effectiveProbedInputChannels === 'number' ? (
            <span style={{ color: '#81c995', display: 'block', marginTop: 6 }}>
              Esta entrada tem <strong>{data.effectiveProbedInputChannels}</strong>{' '}
              canal(is) disponíveis. Se o N automático estiver ligado, esse valor será usado ao reiniciar.
            </span>
          ) : data.effectiveProbeError ? (
            <span style={{ color: '#f0883e', display: 'block', marginTop: 6 }}>
              Não foi possível confirmar os canais desta entrada: {data.effectiveProbeError}
            </span>
          ) : null}
        </p>
      ) : (data.platform === 'darwin' || data.platform === 'win32') &&
        data.captureSource === 'none' ? (
        <p style={{ marginTop: 12, color: '#9aa0a6' }}>
          Nenhuma entrada foi encontrada no momento (modo <code>{data.captureMode}</code>
          {data.captureMode === 'auto'
            ? ' — nenhuma opção compatível foi encontrada'
            : ''}
          ). O app fica em teste até você escolher uma entrada válida.
        </p>
      ) : null}
      {audioDebug ? (
        <details
          style={{
            marginTop: 14,
            borderRadius: 10,
            border: '1px solid #334861',
            background: '#101926',
            color: '#dbe6f3',
            maxWidth: 920,
            overflow: 'hidden',
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              padding: 14,
              fontWeight: 800,
              color: '#dbe6f3',
              listStyle: 'none',
            }}
          >
            Diagnóstico avançado
          </summary>
          <div style={{ display: 'grid', gap: 6, padding: '0 14px 14px' }}>
            <div style={{ fontSize: 13, color: '#9ab8d8' }}>
              Fonte: {audioDebug.captureSource || 'none'} · modo {audioDebug.captureMode || 'n/a'} ·
              dispositivo {audioDebug.captureDeviceName || 'n/a'}
            </div>
            <div style={{ fontSize: 13, color: '#9ab8d8' }}>
              PCM: {audioDebug.receiving ? 'recebendo' : 'sem PCM'} · child{' '}
              {audioDebug.captureChildRunning ? 'ativo' : 'parado'} · ultimo bloco{' '}
              {audioDebug.captureLastGoodMsAgo ?? '-'} ms atras · underruns{' '}
              {audioDebug.captureUnderruns}
            </div>
            <div style={{ fontSize: 13, color: '#9ab8d8' }}>
              Envio: UDP {audioDebug.udpTargetCount} alvo(s), ultimo envio{' '}
              {audioDebug.lastUdpSendMsAgo ?? '-'} ms atras · WS {audioDebug.wsClientCount}, ultimo
              envio {audioDebug.lastWsSendMsAgo ?? '-'} ms atras
            </div>
            <div style={{ fontSize: 13, color: '#9ab8d8' }}>
              ffmpeg: <code>{audioDebug.ffmpegPath || 'nao encontrado'}</code>
            </div>
            {audioDebug.captureLastError ? (
              <div style={{ fontSize: 13, color: '#f0883e' }}>
                Ultimo erro: {audioDebug.captureLastError}
              </div>
            ) : null}
            {audioDebug.captureStderrTail?.length ? (
              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 8,
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  color: '#c9d1d9',
                  fontSize: 12,
                  lineHeight: 1.45,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {audioDebug.captureStderrTail.join('\n')}
              </pre>
            ) : null}
          </div>
        </details>
      ) : null}
      {data.devices.length === 0 && data.platform === 'darwin' ? (
        <p style={{ color: '#f28b82', marginTop: 8 }}>
          Lista vazia ou <code>ffmpeg</code> não encontrado no PATH do processo Electron.
          Instala com <code>brew install ffmpeg</code> ou define <code>INEAR_FFMPEG</code>.
        </p>
      ) : null}
      {data.platform === 'win32' && data.usingBundledWinFfmpeg ? (
        <p style={{ color: '#81c995', marginTop: 8, maxWidth: 820 }}>
          O instalador inclui <code>ffmpeg</code> / <code>ffprobe</code> para DirectShow (não dependes
          do PATH do sistema).
        </p>
      ) : null}
      {data.devices.length === 0 && data.platform === 'win32' && data.ffmpegFound === false ? (
        <p style={{ color: '#f28b82', marginTop: 8, maxWidth: 820, lineHeight: 1.55 }}>
          <strong>ffmpeg não encontrado.</strong> Na build oficial corre{' '}
          <code>npm run dist:win</code> (descarrega binários para o instalador). Em desenvolvimento,
          corre <code>node scripts/download-ffmpeg-windows.cjs</code> na pasta{' '}
          <code>apps/desktop-server</code>, ou instala FFmpeg no PATH / define{' '}
          <code>INEAR_FFMPEG</code> e <code>INEAR_FFPROBE</code>.
        </p>
      ) : null}
      {data.devices.length === 0 &&
      data.platform === 'win32' &&
      data.ffmpegFound === true ? (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 8,
            border: '1px solid #8b5a2b',
            background: '#2d1f14',
            color: '#e8eaed',
            maxWidth: 860,
            lineHeight: 1.55,
          }}
        >
          <p style={{ margin: '0 0 10px', color: '#f0883e' }}>
            <strong>ffmpeg encontrado</strong>, mas a lista DirectShow veio vazia. No Windows 10/11
            isto costuma ser <strong>permissão de microfone</strong> ou política que bloqueia apps de
            ambiente de trabalho.
          </p>
          <ol style={{ margin: '0 0 12px', paddingLeft: 22, color: '#c9d1d9' }}>
            <li>
              Abre as definições do microfone:{' '}
              <a href="ms-settings:privacy-microphone" style={{ color: '#58a6ff' }}>
                ms-settings:privacy-microphone
              </a>
              .
            </li>
            <li>
              Liga <strong>Acesso ao microfone</strong> e, no Windows 11, liga também{' '}
              <strong>Permitir que as aplicações de ambiente de trabalho acedam ao microfone</strong>{' '}
              (ou equivalente em inglês: &quot;Let desktop apps access your microphone&quot;).
            </li>
            <li>
              Em <strong>Definições → Sistema → Som</strong>, confirma que há entradas listadas; se a
              interface não aparece, atualiza o driver (Fabricante do PC / Realtek / Focusrite…).
            </li>
            <li>
              Fecha outras apps que possam estar a usar o microfone em exclusivo (Teams, Zoom, DAW).
            </li>
            <li>
              <strong>Reinicia o inEar Desktop</strong> depois de alterar as definições e carrega em
              &quot;Atualizar lista&quot; abaixo.
            </li>
          </ol>
          <p style={{ margin: 0, color: '#9aa0a6', fontSize: 13 }}>
            Se a lista continuar vazia, corre na linha de comandos (na pasta do{' '}
            <code>ffmpeg.exe</code> do app, ou onde tiveres o ffmpeg){' '}
            <code>ffmpeg -list_devices true -f dshow -i dummy</code> — se aí aparecerem dispositivos,
            envia o resultado ao suporte; se também vier vazio, o problema é do sistema/drivers, não do
            painel.
          </p>
          {typeof data.dshowListDiag?.ffmpegHasDshowInDevices === 'boolean' ? (
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#c9d1d9' }}>
              <strong>ffmpeg -devices:</strong> indev DirectShow <code>dshow</code>{' '}
              {data.dshowListDiag.ffmpegHasDshowInDevices ? (
                <span style={{ color: '#81c995' }}>presente neste binário</span>
              ) : (
                <span style={{ color: '#f0883e' }}>
                  não encontrado — este ffmpeg não foi compilado com captura DirectShow
                </span>
              )}
              {data.dshowListDiag.ffmpegDevicesExitCode != null
                ? ` (exit ${data.dshowListDiag.ffmpegDevicesExitCode})`
                : ''}
            </p>
          ) : null}
          {data.dshowListDiag && data.dshowListDiag.outputTail ? (
            <details style={{ marginTop: 12, color: '#9aa0a6', fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: '#79c0ff' }}>
                Diagnóstico técnico (últimas linhas da saída do ffmpeg, exit {String(data.dshowListDiag.exitCode)})
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  overflow: 'auto',
                  maxHeight: 220,
                  background: '#0d1117',
                  padding: 10,
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {data.dshowListDiag.outputTail}
              </pre>
            </details>
          ) : null}
          {data.dshowListDiag?.ffmpegDevicesTail ? (
            <details style={{ marginTop: 10, color: '#9aa0a6', fontSize: 12 }}>
              <summary style={{ cursor: 'pointer', color: '#79c0ff' }}>
                Saída de <code>ffmpeg -devices</code> (cauda)
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  overflow: 'auto',
                  maxHeight: 220,
                  background: '#0d1117',
                  padding: 10,
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {data.dshowListDiag.ffmpegDevicesTail}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {data.platform === 'win32' && data.captureSource !== 'env' && canEdit ? (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 12,
            border: '1px solid #334861',
            background: '#0f1722',
            maxWidth: 920,
          }}
        >
          <h3 style={{ fontSize: 15, marginTop: 0, marginBottom: 10, color: '#58a6ff' }}>
            Modo Windows (DirectShow)
          </h3>
          <p style={{ color: '#9aa0a6', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
            <strong>Um dispositivo:</strong> igual ao comportamento clássico (uma entrada, N canais).
            <strong> Várias entradas:</strong> funde vários micros DirectShow num único fluxo PCM (ex. Ui24R em
            vários pares). A <strong>ordem</strong> na lista abaixo define os índices 0…N-1 para{' '}
            <code>captureInputIndex</code> na mesa.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 12 }}>
            <label style={{ color: '#e8eaed', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="winCapMode"
                checked={winCapMode === 'single'}
                onChange={() => setWinCapMode('single')}
              />
              Um dispositivo
            </label>
            <label style={{ color: '#e8eaed', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="radio"
                name="winCapMode"
                checked={winCapMode === 'aggregate'}
                onChange={() => setWinCapMode('aggregate')}
              />
              Várias entradas (agregado)
            </label>
          </div>
          {winCapMode === 'aggregate' ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ color: '#c9d1d9', fontSize: 13, marginBottom: 8 }}>
                Marque as linhas na tabela <strong>Entradas encontradas</strong> (coluna Agregado). Depois ajuste a
                ordem e clique <strong>Aplicar agregado</strong> (mínimo 2 entradas).
              </p>
              {aggOrder.length > 0 ? (
                <ol style={{ color: '#e8eaed', fontSize: 13, paddingLeft: 20, marginBottom: 10 }}>
                  {aggOrder.map((nm, i) => (
                    <li key={`${nm}-${i}`} style={{ marginBottom: 6 }}>
                      <code style={{ color: '#79c0ff' }}>{nm}</code>
                      <span style={{ marginLeft: 8 }}>
                        <button
                          type="button"
                          style={compactBtnStyle}
                          disabled={busy || i === 0}
                          onClick={() =>
                            setAggOrder((prev) => {
                              const next = [...prev]
                              const t = next[i - 1]
                              next[i - 1] = next[i]
                              next[i] = t
                              return next
                            })
                          }
                        >
                          Subir
                        </button>
                        <button
                          type="button"
                          style={{ ...compactBtnStyle, marginLeft: 6 }}
                          disabled={busy || i >= aggOrder.length - 1}
                          onClick={() =>
                            setAggOrder((prev) => {
                              const next = [...prev]
                              const t = next[i]
                              next[i] = next[i + 1]
                              next[i + 1] = t
                              return next
                            })
                          }
                        >
                          Descer
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p style={{ color: '#6e7681', fontSize: 13 }}>Nenhuma entrada seleccionada ainda.</p>
              )}
              <button
                type="button"
                style={{ ...compactBtnStyle, background: '#1f6feb', borderColor: '#388bfd' }}
                disabled={busy || aggOrder.length < 2}
                onClick={() => void applyWinAggregate()}
              >
                Aplicar agregado
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {data.devices.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>
            Entradas encontradas
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
              maxHeight: 240,
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
                    Interface
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #394457' }}>
                    Entrada
                  </th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #394457' }}>
                    Canais
                  </th>
                  {data.platform === 'win32' ? (
                    <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #394457' }}>
                      Agregado
                    </th>
                  ) : null}
                  <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #394457' }}>
                    Observação
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.devices.map((d) => {
                  const n = typeof d.inputChannels === 'number' ? d.inputChannels : null
                  const err = d.probeError || null
                  const { entrada, interfaceDriver } = splitAudioDeviceEndpointName(d.name)
                  const note =
                    n != null
                      ? 'Canais confirmados.'
                      : err
                        ? err
                        : 'Ainda não foi medido. Use "Provar todos" se quiser conferir.'
                  const aggColSpan = data.platform === 'win32' ? 6 : 5
                  const inAgg = aggOrder.includes(d.name)
                  return (
                    <Fragment key={d.index}>
                      <tr style={{ borderBottom: '1px solid #30363d' }}>
                        <td style={{ padding: '8px 12px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                          <code>[{d.index}]</code>
                        </td>
                        <td style={{ padding: '8px 12px', verticalAlign: 'top', color: '#9aa0a6' }}>
                          {interfaceDriver ?? '—'}
                        </td>
                        <td style={{ padding: '8px 12px', verticalAlign: 'top' }} title={d.name}>
                          {entrada}
                        </td>
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
                        {data.platform === 'win32' ? (
                          <td style={{ padding: '8px 12px', verticalAlign: 'top' }}>
                            <input
                              type="checkbox"
                              checked={inAgg}
                              disabled={winCapMode !== 'aggregate'}
                              title={
                                winCapMode === 'aggregate'
                                  ? 'Incluir no agregado (ordem = ordem da lista acima)'
                                  : 'Escolhe "Várias entradas (agregado)" para marcar'
                              }
                              onChange={(e) => {
                                const on = e.target.checked
                                setAggOrder((prev) => {
                                  if (on) {
                                    if (prev.includes(d.name)) return prev
                                    return [...prev, d.name]
                                  }
                                  return prev.filter((x) => x !== d.name)
                                })
                              }}
                            />
                          </td>
                        ) : null}
                        <td
                          style={{
                            padding: '8px 12px',
                            verticalAlign: 'top',
                            color: n != null ? '#9aa0a6' : err ? '#f0883e' : '#6e7681',
                            lineHeight: 1.45,
                            maxWidth: 320,
                          }}
                        >
                          {note}
                        </td>
                      </tr>
                      {d.dshowOptionsTail ? (
                        <tr style={{ borderBottom: '1px solid #30363d' }}>
                          <td colSpan={aggColSpan} style={{ padding: '0 12px 10px 48px', background: '#0d1117' }}>
                            <details>
                              <summary style={{ cursor: 'pointer', color: '#79c0ff', fontSize: 12 }}>
                                DirectShow: opções / pins (últimas linhas)
                              </summary>
                              <pre
                                style={{
                                  marginTop: 8,
                                  overflow: 'auto',
                                  maxHeight: 180,
                                  background: '#161b22',
                                  padding: 10,
                                  borderRadius: 6,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  fontSize: 11,
                                  color: '#c9d1d9',
                                }}
                              >
                                {d.dshowOptionsTail}
                              </pre>
                            </details>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#9aa0a6', maxWidth: 820 }}>
            "Provar todos" confirma os canais de cada entrada. No Windows, "Provar + pins" demora mais.
          </p>
        </div>
      ) : null}
      {canEdit &&
      (data.platform === 'darwin' || data.platform === 'win32') &&
      data.captureSource !== 'env' ? (
        <div
          style={{
            marginTop: 12,
            display: 'grid',
            gap: 10,
            maxWidth: 920,
            padding: 14,
            borderRadius: 12,
            border: '1px solid #334861',
            background: '#0f1722',
          }}
        >
          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ color: '#dbe6f3', fontWeight: 700 }}>Entrada que será usada</span>
            <select
              value={selectVal}
              disabled={data.platform === 'win32' && winCapMode === 'aggregate'}
              title={
                data.platform === 'win32' && winCapMode === 'aggregate'
                  ? 'Em modo agregado usa "Aplicar agregado" acima; escolhe "Um dispositivo" para voltar aqui.'
                  : undefined
              }
              onChange={(e) => setSelectVal(e.target.value)}
              style={{
                minWidth: 220,
                padding: '9px 10px',
                background: '#252a33',
                color: '#e8eaed',
                border: '1px solid #555',
                borderRadius: 6,
                width: '100%',
                maxWidth: 520,
                opacity: data.platform === 'win32' && winCapMode === 'aggregate' ? 0.55 : 1,
              }}
            >
              <option value={SEL_AUTO}>— escolher automaticamente —</option>
              <option value={SEL_OFF}>— desligado / teste —</option>
              {data.devices.map((d) => (
                <option key={d.index} value={String(d.index)}>
                  [{d.index}] {d.name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" style={compactBtnStyle} disabled={busy} onClick={() => void applySelection('save')}>
              Aplicar
            </button>
            <button type="button" style={compactBtnStyle} disabled={busy} onClick={() => void applySelection('clear')}>
              Só desligar
            </button>
            <button type="button" style={compactBtnStyle} disabled={busy} onClick={() => void load(true)}>
              Atualizar lista
            </button>
            <button
              type="button"
              style={compactBtnStyle}
              disabled={busy || permBusy}
              title="Mostra o pedido do macOS ou do Windows para microfone / captura de áudio"
              onClick={() => void requestOsMicPermission()}
            >
              Liberar acesso
            </button>
            <button
              type="button"
              style={compactBtnStyle}
              disabled={busy}
              title="Corre ffprobe em cada dispositivo (pode demorar)"
              onClick={() => void load(true, true)}
            >
              Provar todos
            </button>
            {data.platform === 'win32' ? (
              <button
                type="button"
                style={compactBtnStyle}
                disabled={busy}
                title="ffprobe + list_options DirectShow por dispositivo — muito lento"
                onClick={() => void load(true, true, true)}
              >
                Provar + pins
              </button>
            ) : null}
          </div>
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
            marginTop: 20,
            borderTop: '1px solid #394457',
            paddingTop: 16,
          }}
        >
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Canais da entrada</h3>
          <p style={{ color: '#9aa0a6', maxWidth: 760, marginBottom: 12, lineHeight: 1.45 }}>
            Aqui você define quantos canais quer usar e prepara os canais que vão aparecer no separador Canais.
          </p>
          {canEdit ? (
            <label style={{ color: '#e8eaed', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={channelCountAuto}
                onChange={(e) => setChannelCountAuto(e.target.checked)}
              />
              Ajustar sozinho a quantidade de canais ao reiniciar
            </label>
          ) : null}
          {canEdit ? (
            <label style={{ color: '#e8eaed', display: 'block', marginBottom: 16 }}>
              Quantidade de canais a usar, 1–{MVP_MAX_CAPTURE_CHANNELS}
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
              Canais em uso: {data.captureChannelCount}
            </p>
          )}
          <details
            style={{
              marginBottom: 14,
              border: '1px solid #394457',
              borderRadius: 8,
              background: '#0f1722',
              overflow: 'hidden',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                padding: 12,
                color: '#dbe6f3',
                fontWeight: 700,
                listStyle: 'none',
              }}
            >
              Ajustar volumes de cada canal
            </summary>
            <div
              style={{
                padding: '0 12px 12px',
                maxHeight: 280,
                overflowY: 'auto',
              }}
            >
              <div style={{ color: '#9aa0a6', fontSize: 12, marginBottom: 10, lineHeight: 1.45 }}>
                Abra este bloco só quando quiser mexer no volume bruto de cada canal.
              </div>
              {Array.from({ length: captureChCount }, (_, i) => (
                <label
                  key={i}
                  style={{ color: '#e8eaed', display: 'block', marginBottom: 10 }}
                >
                  Canal {i + 1}
                  {captureChCount === 2 && (i === 0 || i === 1) ? (
                    <span style={{ color: '#6e7681', fontSize: 11 }}>
                      {' '}
                      ({i === 0 ? 'esquerdo' : 'direito'})
                    </span>
                  ) : null}
                  <input
                    className="inearRange"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={!canEdit}
                    value={gainByIndex[String(i)] ?? 1}
                    onChange={(e) =>
                      setGainByIndex((prev) => ({
                        ...prev,
                        [String(i)]: Number(e.target.value),
                      }))
                    }
                    style={{
                      ...sliderFillStyle(gainByIndex[String(i)] ?? 1, 0, 1),
                      display: 'block',
                      width: '100%',
                      maxWidth: 420,
                      marginTop: 6,
                    }}
                  />
                  <div className="faderMarks">
                    <span>-80</span>
                    <span>-24</span>
                    <span>-12</span>
                    <span>-6</span>
                    <span>0 dB</span>
                  </div>
                  <span style={{ fontSize: 12, color: '#9aa0a6' }}>
                    {linearToDb(gainByIndex[String(i)] ?? 1)} dB
                  </span>
                </label>
              ))}
            </div>
          </details>
          {canEdit ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <button type="button" disabled={busy} onClick={() => void applyCaptureGains()}>
                Aplicar ajustes
              </button>
              <button type="button" disabled={busy} onClick={() => void syncInterfaceChannels()}>
                Sincronizar canais
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

function DeskVolumeStrip({
  gain,
  vuLevel = 0,
  meterTitle = 'Volume',
  onCommit,
  rangeMin = 0,
  rangeMax = 4,
}: {
  gain: number
  vuLevel?: number
  meterTitle?: string
  onCommit: (value: number) => Promise<void>
  rangeMin?: number
  rangeMax?: number
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [faderLenPx, setFaderLenPx] = useState(163)
  const [local, setLocal] = useState(() => clampLin(gain, rangeMin, rangeMax))
  const dragRef = useRef(false)
  const commitRef = useRef(false)
  const detachWindowPointerRef = useRef<(() => void) | null>(null)

  const attachWindowPointerEnd = () => {
    detachWindowPointerRef.current?.()
    const fin = () => {
      dragRef.current = false
      window.removeEventListener('pointerup', fin)
      window.removeEventListener('pointercancel', fin)
      detachWindowPointerRef.current = null
    }
    window.addEventListener('pointerup', fin)
    window.addEventListener('pointercancel', fin)
    detachWindowPointerRef.current = () => {
      window.removeEventListener('pointerup', fin)
      window.removeEventListener('pointercancel', fin)
    }
  }

  useEffect(() => {
    return () => {
      detachWindowPointerRef.current?.()
      detachWindowPointerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (dragRef.current || commitRef.current) return
    setLocal(clampLin(gain, rangeMin, rangeMax))
  }, [gain, rangeMin, rangeMax])

  useLayoutEffect(() => {
    const el = rowRef.current
    if (!el) return

    const measure = () => {
      const h = el.getBoundingClientRect().height
      const cs = window.getComputedStyle(el)
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
      const usable = Math.max(0, h - padY)
      const next = Math.round(Math.max(125, Math.min(546, usable)))
      setFaderLenPx(next)
    }

    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <div className="volCard" style={{ ['--faderLen' as string]: `${faderLenPx}px` } as CSSProperties}>
      <div className="volCard__title">{meterTitle}</div>
      <div className="volCard__db">
        <span>{linearToDb(Number(local))} dB</span>
      </div>
      <div ref={rowRef} className="volCard__row">
        <div className="volCard__vuCol">
          <div className="volCard__vuFrame">
            <div className="volCard__vuLabel">VU</div>
            <div className="volCard__vuMeterRow">
              <div className="volCard__vuMeter" style={vuFillFromLevel(vuLevel)} />
              <div className="volCard__marks">
                {gainFaderMarks(rangeMax).map((mark) => (
                  <span key={mark}>{mark}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="volCard__fader">
          <input
            className="inearVRange"
            type="range"
            min={rangeMin}
            max={rangeMax}
            step={0.01}
            value={local}
            style={{
              ...sliderFillStyle(local, rangeMin, rangeMax),
              width: faderLenPx,
              position: 'absolute',
              left: '50%',
              top: '50%',
              margin: 0,
              transform: 'translate(-50%, -50%) rotate(-90deg)',
            }}
            onPointerDown={() => {
              dragRef.current = true
              attachWindowPointerEnd()
            }}
            onChange={async (e) => {
              const v = clampLin(Number(e.target.value), rangeMin, rangeMax)
              setLocal(v)
              commitRef.current = true
              try {
                await onCommit(v)
              } finally {
                commitRef.current = false
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

function ChannelVolumeStrip({
  token,
  channelId,
  gain,
  vuLevel,
  onChannelStripPatched,
}: {
  token: string
  channelId: string
  gain: number
  vuLevel?: number
  onChannelStripPatched?: (ch: ChannelStrip) => void
}) {
  return (
    <DeskVolumeStrip
      gain={gain}
      vuLevel={vuLevel}
      meterTitle="Volume"
      onCommit={async (v) => {
        const ch = await api<ChannelStrip>(`/api/showfile/channel/${channelId}`, {
          method: 'PATCH',
          token,
          body: JSON.stringify({ gain: v }),
        })
        onChannelStripPatched?.(ch)
      }}
    />
  )
}

function ChannelTable({
  token,
  showfile,
  audioInputLevels,
  onSaved,
  onChannelStripPatched,
}: {
  token: string
  showfile: Showfile
  audioInputLevels: AudioInputLevelsResponse | null
  onSaved: () => void
  onChannelStripPatched?: (ch: ChannelStrip) => void
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
        <h2 style={{ marginTop: 0 }}>Mesa vazia</h2>
        <p style={{ color: '#e8eaed', lineHeight: 1.5 }}>
          Ainda não há canais preparados neste show. Ligue a entrada de áudio e use{' '}
          <strong>Sincronizar canais da interface</strong> em <strong>Início</strong> ou em{' '}
          <strong>Entrada de áudio</strong>. Depois os controles da mesa aparecem aqui.
        </p>
        <button type="button" onClick={() => onSaved()}>
          Recarregar
        </button>
      </section>
    )
  }
  return (
    <div style={{ minWidth: 0, maxWidth: '100%', width: '100%', display: 'grid', gap: 14 }}>
      <section
        style={{
          border: '1px solid rgba(67,94,123,.7)',
          borderRadius: 18,
          padding: 16,
          background:
            'radial-gradient(circle at top right, rgba(88,166,255,.08), transparent 22%), linear-gradient(180deg,#141d2a 0%,#0d1621 100%)',
          boxShadow: '0 16px 34px rgba(0,0,0,.24), inset 0 1px 0 rgba(255,255,255,.03)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>Mesa do show</h2>
            <p style={{ margin: '8px 0 0', color: '#9aa0a6', maxWidth: 720 }}>
              Edite nome, ícone, cor, volume, posição e equalização de cada canal em um só lugar.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="deskInfoPill">
              <span className="deskInfoPill__label">Canais</span>
              <strong>{showfile.channels.length}</strong>
            </div>
            <div className="deskInfoPill">
              <span className="deskInfoPill__label">Entrada</span>
              <strong>Organizada por canal</strong>
            </div>
          </div>
        </div>
      </section>
      <div className="chBoardShell">
      <div className="chBoard">
      {showfile.channels.map((ch) => {
        const accent = channelAccentColor(ch)
        const srcLabel =
          typeof ch.captureInputIndex === 'number'
            ? `Entrada ${ch.captureInputIndex + 1}`
            : ch.sourceTap === 'L'
              ? 'Esquerdo'
              : ch.sourceTap === 'R'
                ? 'Direito'
                : ch.sourceTap === 'sum'
                  ? 'Mix geral'
                  : (ch.sourceTap ?? '—')
        return (
          <div
            key={ch.id}
            className="chCard"
            style={
              {
              border: `1px solid ${accent}`,
                ['--ch-accent' as string]: accent,
              } as CSSProperties
            }
          >
            <div className="chCard__sourcePill">{srcLabel}</div>
            <div className="chCard__hdr">
              <div className={`chCard__badge${ch.mute ? ' chCard__badge--muted' : ''}`} style={{ background: accent }}>
                {channelIconGlyph(ch.icon)}
              </div>
              <div className="chCard__titles">
                <strong>{ch.name}</strong>
                <small>
                  {ch.id}
                  <span style={{ color: '#6e7681' }}> · </span>
                  {srcLabel}
                </small>
              </div>
            </div>

            <div className="deskFieldLabel">Nome do canal</div>
              <input
              className="deskField"
                value={nameFor(ch.id, ch.name)}
                onChange={(e) =>
                  setNameDrafts((prev) => ({
                    ...prev,
                    [ch.id]: e.target.value,
                  }))
                }
              placeholder="Nome do canal"
            />

            <div className="deskFieldLabel">Ícone e cor</div>
            <div className="deskMiniRow">
                <select
                className="deskSelect"
                style={{ flex: 1, minWidth: 0 }}
                  value={iconFor(ch.id, ch.icon)}
                  onChange={(e) =>
                    setIconDrafts((prev) => ({
                      ...prev,
                      [ch.id]: e.target.value,
                    }))
                  }
                >
                  <option value="">Ícone padrão</option>
                  {CHANNEL_ICON_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.badge} - {opt.label}
                    </option>
                  ))}
                </select>
                <input
                className="deskColor"
                  type="color"
                  value={colorFor(ch.id, ch.color, ch.captureInputIndex)}
                  onChange={(e) =>
                    setColorDrafts((prev) => ({
                      ...prev,
                      [ch.id]: e.target.value,
                    }))
                  }
                aria-label="Cor do canal"
                title="Cor do canal"
                />
              </div>

            <div className="deskMiniRow" style={{ justifyContent: 'space-between' }}>
                <button
                  type="button"
                className="deskBtn"
                title="Salvar nome, ícone e cor"
                  onClick={async () => {
                    await saveChannelVisuals(
                      ch.id,
                      nameFor(ch.id, ch.name),
                      iconFor(ch.id, ch.icon),
                      colorFor(ch.id, ch.color, ch.captureInputIndex),
                    )
                  }}
                >
                Salvar
                </button>

              <label className={`deskMute${ch.mute ? ' deskMute--on' : ''}`}>
                <span className="deskMute__led" aria-hidden="true" />
                <span className="deskMute__toggle" aria-hidden="true">
                  {ch.mute ? '🔇' : '🔊'}
                  <span className="deskMute__toggleDot" />
                </span>
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
                />
                MUTE
                </label>
            </div>

            <label className={`deskLatch${ch.lockEq ? ' deskLatch--on' : ''}`}>
              <span className="deskLatch__led" aria-hidden="true" />
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
              />
              Travar EQ
            </label>

            <div className="panInline" style={{ margin: '0 0 5px', maxWidth: '100%', width: '100%' }}>
              <div className="panInline__head">
                <span>Posição</span>
                <span>{ch.pan.toFixed(2)}</span>
              </div>
                    <input
                className="inearRange"
                      type="range"
                min={-1}
                max={1}
                step={0.01}
                value={ch.pan}
                style={{ ...sliderFillStyle(ch.pan, -1, 1), width: '100%' }}
                      onChange={async (e) => {
                        await api(`/api/showfile/channel/${ch.id}`, {
                          method: 'PATCH',
                          token,
                          body: JSON.stringify({
                      pan: Number(e.target.value),
                          }),
                        })
                        onSaved()
                      }}
                    />
              <div className="panInline__scale">
                <span>(L)</span>
                <span>|</span>
                <span>(R)</span>
                  </div>
            </div>

            <div className="chCard__mixRow">
              <ChannelVolumeStrip
                token={token}
                channelId={ch.id}
                gain={ch.gain}
                vuLevel={channelVuLevel(ch, audioInputLevels?.levelsByIndex ?? {})}
                onChannelStripPatched={onChannelStripPatched}
              />
              <div className="eqKnobCol">
                {(['highDb', 'midDb', 'lowDb'] as const).map((k) => (
                  <div key={k} className="eqKnob">
                    <div className="eqKnob__label">{eqBandLabel(k)}</div>
                    <div className="eqKnob__dial" style={eqKnobStyle(ch.eq[k], -12, 12)}>
                    <input
                        className="eqKnob__input"
                      type="range"
                      min={-12}
                      max={12}
                      step={0.5}
                      value={ch.eq[k]}
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
                    <div className="eqKnob__value">{ch.eq[k].toFixed(1)} dB</div>
                  </div>
              ))}
            </div>
            </div>
          </div>
        )
      })}
      </div>
    </div>
    </div>
  )
}

function MusicianTable({
  showfile,
  token,
  audioInputLevels,
  onSaved,
  onMusicianStripPatched,
}: {
  showfile: Showfile
  token: string
  audioInputLevels: AudioInputLevelsResponse | null
  onSaved: () => void
  onMusicianStripPatched?: (m: MusicianStrip) => void
}) {
  const ui = {
    card: {
      border: '1px solid #30445d',
      borderRadius: 18,
      padding: 16,
      background: 'linear-gradient(180deg,#172436 0%,#101a26 100%)',
      boxShadow: '0 10px 24px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.03)',
    },
    input: {
      width: '100%',
      padding: '9px 10px',
      background: '#1a2433',
      color: '#e8eaed',
      border: '1px solid #405067',
      borderRadius: 10,
      outline: 'none',
    },
    btn: {
      borderRadius: 999,
      border: '1px solid #4f78a9',
      background: 'linear-gradient(180deg,#2a4464 0%,#1e334b 100%)',
      color: '#f0f6fc',
      padding: '8px 14px',
      fontWeight: 800,
      letterSpacing: '.01em',
    },
    btnGhost: {
      borderRadius: 999,
      border: '1px solid #3f4f66',
      background: '#1b2431',
      color: '#c9d1d9',
      padding: '7px 12px',
      fontWeight: 700,
    },
  } as const

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
      <section style={ui.card}>
        <h2 style={{ marginTop: 0 }}>Cadastrar músico</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.2fr 1fr 1fr auto',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <label style={{ display: 'grid', gap: 6, color: '#c9d1d9' }}>
            <span>Nome</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              style={ui.input}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#c9d1d9' }}>
            <span>Usuário</span>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              style={ui.input}
            />
          </label>
          <label style={{ display: 'grid', gap: 6, color: '#c9d1d9' }}>
            <span>Senha</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={ui.input}
            />
          </label>
          <button
            type="button"
            style={ui.btn}
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
          gridTemplateColumns: 'minmax(300px, 380px) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        <section
          style={{
            ...ui.card,
            display: 'flex',
            flexDirection: 'column',
            alignSelf: 'start',
            maxWidth: '100%',
          }}
        >
          <h2 style={{ marginTop: 0, flexShrink: 0 }}>Perfis de músicos</h2>
          <div className="musicianProfilesScroll">
            {showfile.musicians.map((m) => (
              <div
                key={m.id}
                className="musicianProfileCard"
                style={{
                  border: selectedMusician?.id === m.id ? '1px solid #6cb6ff' : '1px solid #33455d',
                  borderRadius: 12,
                  padding: '12px 12px 14px',
                  background: selectedMusician?.id === m.id ? '#13263e' : '#121b28',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <strong>{m.name}</strong>
                    <div style={{ color: '#9aa0a6', fontSize: 13 }}>{m.username}</div>
                  </div>
                  <button
                    type="button"
                    style={selectedMusician?.id === m.id ? ui.btn : ui.btnGhost}
                    onClick={() => setSelectedMusicianId(m.id)}
                  >
                    Abrir mix
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>
                  <input
                    value={editName[m.id] ?? m.name}
                    onChange={(e) =>
                      setEditName((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder="Nome"
                    style={ui.input}
                  />
                  <input
                    value={editUsername[m.id] ?? m.username}
                    onChange={(e) =>
                      setEditUsername((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder="Usuário"
                    style={ui.input}
                  />
                  <input
                    type="password"
                    value={editPassword[m.id] ?? ''}
                    onChange={(e) =>
                      setEditPassword((prev) => ({ ...prev, [m.id]: e.target.value }))
                    }
                    placeholder="Nova senha (opcional)"
                    style={ui.input}
                  />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      style={ui.btn}
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
                    <label style={{ color: '#c9d1d9' }}>
                      <input
                        type="checkbox"
                        checked={m.mute}
                        onChange={async (e) => {
                          const next = await api<MusicianStrip>(
                            `/api/showfile/musician/${m.id}`,
                            {
                              method: 'PATCH',
                              token,
                              body: JSON.stringify({ mute: e.target.checked }),
                            },
                          )
                          onMusicianStripPatched?.(next)
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

        <section style={{ ...ui.card, minWidth: 0, maxWidth: '100%', alignSelf: 'start' }}>
          {selectedMusician ? (
            <MusicianControls
              token={token}
              showfile={showfile}
              musician={selectedMusician}
              audioInputLevels={audioInputLevels}
              onMusicianStripPatched={onMusicianStripPatched}
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
  audioInputLevels,
  onMusicianStripPatched,
}: {
  token: string
  showfile: Showfile
  musician: Showfile['musicians'][0]
  audioInputLevels: AudioInputLevelsResponse | null
  onMusicianStripPatched?: (m: MusicianStrip) => void
}) {
  const ids = useMemo(
    () => retornoMixerChannelOrder(showfile, musician),
    [musician, showfile],
  )
  const groupIds = musician.scope.groupIds
  const levelsByIndex = audioInputLevels?.levelsByIndex ?? {}

  return (
    <div style={{ minWidth: 0, maxWidth: '100%' }}>
      <h2 style={{ marginTop: 0 }}>Olá, {musician.name}</h2>
      {ids.length === 0 && groupIds.length === 0 && (
        <p style={{ color: '#fbbc04' }}>
          Ainda não há canais no showfile (0). Depois da sincronização no Mac,
          recarrega esta página.
        </p>
      )}
      <div className="chBoardShell" style={{ marginTop: 12 }}>
      <div className="chBoard musicianDeskBoard">
        {groupIds.map((gid) => {
          const g = showfile.groups.find((x) => x.id === gid)
          if (!g) return null
          const gv = musician.sendGains[gid] ?? 1
          const muted = musician.sendMutes?.[gid] === true
          const accent = '#a371f7'
          const badgeLetter = (g.name.trim().charAt(0) || 'G').toUpperCase()
          return (
            <div
              key={gid}
              className="chCard"
              style={
                {
                  border: `1px solid ${accent}`,
                  ['--ch-accent' as string]: accent,
                } as CSSProperties
              }
            >
              <div className="chCard__hdr">
                <div className={`chCard__badge${muted ? ' chCard__badge--muted' : ''}`} style={{ background: accent, fontSize: 12 }}>
                  {badgeLetter}
                </div>
                <div className="chCard__titles">
                  <strong>Grupo</strong>
                  <small>
                    {g.name}
                    <span style={{ color: '#6e7681' }}> · </span>
                    {gid}
                  </small>
                </div>
              </div>
              <div className="chCard__mixRow chCard__mixRow--soloVol">
                <DeskVolumeStrip
                  key={`${musician.id}-g-${gid}`}
                  gain={gv}
                  vuLevel={groupVuLevel(showfile, gid, levelsByIndex)}
                  meterTitle="Send"
                  onCommit={async (v) => {
                    const next = await api<MusicianStrip>(
                      `/api/showfile/musician/${musician.id}`,
                      {
                        method: 'PATCH',
                        token,
                        body: JSON.stringify({ sendGains: { [gid]: v } }),
                      },
                    )
                    onMusicianStripPatched?.(next)
                  }}
                />
              </div>
            </div>
          )
        })}
        {ids.map((cid) => {
          const ch = showfile.channels.find((c) => c.id === cid)
          if (!ch) return null
          const muted = musician.sendMutes?.[cid] === true
          const accent = channelAccentColor(ch)
          const earEq = musician.eqByChannel?.[cid]
          const eqBase = {
            lowDb: earEq?.lowDb ?? ch.eq.lowDb,
            midDb: earEq?.midDb ?? ch.eq.midDb,
            highDb: earEq?.highDb ?? ch.eq.highDb,
          }
          return (
            <div
              key={cid}
              className="chCard"
              style={
                {
                  border: `1px solid ${accent}`,
                  ['--ch-accent' as string]: accent,
                } as CSSProperties
              }
            >
              <div className="chCard__hdr">
                <div className={`chCard__badge${muted ? ' chCard__badge--muted' : ''}`} style={{ background: accent }}>
                  {channelIconGlyph(ch.icon)}
                </div>
                <div className="chCard__titles">
                  <strong>{ch.name}</strong>
                  <small>
                    {cid}
                    <span style={{ color: '#6e7681' }}> · </span>
                    send
                    {ch.lockEq ? (
                      <span style={{ color: '#fbbc04' }}> · EQ bloqueado</span>
                    ) : null}
                  </small>
                </div>
              </div>
              <div className="chCard__mixRow">
                <DeskVolumeStrip
                  key={`${musician.id}-s-${cid}`}
                  gain={musician.sendGains[cid] ?? 1}
                  vuLevel={channelVuLevel(ch, levelsByIndex)}
                  meterTitle="Send"
                  onCommit={async (v) => {
                    const next = await api<MusicianStrip>(
                      `/api/showfile/musician/${musician.id}`,
                      {
                        method: 'PATCH',
                        token,
                        body: JSON.stringify({ sendGains: { [cid]: v } }),
                      },
                    )
                    onMusicianStripPatched?.(next)
                  }}
                />
                {ch.lockEq ? (
                  <div
                    className="eqKnobCol"
                    style={{
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0.85,
                      minHeight: 80,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: '#8b949e',
                        textAlign: 'center',
                        lineHeight: 1.35,
                        padding: '4px 2px',
                      }}
                    >
                      EQ definido
                      <br />
                      pelo técnico
                    </span>
                  </div>
                ) : (
                  <div className="eqKnobCol">
                    {(['highDb', 'midDb', 'lowDb'] as const).map((k) => (
                      <div key={k} className="eqKnob">
                        <div className="eqKnob__label">{eqBandLabel(k)}</div>
                        <div className="eqKnob__dial" style={eqKnobStyle(eqBase[k], -12, 12)}>
                          <input
                            className="eqKnob__input"
                            type="range"
                            min={-12}
                            max={12}
                            step={0.5}
                            value={eqBase[k]}
                            onChange={async (e) => {
                              const next = await api<MusicianStrip>(
                                `/api/showfile/musician/${musician.id}`,
                                {
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
                                },
                              )
                              onMusicianStripPatched?.(next)
                            }}
                          />
                        </div>
                        <div className="eqKnob__value">{eqBase[k].toFixed(1)} dB</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      </div>
    </div>
  )
}
