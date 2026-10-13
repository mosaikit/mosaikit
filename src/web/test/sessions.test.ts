// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountSession } from '../src/api.js';
import { setLanguage } from '../src/i18n.js';
import { SessionList, describeDevice, describeUse, when } from '../src/sessions.js';

const PHONE: AccountSession = {
  id: 's-phone',
  kind: 'password',
  userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36',
  address: '192.0.2.7',
  createdAt: '2026-10-13T08:00:00Z',
  lastSeenAt: '2026-10-13T09:30:00Z',
  current: false,
};
const HERE: AccountSession = { ...PHONE, id: 's-here', userAgent: 'curl/8.10', current: true };

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string) => void>(), signedOut: vi.fn() };
}

describe('the sessions in the settings (MK-125)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('names the browser and the system of a session', () => {
    expect(
      describeDevice({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0',
      }),
    ).toBe('Edge on Windows');
    expect(
      describeDevice({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      }),
    ).toBe('Safari on iPhone');
    setLanguage('it');
    expect(
      describeDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Firefox/140.0' }),
    ).toBe('Firefox su Linux');
  });

  it('keeps an unknown client recognizable', () => {
    expect(describeDevice({ userAgent: 'curl/8.10' })).toBe('curl/8.10');
    expect(describeDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' })).toBe('Windows');
    expect(describeDevice({ userAgent: null })).toBe('Unknown device');
  });

  it('says when, from where and how a session was used', () => {
    const line = describeUse(PHONE);
    expect(line).toMatch(/^Signed in .+ · last used .+ · 192\.0\.2\.7$/);
    expect(describeUse({ ...PHONE, address: null, kind: 'realm' })).toMatch(
      / · through your organization$/,
    );
    expect(when('not a date')).toBe('not a date');
  });

  it('reads the sessions and ends another one', async () => {
    const client = {
      sessions: vi.fn(() => Promise.resolve([HERE, PHONE])),
      endSession: vi.fn(() => Promise.resolve()),
    };
    const told = events();
    const list = new SessionList(client, told);

    await list.load();
    expect(list.sessions).toEqual([HERE, PHONE]);
    expect(told.changed).toHaveBeenCalledTimes(1);

    await list.end(PHONE);
    expect(client.endSession).toHaveBeenCalledWith('s-phone');
    expect(list.sessions).toEqual([HERE]);
    expect(told.announce).toHaveBeenCalledWith('Session ended: Chrome on Android');
    expect(told.signedOut).not.toHaveBeenCalled();
  });

  it('signs this browser out when its own session ends', async () => {
    const client = {
      sessions: vi.fn(() => Promise.resolve([HERE])),
      endSession: vi.fn(() => Promise.resolve()),
    };
    const told = events();
    const list = new SessionList(client, told);
    await list.load();

    await list.end(HERE);

    expect(told.signedOut).toHaveBeenCalledTimes(1);
    expect(told.announce).not.toHaveBeenCalled();
  });

  it('tells what went wrong and reads the list again', async () => {
    const client = {
      sessions: vi
        .fn<() => Promise<AccountSession[]>>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue([PHONE]),
      endSession: vi.fn(() => Promise.reject(new Error('not found'))),
    };
    const told = events();
    const list = new SessionList(client, told);

    await list.load();
    expect(told.announce).toHaveBeenLastCalledWith('The sessions cannot be read: offline');
    expect(list.sessions).toBeUndefined();

    await list.end(PHONE);
    expect(told.announce).toHaveBeenCalledWith('The session was not ended: not found');
    expect(list.sessions).toEqual([PHONE]);
  });
});
