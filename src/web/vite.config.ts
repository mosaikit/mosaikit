// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const kernel = 'http://localhost:8080';

export default defineConfig({
  resolve: {
    alias: {
      // Use the SDK sources directly, so that changes are picked up with hot module replacement.
      '@mosaikit/sdk': fileURLToPath(new URL('../../sdk/js/src/index.ts', import.meta.url)),
      '@mosaikit/ui/components': fileURLToPath(
        new URL('../../sdk/ui/src/components.ts', import.meta.url),
      ),
      '@mosaikit/ui/fonts.css': fileURLToPath(
        new URL('../../sdk/ui/src/fonts.css', import.meta.url),
      ),
      '@mosaikit/ui': fileURLToPath(new URL('../../sdk/ui/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // When the shell runs alone (npm run dev), forward kernel calls to Quarkus.
    proxy: { '/api': kernel, '/q': kernel },
  },
  build: {
    outDir: 'dist',
    target: 'es2023',
    sourcemap: true,
    rollupOptions: {
      // The runtime of isolated plugin frontends (MK-014) is a second entry, at a fixed address
      // that the shell puts in the frames it creates.
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        frame: fileURLToPath(new URL('src/frame.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'frame' ? 'frame.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
