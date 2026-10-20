import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: il browser vede il dev server Vite (HMR) e le API vengono prossate
// al server Rust su :8080. Il server Rust serve invece la build embedded
// (../mosaikit-ui/dist via rust-embed) quando aperto direttamente su :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/login': 'http://127.0.0.1:8080',
      '/logout': 'http://127.0.0.1:8080',
      '/plugins': 'http://127.0.0.1:8080',
      '/resources': 'http://127.0.0.1:8080',
      '/files': 'http://127.0.0.1:8080',
    },
  },
})
