// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { type AllowedOrigin, type ContentSecurityPolicy, KernelClient } from '../src/api.js';
import { OriginList, describeOrigin, looksLikeOrigin } from '../src/origins.js';

const CONFIGURED: AllowedOrigin = {
  origin: 'https://basemaps.example.org',
  source: 'CONFIGURATION',
  addedAt: null,
  addedBy: null,
};
const TILES: AllowedOrigin = {
  origin: 'https://tiles.example.org',
  source: 'ADMINISTRATION',
  addedAt: '2026-10-13T08:00:00Z',
  addedBy: 'admin',
};
const POLICY: ContentSecurityPolicy = {
  enabled: true,
  policy: "default-src 'self'",
  origins: [CONFIGURED, TILES],
};

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
}

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    contentSecurityPolicy: vi.fn(() => Promise.resolve(POLICY)),
    allowOrigin: vi.fn((origin: string) => Promise.resolve({ ...TILES, origin })),
    disallowOrigin: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('the external origins of the content security policy (MK-128)', () => {
  it('accepts a scheme, a host and a port only', () => {
    for (const origin of [
      'https://tiles.example.org',
      'https://tiles.example.org:8443/',
      'wss://live.example.org',
      'http://10.0.0.5:8080',
      'https://*.tiles.example.org',
    ]) {
      expect(looksLikeOrigin(origin), origin).toBe(true);
    }
    for (const origin of [
      '*',
      'https://*',
      'https://*.org',
      'https:',
      'data:',
      'https://tiles.example.org/wmts',
      "https://tiles.example.org 'unsafe-inline'",
      'ftp://tiles.example.org',
      'https://a.*.example.org',
      '',
    ]) {
      expect(looksLikeOrigin(origin), origin).toBe(false);
    }
  });

  it('says where an origin comes from', () => {
    expect(describeOrigin(CONFIGURED, (iso) => iso)).toBe(
      'Set in the configuration of the installation',
    );
    expect(describeOrigin(TILES, (iso) => iso)).toBe('2026-10-13T08:00:00Z by admin');
    expect(describeOrigin({ ...TILES, addedAt: null, addedBy: null }, (iso) => iso)).toBe(' by ');
  });

  it('reads, allows and removes origins', async () => {
    const kernel = client();
    const told = events();
    const list = new OriginList(kernel, told);

    await list.load();
    expect(list.policy).toEqual(POLICY);

    expect(await list.allow(' https://data.example.org ')).toBe(true);
    expect(kernel.allowOrigin).toHaveBeenCalledWith('https://data.example.org');
    expect(told.announce).toHaveBeenLastCalledWith('https://data.example.org allowed.', false);

    expect(await list.allow('https://data.example.org/path')).toBe(false);
    expect(kernel.allowOrigin).toHaveBeenCalledTimes(1);
    expect(told.announce.mock.lastCall?.[1]).toBe(true);

    await list.remove(CONFIGURED);
    expect(kernel.disallowOrigin).not.toHaveBeenCalled();
    await list.remove(TILES);
    expect(kernel.disallowOrigin).toHaveBeenCalledWith('https://tiles.example.org');
    expect(told.announce).toHaveBeenLastCalledWith('https://tiles.example.org removed.', false);
  });

  it('tells what went wrong', async () => {
    const kernel = client({
      contentSecurityPolicy: vi.fn(() => Promise.reject(new Error('Forbidden'))),
      allowOrigin: vi.fn(() => Promise.reject(new Error('already allowed'))),
      disallowOrigin: vi.fn(() => Promise.reject(new Error('not found'))),
    });
    const told = events();
    const list = new OriginList(kernel, told);

    await list.load();
    expect(told.announce).toHaveBeenLastCalledWith('The origins cannot be read: Forbidden', true);
    expect(await list.allow('https://tiles.example.org')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not allowed: already allowed', true);
    await list.remove(TILES);
    expect(told.announce).toHaveBeenLastCalledWith('Not removed: not found', true);
  });

  it('does nothing without a client', async () => {
    const told = events();
    const list = new OriginList(undefined, told);
    await list.load();
    expect(await list.allow('https://tiles.example.org')).toBe(false);
    await list.remove(TILES);
    expect(told.announce).not.toHaveBeenCalled();
  });

  it('calls the endpoints of the platform', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify(TILES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const kernel = new KernelClient(fetchMock, undefined);

    await kernel.contentSecurityPolicy();
    await kernel.allowOrigin('https://tiles.example.org');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await kernel.disallowOrigin('https://tiles.example.org');

    const calls = fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? ''} ${path}`);
    expect(calls).toEqual([
      'GET /api/v1/platform/content-security-policy',
      'POST /api/v1/platform/content-security-policy/origins',
      'DELETE /api/v1/platform/content-security-policy/origins?origin=https%3A%2F%2Ftiles.example.org',
    ]);
  });
});
