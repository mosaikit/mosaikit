// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { type OfferState, extensionMetrics, filterOffers } from './admin-pages.js';
import { adminStyles } from './admin-styles.js';
import { bytes } from './admin-view.js';
import type { Catalog, Installation, KernelClient, Offer } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';

/**
 * The marketplace, for platform administrators (MK-022): the offers of the catalogs, with an
 * install button, and the upload of a package for an installation without network. On the model of
 * the administration pages (MK-072): metrics on top, filters above the table, the actions of each
 * row, and the detail of an extension in a side pane.
 */
@customElement('mk-admin-extensions')
export class MkAdminExtensions extends LitElement {
  static override readonly styles = [
    adminStyles,
    css`
      h2 {
        font-size: 1.1em;
        margin: 8px 0 0;
      }
      button:not(.link) {
        font: inherit;
        padding: 4px 10px;
        border-radius: var(--mk-radius);
        border: 1px solid var(--mk-accent);
        background: var(--mk-accent);
        color: var(--mk-accent-fg);
        cursor: pointer;
      }
    `,
  ];

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private search = '';
  @state() private stateFilter: OfferState = 'all';
  /** The identifier of the extension in the side pane. */
  @state() private selected: string | undefined;
  @state() private catalog: Catalog | undefined;
  @state() private message: string | undefined;
  @state() private failed = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  override render(): unknown {
    const catalog = this.catalog;
    const offers = filterOffers(catalog?.extensions ?? [], this.search, this.stateFilter);
    const selected = catalog?.extensions.find((offer) => offer.id === this.selected);
    return html`
      <mk-admin-view
        heading=${t('Extensions')}
        description=${t(
          'The extensions that the catalogs offer, and the installed ones. A package takes effect at once, or at the next start when it brings code for the server.',
        )}
        name="mosaikit.admin.extensions"
        .metrics=${extensionMetrics(catalog)}
        ?detail-open=${selected !== undefined}
        @mk-detail-close=${() => {
          this.selected = undefined;
        }}
      >
        <label slot="filters" class="filter"
          >${t('Search extensions')}
          <input
            type="search"
            .value=${this.search}
            @input=${(event: Event) => {
              this.search = (event.target as HTMLInputElement).value;
            }}
        /></label>
        <label slot="filters" class="filter"
          >${t('State')}
          <select
            .value=${this.stateFilter}
            @change=${(event: Event) => {
              this.stateFilter = (event.target as HTMLSelectElement).value as OfferState;
            }}
          >
            <option value="all">${t('All')}</option>
            <option value="installed">${t('Installed')}</option>
            <option value="available">${t('Not installed')}</option>
            <option value="update">${t('With an update')}</option>
          </select></label
        >
        <p role="status" aria-live="polite" class=${this.failed ? 'error' : 'muted'}>
          ${this.message ?? nothing}
        </p>
        <h2>${t('Catalogs')}</h2>
        ${this.renderSources(catalog)}
        ${
          offers.length > 0
            ? html`<table aria-label=${t('Offered extensions')}>
                <thead>
                  <tr>
                    <th scope="col">${t('Extension')}</th>
                    <th scope="col">${t('Version')}</th>
                    <th scope="col">${t('Installed')}</th>
                    <th scope="col"><span class="muted">${t('Actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  ${offers.map(
                    (offer) =>
                      html`<tr class=${offer.id === this.selected ? 'selected' : ''}>
                        <td>
                          <button
                            type="button"
                            class="link"
                            aria-label=${t('Details of {name}', { name: offer.name })}
                            @click=${() => {
                              this.selected = offer.id;
                            }}
                          >
                            ${offer.name}</button
                          ><br /><span class="muted">${offer.id}</span>
                        </td>
                        <td>${offer.version}</td>
                        <td>${offer.installedVersion ?? '—'}</td>
                        <td>${this.renderAction(offer)}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`
            : catalog && catalog.extensions.length > 0
              ? html`<p>${t('No extension matches the filters.')}</p>`
              : nothing
        }
        <h2>${t('Install a package file')}</h2>
        <p class="muted">
          ${t(
            'For installations without network: the package must be signed by a trusted publisher.',
          )}
        </p>
        <input
          type="file"
          accept=".zip,application/zip"
          aria-label="Extension package"
          @change=${this.upload}
        />
        <aside slot="detail" class="pane" aria-label=${selected?.name ?? t('Detail')}>
          ${selected ? this.renderDetail(selected) : nothing}
        </aside>
      </mk-admin-view>
    `;
  }

  private renderDetail(offer: Offer): unknown {
    return html`<h2>${offer.name}</h2>
      <dl>
        <dt>${t('Identifier')}</dt>
        <dd>${offer.id}</dd>
        <dt>${t('Version offered')}</dt>
        <dd>${offer.version}</dd>
        <dt>${t('Installed')}</dt>
        <dd>${offer.installedVersion ?? t('No')}</dd>
        <dt>${t('Catalog')}</dt>
        <dd>${offer.source}</dd>
        <dt>${t('Publisher key')}</dt>
        <dd>${offer.publisherKey}</dd>
        <dt>${t('Size')}</dt>
        <dd>${bytes(offer.size)}</dd>
      </dl>
      <div class="row-actions">${this.renderAction(offer)}</div>`;
  }

  private renderSources(catalog: Catalog | undefined): unknown {
    if (catalog === undefined) {
      return html`<p class="muted">Loading…</p>`;
    }
    if (catalog.sources.length === 0) {
      return html`<p class="muted">No catalog is configured (mosaikit.marketplace.sources).</p>`;
    }
    return html`<ul>
      ${catalog.sources.map(
        (source) =>
          html`<li>
            ${source.uri}:
            ${
              source.status === 'verified'
                ? html`verified, key ${source.keyId}`
                : html`<span class="error">refused, ${source.error}</span>`
            }
          </li>`,
      )}
    </ul>`;
  }

  private renderAction(offer: Offer): unknown {
    if (offer.state === 'restart') {
      return html`<span class="muted">installed, restart Mosaikit to use it</span>`;
    }
    if (offer.state !== 'available' && offer.state !== 'update') {
      return html`<span class="muted">${offer.state}</span>`;
    }
    return html`<button type="button" @click=${() => void this.install(offer)}>
      ${offer.state === 'update' ? 'Update' : 'Install'}
    </button>`;
  }

  private async refresh(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.catalog = await this.client.marketplace();
    } catch (error) {
      this.report(error);
    }
  }

  private async install(offer: Offer): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      const installation = await this.client.install(offer);
      this.done(installation);
    } catch (error) {
      this.report(error);
    }
  }

  private readonly upload = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.client) {
      return;
    }
    try {
      const installation = await this.client.upload(file);
      this.done(installation);
    } catch (error) {
      this.report(error);
    }
    input.value = '';
  };

  private done(installation: Installation): void {
    this.failed = false;
    const what = `${installation.id} ${installation.version}`;
    const problems = installation.problems;
    const notes = problems && problems.length > 0 ? ` Note: ${problems.join('; ')}` : '';
    if (installation.restartRequired) {
      this.message = `${what} is installed: restart Mosaikit to use it.${notes}`;
    } else {
      // Only a frontend and collections: active at once (ADR-0031); the shell loads its apps.
      this.message = `${what} is installed and active.${notes}`;
      this.dispatchEvent(
        new CustomEvent('mk-extensions-changed', { bubbles: true, composed: true }),
      );
    }
    // The table then shows the package as installed, or waiting for the restart.
    void this.refresh();
  }

  private report(error: unknown): void {
    this.failed = true;
    this.message = error instanceof Error ? error.message : 'The request failed.';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-extensions': MkAdminExtensions;
  }
}
