// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { appMetrics, filterApps } from './admin-pages.js';
import { adminStyles } from './admin-styles.js';
import type { KernelClient, OrganizationApp } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';

/** An app of the organization, as `<extension>/<app>`. */
function appKey(app: OrganizationApp): string {
  return `${app.extensionId}/${app.appId}`;
}

/**
 * The apps of the app bar of the organization, for its administrators (MK-030): which ones appear,
 * in which order, pinned or not, and for whom: everyone, or the people who hold the permission of
 * the app, granted in Permissions like any other (MK-056). The order of the table is the order of
 * the bar.
 */
@customElement('mk-admin-apps')
export class MkAdminApps extends LitElement {
  static override readonly styles = [
    adminStyles,
    css`
      select,
      button:not(.link) {
        font: inherit;
        padding: 4px 8px;
        border-radius: var(--mk-radius);
        border: 1px solid var(--mk-line);
        background: var(--mk-surface);
        color: var(--mk-fg);
      }
      button.save {
        margin-top: 16px;
        padding: 8px 16px;
        border-color: var(--mk-accent);
        background: var(--mk-accent);
        color: var(--mk-accent-fg);
        font-weight: 600;
        cursor: pointer;
      }
      input {
        accent-color: var(--mk-accent);
      }
      :focus-visible {
        outline: 2px solid var(--mk-focus);
        outline-offset: 2px;
      }
      .status {
        min-height: 1.5em;
        color: var(--mk-muted);
      }
      .error {
        color: var(--mk-danger);
      }
    `,
  ];

  @property({ attribute: false }) client: KernelClient | undefined;
  /** The organization whose apps are shown. */
  @property() organization: string | undefined;

  @state() private apps: OrganizationApp[] = [];
  @state() private search = '';
  /** The app in the side pane, `<extension>/<app>`. */
  @state() private selected: string | undefined;
  @state() private message = '';
  @state() private failed = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    if (!this.client || !this.organization) {
      return;
    }
    try {
      this.apps = await this.client.organizationApps(this.organization);
    } catch (error) {
      this.show(t('Not saved: {reason}', { reason: String(error) }), true);
    }
  }

  override render(): unknown {
    const shown = filterApps(this.apps, this.search);
    const selected = this.apps.find((app) => appKey(app) === this.selected);
    return html`
      <mk-admin-view
        heading=${t('Organization apps')}
        description=${`${t('The apps of the app bar of your organization, in their order.')} ${t(
          'An app for who holds its permission shows to the administrators and to the people it is granted to in Permissions, through a profile, a team or a personal exception.',
        )}`}
        name="mosaikit.admin.apps"
        .metrics=${appMetrics(this.apps)}
        ?detail-open=${selected !== undefined}
        @mk-detail-close=${() => {
          this.selected = undefined;
        }}
      >
        <label slot="filters" class="filter"
          >${t('Search apps')}
          <input
            type="search"
            .value=${this.search}
            @input=${(event: Event) => {
              this.search = (event.target as HTMLInputElement).value;
            }}
        /></label>
        <table aria-label=${t('Organization apps')}>
          <thead>
            <tr>
              <th scope="col">${t('App')}</th>
              <th scope="col">${t('Shown')}</th>
              <th scope="col">${t('Pinned')}</th>
              <th scope="col">${t('For')}</th>
              <th scope="col">${t('Order')}</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map(
              ({ app, index }) =>
                html`<tr class=${appKey(app) === this.selected ? 'selected' : ''}>
                  <th scope="row">
                    <button
                      type="button"
                      class="link"
                      aria-label=${t('Details of {name}', { name: app.title })}
                      @click=${() => {
                        this.selected = appKey(app);
                      }}
                    >
                      ${app.title}
                    </button>
                  </th>
                  <td>
                    <input
                      type="checkbox"
                      aria-label=${t('Show {app}', { app: app.title })}
                      .checked=${app.enabled}
                      @change=${(event: Event) => {
                        this.changeApp(index, {
                          enabled: (event.target as HTMLInputElement).checked,
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label=${t('Pin {app}', { app: app.title })}
                      .checked=${app.pinned}
                      @change=${(event: Event) => {
                        this.changeApp(index, {
                          pinned: (event.target as HTMLInputElement).checked,
                        });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      aria-label=${t('Who sees {app}', { app: app.title })}
                      @change=${(event: Event) => {
                        const restricted =
                          (event.target as HTMLSelectElement).value === 'restricted';
                        this.changeApp(index, { restricted, roles: [] });
                      }}
                    >
                      <option value="" ?selected=${!app.restricted}>
                        ${t('Members and administrators')}
                      </option>
                      <option value="restricted" ?selected=${app.restricted === true}>
                        ${t('Who holds its permission')}
                      </option>
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      aria-label=${t('Move {app} up', { app: app.title })}
                      ?disabled=${index === 0}
                      @click=${() => {
                        this.move(index, -1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label=${t('Move {app} down', { app: app.title })}
                      ?disabled=${index === this.apps.length - 1}
                      @click=${() => {
                        this.move(index, 1);
                      }}
                    >
                      ↓
                    </button>
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
        ${shown.length === 0 && this.apps.length > 0 ? html`<p>${t('No app matches the filters.')}</p>` : nothing}
        <button class="save" type="button" @click=${this.save}>${t('Save')}</button>
        <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
          ${this.message || nothing}
        </p>
        <aside slot="detail" class="pane" aria-label=${selected?.title ?? t('Detail')}>
          ${selected ? this.renderDetail(selected) : nothing}
        </aside>
      </mk-admin-view>
    `;
  }

  private renderDetail(app: OrganizationApp): unknown {
    return html`<h2>${app.title}</h2>
      <dl>
        <dt>${t('Extension')}</dt>
        <dd>${app.extensionId}</dd>
        <dt>${t('Shown')}</dt>
        <dd>${app.enabled ? t('Yes') : t('No')}</dd>
        <dt>${t('Pinned')}</dt>
        <dd>${app.pinned ? t('Yes') : t('No')}</dd>
        <dt>${t('For')}</dt>
        <dd>${app.restricted ? t('Who holds its permission') : t('Members and administrators')}</dd>
        <dt>${t('Permission')}</dt>
        <dd>${app.permission ?? t('None')}</dd>
        <dt>${t('Position in the bar')}</dt>
        <dd>${String(this.apps.indexOf(app) + 1)}</dd>
      </dl>
      <p class="muted">${t('Changes apply with Save.')}</p>`;
  }

  private changeApp(index: number, change: Partial<OrganizationApp>): void {
    this.apps = this.apps.map((app, at) => (at === index ? { ...app, ...change } : app));
  }

  private move(index: number, by: number): void {
    const apps = [...this.apps];
    const [moved] = apps.splice(index, 1);
    if (moved) {
      apps.splice(index + by, 0, moved);
      this.apps = apps;
    }
  }

  private readonly save = async (): Promise<void> => {
    if (!this.client || !this.organization) {
      return;
    }
    try {
      this.apps = await this.client.changeOrganizationApps(this.organization, this.apps);
      this.show(t('Saved.'), false);
      this.dispatchEvent(new CustomEvent('mk-apps-changed', { bubbles: true, composed: true }));
    } catch (error) {
      this.show(t('Not saved: {reason}', { reason: String(error) }), true);
    }
  };

  private show(message: string, failed: boolean): void {
    this.message = message;
    this.failed = failed;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-apps': MkAdminApps;
  }
}
