// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { KernelClient, KernelError, ORGANIZATION_HEADER } from '../src/api.js';

/** A storage of the tab, in memory. */
function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('KernelClient (MK-008)', () => {
  it('opens a cookie session for a local account, without keeping the password', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, { username: 'ada@example.org' })),
    );
    const client = new KernelClient(fetchMock, memory());

    const account = await client.signIn('ada@example.org', 'secret');
    await client.shellPlugins();

    expect(account.username).toBe('ada@example.org');
    expect(client.signedIn).toBe(true);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/v1/accounts/session');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('username=ada%40example.org&password=secret');
    const later = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(later.get('Authorization')).toBeNull();
    expect(later.get('X-Mosaikit-Client')).toBe('shell');
  });

  it('forgets credentials when sign-in fails', async () => {
    const client = new KernelClient(
      () => Promise.resolve(new Response(null, { status: 401 })),
      memory(),
    );

    await expect(client.signIn('ada@example.org', 'wrong')).rejects.toMatchObject({
      status: 401,
      message:
        'The email or the password is not correct, or the email address is not confirmed yet.',
    });
    expect(client.signedIn).toBe(false);
  });

  it('finds the session and the organization again after a reload', async () => {
    const storage = memory();
    storage.setItem('mosaikit.organization', 'globex');
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, { username: 'ada@example.org', organization: 'globex' })),
    );
    const client = new KernelClient(fetchMock, storage);

    const account = await client.resumeSession();

    expect(account?.organization).toBe('globex');
    expect(client.signedIn).toBe(true);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/accounts/session');
    expect(headers.get(ORGANIZATION_HEADER)).toBe('globex');
  });

  it('has no session to resume when the kernel has none', async () => {
    const client = new KernelClient(
      () => Promise.resolve(new Response(null, { status: 204 })),
      memory(),
    );

    expect(await client.resumeSession()).toBeUndefined();
    expect(client.signedIn).toBe(false);
  });

  it('turns problem details into errors', async () => {
    const client = new KernelClient(() =>
      Promise.resolve(json(409, { title: 'Conflict', detail: 'Already exists.' })),
    );

    const error = await client.systemInfo().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(KernelError);
    expect(error).toMatchObject({ status: 409, title: 'Conflict', message: 'Already exists.' });
  });

  it('copes with error bodies that are not JSON', async () => {
    const client = new KernelClient(() =>
      Promise.resolve(new Response('oops', { status: 500, statusText: 'Server Error' })),
    );

    await expect(client.systemInfo()).rejects.toMatchObject({ status: 500, title: 'Server Error' });
  });

  it('ends the session on the kernel at sign-out', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, {})),
    );
    const client = new KernelClient(fetchMock, memory());
    await client.signIn('a@b.c', 'x');

    await client.signOut();

    expect(client.signedIn).toBe(false);
    const last = fetchMock.mock.calls.at(-1);
    expect(last?.[0]).toBe('/api/v1/accounts/session');
    expect(last?.[1]?.method).toBe('DELETE');
  });

  it('signs in with an access token of a realm (MK-012)', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, { username: 'ada@acme.com' })),
    );
    const client = new KernelClient(fetchMock);

    await client.signInWithToken('token-1');
    client.useToken('token-2');
    await client.shellPlugins();

    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer token-1',
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer token-2',
    );
  });

  it('asks the kernel how an email address signs in (MK-012)', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, { organization: 'acme', federation: null })),
    );

    const options = await new KernelClient(fetchMock).signInOptions('ada+x@acme.com');

    expect(options.organization).toBe('acme');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/identity/sign-in-options?email=ada%2Bx%40acme.com',
    );
  });

  it('forgets a token that the kernel refuses (MK-012)', async () => {
    const client = new KernelClient(() => Promise.resolve(new Response(null, { status: 401 })));

    await expect(client.signInWithToken('expired')).rejects.toMatchObject({ status: 401 });
    expect(client.signedIn).toBe(false);
  });

  it('acts on the organization chosen by the person until sign-out (MK-017)', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, { username: 'ada@example.org', organization: 'globex' })),
    );
    const storage = memory();
    const client = new KernelClient(fetchMock, storage);
    await client.signIn('ada@example.org', 'secret');

    const account = await client.useOrganization('globex');
    await client.shellPlugins();
    await client.signOut();
    await client.systemInfo();

    expect(account.organization).toBe('globex');
    const header = (call: number) =>
      new Headers(fetchMock.mock.calls[call]?.[1]?.headers).get(ORGANIZATION_HEADER);
    // 0 opens the session, 1 reads the account, 4 ends the session
    expect(header(1)).toBeNull();
    expect(header(2)).toBe('globex');
    expect(header(3)).toBe('globex');
    expect(header(5)).toBeNull();
    expect(storage.getItem('mosaikit.organization')).toBeNull();
  });

  it('lists, confirms and rejects the drafts of assistants (MK-015)', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, [])),
    );
    const client = new KernelClient(fetchMock);

    await client.actionDrafts();
    await client.confirmDraft('d 1');
    await client.rejectDraft('d2');

    expect(fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? ''} ${path}`)).toEqual([
      'GET /api/v1/ai/drafts',
      'POST /api/v1/ai/drafts/d%201/confirmation',
      'DELETE /api/v1/ai/drafts/d2',
    ]);
  });

  it('reads the marketplace and installs packages (MK-022)', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, { sources: [], plugins: [] })),
    );
    const client = new KernelClient(fetchMock);

    await client.marketplace();
    await client.install({ source: 'file:/catalog/', id: 'dev.acme.maps', version: '1.0.0' });
    await client.upload(new Blob(['zip'], { type: 'application/zip' }));

    const calls = fetchMock.mock.calls;
    expect(calls.map(([path, init]) => `${init?.method ?? ''} ${path}`)).toEqual([
      'GET /api/v1/marketplace',
      'POST /api/v1/marketplace/installations',
      'POST /api/v1/plugins/packages',
    ]);
    expect(JSON.parse(calls[1]?.[1]?.body as string)).toEqual({
      source: 'file:/catalog/',
      id: 'dev.acme.maps',
      version: '1.0.0',
    });
    expect(new Headers(calls[2]?.[1]?.headers).get('Content-Type')).toBe('application/zip');
    expect(calls[2]?.[1]?.body).toBeInstanceOf(Blob);
  });

  it('talks with the assistant (MK-024)', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, { enabled: true, reply: 'Ciao', tools: [], drafts: [] })),
    );
    const client = new KernelClient(fetchMock);

    expect((await client.assistant()).enabled).toBe(true);
    const reply = await client.ask([{ role: 'user', content: 'Ciao' }]);

    expect(reply.reply).toBe('Ciao');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/ai/assistant/replies');
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      messages: [{ role: 'user', content: 'Ciao' }],
    });
  });

  it('gives the revision of the plugins only when the kernel watches them', async () => {
    const watched = new KernelClient(() => Promise.resolve(json(200, { revision: 7 })), memory());
    const unwatched = new KernelClient(
      () => Promise.resolve(new Response(null, { status: 404 })),
      memory(),
    );

    expect(await watched.pluginRevision()).toBe(7);
    expect(await unwatched.pluginRevision()).toBeUndefined();
  });
});

describe('KernelClient settings, themes and apps (MK-027, MK-028, MK-030)', () => {
  it('calls the endpoints with the method and the body expected', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, [])),
    );
    const client = new KernelClient(fetchMock, memory());
    const preferences = {
      theme: 'pa',
      appearance: 'dark',
      language: 'it',
      hiddenApps: [],
    } as const;
    const apps = [
      { pluginId: 'p', appId: 'a', title: 'A', enabled: false, pinned: true, roles: [] },
    ];

    await client.changePreferences(preferences);
    await client.themes();
    await client.shellApps();
    await client.organizationApps('comune di prova');
    await client.changeOrganizationApps('comune di prova', apps);

    const calls = fetchMock.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET']);
    expect(calls).toEqual([
      ['/api/v1/accounts/me/preferences', 'PUT'],
      ['/api/v1/system/themes', 'GET'],
      ['/api/v1/shell/apps', 'GET'],
      ['/api/v1/organizations/comune%20di%20prova/apps', 'GET'],
      ['/api/v1/organizations/comune%20di%20prova/apps', 'PUT'],
    ]);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(preferences));
    expect(fetchMock.mock.calls[4]?.[1]?.body).toBe(JSON.stringify(apps));
  });
});

describe('KernelClient activity (MK-038)', () => {
  it('reads the feed, marks notifications read and notifies as a plugin', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(json(200, { unread: 0, notifications: [] })),
    );
    const client = new KernelClient(fetchMock, memory());

    await client.activity();
    await client.markRead('n 1');
    await client.markAllRead();
    await client.notify('dev.example.notes', {
      to: ['ada@example.org'],
      kind: 'mention',
      title: 'T',
    });

    expect(fetchMock.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([
      ['/api/v1/notifications', 'GET'],
      ['/api/v1/notifications/n%201/read', 'POST'],
      ['/api/v1/notifications/read', 'POST'],
      ['/api/v1/notifications', 'POST'],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string)).toEqual({
      plugin: 'dev.example.notes',
      to: ['ada@example.org'],
      kind: 'mention',
      title: 'T',
    });
  });
});
