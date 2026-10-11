// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, OrganizationApp } from './api.js';
import { t } from './i18n.js';

/**
 * The apps of the app bar of the organization, for its administrators (MK-030): which ones appear,
 * in which order, pinned or not, and for whom. The order of the table is the order of the bar.
 */
@customElement('mk-admin-apps')
export class MkAdminApps extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 900px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--mk-surface);
    }
    th,
    td {
      text-align: left;
      padding: 8px 10px;
      border-top: 1px solid var(--mk-line);
    }
    th {
      font-size: 13px;
      color: var(--mk-muted);
    }
    select,
    button {
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
  `;

  @property({ attribute: false }) client: KernelClient | undefined;
  /** The organization whose apps are shown. */
  @property() organization: string | undefined;

  @state() private apps: OrganizationApp[] = [];
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
    return html`
      <h1>${t('Organization apps')}</h1>
      <p>${t('The apps of the app bar of your organization, in their order.')}</p>
      <table>
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
          ${this.apps.map(
            (app, index) =>
              html`<tr>
                <th scope="row">${app.title}</th>
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
                      this.changeApp(index, { pinned: (event.target as HTMLInputElement).checked });
                    }}
                  />
                </td>
                <td>
                  <select
                    aria-label=${t('Who sees {app}', { app: app.title })}
                    @change=${(event: Event) => {
                      const value = (event.target as HTMLSelectElement).value;
                      this.changeApp(index, { roles: value ? [value] : [] });
                    }}
                  >
                    <option value="" ?selected=${app.roles.length === 0}>${t('Everyone')}</option>
                    <option
                      value="organization-admin"
                      ?selected=${app.roles.length === 1 && app.roles[0] === 'organization-admin'}
                    >
                      ${t('Administrators')}
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
      <button class="save" type="button" @click=${this.save}>${t('Save')}</button>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
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
