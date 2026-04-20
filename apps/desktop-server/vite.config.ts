import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const desktopRoot = path.dirname(fileURLToPath(import.meta.url))
const protocolSrc = path.resolve(desktopRoot, '../../packages/protocol/src/index.ts')

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  resolve: {
    // O dist CJS do protocolo usa __exportStar; o Rollup não expõe nomes a partir daí.
    // O bundle inclui o protocolo a partir do TypeScript fonte (export * ESM real).
    alias: [{ find: '@inear/protocol', replacement: protocolSrc }],
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // O Express da API corre no Electron em :3847; sem isto, POST /api/* ao Vite dá "Cannot POST".
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3847',
        changeOrigin: true,
        ws: true,
        // Provar todos (ffprobe) pode demorar; o default do proxy corta o pedido cedo.
        timeout: 1_800_000,
        proxyTimeout: 1_800_000,
      },
    },
  },
})
