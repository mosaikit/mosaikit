// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KernelError } from '../src/api.js';
import { setLanguage } from '../src/i18n.js';
import {
  ShareDialogState,
  SharingApi,
  dateValue,
  day,
  defaultLinkDay,
  defineSharedView,
  expiryOf,
  levelTitle,
  levelsFor,
  linkAddress,
  linkRequest,
  openLink,
  resourceOf,
  subjectLabel,
  tokenOf,
  whoShares,
  type InheritedAccess,
  type SharedResource,
  type SharingGrant,
} from '../src/sharing.js';

const REF = { extension: 'dev.example.notes', type: 'memo', id: 'm-1' };

const RESOURCE: SharedResource = {
  resource: REF,
  title: 'Budget 2027',
  link: '/app/notes?memo=m-1',
  owner: 'a-1',
  ownerName: 'Ada Lovelace',
  level: 'manage',
  canShare: true,
  levels: [
    { name: 'view', title: 'View', edits: false, i18n: { it: { title: 'Lettura' } } },
    { name: 'use', title: 'Use', edits: false },
    { name: 'edit', title: 'Edit', edits: true },
    { name: 'manage', title: 'Manage', edits: true },
  ],
  subjects: ['person', 'group', 'organization', 'link', 'public'],
  linkLevel: 'use',
  linkMaxExpiry: '2026-11-12T10:00:00Z',
};

const GRANT: SharingGrant = {
  id: 'g-1',
  subject: { kind: 'person', id: 'b-1', name: 'Bea Rossi', email: 'bea@example.org' },
  level: 'view',
  grantedBy: 'a-1',
  granted: '2026-10-13T08:00:00Z',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = [string, RequestInit | undefined];

function requests(...answers: Response[]) {
  const calls: Call[] = [];
  const request = vi.fn((path: string, init?: RequestInit) => {
    calls.push([path, init]);
    return Promise.resolve(answers.shift() ?? json(500, {}));
  });
  return { request, calls };
}

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string) => void>() };
}

describe('the sharing dialog of the shell (MK-055)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('accepts only a well-formed resource from a frontend', () => {
    expect(resourceOf(REF)).toEqual(REF);
    expect(resourceOf({ ...REF, extra: 1 })).toEqual(REF);
    expect(resourceOf(null)).toBeUndefined();
    expect(resourceOf('memo')).toBeUndefined();
    expect(resourceOf({ ...REF, extension: 'Not An Id' })).toBeUndefined();
    expect(resourceOf({ ...REF, type: 'Memo' })).toBeUndefined();
    expect(resourceOf({ ...REF, id: '../x' })).toBeUndefined();
    expect(resourceOf({ ...REF, id: 7 })).toBeUndefined();
  });

  it('calls the REST API of sharing', async () => {
    const made = {
      grant: { ...GRANT, id: 'l-1', subject: { kind: 'link', id: 'l-1' } },
      address: '/shared/s',
      token: 's',
    };
    const { request, calls } = requests(
      json(200, RESOURCE),
      json(200, [GRANT]),
      json(200, GRANT),
      json(201, made),
      new Response(null, { status: 204 }),
      json(403, { title: 'Forbidden', detail: 'You may not share it.' }),
      new Response(null, { status: 404 }),
    );
    const api = new SharingApi(request);

    expect(await api.open(REF)).toEqual(RESOURCE);
    expect(await api.grants(REF)).toEqual([GRANT]);
    expect(await api.grant(REF, { kind: 'person', email: 'bea@example.org' }, 'view')).toEqual(
      GRANT,
    );
    expect(await api.createLink(REF, 'view', '2026-10-20T21:59:00Z', 'secret')).toEqual(made);
    await api.revoke('g-1');
    await expect(api.grants(REF)).rejects.toMatchObject({
      status: 403,
      message: 'You may not share it.',
    });
    await expect(api.revoke('g-2')).rejects.toBeInstanceOf(KernelError);

    const path = '/api/v1/sharing/resources/dev.example.notes/memo/m-1';
    expect(calls.map(([called]) => called)).toEqual([
      path,
      `${path}/grants`,
      `${path}/grants`,
      `${path}/links`,
      '/api/v1/sharing/grants/g-1',
      `${path}/grants`,
      '/api/v1/sharing/grants/g-2',
    ]);
    expect(calls[2]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(calls[2]?.[1]?.body as string)).toEqual({
      subject: { kind: 'person', email: 'bea@example.org' },
      level: 'view',
    });
    expect(JSON.parse(calls[3]?.[1]?.body as string)).toEqual({
      level: 'view',
      expires: '2026-10-20T21:59:00Z',
      password: 'secret',
    });
    expect(calls[4]?.[1]?.method).toBe('DELETE');
  });

  it('names levels and subjects in the language of the shell', () => {
    expect(levelTitle(RESOURCE.levels, 'view')).toBe('View');
    expect(levelTitle(RESOURCE.levels, 'own')).toBe('own');
    expect(subjectLabel(GRANT)).toBe('Bea Rossi');
    expect(subjectLabel({ ...GRANT, subject: { kind: 'person', email: 'bea@example.org' } })).toBe(
      'bea@example.org',
    );
    expect(subjectLabel({ ...GRANT, subject: { kind: 'person' } })).toBe('A person');
    expect(subjectLabel({ ...GRANT, subject: { kind: 'group', name: 'Roads' } })).toBe(
      'Team Roads',
    );
    expect(subjectLabel({ ...GRANT, subject: { kind: 'organization', name: 'Acme' } })).toBe(
      'Everyone in Acme',
    );
    expect(subjectLabel({ ...GRANT, subject: { kind: 'organization' } })).toBe(
      'Everyone in the organization',
    );
    expect(subjectLabel({ ...GRANT, subject: { kind: 'public' } })).toBe(
      'Everyone, also without an account',
    );
    expect(
      subjectLabel({ ...GRANT, subject: { kind: 'link' }, expires: 'soon', password: true }),
    ).toBe('Link with a password, until soon');
    expect(subjectLabel({ ...GRANT, subject: { kind: 'link' } })).toBe('Link, until ');
    setLanguage('it');
    expect(levelTitle(RESOURCE.levels, 'view')).toBe('Lettura');
    expect(levelTitle(RESOURCE.levels, 'use')).toBe('Use');
    expect(subjectLabel({ ...GRANT, subject: { kind: 'public' } })).toBe(
      'Chiunque, anche senza un account',
    );
  });

  it('offers each kind of subject the levels it may get, never above the own level', () => {
    const names = (kind: Parameters<typeof levelsFor>[1], resource = RESOURCE) =>
      levelsFor(resource, kind).map((level) => level.name);
    expect(names('person')).toEqual(['view', 'use', 'edit', 'manage']);
    expect(names('public')).toEqual(['view']);
    expect(names('link')).toEqual(['view', 'use']);
    expect(names('group', { ...RESOURCE, level: 'use' })).toEqual(['view', 'use']);
    expect(names('organization', { ...RESOURCE, level: 'unknown' })).toEqual([
      'view',
      'use',
      'edit',
      'manage',
    ]);
  });

  it('says who may share', () => {
    expect(whoShares(RESOURCE)).toBe(
      'Ada Lovelace, who owns it, the people with the level Manage and the administrators of the organization can share it.',
    );
    expect(whoShares({ ...RESOURCE, ownerName: null })).toBe(
      'The people with the level Manage and the administrators of the organization can share it.',
    );
  });

  it('turns a chosen day into the expiry of a link, within the longest validity', () => {
    const now = new Date(2026, 9, 13, 12, 0);
    expect(dateValue(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(expiryOf('2026-10-20', null, now)).toBe(new Date(2026, 9, 20, 23, 59).toISOString());
    expect(expiryOf('2026-12-31', '2026-11-12T10:00:00.000Z', now)).toBe(
      '2026-11-12T10:00:00.000Z',
    );
    expect(expiryOf('2026-10-12', null, now)).toBeUndefined();
    expect(expiryOf('tomorrow', null, now)).toBeUndefined();
    expect(defaultLinkDay(null, now)).toBe('2026-10-20');
    expect(defaultLinkDay(new Date(2026, 9, 15, 12).toISOString(), now)).toBe('2026-10-15');
    expect(day('not a date')).toBe('not a date');
    expect(day('2026-10-13T08:00:00Z')).not.toBe('2026-10-13T08:00:00Z');
  });

  it('builds and reads the address of a link', () => {
    expect(linkAddress('abc', 'https://acme.example.org')).toBe(
      'https://acme.example.org/shared/abc',
    );
    expect(tokenOf('/shared/abc')).toBe('abc');
    expect(tokenOf('/shared/abc/')).toBe('abc');
    expect(tokenOf('/shared/')).toBeUndefined();
    expect(tokenOf('/shared/a/b')).toBeUndefined();
    expect(tokenOf('/app/notes')).toBeUndefined();
  });

  it('opens a resource with its grants and teams, and shares, links and revokes', async () => {
    const link: SharingGrant = {
      ...GRANT,
      id: 'l-1',
      subject: { kind: 'link', id: 'l-1' },
      expires: '2026-10-20T21:59:00Z',
    };
    const api = {
      open: vi.fn(() => Promise.resolve(RESOURCE)),
      grants: vi.fn(() => Promise.resolve([GRANT])),
      inherited: vi.fn(() => Promise.resolve([])),
      grant: vi.fn(() => Promise.resolve({ ...GRANT, level: 'edit' })),
      createLink: vi.fn(() => Promise.resolve({ grant: link, address: '/shared/s', token: 's' })),
      revoke: vi.fn(() => Promise.resolve()),
    };
    const teams = vi.fn(() => Promise.resolve([{ id: 't-1', name: 'Roads' }]));
    const told = events();
    const dialog = new ShareDialogState(api, teams, told);

    await dialog.load(REF);
    expect(dialog.resource).toEqual(RESOURCE);
    expect(dialog.grants).toEqual([GRANT]);
    expect(dialog.teams).toEqual([{ id: 't-1', name: 'Roads' }]);
    expect(told.changed).toHaveBeenCalledTimes(1);

    expect(await dialog.share({ kind: 'person', email: 'bea@example.org' }, 'edit')).toBe(true);
    expect(dialog.grants).toEqual([{ ...GRANT, level: 'edit' }]);
    expect(told.announce).toHaveBeenLastCalledWith('Shared with Bea Rossi.');

    const tomorrow = dateValue(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
    expect(await dialog.createLink('view', tomorrow, 'secret')).toBe(true);
    expect(api.createLink).toHaveBeenCalledWith(REF, 'view', expect.any(String), 'secret');
    expect(dialog.madeLink?.token).toBe('s');
    expect(dialog.grants).toHaveLength(2);
    expect(await dialog.createLink('view', '2000-01-01', '')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Choose a day from tomorrow on.');

    await dialog.revoke(link);
    expect(api.revoke).toHaveBeenCalledWith('l-1');
    expect(dialog.madeLink).toBeUndefined();
    expect(dialog.grants).toEqual([{ ...GRANT, level: 'edit' }]);
    expect(told.announce).toHaveBeenLastCalledWith(expect.stringMatching(/^Access removed: Link/));
  });

  it('says what went wrong, and lists nothing to who may not share', async () => {
    const failing = {
      open: vi.fn(() => Promise.resolve({ ...RESOURCE, canShare: false, subjects: [] })),
      grants: vi.fn(() => Promise.resolve([])),
      inherited: vi.fn(() => Promise.resolve([])),
      grant: vi.fn(() => Promise.reject(new Error('refused'))),
      createLink: vi.fn(() => Promise.reject(new Error('too far'))),
      revoke: vi.fn(() => Promise.reject(new Error('gone'))),
    };
    const told = events();
    const dialog = new ShareDialogState(failing, () => Promise.resolve([]), told);

    expect(await dialog.share({ kind: 'organization' }, 'view')).toBe(false);
    expect(await dialog.createLink('view', '2030-01-01', '')).toBe(false);

    await dialog.load(REF);
    expect(failing.grants).not.toHaveBeenCalled();
    expect(failing.inherited).not.toHaveBeenCalled();
    expect(dialog.grants).toEqual([]);
    expect(await dialog.share({ kind: 'organization' }, 'view')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not shared: refused');
    expect(await dialog.createLink('view', dateValue(new Date(Date.now() + 172_800_000)), '')).toBe(
      false,
    );
    expect(told.announce).toHaveBeenLastCalledWith('The link was not made: too far');
    await dialog.revoke(GRANT);
    expect(told.announce).toHaveBeenLastCalledWith('The access was not removed: gone');

    failing.open.mockImplementationOnce(() =>
      Promise.reject(new KernelError(404, 'Not Found', 'No level')),
    );
    await dialog.load(REF);
    expect(dialog.failure).toBe('You have no access to this resource.');
    failing.open.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await dialog.load(REF);
    expect(dialog.failure).toBe('The sharing cannot be read: offline');
  });
});

describe('a link opened in the shell (MK-055)', () => {
  const ACCESS = {
    resource: REF,
    title: 'Budget 2027',
    link: '/app/notes?memo=m-1',
    level: 'view',
    expires: '2026-10-20T21:59:00Z',
  };

  it('opens a link, asks for its password, and answers not found when it no longer works', async () => {
    const { request, calls } = requests(
      json(200, ACCESS),
      json(403, {}),
      json(403, {}),
      new Response(null, { status: 404 }),
      json(500, { detail: 'broken' }),
    );
    expect(await openLink(request, 'abc')).toEqual({ kind: 'opened', access: ACCESS });
    expect(await openLink(request, 'abc')).toEqual({ kind: 'password', wrong: false });
    expect(await openLink(request, 'abc', 'wrong')).toEqual({ kind: 'password', wrong: true });
    expect(await openLink(request, 'abc')).toEqual({ kind: 'not-found' });
    expect(await openLink(request, 'abc')).toEqual({ kind: 'failed', reason: 'broken' });
    expect(calls[0]?.[0]).toBe('/api/v1/sharing/links/open');
    expect(JSON.parse(calls[2]?.[1]?.body as string)).toEqual({ token: 'abc', password: 'wrong' });
  });

  it('calls the extension with the link, never with the credentials of the browser', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(json(200, {})));
    await linkRequest('abc', 'pw', fetchMock)('/api/v1/ext/notes/memos/m-1');
    await linkRequest(
      'abc',
      undefined,
      fetchMock,
    )('/x', {
      headers: { Accept: 'text/plain' },
    });
    const [first, second] = fetchMock.mock.calls;
    const headers = new Headers(first?.[1]?.headers);
    expect(headers.get('X-Mosaikit-Link')).toBe('abc');
    expect(headers.get('X-Mosaikit-Link-Password')).toBe('pw');
    expect(headers.get('Accept')).toBe('application/json');
    expect(first?.[1]?.credentials).toBe('omit');
    const other = new Headers(second?.[1]?.headers);
    expect(other.get('X-Mosaikit-Link-Password')).toBeNull();
    expect(other.get('Accept')).toBe('text/plain');
  });

  it('loads the frontend of the extension for a person without an account', async () => {
    const view = {
      extension: 'dev.example.notes',
      version: '1.0.0',
      entry: '/api/v1/extension-assets/dev.example.notes/web/index.js',
      element: 'x-memo',
    };
    const defined = new Set<string>();
    const registry = { get: (name: string) => (defined.has(name) ? 'defined' : undefined) };
    const request = vi.fn(() => Promise.resolve(json(200, [])));
    let context: unknown;
    const activate = vi.fn((given: unknown) => {
      context = given;
      defined.add('x-memo');
    });

    expect(
      await defineSharedView(
        view,
        request,
        () => Promise.resolve({ default: { activate } }),
        registry as never,
      ),
    ).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
    const given = activate.mock.calls[0]?.[0] as {
      extension: { id: string };
      user: { username: string };
      fetch: unknown;
      locale: string;
      contributionsTo: (point: string) => unknown[];
      notify: () => Promise<void>;
    };
    expect(given.extension.id).toBe('dev.example.notes');
    expect(given.user.username).toBe('');
    expect(given.fetch).toBe(request);
    expect(given.locale).toBe('en');
    expect(given.contributionsTo('x.y')).toEqual([]);
    await expect(given.notify()).rejects.toThrow('Not available to a link');
    expect(context).toBeDefined();

    // Already defined: nothing loaded again.
    const importModule = vi.fn();
    expect(await defineSharedView(view, request, importModule, registry as never)).toBe(true);
    expect(importModule).not.toHaveBeenCalled();
    // A module that is not an extension.
    expect(
      await defineSharedView(
        { ...view, element: 'x-other' },
        request,
        () => Promise.resolve({ default: 42 }),
        registry as never,
      ),
    ).toBe(false);
  });
});

describe('the accesses a resource inherits from the resources above it (MK-136)', () => {
  const FOLDER: InheritedAccess = {
    resource: { extension: 'dev.example.notes', type: 'folder', id: 'f-1' },
    title: 'Budgets',
    link: '/app/notes?folder=f-1',
    owner: 'c-1',
    ownerName: 'Carla Bianchi',
    levels: RESOURCE.levels,
    grants: [{ ...GRANT, id: 'g-9', level: 'manage' }],
  };

  it('reads them from the REST API of sharing', async () => {
    const { request, calls } = requests(json(200, [FOLDER]), json(403, { title: 'Forbidden' }));
    const api = new SharingApi(request);

    expect(await api.inherited(REF)).toEqual([FOLDER]);
    await expect(api.inherited(REF)).rejects.toMatchObject({ status: 403 });
    expect(calls.map(([called]) => called)).toEqual([
      '/api/v1/sharing/resources/dev.example.notes/memo/m-1/inherited',
      '/api/v1/sharing/resources/dev.example.notes/memo/m-1/inherited',
    ]);
  });

  it('lists them, naming each resource above, to who may share', async () => {
    const api = {
      open: vi.fn(() => Promise.resolve({ ...RESOURCE, subjects: ['person' as const] })),
      grants: vi.fn(() => Promise.resolve([])),
      inherited: vi.fn(() => Promise.resolve([FOLDER])),
      grant: vi.fn(() => Promise.resolve(GRANT)),
      createLink: vi.fn(() => Promise.reject(new Error('no links'))),
      revoke: vi.fn(() => Promise.resolve()),
    };
    const dialog = new ShareDialogState(api, () => Promise.resolve([]), events());

    await dialog.load(REF);
    expect(api.inherited).toHaveBeenCalledWith(REF);
    expect(dialog.inherited).toEqual([FOLDER]);
    expect(dialog.inherited[0]?.title).toBe('Budgets');
    expect(levelTitle(FOLDER.levels, FOLDER.grants[0]?.level ?? '')).toBe('Manage');

    api.open.mockImplementationOnce(() =>
      Promise.resolve({ ...RESOURCE, canShare: false, subjects: ['person' as const] }),
    );
    await dialog.load(REF);
    expect(dialog.inherited).toEqual([]);
  });
});
