// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { defineConfig } from 'vite';

/**
 * One ES module with React inside: the shell imports it like any plugin frontend. The framework is
 * private to the plugin, so plugins can use different versions of it (MK-021).
 */
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
  },
});
