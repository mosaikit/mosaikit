// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { OrganizationMember, PasswordLink } from './api.js';
import { language, t } from './i18n.js';

/**
 * Whether a member can get a new link to set the password (MK-048): an account without a local
 * password that does not sign in through the identity provider of the organization.
 */
export function awaitsPassword(member: OrganizationMember): boolean {
  return member.password === false && member.linked !== true;
}

/** When a link stops working, in the language of the shell. */
export function linkExpiry(link: PasswordLink): string {
  const date = new Date(link.expiresAt);
  return Number.isNaN(date.getTime())
    ? link.expiresAt
    : date.toLocaleString(language(), { dateStyle: 'medium', timeStyle: 'short' });
}

/** What the administrator is told about a link: mailed, or to pass on before it expires. */
export function linkNotice(link: PasswordLink): string {
  const values = { email: link.member.username, until: linkExpiry(link) };
  return link.mailed
    ? t('We mailed {email} a link to choose the password. It works once, until {until}.', values)
    : t(
        'This installation sends no mail: give this link to {email}. It is shown only now, and works once, until {until}.',
        values,
      );
}
