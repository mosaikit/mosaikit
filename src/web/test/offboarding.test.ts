// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import type { OrganizationMember } from '../src/api.js';
import {
  Offboarding,
  OffboardingApi,
  heirs,
  ownedCount,
  type OwnedByExtension,
} from '../src/offboarding.js';

type Request = (path: string, init?: RequestInit) => Promise<Response>;

const OWNED: OwnedByExtension[] = [
  {
    extension: 'org.example.drive',
    extensionName: 'Drive',
    resources: [
      {
        type: 'folder',
        typeTitle: 'Folder',
        id: 'f1',
        title: 'Plans',
        link: '/app/drive/f1',
        trashed: false,
      },
      {
        type: 'file',
        typeTitle: 'File',
        id: 'd1',
        title: 'Budget',
        link: '/app/drive/d1',
        trashed: true,
      },
    ],
  },
  {
    extension: 'org.example.notes',
    extensionName: 'Notes',
    resources: [
      {
        type: 'note',
        typeTitle: 'Note',
        id: 'n1',
        title: 'Minutes',
        link: '/app/notes/n1',
        trashed: false,
      },
    ],
  },
];

function member(username: string, roles: string[]): OrganizationMember {
  return { accountId: username, username, displayName: username, roles };
}

function answer(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
}

describe('offboarding a member (MK-071)', () => {
  it('71.1 reads what the member owns, per extension, before the removal', async () => {
    const request = vi.fn<Request>(() => answer(OWNED));
    const told = events();
    const offboarding = new Offboarding(
      new OffboardingApi(request),
      'acme',
      'ada@example.org',
      told,
    );

    expect(await offboarding.load()).toBe(true);

    expect(request).toHaveBeenCalledWith(
      '/api/v1/organizations/acme/members/ada%40example.org/resources',
    );
    expect(offboarding.owned).toEqual(OWNED);
    expect(ownedCount(OWNED)).toBe(3);
    expect(told.changed).toHaveBeenCalled();
    // Nobody chosen yet: the removal waits.
    expect(offboarding.ready).toBe(false);
  });

  it('71.1 tells when what the member owns cannot be read', async () => {
    const told = events();
    const offboarding = new Offboarding(
      new OffboardingApi(() => answer({ title: 'Forbidden', detail: 'No.' }, 403)),
      'acme',
      'ada@example.org',
      told,
    );
    expect(await offboarding.load()).toBe(false);
    expect(told.announce).toHaveBeenCalledWith(
      'What ada@example.org owns cannot be read: No.',
      true,
    );
    expect(await offboarding.remove()).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Choose who takes over what they own.', true);
  });

  it('71.2 offers the other members who are not guests as new owners', () => {
    const members = [
      member('ada@example.org', ['organization-user']),
      member('bea@example.org', ['organization-user']),
      member('cleo@example.org', ['organization-admin']),
      member('dan@example.org', ['organization-guest']),
    ];
    expect(heirs(members, 'ada@example.org').map((found) => found.username)).toEqual([
      'bea@example.org',
      'cleo@example.org',
    ]);
  });

  it('71.2 removes the member giving what they own to the one chosen', async () => {
    const request = vi.fn<Request>((path: string) =>
      path.endsWith('/resources') ? answer(OWNED) : answer(undefined, 204),
    );
    const told = events();
    const offboarding = new Offboarding(
      new OffboardingApi(request),
      'acme',
      'ada@example.org',
      told,
    );
    await offboarding.load();
    offboarding.heir = 'bea@example.org';

    expect(offboarding.ready).toBe(true);
    expect(await offboarding.remove()).toBe(true);

    expect(request).toHaveBeenLastCalledWith(
      '/api/v1/organizations/acme/members/ada%40example.org?transferTo=bea%40example.org',
      { method: 'DELETE' },
    );
    expect(told.announce).toHaveBeenLastCalledWith(
      'ada@example.org was removed; bea@example.org owns their 3 resources.',
      false,
    );
  });

  it('71.2 removes a member who owns nothing without a new owner, and tells a refusal', async () => {
    const request = vi.fn<Request>((path: string, init?: RequestInit) =>
      path.endsWith('/resources')
        ? answer([])
        : init?.method === 'DELETE' && path.includes('dan')
          ? answer({ title: 'Conflict', detail: 'Refused.' }, 409)
          : answer(undefined, 204),
    );
    const told = events();
    const offboarding = new Offboarding(
      new OffboardingApi(request),
      'acme',
      'bea@example.org',
      told,
    );
    await offboarding.load();
    expect(offboarding.ready).toBe(true);
    expect(await offboarding.remove()).toBe(true);
    expect(request).toHaveBeenLastCalledWith(
      '/api/v1/organizations/acme/members/bea%40example.org',
      {
        method: 'DELETE',
      },
    );
    expect(told.announce).toHaveBeenLastCalledWith('bea@example.org was removed.', false);

    const refused = new Offboarding(new OffboardingApi(request), 'acme', 'dan@example.org', told);
    await refused.load();
    expect(await refused.remove()).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not removed: Refused.', true);
  });
});
