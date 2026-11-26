import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pluginServiceWorker } from './web/pwa/plugin-sw'

// Puertos: la web en 4317 (desarrollo) y el servidor (API, eventos, MCP) en 4318.
const puertoServidor = Number(process.env.TABLERO_PUERTO) || 4318
const puertoWeb = Number(process.env.TABLERO_PUERTO_WEB) || 4317
const servidor = `http://127.0.0.1:${puertoServidor}`

export default defineConfig({
  root: 'web',
  plugins: [react(), pluginServiceWorker()],
  server: {
    host: '127.0.0.1',
    port: puertoWeb,
    strictPort: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: servidor, changeOrigin: false },
      '/mcp': { target: servidor, changeOrigin: false },
      '/archivos': { target: servidor, changeOrigin: false },
      '/oauth': { target: servidor, changeOrigin: false },
      '/.well-known': { target: servidor, changeOrigin: false },
    },
  },
  preview: { port: puertoWeb },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
})
