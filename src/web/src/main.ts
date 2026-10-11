// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import '@mosaikit/ui/fonts.css';
import '@mosaikit/ui/components';
import { applyTheme } from '@mosaikit/ui';
import './mk-shell.js';

// The default theme until the kernel says which one the installation uses.
applyTheme('mosaikit');

// The shell as an installable app that opens without network (MK-029); not with the dev server of
// Vite, whose files change at every save.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    console.warn('The shell cannot work offline:', error);
  });
}
