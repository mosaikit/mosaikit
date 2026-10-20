// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { ShellAddress } from '../src/address.js';
import { KernelClient, type EmbedSite } from '../src/api.js';
import {
  EmbedHistory,
  EmbedLocation,
  embedAddress,
  embedOf,
  type EmbedAddress,
} from '../src/embed.js';
import { EmbedSiteList, looksLikeSite } from '../src/embed-sites.js';
import { openLink, openPublic, publicRequest } from '../src/sharing.js';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const SITE: EmbedSite = {
  origin: 'https://www.example.org',
  addedAt: '2026-10-15T08:00:00Z',
  addedBy: 'boss@example.org',
};

describe('MK-100 the embed mode of the shell: its addresses', () => {
  it('tells a link, a public resource and the view of an app of an organization apart', () => {
    const cases: [string, EmbedAddress | undefined][] = [
      ['/embed/acme/shared/s3cr3t', { kind: 'link', organization: 'acme', token: 's3cr3t' }],
      [
        '/embed/acme/public/dev.example.maps/map/m%3A1',
        {
          kind: 'public',
          organization: 'acme',
          resource: { extension: 'dev.example.maps', type: 'map', id: 'm:1' },
        },
      ],
      ['/embed/acme/app/maps', { kind: 'app', organization: 'acme', path: '/app/maps' }],
      [
        '/embed/acme/app/maps/42/layers',
        { kind: 'app', organization: 'acme', path: '/app/maps/42/layers' },
      ],
      ['/embed/acme', { kind: 'unknown', organization: 'acme' }],
      ['/embed/acme/shared/a/b', { kind: 'unknown', organization: 'acme' }],
      ['/embed/acme/shared/%E0%A4%A', { kind: 'unknown', organization: 'acme' }],
      ['/embed/acme/public/dev.example.maps/map', { kind: 'unknown', organization: 'acme' }],
      ['/embed/acme/app/', { kind: 'unknown', organization: 'acme' }],
      ['/embed/Not%20a%20slug/app/maps', { kind: 'unknown', organization: '' }],
      ['/app/maps', undefined],
      ['/shared/s3cr3t', undefined],
      ['/embed', undefined],
    ];
    for (const [path, expected] of cases) {
      expect(embedOf(path), path).toEqual(expected);
    }
    expect(embedAddress('acme', '/app/maps?z=3')).toBe('/embed/acme/app/maps?z=3');
    expect(embedAddress('acme', 'app/maps')).toBe('/embed/acme/app/maps');
  });

  it('gives the apps their route and state without the prefix, and keeps what they write under it', () => {
    const page = { pathname: '/embed/acme/app/maps/42', search: '?z=3', hash: '#top' };
    const location = new EmbedLocation('acme', page);
    expect(location.pathname).toBe('/app/maps/42');
    expect(location.search).toBe('?z=3');
    expect(location.hash).toBe('#top');
    expect(
      new EmbedLocation('acme', { ...page, pathname: '/embed/globex/app/maps' }).pathname,
    ).toBe('/embed/globex/app/maps');

    const written = {
      pushState: vi.fn<History['pushState']>(),
      replaceState: vi.fn<History['replaceState']>(),
    };
    const history = new EmbedHistory('acme', written);
    history.pushState(null, '', '/app/maps/43?z=4');
    history.replaceState(null, '', '/app/maps/44');
    history.pushState(null, '', 'https://elsewhere.example.org/');
    expect(written.pushState.mock.calls.map((call) => call[2])).toEqual([
      '/embed/acme/app/maps/43?z=4',
      'https://elsewhere.example.org/',
    ]);
    expect(written.replaceState).toHaveBeenCalledWith(null, '', '/embed/acme/app/maps/44');

    // The address of the shell (MK-099) works the same inside.
    const changed = vi.fn();
    const address = new ShellAddress(
      () => [
        {
          extensionId: 'dev.example.maps',
          id: 'maps',
          title: 'Maps',
          route: '/app/maps',
          element: 'x-maps',
        },
      ],
      changed,
      location,
      history,
    );
    const maps = address.for('dev.example.maps');
    expect(maps.read()).toBe('/42?z=3#top');
    expect(maps.write('/45')).toBe(true);
    expect(written.pushState).toHaveBeenLastCalledWith(null, '', '/embed/acme/app/maps/45');
  });
});

describe('MK-100 the embed mode of the shell: what it opens', () => {
  it('opens a resource shared with the public without the credentials of the browser', async () => {
    const access = {
      resource: { extension: 'dev.example.maps', type: 'map', id: 'm 1' },
      title: 'Lakes',
      link: '/app/maps/1',
      level: 'view',
    };
    const request = vi
      .fn<(path: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(json(200, access))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockRejectedValueOnce(new Error('offline'));
    expect(await openPublic(request, 'acme', access.resource)).toEqual({ kind: 'opened', access });
    expect(request.mock.calls[0]?.[0]).toBe(
      '/api/v1/sharing/public/acme/dev.example.maps/map/m%201',
    );
    expect(request.mock.calls[0]?.[1]?.credentials).toBe('omit');
    expect(await openPublic(request, 'acme', access.resource)).toEqual({ kind: 'not-found' });
    expect(await openPublic(request, 'acme', access.resource)).toEqual({
      kind: 'failed',
      reason: 'offline',
    });
  });

  it('calls the extension as the public of the organization', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(json(200, {})));
    await publicRequest('acme', fetchMock)('/api/v1/ext/maps/maps/1');
    await publicRequest('acme', fetchMock)('/x', { headers: { Accept: 'text/plain' } });
    const [first, second] = fetchMock.mock.calls;
    const headers = new Headers(first?.[1]?.headers);
    expect(headers.get('X-Mosaikit-Public')).toBe('acme');
    expect(headers.get('Accept')).toBe('application/json');
    expect(first?.[1]?.credentials).toBe('omit');
    expect(new Headers(second?.[1]?.headers).get('Accept')).toBe('text/plain');
  });

  it('opens a link only of the organization of the address', async () => {
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    expect(await openLink(request, 'abc', undefined, 'acme')).toEqual({ kind: 'not-found' });
    expect(JSON.parse(request.mock.calls[0]?.[1]?.body as string)).toEqual({
      token: 'abc',
      organization: 'acme',
    });
  });
});

describe('MK-100 the sites that embed the views of an organization', () => {
  function events() {
    return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
  }

  function client(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      embedSites: vi.fn(() => Promise.resolve([SITE])),
      addEmbedSite: vi.fn((_organization: string, origin: string) =>
        Promise.resolve({ ...SITE, origin }),
      ),
      removeEmbedSite: vi.fn(() => Promise.resolve()),
      ...overrides,
    };
  }

  it('accepts the origins of web pages only', () => {
    for (const site of [
      'https://www.example.org',
      'http://localhost:5173',
      'https://*.example.org',
    ]) {
      expect(looksLikeSite(site), site).toBe(true);
    }
    for (const site of [
      'wss://www.example.org',
      'https://www.example.org/page',
      'www.example.org',
      '*',
      "'self'",
      '',
    ]) {
      expect(looksLikeSite(site), site).toBe(false);
    }
  });

  it('reads, adds and removes sites', async () => {
    const kernel = client();
    const told = events();
    const list = new EmbedSiteList(kernel, 'acme', told);

    await list.load();
    expect(list.sites).toEqual([SITE]);
    expect(kernel.embedSites).toHaveBeenCalledWith('acme');

    expect(await list.add(' https://news.example.org ')).toBe(true);
    expect(kernel.addEmbedSite).toHaveBeenCalledWith('acme', 'https://news.example.org');
    expect(told.announce).toHaveBeenLastCalledWith(
      'https://news.example.org may show your views.',
      false,
    );
    expect(await list.add('https://news.example.org/page')).toBe(false);
    expect(kernel.addEmbedSite).toHaveBeenCalledTimes(1);
    expect(told.announce.mock.lastCall?.[1]).toBe(true);

    await list.remove(SITE);
    expect(kernel.removeEmbedSite).toHaveBeenCalledWith('acme', 'https://www.example.org');
    expect(told.announce).toHaveBeenLastCalledWith('https://www.example.org removed.', false);
  });

  it('tells what went wrong, and does nothing without a client or an organization', async () => {
    const kernel = client({
      embedSites: vi.fn(() => Promise.reject(new Error('Forbidden'))),
      addEmbedSite: vi.fn(() => Promise.reject(new Error('already listed'))),
      removeEmbedSite: vi.fn(() => Promise.reject(new Error('not found'))),
    });
    const told = events();
    const list = new EmbedSiteList(kernel, 'acme', told);
    await list.load();
    expect(told.announce).toHaveBeenLastCalledWith('The sites cannot be read: Forbidden', true);
    expect(await list.add('https://www.example.org')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not added: already listed', true);
    await list.remove(SITE);
    expect(told.announce).toHaveBeenLastCalledWith('Not removed: not found', true);

    const quiet = events();
    for (const empty of [
      new EmbedSiteList(undefined, 'acme', quiet),
      new EmbedSiteList(kernel, undefined, quiet),
    ]) {
      await empty.load();
      expect(await empty.add('https://www.example.org')).toBe(false);
      await empty.remove(SITE);
    }
    expect(quiet.announce).not.toHaveBeenCalled();
  });

  it('calls the endpoints of the organization', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, [SITE])),
    );
    const kernel = new KernelClient(fetchMock, undefined);
    await kernel.embedSites('acme');
    fetchMock.mockResolvedValueOnce(json(201, SITE));
    await kernel.addEmbedSite('acme', 'https://www.example.org');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await kernel.removeEmbedSite('acme', 'https://www.example.org');
    const calls = fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? ''} ${path}`);
    expect(calls).toEqual([
      'GET /api/v1/organizations/acme/embed-sites',
      'POST /api/v1/organizations/acme/embed-sites',
      'DELETE /api/v1/organizations/acme/embed-sites?origin=https%3A%2F%2Fwww.example.org',
    ]);
  });
});
