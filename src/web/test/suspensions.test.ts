// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { type AccountStatus, KernelClient, KernelError } from '../src/api.js';
import { AccountSuspensions, MAX_REASON, accountName, describeStatus } from '../src/suspensions.js';

const ADA: AccountStatus = {
  accountId: 'a1',
  username: 'ada@example.org',
  displayName: 'Ada',
  suspended: false,
  suspendedAt: null,
  suspendedBy: null,
  reason: null,
};
const ADA_SUSPENDED: AccountStatus = {
  ...ADA,
  suspended: true,
  suspendedAt: '2026-10-14T08:00:00Z',
  suspendedBy: 'admin',
  reason: 'Laptop reported stolen',
};
const BEA_SUSPENDED: AccountStatus = {
  ...ADA_SUSPENDED,
  accountId: 'b1',
  username: 'bea@example.org',
  displayName: 'bea@example.org',
  reason: null,
};

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
}

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    suspendedAccounts: vi.fn(() => Promise.resolve([BEA_SUSPENDED])),
    accountStatus: vi.fn(() => Promise.resolve(ADA)),
    suspendAccount: vi.fn(() => Promise.resolve(ADA_SUSPENDED)),
    reinstateAccount: vi.fn(() => Promise.resolve(ADA)),
    ...overrides,
  };
}

describe('the suspension of accounts by platform administrators (MK-125)', () => {
  it('names an account and says whether it is suspended, since when, by whom and why', () => {
    expect(accountName(ADA)).toBe('Ada (ada@example.org)');
    expect(accountName(BEA_SUSPENDED)).toBe('bea@example.org');
    expect(describeStatus(ADA, (iso) => iso)).toBe('Active: the person signs in.');
    expect(describeStatus(ADA_SUSPENDED, (iso) => iso)).toBe(
      'Suspended 2026-10-14T08:00:00Z by admin. Reason: Laptop reported stolen',
    );
    expect(describeStatus(BEA_SUSPENDED, (iso) => iso)).toBe(
      'Suspended 2026-10-14T08:00:00Z by admin. No reason was given.',
    );
    expect(
      describeStatus({ ...BEA_SUSPENDED, suspendedAt: null, suspendedBy: null }, (iso) => iso),
    ).toBe('Suspended  by . No reason was given.');
  });

  it('lists, finds, suspends with a reason and reinstates', async () => {
    const kernel = client();
    const told = events();
    const suspensions = new AccountSuspensions(kernel, told);

    await suspensions.load();
    expect(suspensions.suspended).toEqual([BEA_SUSPENDED]);

    expect(await suspensions.find(' ada@example.org ')).toBe(true);
    expect(kernel.accountStatus).toHaveBeenCalledWith('ada@example.org');
    expect(suspensions.found).toEqual(ADA);

    expect(await suspensions.suspend(ADA, '  Laptop reported stolen ')).toBe(true);
    expect(kernel.suspendAccount).toHaveBeenCalledWith('ada@example.org', 'Laptop reported stolen');
    expect(suspensions.found).toEqual(ADA_SUSPENDED);
    expect(suspensions.suspended).toEqual([ADA_SUSPENDED, BEA_SUSPENDED]);
    expect(told.announce).toHaveBeenLastCalledWith(
      'Ada (ada@example.org) is suspended: their sessions ended.',
      false,
    );

    expect(await suspensions.reinstate(ADA_SUSPENDED)).toBe(true);
    expect(kernel.reinstateAccount).toHaveBeenCalledWith('ada@example.org');
    expect(suspensions.found).toEqual(ADA);
    expect(suspensions.suspended).toEqual([BEA_SUSPENDED]);
    expect(told.announce).toHaveBeenLastCalledWith(
      'Ada (ada@example.org) is reinstated and can sign in again.',
      false,
    );

    // Reinstating from the list leaves the account found alone.
    kernel.reinstateAccount.mockResolvedValueOnce({ ...BEA_SUSPENDED, suspended: false });
    expect(await suspensions.reinstate(BEA_SUSPENDED)).toBe(true);
    expect(suspensions.found).toEqual(ADA);
    expect(suspensions.suspended).toEqual([]);
  });

  it('asks for the email address and the reason before calling the kernel', async () => {
    const kernel = client();
    const told = events();
    const suspensions = new AccountSuspensions(kernel, told);

    expect(await suspensions.find('  ')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Write the email address of the account.', true);
    expect(await suspensions.suspend(ADA, ' ')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Write the reason for the suspension.', true);
    expect(await suspensions.suspend(ADA, 'x'.repeat(MAX_REASON + 1))).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith(
      'The reason is longer than 500 characters.',
      true,
    );
    expect(kernel.accountStatus).not.toHaveBeenCalled();
    expect(kernel.suspendAccount).not.toHaveBeenCalled();
  });

  it('tells what went wrong', async () => {
    const kernel = client({
      suspendedAccounts: vi.fn(() => Promise.reject(new Error('Forbidden'))),
      accountStatus: vi.fn(() =>
        Promise.reject(new KernelError(404, 'Not Found', "No account 'zed@example.org'.")),
      ),
      suspendAccount: vi.fn(() =>
        Promise.reject(new Error('You cannot suspend your own account.')),
      ),
      reinstateAccount: vi.fn(() => Promise.reject(new Error('offline'))),
    });
    const told = events();
    const suspensions = new AccountSuspensions(kernel, told);

    await suspensions.load();
    expect(told.announce).toHaveBeenLastCalledWith(
      'The suspended accounts cannot be read: Forbidden',
      true,
    );
    expect(await suspensions.find('zed@example.org')).toBe(false);
    expect(suspensions.found).toBeUndefined();
    expect(told.announce).toHaveBeenLastCalledWith(
      'No account has the email address zed@example.org.',
      true,
    );
    kernel.accountStatus.mockRejectedValueOnce(new Error('Bad gateway'));
    expect(await suspensions.find('ada@example.org')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('The account cannot be read: Bad gateway', true);
    expect(await suspensions.suspend(ADA, 'Left')).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith(
      'The account cannot be suspended: You cannot suspend your own account.',
      true,
    );
    expect(await suspensions.reinstate(ADA_SUSPENDED)).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith(
      'The account cannot be reinstated: offline',
      true,
    );
  });

  it('does nothing without a client', async () => {
    const told = events();
    const suspensions = new AccountSuspensions(undefined, told);
    await suspensions.load();
    expect(await suspensions.find('ada@example.org')).toBe(false);
    expect(await suspensions.suspend(ADA, 'Left')).toBe(false);
    expect(await suspensions.reinstate(ADA_SUSPENDED)).toBe(false);
    expect(told.announce).not.toHaveBeenCalled();
  });

  it('calls the endpoints of the platform', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify(ADA), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const kernel = new KernelClient(fetchMock, undefined);

    await kernel.suspendedAccounts();
    await kernel.accountStatus('ada+1@example.org');
    await kernel.suspendAccount('ada+1@example.org', 'Left');
    await kernel.reinstateAccount('ada+1@example.org');

    const calls = fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? ''} ${path}`);
    expect(calls).toEqual([
      'GET /api/v1/platform/accounts/suspended',
      'GET /api/v1/platform/accounts/ada%2B1%40example.org/suspension',
      'PUT /api/v1/platform/accounts/ada%2B1%40example.org/suspension',
      'DELETE /api/v1/platform/accounts/ada%2B1%40example.org/suspension',
    ]);
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ reason: 'Left' }));
  });
});
