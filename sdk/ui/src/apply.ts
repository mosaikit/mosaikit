// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { setTheme } from '@fluentui/web-components/theme/set-theme.js';
import { themeTokens, type ColorScheme, type ThemeName } from './themes.js';

const STYLE_ID = 'mk-theme';
let stopFollowing: (() => void) | undefined;

function schemeOfSystem(): ColorScheme {
  return globalThis.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function write(name: ThemeName, scheme: ColorScheme): void {
  const tokens = themeTokens(name, scheme);
  setTheme(tokens.fluent);
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  const declarations = Object.entries(tokens.mosaikit)
    .map(([property, value]) => `${property}: ${value};`)
    .join(' ');
  style.textContent = `:root { ${declarations} color-scheme: ${scheme}; }`;
  document.documentElement.dataset.mkTheme = name;
  document.documentElement.dataset.mkScheme = scheme;
}

/**
 * Applies a theme to the page: the tokens of Fluent UI and the `--mk-*` tokens, which cross the
 * Shadow DOM of extensions. Without a `scheme` it follows the light or dark preference of the system,
 * also when it changes.
 */
export function applyTheme(name: ThemeName, scheme?: ColorScheme): void {
  stopFollowing?.();
  stopFollowing = undefined;
  write(name, scheme ?? schemeOfSystem());
  const query = scheme ? undefined : globalThis.matchMedia('(prefers-color-scheme: dark)');
  if (query) {
    const follow = (): void => {
      write(name, schemeOfSystem());
    };
    query.addEventListener('change', follow);
    stopFollowing = () => {
      query.removeEventListener('change', follow);
    };
  }
}
