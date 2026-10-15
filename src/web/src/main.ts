// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import '@mosaikit/ui/fonts.css';
import '@mosaikit/ui/components';
import { applyTheme } from '@mosaikit/ui';
import { defineReferencePlaceholder } from '@mosaikit/sdk';
import './mk-shell.js';

// The placeholder of a reference to a resource whose extension is absent (MK-135), for the
// extensions loaded as modules; an extension in an isolated frame defines it itself.
defineReferencePlaceholder();

// The default theme until the kernel says which one the installation uses.
applyTheme('mosaikit');

// The shell as an installable app that opens without network (MK-029); not with the dev server of
// Vite, whose files change at every save, nor for a view embedded in another site (MK-100).
if (
  import.meta.env.PROD &&
  'serviceWorker' in navigator &&
  !location.pathname.startsWith('/embed/')
) {
  navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    console.warn('The shell cannot work offline:', error);
  });
}
