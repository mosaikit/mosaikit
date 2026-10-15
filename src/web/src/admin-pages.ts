// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type {
  AllowedOrigin,
  Catalog,
  ContentSecurityPolicy,
  DeclaredPermission,
  Offer,
  OrganizationApp,
  OrganizationMember,
  OrganizationTeam,
  PermissionProfile,
  PlatformSettings,
  Quota,
  Secret,
  ServiceIdentity,
} from './api.js';
import { type Metric, count, matchesText } from './admin-view.js';
import { t } from './i18n.js';
import { share } from './quotas.js';

/**
 * The metrics and the filters of the administration pages on the model of MK-072, without the view:
 * what each page counts on top, and which of its rows a text written in its filters keeps.
 */

/** A metric that turns `warn` when its count is above zero. */
function watched(label: string, value: number, note?: string): Metric {
  return {
    label,
    value: count(value),
    ...(note ? { note } : {}),
    ...(value > 0 ? { tone: 'warn' as const } : {}),
  };
}

// --- Extensions (MK-022) ---------------------------------------------------------------------

/** Which offers of the marketplace the page lists. */
export type OfferState = 'all' | 'installed' | 'available' | 'update';

export function extensionMetrics(catalog: Catalog | undefined): Metric[] {
  if (!catalog) {
    return [];
  }
  const offers = catalog.extensions;
  const installed = offers.filter((offer) => offer.installedVersion !== undefined).length;
  const refused = catalog.sources.filter((source) => source.status !== 'verified').length;
  return [
    {
      label: t('Catalogs'),
      value: count(catalog.sources.length),
      note: t('{refused} refused', { refused: count(refused) }),
      ...(refused > 0 ? { tone: 'problem' as const } : {}),
    },
    { label: t('Offered'), value: count(offers.length) },
    { label: t('Installed'), value: count(installed), tone: 'ok' },
    watched(
      t('Updates'),
      offers.filter((offer) => offer.state === 'update').length,
      t('a newer version is offered'),
    ),
    watched(t('Waiting for a restart'), offers.filter((offer) => offer.state === 'restart').length),
  ];
}

export function filterOffers(offers: readonly Offer[], search: string, state: OfferState): Offer[] {
  return offers.filter(
    (offer) =>
      (state === 'all' ||
        (state === 'installed' && offer.installedVersion !== undefined) ||
        (state === 'available' && offer.state === 'available') ||
        (state === 'update' && offer.state === 'update')) &&
      matchesText(search, offer.name, offer.id, offer.source),
  );
}

// --- Apps of an organization (MK-030) --------------------------------------------------------

export function appMetrics(apps: readonly OrganizationApp[]): Metric[] {
  const shown = apps.filter((app) => app.enabled).length;
  return [
    { label: t('Apps'), value: count(apps.length) },
    { label: t('Shown'), value: count(shown), tone: 'ok' },
    { label: t('Hidden'), value: count(apps.length - shown) },
    { label: t('Pinned'), value: count(apps.filter((app) => app.pinned).length) },
    {
      label: t('For who holds its permission'),
      value: count(apps.filter((app) => app.restricted).length),
    },
  ];
}

export function filterApps(
  apps: readonly OrganizationApp[],
  search: string,
): { app: OrganizationApp; index: number }[] {
  return apps
    .map((app, index) => ({ app, index }))
    .filter(({ app }) => matchesText(search, app.title, app.extensionId, app.appId));
}

// --- Credentials (MK-062, MK-127) ------------------------------------------------------------

export function secretMetrics(secrets: readonly Secret[] | undefined): Metric[] {
  if (!secrets) {
    return [];
  }
  const restricted = secrets.filter((secret) => secret.extension !== null).length;
  return [
    { label: t('Credentials'), value: count(secrets.length) },
    { label: t('For one extension'), value: count(restricted) },
    { label: t('For any extension'), value: count(secrets.length - restricted) },
  ];
}

export function filterSecrets(secrets: readonly Secret[], search: string): Secret[] {
  return secrets.filter((secret) =>
    matchesText(search, secret.name, secret.description, secret.extension, secret.kind),
  );
}

// --- Quotas (MK-076) -------------------------------------------------------------------------

export function quotaMetrics(quotas: readonly Quota[] | undefined): Metric[] {
  if (!quotas) {
    return [];
  }
  const shares = quotas.map((quota) => share(quota));
  return [
    { label: t('Measures'), value: count(quotas.length) },
    {
      label: t('With a limit'),
      value: count(quotas.filter((quota) => quota.limit !== null).length),
    },
    watched(
      t('Near the limit'),
      shares.filter((value) => value !== undefined && value >= 80 && value < 100).length,
      t('80% or more'),
    ),
    {
      ...watched(
        t('At the limit'),
        shares.filter((value) => value !== undefined && value >= 100).length,
      ),
      ...(shares.some((value) => value !== undefined && value >= 100)
        ? { tone: 'problem' as const }
        : {}),
    },
  ];
}

export function filterQuotas(quotas: readonly Quota[], search: string): Quota[] {
  return quotas.filter((quota) => matchesText(search, quota.label, quota.measure, quota.extension));
}

// --- External origins (MK-128) ---------------------------------------------------------------

/** Where the origins the page lists come from. */
export type OriginSource = 'all' | AllowedOrigin['source'];

export function originMetrics(policy: ContentSecurityPolicy | undefined): Metric[] {
  if (!policy) {
    return [];
  }
  const configured = policy.origins.filter((origin) => origin.source === 'CONFIGURATION').length;
  return [
    {
      label: t('Policy'),
      value: policy.enabled ? t('Sent') : t('Not sent'),
      note: policy.enabled ? t('the browser enforces it') : t('outside production'),
      ...(policy.enabled ? { tone: 'ok' as const } : { tone: 'warn' as const }),
    },
    { label: t('Origins'), value: count(policy.origins.length) },
    { label: t('From the configuration'), value: count(configured) },
    { label: t('Added here'), value: count(policy.origins.length - configured) },
  ];
}

export function filterOrigins(
  origins: readonly AllowedOrigin[],
  search: string,
  source: OriginSource,
): AllowedOrigin[] {
  return origins.filter(
    (origin) =>
      (source === 'all' || origin.source === source) &&
      matchesText(search, origin.origin, origin.addedBy),
  );
}

// --- Service identities (MK-124) -------------------------------------------------------------

export function serviceMetrics(
  identities: readonly ServiceIdentity[] | undefined,
  maxKeys: number,
): Metric[] {
  if (!identities) {
    return [];
  }
  const keys = identities.reduce((total, identity) => total + identity.keys.length, 0);
  return [
    { label: t('Service identities'), value: count(identities.length) },
    { label: t('Live keys'), value: count(keys) },
    watched(
      t('Without a key'),
      identities.filter((identity) => identity.keys.length === 0).length,
      t('they call nothing'),
    ),
    watched(
      t('With two keys'),
      identities.filter((identity) => identity.keys.length >= maxKeys).length,
      t('revoke the old one after a rotation'),
    ),
  ];
}

export function filterServices(
  identities: readonly ServiceIdentity[],
  search: string,
): ServiceIdentity[] {
  return identities.filter((identity) =>
    matchesText(
      search,
      identity.name,
      identity.description,
      ...identity.apis,
      ...identity.endpoints,
      ...identity.organizations,
    ),
  );
}

// --- Permissions (MK-056) --------------------------------------------------------------------

export function permissionMetrics(
  declared: readonly DeclaredPermission[],
  profiles: readonly PermissionProfile[],
  members: readonly OrganizationMember[],
  teams: readonly OrganizationTeam[],
): Metric[] {
  const off = declared.filter((permission) => permission.off).length;
  return [
    {
      label: t('Permissions'),
      value: count(declared.length),
      note: t('{off} of extensions turned off', { off: count(off) }),
    },
    { label: t('Profiles'), value: count(profiles.length) },
    { label: t('People'), value: count(members.length) },
    { label: t('Teams'), value: count(teams.length) },
  ];
}

export function filterProfiles(
  profiles: readonly PermissionProfile[],
  search: string,
): PermissionProfile[] {
  return profiles.filter((profile) => matchesText(search, profile.name, profile.description));
}

export function filterMembers(
  members: readonly OrganizationMember[],
  search: string,
): OrganizationMember[] {
  return members.filter((member) => matchesText(search, member.displayName, member.username));
}

export function filterTeams(
  teams: readonly OrganizationTeam[],
  search: string,
): OrganizationTeam[] {
  return teams.filter((team) => matchesText(search, team.name));
}

// --- Settings of the platform (MK-048) -------------------------------------------------------

/** A setting of the platform, as a row of its page. */
export interface PlatformSetting {
  readonly id: keyof PlatformSettings;
  readonly title: string;
  readonly description: string;
  readonly on: boolean;
}

export function platformSettings(settings: PlatformSettings | undefined): PlatformSetting[] {
  if (!settings) {
    return [];
  }
  return [
    {
      id: 'registration',
      title: t('People can create their own account'),
      description: t(
        'On the sign-in page, in the organizations that allow it. A link sent by mail confirms the address before the first sign-in.',
      ),
      on: settings.registration,
    },
  ];
}

export function settingMetrics(settings: readonly PlatformSetting[]): Metric[] {
  if (settings.length === 0) {
    return [];
  }
  const on = settings.filter((setting) => setting.on).length;
  return [
    { label: t('Settings'), value: count(settings.length) },
    { label: t('On'), value: count(on), tone: 'ok' },
    { label: t('Off'), value: count(settings.length - on) },
  ];
}

export function filterSettings(
  settings: readonly PlatformSetting[],
  search: string,
): PlatformSetting[] {
  return settings.filter((setting) => matchesText(search, setting.title, setting.description));
}
