// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { ActiveExtension, FrontendExtension } from '@mosaikit/sdk';
import type { SignInOptions } from './federation.js';

/** Public information returned before sign-in. */
export interface SystemInfo {
  readonly name: string;
  readonly version: string;
  readonly activeExtensions: number;
  /** The theme of the installation (`mosaikit.ui.theme`). */
  readonly theme: string;
  /** How many days "remember me" keeps a person signed in. */
  readonly rememberDays: number;
  /** The logo of the product for light backgrounds, when the theme of the installation brings one (MK-052). */
  readonly logo?: string | null;
  /** The logo for dark backgrounds: the dark scheme and the bar of the shell. */
  readonly logoDark?: string | null;
}

/** Whether the sign-in page offers to create an account (MK-048). */
export interface RegistrationOptions {
  readonly enabled: boolean;
  readonly organizations: readonly { readonly slug: string; readonly name: string }[];
}

/** A self-registration. */
export interface Registration {
  readonly organization: string;
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
}

/** The settings of the platform that administrators change from the interface. */
export interface PlatformSettings {
  readonly registration: boolean;
}

/** An external origin of the content security policy (MK-128), and where it comes from. */
export interface AllowedOrigin {
  readonly origin: string;
  readonly source: 'CONFIGURATION' | 'ADMINISTRATION';
  readonly addedAt: string | null;
  readonly addedBy: string | null;
}

/** The content security policy of the shell, for platform administrators (MK-128). */
export interface ContentSecurityPolicy {
  /** Whether the kernel sends the policy (in production). */
  readonly enabled: boolean;
  readonly policy: string;
  readonly origins: AllowedOrigin[];
}

/** Whether an account may sign in, for platform administrators (MK-125). */
export interface AccountStatus {
  readonly accountId: string;
  readonly username: string;
  readonly displayName: string;
  readonly suspended: boolean;
  readonly suspendedAt: string | null;
  /** The username of the administrator who suspended it. */
  readonly suspendedBy: string | null;
  readonly reason: string | null;
}

/** An organization, for platform administrators. */
export interface OrganizationSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: string;
  readonly identityRealm: string | null;
  readonly emailDomains: readonly string[];
}

/** An organization just deleted (MK-130). */
export interface DeletedOrganization {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly deletedAt: string;
  /** From when a job of the kernel removes its data. */
  readonly removableFrom: string;
  /** How many people lost access to it. */
  readonly members: number;
}

/** A live session of the signed-in person, kept by the kernel (MK-125). */
export interface AccountSession {
  readonly id: string;
  /** `password` for the shell signed in with a password, `realm` for the sign-in of an organization. */
  readonly kind: 'password' | 'realm';
  readonly userAgent: string | null;
  readonly address: string | null;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  /** Whether it is the session of this browser. */
  readonly current: boolean;
}

/** A personal access key of the signed-in person (MK-060); its secret only once, at its creation. */
export interface AccessKey {
  readonly id: string;
  readonly name: string;
  /** The first characters of the key, to tell it apart. */
  readonly prefix: string;
  readonly organizationId: string;
  /** The slug of the organization the key acts on. */
  readonly organization: string;
  /** Whether the key may change anything, or only read. */
  readonly write: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
  readonly expired: boolean;
  /** The whole key, only in the answer to its creation. */
  readonly secret?: string;
}

/** The access keys of the signed-in person, with the longest a new key may last. */
export interface AccessKeys {
  readonly maxValidityDays: number;
  readonly keys: readonly AccessKey[];
}

/** What the person asks for when they create an access key. */
export interface NewAccessKey {
  readonly name: string;
  /** The slug of the organization the key acts on. */
  readonly organization: string;
  /** When the key stops working; the longest the installation allows when absent. */
  readonly expiresAt?: string;
  readonly write: boolean;
}

/** A live key of a service identity (MK-124); its secret only once, at its creation. */
export interface ServiceKey {
  readonly id: string;
  /** The first characters of the key, to tell it apart. */
  readonly prefix: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  /** The whole key, only in the answer to its creation. */
  readonly secret?: string;
}

/** A service identity (MK-124): a caller of the APIs of extensions that is not a person. */
export interface ServiceIdentity {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** The names of the APIs of extensions it may call, as in `/api/v1/ext/<api>/`. */
  readonly apis: readonly string[];
  /** The endpoints of the kernel meant for services it may call. */
  readonly endpoints: readonly string[];
  /** The slugs of the organizations it may name. */
  readonly organizations: readonly string[];
  readonly createdAt: string;
  readonly createdBy: string;
  /** Its live keys, the newest first. */
  readonly keys: readonly ServiceKey[];
}

/** The service identities, with what they may be given. */
export interface ServiceIdentities {
  readonly identities: readonly ServiceIdentity[];
  /** The endpoints of the kernel that can be given. */
  readonly endpoints: readonly string[];
  /** The live keys an identity may have. */
  readonly maxKeys: number;
}

/** What a platform administrator gives a service identity. */
export interface ServiceGrants {
  readonly description: string;
  readonly apis: readonly string[];
  readonly endpoints: readonly string[];
  readonly organizations: readonly string[];
}

/** What a platform administrator asks for when creating a service identity. */
export interface NewServiceIdentity extends ServiceGrants {
  readonly name: string;
}

/** An organization of the signed-in person (MK-017). */
export interface Membership {
  readonly organizationId: string;
  readonly slug: string;
  readonly name: string;
  readonly roles: readonly string[];
  /** `realm`: the organization accepts only its identity provider, not passwords. */
  readonly signIn: 'password' | 'realm' | 'password-or-realm';
}

/** The signed-in account, as seen by the current request. */
export interface Account {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  /** Roles of the current request: those of the platform and those in its organization. */
  readonly roles: readonly string[];
  /** The organization the requests act on, or `null`. */
  readonly organizationId: string | null;
  readonly organization?: string | null;
  readonly memberships?: readonly Membership[];
  /** The personal settings (MK-027). */
  readonly preferences?: Preferences;
}

/** How a measure counts: per calendar month, or what is kept now (MK-076). */
export type QuotaKind = 'counter' | 'gauge';

/** Where the limit of a measure comes from. */
export type QuotaSource = 'organization' | 'installation' | 'none';

/** A measure of an organization with its limit and what it used (MK-076). */
export interface Quota {
  /** `storage`, or `<extension>/<measure>`. */
  readonly measure: string;
  readonly label: string;
  /** `bytes` for storage; what an extension counts otherwise, such as `calls`. */
  readonly unit: string;
  readonly kind: QuotaKind;
  readonly extension: string | null;
  /** The limit in force, `null` for none. */
  readonly limit: number | null;
  readonly source: QuotaSource;
  readonly installationLimit: number | null;
  /** The month of a counter, such as `2026-10`; `null` for a gauge. */
  readonly period: string | null;
  readonly used: number;
}

/** What a person, or nobody, used of a measure. */
export interface QuotaUsageRow {
  readonly measure: string;
  readonly period: string | null;
  readonly person: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  } | null;
  readonly amount: number;
  readonly updatedAt: string | null;
}

/** The consumption of an organization in a month, with the gauges now. */
export interface QuotaUsage {
  readonly period: string;
  readonly periods: readonly string[];
  readonly rows: readonly QuotaUsageRow[];
}

/** An app of the app bar of an organization, with its settings (MK-030). */
/** The kinds of credential that the kernel keeps (MK-062). */
export type SecretKind = 'password' | 'token' | 'key' | 'other';

/** A credential of the organization as its administrators see it: never its value (MK-062). */
export interface Secret {
  readonly name: string;
  readonly kind: SecretKind;
  readonly description: string;
  /** The extension it is meant for, the only one that uses it; `null` for any extension. */
  readonly extension: string | null;
  /** The value masked: `••••`, with the last four characters of a long token or key. */
  readonly hint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** A credential to store or replace; without `value` a replacement keeps the value. */
export interface SecretDraft {
  readonly name?: string;
  readonly kind: SecretKind;
  readonly value?: string;
  readonly description?: string;
  readonly extension?: string | null;
}

export interface OrganizationApp {
  readonly extensionId: string;
  readonly appId: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly pinned: boolean;
  /** Deprecated by `restricted`: `['organization-admin']` when restricted, empty otherwise. */
  readonly roles?: readonly string[];
  /** Whether only the people who hold the permission of the app see it (MK-056). */
  readonly restricted?: boolean;
  /** The permission of the app, `<extension>:use-<app>`. */
  readonly permission?: string;
}

/** A permission declared by an active extension, or the permission of one of its apps (MK-056). */
export interface DeclaredPermission {
  /** `<extension>:<permission>`. */
  readonly id: string;
  readonly extension: string;
  readonly extensionName: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** `title` and `description` by language, as the manifest gives them. */
  readonly i18n?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Whether all the apps of the extension are off for the organization: nobody holds it. */
  readonly off: boolean;
  /** The app the permission opens, for the permission of an app. */
  readonly app?: string;
}

/** A profile of permissions of an organization. */
export interface PermissionProfile {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** `organization-user` for the default profile of members, `null` otherwise. */
  readonly defaultForRole: string | null;
  readonly permissions: readonly string[];
}

/** What a profile is made of, to create or change it. */
export interface ProfileDraft {
  readonly name: string;
  readonly description: string;
  readonly defaultForRole: string | null;
  readonly permissions: readonly string[];
}

/** Where a permission of a person comes from. */
export interface PermissionSource {
  readonly kind: 'administrator' | 'profile' | 'team' | 'exception';
  /** The profile or the team. */
  readonly id?: string;
  readonly name?: string;
}

/** A permission that a person holds, or that is granted while the apps of its extension are off. */
export interface EffectivePermission {
  readonly id: string;
  readonly extension: string;
  readonly name: string;
  readonly title: string;
  readonly granted: boolean;
  /** `apps-off` when granted but not held. */
  readonly withheld: string | null;
  readonly sources: readonly PermissionSource[];
}

/** The permissions of a member of the organization, with their sources. */
export interface MemberPermissions {
  readonly email: string;
  readonly standing: 'administrator' | 'member' | 'guest';
  readonly profile: { readonly id: string; readonly name: string } | null;
  readonly profileAssigned: boolean;
  readonly exceptions: readonly string[];
  readonly permissions: readonly EffectivePermission[];
}

/** The permissions granted to a team. */
export interface TeamPermissions {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly string[];
}

/** A proposed member, for the preview of an invitation. */
export interface ProposedMember {
  readonly role: 'organization-admin' | 'organization-user' | 'organization-guest';
  readonly profile: string | null;
  readonly teams: readonly string[];
}

/** What a proposed member would hold. */
export interface PermissionPreview {
  readonly standing: 'administrator' | 'member' | 'guest';
  readonly profile: { readonly id: string; readonly name: string } | null;
  readonly permissions: readonly EffectivePermission[];
}

/** A member of an organization (MK-017). */
export interface OrganizationMember {
  readonly accountId: string;
  readonly username: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  /** Whether the person signed in through the realm of the organization. */
  readonly linked?: boolean;
  /** Whether the account has a local password; false until the person sets it (MK-048). */
  readonly password?: boolean;
}

/** A local account that an administrator creates for a person (MK-048). */
export interface NewAccount {
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}

/**
 * The link with which a person sets the password of an account an administrator created (MK-048):
 * mailed to the person, or, when the installation sends no mail, returned this once.
 */
export interface PasswordLink {
  readonly member: OrganizationMember;
  readonly mailed: boolean;
  /** The link to pass on, when it was not mailed; the kernel never shows it again. */
  readonly link: string | null;
  readonly expiresAt: string;
}

/** A person invited by the administrators of the organization, with a role, a profile and teams. */
export interface Invitation {
  readonly roles: readonly string[];
  readonly displayName?: string;
  readonly profile?: string | null;
  readonly teams?: readonly string[];
}

/** A team of the organization (MK-032). */
export interface OrganizationTeam {
  readonly id: string;
  readonly name: string;
  readonly kind?: string;
}

/** An app that the signed-in person sees, in the order of the app bar (MK-030). */
export interface ShellApp {
  readonly extensionId: string;
  readonly appId: string;
  readonly pinned: boolean;
}

/** A theme of a theme extension (MK-028): only the values it sets. */
export interface ExtensionTheme {
  readonly id: string;
  readonly title: string;
  readonly font: string | null;
  readonly radius: number | null;
  readonly light: Readonly<Record<string, string>>;
  readonly dark: Readonly<Record<string, string>>;
}

/** The personal settings of a person (MK-027); `null` means the default of the installation. */
export interface Preferences {
  readonly theme: string | null;
  readonly appearance: 'system' | 'light' | 'dark' | 'contrast' | null;
  readonly language: 'en' | 'it' | null;
  /** `<extension id>/<app id>` of the apps hidden from the app bar. */
  readonly hiddenApps: readonly string[];
  /** `<extension id>/<kind>` of the notifications the person does not want (MK-038). */
  readonly mutedNotifications?: readonly string[];
}

/** A notification of the activity feed (MK-038). */
export interface ActivityNotification {
  readonly id: string;
  readonly extensionId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  /** A path of the shell, such as `/app/notes`, or `null`. */
  readonly link: string | null;
  readonly createdAt: string;
  readonly read: boolean;
}

/** A notification that a frontend extension sends (MK-038). */
export interface SentNotification {
  /** Email addresses of people of the organization. */
  readonly to: readonly string[];
  readonly kind: string;
  readonly title: string;
  readonly body?: string;
  readonly link?: string;
}

/** Header with which the shell names the organization chosen by the person. */
/** A tool proposed by an assistant, waiting for the person to confirm it (MK-015). */
export interface ActionDraft {
  id: string;
  tool: string;
  title: string;
  description?: string;
  risk?: string;
  input: unknown;
  status: string;
  createdAt: string;
  expiresAt: string;
}

/** The outcome of confirming a draft. */
export interface Invocation {
  outcome: 'executed' | 'drafted';
  result?: { status: number; body?: unknown };
  draft?: ActionDraft;
}

/** A package offered by a catalog of the marketplace (MK-022). */
export interface Offer {
  source: string;
  id: string;
  version: string;
  name: string;
  size: number;
  publisherKey: string;
  installedVersion?: string;
  /** `restart`: the package of this version is in place and waits for a restart. */
  state: 'available' | 'installed' | 'update' | 'older' | 'restart';
}

/** The catalogs of the marketplace and what they offer. */
export interface Catalog {
  sources: { uri: string; status: 'verified' | 'refused'; keyId?: string; error?: string }[];
  extensions: Offer[];
}

/** A package placed in the extensions directory, used at the next start. */
export interface Installation {
  id: string;
  version: string;
  file: string;
  replaced?: string;
  problems?: string[];
  restartRequired: boolean;
}

/** A message of a conversation with the assistant (MK-024). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What the assistant did for a question. */
export interface AssistantReply {
  reply: string;
  tools: { name: string; outcome: 'executed' | 'drafted' | 'failed' }[];
  drafts: ActionDraft[];
}

export const ORGANIZATION_HEADER = 'X-Mosaikit-Organization';

/** An error returned by the kernel as an RFC 9457 problem detail. */
export class KernelError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'KernelError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Where the shell remembers the organization chosen in the tab, which is not a secret. */
const ORGANIZATION_KEY = 'mosaikit.organization';

/** Header with which the kernel recognises the shell, which shows its own sign-in. */
const CLIENT_HEADER = 'X-Mosaikit-Client';

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function tabStorage(): KeyValueStore | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The service identities of the installation (MK-124). */
const SERVICE_IDENTITIES = '/api/v1/platform/service-identities';
const INSTALLATION_SECRETS = '/api/v1/platform/credentials';
const CONTENT_SECURITY_POLICY = '/api/v1/platform/content-security-policy';
const PLATFORM_ACCOUNTS = '/api/v1/platform/accounts';

/**
 * Minimal client of the kernel API. A local account signs in once: the kernel keeps the session
 * in an HttpOnly cookie that scripts cannot read, so no password stays in the page and a reload
 * keeps the session. Tokens of a realm are kept in memory only.
 */
export class KernelClient {
  private authorization: string | undefined;
  private organization: string | undefined;
  private cookieSession = false;

  constructor(
    private readonly fetchImpl: Fetch = (input, init) => fetch(input, init),
    private readonly storage: KeyValueStore | undefined = tabStorage(),
  ) {}

  /** Opens a session of the shell for a local account, and returns the account. */
  async signIn(username: string, password: string): Promise<Account> {
    const response = await this.fetchImpl('/api/v1/accounts/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', [CLIENT_HEADER]: 'shell' },
      body: new URLSearchParams({ username, password }).toString(),
    });
    if (!response.ok) {
      throw new KernelError(
        response.status,
        'Unauthorized',
        response.status === 401
          ? 'The email or the password is not correct, or the email address is not confirmed yet.'
          : 'Sign-in failed. Try again.',
      );
    }
    this.cookieSession = true;
    this.organization = undefined;
    this.storage?.removeItem(ORGANIZATION_KEY);
    return this.getJson<Account>('/api/v1/accounts/me');
  }

  /**
   * Finds the session of a local account again after a reload, in the organization chosen before;
   * `undefined` when there is none.
   */
  async resumeSession(): Promise<Account | undefined> {
    this.organization = this.storage?.getItem(ORGANIZATION_KEY) ?? undefined;
    const response = await this.request('/api/v1/accounts/session');
    if (response.status !== 200) {
      this.organization = undefined;
      return undefined;
    }
    this.cookieSession = true;
    return (await response.json()) as Account;
  }

  /** Remembers the signed-in local account on this browser, with an HttpOnly cookie. */
  async remember(): Promise<void> {
    const response = await this.request('/api/v1/accounts/session/remembrance', {
      method: 'POST',
    });
    if (!response.ok) {
      throw new KernelError(response.status, 'Not remembered', 'This browser is not remembered.');
    }
  }

  /** Uses an access token of the realm of an organization for the following calls, and checks it. */
  async signInWithToken(accessToken: string): Promise<Account> {
    this.authorization = `Bearer ${accessToken}`;
    try {
      return await this.getJson<Account>('/api/v1/accounts/me');
    } catch (error) {
      this.authorization = undefined;
      throw error;
    }
  }

  /** Replaces the access token after a refresh. */
  useToken(accessToken: string): void {
    this.authorization = `Bearer ${accessToken}`;
  }

  /** Whether people can create their own account, and in which organizations. */
  registrationOptions(): Promise<RegistrationOptions> {
    return this.getJson<RegistrationOptions>('/api/v1/accounts/registration-options');
  }

  /**
   * Creates an account; resolves to `true` when a link was sent to confirm the address before the
   * person can sign in.
   */
  async register(registration: Registration): Promise<boolean> {
    const response = await this.request('/api/v1/accounts/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration),
    });
    if (!response.ok) {
      throw await toError(response);
    }
    return response.status === 202;
  }

  /** Confirms an email address with the token of the link sent to it. */
  async confirmEmail(token: string): Promise<void> {
    await this.send('/api/v1/accounts/confirmations', { token });
  }

  /** Sends the confirmation link to an address again; the kernel never says if it exists. */
  async resendConfirmation(email: string): Promise<void> {
    await this.send('/api/v1/accounts/confirmations/requests', { email });
  }

  /** The themes of the active theme extensions (MK-028); anyone can read them, before signing in too. */
  themes(): Promise<ExtensionTheme[]> {
    return this.getJson<ExtensionTheme[]>('/api/v1/system/themes');
  }

  /** The activity feed of the signed-in person in the organization, newest first (MK-038). */
  activity(): Promise<{ unread: number; notifications: ActivityNotification[] }> {
    return this.getJson('/api/v1/notifications');
  }

  async markRead(id: string): Promise<void> {
    await this.send(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {});
  }

  async markAllRead(): Promise<void> {
    await this.send('/api/v1/notifications/read', {});
  }

  /** Notifies people of the organization as an extension. */
  async notify(extensionId: string, notification: SentNotification): Promise<void> {
    await this.send('/api/v1/notifications', { extension: extensionId, ...notification });
  }

  /** The apps that the signed-in person sees, in order (MK-030). */
  shellApps(): Promise<ShellApp[]> {
    return this.getJson<ShellApp[]>('/api/v1/shell/apps');
  }

  /** The apps of an organization with their settings, for its administrators. */
  organizationApps(slug: string): Promise<OrganizationApp[]> {
    return this.getJson<OrganizationApp[]>(
      `/api/v1/organizations/${encodeURIComponent(slug)}/apps`,
    );
  }

  changeOrganizationApps(
    slug: string,
    apps: readonly OrganizationApp[],
  ): Promise<OrganizationApp[]> {
    return this.sendJson<OrganizationApp[]>(
      `/api/v1/organizations/${encodeURIComponent(slug)}/apps`,
      'PUT',
      apps,
    );
  }

  /** The measures of an organization with their limits and consumption (MK-076). */
  quotas(slug: string): Promise<Quota[]> {
    return this.getJson<Quota[]>(quotasPath(slug));
  }

  /** The consumption of an organization by measure and person, in a month or this month. */
  quotaUsage(slug: string, period?: string): Promise<QuotaUsage> {
    const query = period ? `?period=${encodeURIComponent(period)}` : '';
    return this.getJson<QuotaUsage>(`${quotasPath(slug)}/usage${query}`);
  }

  /** Sets the limit of a measure for an organization, `null` for none (platform administrators). */
  setQuota(slug: string, measure: string, limit: number | null): Promise<Quota> {
    return this.sendJson<Quota>(`${quotasPath(slug)}/${measurePath(measure)}`, 'PUT', { limit });
  }

  /** Removes the limit set for an organization: the default of the installation applies. */
  removeQuota(slug: string, measure: string): Promise<Quota> {
    return this.sendJson<Quota>(`${quotasPath(slug)}/${measurePath(measure)}`, 'DELETE');
  }

  /** The credentials of an organization, without their values, for its administrators (MK-062). */
  secrets(slug: string): Promise<Secret[]> {
    return this.getJson<Secret[]>(secretsPath(slug));
  }

  storeSecret(slug: string, draft: SecretDraft): Promise<Secret> {
    return this.sendJson<Secret>(secretsPath(slug), 'POST', draft);
  }

  replaceSecret(slug: string, name: string, draft: SecretDraft): Promise<Secret> {
    return this.sendJson<Secret>(`${secretsPath(slug)}/${encodeURIComponent(name)}`, 'PUT', draft);
  }

  async deleteSecret(slug: string, name: string): Promise<void> {
    await this.sendJson<undefined>(`${secretsPath(slug)}/${encodeURIComponent(name)}`, 'DELETE');
  }

  /** The credentials of the installation, without their values, for platform administrators (MK-127). */
  installationSecrets(): Promise<Secret[]> {
    return this.getJson<Secret[]>(INSTALLATION_SECRETS);
  }

  storeInstallationSecret(draft: SecretDraft): Promise<Secret> {
    return this.sendJson<Secret>(INSTALLATION_SECRETS, 'POST', draft);
  }

  replaceInstallationSecret(name: string, draft: SecretDraft): Promise<Secret> {
    return this.sendJson<Secret>(
      `${INSTALLATION_SECRETS}/${encodeURIComponent(name)}`,
      'PUT',
      draft,
    );
  }

  async deleteInstallationSecret(name: string): Promise<void> {
    await this.sendJson<undefined>(`${INSTALLATION_SECRETS}/${encodeURIComponent(name)}`, 'DELETE');
  }

  /** The permissions of the signed-in person in the organization, `<extension>:<permission>` (MK-056). */
  shellPermissions(): Promise<string[]> {
    return this.getJson<string[]>('/api/v1/shell/permissions');
  }

  /** The permissions that the active extensions declare, for the administrators of the organization. */
  declaredPermissions(slug: string): Promise<DeclaredPermission[]> {
    return this.getJson<DeclaredPermission[]>(permissionsPath(slug));
  }

  permissionProfiles(slug: string): Promise<PermissionProfile[]> {
    return this.getJson<PermissionProfile[]>(`${permissionsPath(slug)}/profiles`);
  }

  createProfile(slug: string, profile: ProfileDraft): Promise<PermissionProfile> {
    return this.sendJson<PermissionProfile>(`${permissionsPath(slug)}/profiles`, 'POST', profile);
  }

  changeProfile(slug: string, id: string, profile: ProfileDraft): Promise<PermissionProfile> {
    return this.sendJson<PermissionProfile>(
      `${permissionsPath(slug)}/profiles/${encodeURIComponent(id)}`,
      'PUT',
      profile,
    );
  }

  async deleteProfile(slug: string, id: string): Promise<void> {
    await this.sendJson<undefined>(
      `${permissionsPath(slug)}/profiles/${encodeURIComponent(id)}`,
      'DELETE',
    );
  }

  /** What a member holds and why. */
  memberPermissions(slug: string, email: string): Promise<MemberPermissions> {
    return this.getJson<MemberPermissions>(
      `${permissionsPath(slug)}/members/${encodeURIComponent(email)}`,
    );
  }

  /** Assigns a profile to a member, or with `null` gives back the default profile. */
  assignProfile(slug: string, email: string, profile: string | null): Promise<MemberPermissions> {
    return this.sendJson<MemberPermissions>(
      `${permissionsPath(slug)}/members/${encodeURIComponent(email)}/profile`,
      'PUT',
      { profile },
    );
  }

  /** Grants (`true`) or revokes a permission of a member as a personal exception. */
  setException(
    slug: string,
    email: string,
    permission: string,
    granted: boolean,
  ): Promise<MemberPermissions> {
    return this.sendJson<MemberPermissions>(
      `${permissionsPath(slug)}/members/${encodeURIComponent(email)}/exceptions/${encodeURIComponent(permission)}`,
      granted ? 'PUT' : 'DELETE',
    );
  }

  teamPermissions(slug: string, team: string): Promise<TeamPermissions> {
    return this.getJson<TeamPermissions>(
      `${permissionsPath(slug)}/teams/${encodeURIComponent(team)}`,
    );
  }

  /** Grants (`true`) or revokes a permission of a team. */
  setTeamPermission(
    slug: string,
    team: string,
    permission: string,
    granted: boolean,
  ): Promise<TeamPermissions> {
    return this.sendJson<TeamPermissions>(
      `${permissionsPath(slug)}/teams/${encodeURIComponent(team)}/${encodeURIComponent(permission)}`,
      granted ? 'PUT' : 'DELETE',
    );
  }

  /** What a proposed member would hold, without changing anything: for invitations. */
  previewPermissions(slug: string, proposed: ProposedMember): Promise<PermissionPreview> {
    return this.sendJson<PermissionPreview>(`${permissionsPath(slug)}/preview`, 'POST', proposed);
  }

  /** The members of an organization, for its administrators. */
  organizationMembers(slug: string): Promise<OrganizationMember[]> {
    return this.getJson<OrganizationMember[]>(
      `/api/v1/organizations/${encodeURIComponent(slug)}/members`,
    );
  }

  /** Adds a person to the organization with a role, a profile and teams (MK-056). */
  invite(slug: string, email: string, invitation: Invitation): Promise<OrganizationMember> {
    return this.sendJson<OrganizationMember>(
      `/api/v1/organizations/${encodeURIComponent(slug)}/members/${encodeURIComponent(email)}`,
      'PUT',
      invitation,
    );
  }

  /**
   * Creates a local account in the organization for a person (MK-048), who sets the password with
   * the link of the answer.
   */
  createAccount(slug: string, account: NewAccount): Promise<PasswordLink> {
    return this.sendJson<PasswordLink>(
      `/api/v1/organizations/${encodeURIComponent(slug)}/accounts`,
      'POST',
      account,
    );
  }

  /** Issues a new link to set the password of a member who has none yet; the previous one stops working. */
  issuePasswordLink(slug: string, email: string): Promise<PasswordLink> {
    return this.sendJson<PasswordLink>(
      `/api/v1/organizations/${encodeURIComponent(slug)}/accounts/${encodeURIComponent(email)}/password-link`,
      'POST',
    );
  }

  /** Sets the password of an account with the token of the link an administrator issued (MK-048). */
  async setPassword(token: string, password: string): Promise<void> {
    await this.send('/api/v1/accounts/passwords', { token, password });
  }

  /** The teams that the signed-in person sees: all the teams, for an administrator (MK-032). */
  teams(): Promise<OrganizationTeam[]> {
    return this.getJson<OrganizationTeam[]>('/api/v1/teams');
  }

  /** The personal settings of the signed-in person (MK-027). */
  changePreferences(preferences: Preferences): Promise<Preferences> {
    return this.sendJson<Preferences>('/api/v1/accounts/me/preferences', 'PUT', preferences);
  }

  /** The live sessions of the signed-in person, the most recently seen first (MK-125). */
  sessions(): Promise<AccountSession[]> {
    return this.getJson<AccountSession[]>('/api/v1/accounts/me/sessions');
  }

  /** Ends a session of the signed-in person: its cookie and its "remember me" open nothing any more. */
  async endSession(id: string): Promise<void> {
    const response = await this.request(`/api/v1/accounts/me/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw await toError(response);
    }
  }

  /** The access keys of the signed-in person, the newest first (MK-060). */
  accessKeys(): Promise<AccessKeys> {
    return this.getJson<AccessKeys>('/api/v1/accounts/me/access-keys');
  }

  /** Creates an access key: the answer holds its secret, shown this once. */
  createAccessKey(request: NewAccessKey): Promise<AccessKey> {
    return this.sendJson<AccessKey>('/api/v1/accounts/me/access-keys', 'POST', request);
  }

  /** Revokes an access key: the next request with it is refused. */
  async revokeAccessKey(id: string): Promise<void> {
    const response = await this.request(
      `/api/v1/accounts/me/access-keys/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      throw await toError(response);
    }
  }

  /** The service identities, for platform administrators (MK-124). */
  serviceIdentities(): Promise<ServiceIdentities> {
    return this.getJson<ServiceIdentities>(SERVICE_IDENTITIES);
  }

  /** Creates a service identity: the answer holds the secret of its first key, shown this once. */
  createServiceIdentity(request: NewServiceIdentity): Promise<ServiceIdentity> {
    return this.sendJson<ServiceIdentity>(SERVICE_IDENTITIES, 'POST', request);
  }

  /** Changes what a service identity may call; its next call follows. */
  grantServiceIdentity(id: string, grants: ServiceGrants): Promise<ServiceIdentity> {
    return this.sendJson<ServiceIdentity>(
      `${SERVICE_IDENTITIES}/${encodeURIComponent(id)}`,
      'PUT',
      grants,
    );
  }

  /** Creates a new key for a service identity, to rotate the old one: its secret, shown this once. */
  createServiceKey(id: string): Promise<ServiceKey> {
    return this.sendJson<ServiceKey>(
      `${SERVICE_IDENTITIES}/${encodeURIComponent(id)}/keys`,
      'POST',
    );
  }

  /** Revokes a key of a service identity: its next call is refused. */
  async revokeServiceKey(id: string, key: string): Promise<void> {
    const response = await this.request(
      `${SERVICE_IDENTITIES}/${encodeURIComponent(id)}/keys/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      throw await toError(response);
    }
  }

  /** The settings of the platform, for platform administrators. */
  platformSettings(): Promise<PlatformSettings> {
    return this.getJson<PlatformSettings>('/api/v1/platform/settings');
  }

  changePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings> {
    return this.sendJson<PlatformSettings>('/api/v1/platform/settings', 'PUT', settings);
  }

  /** The external origins of the content security policy (MK-128). */
  contentSecurityPolicy(): Promise<ContentSecurityPolicy> {
    return this.getJson<ContentSecurityPolicy>(CONTENT_SECURITY_POLICY);
  }

  allowOrigin(origin: string): Promise<AllowedOrigin> {
    return this.sendJson<AllowedOrigin>(`${CONTENT_SECURITY_POLICY}/origins`, 'POST', { origin });
  }

  async disallowOrigin(origin: string): Promise<void> {
    await this.sendJson<undefined>(
      `${CONTENT_SECURITY_POLICY}/origins?origin=${encodeURIComponent(origin)}`,
      'DELETE',
    );
  }

  /** Every organization, by name, for platform administrators. */
  organizations(): Promise<OrganizationSummary[]> {
    return this.getJson<OrganizationSummary[]>('/api/v1/organizations');
  }

  /**
   * Deletes an organization, confirmed by its slug (MK-130): its people lose access at once, and
   * its data are removed after the retention of the installation.
   */
  deleteOrganization(slug: string, confirmation: string): Promise<DeletedOrganization> {
    return this.sendJson<DeletedOrganization>(
      `/api/v1/organizations/${encodeURIComponent(slug)}?confirmation=${encodeURIComponent(confirmation)}`,
      'DELETE',
    );
  }

  /** The suspended accounts, the most recently suspended first (MK-125). */
  suspendedAccounts(): Promise<AccountStatus[]> {
    return this.getJson<AccountStatus[]>(`${PLATFORM_ACCOUNTS}/suspended`);
  }

  /** Whether an account may sign in, and why not (MK-125). */
  accountStatus(email: string): Promise<AccountStatus> {
    return this.getJson<AccountStatus>(
      `${PLATFORM_ACCOUNTS}/${encodeURIComponent(email)}/suspension`,
    );
  }

  /** Suspends an account, which ends its sessions at once (MK-125). */
  suspendAccount(email: string, reason: string): Promise<AccountStatus> {
    return this.sendJson<AccountStatus>(
      `${PLATFORM_ACCOUNTS}/${encodeURIComponent(email)}/suspension`,
      'PUT',
      { reason },
    );
  }

  /** Lets a suspended account sign in again (MK-125). */
  reinstateAccount(email: string): Promise<AccountStatus> {
    return this.sendJson<AccountStatus>(
      `${PLATFORM_ACCOUNTS}/${encodeURIComponent(email)}/suspension`,
      'DELETE',
    );
  }

  private async send(path: string, body: unknown): Promise<void> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await toError(response);
    }
  }

  /** How the person with this email address signs in on this site. */
  signInOptions(email: string): Promise<SignInOptions> {
    return this.getJson<SignInOptions>(
      `/api/v1/identity/sign-in-options?email=${encodeURIComponent(email)}`,
    );
  }

  /**
   * Makes the following calls act on an organization of the person (MK-017), and returns the
   * account as seen in it.
   */
  async useOrganization(slug: string | undefined): Promise<Account> {
    this.organization = slug;
    if (slug) {
      this.storage?.setItem(ORGANIZATION_KEY, slug);
    } else {
      this.storage?.removeItem(ORGANIZATION_KEY);
    }
    return this.getJson<Account>('/api/v1/accounts/me');
  }

  /**
   * Forgets the credentials, and ends the session on the kernel (MK-125): the cookie of a local
   * account, or the session of the realm that the access token belongs to.
   */
  signOut(): Promise<void> {
    const ended = this.signedIn
      ? this.request('/api/v1/accounts/session', { method: 'DELETE' }).then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    this.authorization = undefined;
    this.organization = undefined;
    this.cookieSession = false;
    this.storage?.removeItem(ORGANIZATION_KEY);
    return ended;
  }

  get signedIn(): boolean {
    return this.authorization !== undefined || this.cookieSession;
  }

  systemInfo(): Promise<SystemInfo> {
    return this.getJson<SystemInfo>('/api/v1/system/info');
  }

  shellExtensions(): Promise<FrontendExtension[]> {
    return this.getJson<FrontendExtension[]>('/api/v1/shell/extensions');
  }

  /** The extensions active in the organization of the person, with or without a frontend (MK-133). */
  activeExtensions(): Promise<ActiveExtension[]> {
    return this.getJson<ActiveExtension[]>('/api/v1/shell/extensions/active');
  }

  /**
   * The revision of the installed extensions when the kernel watches their directory (development
   * mode), or `undefined` when it does not.
   */
  async extensionRevision(): Promise<number | undefined> {
    const response = await this.request('/api/v1/shell/extensions/revision');
    if (response.status !== 200) {
      return undefined;
    }
    return ((await response.json()) as { revision: number }).revision;
  }

  /** The drafts of tools that the person can still confirm, oldest first (MK-015). */
  actionDrafts(): Promise<ActionDraft[]> {
    return this.getJson<ActionDraft[]>('/api/v1/ai/drafts');
  }

  /** Runs a draft. */
  confirmDraft(id: string): Promise<Invocation> {
    return this.sendJson<Invocation>(
      `/api/v1/ai/drafts/${encodeURIComponent(id)}/confirmation`,
      'POST',
    );
  }

  /** Discards a draft. */
  rejectDraft(id: string): Promise<ActionDraft> {
    return this.sendJson<ActionDraft>(`/api/v1/ai/drafts/${encodeURIComponent(id)}`, 'DELETE');
  }

  /** The catalogs of the marketplace, for platform administrators (MK-022). */
  marketplace(): Promise<Catalog> {
    return this.getJson<Catalog>('/api/v1/marketplace');
  }

  /** Installs a package of a catalog; it takes effect at the next start. */
  install(offer: Pick<Offer, 'source' | 'id' | 'version'>): Promise<Installation> {
    return this.sendJson<Installation>('/api/v1/marketplace/installations', 'POST', {
      source: offer.source,
      id: offer.id,
      version: offer.version,
    });
  }

  /** Installs a package file, for an installation without network. */
  upload(file: Blob): Promise<Installation> {
    return this.sendJson<Installation>(
      '/api/v1/extensions/packages',
      'POST',
      file,
      'application/zip',
    );
  }

  /** Whether the installation has an assistant, and its model (MK-024). */
  assistant(): Promise<{ enabled: boolean; model?: string }> {
    return this.getJson('/api/v1/ai/assistant');
  }

  /** Asks the assistant about the last message of a conversation. */
  ask(messages: readonly ChatMessage[]): Promise<AssistantReply> {
    return this.sendJson<AssistantReply>('/api/v1/ai/assistant/replies', 'POST', { messages });
  }

  /** Calls the API with the stored credentials. Used by extensions through their context. */
  request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.authorization) {
      headers.set('Authorization', this.authorization);
    }
    if (this.organization) {
      headers.set(ORGANIZATION_HEADER, this.organization);
    }
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    headers.set(CLIENT_HEADER, 'shell');
    return this.fetchImpl(path, { ...init, headers });
  }

  private getJson<T>(path: string): Promise<T> {
    return this.sendJson<T>(path, 'GET');
  }

  private async sendJson<T>(
    path: string,
    method: string,
    body?: unknown,
    type = 'application/json',
  ): Promise<T> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { 'Content-Type': type };
      init.body = body instanceof Blob ? body : JSON.stringify(body);
    }
    const response = await this.request(path, init);
    if (!response.ok) {
      throw await toError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}

/** The quotas of an organization (MK-076). */
function quotasPath(slug: string): string {
  return `/api/v1/organizations/${encodeURIComponent(slug)}/quotas`;
}

/** A measure in a path: `<extension>/<measure>` keeps its slash. */
function measurePath(measure: string): string {
  return measure.split('/').map(encodeURIComponent).join('/');
}

/** The credentials of an organization, for its administrators (MK-062). */
function secretsPath(slug: string): string {
  return `/api/v1/organizations/${encodeURIComponent(slug)}/secrets`;
}

/** The permissions of an organization, for its administrators (MK-056). */
function permissionsPath(slug: string): string {
  return `/api/v1/organizations/${encodeURIComponent(slug)}/permissions`;
}

/** The error of a refused call of the kernel API, from its problem (RFC 9457). */
export async function toError(response: Response): Promise<KernelError> {
  if (response.status === 401) {
    return new KernelError(401, 'Unauthorized', 'The email or the password is not correct.');
  }
  try {
    const problem = (await response.json()) as { title?: string; detail?: string };
    return new KernelError(
      response.status,
      problem.title ?? response.statusText,
      problem.detail ?? 'The request failed.',
    );
  } catch {
    return new KernelError(response.status, response.statusText, 'The request failed.');
  }
}
