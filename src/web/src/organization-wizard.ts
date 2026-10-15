// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  KernelError,
  type KernelClient,
  type NewOrganization,
  type OrganizationSummary,
  type SignInMethod,
} from './api.js';
import { t } from './i18n.js';

/** The steps of the guided creation of an organization (MK-072), in order. */
export const STEPS = ['organization', 'sign-in', 'administrator', 'review'] as const;
export type Step = (typeof STEPS)[number];

/** What the platform administrator wrote so far. */
export interface OrganizationDraft {
  readonly name: string;
  readonly slug: string;
  readonly selfRegistration: boolean;
  readonly signIn: SignInMethod;
  /** The email domains that choose the identity provider of the organization at sign-in. */
  readonly emailDomains: string;
  readonly administratorEmail: string;
  readonly administratorFirstName: string;
  readonly administratorLastName: string;
}

export const EMPTY_DRAFT: OrganizationDraft = {
  name: '',
  slug: '',
  selfRegistration: false,
  signIn: 'password',
  emailDomains: '',
  administratorEmail: '',
  administratorFirstName: '',
  administratorLastName: '',
};

const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A slug made from a name: lowercase letters, digits and inner hyphens, at most 63 characters. */
export function slugFrom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** The email domains written in the draft, one per comma, space or line. */
export function domainsOf(draft: OrganizationDraft): string[] {
  return [
    ...new Set(
      draft.emailDomains
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** Whether the organization signs in through an identity provider that the kernel creates for it. */
export function usesRealm(draft: OrganizationDraft): boolean {
  return draft.signIn !== 'password';
}

/** What is missing or wrong in a step, empty when the step is complete. */
export function problems(draft: OrganizationDraft, step: Step): string[] {
  const found: string[] = [];
  if (step === 'organization' || step === 'review') {
    if (!draft.name.trim()) {
      found.push(t('Write the name of the organization.'));
    } else if (draft.name.trim().length > 120) {
      found.push(t('The name is longer than 120 characters.'));
    }
    if (draft.slug.length < 2 || draft.slug.length > 63 || !SLUG.test(draft.slug)) {
      found.push(
        t(
          'The address name has 2 to 63 lowercase letters, digits and inner hyphens, such as acme-europe.',
        ),
      );
    }
  }
  if ((step === 'sign-in' || step === 'review') && usesRealm(draft)) {
    const domains = domainsOf(draft);
    if (domains.length === 0) {
      found.push(t('Write at least one email domain of the organization, such as example.org.'));
    }
    const wrong = domains.filter((domain) => !DOMAIN.test(domain));
    if (wrong.length > 0) {
      found.push(t('These are not domain names: {domains}', { domains: wrong.join(', ') }));
    }
    if (domains.length > 20) {
      found.push(t('At most 20 email domains.'));
    }
  }
  if (step === 'administrator' || step === 'review') {
    if (!EMAIL.test(draft.administratorEmail.trim())) {
      found.push(t('Write the email address of the administrator.'));
    }
    if (!draft.administratorFirstName.trim() || !draft.administratorLastName.trim()) {
      found.push(t('Write the first and the last name of the administrator.'));
    }
  }
  return found;
}

/** The request that creates the organization of a draft. */
export function request(draft: OrganizationDraft): NewOrganization {
  const base = {
    slug: draft.slug,
    name: draft.name.trim(),
    selfRegistration: draft.selfRegistration,
    signIn: draft.signIn,
  };
  if (!usesRealm(draft)) {
    return base;
  }
  return {
    ...base,
    federation: {
      emailDomains: domainsOf(draft),
      administrator: {
        email: draft.administratorEmail.trim(),
        firstName: draft.administratorFirstName.trim(),
        lastName: draft.administratorLastName.trim(),
      },
    },
  };
}

/** How the administrator of a new organization gets in. */
export type Access =
  /** Signs in through the identity provider with this temporary password, changed at the first sign-in. */
  | { readonly kind: 'temporary-password'; readonly username: string; readonly password: string }
  /** Sets the password with a link: mailed, or to pass on. */
  | { readonly kind: 'link'; readonly mailed: boolean; readonly link: string | null }
  /** Had an account already: became an administrator of the organization. */
  | { readonly kind: 'member' }
  /** The organization was created, but the administrator could not be added. */
  | { readonly kind: 'failed'; readonly reason: string };

/** An organization just created, and how its administrator gets in. */
export interface Created {
  readonly organization: OrganizationSummary;
  readonly access: Access;
}

const ADMINISTRATOR_ROLES = ['organization-admin', 'organization-user'] as const;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates the organization of a draft with its administrator and its sign-in method. With an identity
 * provider, the kernel creates the realm and the administrator in it at once; with a password, the
 * administrator gets an account with a link to set the password, or, with an account already, becomes
 * an administrator of the organization.
 *
 * @throws the error of the kernel when the organization itself cannot be created
 */
export async function createOrganization(
  client: Pick<KernelClient, 'createOrganization' | 'createAccount' | 'invite'>,
  draft: OrganizationDraft,
): Promise<Created> {
  const organization = await client.createOrganization(request(draft));
  if (usesRealm(draft)) {
    const initial = organization.initialAdministrator;
    return {
      organization,
      access: initial
        ? {
            kind: 'temporary-password',
            username: initial.username,
            password: initial.temporaryPassword,
          }
        : { kind: 'member' },
    };
  }
  const email = draft.administratorEmail.trim();
  const displayName =
    `${draft.administratorFirstName.trim()} ${draft.administratorLastName.trim()}`.trim();
  try {
    const link = await client.createAccount(organization.slug, {
      email,
      displayName,
      roles: ADMINISTRATOR_ROLES,
    });
    return { organization, access: { kind: 'link', mailed: link.mailed, link: link.link } };
  } catch (error) {
    if (!(error instanceof KernelError && error.status === 409)) {
      return { organization, access: { kind: 'failed', reason: reason(error) } };
    }
  }
  try {
    await client.invite(organization.slug, email, { roles: ADMINISTRATOR_ROLES, displayName });
    return { organization, access: { kind: 'member' } };
  } catch (error) {
    return { organization, access: { kind: 'failed', reason: reason(error) } };
  }
}
