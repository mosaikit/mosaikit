// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { FrontendPlugin } from '@mosaikit/sdk';
import type { SignInOptions } from './federation.js';

/** Public information returned before sign-in. */
export interface SystemInfo {
  readonly name: string;
  readonly version: string;
  readonly activePlugins: number;
  /** The theme of the installation (`mosaikit.ui.theme`). */
  readonly theme: string;
  /** How many days "remember me" keeps a person signed in. */
  readonly rememberDays: number;
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

/** An app of the app bar of an organization, with its settings (MK-030). */
export interface OrganizationApp {
  readonly pluginId: string;
  readonly appId: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly pinned: boolean;
  /** The roles that see it; empty for everyone. */
  readonly roles: readonly string[];
}

/** An app that the signed-in person sees, in the order of the app bar (MK-030). */
export interface ShellApp {
  readonly pluginId: string;
  readonly appId: string;
  readonly pinned: boolean;
}

/** A theme of a theme plugin (MK-028): only the values it sets. */
export interface PluginTheme {
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
  /** `<plugin id>/<app id>` of the apps hidden from the app bar. */
  readonly hiddenApps: readonly string[];
  /** `<plugin id>/<kind>` of the notifications the person does not want (MK-038). */
  readonly mutedNotifications?: readonly string[];
}

/** A notification of the activity feed (MK-038). */
export interface ActivityNotification {
  readonly id: string;
  readonly pluginId: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  /** A path of the shell, such as `/app/notes`, or `null`. */
  readonly link: string | null;
  readonly createdAt: string;
  readonly read: boolean;
}

/** A notification that a frontend plugin sends (MK-038). */
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
  plugins: Offer[];
}

/** A package placed in the plugins directory, used at the next start. */
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

  /** The themes of the active theme plugins (MK-028); anyone can read them, before signing in too. */
  themes(): Promise<PluginTheme[]> {
    return this.getJson<PluginTheme[]>('/api/v1/system/themes');
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

  /** Notifies people of the organization as a plugin. */
  async notify(pluginId: string, notification: SentNotification): Promise<void> {
    await this.send('/api/v1/notifications', { plugin: pluginId, ...notification });
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

  /** The personal settings of the signed-in person (MK-027). */
  changePreferences(preferences: Preferences): Promise<Preferences> {
    return this.sendJson<Preferences>('/api/v1/accounts/me/preferences', 'PUT', preferences);
  }

  /** The settings of the platform, for platform administrators. */
  platformSettings(): Promise<PlatformSettings> {
    return this.getJson<PlatformSettings>('/api/v1/platform/settings');
  }

  changePlatformSettings(settings: PlatformSettings): Promise<PlatformSettings> {
    return this.sendJson<PlatformSettings>('/api/v1/platform/settings', 'PUT', settings);
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

  /** Forgets the credentials, and ends the session of a local account on the kernel. */
  signOut(): Promise<void> {
    const ended = this.cookieSession
      ? this.fetchImpl('/api/v1/accounts/session', {
          method: 'DELETE',
          headers: { [CLIENT_HEADER]: 'shell' },
        }).then(
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

  shellPlugins(): Promise<FrontendPlugin[]> {
    return this.getJson<FrontendPlugin[]>('/api/v1/shell/plugins');
  }

  /**
   * The revision of the installed plugins when the kernel watches their directory (development
   * mode), or `undefined` when it does not.
   */
  async pluginRevision(): Promise<number | undefined> {
    const response = await this.request('/api/v1/shell/plugins/revision');
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
    return this.sendJson<Installation>('/api/v1/plugins/packages', 'POST', file, 'application/zip');
  }

  /** Whether the installation has an assistant, and its model (MK-024). */
  assistant(): Promise<{ enabled: boolean; model?: string }> {
    return this.getJson('/api/v1/ai/assistant');
  }

  /** Asks the assistant about the last message of a conversation. */
  ask(messages: readonly ChatMessage[]): Promise<AssistantReply> {
    return this.sendJson<AssistantReply>('/api/v1/ai/assistant/replies', 'POST', { messages });
  }

  /** Calls the API with the stored credentials. Used by plugins through their context. */
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
    return (await response.json()) as T;
  }
}

async function toError(response: Response): Promise<KernelError> {
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
