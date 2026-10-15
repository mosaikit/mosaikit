// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { isThemeName, themeDefinition, themeTokens } from '@mosaikit/ui';
import { type Branding, type BrandingDraft, KernelClient, type SystemInfo } from '../src/api.js';
import {
  BrandingEditor,
  MAX_IMAGE,
  NO_BRANDING,
  ORGANIZATION_THEME,
  PREVIEW_THEME,
  accentTooLight,
  changesColors,
  chooseTheme,
  contrastRatio,
  draftOf,
  imageOf,
  marks,
  registerBranding,
  signInOrganization,
  tokenValue,
} from '../src/branding.js';

// Only the themes of @mosaikit/ui, which computes them without a page.
vi.mock('@mosaikit/ui', () => import('../../../sdk/ui/src/themes.js'));

const ACME: Branding = {
  ...NO_BRANDING,
  displayName: 'Acme Works',
  accent: '#0a7a55',
  light: { surface: '#fafafa' },
  logo: '/api/v1/organizations/acme/branding/images/logo?v=1',
  logoDark: '/api/v1/organizations/acme/branding/images/logo-dark?v=2',
  icon: '/api/v1/organizations/acme/branding/images/icon?v=3',
  favicon: '/api/v1/organizations/acme/branding/images/favicon?v=4',
};

const INFO: SystemInfo = {
  name: 'Mosaikit',
  version: '1.0.0',
  activeExtensions: 0,
  theme: 'mosaikit',
  rememberDays: 30,
  logo: null,
  logoDark: null,
};

function events() {
  return {
    changed: vi.fn(),
    announce: vi.fn<(message: string, failed: boolean) => void>(),
    preview: vi.fn<(draft: BrandingDraft | undefined) => void>(),
    saved: vi.fn<(branding: Branding) => void>(),
  };
}

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    branding: vi.fn(() => Promise.resolve(ACME)),
    changeBranding: vi.fn((_slug: string, draft: BrandingDraft) =>
      Promise.resolve({ ...ACME, ...draft }),
    ),
    storeBrandImage: vi.fn(() => Promise.resolve(ACME)),
    removeBrandImage: vi.fn(() => Promise.resolve({ ...ACME, icon: null })),
    ...overrides,
  };
}

describe('MK-074 the branding of an organization in the shell', () => {
  it('reads the organization of its sign-in page from the address', () => {
    expect(signInOrganization('https://example.org/?organization=Acme')).toBe('acme');
    expect(signInOrganization('https://example.org/')).toBeUndefined();
    expect(signInOrganization('https://example.org/?organization=../x')).toBeUndefined();
  });

  it('shows the name, the logos and the icon of the organization over those of the installation', () => {
    const light = marks(INFO, ACME, 'light');
    expect(light.name).toBe('Acme Works');
    expect(light.bar).toBe(ACME.icon);
    expect(light.signIn).toBe(ACME.logo);
    expect(light.favicon).toBe(ACME.favicon);
    expect(marks(INFO, ACME, 'dark').signIn).toBe(ACME.logoDark);
    expect(marks(INFO, { ...ACME, icon: null }, 'light').bar).toBe(ACME.logoDark);

    // Without branding, or for the people of another organization: those of the installation.
    const product = { ...INFO, name: 'Atlas', logo: '/logo.svg', logoDark: '/dark.svg' };
    expect(marks(product, undefined, 'dark')).toEqual({
      name: 'Atlas',
      bar: '/dark.svg',
      signIn: '/dark.svg',
      favicon: '/logo.svg',
    });
    expect(marks(undefined, NO_BRANDING, 'light').name).toBe('Mosaikit');
  });

  it('makes a theme of the colors of the organization over the theme of the installation', () => {
    expect(changesColors(NO_BRANDING)).toBe(false);
    expect(registerBranding(ORGANIZATION_THEME, NO_BRANDING, 'pa')).toBe(false);
    expect(registerBranding(ORGANIZATION_THEME, ACME, 'pa')).toBe(true);

    const theme = themeDefinition(ORGANIZATION_THEME);
    expect(theme.light.brand).toBe('#0a7a55');
    expect(theme.light.surface).toBe('#fafafa');
    expect(theme.light.background).toBe(themeDefinition('pa').light.background);
    expect(theme.font).toBe(themeDefinition('pa').font);
    expect(theme.dark.brand).not.toBe('#0a7a55');
    expect(themeTokens(ORGANIZATION_THEME, 'light').mosaikit['--mk-accent']).toBe('#0a7a55');
  });

  it('applies the theme of the person, then the one of the organization, then the one of the installation', () => {
    registerBranding(ORGANIZATION_THEME, ACME, 'mosaikit');
    expect(chooseTheme('pa', ORGANIZATION_THEME, 'mosaikit', isThemeName)).toBe('pa');
    expect(chooseTheme(null, ORGANIZATION_THEME, 'pa', isThemeName)).toBe(ORGANIZATION_THEME);
    expect(chooseTheme(undefined, undefined, 'pa', isThemeName)).toBe('pa');
    expect(chooseTheme('dev.example.gone', undefined, 'gone', isThemeName)).toBe('mosaikit');
  });

  it('tells a accent color on which white text is hard to read', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
    expect(accentTooLight('#ffee00')).toBe(true);
    expect(accentTooLight('#0a7a55')).toBe(false);
    expect(accentTooLight(null)).toBe(false);
  });

  it('gives the value of a token: the one changed, or the one of the theme under it', () => {
    expect(tokenValue(draftOf(ACME), 'light', 'surface', 'pa')).toBe('#fafafa');
    expect(tokenValue(draftOf(ACME), 'dark', 'surface', 'pa')).toBe(
      themeDefinition('pa').dark.surface,
    );
  });

  it('gives the image of each kind', () => {
    expect(imageOf(ACME, 'logo')).toBe(ACME.logo);
    expect(imageOf(ACME, 'logo-dark')).toBe(ACME.logoDark);
    expect(imageOf(ACME, 'icon')).toBe(ACME.icon);
    expect(imageOf(ACME, 'favicon')).toBe(ACME.favicon);
    expect(imageOf(undefined, 'logo')).toBeNull();
  });
});

describe('MK-074 the live editor of the branding', () => {
  it('shows a change of a token on the application before it is saved, and saves it', async () => {
    const kernel = client();
    const said = events();
    const editor = new BrandingEditor(kernel, 'acme', said);
    await editor.load();
    expect(editor.dirty).toBe(false);

    editor.setToken('dark', 'background', '#101820');
    expect(said.preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ dark: { background: '#101820' } }),
    );
    expect(kernel.changeBranding).not.toHaveBeenCalled();
    expect(editor.dirty).toBe(true);
    // The draft as the shell shows it, over the theme of the installation.
    expect(registerBranding(PREVIEW_THEME, editor.draft, 'mosaikit')).toBe(true);
    expect(themeTokens(PREVIEW_THEME, 'dark').mosaikit['--mk-bg']).toBe('#101820');

    editor.setToken('light', 'surface', 'not a color');
    editor.setAccent('red');
    editor.setAccent('#0B8A5F');
    editor.setName('Acme');
    editor.resetToken('light', 'surface');
    expect(editor.draft).toEqual({
      displayName: 'Acme',
      accent: '#0b8a5f',
      light: {},
      dark: { background: '#101820' },
    });

    expect(await editor.save()).toBe(true);
    expect(kernel.changeBranding).toHaveBeenCalledWith('acme', editor.draft);
    expect(said.preview).toHaveBeenLastCalledWith(undefined);
    expect(said.saved).toHaveBeenCalled();
    expect(said.announce).toHaveBeenLastCalledWith('Saved.', false);
    expect(editor.dirty).toBe(false);
  });

  it('discards a draft and ends the preview', async () => {
    const said = events();
    const editor = new BrandingEditor(client(), 'acme', said);
    await editor.load();
    editor.setName('');
    expect(editor.draft.displayName).toBeNull();
    editor.setAccent(null);
    editor.discard();
    expect(editor.draft).toEqual(draftOf(ACME));
    expect(said.preview).toHaveBeenLastCalledWith(undefined);
  });

  it('says what failed', async () => {
    const said = events();
    const refused = () => Promise.reject(new Error('Forbidden'));
    const editor = new BrandingEditor(
      client({
        branding: refused,
        changeBranding: refused,
        storeBrandImage: refused,
        removeBrandImage: refused,
      }),
      'acme',
      said,
    );
    await editor.load();
    expect(said.announce).toHaveBeenLastCalledWith('The branding cannot be read: Forbidden', true);
    expect(await editor.save()).toBe(false);
    expect(said.announce).toHaveBeenLastCalledWith('Not saved: Forbidden', true);
    expect(await editor.upload('logo', new Blob(['x']))).toBe(false);
    await editor.remove('logo');
    expect(said.announce).toHaveBeenLastCalledWith('Not removed: Forbidden', true);
  });

  it('stores and removes images, refusing those over 2 MB before sending them', async () => {
    const kernel = client();
    const said = events();
    const editor = new BrandingEditor(kernel, 'acme', said);
    await editor.load();

    expect(await editor.upload('logo', new Blob([new Uint8Array(MAX_IMAGE + 1)]))).toBe(false);
    expect(kernel.storeBrandImage).not.toHaveBeenCalled();
    expect(said.announce).toHaveBeenLastCalledWith('An image has at most 2 MB.', true);

    const png = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' });
    expect(await editor.upload('logo', png)).toBe(true);
    expect(kernel.storeBrandImage).toHaveBeenCalledWith('acme', 'logo', png);
    expect(said.saved).toHaveBeenCalledWith(ACME);

    await editor.remove('icon');
    expect(editor.branding?.icon).toBeNull();
    expect(said.announce).toHaveBeenLastCalledWith('Image removed.', false);
  });

  it('does nothing without a client or an organization', async () => {
    const editor = new BrandingEditor(undefined, undefined, events());
    await editor.load();
    expect(await editor.save()).toBe(false);
    expect(await editor.upload('logo', new Blob(['x']))).toBe(false);
    await editor.remove('logo');
    expect(editor.branding).toBeUndefined();
  });
});

describe('MK-074 the client of the branding', () => {
  it('reads, changes and stores the branding of an organization', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(ACME), { status: 200 }));
    });
    const kernel = new KernelClient(fetchImpl);

    await kernel.branding('acme');
    await kernel.changeBranding('acme', draftOf(ACME));
    await kernel.storeBrandImage('acme', 'logo', new Blob(['<svg/>'], { type: 'image/svg+xml' }));
    await kernel.storeBrandImage('acme', 'favicon', new Blob(['x']));
    await kernel.removeBrandImage('acme', 'icon');

    expect(calls.map((call) => `${call.init?.method ?? 'GET'} ${call.url}`)).toEqual([
      'GET /api/v1/organizations/acme/branding',
      'PUT /api/v1/organizations/acme/branding',
      'PUT /api/v1/organizations/acme/branding/images/logo',
      'PUT /api/v1/organizations/acme/branding/images/favicon',
      'DELETE /api/v1/organizations/acme/branding/images/icon',
    ]);
    expect(new Headers(calls[2]?.init?.headers).get('Content-Type')).toBe('image/svg+xml');
    expect(new Headers(calls[3]?.init?.headers).get('Content-Type')).toBe(
      'application/octet-stream',
    );
  });
});
