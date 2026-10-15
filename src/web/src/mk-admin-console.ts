// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { type ConsolePanel, addressOf, consoleMetrics, describeEvent } from './admin-console.js';
import type { ConsoleOverview, KernelClient } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';
import { when } from './sessions.js';

/** Opens a page of the shell without loading it again, as the links of the app bar do. */
function open(event: MouseEvent): void {
  const link = event.currentTarget as HTMLAnchorElement;
  event.preventDefault();
  history.pushState(null, '', link.pathname + link.search);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * The console of the platform administrators (MK-072): the organizations, the people, the active
 * extensions, the metrics of the system and the security events of the last day, with the panels that
 * extensions add through `console.panel`. The figures come from `GET /api/v1/platform/console`.
 */
@customElement('mk-admin-console')
export class MkAdminConsole extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    .panels {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
      gap: 16px;
    }
    section {
      display: grid;
      align-content: start;
      gap: 8px;
      padding: 16px 20px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
      min-width: 0;
    }
    section.wide {
      grid-column: 1 / -1;
    }
    h2 {
      margin: 0;
      font-size: 1.1em;
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      text-align: left;
      padding: 6px 8px;
      border-top: 1px solid var(--mk-line);
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      font-size: 13px;
      color: var(--mk-muted);
    }
    ul {
      margin: 0;
      padding-left: 1.2em;
    }
    a {
      color: var(--mk-accent);
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .error {
      color: var(--mk-danger);
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  /** The panels that extensions add, for the person. */
  @property({ attribute: false }) panels: readonly ConsolePanel[] = [];

  @state() private overview: ConsoleOverview | undefined;
  @state() private failure = '';

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  /** Reads the state of the installation again. */
  async load(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.overview = await this.client.consoleOverview();
      this.failure = '';
    } catch (error) {
      this.failure = t('The state of the installation cannot be read: {reason}', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  override render(): unknown {
    const overview = this.overview;
    return html`<mk-admin-view
      heading=${t('Console')}
      description=${t(
        'The state of the installation: its organizations and people, the active extensions, the system and the security events of the last 24 hours.',
      )}
      .metrics=${overview ? consoleMetrics(overview) : []}
    >
      <a slot="actions" href="/admin/organizations?new" @click=${open}>${t('New organization')}</a>
      ${this.failure ? html`<p class="error" role="alert">${this.failure}</p>` : nothing}
      <div class="panels">
        ${overview ? this.renderPanels(overview) : nothing}
        ${this.panels.map(
          (panel) =>
            html`<section aria-label=${panel.title}>
              <h2>${panel.title}</h2>
              ${panel.description ? html`<p class="muted">${panel.description}</p>` : nothing}
              <div data-panel=${`${panel.extensionId}/${panel.id}`}></div>
            </section>`,
        )}
      </div>
    </mk-admin-view>`;
  }

  private renderPanels(overview: ConsoleOverview): unknown {
    const events = overview.security.events;
    return html`
      <section class="wide" aria-labelledby="security-title">
        <h2 id="security-title">${t('Security events')}</h2>
        <p class="muted">
          ${t(
            'Sign-ins and other requests refused since {since}; the audit log keeps all of them.',
            {
              since: when(overview.security.since),
            },
          )}
        </p>
        ${
          events.length === 0
            ? html`<p>${t('No security event in the last 24 hours.')}</p>`
            : html`<table aria-labelledby="security-title">
                <thead>
                  <tr>
                    <th scope="col">${t('When')}</th>
                    <th scope="col">${t('What')}</th>
                    <th scope="col">${t('From')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${events.map(
                    (event) =>
                      html`<tr>
                        <td>${when(event.occurredAt)}</td>
                        <td>${describeEvent(event)}</td>
                        <td>${addressOf(event) ?? t('unknown')}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`
        }
      </section>
      <section aria-labelledby="organizations-title">
        <h2 id="organizations-title">${t('Organizations and people')}</h2>
        <p>
          ${t(
            '{active} organizations active, {suspended} suspended; {people} people, {blocked} suspended.',
            {
              active: String(overview.organizations.active),
              suspended: String(overview.organizations.suspended),
              people: String(overview.people.total),
              blocked: String(overview.people.suspended),
            },
          )}
        </p>
        <p class="links">
          <a href="/admin/organizations" @click=${open}>${t('Organizations')}</a>
          <a href="/admin/accounts" @click=${open}>${t('People')}</a>
        </p>
      </section>
      <section aria-labelledby="extensions-title">
        <h2 id="extensions-title">${t('Active extensions')}</h2>
        ${
          overview.extensions.list.length === 0
            ? html`<p>${t('No extension is active.')}</p>`
            : html`<ul>
                ${overview.extensions.list.map(
                  (extension) =>
                    html`<li>
                      <span>${extension.id}</span> <span class="muted">${extension.version}</span>
                    </li>`,
                )}
              </ul>`
        }
        <p class="links"><a href="/admin/extensions" @click=${open}>${t('Extensions')}</a></p>
      </section>
      <section aria-labelledby="system-title">
        <h2 id="system-title">${t('System')}</h2>
        <p>
          ${t('Version {version}, started {started}, {threads} threads.', {
            version: overview.system.version,
            started: when(overview.system.startedAt),
            threads: String(overview.system.threads),
          })}
        </p>
      </section>
    `;
  }

  /** Mounts the custom element of each panel of an extension in its place. */
  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    for (const panel of this.panels) {
      const host = this.renderRoot.querySelector<HTMLElement>(
        `[data-panel="${panel.extensionId}/${panel.id}"]`,
      );
      if (host && host.firstElementChild?.localName !== panel.element) {
        host.replaceChildren(document.createElement(panel.element));
      }
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-console': MkAdminConsole;
  }
}
