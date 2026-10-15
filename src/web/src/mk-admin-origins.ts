// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { type OriginSource, filterOrigins, originMetrics } from './admin-pages.js';
import { adminStyles } from './admin-styles.js';
import type { AllowedOrigin, KernelClient } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';
import { OriginList, describeOrigin } from './origins.js';
import { when } from './sessions.js';

/** What the side pane shows: the form to allow an origin, or an origin. */
type Pane = { readonly kind: 'new' } | { readonly kind: 'origin'; readonly origin: string };

/**
 * The external origins of the content security policy, for platform administrators (MK-128): the
 * services outside the installation that the browser may contact for images, data and tiles. On the
 * model of the administration pages (MK-072): metrics on top, filters above the table, the actions of
 * each row, and the detail of an origin, or the form to allow one, in a side pane. The behaviour is
 * in {@link OriginList}.
 */
@customElement('mk-admin-origins')
export class MkAdminOrigins extends LitElement {
  static override readonly styles = [
    adminStyles,
    css`
      .origin {
        font-family: var(--mk-font-mono, monospace);
      }
      form {
        display: grid;
        gap: 12px;
      }
      form label {
        font-weight: 600;
      }
      form input,
      button:not(.link) {
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
    `,
  ];

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private origin = '';
  @state() private search = '';
  @state() private source: OriginSource = 'all';
  @state() private pane: Pane | undefined;
  @state() private message = '';
  @state() private failed = false;

  private list: OriginList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.list = new OriginList(this.client, {
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
    const policy = this.list?.policy;
    const pane = this.pane;
    const selected =
      pane?.kind === 'origin'
        ? policy?.origins.find((origin) => origin.origin === pane.origin)
        : undefined;
    const shown = filterOrigins(policy?.origins ?? [], this.search, this.source);
    return html`
      <mk-admin-view
        heading=${t('External origins')}
        description=${t(
          'Services outside the installation that the shell and the extensions may contact from the browser, for images, data and tiles. Every other address stays blocked by the content security policy of the browser.',
        )}
        name="mosaikit.admin.origins"
        .metrics=${originMetrics(policy)}
        ?detail-open=${pane?.kind === 'new' || selected !== undefined}
        @mk-detail-close=${() => {
          this.pane = undefined;
        }}
      >
        <button
          slot="actions"
          type="button"
          class="primary"
          @click=${() => {
            this.pane = { kind: 'new' };
          }}
        >
          ${t('Allow an origin')}
        </button>
        <label slot="filters" class="filter"
          >${t('Search origins')}
          <input
            type="search"
            .value=${this.search}
            @input=${(event: Event) => {
              this.search = (event.target as HTMLInputElement).value;
            }}
        /></label>
        <label slot="filters" class="filter"
          >${t('Source')}
          <select
            .value=${this.source}
            @change=${(event: Event) => {
              this.source = (event.target as HTMLSelectElement).value as OriginSource;
            }}
          >
            <option value="all">${t('All')}</option>
            <option value="CONFIGURATION">${t('The configuration')}</option>
            <option value="ADMINISTRATION">${t('Added here')}</option>
          </select></label
        >
        ${
          policy && !policy.enabled
            ? html`<p class="muted">
                ${t(
                  'The kernel sends the policy in production only: in this installation the browser is not restricted.',
                )}
              </p>`
            : nothing
        }
        ${
          policy === undefined
            ? nothing
            : policy.origins.length === 0
              ? html`<p>
                  ${t('No external origin: the browser contacts this installation only.')}
                </p>`
              : shown.length === 0
                ? html`<p>${t('No origin matches the filters.')}</p>`
                : this.renderTable(shown)
        }
        <aside
          slot="detail"
          class="pane"
          aria-label=${selected ? selected.origin : t('Allow an origin')}
        >
          ${pane?.kind === 'new' ? this.renderForm() : nothing}
          ${selected ? this.renderDetail(selected) : nothing}
        </aside>
      </mk-admin-view>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderForm(): unknown {
    return html`<form @submit=${this.submit} aria-labelledby="origin-form-title" novalidate>
      <h2 id="origin-form-title">${t('Allow an origin')}</h2>
      <label for="origin">${t('Origin')}</label>
      <input
        id="origin"
        spellcheck="false"
        autocomplete="off"
        inputmode="url"
        aria-describedby="origin-help"
        .value=${this.origin}
        @input=${(event: Event) => {
          this.origin = (event.target as HTMLInputElement).value;
        }}
      />
      <span class="muted" id="origin-help">
        ${t(
          'Scheme, host and port only, such as https://tiles.example.org or https://*.tiles.example.org.',
        )}
      </span>
      <button class="primary" type="submit">${t('Allow')}</button>
    </form>`;
  }

  private renderDetail(origin: AllowedOrigin): unknown {
    return html`<h2 class="origin">${origin.origin}</h2>
      <dl>
        <dt>${t('Source')}</dt>
        <dd>${origin.source === 'CONFIGURATION' ? t('The configuration') : t('Added here')}</dd>
        <dt>${t('Allowed since')}</dt>
        <dd>${describeOrigin(origin, when)}</dd>
        <dt>${t('Directives')}</dt>
        <dd>connect-src, img-src</dd>
      </dl>
      ${
        origin.source === 'ADMINISTRATION'
          ? html`<div class="row-actions">
              <button type="button" @click=${() => void this.confirmRemove(origin)}>
                ${t('Remove')}
              </button>
            </div>`
          : html`<p class="muted">
              ${t('It comes from mosaikit.content-security-policy.allowed-origins.')}
            </p>`
      }`;
  }

  private renderTable(origins: readonly AllowedOrigin[]): unknown {
    const selected = this.pane?.kind === 'origin' ? this.pane.origin : undefined;
    return html`<table aria-label=${t('External origins')}>
      <thead>
        <tr>
          <th scope="col">${t('Origin')}</th>
          <th scope="col">${t('Allowed since')}</th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${origins.map(
          (origin) =>
            html`<tr class=${origin.origin === selected ? 'selected' : ''}>
              <th scope="row" class="origin">
                <button
                  type="button"
                  class="link"
                  aria-label=${t('Details of {name}', { name: origin.origin })}
                  @click=${() => {
                    this.pane = { kind: 'origin', origin: origin.origin };
                  }}
                >
                  ${origin.origin}
                </button>
              </th>
              <td>${describeOrigin(origin, when)}</td>
              <td>
                ${
                  origin.source === 'ADMINISTRATION'
                    ? html`<button
                        type="button"
                        aria-label=${t('Remove {origin}', { origin: origin.origin })}
                        @click=${() => void this.confirmRemove(origin)}
                      >
                        ${t('Remove')}
                      </button>`
                    : nothing
                }
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
  }

  private readonly submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (await this.list?.allow(this.origin)) {
      this.origin = '';
      this.pane = undefined;
    }
  };

  private async confirmRemove(origin: AllowedOrigin): Promise<void> {
    if (
      !confirm(
        t('Remove {origin}? Images, data and tiles of that service stop loading in the browser.', {
          origin: origin.origin,
        }),
      )
    ) {
      return;
    }
    await this.list?.remove(origin);
    if (this.pane?.kind === 'origin' && this.pane.origin === origin.origin) {
      this.pane = undefined;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-origins': MkAdminOrigins;
  }
}
