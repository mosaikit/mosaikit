// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  THEMES,
  brandVariants,
  isThemeName,
  registerTheme,
  themeDefinition,
  themeTitle,
  themeTokens,
  themes,
} from '../src/themes.js';

/** Contrast ratio of WCAG 2.1 between two colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('themes (MK-026)', () => {
  it('derives the 16 shades of Fluent UI from the brand color', () => {
    const shades = brandVariants('#0066cc') as unknown as Record<number, string>;

    expect(Object.keys(shades)).toHaveLength(16);
    expect(shades[80]).toBe('#0066cc');
    expect(shades[10]).toBe('#001f3d');
    expect(shades[160]).toMatch(/^#f[0-9a-f]{5}$/);
    expect(() => brandVariants('blue')).toThrow('Not a color');
  });

  it('gives the theme for public administrations the look of Bootstrap Italia', () => {
    const { fluent, mosaikit } = themeTokens('pa', 'light');

    expect(mosaikit['--mk-accent']).toBe('#0066cc');
    expect(mosaikit['--mk-font']).toMatch(/^'Titillium Web'/);
    expect(mosaikit['--mk-focus']).toBe('#b35c00');
    expect(mosaikit['--mk-radius']).toBe('4px');
    expect(fluent.colorBrandBackground).toBe('#0066cc');
    expect(fluent.fontFamilyBase).toBe(mosaikit['--mk-font']);
    expect(fluent.colorStrokeFocus2).toBe('#b35c00');
    expect(themeTitle('pa')).toContain('Bootstrap Italia');
  });

  it.each(THEMES.flatMap((name) => [`${name} light`, `${name} dark`]))(
    'keeps text readable, WCAG 2.1 AA (%s)',
    (which) => {
      const [name, scheme] = which.split(' ') as [(typeof THEMES)[number], 'light' | 'dark'];
      const tokens = themeTokens(name, scheme).mosaikit;
      const on = (fg: string, bg: string) => contrast(tokens[fg] ?? '', tokens[bg] ?? '');

      for (const background of ['--mk-surface', '--mk-bg']) {
        expect(on('--mk-fg', background)).toBeGreaterThanOrEqual(4.5);
        expect(on('--mk-muted', background)).toBeGreaterThanOrEqual(4.5);
        expect(on('--mk-danger', background)).toBeGreaterThanOrEqual(4.5);
        expect(on('--mk-accent', background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(on('--mk-accent-fg', '--mk-accent')).toBeGreaterThanOrEqual(4.5);
      // The focus ring is not text: 3:1 against the surface (WCAG 1.4.11).
      expect(on('--mk-focus', '--mk-surface')).toBeGreaterThanOrEqual(3);
    },
  );

  it('recognises the names of the themes', () => {
    expect(isThemeName('pa')).toBe(true);
    expect(isThemeName('bootstrap')).toBe(false);
    expect(isThemeName(undefined)).toBe(false);
  });
});

describe('themes of extensions and high contrast (MK-027, MK-028)', () => {
  it('fills a theme of an extension with the default theme, and ignores invalid values', () => {
    registerTheme('dev.example.green', {
      title: 'Green',
      radius: 99,
      font: 'url(evil)',
      light: { brand: '#1b7a3e', background: 'red' },
    });

    expect(isThemeName('dev.example.green')).toBe(true);
    expect(themes().map((theme) => theme.id)).toEqual(['mosaikit', 'pa', 'dev.example.green']);
    expect(themeTitle('dev.example.green')).toBe('Green');
    const green = themeTokens('dev.example.green', 'light').mosaikit;
    const base = themeTokens('mosaikit', 'light').mosaikit;
    expect(green['--mk-accent']).toBe('#1b7a3e');
    expect(green['--mk-bg']).toBe(base['--mk-bg']);
    expect(green['--mk-radius']).toBe(base['--mk-radius']);
    expect(green['--mk-font']).toBe(base['--mk-font']);
    expect(themeTokens('dev.example.green', 'dark').mosaikit['--mk-bg']).toBe(
      themeTokens('mosaikit', 'dark').mosaikit['--mk-bg'],
    );
    expect(themeTitle('dev.example.unknown')).toBe('Mosaikit');
  });

  it.each(['mosaikit', 'pa'])('has a high contrast scheme for %s', (name) => {
    const tokens = themeTokens(name, 'contrast').mosaikit;

    expect(tokens['--mk-bg']).toBe('#000000');
    expect(tokens['--mk-fg']).toBe('#ffffff');
    expect(contrast(tokens['--mk-fg'] ?? '', tokens['--mk-bg'] ?? '')).toBeGreaterThanOrEqual(7);
    expect(contrast(tokens['--mk-accent'] ?? '', tokens['--mk-bg'] ?? '')).toBeGreaterThanOrEqual(
      7,
    );
    expect(
      contrast(tokens['--mk-accent-fg'] ?? '', tokens['--mk-accent'] ?? ''),
    ).toBeGreaterThanOrEqual(7);
  });
});

describe('themes over another theme (MK-074)', () => {
  it('fills a theme with the theme it is based on, and gives the definition of a theme', () => {
    registerTheme('dev.example.acme', { title: 'Acme', light: { surface: '#fafafa' } }, 'pa');

    const acme = themeDefinition('dev.example.acme');
    expect(acme.light.surface).toBe('#fafafa');
    expect(acme.light.brand).toBe(themeDefinition('pa').light.brand);
    expect(acme.font).toBe(themeDefinition('pa').font);
    expect(acme.dark).toEqual(themeDefinition('pa').dark);
    // A base that is not available: the default theme.
    registerTheme('dev.example.lost', { title: 'Lost' }, 'dev.example.unknown');
    expect(themeDefinition('dev.example.lost').light).toEqual(themeDefinition('mosaikit').light);
    expect(themeDefinition('dev.example.unknown')).toBe(themeDefinition('mosaikit'));
  });
});
