// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { FrontendExtension } from '@mosaikit/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KernelClient, type DeclaredPermission } from '../src/api.js';
import { setLanguage, t } from '../src/i18n.js';
import { launcherEntries } from '../src/navigation.js';
import {
  allows,
  byExtension,
  requiredPermission,
  sourceLabel,
  sourcesLabel,
  toggled,
} from '../src/permissions.js';

const declared = (
  extension: string,
  name: string,
  extra: Partial<DeclaredPermission> = {},
): DeclaredPermission => ({
  id: `${extension}:${name}`,
  extension,
  extensionName: extension === 'dev.example.notes' ? 'Notes' : 'Dashboards',
  name,
  title: name,
  description: '',
  off: false,
  ...extra,
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  setLanguage('en');
});

describe('permissions in the console (MK-056)', () => {
  it('groups the permissions by extension, the apps after those of the manifest', () => {
    const groups = byExtension([
      declared('dev.example.notes', 'use-notes', { app: 'notes', title: 'Use Notes' }),
      declared('dev.example.notes', 'export-notes', {
        title: 'Export notes',
        description: 'Download every note.',
      }),
      declared('dev.example.dashboards', 'create-dashboard', { off: true }),
    ]);

    expect(groups.map((group) => group.name)).toEqual(['Dashboards', 'Notes']);
    expect(groups[0]?.off).toBe(true);
    expect(groups[1]?.permissions).toEqual([
      {
        id: 'dev.example.notes:export-notes',
        title: 'Export notes',
        description: 'Download every note.',
      },
      { id: 'dev.example.notes:use-notes', title: 'Use Notes', description: '', app: 'notes' },
    ]);
  });

  it('shows the texts of a permission in the language of the shell, when the manifest has them', () => {
    const permission = declared('dev.example.notes', 'export-notes', {
      title: 'Export notes',
      description: 'Download every note.',
      i18n: { it: { title: 'Esporta le note' } },
    });

    expect(byExtension([permission], 'it')[0]?.permissions[0]).toMatchObject({
      title: 'Esporta le note',
      description: 'Download every note.',
    });
    expect(byExtension([permission], 'en')[0]?.permissions[0]?.title).toBe('Export notes');
  });

  it('names where a permission comes from, in every language of the shell', () => {
    const sources = [
      { kind: 'profile', id: 'p', name: 'Builders' },
      { kind: 'team', id: 't', name: 'Roads' },
      { kind: 'exception' },
      { kind: 'administrator' },
    ] as const;

    expect(sourcesLabel(sources)).toBe(
      'Profile Builders, Team Roads, Personal exception, Administrator of the organization',
    );
    setLanguage('it');
    expect(sourcesLabel(sources)).toBe(
      "Profilo Builders, Team Roads, Eccezione personale, Amministratore dell'organizzazione",
    );
    expect(sourceLabel({ kind: 'other' } as never)).toBe('other');
  });

  it('switches a permission on and off in a list, without repeating it', () => {
    expect(toggled(['b', 'a'], 'c', true)).toEqual(['a', 'b', 'c']);
    expect(toggled(['a', 'b'], 'a', true)).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a', false)).toEqual(['b']);
  });

  it('translates every text of the console into Italian', () => {
    setLanguage('it');
    for (const text of [
      'Permissions',
      'Profiles',
      'People',
      'Teams',
      'New profile',
      'Personal exceptions',
      'What they can do',
      'Invite a person',
      'What they will be able to do',
      'Who holds its permission',
      'No active extension declares permissions.',
    ]) {
      expect(t(text), text).not.toBe(text);
    }
  });
});

describe('hiding what the person lacks (MK-056)', () => {
  const extension: FrontendExtension = {
    id: 'dev.example.notes',
    version: '1.0.0',
    entry: '/index.js',
    isolation: 'module',
    contributions: [
      {
        point: 'rail.app',
        id: 'notes',
        attributes: { route: '/app/notes', element: 'mk-notes', permission: 'read-notes' },
      },
      { point: 'rail.app', id: 'board', attributes: { route: '/app/board', element: 'mk-board' } },
    ],
  };

  it('reads the permission a contribution needs, by name or qualified', () => {
    expect(requiredPermission({ extensionId: 'dev.example.notes', attributes: {} })).toBe(
      undefined,
    );
    expect(
      requiredPermission({ extensionId: 'dev.example.notes', attributes: { permission: 'x' } }),
    ).toBe('dev.example.notes:x');
    expect(
      requiredPermission({
        extensionId: 'dev.example.notes',
        attributes: { permission: 'dev.example.other:y' },
      }),
    ).toBe('dev.example.other:y');
    expect(
      requiredPermission({ extensionId: 'dev.example.notes', attributes: { permission: ' ' } }),
    ).toBe(undefined);
  });

  it('carries the permission of an app into the app bar, and allows it only to who holds it', () => {
    const entries = launcherEntries([extension], 'en');
    const notes = entries.find((entry) => entry.id === 'notes');
    const board = entries.find((entry) => entry.id === 'board');

    expect(notes?.permission).toBe('dev.example.notes:read-notes');
    expect(board?.permission).toBeUndefined();
    expect(allows(new Set(), notes?.permission)).toBe(false);
    expect(allows(new Set(['dev.example.notes:read-notes']), notes?.permission)).toBe(true);
    expect(allows(new Set(), board?.permission)).toBe(true);
    // Unknown permissions hide nothing: the backend refuses anyway.
    expect(allows(undefined, notes?.permission)).toBe(true);
  });
});

describe('KernelClient permissions (MK-056)', () => {
  it('calls the API of permissions, members and teams of the organization', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(
      (_path, init) =>
        Promise.resolve(
          init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, []),
        ),
    );
    const client = new KernelClient(fetchMock);
    const draft = { name: 'Builders', description: '', defaultForRole: null, permissions: [] };

    await client.shellPermissions();
    await client.declaredPermissions('acme');
    await client.permissionProfiles('acme');
    await client.createProfile('acme', draft);
    await client.changeProfile('acme', 'p1', draft);
    await expect(client.deleteProfile('acme', 'p1')).resolves.toBeUndefined();
    await client.memberPermissions('acme', 'ada@example.org');
    await client.assignProfile('acme', 'ada@example.org', null);
    await client.setException('acme', 'ada@example.org', 'dev.example.notes:export-notes', true);
    await client.setException('acme', 'ada@example.org', 'dev.example.notes:export-notes', false);
    await client.teamPermissions('acme', 't1');
    await client.setTeamPermission('acme', 't1', 'dev.example.notes:export-notes', true);
    await client.setTeamPermission('acme', 't1', 'dev.example.notes:export-notes', false);
    await client.previewPermissions('acme', {
      role: 'organization-user',
      profile: null,
      teams: ['t1'],
    });
    await client.organizationMembers('acme');
    await client.invite('acme', 'bea@example.org', {
      roles: ['organization-user'],
      profile: 'p1',
      teams: ['t1'],
    });
    await client.teams();

    const base = '/api/v1/organizations/acme';
    const permission = 'dev.example.notes%3Aexport-notes';
    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([
      ['/api/v1/shell/permissions', 'GET'],
      [`${base}/permissions`, 'GET'],
      [`${base}/permissions/profiles`, 'GET'],
      [`${base}/permissions/profiles`, 'POST'],
      [`${base}/permissions/profiles/p1`, 'PUT'],
      [`${base}/permissions/profiles/p1`, 'DELETE'],
      [`${base}/permissions/members/ada%40example.org`, 'GET'],
      [`${base}/permissions/members/ada%40example.org/profile`, 'PUT'],
      [`${base}/permissions/members/ada%40example.org/exceptions/${permission}`, 'PUT'],
      [`${base}/permissions/members/ada%40example.org/exceptions/${permission}`, 'DELETE'],
      [`${base}/permissions/teams/t1`, 'GET'],
      [`${base}/permissions/teams/t1/${permission}`, 'PUT'],
      [`${base}/permissions/teams/t1/${permission}`, 'DELETE'],
      [`${base}/permissions/preview`, 'POST'],
      [`${base}/members`, 'GET'],
      [`${base}/members/bea%40example.org`, 'PUT'],
      ['/api/v1/teams', 'GET'],
    ]);
    expect(fetchMock.mock.calls[7]?.[1]?.body).toBe(JSON.stringify({ profile: null }));
    expect(fetchMock.mock.calls[15]?.[1]?.body).toBe(
      JSON.stringify({ roles: ['organization-user'], profile: 'p1', teams: ['t1'] }),
    );
  });
});
