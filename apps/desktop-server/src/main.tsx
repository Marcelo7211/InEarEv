import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[inear] Erro no painel React:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || String(this.state.error)
      return (
        <main
          style={{
            padding: 24,
            maxWidth: 640,
            margin: '0 auto',
            fontFamily: 'system-ui,sans-serif',
            color: '#e8eaed',
            background: '#0f1115',
            minHeight: '100vh',
          }}
        >
          <h1 style={{ color: '#f85149', marginTop: 0 }}>O painel não conseguiu renderizar</h1>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              background: '#161b22',
              padding: 12,
              borderRadius: 8,
              border: '1px solid #30363d',
              fontSize: 13,
            }}
          >
            {msg}
          </pre>
          <p style={{ color: '#9aa0a6', fontSize: 14 }}>
            Se atualizar não resolver, limpa o armazenamento local desta origem (token antigo) e
            volta a entrar.
          </p>
          <button
            type="button"
            style={{
              marginTop: 12,
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #335f8a',
              background: '#1d2634',
              color: '#e8eaed',
              cursor: 'pointer',
            }}
            onClick={() => {
              try {
                localStorage.removeItem('inear_token')
                localStorage.removeItem('inear_role')
              } catch {
                /* */
              }
              window.location.reload()
            }}
          >
            Limpar sessão e recarregar
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
)
