import { defineConfig } from 'vite'

// UI of the plugin: relative paths (served from /ui/<id>/ on the origin of the plugins)
export default defineConfig({
  base: './',
  // plugin-api arrives through a symlink: its dependencies resolve from the plugin project
  resolve: { preserveSymlinks: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
})
