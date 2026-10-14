// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AccountStatus, KernelClient } from './api.js';
import { t } from './i18n.js';
import { when } from './sessions.js';
import { AccountSuspensions, MAX_REASON, accountName, describeStatus } from './suspensions.js';

/**
 * The accounts of the installation, for platform administrators (MK-125): finds an account by its
 * email address, shows whether it is suspended and why, suspends it with a reason and reinstates it,
 * and lists the suspended accounts. The behaviour is in {@link AccountSuspensions}.
 */
@customElement('mk-admin-accounts')
export class MkAdminAccounts extends LitElement {
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
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    form,
    section {
      display: grid;
      gap: 12px;
      padding: 16px 20px;
      margin-bottom: 24px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
    }
    label {
      font-weight: 600;
    }
    input,
    textarea,
    button {
      font: inherit;
      padding: 6px 8px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
    }
    textarea {
      min-height: 4em;
      resize: vertical;
    }
    button {
      cursor: pointer;
      justify-self: start;
    }
    button.primary {
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      font-weight: 600;
    }
    button.danger {
      border-color: var(--mk-danger);
      color: var(--mk-danger);
      font-weight: 600;
    }
    h2 {
      margin: 0;
      font-size: 1.1em;
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

  @state() private email = '';
  @state() private reason = '';
  @state() private message = '';
  @state() private failed = false;

  private suspensions: AccountSuspensions | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.suspensions = new AccountSuspensions(this.client, {
      changed: () => {
        this.requestUpdate();
      },
      announce: (message, failed) => {
        this.message = message;
        this.failed = failed;
      },
    });
    void this.suspensions.load();
  }

  override render(): unknown {
    const found = this.suspensions?.found;
    const suspended = this.suspensions?.suspended ?? [];
    return html`
      <h1>${t('Accounts')}</h1>
      <p>
        ${t(
          'Suspend the account of a person who must not sign in any more, for example when they leave or lose a device: their sessions end at once, on every browser, and they sign in by no means until reinstated.',
        )}
      </p>
      <form @submit=${this.submitFind} aria-labelledby="find-title" novalidate>
        <h2 id="find-title">${t('Find an account')}</h2>
        <label for="account-email">${t('Email address of the account')}</label>
        <input
          id="account-email"
          type="email"
          spellcheck="false"
          autocomplete="off"
          .value=${this.email}
          @input=${(event: Event) => {
            this.email = (event.target as HTMLInputElement).value;
          }}
        />
        <button type="submit">${t('Find')}</button>
      </form>
      ${found ? this.renderAccount(found) : nothing}
      <h2 id="suspended-title">${t('Suspended accounts')}</h2>
      ${
        suspended.length === 0
          ? html`<p class="muted">${t('No account is suspended.')}</p>`
          : this.renderSuspended(suspended)
      }
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderAccount(account: AccountStatus): unknown {
    return html`<section aria-labelledby="account-title">
      <h2 id="account-title">${accountName(account)}</h2>
      <p>${describeStatus(account, when)}</p>
      ${
        account.suspended
          ? html`<button
              type="button"
              class="primary"
              @click=${() => void this.suspensions?.reinstate(account)}
            >
              ${t('Reinstate')}
            </button>`
          : html`<label for="suspension-reason">${t('Reason for the suspension')}</label>
              <textarea
                id="suspension-reason"
                maxlength=${MAX_REASON}
                aria-describedby="suspension-reason-help"
                .value=${this.reason}
                @input=${(event: Event) => {
                  this.reason = (event.target as HTMLTextAreaElement).value;
                }}
              ></textarea>
              <span class="muted" id="suspension-reason-help">
                ${t('Shown to the other platform administrators and kept in the audit log.')}
              </span>
              <button
                type="button"
                class="danger"
                @click=${() => void this.confirmSuspend(account)}
              >
                ${t('Suspend')}
              </button>`
      }
    </section>`;
  }

  private renderSuspended(accounts: readonly AccountStatus[]): unknown {
    return html`<table aria-labelledby="suspended-title">
      <thead>
        <tr>
          <th scope="col">${t('Account')}</th>
          <th scope="col">${t('Suspension')}</th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${accounts.map(
          (account) =>
            html`<tr>
              <th scope="row">${accountName(account)}</th>
              <td>${describeStatus(account, when)}</td>
              <td>
                <button
                  type="button"
                  aria-label=${t('Reinstate {name}', { name: account.username })}
                  @click=${() => void this.suspensions?.reinstate(account)}
                >
                  ${t('Reinstate')}
                </button>
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
  }

  private readonly submitFind = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (await this.suspensions?.find(this.email)) {
      this.reason = '';
    }
  };

  private async confirmSuspend(account: AccountStatus): Promise<void> {
    if (!this.reason.trim()) {
      // The suspensions say what is missing.
      await this.suspensions?.suspend(account, this.reason);
      return;
    }
    if (
      !confirm(
        t('Suspend {name}? Their sessions end at once and they cannot sign in until reinstated.', {
          name: accountName(account),
        }),
      )
    ) {
      return;
    }
    if (await this.suspensions?.suspend(account, this.reason)) {
      this.reason = '';
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-accounts': MkAdminAccounts;
  }
}
