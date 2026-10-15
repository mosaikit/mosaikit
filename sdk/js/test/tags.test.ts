// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeTag,
  replaceTags,
  resourceTags,
  suggestTags,
  taggedResources,
} from '../src/index.js';

const extension = { id: 'dev.example.dashboards', version: '1.0.0' };

function answering(status: number, body?: unknown) {
  return vi.fn((_path: string, _init?: RequestInit) =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
}

describe('tags of resources from an extension frontend (MK-097)', () => {
  it('shows a tag as the kernel keeps it', () => {
    expect(normalizeTag('  Spring   PLANS ')).toBe('spring plans');
  });

  it('reads and replaces the tags of a resource of the extension', async () => {
    const read = answering(200, ['garden', 'roses']);
    expect(await resourceTags({ fetch: read, extension }, 'dashboard', 'a/b')).toEqual([
      'garden',
      'roses',
    ]);
    expect(read).toHaveBeenCalledWith(
      '/api/v1/resources/tags/dev.example.dashboards/dashboard/a%2Fb',
    );

    const replace = answering(200, ['garden']);
    expect(await replaceTags({ fetch: replace, extension }, 'dashboard', '42', ['Garden'])).toEqual([
      'garden',
    ]);
    const [path, init] = replace.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/resources/tags/dev.example.dashboards/dashboard/42');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('["Garden"]');

    await expect(
      replaceTags({ fetch: answering(403), extension }, 'dashboard', '42', []),
    ).rejects.toThrow('(403)');
  });

  it('suggests the tags of the organization while the person types', async () => {
    const fetch = answering(200, ['garden', 'gardening']);
    expect(await suggestTags({ fetch }, 'gar')).toEqual(['garden', 'gardening']);
    expect(fetch).toHaveBeenCalledWith('/api/v1/resources/tags/suggestions?prefix=gar&limit=10');
    await expect(suggestTags({ fetch: answering(500) }, 'g', 3)).rejects.toThrow('(500)');
  });

  it('finds the resources that carry any of the tags', async () => {
    const fetch = answering(200, ['1', '2']);
    expect(await taggedResources({ fetch, extension }, 'dashboard', ['garden', 'roses'])).toEqual([
      '1',
      '2',
    ]);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/resources/tags/dev.example.dashboards/dashboard?tag=garden&tag=roses',
    );
    const none = answering(200, []);
    expect(await taggedResources({ fetch: none, extension }, 'dashboard', [])).toEqual([]);
    expect(none).not.toHaveBeenCalled();
  });
});
