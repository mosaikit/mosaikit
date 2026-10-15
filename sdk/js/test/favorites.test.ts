// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import {
  FAVORITES_PATH,
  isFavorite,
  listFavorites,
  markFavorite,
  unmarkFavorite,
  type Favorite,
} from '../src/index.js';

const MAPS = 'org.example.ext.maps';
const FAVORITE: Favorite = {
  extension: MAPS,
  type: 'map',
  id: 'm 1',
  status: 'available',
  title: 'Rivers',
  link: '/app/maps/m1',
  markedAt: '2026-10-15T08:00:00Z',
};

function answering(status: number, body?: unknown) {
  return vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

const context = (fetch: ReturnType<typeof answering>) => ({
  fetch,
  extension: { id: MAPS, version: '1.0.0' },
});

describe('MK-094 Favorites across extensions', () => {
  it('lists the favorites of every extension', async () => {
    const fetch = answering(200, [FAVORITE]);
    expect(await listFavorites({ fetch })).toEqual([FAVORITE]);
    expect(fetch).toHaveBeenCalledWith(FAVORITES_PATH);
    await expect(listFavorites({ fetch: answering(500) })).rejects.toThrow('(500)');
  });

  it('marks and removes a resource of the extension', async () => {
    const mark = answering(200, FAVORITE);
    expect(await markFavorite(context(mark), 'map', 'm 1')).toEqual(FAVORITE);
    expect(mark).toHaveBeenCalledWith(`${FAVORITES_PATH}/${MAPS}/map/m%201`, { method: 'PUT' });
    await expect(markFavorite(context(answering(404)), 'map', 'm1')).rejects.toThrow('(404)');

    const unmark = answering(204);
    await unmarkFavorite(context(unmark), 'map', 'm 1');
    expect(unmark).toHaveBeenCalledWith(`${FAVORITES_PATH}/${MAPS}/map/m%201`, {
      method: 'DELETE',
    });
    await expect(unmarkFavorite(context(answering(400)), 'map', 'm1')).rejects.toThrow('(400)');
  });

  it('tells whether a resource of the extension is a favorite', async () => {
    const fetch = answering(200, FAVORITE);
    expect(await isFavorite(context(fetch), 'map', 'm1')).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`${FAVORITES_PATH}/${MAPS}/map/m1`);
    expect(await isFavorite(context(answering(404)), 'map', 'm1')).toBe(false);
    await expect(isFavorite(context(answering(500)), 'map', 'm1')).rejects.toThrow('(500)');
  });
});
