// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Catalog, Installation, KernelClient, Offer } from './api.js';

/**
 * The marketplace, for platform administrators (MK-022): the offers of the catalogs, with an
 * install button, and the upload of a package for an installation without network. Installed
 * packages take effect at the next start.
 */
@customElement('mk-admin-plugins')
export class MkAdminPlugins extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 860px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      text-align: left;
      padding: 8px;
      border-top: 1px solid var(--mk-line);
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    .error {
      color: var(--mk-danger);
    }
    button {
      font: inherit;
      padding: 4px 10px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      cursor: pointer;
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private catalog: Catalog | undefined;
  @state() private message: string | undefined;
  @state() private failed = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  override render(): unknown {
    const catalog = this.catalog;
    return html`
      <h1>Plugins</h1>
      <p role="status" aria-live="polite" class=${this.failed ? 'error' : 'muted'}>
        ${this.message ?? nothing}
      </p>
      <h2>Catalogs</h2>
      ${this.renderSources(catalog)}
      ${
        catalog && catalog.plugins.length > 0
          ? html`<table>
              <thead>
                <tr>
                  <th>Plugin</th>
                  <th>Version</th>
                  <th>Installed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${catalog.plugins.map(
                  (offer) =>
                    html`<tr>
                      <td>${offer.name}<br /><span class="muted">${offer.id}</span></td>
                      <td>${offer.version}</td>
                      <td>${offer.installedVersion ?? '—'}</td>
                      <td>${this.renderAction(offer)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : nothing
      }
      <h2>Install a package file</h2>
      <p class="muted">
        For installations without network: the package must be signed by a trusted publisher.
      </p>
      <input
        type="file"
        accept=".zip,application/zip"
        aria-label="Plugin package"
        @change=${this.upload}
      />
    `;
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
      this.dispatchEvent(new CustomEvent('mk-plugins-changed', { bubbles: true, composed: true }));
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
    'mk-admin-plugins': MkAdminPlugins;
  }
}
