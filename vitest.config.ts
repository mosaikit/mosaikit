// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@mosaikit/sdk': fileURLToPath(new URL('./sdk/js/src/index.ts', import.meta.url)),
      '@mosaikit/ui/components': fileURLToPath(
        new URL('./sdk/ui/src/components.ts', import.meta.url),
      ),
      '@mosaikit/ui/fonts.css': fileURLToPath(new URL('./sdk/ui/src/fonts.css', import.meta.url)),
      '@mosaikit/ui': fileURLToPath(new URL('./sdk/ui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: [
      'sdk/js/test/**/*.test.ts',
      'sdk/ui/test/**/*.test.ts',
      'build/test/**/*.test.ts',
      'sdk/create-plugin/test/**/*.test.ts',
      'sdk/java/src/test/ts/**/*.test.ts',
      'src/web/test/**/*.test.ts',
      'docs/requirements/test/**/*.test.ts',
      'docs/test/**/*.test.ts',
      'src/plugins/*/test/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'sdk/js/src/**',
        'sdk/ui/src/themes.ts',
        'sdk/create-plugin/src/**',
        'src/web/src/**',
      ],
      exclude: [
        'sdk/create-plugin/src/bin.ts',
        'src/web/src/main.ts',
        'src/web/src/mk-shell.ts',
        'src/web/src/mk-sign-in.ts',
        'src/web/src/mk-settings.ts',
        'src/web/src/mk-admin-apps.ts',
        'src/web/src/mk-activity.ts',
        'sdk/ui/src/apply.ts',
        'sdk/ui/src/components.ts',
        'src/web/src/mk-admin-plugins.ts',
        'src/web/src/mk-assistant.ts',
        'src/web/src/mk-plugin-frame.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 85, branches: 80, functions: 85, statements: 85 },
    },
  },
});
