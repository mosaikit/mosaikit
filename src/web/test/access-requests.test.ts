// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@mosaikit/sdk';
import {
  AccessRequestList,
  AccessRequestsApi,
  REQUEST_ACCESS_EVENT,
  levelTitle,
  listenForAccessRequests,
  requestedAccessOf,
  requesterOf,
  sendAccessRequest,
  type PendingAccessRequest,
} from '../src/access-requests.js';
import { forwardAccessRequests } from '../src/frame.js';

type Request = (path: string, init?: RequestInit) => Promise<Response>;

const RESOURCE = { extension: 'org.example.drive', type: 'file', id: 'f1' };

const REQUEST: PendingAccessRequest = {
  id: '00000000-0000-0000-0000-000000000001',
  requester: '00000000-0000-0000-0000-0000000000b1',
  requesterName: 'Bea',
  requesterEmail: 'bea@example.org',
  resource: RESOURCE,
  title: 'Budget 2027',
  link: '/app/drive/f1',
  extensionName: 'Drive',
  typeTitle: 'File',
  level: 'edit',
  levels: [
    { name: 'view', title: 'View' },
    { name: 'edit', title: 'Edit' },
  ],
  message: 'I review the budget.',
  created: '2026-10-15T08:00:00Z',
};

function answer(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('the request for access from a refused page (MK-058)', () => {
  it('58.1 reads the request a topic or a DOM event carries', () => {
    expect(requestedAccessOf(RESOURCE)).toEqual({ resource: RESOURCE });
    expect(requestedAccessOf({ ...RESOURCE, level: 'edit' })).toEqual({
      resource: RESOURCE,
      level: 'edit',
    });
    expect(requestedAccessOf({ resource: RESOURCE })).toEqual({ resource: RESOURCE });
    expect(requestedAccessOf({ ...RESOURCE, level: 'Not a level' })).toEqual({
      resource: RESOURCE,
    });
    expect(requestedAccessOf({ extension: 'drive', type: 'file', id: 'f1' })).toBeUndefined();
    expect(requestedAccessOf(null)).toBeUndefined();
    expect(requestedAccessOf('org.example.drive/file/f1')).toBeUndefined();
  });

  it('58.1 hears the DOM event of a refused panel until it stops', () => {
    const target = new EventTarget();
    const handle = vi.fn();
    const stop = listenForAccessRequests(target, handle);

    target.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT, { detail: { resource: RESOURCE } }));
    target.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT, { detail: { resource: {} } }));
    stop();
    target.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT, { detail: { resource: RESOURCE } }));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({ resource: RESOURCE });
  });

  it('58.1 passes the DOM event of an isolated frame to the shell as a topic of the bridge', () => {
    const target = new EventTarget();
    const events = new EventBus();
    const publish = vi.spyOn(events, 'publish');
    forwardAccessRequests(target, events);

    target.dispatchEvent(
      new CustomEvent(REQUEST_ACCESS_EVENT, { detail: { resource: RESOURCE, level: 'edit' } }),
    );
    target.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT, { detail: { resource: RESOURCE } }));
    target.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT, { detail: 'nothing' }));
    target.dispatchEvent(new CustomEvent(REQUEST_ACCESS_EVENT, { detail: { level: 'edit' } }));
    forwardAccessRequests({}, events);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(1, 'shell.request-access', {
      ...RESOURCE,
      level: 'edit',
    });
    expect(publish).toHaveBeenNthCalledWith(2, 'shell.request-access', RESOURCE);
  });

  it('58.1 sends the request with the message and says it was sent', async () => {
    const request = vi.fn<Request>(() => answer({ id: 'r1', status: 'pending' }, 202));
    const api = new AccessRequestsApi(request);

    const sent = await sendAccessRequest(api, { resource: RESOURCE, level: 'edit' }, '  Please.  ');

    expect(sent.failed).toBe(false);
    expect(sent.message).toContain('Request sent');
    expect(request).toHaveBeenCalledWith('/api/v1/access-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...RESOURCE, level: 'edit', message: 'Please.' }),
    });
  });

  it('58.1 refuses a message too long and tells a failure', async () => {
    const send = vi.fn(() => Promise.reject(new Error('down')));
    const long = await sendAccessRequest({ send }, { resource: RESOURCE }, 'x'.repeat(1001));
    expect(long.failed).toBe(true);
    expect(send).not.toHaveBeenCalled();

    const failed = await sendAccessRequest({ send }, { resource: RESOURCE }, 'Please.');
    expect(failed).toEqual({ message: 'The request was not sent: down', failed: true });
  });
});

describe('the requests for access to decide (MK-058)', () => {
  function events() {
    return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
  }

  it('58.2 lists the requests the person may decide', async () => {
    const request = vi.fn<Request>(() => answer([REQUEST]));
    const told = events();
    const list = new AccessRequestList(new AccessRequestsApi(request), told);

    await list.load();

    expect(request).toHaveBeenCalledWith('/api/v1/access-requests');
    expect(list.requests).toEqual([REQUEST]);
    expect(told.changed).toHaveBeenCalled();
    expect(requesterOf(REQUEST)).toBe('Bea');
    expect(requesterOf({ ...REQUEST, requesterName: null })).toBe('bea@example.org');
    expect(requesterOf({ ...REQUEST, requesterName: null, requesterEmail: null })).toBe('Someone');
    expect(levelTitle(REQUEST, 'view')).toBe('View');
    expect(levelTitle(REQUEST, 'manage')).toBe('manage');
  });

  it('58.2 tells when the list cannot be read, and does nothing without a client', async () => {
    const told = events();
    const list = new AccessRequestList(
      { toDecide: () => Promise.reject(new Error('No.')), approve: vi.fn(), reject: vi.fn() },
      told,
    );
    await list.load();
    expect(list.requests).toBeUndefined();
    expect(told.announce).toHaveBeenCalledWith('The requests for access cannot be read: No.', true);

    const none = new AccessRequestList(undefined, events());
    await none.load();
    expect(await none.approve(REQUEST)).toBe(false);
    expect(await none.reject(REQUEST)).toBe(false);
  });

  it('58.3 approves with the level asked or another, and declines with a reason', async () => {
    const request = vi.fn<Request>((path: string) =>
      path === '/api/v1/access-requests' ? answer([]) : answer({ status: 'approved' }),
    );
    const told = events();
    const list = new AccessRequestList(new AccessRequestsApi(request), told);

    expect(await list.approve(REQUEST)).toBe(true);
    expect(request).toHaveBeenCalledWith(`/api/v1/access-requests/${REQUEST.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(told.announce).toHaveBeenLastCalledWith('Bea may now open Budget 2027 (Edit).', false);

    expect(await list.approve(REQUEST, 'view')).toBe(true);
    expect(request).toHaveBeenCalledWith(`/api/v1/access-requests/${REQUEST.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: 'view' }),
    });

    expect(await list.reject(REQUEST, '  Not yet. ')).toBe(true);
    expect(request).toHaveBeenCalledWith(`/api/v1/access-requests/${REQUEST.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Not yet.' }),
    });
    expect(await list.reject(REQUEST)).toBe(true);
    expect(request).toHaveBeenLastCalledWith('/api/v1/access-requests');
    expect(told.announce).toHaveBeenLastCalledWith('The request of Bea was declined.', false);
    expect(list.requests).toEqual([]);
  });

  it('58.3 tells when a decision fails', async () => {
    const request = vi.fn(() =>
      answer({ title: 'Not Found', detail: 'No such pending request.' }, 404),
    );
    const told = events();
    const list = new AccessRequestList(new AccessRequestsApi(request), told);

    expect(await list.approve(REQUEST)).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not approved: No such pending request.', true);
    expect(await list.reject(REQUEST)).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not declined: No such pending request.', true);
  });
});
