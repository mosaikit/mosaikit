// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { applyTheme, isThemeName, registerTheme, themes as uiThemes } from '@mosaikit/ui';
import { contributionsTo, stringAttribute, type FrontendPlugin } from '@mosaikit/sdk';
import { LitElement, css, html, nothing, svg, type PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  KernelClient,
  KernelError,
  type Account,
  type ActionDraft,
  type ActivityNotification,
  type Preferences,
  type ShellApp,
  type Registration,
  type RegistrationOptions,
  type SystemInfo,
} from './api.js';
import { FederatedSignIn, type Federation, type Tokens } from './federation.js';
import {
  entryForPath,
  initials,
  launcherEntries,
  matching,
  type LauncherEntry,
} from './navigation.js';
import { MkAdminApps } from './mk-admin-apps.js';
import './mk-admin-plugins.js';
import './mk-admin-settings.js';
import './mk-assistant.js';
import './mk-plugin-frame.js';
import './mk-activity.js';
import './mk-settings.js';
import type { SettingsSection } from './mk-settings.js';
import './mk-sign-in.js';
import { browserLanguage, isLanguage, language, setLanguage, t } from './i18n.js';
import type { PasswordSignIn } from './mk-sign-in.js';
import { LiveClient } from './live.js';
import { PluginLoader, type LoadResult } from './plugin-loader.js';

/** How often the shell looks for actions proposed by assistants. */
const DRAFT_REFRESH_MS = 20_000;
/** How often the shell asks whether the watched plugins changed (development mode). */
const PLUGIN_WATCH_MS = 1_000;

/**
 * The pages of administrators: the apps of the organization for its administrators (MK-030), the
 * plugins (MK-022) and the platform (MK-048) for platform administrators.
 */
const ADMIN_PAGES = [
  {
    path: '/admin/apps',
    title: 'Organization apps',
    element: 'mk-admin-apps',
    role: 'organization-admin',
  },
  { path: '/admin/plugins', title: 'Plugins', element: 'mk-admin-plugins', role: 'platform-admin' },
  {
    path: '/admin/settings',
    title: 'Platform',
    element: 'mk-admin-settings',
    role: 'platform-admin',
  },
] as const;

/**
 * Root element of the shell: sign-in, launcher navigation and the area where plugin apps render.
 */
@customElement('mk-shell')
export class MkShell extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    .offline {
      position: fixed;
      z-index: 20;
      left: 50%;
      bottom: 72px;
      transform: translateX(-50%);
      max-width: calc(100% - 32px);
      margin: 0;
      padding: 10px 16px;
      border-radius: var(--mk-radius);
      background: var(--mk-fg);
      color: var(--mk-surface);
      box-shadow: 0 6px 20px rgb(0 0 0 / 0.25);
    }
    .frame {
      display: grid;
      grid-template-rows: 48px 1fr;
      grid-template-columns: 72px minmax(0, 1fr);
      grid-template-areas: 'top top' 'rail main';
      height: 100vh;
    }
    /* The top bar: brand, search of apps and pages, the menu of the person. */
    .top {
      grid-area: top;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 12px 0 16px;
      background: var(--mk-brand);
      color: #ffffff;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 15px;
      min-width: 160px;
    }
    .brand .version {
      font-weight: 400;
      font-size: 12px;
    }
    .rail .badge {
      position: absolute;
      top: 4px;
      right: 14px;
      min-width: 16px;
      padding: 0 4px;
      border-radius: 8px;
      background: var(--mk-danger);
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      line-height: 16px;
    }
    .search {
      position: relative;
      flex: 1;
      max-width: 560px;
      margin: 0 auto;
    }
    .search input {
      width: 100%;
      box-sizing: border-box;
      height: 32px;
      padding: 0 12px 0 34px;
      border: 0;
      border-radius: var(--mk-radius);
      background: #ffffff;
      color: #1a1a1a;
      font: inherit;
      font-size: 14px;
    }
    .search input::placeholder {
      color: #545454;
    }
    .search svg {
      position: absolute;
      left: 10px;
      top: 8px;
      color: #4a4a4a;
    }
    .search [role='listbox'] {
      position: absolute;
      z-index: 10;
      top: 38px;
      left: 0;
      right: 0;
      margin: 0;
      padding: 4px;
      list-style: none;
      background: var(--mk-surface);
      color: var(--mk-fg);
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
    }
    .search [role='option'] {
      padding: 8px 10px;
      border-radius: var(--mk-radius);
      cursor: pointer;
    }
    .search [role='option'][aria-selected='true'] {
      background: var(--mk-accent-soft);
    }
    .avatar {
      display: inline-grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      font-size: 13px;
      font-weight: 700;
      /* Darker than the bar, so that the white initials stay readable (WCAG 2.1 AA). */
      background: rgb(0 0 0 / 0.35);
      color: #ffffff;
    }
    .account {
      padding: 0;
      border: 2px solid transparent;
      border-radius: 50%;
      background: none;
      cursor: pointer;
    }
    .account:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 1px;
    }
    .menu {
      position: fixed;
      inset: 52px 12px auto auto;
      margin: 0;
      width: 300px;
      padding: 16px;
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
      background: var(--mk-surface);
      color: var(--mk-fg);
      box-shadow: 0 12px 32px rgb(0 0 0 / 0.18);
      display: grid;
      gap: 12px;
    }
    .menu .who {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .menu .who .avatar {
      width: 44px;
      height: 44px;
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
    }
    .menu .who strong {
      display: block;
    }
    .menu a {
      color: var(--mk-accent);
      font-weight: 600;
    }
    .menu a:focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    /* The app bar on the left, a bottom bar on phones. */
    .rail {
      grid-area: rail;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 6px 0;
      background: var(--mk-bg);
      border-right: 1px solid var(--mk-line);
      overflow-y: auto;
    }
    .rail .end {
      margin-top: auto;
      display: contents;
    }
    .rail .separator {
      margin-top: auto;
    }
    .rail a {
      position: relative;
      display: grid;
      justify-items: center;
      gap: 2px;
      padding: 8px 2px;
      color: var(--mk-muted);
      text-decoration: none;
      font-size: 11px;
      line-height: 1.2;
      text-align: center;
      overflow-wrap: anywhere;
    }
    .rail a:hover {
      color: var(--mk-fg);
    }
    .rail a[aria-current='page'] {
      color: var(--mk-accent);
      font-weight: 600;
    }
    .rail a[aria-current='page']::before {
      content: '';
      position: absolute;
      left: 0;
      top: 8px;
      bottom: 8px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: var(--mk-accent);
    }
    .rail a:focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: -2px;
    }
    .rail img,
    .rail svg,
    .rail .tile {
      width: 24px;
      height: 24px;
    }
    .tile {
      display: grid;
      place-items: center;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 700;
      background: color-mix(in srgb, var(--mk-accent) 16%, var(--mk-surface));
      color: var(--mk-accent);
    }
    /* The apps on the home page. */
    .apps {
      list-style: none;
      padding: 0;
      margin: 24px 0 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
      max-width: 900px;
    }
    .apps a {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
      color: var(--mk-fg);
      text-decoration: none;
      font-weight: 600;
      background: var(--mk-surface);
    }
    .apps a:hover {
      border-color: var(--mk-accent);
    }
    .apps a:focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    .apps img,
    .apps .tile {
      flex: none;
      width: 36px;
      height: 36px;
      font-size: 13px;
    }
    main {
      grid-area: main;
      padding: 20px 24px;
      min-width: 0;
      overflow: auto;
      background: var(--mk-surface);
    }
    @media (max-width: 640px) {
      .frame {
        grid-template-rows: 48px 1fr 60px;
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: 'top' 'main' 'rail';
      }
      .brand {
        min-width: 0;
      }
      .brand .name,
      .brand .version {
        display: none;
      }
      .rail {
        flex-direction: row;
        padding: 0 4px;
        border-right: 0;
        border-top: 1px solid var(--mk-line);
        overflow-x: auto;
        overflow-y: hidden;
      }
      .rail .separator {
        margin: 0;
      }
      .rail a {
        min-width: 64px;
        padding: 8px 2px 6px;
      }
      .rail a[aria-current='page']::before {
        left: 12px;
        right: 12px;
        top: 0;
        bottom: auto;
        width: auto;
        height: 3px;
        border-radius: 0 0 3px 3px;
      }
      main {
        padding: 16px;
      }
    }
    form {
      display: grid;
      gap: 12px;
      width: min(360px, 100% - 32px);
      margin: 12vh auto 0;
      padding: 24px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
    }
    label {
      display: grid;
      gap: 4px;
      font-size: 13px;
      color: var(--mk-muted);
    }
    input {
      font: inherit;
      padding: 8px 10px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-bg);
      color: var(--mk-fg);
    }
    button {
      font: inherit;
      font-weight: 600;
      padding: 8px 12px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      cursor: pointer;
    }
    button.secondary {
      background: transparent;
      color: var(--mk-fg);
      border-color: var(--mk-line);
    }
    :focus-visible {
      outline: 2px solid var(--mk-accent);
      outline-offset: 2px;
    }
    .error {
      color: var(--mk-danger);
      margin: 0;
    }
    .muted {
      color: var(--mk-muted);
    }
    main > .error,
    .notice {
      margin: 0 0 16px;
      padding: 10px 14px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
    }
    .organization {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pending {
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      padding: 12px 16px;
      margin-bottom: 16px;
    }
    .pending ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 12px;
    }
    .pending pre {
      margin: 4px 0;
      white-space: pre-wrap;
      font-size: 0.85em;
    }
    select {
      font: inherit;
      padding: 4px 8px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-bg);
      color: var(--mk-fg);
    }
  `;

  private readonly client = new KernelClient();
  private readonly federated = new FederatedSignIn();
  private session: { federation: Federation; tokens: Tokens } | undefined;
  private plugins: FrontendPlugin[] = [];
  private loader: PluginLoader | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  @state() private info: SystemInfo | undefined;
  @state() private account: Account | undefined;
  @state() private entries: LauncherEntry[] = [];
  @state() private loadResults: LoadResult[] = [];
  @state() private path = location.pathname;
  @state() private error: string | undefined;
  @state() private drafts: ActionDraft[] = [];
  @state() private assistantModel: string | undefined;
  private draftTimer: ReturnType<typeof setInterval> | undefined;
  private watchTimer: ReturnType<typeof setInterval> | undefined;
  @state() private busy = false;
  /** Email entered at the first step; the password step follows when there is no realm. */
  @state() private email: string | undefined;
  @state() private searchText = '';
  @state() private searchIndex = 0;
  @state() private menuOpen = false;
  /** The activity feed of the person (MK-038). */
  @state() private activity: ActivityNotification[] = [];
  @state() private unread = 0;
  /** The real-time channel of the page (MK-031). */
  private readonly live = new LiveClient();
  private stopActivity: (() => void) | undefined;
  /** Whether the browser has network (MK-029). */
  @state() private online = typeof navigator === 'undefined' ? true : navigator.onLine;
  private readonly onNetwork = (): void => {
    this.online = navigator.onLine;
  };
  /** Why the apps could not be loaded after signing in. */
  @state() private appsError: string | undefined;
  /** The personal settings of the signed-in person (MK-027). */
  @state() private preferences: Preferences | undefined;
  @state() private settingsStatus = '';
  /** The apps that the organization shows to the person, in order (MK-030). */
  @state() private barApps: ShellApp[] | undefined;
  private saves = 0;
  private saving: Promise<void> = Promise.resolve();
  @state() private shellLanguage = browserLanguage();
  /** The page of the sign-in: signing in, creating an account, or waiting for the confirmation. */
  @state() private signInMode: 'sign-in' | 'register' | 'sent' = 'sign-in';
  @state() private registration: RegistrationOptions | undefined;
  @state() private sentTo: string | undefined;
  @state() private notice: string | undefined;

  private readonly onPopState = (): void => {
    this.path = location.pathname;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    setLanguage(this.shellLanguage);
    // A theme plugin installed from the Plugins page is active at once (MK-028).
    this.addEventListener('mk-plugins-changed', () => {
      void this.reloadPlugins()
        .then(() => this.loadBarApps())
        .then(() => this.loadThemes());
    });
    // The administrators of the organization changed its apps (MK-030).
    this.addEventListener('mk-apps-changed', () => void this.loadBarApps());
    window.addEventListener('popstate', this.onPopState);
    window.addEventListener('online', this.onNetwork);
    window.addEventListener('offline', this.onNetwork);
    this.client.systemInfo().then(
      (info) => {
        this.info = info;
        this.applyAppearance();
        void this.loadThemes();
      },
      () => {
        this.error = 'The kernel is not reachable.';
      },
    );
    this.client.registrationOptions().then(
      (options) => {
        this.registration = options;
      },
      () => undefined,
    );
    void this.confirmFromLink()
      .then(() => this.completeFederatedSignIn())
      .then(() => this.resumeSession());
  }

  /** Confirms the address when the page is the link of a confirmation mail (MK-048). */
  private async confirmFromLink(): Promise<void> {
    const url = new URL(location.href);
    const token = url.searchParams.get('confirm');
    if (!token) {
      return;
    }
    url.searchParams.delete('confirm');
    history.replaceState(null, '', url.pathname + url.search);
    this.email = '';
    try {
      await this.client.confirmEmail(token);
      this.notice = t('Your email address is confirmed. Sign in to start.');
    } catch (error) {
      this.error =
        error instanceof KernelError ? error.message : 'The address could not be confirmed.';
    }
  }

  /** After a reload, enters again with the session of a local account, when there is one. */
  private async resumeSession(): Promise<void> {
    if (this.account || this.session) {
      return;
    }
    try {
      const account = await this.client.resumeSession();
      if (account) {
        await this.enter(account);
      }
    } catch {
      // No session: the sign-in form stays.
    }
  }

  override disconnectedCallback(): void {
    clearInterval(this.draftTimer);
    clearInterval(this.watchTimer);
    window.removeEventListener('popstate', this.onPopState);
    window.removeEventListener('online', this.onNetwork);
    window.removeEventListener('offline', this.onNetwork);
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('path') || changed.has('entries')) {
      this.renderApp();
    }
  }

  override render(): unknown {
    // Without network the shell still opens, from the cache of its service worker (MK-029).
    const offline = this.online
      ? nothing
      : html`<p class="offline" role="status">
          ${t('You are offline: what you see may not be up to date, and changes wait for the network.')}
        </p>`;
    if (!this.account) {
      return html`${offline}${this.renderSignIn()}`;
    }
    return html`${offline}
      <div class="frame" @keydown=${this.keyFrame}>
        <header class="top">
          <span class="brand"
            >${mark}<span class="name">${this.info?.name ?? 'Mosaikit'}</span
            ><span class="version">${this.info ? `v${this.info.version}` : nothing}</span></span
          >
          ${this.renderSearch()} ${this.renderAccount()}
        </header>
        ${this.renderWorkspace()}
      </div>`;
  }

  /** The search of the top bar: apps and pages by title, until the global search (MK-040). */
  private renderSearch(): unknown {
    const found = this.searchResults();
    const open = found.length > 0;
    return html`<div class="search">
      ${searchIcon}
      <input
        type="search"
        role="combobox"
        aria-label=${t('Search apps and pages')}
        placeholder=${t('Search apps and pages')}
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant=${open ? `search-${String(this.searchIndex)}` : nothing}
        .value=${this.searchText}
        @input=${this.typeSearch}
        @keydown=${this.keySearch}
        @blur=${this.leaveSearch}
      />
      ${
        open
          ? html`<ul id="search-results" role="listbox" aria-label=${t('Apps and pages')}>
              ${found.map(
                (item, index) =>
                  html`<li
                    id=${`search-${String(index)}`}
                    role="option"
                    aria-selected=${index === this.searchIndex ? 'true' : 'false'}
                    @mousedown=${(event: Event) => {
                      event.preventDefault();
                      this.go(item.route);
                    }}
                  >
                    ${item.title}
                  </li>`,
              )}
            </ul>`
          : nothing
      }
    </div>`;
  }

  /** The menu of the person: who is signed in, the organization, sign-out. */
  private renderAccount(): unknown {
    const account = this.account;
    if (!account) {
      return nothing;
    }
    const name = account.displayName;
    return html`<button
        class="account"
        aria-label=${t('Account: {name}', { name })}
        aria-haspopup="dialog"
        aria-expanded=${this.menuOpen ? 'true' : 'false'}
        @click=${this.toggleMenu}
      >
        <span class="avatar" aria-hidden="true">${initials(name)}</span>
      </button>
      ${
        this.menuOpen
          ? html`<div class="menu" role="dialog" aria-label=${t('Account')}>
              <div class="who">
                <span class="avatar" aria-hidden="true">${initials(name)}</span>
                <span><strong>${name}</strong><span class="muted">${account.username}</span></span>
              </div>
              ${this.renderOrganizationSelector()}
              <a href="/settings" @click=${this.navigate}>${t('Settings')}</a>
              <button class="secondary" @click=${this.signOut}>${t('Sign out')}</button>
            </div>`
          : nothing
      }`;
  }

  /** The apps of the app bar, the kernel pages and the search results share this shape. */
  private destinations(): { title: string; route: string }[] {
    return [
      { title: t('Home'), route: '/' },
      { title: t('Activity'), route: '/activity' },
      { title: t('Settings'), route: '/settings' },
      ...this.entries.map((entry) => ({ title: entry.title, route: entry.route })),
      ...this.adminPages().map((page) => ({ title: t(page.title), route: page.path })),
    ];
  }

  private searchResults(): { title: string; route: string }[] {
    return matching(this.destinations(), this.searchText).slice(0, 8);
  }

  private readonly typeSearch = (event: Event): void => {
    this.searchText = (event.target as HTMLInputElement).value;
    this.searchIndex = 0;
  };

  private readonly keySearch = (event: KeyboardEvent): void => {
    const found = this.searchResults();
    if (event.key === 'ArrowDown' && found.length > 0) {
      event.preventDefault();
      this.searchIndex = (this.searchIndex + 1) % found.length;
    } else if (event.key === 'ArrowUp' && found.length > 0) {
      event.preventDefault();
      this.searchIndex = (this.searchIndex - 1 + found.length) % found.length;
    } else if (event.key === 'Enter') {
      const chosen = found[this.searchIndex];
      if (chosen) {
        event.preventDefault();
        this.go(chosen.route);
      }
    } else if (event.key === 'Escape') {
      this.searchText = '';
    }
  };

  private readonly leaveSearch = (): void => {
    this.searchText = '';
  };

  private readonly toggleMenu = async (): Promise<void> => {
    this.menuOpen = !this.menuOpen;
    if (this.menuOpen) {
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLElement>('.menu select, .menu button')?.focus();
    }
  };

  private readonly keyFrame = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.menuOpen) {
      this.menuOpen = false;
      this.renderRoot.querySelector<HTMLButtonElement>('.account')?.focus();
    }
  };

  /** Opens a page of the shell, as the links of the app bar do. */
  private go(route: string): void {
    this.searchText = '';
    this.menuOpen = false;
    history.pushState(null, '', route);
    // A link can carry a query, such as /app/teams?channel=…, which the app reads itself.
    this.path = new URL(route, location.origin).pathname;
    // An app that stays open reads its new query, as after the back button.
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  /**
   * Registers the themes of the active theme plugins, so that people can choose them and the
   * installation can name one as its theme; a missing value comes from the default theme.
   */
  private async loadThemes(): Promise<void> {
    try {
      for (const theme of await this.client.themes()) {
        registerTheme(theme.id, {
          title: theme.title,
          ...(theme.font ? { font: theme.font } : {}),
          ...(theme.radius === null ? {} : { radius: theme.radius }),
          light: theme.light,
          dark: theme.dark,
        });
      }
      this.applyAppearance();
      this.requestUpdate();
    } catch {
      // Without them the built-in themes remain.
    }
  }

  /** The apps the person may show or hide, in the order of the organization, with the pinned ones. */
  private barEntries(all: LauncherEntry[]): { entry: LauncherEntry; pinned: boolean }[] {
    const bar = this.barApps;
    if (!bar) {
      return all.map((entry) => ({ entry, pinned: false }));
    }
    return bar.flatMap((app) => {
      const entry = all.find(
        (candidate) => candidate.pluginId === app.pluginId && candidate.id === app.appId,
      );
      return entry ? [{ entry, pinned: app.pinned }] : [];
    });
  }

  /** The activity feed (MK-038). */
  private renderActivity(): unknown {
    return html`<mk-activity
      .notifications=${this.activity}
      .unread=${this.unread}
      .language=${this.shellLanguage}
      @mk-open-notification=${this.openNotification}
      @mk-read-all=${this.readAll}
    ></mk-activity>`;
  }

  /** The kinds of notifications the person received or turned off, for the settings. */
  private notificationKinds(): string[] {
    const kinds = new Set(
      this.activity.map((notification) => `${notification.pluginId}/${notification.kind}`),
    );
    for (const muted of this.preferences?.mutedNotifications ?? []) {
      kinds.add(muted);
    }
    return [...kinds].sort();
  }

  /** Reads the activity feed again: at sign-in and when the kernel pushes a notification. */
  private async loadActivity(): Promise<void> {
    if (!this.account?.organization) {
      this.activity = [];
      this.unread = 0;
      return;
    }
    try {
      const feed = await this.client.activity();
      this.activity = feed.notifications;
      this.unread = feed.unread;
    } catch {
      // The feed stays as it was.
    }
  }

  private readonly openNotification = async (
    event: CustomEvent<ActivityNotification>,
  ): Promise<void> => {
    const notification = event.detail;
    if (!notification.read) {
      await this.client.markRead(notification.id).catch(() => undefined);
      await this.loadActivity();
    }
    if (notification.link) {
      this.go(notification.link);
    }
  };

  private readonly readAll = async (): Promise<void> => {
    await this.client.markAllRead().catch(() => undefined);
    await this.loadActivity();
  };

  /** The personal settings page (MK-027). */
  private renderSettings(): unknown {
    const all = launcherEntries(this.plugins);
    return html`<mk-settings
      .preferences=${this.preferences}
      .themes=${uiThemes()}
      .apps=${this.barEntries(all)}
      .sections=${this.settingsSections()}
      .notificationKinds=${this.notificationKinds()}
      .organizations=${this.renderOrganizationSelector()}
      .status=${this.settingsStatus}
      .language=${this.shellLanguage}
      @mk-preferences=${this.savePreferences}
    ></mk-settings>`;
  }

  /**
   * The sections that plugins add to the settings (settings.section), for the people the plugin
   * allows: a section with `roles` shows only to people with one of them.
   */
  private settingsSections(): SettingsSection[] {
    const roles = new Set(this.account?.roles ?? []);
    return contributionsTo(this.plugins, 'settings.section').flatMap((contribution) => {
      const element = stringAttribute(contribution, 'element');
      const allowed = contribution.attributes.roles;
      if (!element || !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(element)) {
        return [];
      }
      if (
        Array.isArray(allowed) &&
        allowed.length > 0 &&
        !allowed.some((role) => typeof role === 'string' && roles.has(role))
      ) {
        return [];
      }
      return [
        {
          pluginId: contribution.pluginId,
          id: contribution.id,
          title: stringAttribute(contribution, 'title') ?? contribution.id,
          element,
        },
      ];
    });
  }

  /**
   * The apps of the app bar: those that the organization shows to the person, in its order (MK-030),
   * without those the person hid, unless the organization pinned them.
   */
  private visibleEntries(entries: LauncherEntry[]): LauncherEntry[] {
    const hidden = new Set(this.preferences?.hiddenApps ?? []);
    const key = (entry: LauncherEntry): string => `${entry.pluginId}/${entry.id}`;
    const bar = this.barApps;
    const ordered = bar
      ? bar.flatMap((app) => {
          const entry = entries.find(
            (candidate) => key(candidate) === `${app.pluginId}/${app.appId}`,
          );
          return entry ? [entry] : [];
        })
      : entries;
    const pinned = new Set(
      (bar ?? []).filter((app) => app.pinned).map((app) => `${app.pluginId}/${app.appId}`),
    );
    return ordered.filter((entry) => pinned.has(key(entry)) || !hidden.has(key(entry)));
  }

  /** Reads which apps the organization shows to the person, then lays out the app bar again. */
  private async loadBarApps(): Promise<void> {
    try {
      this.barApps = await this.client.shellApps();
    } catch {
      this.barApps = undefined;
    }
    this.entries = this.visibleEntries(launcherEntries(this.plugins));
  }

  /**
   * Applies the theme, the appearance and the language: those of the person once signed in, those
   * of the installation and of the browser otherwise. Plugins hear it on the event bus.
   */
  private applyAppearance(): void {
    const preferences = this.preferences;
    const installation = this.info?.theme;
    const theme =
      preferences?.theme && isThemeName(preferences.theme)
        ? preferences.theme
        : installation && isThemeName(installation)
          ? installation
          : 'mosaikit';
    const appearance = preferences?.appearance ?? 'system';
    applyTheme(theme, appearance === 'system' ? undefined : appearance);
    const lang =
      preferences?.language && isLanguage(preferences.language)
        ? preferences.language
        : browserLanguage();
    const languageChanged = lang !== language();
    setLanguage(lang);
    this.shellLanguage = lang;
    this.loader?.events.publish('shell.theme.changed', { theme, appearance });
    if (languageChanged) {
      this.loader?.events.publish('shell.locale.changed', { locale: lang });
      // The app reads context.locale when it renders: mount it again in the new language.
      this.renderRoot.querySelector('#app-host')?.replaceChildren();
      this.renderApp();
    }
  }

  /**
   * Applies a change at once and saves it. Saves go one after the other, so that the kernel keeps the
   * last change, and only the answer to the last one replaces what the page shows: an older answer
   * arriving late would undo a newer choice.
   */
  private readonly savePreferences = (event: CustomEvent<Preferences>): Promise<void> => {
    const wanted = event.detail;
    const save = ++this.saves;
    this.preferences = wanted;
    this.entries = this.visibleEntries(launcherEntries(this.plugins));
    this.applyAppearance();
    this.saving = this.saving.then(async () => {
      try {
        const saved = await this.client.changePreferences(wanted);
        if (save === this.saves) {
          this.preferences = saved;
          this.settingsStatus = t('Saved.');
        }
      } catch (error) {
        this.settingsStatus = t('Not saved: {reason}', {
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return this.saving;
  };

  /** The sign-in page (mk-sign-in), which tells the shell what the person asked for. */
  private renderSignIn(): unknown {
    return html`<mk-sign-in
      .product=${this.info?.name ?? 'Mosaikit'}
      .version=${this.info?.version}
      .email=${this.email}
      .busy=${this.busy}
      .error=${this.error}
      .rememberDays=${this.info?.rememberDays ?? 30}
      .language=${this.shellLanguage}
      @mk-continue=${this.continueWithEmail}
      @mk-use-password=${this.usePassword}
      @mk-back=${this.restartSignIn}
      @mk-sign-in=${this.signIn}
      .mode=${this.signInMode}
      .registration=${this.registration}
      .sentTo=${this.sentTo}
      .notice=${this.notice}
      @mk-show-register=${this.showRegister}
      @mk-register=${this.register}
      @mk-resend=${this.resend}
    ></mk-sign-in>`;
  }

  /**
   * Chooses the organization the requests act on, for a person who belongs to several (MK-017).
   * With a password, organizations that accept only their identity provider are not available.
   */
  private renderOrganizationSelector(): unknown {
    const memberships = this.account?.memberships ?? [];
    if (memberships.length < 2) {
      return nothing;
    }
    const federated = this.session !== undefined;
    return html`<label class="organization"
      >${t('Organization')}
      <select @change=${this.chooseOrganization} ?disabled=${federated}>
        ${memberships.map(
          (membership) =>
            html`<option
              value=${membership.slug}
              ?selected=${membership.slug === this.account?.organization}
              ?disabled=${!federated && membership.signIn === 'realm'}
            >
              ${membership.name}${!federated && membership.signIn === 'realm' ? ' (sign in through its identity provider)' : ''}
            </option>`,
        )}
      </select></label
    >`;
  }

  /**
   * The actions that assistants proposed for the person (MK-015): nothing happens until the
   * person confirms one.
   */
  private renderPendingActions(): unknown {
    if (this.drafts.length === 0) {
      return nothing;
    }
    return html`<section class="pending" aria-label="Pending actions">
      <h2>Pending actions</h2>
      <p class="muted">An assistant proposed these actions. They run only if you confirm them.</p>
      <ul>
        ${this.drafts.map(
          (draft) =>
            html`<li>
              <strong>${draft.title}</strong>
              ${draft.description ? html`<span class="muted">${draft.description}</span>` : nothing}
              <pre>${JSON.stringify(draft.input, null, 2)}</pre>
              <span class="muted"
                >Expires at ${new Date(draft.expiresAt).toLocaleTimeString()}</span
              >
              <div>
                <button type="button" @click=${() => void this.decide(draft, true)}>Confirm</button>
                <button
                  type="button"
                  class="secondary"
                  @click=${() => void this.decide(draft, false)}
                >
                  Reject
                </button>
              </div>
            </li>`,
        )}
      </ul>
    </section>`;
  }

  private async decide(draft: ActionDraft, confirm: boolean): Promise<void> {
    try {
      if (confirm) {
        const invocation = await this.client.confirmDraft(draft.id);
        this.error = failureOf(draft.title, invocation.result);
      } else {
        await this.client.rejectDraft(draft.id);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The action cannot be decided.';
    }
    await this.loadDrafts();
  }

  /** The assistant panel, when the installation has one and the person is in an organization. */
  private renderAssistant(): unknown {
    if (this.assistantModel === undefined || !this.account?.organizationId) {
      return nothing;
    }
    return html`<mk-assistant
      .client=${this.client}
      model=${this.assistantModel}
      @mk-drafts-changed=${() => void this.loadDrafts()}
    ></mk-assistant>`;
  }

  private async loadAssistant(): Promise<void> {
    try {
      const assistant = await this.client.assistant();
      this.assistantModel = assistant.enabled ? (assistant.model ?? '') : undefined;
    } catch {
      this.assistantModel = undefined;
    }
  }

  private async loadDrafts(): Promise<void> {
    if (!this.account?.organizationId) {
      this.drafts = [];
      return;
    }
    try {
      this.drafts = await this.client.actionDrafts();
    } catch {
      this.drafts = [];
    }
  }

  private readonly chooseOrganization = async (event: Event): Promise<void> => {
    const slug = (event.target as HTMLSelectElement).value;
    try {
      await this.enter(await this.client.useOrganization(slug));
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The organization cannot be used.';
    }
  };

  private renderAdminLink(): unknown {
    const pages = this.adminPages();
    if (pages.length === 0) {
      return nothing;
    }
    return html`<span class="separator"></span>${pages.map(
        (page) =>
          html`<a
            href=${page.path}
            aria-current=${this.path === page.path ? 'page' : 'false'}
            @click=${this.navigate}
            >${page.path === '/admin/settings' ? settingsIcon : pluginsIcon}<span
              >${t(page.title)}</span
            ></a
          >`,
      )}`;
  }

  private renderWorkspace(): unknown {
    const failed = this.loadResults.filter((result) => !result.loaded);
    const failures =
      failed.length > 0
        ? t('{count} plugins could not be loaded.', { count: failed.length })
        : nothing;
    return html`
      <nav class="rail" aria-label=${t('Apps')}>
        <a
          href="/activity"
          aria-current=${this.path === '/activity' ? 'page' : 'false'}
          aria-label=${
            this.unread > 0 ? t('Activity, {count} unread', { count: this.unread }) : t('Activity')
          }
          @click=${this.navigate}
          >${bellIcon}${
            this.unread > 0
              ? html`<span class="badge" aria-hidden="true"
                  >${this.unread > 99 ? '99+' : this.unread}</span
                >`
              : nothing
          }<span>${t('Activity')}</span></a
        >
        <a href="/" aria-current=${this.path === '/' ? 'page' : 'false'} @click=${this.navigate}
          >${homeIcon}<span>${t('Home')}</span></a
        >
        ${this.entries.map(
          (entry) =>
            html`<a
              href=${entry.route}
              aria-current=${this.path === entry.route ? 'page' : 'false'}
              @click=${this.navigate}
              >${appIcon(entry)}<span>${entry.title}</span></a
            >`,
        )}
        ${this.renderAdminLink()}
      </nav>
      <main id="app-area">
        ${this.appsError ? html`<p class="error" role="alert">${this.appsError}</p>` : nothing}
        ${this.renderOrganizationNotice()}
        ${
          this.path === '/settings'
            ? this.renderSettings()
            : this.path === '/activity'
              ? this.renderActivity()
              : entryForPath(this.entries, this.path) || this.showsAdmin()
                ? nothing
                : html`${this.renderAssistant()}${this.renderPendingActions()}
                    <h1>${t('Welcome, {name}', { name: this.account?.displayName ?? '' })}</h1>
                    <p class="muted">
                      ${t('{count} apps available.', { count: this.entries.length })} ${failures}
                    </p>
                    ${
                      this.entries.length > 0
                        ? html`<ul class="apps" aria-label=${t('Your apps')}>
                            ${this.entries.map(
                              (entry) =>
                                html`<li>
                                  <a href=${entry.route} @click=${this.navigate}
                                    >${appIcon(entry)}<span>${entry.title}</span></a
                                  >
                                </li>`,
                            )}
                          </ul>`
                        : nothing
                    }`
        }
        <div id="app-host"></div>
      </main>
    `;
  }

  /** First step: sends the person to the realm of the organization, or asks for a password. */
  private readonly continueWithEmail = async (
    event: CustomEvent<{ email: string }>,
  ): Promise<void> => {
    const email = event.detail.email;
    this.busy = true;
    this.error = undefined;
    try {
      const options = await this.client.signInOptions(email);
      if (options.federation) {
        location.assign(await this.federated.begin(options.federation, email, redirectUri()));
        return;
      }
      this.email = email;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Sign-in failed. Try again.';
    } finally {
      this.busy = false;
    }
  };

  private readonly usePassword = (): void => {
    this.error = undefined;
    this.email = '';
  };

  private readonly restartSignIn = (): void => {
    this.error = undefined;
    this.notice = undefined;
    this.email = undefined;
    this.signInMode = 'sign-in';
  };

  private readonly showRegister = (): void => {
    this.error = undefined;
    this.notice = undefined;
    this.signInMode = 'register';
  };

  /** Creates an account; with a confirmation, waits for the person to open the link. */
  private readonly register = async (event: CustomEvent<Registration>): Promise<void> => {
    const registration = event.detail;
    this.busy = true;
    this.error = undefined;
    try {
      const sent = await this.client.register(registration);
      if (sent) {
        this.sentTo = registration.email;
        this.signInMode = 'sent';
      } else {
        const account = await this.client.signIn(registration.email, registration.password);
        this.signInMode = 'sign-in';
        await this.enter(account);
      }
    } catch (error) {
      this.error = error instanceof KernelError ? error.message : 'The account was not created.';
    } finally {
      this.busy = false;
    }
  };

  private readonly resend = async (): Promise<void> => {
    if (!this.sentTo) {
      return;
    }
    this.busy = true;
    this.error = undefined;
    try {
      await this.client.resendConfirmation(this.sentTo);
      this.notice = t('We sent a new link. The previous ones do not work any more.');
    } catch (error) {
      this.error = error instanceof KernelError ? error.message : 'The link was not sent.';
    } finally {
      this.busy = false;
    }
  };

  private readonly signIn = async (event: CustomEvent<PasswordSignIn>): Promise<void> => {
    const { username, password, remember } = event.detail;
    this.busy = true;
    this.error = undefined;
    try {
      const account = await this.client.signIn(username, password);
      if (remember) {
        // Not being remembered is no reason to stay out: the session of the browser goes on.
        await this.client.remember().catch(() => undefined);
      }
      await this.enter(account);
    } catch (error) {
      this.error = error instanceof KernelError ? error.message : 'Sign-in failed. Try again.';
    } finally {
      this.busy = false;
    }
  };

  /** Completes a sign-in when the page is the answer of the realm of an organization. */
  private async completeFederatedSignIn(): Promise<void> {
    const url = new URL(location.href);
    try {
      const result = await this.federated.complete(url);
      if (!result) {
        return;
      }
      history.replaceState(null, '', url.pathname);
      this.busy = true;
      this.session = result;
      await this.enter(await this.client.signInWithToken(result.tokens.accessToken));
      this.scheduleRefresh();
    } catch (error) {
      history.replaceState(null, '', url.pathname);
      this.session = undefined;
      this.error = error instanceof Error ? error.message : 'Sign-in failed. Try again.';
    } finally {
      this.busy = false;
    }
  }

  /** Refreshes the access token before it expires; signs out when the realm refuses. */
  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    const session = this.session;
    if (!session?.tokens.refreshToken) {
      return;
    }
    const refreshToken = session.tokens.refreshToken;
    this.refreshTimer = setTimeout(
      () => {
        this.federated.refresh(session.federation, refreshToken).then(
          (tokens) => {
            this.session = { federation: session.federation, tokens };
            this.client.useToken(tokens.accessToken);
            this.scheduleRefresh();
          },
          () => {
            this.clearSession();
            this.error = 'The session ended. Sign in again.';
          },
        );
      },
      Math.max(10, session.tokens.expiresIn * 0.8) * 1000,
    );
  }

  /**
   * Opens the workspace of a signed-in person. When the apps cannot be loaded the person still
   * enters, and the workspace says so: it is not a failed sign-in.
   */
  private async enter(account: Account): Promise<void> {
    let plugins: FrontendPlugin[] = [];
    this.appsError = undefined;
    try {
      plugins = await this.client.shellPlugins();
    } catch (error) {
      this.appsError = t(
        'You are signed in, but the apps could not be loaded: {reason} Reload the page; if it happens again, tell your administrator.',
        { reason: error instanceof Error ? error.message : String(error) },
      );
    }
    const loader = new PluginLoader(
      (path, init) => this.client.request(path, init),
      undefined,
      undefined,
      this.live,
    );
    // One real-time channel for the page, in the organization of the person (MK-031).
    this.live.connect(account.organization ?? undefined);
    this.stopActivity?.();
    this.stopActivity = this.live.subscribe('notifications', () => void this.loadActivity());
    this.loadResults = await loader.loadAll(plugins, account);
    this.plugins = plugins;
    this.loader = loader;
    this.entries = this.visibleEntries(launcherEntries(plugins));
    this.account = account;
    this.preferences = account.preferences ?? NO_PREFERENCES;
    void this.loadActivity();
    this.plugins = plugins;
    await this.loadBarApps();
    this.applyAppearance();
    this.email = undefined;
    this.notice = undefined;
    await this.loadDrafts();
    await this.loadAssistant();
    clearInterval(this.draftTimer);
    this.draftTimer = setInterval(() => void this.loadDrafts(), DRAFT_REFRESH_MS);
    await this.watchPlugins();
  }

  /**
   * When the kernel watches the plugins directory, follows its revision: a changed module cannot
   * replace the custom elements it defined, so the shell reloads the page, which keeps the session
   * of a local account. With the tokens of a realm, held in memory only, it loads the new plugins.
   */
  private async watchPlugins(): Promise<void> {
    clearInterval(this.watchTimer);
    let revision = await this.client.pluginRevision().catch(() => undefined);
    if (revision === undefined) {
      return;
    }
    this.watchTimer = setInterval(() => {
      void this.client.pluginRevision().then(
        (current) => {
          if (current === undefined || current === revision) {
            return;
          }
          revision = current;
          if (this.session) {
            void this.reloadPlugins();
          } else {
            location.reload();
          }
        },
        () => undefined,
      );
    }, PLUGIN_WATCH_MS);
  }

  /**
   * Loads the plugins that became active without a restart (ADR-0031), such as one just installed
   * from the Plugins page; those already loaded stay as they are.
   */
  private async reloadPlugins(): Promise<void> {
    if (!this.account || !this.loader) {
      return;
    }
    const plugins = await this.client.shellPlugins();
    const known = new Set(this.plugins.map((plugin) => plugin.id));
    const added = plugins.filter((plugin) => !known.has(plugin.id));
    const results = await this.loader.loadAll(added, this.account, plugins);
    this.loadResults = [...this.loadResults, ...results];
    this.plugins = plugins;
    this.entries = this.visibleEntries(launcherEntries(plugins));
  }

  private readonly signOut = async (): Promise<void> => {
    const session = this.session;
    this.clearSession();
    if (session) {
      const url = await this.federated
        .signOutUrl(session.federation, session.tokens.idToken, redirectUri())
        .catch(() => undefined);
      if (url) {
        location.assign(url);
      }
    }
  };

  private clearSession(): void {
    this.live.close();
    this.menuOpen = false;
    clearTimeout(this.refreshTimer);
    clearInterval(this.draftTimer);
    clearInterval(this.watchTimer);
    this.drafts = [];
    this.session = undefined;
    void this.client.signOut();
    this.account = undefined;
    this.preferences = undefined;
    this.barApps = undefined;
    this.applyAppearance();
    this.entries = [];
    this.loadResults = [];
    this.plugins = [];
    this.loader = undefined;
  }

  private readonly navigate = (event: MouseEvent): void => {
    const link = event.currentTarget as HTMLAnchorElement;
    event.preventDefault();
    history.pushState(null, '', link.pathname);
    this.path = link.pathname;
    this.error = undefined;
    this.menuOpen = false;
  };

  /**
   * What went wrong in the workspace, such as an action that failed once confirmed, and a notice for
   * people who are in no organization: apps act on the data of one, so they would show nothing.
   */
  private renderOrganizationNotice(): unknown {
    const error = this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing;
    // The Plugins page does not act on an organization.
    if (!this.account || this.account.organizationId || this.showsAdmin()) {
      return error;
    }
    return html`${error}
      <p class="notice">
        You are not working in an organization: the apps act on the data of an organization, so they
        have nothing to show.
        ${
          this.isPlatformAdmin()
            ? 'Add yourself to an organization to use them.'
            : 'Ask an administrator to add you to one.'
        }
      </p>`;
  }

  private isPlatformAdmin(): boolean {
    return this.account?.roles.includes('platform-admin') === true;
  }

  private showsAdmin(): boolean {
    return this.adminPage() !== undefined;
  }

  /** The pages of administrators that the person may open. */
  private adminPages(): (typeof ADMIN_PAGES)[number][] {
    const roles = this.account?.roles ?? [];
    return ADMIN_PAGES.filter(
      (page) =>
        roles.includes(page.role) &&
        // The apps of an organization need the organization of the request.
        (page.role !== 'organization-admin' || Boolean(this.account?.organization)),
    );
  }

  private adminPage(): (typeof ADMIN_PAGES)[number] | undefined {
    return this.adminPages().find((page) => page.path === this.path);
  }

  /**
   * Mounts the current app, or the Plugins page, in an element of its own: Lit renders the rest of
   * the work area, and replacing children that Lit placed breaks its next render (back to Home).
   */
  private renderApp(): void {
    const area = this.renderRoot.querySelector('#app-host');
    if (area && !this.showsAdmin() && !entryForPath(this.entries, this.path)) {
      area.replaceChildren();
      return;
    }
    const page = this.adminPage();
    if (area && page) {
      if (area.firstElementChild?.localName !== page.element) {
        const admin = document.createElement(page.element);
        admin.client = this.client;
        if (admin instanceof MkAdminApps) {
          admin.organization = this.account?.organization ?? undefined;
        }
        area.replaceChildren(admin);
      }
      return;
    }
    const entry = entryForPath(this.entries, this.path);
    if (!area || !entry) {
      return;
    }
    const plugin = this.plugins.find((candidate) => candidate.id === entry.pluginId);
    if (plugin?.isolation === 'iframe') {
      const current = area.firstElementChild;
      if (current instanceof HTMLElement && current.dataset.app === `${plugin.id}/${entry.id}`) {
        return;
      }
      const frame = document.createElement('mk-plugin-frame');
      frame.dataset.app = `${plugin.id}/${entry.id}`;
      frame.plugin = plugin;
      frame.element = entry.element;
      frame.user = this.account;
      frame.events = this.loader?.events;
      frame.request = (path, init) => this.client.request(path, init);
      area.replaceChildren(frame);
      return;
    }
    if (area.firstElementChild?.localName !== entry.element) {
      area.replaceChildren(document.createElement(entry.element));
    }
  }
}

/**
 * The message for a confirmed action that the plugin refused, with the detail of its problem
 * (RFC 9457) when there is one, or `undefined` when it succeeded.
 */
export function failureOf(
  title: string,
  result: { status: number; body?: unknown } | undefined,
): string | undefined {
  const status = result?.status ?? 0;
  if (status < 400) {
    return undefined;
  }
  const body = result?.body;
  const detail =
    typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string'
      ? body.detail
      : `HTTP ${String(status)}`;
  return `${title} failed: ${detail}. Nothing was changed.`;
}

/** Where the realm sends the person back: the root of the site, registered in its client. */
function redirectUri(): string {
  return `${location.origin}/`;
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-shell': MkShell;
  }
}

const icon = (paths: unknown): unknown =>
  html`<svg
    viewBox="0 0 24 24"
    width="24"
    height="24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    ${paths}
  </svg>`;

const homeIcon = icon(
  svg`<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />`,
);
const pluginsIcon = icon(
  svg`<rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><path d="M16.5 13v7M13 16.5h7" />`,
);
const bellIcon = icon(
  svg`<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z" /><path d="M10 20.5a2 2 0 0 0 4 0" />`,
);
const settingsIcon = icon(
  svg`<path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />`,
);
const searchIcon = html`<svg
  viewBox="0 0 24 24"
  width="16"
  height="16"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  aria-hidden="true"
>
  <circle cx="11" cy="11" r="6.5" />
  <path d="m16 16 4 4" />
</svg>`;
const mark = html`<svg width="22" height="22" viewBox="0 0 28 28" aria-hidden="true">
  <rect x="1" y="1" width="12" height="12" rx="3" fill="#ffffff" />
  <rect x="15" y="1" width="12" height="12" rx="3" fill="#ffffff" opacity="0.6" />
  <rect x="1" y="15" width="12" height="12" rx="3" fill="#ffffff" opacity="0.4" />
  <rect x="15" y="15" width="12" height="12" rx="3" fill="#ffffff" opacity="0.8" />
</svg>`;

/** The icon of an app: its own file, or a tile with its initials. */
function appIcon(entry: LauncherEntry): unknown {
  return entry.icon
    ? html`<img src=${entry.icon} alt="" />`
    : html`<span class="tile" aria-hidden="true">${initials(entry.title)}</span>`;
}

const NO_PREFERENCES: Preferences = {
  theme: null,
  appearance: null,
  language: null,
  hiddenApps: [],
  mutedNotifications: [],
};
