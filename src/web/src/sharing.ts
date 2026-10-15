// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  EventBus,
  NO_LIVE,
  PresenceStore,
  SHARE_TOPIC,
  dataCollections,
  isMosaikitExtension,
  type ExtensionContext,
} from '@mosaikit/sdk';
import { KernelError, toError, type OrganizationTeam } from './api.js';
import { language, t } from './i18n.js';

/**
 * The sharing of the resources of extensions in the shell (MK-055): the dialog, the same for every
 * resource type, and the page that opens a link. Without the view, so that it can be tested.
 */

/** The topic on which a frontend asks the shell to open the sharing dialog for one of its resources. */
export { SHARE_TOPIC };

/** The path of the shell that opens a link, followed by its secret. */
export const SHARED_PATH = '/shared/';

/** Headers with which a request carries a link and its password. */
export const LINK_HEADER = 'X-Mosaikit-Link';
export const LINK_PASSWORD_HEADER = 'X-Mosaikit-Link-Password';

/** A resource registered by an extension (MK-054). */
export interface ResourceRef {
  readonly extension: string;
  readonly type: string;
  readonly id: string;
}

/** A level of a resource type, from the lowest to the highest. */
export interface SharingLevel {
  readonly name: string;
  readonly title: string;
  readonly edits: boolean;
  readonly i18n?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export type SubjectKind = 'person' | 'group' | 'organization' | 'link' | 'public';

/** A resource as the dialog opens it. */
export interface SharedResource {
  readonly resource: ResourceRef;
  readonly title: string;
  readonly link: string;
  readonly owner: string | null;
  readonly ownerName: string | null;
  /** The highest level of the signed-in person. */
  readonly level: string;
  readonly canShare: boolean;
  readonly levels: readonly SharingLevel[];
  readonly subjects: readonly SubjectKind[];
  readonly linkLevel: string;
  /** The latest expiry a link made now may have; none when the type has no links. */
  readonly linkMaxExpiry: string | null;
}

/** A grant as the dialog lists it. */
export interface SharingGrant {
  readonly id: string;
  readonly subject: {
    readonly kind: SubjectKind;
    readonly id?: string;
    readonly name?: string;
    readonly email?: string;
  };
  readonly level: string;
  readonly grantedBy: string;
  readonly grantedByName?: string;
  readonly granted: string;
  readonly expires?: string;
  readonly password?: boolean;
}

/**
 * The accesses that a resource inherits from a resource above it (MK-136): who owns that resource and
 * its grants, at the levels of its type.
 */
export interface InheritedAccess {
  readonly resource: ResourceRef;
  readonly title: string;
  readonly link: string;
  readonly owner: string | null;
  readonly ownerName: string | null;
  readonly levels: readonly SharingLevel[];
  readonly grants: readonly SharingGrant[];
}

/** A link just made: its token is shown this once. */
export interface MadeLink {
  readonly grant: SharingGrant;
  readonly address: string;
  readonly token: string;
}

/** Who to share with. */
export type NewSubject =
  | { readonly kind: 'person'; readonly email: string }
  | { readonly kind: 'group'; readonly id: string }
  | { readonly kind: 'organization' }
  | { readonly kind: 'public' };

/** The element of an extension that shows a resource opened with a link. */
export interface SharedView {
  readonly extension: string;
  readonly version: string;
  readonly entry: string;
  readonly element: string;
}

/** What a link opens. */
export interface LinkAccess {
  readonly resource: ResourceRef;
  readonly title: string;
  readonly link: string;
  readonly level: string;
  readonly expires: string;
  readonly view?: SharedView;
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const EXTENSION = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const TYPE = /^[a-z][a-z0-9-]{0,47}$/;

/** The resource that a frontend asks to share, or `undefined` when the payload is not one. */
export function resourceOf(payload: unknown): ResourceRef | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const { extension, type, id } = payload as Record<string, unknown>;
  if (
    typeof extension !== 'string' ||
    typeof type !== 'string' ||
    typeof id !== 'string' ||
    !EXTENSION.test(extension) ||
    !TYPE.test(type) ||
    !ID.test(id)
  ) {
    return undefined;
  }
  return { extension, type, id };
}

function resourcePath(ref: ResourceRef): string {
  return `/api/v1/sharing/resources/${[ref.extension, ref.type, ref.id].map(encodeURIComponent).join('/')}`;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await toError(response);
  }
  return (await response.json()) as T;
}

/** The REST API of sharing (`/api/v1/sharing`), with the credentials of the shell. */
export class SharingApi {
  constructor(private readonly request: Request) {}

  open(ref: ResourceRef): Promise<SharedResource> {
    return this.request(resourcePath(ref)).then((response) => json<SharedResource>(response));
  }

  grants(ref: ResourceRef): Promise<SharingGrant[]> {
    return this.request(`${resourcePath(ref)}/grants`).then((response) =>
      json<SharingGrant[]>(response),
    );
  }

  /** The accesses inherited from each resource above, from the parent upwards (MK-136). */
  inherited(ref: ResourceRef): Promise<InheritedAccess[]> {
    return this.request(`${resourcePath(ref)}/inherited`).then((response) =>
      json<InheritedAccess[]>(response),
    );
  }

  grant(ref: ResourceRef, subject: NewSubject, level: string): Promise<SharingGrant> {
    return this.request(`${resourcePath(ref)}/grants`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, level }),
    }).then((response) => json<SharingGrant>(response));
  }

  createLink(
    ref: ResourceRef,
    level: string,
    expires: string,
    password: string | undefined,
  ): Promise<MadeLink> {
    return this.request(`${resourcePath(ref)}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, expires, ...(password ? { password } : {}) }),
    }).then((response) => json<MadeLink>(response));
  }

  async revoke(grant: string): Promise<void> {
    const response = await this.request(`/api/v1/sharing/grants/${encodeURIComponent(grant)}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw await toError(response);
    }
  }
}

/** The title of a level in the language of the shell, from the manifest of the extension (MK-053). */
export function levelTitle(levels: readonly SharingLevel[], name: string): string {
  const level = levels.find((candidate) => candidate.name === name);
  return level?.i18n?.[language()]?.title ?? level?.title ?? name;
}

/** Who a grant is for, as the dialog names them. */
export function subjectLabel(grant: SharingGrant): string {
  const subject = grant.subject;
  switch (subject.kind) {
    case 'person':
      return subject.name ?? subject.email ?? t('A person');
    case 'group':
      return t('Team {name}', { name: subject.name ?? '' });
    case 'organization':
      return t('Everyone in {name}', { name: subject.name ?? t('the organization') });
    case 'public':
      return t('Everyone, also without an account');
    case 'link':
      return grant.password
        ? t('Link with a password, until {date}', { date: day(grant.expires ?? '') })
        : t('Link, until {date}', { date: day(grant.expires ?? '') });
  }
}

/** The levels a kind of subject may get: the lowest for the public, up to the link level for a link. */
export function levelsFor(resource: SharedResource, kind: SubjectKind): SharingLevel[] {
  const names = resource.levels.map((level) => level.name);
  const own = names.indexOf(resource.level);
  const cap =
    kind === 'public' ? 0 : kind === 'link' ? names.indexOf(resource.linkLevel) : names.length - 1;
  // Never above the level of the person who shares.
  const top = Math.min(cap, own < 0 ? names.length - 1 : own);
  return resource.levels.filter((_, index) => index <= top);
}

/** Who may share the resource, as the dialog says it. */
export function whoShares(resource: SharedResource): string {
  const top = resource.levels.at(-1)?.name ?? '';
  const level = levelTitle(resource.levels, top);
  return resource.ownerName
    ? t(
        '{owner}, who owns it, the people with the level {level} and the administrators of the organization can share it.',
        {
          owner: resource.ownerName,
          level,
        },
      )
    : t(
        'The people with the level {level} and the administrators of the organization can share it.',
        {
          level,
        },
      );
}

/** A date in the language of the shell; the value as it is when it is not one. */
export function day(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime())
    ? instant
    : date.toLocaleDateString(language(), { dateStyle: 'medium' });
}

/** A day as the value of a date field, `YYYY-MM-DD`, in local time. */
export function dateValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The expiry of a link chosen as a day: the end of that day, but never after the latest expiry the
 * installation allows, nor in the past.
 *
 * @returns the instant, or `undefined` when the day is not valid or already over
 */
export function expiryOf(
  dayValue: string,
  max: string | null,
  now: Date = new Date(),
): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayValue);
  if (!match) {
    return undefined;
  }
  const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 0);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) {
    return undefined;
  }
  const latest = max ? new Date(max) : undefined;
  const chosen = latest && end.getTime() > latest.getTime() ? latest : end;
  return chosen.toISOString();
}

/** The default day of a new link: in a week, or the last day allowed when that is sooner. */
export function defaultLinkDay(max: string | null, now: Date = new Date()): string {
  const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const latest = max ? new Date(max) : undefined;
  return dateValue(latest && latest.getTime() < week.getTime() ? latest : week);
}

/** The address to give to people for a link. */
export function linkAddress(token: string, origin: string = location.origin): string {
  return `${origin}${SHARED_PATH}${token}`;
}

/** The secret of a link from a path of the shell, `/shared/<secret>`. */
export function tokenOf(path: string): string | undefined {
  if (!path.startsWith(SHARED_PATH)) {
    return undefined;
  }
  const token = decodeURIComponent(path.slice(SHARED_PATH.length)).replace(/\/+$/, '');
  return token && !token.includes('/') ? token : undefined;
}

/** What the dialog tells the page around it. */
export interface ShareDialogEvents {
  /** The state changed: render again. */
  changed(): void;
  /** A message for the people who use the dialog. */
  announce(message: string): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The sharing dialog (MK-055): the resource, the level of the person, the grants with the names of
 * their subjects, and what the person may do with them.
 */
export class ShareDialogState {
  resource: SharedResource | undefined;
  grants: readonly SharingGrant[] = [];
  /** The accesses that come from the resources above, from the parent upwards (MK-136). */
  inherited: readonly InheritedAccess[] = [];
  teams: readonly OrganizationTeam[] = [];
  /** The link just made, whose token is shown once. */
  madeLink: MadeLink | undefined;
  /** Why the resource could not be opened. */
  failure: string | undefined;
  private ref: ResourceRef | undefined;

  constructor(
    private readonly api: Pick<
      SharingApi,
      'open' | 'grants' | 'inherited' | 'grant' | 'createLink' | 'revoke'
    >,
    private readonly listTeams: () => Promise<OrganizationTeam[]>,
    private readonly events: ShareDialogEvents,
  ) {}

  /** Opens a resource: its level for the person and, for who may share, its grants and the teams. */
  async load(ref: ResourceRef): Promise<void> {
    this.ref = ref;
    this.resource = undefined;
    this.grants = [];
    this.inherited = [];
    this.madeLink = undefined;
    this.failure = undefined;
    try {
      this.resource = await this.api.open(ref);
      if (this.resource.canShare) {
        const [grants, inherited, teams] = await Promise.all([
          this.api.grants(ref),
          this.api.inherited(ref),
          this.resource.subjects.includes('group') ? this.listTeams().catch(() => []) : [],
        ]);
        this.grants = grants;
        this.inherited = inherited;
        this.teams = teams;
      }
    } catch (error) {
      this.failure =
        error instanceof KernelError && error.status === 404
          ? t('You have no access to this resource.')
          : t('The sharing cannot be read: {reason}', { reason: reason(error) });
    }
    this.events.changed();
  }

  /** Shares with a subject at a level, or changes its level. */
  async share(subject: NewSubject, level: string): Promise<boolean> {
    const ref = this.ref;
    if (!ref) {
      return false;
    }
    try {
      const grant = await this.api.grant(ref, subject, level);
      this.grants = [...this.grants.filter((other) => other.id !== grant.id), grant];
      this.events.announce(t('Shared with {subject}.', { subject: subjectLabel(grant) }));
      this.events.changed();
      return true;
    } catch (error) {
      this.events.announce(t('Not shared: {reason}', { reason: reason(error) }));
      return false;
    }
  }

  /** Makes a link; its token is shown until the dialog closes or another link is made. */
  async createLink(level: string, dayValue: string, password: string): Promise<boolean> {
    const ref = this.ref;
    const resource = this.resource;
    if (!ref || !resource) {
      return false;
    }
    const expires = expiryOf(dayValue, resource.linkMaxExpiry);
    if (!expires) {
      this.events.announce(t('Choose a day from tomorrow on.'));
      return false;
    }
    try {
      this.madeLink = await this.api.createLink(ref, level, expires, password || undefined);
      this.grants = [...this.grants, this.madeLink.grant];
      this.events.announce(t('Link made. Copy it now: it is shown only once.'));
      this.events.changed();
      return true;
    } catch (error) {
      this.events.announce(t('The link was not made: {reason}', { reason: reason(error) }));
      return false;
    }
  }

  /** Revokes a grant or a link. */
  async revoke(grant: SharingGrant): Promise<void> {
    try {
      await this.api.revoke(grant.id);
      this.grants = this.grants.filter((other) => other.id !== grant.id);
      if (this.madeLink?.grant.id === grant.id) {
        this.madeLink = undefined;
      }
      this.events.announce(t('Access removed: {subject}.', { subject: subjectLabel(grant) }));
      this.events.changed();
    } catch (error) {
      this.events.announce(t('The access was not removed: {reason}', { reason: reason(error) }));
    }
  }
}

/** The outcome of opening a link. */
export type LinkOutcome =
  | { readonly kind: 'opened'; readonly access: LinkAccess }
  | { readonly kind: 'password'; readonly wrong: boolean }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly reason: string };

/** Opens a link (`POST /api/v1/sharing/links/open`), with its password if it has one. */
export async function openLink(
  request: Request,
  token: string,
  password?: string,
): Promise<LinkOutcome> {
  try {
    const response = await request('/api/v1/sharing/links/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token, ...(password ? { password } : {}) }),
    });
    if (response.status === 404) {
      return { kind: 'not-found' };
    }
    if (response.status === 403) {
      return { kind: 'password', wrong: Boolean(password) };
    }
    return { kind: 'opened', access: await json<LinkAccess>(response) };
  } catch (error) {
    return { kind: 'failed', reason: reason(error) };
  }
}

/**
 * Calls the kernel with a link and its password, without the credentials of the browser: the
 * request is the one of the link, as for people without an account, whoever is signed in.
 */
export function linkRequest(
  token: string,
  password: string | undefined,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Request {
  return (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set(LINK_HEADER, token);
    if (password) {
      headers.set(LINK_PASSWORD_HEADER, password);
    }
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    return fetchImpl(path, { ...init, headers, credentials: 'omit' });
  };
}

/**
 * Makes sure the element that shows a resource opened with a link is defined: when the shell did
 * not load the frontend of its extension (a person without an account), it loads the module and
 * activates it with the link as its only credential.
 *
 * @returns whether the element can be placed
 */
export async function defineSharedView(
  view: SharedView,
  request: Request,
  importModule: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
  registry: Pick<CustomElementRegistry, 'get'> = customElements,
): Promise<boolean> {
  if (registry.get(view.element)) {
    return true;
  }
  const module = await importModule(view.entry);
  const candidate = (module as { default?: unknown }).default;
  if (!isMosaikitExtension(candidate)) {
    return false;
  }
  const context: ExtensionContext = {
    extension: { id: view.extension, version: view.version },
    contributions: [],
    contributionsTo: () => [],
    events: new EventBus(),
    get locale() {
      return language();
    },
    user: { username: '', displayName: '', roles: [] },
    fetch: request,
    data: dataCollections(request, view.extension, NO_LIVE),
    live: NO_LIVE,
    // A link has no organization of a session: no other extension is told present (MK-133).
    extensions: new PresenceStore(),
    notify: () => Promise.reject(new Error('Not available to a link')),
  };
  await candidate.activate(context);
  return registry.get(view.element) !== undefined;
}
