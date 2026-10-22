/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In sviluppo l'app si apre da Vite (http://127.0.0.1:5173, HMR) e le API sono
// inoltrate al server Mosaikit su :47080. In xtask/mosaikit.dev.toml url punta a
// :5173, cosi' le UI dei plugin accettano di essere incorporate da qui.
export default defineConfig({
  // percorsi relativi: l'app puo' essere servita sotto un percorso base (url = ".../mosaikit")
  base: './',
  plugins: [react(), tailwindcss()],
  // «@/» per i componenti shadcn/ui della shell
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:47080', changeOrigin: false },
      '/brand': { target: 'http://127.0.0.1:47080', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: { environment: 'happy-dom' },
})
