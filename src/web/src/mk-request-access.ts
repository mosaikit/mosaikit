// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import {
  AccessRequestsApi,
  MAX_MESSAGE,
  sendAccessRequest,
  type RequestedAccess,
} from './access-requests.js';
import type { KernelClient } from './api.js';
import { t } from './i18n.js';

/**
 * The request for access of the kernel (MK-058): opened from a page that refused the person, it asks
 * for a message and sends the request to the people who may share the resource. It shows nothing of
 * the resource: the page that refused the person already said what it could.
 */
@customElement('mk-request-access')
export class MkRequestAccess extends LitElement {
  static override readonly styles = css`
    dialog {
      width: min(480px, calc(100vw - 32px));
      padding: 20px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
      color: var(--mk-fg);
      box-sizing: border-box;
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.4);
    }
    h2 {
      margin: 0 0 8px;
    }
    label {
      display: block;
      margin: 12px 0 4px;
    }
    textarea {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      padding: 8px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-bg);
      color: var(--mk-fg);
    }
    .muted {
      color: var(--mk-muted);
    }
    .error {
      color: var(--mk-danger);
    }
    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
    }
    button {
      font: inherit;
      padding: 6px 12px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
      cursor: pointer;
    }
    button.primary {
      background: var(--mk-accent);
      border-color: var(--mk-accent);
      color: var(--mk-on-accent, #fff);
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private access: RequestedAccess | undefined;
  @state() private text = '';
  @state() private outcome = '';
  @state() private failed = false;
  @state() private sent = false;
  @state() private sending = false;

  @query('dialog') private dialog!: HTMLDialogElement;

  /** Opens the dialog for a resource the person was refused. */
  async openFor(access: RequestedAccess): Promise<void> {
    this.access = access;
    this.text = '';
    this.outcome = '';
    this.failed = false;
    this.sent = false;
    await this.updateComplete;
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
    this.renderRoot.querySelector('textarea')?.focus();
  }

  private readonly send = async (event: Event): Promise<void> => {
    event.preventDefault();
    const client = this.client;
    const access = this.access;
    if (!client || !access || this.sending) {
      return;
    }
    this.sending = true;
    const result = await sendAccessRequest(
      new AccessRequestsApi((path, init) => client.request(path, init)),
      access,
      this.text,
    );
    this.sending = false;
    this.outcome = result.message;
    this.failed = result.failed;
    this.sent = !result.failed;
  };

  override render(): unknown {
    return html`<dialog aria-labelledby="request-access-title">
      <h2 id="request-access-title">${t('Request access')}</h2>
      <form @submit=${this.send}>
        ${
          this.sent
            ? nothing
            : html`<p class="muted">
                  ${t(
                    'The owner or an administrator of the organization reads your request and decides. You are notified of the answer.',
                  )}
                </p>
                <label for="request-access-message">${t('Message (optional)')}</label>
                <textarea
                  id="request-access-message"
                  rows="4"
                  maxlength=${MAX_MESSAGE}
                  .value=${this.text}
                  @input=${(event: Event) => {
                    this.text = (event.target as HTMLTextAreaElement).value;
                  }}
                ></textarea>`
        }
        <p class=${this.failed ? 'error' : 'muted'} role=${this.failed ? 'alert' : nothing}>
          ${this.outcome}
        </p>
        <div class="actions">
          <button
            type="button"
            @click=${() => {
              this.dialog.close();
            }}
          >
            ${this.sent ? t('Close') : t('Cancel')}
          </button>
          ${
            this.sent
              ? nothing
              : html`<button type="submit" class="primary" ?disabled=${this.sending}>
                  ${t('Send the request')}
                </button>`
          }
        </div>
      </form>
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-request-access': MkRequestAccess;
  }
}
