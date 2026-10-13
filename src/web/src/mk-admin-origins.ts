// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AllowedOrigin, KernelClient } from './api.js';
import { t } from './i18n.js';
import { OriginList, describeOrigin } from './origins.js';
import { when } from './sessions.js';

/**
 * The external origins of the content security policy, for platform administrators (MK-128): the
 * services outside the installation that the browser may contact for images, data and tiles. The
 * behaviour is in {@link OriginList}.
 */
@customElement('mk-admin-origins')
export class MkAdminOrigins extends LitElement {
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

  @state() private origin = '';
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
    return html`
      <h1>${t('External origins')}</h1>
      <p>
        ${t(
          'Services outside the installation that the shell and the extensions may contact from the browser, for images, data and tiles. Every other address stays blocked by the content security policy of the browser.',
        )}
      </p>
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
            ? html`<p>${t('No external origin: the browser contacts this installation only.')}</p>`
            : this.renderTable(policy.origins)
      }
      <form @submit=${this.submit} aria-labelledby="origin-form-title" novalidate>
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
      </form>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderTable(origins: readonly AllowedOrigin[]): unknown {
    return html`<table>
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
            html`<tr>
              <th scope="row" class="origin">${origin.origin}</th>
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
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-origins': MkAdminOrigins;
  }
}
