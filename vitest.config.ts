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
      'sdk/create-extension/test/**/*.test.ts',
      'sdk/testing/test/**/*.test.ts',
      'sdk/java/src/test/ts/**/*.test.ts',
      'src/web/test/**/*.test.ts',
      'docs/requirements/test/**/*.test.ts',
      'docs/test/**/*.test.ts',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'sdk/js/src/**',
        'sdk/ui/src/themes.ts',
        'sdk/create-extension/src/**',
        'src/web/src/**',
      ],
      exclude: [
        'sdk/create-extension/src/bin.ts',
        'src/web/src/main.ts',
        'src/web/src/mk-shell.ts',
        'src/web/src/mk-sign-in.ts',
        'src/web/src/mk-settings.ts',
        'src/web/src/mk-sessions.ts',
        'src/web/src/mk-access-keys.ts',
        'src/web/src/mk-admin-apps.ts',
        'src/web/src/mk-admin-permissions.ts',
        'src/web/src/mk-admin-secrets.ts',
        'src/web/src/mk-admin-quotas.ts',
        'src/web/src/mk-invite-person.ts',
        'src/web/src/mk-permission-list.ts',
        'src/web/src/mk-effective-permissions.ts',
        'src/web/src/mk-activity.ts',
        'sdk/ui/src/apply.ts',
        'sdk/ui/src/components.ts',
        'src/web/src/mk-admin-extensions.ts',
        'src/web/src/mk-admin-services.ts',
        'src/web/src/mk-assistant.ts',
        'src/web/src/mk-extension-frame.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 85, branches: 80, functions: 85, statements: 85 },
    },
  },
});
