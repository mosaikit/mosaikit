// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { KernelClient, type PeoplePage, type PlatformPerson } from '../src/api.js';
import { PAGE_SIZE, PeopleDirectory, organizationsOf } from '../src/people.js';

const ROBIN: PlatformPerson = {
  accountId: '00000000-0000-0000-0000-000000000001',
  username: 'robin@example.org',
  displayName: 'Robin Green',
  suspended: false,
  suspendedAt: null,
  suspendedBy: null,
  reason: null,
  createdAt: '2026-10-01T08:00:00Z',
  platformAdmin: false,
  password: true,
  organizations: [
    {
      slug: 'acme',
      name: 'Acme',
      roles: ['organization-admin', 'organization-user'],
      suspended: false,
    },
    { slug: 'green', name: 'Green', roles: ['organization-user'], suspended: true },
  ],
};

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
}

function page(total: number, people: readonly PlatformPerson[] = [ROBIN]): PeoplePage {
  return { total, people };
}

describe('the people of the installation in the console (MK-072)', () => {
  it('names their organizations and where they administer', () => {
    expect(organizationsOf(ROBIN)).toBe('Acme (administrator), Green');
    expect(organizationsOf({ ...ROBIN, organizations: [] })).toBe('');
  });

  it('reads a page and the totals, and counts them on top', async () => {
    const people = vi.fn((query: { state?: string; limit?: number }) =>
      Promise.resolve(
        query.limit === 1 ? page(query.state === 'suspended' ? 3 : 120, []) : page(1),
      ),
    );
    const told = events();
    const directory = new PeopleDirectory({ people }, told);

    expect(directory.metrics()).toEqual([]);
    await directory.filter('robin', 'active');

    expect(people).toHaveBeenCalledWith({
      search: 'robin',
      state: 'active',
      offset: 0,
      limit: PAGE_SIZE,
    });
    expect(directory.people).toEqual([ROBIN]);
    expect(directory.metrics().map((metric) => [metric.label, metric.value])).toEqual([
      ['People', '120'],
      ['Active', '117'],
      ['Suspended', '3'],
      ['Found', '1'],
    ]);
    expect(directory.metrics()[2]?.tone).toBe('warn');
    expect(told.changed).toHaveBeenCalled();
  });

  it('pages through them', async () => {
    const people = vi.fn(() => Promise.resolve(page(120)));
    const directory = new PeopleDirectory({ people }, events());
    await directory.load();

    expect(directory.hasPrevious).toBe(false);
    expect(directory.hasNext).toBe(true);
    await directory.page(1);
    await directory.page(1);
    expect(directory.offset).toBe(100);
    expect(directory.hasNext).toBe(false);
    expect(directory.hasPrevious).toBe(true);
    await directory.page(-1);
    expect(directory.offset).toBe(50);
    await directory.filter('', 'all');
    expect(directory.offset).toBe(0);
  });

  it('says when they cannot be read, and does nothing without a kernel', async () => {
    const told = events();
    const directory = new PeopleDirectory(
      { people: vi.fn(() => Promise.reject(new Error('Forbidden'))) },
      told,
    );
    await directory.load();
    expect(told.announce).toHaveBeenLastCalledWith('The people cannot be read: Forbidden', true);

    const idle = new PeopleDirectory(undefined, told);
    await idle.load();
    expect(idle.people).toBeUndefined();
  });

  it('asks the kernel with the search, the state and the page', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify(page(1)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const kernel = new KernelClient(fetchMock, undefined);

    await kernel.people({});
    await kernel.people({ search: ' robin green ', state: 'suspended', offset: 50, limit: 50 });
    await kernel.people({ state: 'all' });
    await kernel.consoleOverview();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/platform/accounts',
      '/api/v1/platform/accounts?search=robin+green&state=suspended&offset=50&limit=50',
      '/api/v1/platform/accounts',
      '/api/v1/platform/console',
    ]);
  });
});
