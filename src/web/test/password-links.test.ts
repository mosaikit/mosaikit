// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it } from 'vitest';
import type { PasswordLink } from '../src/api.js';
import { setLanguage } from '../src/i18n.js';
import { awaitsPassword, linkExpiry, linkNotice } from '../src/password-links.js';

const member = {
  accountId: 'a',
  username: 'luigi@example.org',
  displayName: 'Luigi',
  roles: ['organization-user'],
};

const link = (mailed: boolean, expiresAt = '2026-10-21T10:00:00Z'): PasswordLink => ({
  member,
  mailed,
  link: mailed ? null : 'https://mosaikit.example.org/?set-password=t',
  expiresAt,
});

describe('links that set the password of created accounts (MK-048)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('offers a new link only to members without a password who do not sign in through a realm', () => {
    expect(awaitsPassword({ ...member, password: false })).toBe(true);
    expect(awaitsPassword({ ...member, password: true })).toBe(false);
    expect(awaitsPassword({ ...member, password: false, linked: true })).toBe(false);
    // An older kernel that does not say.
    expect(awaitsPassword(member)).toBe(false);
  });

  it('says whether the link was mailed or is shown once, and until when it works', () => {
    expect(linkNotice(link(true))).toContain('We mailed luigi@example.org a link');
    expect(linkNotice(link(false))).toContain('give this link to luigi@example.org');
    expect(linkNotice(link(false))).toContain('shown only now');
    expect(linkNotice(link(false))).toContain('2026');
    setLanguage('it');
    expect(linkNotice(link(false))).toContain('mostrato solo ora');
  });

  it('keeps an expiry it cannot read as it is', () => {
    expect(linkExpiry(link(true, 'soon'))).toBe('soon');
  });
});
