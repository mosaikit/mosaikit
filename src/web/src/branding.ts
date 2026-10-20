// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { brandVariants, registerTheme, themeDefinition, type ThemeName } from '@mosaikit/ui';
import type { BrandImageKind, Branding, BrandingDraft, KernelClient, SystemInfo } from './api.js';
import { t } from './i18n.js';

/**
 * The branding of an organization in the shell (MK-074): its display name, logos and colors over
 * those of the installation, on its sign-in page and after sign-in, and the live editor of its
 * administrators. A theme chosen by the person wins over the colors of the organization, which win
 * over the theme of the installation.
 */

/** The theme that the colors of the organization make, over the theme of the installation. */
export const ORGANIZATION_THEME = 'organization';
/** The theme of the editor while an administrator changes the colors, before saving. */
export const PREVIEW_THEME = 'organization-preview';

/** The tokens of a scheme that the editor changes; the brand color is the accent color. */
export const TOKENS = [
  'background',
  'surface',
  'foreground',
  'muted',
  'line',
  'danger',
  'success',
  'warning',
  'focus',
] as const;
export type Token = (typeof TOKENS)[number];
export type Scheme = 'light' | 'dark';

/** The largest image, as the kernel accepts it. */
export const MAX_IMAGE = 2 * 1024 * 1024;

const COLOR = /^#[0-9a-f]{6}$/i;

/** No branding: the shell shows the one of the installation. */
export const NO_BRANDING: Branding = {
  displayName: null,
  accent: null,
  light: {},
  dark: {},
  logo: null,
  logoDark: null,
  icon: null,
  favicon: null,
};

/** The organization of the sign-in page: `?organization=<slug>` in its address. */
export function signInOrganization(address: string): string | undefined {
  const slug = new URL(address).searchParams.get('organization')?.trim().toLowerCase();
  return slug && /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) ? slug : undefined;
}

/** Whether a branding changes the colors of the theme. */
export function changesColors(draft: BrandingDraft | undefined): boolean {
  return (
    draft !== undefined &&
    (Boolean(draft.accent) ||
      Object.keys(draft.light).length > 0 ||
      Object.keys(draft.dark).length > 0)
  );
}

/**
 * Registers the colors of a branding as a theme over `base`, the theme of the installation; the
 * accent color is the brand color of the light scheme, and a lighter shade of it in the dark one.
 * Answers whether there was anything to register.
 */
export function registerBranding(id: ThemeName, draft: BrandingDraft, base: ThemeName): boolean {
  if (!changesColors(draft)) {
    return false;
  }
  const accent = draft.accent && COLOR.test(draft.accent) ? draft.accent : undefined;
  registerTheme(
    id,
    {
      title: draft.displayName ?? t('Organization'),
      light: { ...(accent ? { brand: accent } : {}), ...draft.light },
      dark: { ...(accent ? { brand: brandVariants(accent)[120] } : {}), ...draft.dark },
    },
    base,
  );
  return true;
}

/**
 * The theme that applies: the one the person chose, then the one of the organization, then the one
 * of the installation, each when available; the default otherwise.
 */
export function chooseTheme(
  person: string | null | undefined,
  organization: string | undefined,
  installation: string | undefined,
  available: (name: string) => boolean,
): ThemeName {
  for (const candidate of [person, organization, installation]) {
    if (candidate && available(candidate)) {
      return candidate;
    }
  }
  return 'mosaikit';
}

/** What the shell shows of the product: the name, the logos and the icon of the page. */
export interface Marks {
  readonly name: string;
  /** The logo of the bar of the shell, on the brand color. */
  readonly bar: string | undefined;
  /** The logo of the sign-in page, for its scheme. */
  readonly signIn: string | undefined;
  readonly favicon: string | undefined;
}

/** The marks of the organization over those of the installation (MK-052). */
export function marks(
  info: SystemInfo | undefined,
  branding: Branding | undefined,
  scheme: string | undefined,
): Marks {
  const product = info?.name ?? 'Mosaikit';
  const dark = scheme === 'dark';
  const own = branding ?? NO_BRANDING;
  const installationLogo = (dark ? info?.logoDark : undefined) ?? info?.logo ?? undefined;
  const signIn =
    (dark ? (own.logoDark ?? own.logo) : (own.logo ?? own.logoDark)) ??
    own.icon ??
    installationLogo;
  return {
    name: own.displayName ?? product,
    bar: own.icon ?? own.logoDark ?? own.logo ?? info?.logoDark ?? info?.logo ?? undefined,
    signIn,
    favicon: own.favicon ?? own.icon ?? info?.logo ?? undefined,
  };
}

function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

/** The contrast ratio of WCAG 2.1 between two colors `#rrggbb`. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Whether white text on the accent color misses the contrast of WCAG 2.1 AA (4.5:1). */
export function accentTooLight(accent: string | null): boolean {
  return accent !== null && COLOR.test(accent) && contrastRatio(accent, '#ffffff') < 4.5;
}

/** The value a token shows in the editor: the one changed, or the one of the theme it is over. */
export function tokenValue(
  draft: BrandingDraft,
  scheme: Scheme,
  token: Token,
  base: ThemeName,
): string {
  return draft[scheme][token] ?? themeDefinition(base)[scheme][token];
}

/** The draft of a branding: what the editor changes. */
export function draftOf(branding: Branding): BrandingDraft {
  return {
    displayName: branding.displayName,
    accent: branding.accent,
    light: { ...branding.light },
    dark: { ...branding.dark },
  };
}

function sameDraft(a: BrandingDraft, b: BrandingDraft): boolean {
  return (
    JSON.stringify(draftOf({ ...NO_BRANDING, ...a })) ===
    JSON.stringify(draftOf({ ...NO_BRANDING, ...b }))
  );
}

/** What the editor tells the page and the shell around it. */
export interface BrandingEditorEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
  /** A draft to show on the open application before it is saved; `undefined` ends the preview. */
  preview(draft: BrandingDraft | undefined): void;
  /** The branding saved: the shell shows it. */
  saved(branding: Branding): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The editor of the branding of an organization (MK-074), without the view: reads it, changes the
 * draft and shows it at once on the application, saves it, and stores or removes its images.
 */
export class BrandingEditor {
  branding: Branding | undefined;
  draft: BrandingDraft = draftOf(NO_BRANDING);

  constructor(
    private readonly client:
      | Pick<KernelClient, 'branding' | 'changeBranding' | 'storeBrandImage' | 'removeBrandImage'>
      | undefined,
    private readonly organization: string | undefined,
    private readonly events: BrandingEditorEvents,
  ) {}

  async load(): Promise<void> {
    if (!this.client || !this.organization) {
      return;
    }
    try {
      this.branding = await this.client.branding(this.organization);
      this.draft = draftOf(this.branding);
    } catch (error) {
      this.events.announce(
        t('The branding cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** Whether the draft differs from what is saved. */
  get dirty(): boolean {
    return this.branding !== undefined && !sameDraft(this.draft, draftOf(this.branding));
  }

  setName(value: string): void {
    this.change({ ...this.draft, displayName: value.trim() === '' ? null : value });
  }

  setAccent(value: string | null): void {
    if (value !== null && !COLOR.test(value)) {
      return;
    }
    this.change({ ...this.draft, accent: value?.toLowerCase() ?? null });
  }

  setToken(scheme: Scheme, token: Token, value: string): void {
    if (!COLOR.test(value)) {
      return;
    }
    this.change({
      ...this.draft,
      [scheme]: { ...this.draft[scheme], [token]: value.toLowerCase() },
    });
  }

  resetToken(scheme: Scheme, token: Token): void {
    const tokens = Object.fromEntries(
      Object.entries(this.draft[scheme]).filter(([name]) => name !== token),
    );
    this.change({ ...this.draft, [scheme]: tokens });
  }

  private change(draft: BrandingDraft): void {
    this.draft = draft;
    this.events.preview(draft);
    this.events.changed();
  }

  /** Goes back to what is saved, and ends the preview. */
  discard(): void {
    if (this.branding) {
      this.draft = draftOf(this.branding);
    }
    this.events.preview(undefined);
    this.events.changed();
  }

  /** Saves the draft; answers whether it was saved. */
  async save(): Promise<boolean> {
    if (!this.client || !this.organization) {
      return false;
    }
    try {
      this.branding = await this.client.changeBranding(this.organization, this.draft);
      this.draft = draftOf(this.branding);
      this.events.preview(undefined);
      this.events.saved(this.branding);
      this.events.announce(t('Saved.'), false);
      return true;
    } catch (error) {
      this.events.announce(t('Not saved: {reason}', { reason: reason(error) }), true);
      return false;
    } finally {
      this.events.changed();
    }
  }

  /** Stores an image; answers whether it was stored. */
  async upload(kind: BrandImageKind, image: Blob): Promise<boolean> {
    if (!this.client || !this.organization) {
      return false;
    }
    if (image.size > MAX_IMAGE) {
      this.events.announce(t('An image has at most 2 MB.'), true);
      return false;
    }
    try {
      this.images(await this.client.storeBrandImage(this.organization, kind, image));
      this.events.announce(t('Image saved.'), false);
      return true;
    } catch (error) {
      this.events.announce(t('Not saved: {reason}', { reason: reason(error) }), true);
      return false;
    } finally {
      this.events.changed();
    }
  }

  async remove(kind: BrandImageKind): Promise<void> {
    if (!this.client || !this.organization) {
      return;
    }
    try {
      this.images(await this.client.removeBrandImage(this.organization, kind));
      this.events.announce(t('Image removed.'), false);
    } catch (error) {
      this.events.announce(t('Not removed: {reason}', { reason: reason(error) }), true);
    } finally {
      this.events.changed();
    }
  }

  /** The branding with its images saved; the draft of the colors and the name stays. */
  private images(branding: Branding): void {
    this.branding = branding;
    this.events.saved(branding);
  }
}

/** The image of a kind in a branding. */
export function imageOf(branding: Branding | undefined, kind: BrandImageKind): string | null {
  if (!branding) {
    return null;
  }
  switch (kind) {
    case 'logo':
      return branding.logo;
    case 'logo-dark':
      return branding.logoDark;
    case 'icon':
      return branding.icon;
    case 'favicon':
      return branding.favicon;
  }
}
