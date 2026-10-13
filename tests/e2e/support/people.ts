// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { ADMIN, BASE_URL, type Person } from './env.js';
import { confirmationLink } from './mail.js';

/** Another organization of the installation, and a person of it who signs in with a password. */
export const OTHER = { slug: 'altro-comune', name: 'Altro Comune' };
export const LUCA: Person = {
  user: 'luca.verdi@altro.test',
  password: 'Altro-2026-sicura',
  name: 'Luca Verdi',
};

const basic = (person: Person): string =>
  `Basic ${Buffer.from(`${person.user}:${person.password}`).toString('base64')}`;

/** Creates the other organization and its person, once: later calls find them ready. */
export async function otherOrganizationPerson(): Promise<Person> {
  const signedIn = await fetch(`${BASE_URL}/api/v1/accounts/me`, {
    headers: { authorization: basic(LUCA) },
  });
  if (signedIn.ok) {
    return LUCA;
  }
  await fetch(`${BASE_URL}/api/v1/organizations`, {
    method: 'POST',
    headers: { authorization: basic(ADMIN), 'content-type': 'application/json' },
    body: JSON.stringify({ slug: OTHER.slug, name: OTHER.name, selfRegistration: true }),
  });
  await fetch(`${BASE_URL}/api/v1/accounts/registrations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      organization: OTHER.slug,
      email: LUCA.user,
      displayName: LUCA.name,
      password: LUCA.password,
    }),
  });
  // Self-registered people confirm their address before signing in (MK-048).
  const token = new URL(await confirmationLink(LUCA.user)).searchParams.get('confirm');
  await fetch(`${BASE_URL}/api/v1/accounts/confirmations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return LUCA;
}
