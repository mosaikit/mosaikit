import { defineConfig } from 'vite'

// UI del plugin: percorsi relativi (servita da /ui/<id>/ sull'origine dei plugin)
export default defineConfig({
  base: './',
  // plugin-api arriva via symlink: le sue dipendenze si risolvono dal progetto dei plugin
  resolve: { preserveSymlinks: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
})
