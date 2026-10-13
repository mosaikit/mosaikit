// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KernelClient, type Quota, type QuotaUsage } from '../src/api.js';
import { setLanguage } from '../src/i18n.js';
import {
  QuotaBoard,
  formatAmount,
  limitLabel,
  parseLimit,
  periodLabel,
  personLabel,
  share,
  sourceLabel,
} from '../src/quotas.js';

const STORAGE: Quota = {
  measure: 'storage',
  label: 'Storage',
  unit: 'bytes',
  kind: 'gauge',
  extension: null,
  limit: 10 * 1024 ** 3,
  source: 'installation',
  installationLimit: 10 * 1024 ** 3,
  period: null,
  used: 1536 * 1024 ** 2,
};
const RENDERS: Quota = {
  measure: 'org.example.maps/renders',
  label: 'Renders',
  unit: 'renders',
  kind: 'counter',
  extension: 'org.example.maps',
  limit: null,
  source: 'none',
  installationLimit: null,
  period: '2026-10',
  used: 12,
};
const USAGE: QuotaUsage = {
  period: '2026-10',
  periods: ['2026-09', '2026-10'],
  rows: [
    {
      measure: 'storage',
      period: null,
      person: { id: 'a', name: 'Ada', email: 'ada@example.org' },
      amount: 2048,
      updatedAt: '2026-10-13T08:00:00Z',
    },
    {
      measure: 'org.example.maps/renders',
      period: '2026-10',
      person: null,
      amount: 12,
      updatedAt: null,
    },
  ],
};

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
}

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    quotas: vi.fn(() => Promise.resolve([STORAGE, RENDERS])),
    quotaUsage: vi.fn(() => Promise.resolve(USAGE)),
    setQuota: vi.fn((_slug: string, measure: string, limit: number | null) =>
      Promise.resolve({
        ...(measure === 'storage' ? STORAGE : RENDERS),
        limit,
        source: 'organization' as const,
      }),
    ),
    removeQuota: vi.fn(() => Promise.resolve({ ...STORAGE, source: 'installation' as const })),
    ...overrides,
  };
}

describe('the quotas of the organization (MK-076)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('shows amounts in the unit of their measure', () => {
    expect(formatAmount(1023, 'bytes')).toBe('1023 bytes');
    expect(formatAmount(1024, 'bytes')).toBe('1 KB');
    expect(formatAmount(1536 * 1024 ** 2, 'bytes')).toBe('1.5 GB');
    expect(formatAmount(12, 'renders')).toBe('12 renders');
    expect(formatAmount(5, '')).toBe('5');
  });

  it('says what a limit is, where it comes from and how much of it is used', () => {
    expect(limitLabel(STORAGE)).toBe('10 GB');
    expect(limitLabel({ ...RENDERS, limit: 1000 })).toBe('1000 renders a month');
    expect(limitLabel(RENDERS)).toBe('No limit');
    expect(sourceLabel('organization')).toBe('Set for this organization');
    expect(sourceLabel('installation')).toBe('Default of the platform');
    expect(sourceLabel('none')).toBe('No limit');
    expect(share(STORAGE)).toBe(15);
    expect(share(RENDERS)).toBeUndefined();
    expect(share({ limit: 0, used: 0 })).toBe(0);
    expect(share({ limit: 0, used: 1 })).toBe(100);
    expect(share({ limit: 10, used: 30 })).toBe(100);
  });

  it('names the people and periods of the consumption', () => {
    expect(personLabel({ person: { id: 'a', name: 'Ada', email: 'ada@example.org' } })).toBe('Ada');
    expect(personLabel({ person: { id: 'b', name: null, email: 'bea@example.org' } })).toBe(
      'bea@example.org',
    );
    expect(personLabel({ person: { id: 'c', name: null, email: null } })).toBe('A person who left');
    expect(personLabel({ person: null })).toBe('Nobody in particular');
    expect(periodLabel('2026-10')).toBe('2026-10');
    expect(periodLabel(null)).toBe('Now');
    setLanguage('it');
    expect(periodLabel(null)).toBe('Adesso');
    expect(limitLabel({ ...RENDERS, limit: 5 })).toBe('5 renders al mese');
  });

  it('reads the limits that platform administrators type', () => {
    expect(parseLimit('', 'bytes')).toBeNull();
    expect(parseLimit(' 1000 ', 'calls')).toBe(1000);
    expect(parseLimit('500M', 'bytes')).toBe(500 * 1024 ** 2);
    expect(parseLimit('10g', 'bytes')).toBe(10 * 1024 ** 3);
    expect(parseLimit('2KB', 'bytes')).toBe(2048);
    expect(parseLimit('10G', 'calls')).toBeUndefined();
    expect(parseLimit('-1', 'calls')).toBeUndefined();
    expect(parseLimit('1.5', 'calls')).toBeUndefined();
    expect(parseLimit('99999999999999999999', 'calls')).toBeUndefined();
  });

  it('reads the measures and the consumption of a month', async () => {
    const kernel = client();
    const listener = events();
    const board = new QuotaBoard(kernel, 'acme', listener);
    await board.load('2026-09');

    expect(kernel.quotas).toHaveBeenCalledWith('acme');
    expect(kernel.quotaUsage).toHaveBeenCalledWith('acme', '2026-09');
    expect(board.quotas).toEqual([STORAGE, RENDERS]);
    expect(board.measure('storage')).toBe(STORAGE);
    expect(board.rowsOf('storage')).toHaveLength(1);
    expect(board.periods()).toEqual(['2026-10', '2026-09']);
    expect(listener.changed).toHaveBeenCalled();
  });

  it('says when the quotas cannot be read, and does nothing without an organization', async () => {
    const listener = events();
    await new QuotaBoard(
      client({ quotas: vi.fn(() => Promise.reject(new Error('offline'))) }),
      'acme',
      listener,
    ).load();
    expect(listener.announce).toHaveBeenCalledWith('The quotas cannot be read: offline', true);

    const none = new QuotaBoard(undefined, 'acme', events());
    await none.load();
    expect(none.quotas).toBeUndefined();
    expect(none.periods()).toEqual([]);
    expect(await none.setLimit(STORAGE, '1G')).toBe(false);
    await none.removeLimit(STORAGE);
  });

  it('sets and removes a limit of the organization', async () => {
    const kernel = client();
    const listener = events();
    const board = new QuotaBoard(kernel, 'acme', listener);
    await board.load();

    expect(await board.setLimit(STORAGE, '20G')).toBe(true);
    expect(kernel.setQuota).toHaveBeenCalledWith('acme', 'storage', 20 * 1024 ** 3);
    expect(board.measure('storage')?.source).toBe('organization');
    expect(listener.announce).toHaveBeenLastCalledWith('Limit of Storage set: 20 GB.', false);

    expect(await board.setLimit(RENDERS, '')).toBe(true);
    expect(kernel.setQuota).toHaveBeenLastCalledWith('acme', 'org.example.maps/renders', null);

    await board.removeLimit(STORAGE);
    expect(kernel.removeQuota).toHaveBeenCalledWith('acme', 'storage');
    expect(board.measure('storage')?.source).toBe('installation');
    expect(listener.announce).toHaveBeenLastCalledWith(
      'Limit of Storage: 10 GB, the default of the platform.',
      false,
    );
  });

  it('refuses a limit that is not one, and says when the kernel refuses', async () => {
    const listener = events();
    const failing = client({
      setQuota: vi.fn(() => Promise.reject(new Error('forbidden'))),
      removeQuota: vi.fn(() => Promise.reject(new Error('forbidden'))),
    });
    const board = new QuotaBoard(failing, 'acme', listener);
    await board.load();

    expect(await board.setLimit(STORAGE, 'lots')).toBe(false);
    expect(listener.announce).toHaveBeenLastCalledWith(
      'Write a number of bytes, or a size such as 500M or 10G; empty for no limit.',
      true,
    );
    expect(await board.setLimit(RENDERS, '1G')).toBe(false);
    expect(listener.announce).toHaveBeenLastCalledWith(
      'Write a whole number; empty for no limit.',
      true,
    );
    expect(failing.setQuota).not.toHaveBeenCalled();

    expect(await board.setLimit(RENDERS, '10')).toBe(false);
    expect(listener.announce).toHaveBeenLastCalledWith('Not saved: forbidden', true);
    await board.removeLimit(STORAGE);
    expect(listener.announce).toHaveBeenLastCalledWith('Not saved: forbidden', true);
  });

  it('calls the API of quotas', async () => {
    const fetcher = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify([STORAGE]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const values = new Map<string, string>();
    const kernel = new KernelClient(fetcher, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    });
    await kernel.quotas('acme');
    await kernel.quotaUsage('acme');
    await kernel.quotaUsage('acme', '2026-09');
    await kernel.setQuota('acme', 'org.example.maps/renders', 5);
    await kernel.removeQuota('acme', 'storage');
    const calls = fetcher.mock.calls.map(([input, init]) => `${init?.method ?? 'GET'} ${input}`);
    expect(calls).toEqual([
      'GET /api/v1/organizations/acme/quotas',
      'GET /api/v1/organizations/acme/quotas/usage',
      'GET /api/v1/organizations/acme/quotas/usage?period=2026-09',
      'PUT /api/v1/organizations/acme/quotas/org.example.maps/renders',
      'DELETE /api/v1/organizations/acme/quotas/storage',
    ]);
    expect(fetcher.mock.calls[3]?.[1]?.body).toBe('{"limit":5}');
  });
});
