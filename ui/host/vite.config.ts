/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In development the app opens from Vite (http://127.0.0.1:5173, HMR) and the API calls are
// forwarded to the Mosaikit server on :47080. In xtask/mosaikit.dev.toml url points to
// :5173, so the UIs of the plugins accept being embedded from here.
// A second instance (`cargo xtask dev --instance`) sets MOSAIKIT_DEV_VITE_PORT and MOSAIKIT_DEV_SERVER_PORT.
const vitePort = Number(process.env.MOSAIKIT_DEV_VITE_PORT ?? 5173)
const serverPort = Number(process.env.MOSAIKIT_DEV_SERVER_PORT ?? 47080)
export default defineConfig({
  // relative paths: the app can be served under a base path (url = ".../mosaikit")
  base: './',
  plugins: [react(), tailwindcss()],
  // «@/» for the shadcn/ui components of the shell
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: vitePort,
    strictPort: true,
    // the proxy must forward the preflight of /api/run/* (a page with no origin calls it): the server answers CORS itself
    cors: false,
    proxy: {
      '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
      '/brand': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: { environment: 'happy-dom' },
})
