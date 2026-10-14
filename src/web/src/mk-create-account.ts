// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { KernelClient, OrganizationMember, PasswordLink } from './api.js';
import { t } from './i18n.js';
import { linkNotice } from './password-links.js';

/**
 * The dialog with which administrators create a local account for a person (MK-048): name, email
 * and role. The person sets the password with a link that works once: the installation mails it,
 * or, when it sends no mail, the dialog shows it this once, with a button that copies it, for the
 * administrator to pass on. The same dialog shows a new link issued for a member who has not set a
 * password yet. `mk-account-created` tells the page.
 */
@customElement('mk-create-account')
export class MkCreateAccount extends LitElement {
  static override readonly styles = css`
    dialog {
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
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
      margin: 0 0 12px;
    }
    .field {
      display: grid;
      gap: 4px;
      margin-bottom: 12px;
    }
    input,
    select,
    button {
      font: inherit;
      padding: 6px 8px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
      min-width: 0;
    }
    .copy {
      display: flex;
      gap: 8px;
    }
    .copy input {
      flex: 1;
      font-family: var(--mk-font-mono, monospace);
    }
    .hint {
      font-size: 13px;
      color: var(--mk-muted);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
    }
    button.primary {
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      font-weight: 600;
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
  @property() organization: string | undefined;

  @state() private email = '';
  @state() private personName = '';
  @state() private memberRole: 'organization-user' | 'organization-admin' = 'organization-user';
  /** The link of the account just created, or of a new link: shown until the dialog closes. */
  @state() private result: PasswordLink | undefined;
  @state() private message = '';
  @state() private copied = '';
  @state() private sending = false;

  @query('dialog') private dialog!: HTMLDialogElement;

  /** Opens the dialog empty, to create an account. */
  async openDialog(): Promise<void> {
    this.email = '';
    this.personName = '';
    this.memberRole = 'organization-user';
    this.result = undefined;
    this.message = '';
    this.copied = '';
    await this.updateComplete;
    this.dialog.showModal();
  }

  /** Opens the dialog on a link issued for a member, to show it once or say it was mailed. */
  async showLink(link: PasswordLink): Promise<void> {
    this.result = link;
    this.message = '';
    this.copied = '';
    await this.updateComplete;
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
  }

  override render(): unknown {
    return html`<dialog aria-labelledby="create-title" @close=${this.closed}>
      ${this.result ? this.renderResult(this.result) : this.renderForm()}
    </dialog>`;
  }

  private renderForm(): unknown {
    return html`<form method="dialog" @submit=${this.send}>
      <h2 id="create-title">${t('Create an account')}</h2>
      <p class="hint">
        ${t(
          'For a person who has no account yet. They choose their password with a link that works once: mailed to them, or shown here for you to pass on when this installation sends no mail.',
        )}
      </p>
      <div class="field">
        <label for="create-name">${t('Name of the person')}</label>
        <input
          id="create-name"
          type="text"
          required
          maxlength="120"
          autocomplete="off"
          .value=${this.personName}
          @input=${(event: Event) => {
            this.personName = (event.target as HTMLInputElement).value;
          }}
        />
      </div>
      <div class="field">
        <label for="create-email">${t('Email address')}</label>
        <input
          id="create-email"
          type="email"
          required
          maxlength="254"
          autocomplete="off"
          .value=${this.email}
          @input=${(event: Event) => {
            this.email = (event.target as HTMLInputElement).value;
          }}
        />
      </div>
      <div class="field">
        <label for="create-role">${t('Role in the organization')}</label>
        <select id="create-role" @change=${this.changeRole}>
          <option value="organization-user" ?selected=${this.memberRole === 'organization-user'}>
            ${t('Member')}
          </option>
          <option value="organization-admin" ?selected=${this.memberRole === 'organization-admin'}>
            ${t('Administrator')}
          </option>
        </select>
      </div>
      <p class="error" role="alert">${this.message || nothing}</p>
      <div class="actions">
        <button type="button" @click=${this.close}>${t('Cancel')}</button>
        <button class="primary" type="submit" ?disabled=${this.sending}>
          ${t('Create account')}
        </button>
      </div>
    </form>`;
  }

  private renderResult(result: PasswordLink): unknown {
    const notice = linkNotice(result);
    return html`<h2 id="create-title">${t('Link to set the password')}</h2>
      <p>${notice}</p>
      ${
        result.link
          ? html`<div class="field">
              <label for="create-link"
                >${t('Link for {name}', { name: result.member.displayName })}</label
              >
              <div class="copy">
                <input id="create-link" type="text" readonly .value=${result.link} />
                <button type="button" @click=${this.copy}>${t('Copy the link')}</button>
              </div>
              <span class="hint" aria-live="polite">${this.copied}</span>
            </div>`
          : nothing
      }
      <p class="error" role="alert">${this.message || nothing}</p>
      <div class="actions">
        <button class="primary" type="button" @click=${this.close}>${t('Done')}</button>
      </div>`;
  }

  private readonly changeRole = (event: Event): void => {
    this.memberRole = (event.target as HTMLSelectElement).value as
      'organization-user' | 'organization-admin';
  };

  private readonly send = async (event: Event): Promise<void> => {
    event.preventDefault();
    const { client, organization } = this;
    if (!client || !organization) {
      return;
    }
    this.sending = true;
    this.message = '';
    try {
      const created = await client.createAccount(organization, {
        email: this.email.trim(),
        displayName: this.personName.trim(),
        roles:
          this.memberRole === 'organization-admin'
            ? ['organization-admin', 'organization-user']
            : ['organization-user'],
      });
      this.result = created;
      this.dispatchEvent(
        new CustomEvent<OrganizationMember>('mk-account-created', {
          detail: created.member,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      this.message = t('Not created: {reason}', {
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.sending = false;
    }
  };

  private readonly copy = async (): Promise<void> => {
    const link = this.result?.link;
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.copied = t('Copied.');
    } catch {
      // Without access to the clipboard, the link stays selected to copy by hand.
      this.renderRoot.querySelector<HTMLInputElement>('#create-link')?.select();
      this.copied = t('Select the link and copy it.');
    }
  };

  private readonly close = (): void => {
    this.dialog.close();
  };

  /** The link is forgotten when the dialog closes: it is never shown again. */
  private readonly closed = (): void => {
    this.result = undefined;
    this.copied = '';
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-create-account': MkCreateAccount;
  }
}
