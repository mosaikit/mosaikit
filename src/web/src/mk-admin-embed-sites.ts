// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { EmbedSite, KernelClient } from './api.js';
import { EMBED_PREFIX } from './embed.js';
import { EmbedSiteList } from './embed-sites.js';
import { t } from './i18n.js';
import { when } from './sessions.js';

/**
 * The sites that may show the views of the organization in an iframe, for its administrators
 * (MK-100). Every other site is refused by the browser. The behaviour is in {@link EmbedSiteList}.
 */
@customElement('mk-admin-embed-sites')
export class MkAdminEmbedSites extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 900px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--mk-surface);
      margin-bottom: 24px;
    }
    th,
    td {
      text-align: left;
      padding: 8px 10px;
      border-top: 1px solid var(--mk-line);
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      font-size: 13px;
      color: var(--mk-muted);
    }
    .origin {
      font-family: var(--mk-font-mono, monospace);
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    form {
      display: grid;
      gap: 12px;
      padding: 16px 20px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
    }
    label {
      font-weight: 600;
    }
    input,
    button {
      font: inherit;
      padding: 6px 8px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
    }
    button {
      cursor: pointer;
    }
    button.primary {
      justify-self: start;
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      font-weight: 600;
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
  /** The slug of the organization. */
  @property() organization: string | undefined;

  @state() private origin = '';
  @state() private message = '';
  @state() private failed = false;

  private list: EmbedSiteList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.list = new EmbedSiteList(this.client, this.organization, {
      changed: () => {
        this.requestUpdate();
      },
      announce: (message, failed) => {
        this.message = message;
        this.failed = failed;
      },
    });
    void this.list.load();
  }

  override render(): unknown {
    const sites = this.list?.sites;
    const address = `${location.origin}${EMBED_PREFIX}${this.organization ?? ''}`;
    return html`
      <h1>${t('Embedded views')}</h1>
      <p>
        ${t(
          'Sites that may show the views of the apps of your organization in their pages, in an iframe. The browser refuses every other site.',
        )}
      </p>
      <p class="muted">
        ${t(
          'The address of an embedded view starts with {address}, followed by the address of the view in an app, or by shared/ and the secret of a link, or by public/ and a resource shared with the public.',
          { address },
        )}
      </p>
      ${
        sites === undefined
          ? nothing
          : sites.length === 0
            ? html`<p>${t('No site: only this installation shows your views.')}</p>`
            : this.renderTable(sites)
      }
      <form @submit=${this.submit} aria-labelledby="site-form-title" novalidate>
        <h2 id="site-form-title">${t('Add a site')}</h2>
        <label for="site">${t('Site')}</label>
        <input
          id="site"
          spellcheck="false"
          autocomplete="off"
          inputmode="url"
          aria-describedby="site-help"
          .value=${this.origin}
          @input=${(event: Event) => {
            this.origin = (event.target as HTMLInputElement).value;
          }}
        />
        <span class="muted" id="site-help">
          ${t('Scheme, host and port only, such as https://www.example.org or https://*.example.org.')}
        </span>
        <button class="primary" type="submit">${t('Add')}</button>
      </form>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderTable(sites: readonly EmbedSite[]): unknown {
    return html`<table>
      <thead>
        <tr>
          <th scope="col">${t('Site')}</th>
          <th scope="col">${t('Allowed since')}</th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${sites.map(
          (site) =>
            html`<tr>
              <th scope="row" class="origin">${site.origin}</th>
              <td>
                ${t('{when} by {person}', { when: when(site.addedAt), person: site.addedBy })}
              </td>
              <td>
                <button
                  type="button"
                  aria-label=${t('Remove {origin}', { origin: site.origin })}
                  @click=${() => void this.confirmRemove(site)}
                >
                  ${t('Remove')}
                </button>
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
  }

  private readonly submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (await this.list?.add(this.origin)) {
      this.origin = '';
    }
  };

  private async confirmRemove(site: EmbedSite): Promise<void> {
    if (
      !confirm(
        t('Remove {origin}? The views of your organization stop showing in its pages.', {
          origin: site.origin,
        }),
      )
    ) {
      return;
    }
    await this.list?.remove(site);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-embed-sites': MkAdminEmbedSites;
  }
}
