/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    inearDesktop?: {
      isElectron: boolean
      apiBase?: () => string
    }
  }
}

export {}
