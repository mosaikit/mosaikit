// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { KernelClient } from '../src/api.js';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const memory = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> => ({
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

describe('KernelClient favorites (MK-094)', () => {
  it('reads the favorites of the person and removes one', async () => {
    const favorite = {
      extension: 'dev.example.notes',
      type: 'memo',
      id: 'm 1',
      status: 'available',
      title: 'Budget',
      link: '/app/notes?memo=m-1',
      markedAt: '2026-10-15T08:00:00Z',
    };
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>((path) =>
      Promise.resolve(
        path === '/api/v1/favorites' ? json(200, [favorite]) : new Response(null, { status: 204 }),
      ),
    );
    const client = new KernelClient(fetchMock, memory());

    expect(await client.favorites()).toEqual([favorite]);
    await client.removeFavorite(favorite);

    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([
      ['/api/v1/favorites', 'GET'],
      ['/api/v1/favorites/dev.example.notes/memo/m%201', 'DELETE'],
    ]);
  });
});
