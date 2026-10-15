// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { PageHistory, PageLocation } from './address.js';
import type { ResourceRef } from './sharing.js';

/**
 * The embed mode of the shell (MK-100): a view of an extension without the app bar and the top bar,
 * for the iframes of the sites that its organization lists. The kernel lets only those sites, and the
 * installation itself, frame the addresses under this prefix, and no other address of the shell.
 */
export const EMBED_PREFIX = '/embed/';

const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** What an address of the embed mode shows. */
export type EmbedAddress =
  /** A resource opened with a link of the organization: `/embed/<slug>/shared/<secret>`. */
  | { readonly kind: 'link'; readonly organization: string; readonly token: string }
  /** A resource the organization shares with the public: `/embed/<slug>/public/<extension>/<type>/<id>`. */
  | { readonly kind: 'public'; readonly organization: string; readonly resource: ResourceRef }
  /** A view of an app, with its state (MK-099): `/embed/<slug>/app/<name>/...`. */
  | { readonly kind: 'app'; readonly organization: string; readonly path: string }
  /** Anything else under the prefix: nothing to show. */
  | { readonly kind: 'unknown'; readonly organization: string };

function decoded(part: string | undefined): string | undefined {
  if (!part) {
    return undefined;
  }
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}

/** The embedded view of a path of the shell, or `undefined` when the path is not of the embed mode. */
export function embedOf(path: string): EmbedAddress | undefined {
  if (!path.startsWith(EMBED_PREFIX)) {
    return undefined;
  }
  const parts = path.slice(EMBED_PREFIX.length).split('/');
  const organization = parts[0] ?? '';
  if (!SLUG.test(organization)) {
    return { kind: 'unknown', organization: '' };
  }
  const [, what, ...rest] = parts;
  if (what === 'shared' && rest.length === 1) {
    const token = decoded(rest[0]);
    if (token) {
      return { kind: 'link', organization, token };
    }
  }
  if (what === 'public' && rest.length === 3) {
    const [extension, type, id] = rest.map(decoded);
    if (extension && type && id) {
      return { kind: 'public', organization, resource: { extension, type, id } };
    }
  }
  if (what === 'app' && rest.length > 0 && rest[0]) {
    return { kind: 'app', organization, path: `/${['app', ...rest].join('/')}` };
  }
  return { kind: 'unknown', organization };
}

/** The address of the embed mode for a path of the shell, such as the route of an app and its state. */
export function embedAddress(organization: string, path: string): string {
  return `${EMBED_PREFIX}${organization}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * The address of the page as the apps see it in the embed mode: without the prefix, so that the
 * route of an app and its state (MK-099) read and write as in the console.
 */
export class EmbedLocation implements PageLocation {
  constructor(
    private readonly organization: string,
    private readonly page: PageLocation = globalThis.location,
  ) {}

  get pathname(): string {
    const prefix = `${EMBED_PREFIX}${this.organization}`;
    const path = this.page.pathname;
    return path.startsWith(`${prefix}/`) ? path.slice(prefix.length) : path;
  }

  get search(): string {
    return this.page.search;
  }

  get hash(): string {
    return this.page.hash;
  }
}

/** The history of the page in the embed mode: the addresses that apps write stay under the prefix. */
export class EmbedHistory implements PageHistory {
  constructor(
    private readonly organization: string,
    private readonly page: PageHistory = globalThis.history,
  ) {}

  pushState(data: unknown, unused: string, url?: string | URL | null): void {
    this.page.pushState(data, unused, this.within(url));
  }

  replaceState(data: unknown, unused: string, url?: string | URL | null): void {
    this.page.replaceState(data, unused, this.within(url));
  }

  private within(url: string | URL | null | undefined): string | URL | null | undefined {
    return typeof url === 'string' && url.startsWith('/')
      ? embedAddress(this.organization, url)
      : url;
  }
}
