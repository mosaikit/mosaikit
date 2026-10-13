// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccessKeyList,
  describeAccess,
  describeKey,
  expiryAfter,
  expiryChoices,
} from '../src/access-keys.js';
import type { AccessKey, AccessKeys, NewAccessKey } from '../src/api.js';
import { setLanguage } from '../src/i18n.js';

const SCRIPT: AccessKey = {
  id: 'k-script',
  name: 'Nightly export',
  prefix: 'mk_AbCdEfGh',
  organizationId: 'o-acme',
  organization: 'acme',
  write: false,
  createdAt: '2026-10-13T08:00:00Z',
  lastUsedAt: null,
  expiresAt: '2027-10-13T08:00:00Z',
  expired: false,
};
const NOW = new Date('2026-10-13T08:00:00Z');

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string) => void>() };
}

function client(keys: AccessKeys = { maxValidityDays: 365, keys: [SCRIPT] }) {
  return {
    accessKeys: vi.fn<() => Promise<AccessKeys>>(() => Promise.resolve(keys)),
    createAccessKey: vi.fn<(request: NewAccessKey) => Promise<AccessKey>>((request) =>
      Promise.resolve({
        ...SCRIPT,
        id: 'k-new',
        name: request.name,
        write: request.write,
        secret: 'mk_AbCdEfGh-the-rest-of-the-secret',
      }),
    ),
    revokeAccessKey: vi.fn<(id: string) => Promise<void>>(() => Promise.resolve()),
  };
}

describe('the access keys in the settings (MK-060)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('offers the expiries up to the longest of the installation', () => {
    expect(expiryChoices(365)).toEqual([7, 30, 90, 365]);
    expect(expiryChoices(30)).toEqual([7, 30]);
    expect(expiryChoices(1)).toEqual([1]);
    expect(expiryAfter(30, NOW)).toBe('2026-11-12T08:00:00.000Z');
  });

  it('says what a key does, when it was used and when it expires', () => {
    expect(describeAccess(SCRIPT)).toBe('Read only');
    expect(describeAccess({ write: true })).toBe('Reads and writes');
    expect(describeKey(SCRIPT)).toMatch(
      /^mk_AbCdEfGh… · created .+ · last used never · expires .+$/,
    );
    expect(describeKey({ ...SCRIPT, lastUsedAt: '2026-10-13T09:00:00Z', expired: true })).toMatch(
      / · last used .+2026.+ · expired .+$/,
    );
    setLanguage('it');
    expect(describeAccess(SCRIPT)).toBe('Solo lettura');
    expect(describeKey(SCRIPT)).toContain('ultimo uso mai');
  });

  it('reads the keys and the longest expiry', async () => {
    const kernel = client({ maxValidityDays: 90, keys: [SCRIPT] });
    const told = events();
    const list = new AccessKeyList(kernel, told);

    await list.load();

    expect(list.keys).toEqual([SCRIPT]);
    expect(list.maxValidityDays).toBe(90);
    expect(told.changed).toHaveBeenCalledTimes(1);
  });

  it('creates a key and shows its secret once, until the person is done', async () => {
    const kernel = client();
    const told = events();
    const list = new AccessKeyList(kernel, told, () => NOW);
    await list.load();

    expect(
      await list.create({ name: '  Deploy  ', organization: 'acme', days: 30, write: true }),
    ).toBe(true);

    expect(kernel.createAccessKey).toHaveBeenCalledWith({
      name: 'Deploy',
      organization: 'acme',
      write: true,
      expiresAt: '2026-11-12T08:00:00.000Z',
    });
    expect(list.created?.secret).toBe('mk_AbCdEfGh-the-rest-of-the-secret');
    expect(list.keys?.map((key) => key.id)).toEqual(['k-new', 'k-script']);
    expect(list.keys?.[0]).not.toHaveProperty('secret');
    expect(told.announce).toHaveBeenCalledWith(
      'Key created: Deploy. Copy it now, it will not be shown again.',
    );
    expect(list.busy).toBe(false);

    list.dismiss();
    expect(list.created).toBeUndefined();
  });

  it('leaves the longest expiry to the kernel', async () => {
    const kernel = client();
    const list = new AccessKeyList(kernel, events(), () => NOW);
    await list.load();

    await list.create({ name: 'Long', organization: 'acme', days: 400, write: false });

    expect(kernel.createAccessKey).toHaveBeenCalledWith({
      name: 'Long',
      organization: 'acme',
      write: false,
    });
  });

  it('asks for a name and tells why a key was not created', async () => {
    const kernel = client();
    kernel.createAccessKey.mockRejectedValueOnce(new Error('expiresAt must be within 365 days'));
    const told = events();
    const list = new AccessKeyList(kernel, told);

    expect(await list.create({ name: ' ', organization: 'acme', days: 30, write: false })).toBe(
      false,
    );
    expect(told.announce).toHaveBeenLastCalledWith('Name the key, so that you recognize it later.');
    expect(kernel.createAccessKey).not.toHaveBeenCalled();

    expect(await list.create({ name: 'Late', organization: 'acme', days: 30, write: false })).toBe(
      false,
    );
    expect(told.announce).toHaveBeenLastCalledWith(
      'The key was not created: expiresAt must be within 365 days',
    );
    expect(list.created).toBeUndefined();
  });

  it('does nothing without a kernel', async () => {
    const list = new AccessKeyList(undefined, events());
    await list.load();
    expect(list.keys).toBeUndefined();
    expect(await list.create({ name: 'x', organization: 'acme', days: 7, write: false })).toBe(
      false,
    );
  });

  it('copies the secret of the key just created', async () => {
    const told = events();
    const list = new AccessKeyList(client(), told);
    const clipboard = {
      writeText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
    };

    await list.copy(clipboard);
    expect(clipboard.writeText).not.toHaveBeenCalled();

    await list.create({ name: 'Copy me', organization: 'acme', days: 7, write: false });
    await list.copy(clipboard);
    expect(clipboard.writeText).toHaveBeenCalledWith('mk_AbCdEfGh-the-rest-of-the-secret');
    expect(told.announce).toHaveBeenLastCalledWith('Key copied.');

    await list.copy(undefined);
    expect(told.announce).toHaveBeenLastCalledWith(
      'The key was not copied: no clipboard. Select it and copy it.',
    );
  });

  it('revokes a key and tells what went wrong', async () => {
    const kernel = client();
    const told = events();
    const list = new AccessKeyList(kernel, told);
    await list.load();
    await list.create({ name: 'Short lived', organization: 'acme', days: 7, write: false });

    await list.revoke({ ...SCRIPT, id: 'k-new', name: 'Short lived' });
    expect(kernel.revokeAccessKey).toHaveBeenCalledWith('k-new');
    expect(list.keys).toEqual([SCRIPT]);
    expect(list.created).toBeUndefined();
    expect(told.announce).toHaveBeenLastCalledWith('Key revoked: Short lived');

    kernel.revokeAccessKey.mockRejectedValueOnce(new Error('not found'));
    await list.revoke(SCRIPT);
    expect(told.announce).toHaveBeenCalledWith('The key was not revoked: not found');
    expect(kernel.accessKeys).toHaveBeenCalledTimes(2);

    kernel.accessKeys.mockRejectedValueOnce(new Error('offline'));
    await list.load();
    expect(told.announce).toHaveBeenLastCalledWith('The access keys cannot be read: offline');
  });
});
