function readApiFromQuery(): string | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search).get('api')
  if (!q) return null
  const t = q.trim().replace(/\/$/, '')
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return null
}

export function getApiBase(): string {
  const fromQuery = readApiFromQuery()
  if (fromQuery) return fromQuery
  if (
    typeof window !== 'undefined' &&
    typeof window.inearDesktop?.apiBase === 'function'
  ) {
    return window.inearDesktop.apiBase()
  }
  // Browser em dev (só Vite): pedidos relativos → proxy em vite.config.ts → :3847
  if (
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    (window.location.protocol === 'http:' ||
      window.location.protocol === 'https:')
  ) {
    return ''
  }
  return import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:3847'
}

export async function api<T>(
  path: string,
  opts: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...rest } = opts
  const h = new Headers(headers)
  h.set('Content-Type', 'application/json')
  if (token) h.set('Authorization', `Bearer ${token}`)
  const res = await fetch(`${getApiBase()}${path}`, { ...rest, headers: h })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
