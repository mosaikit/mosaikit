// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { AccessKeyList, describeAccess, describeKey, expiryChoices } from './access-keys.js';
import type { AccessKey, KernelClient, Membership } from './api.js';
import { t } from './i18n.js';

/**
 * The personal access keys of the signed-in person, in their settings (MK-060): a form to create one
 * (name, organization, expiry, write switch), the secret of the key just created with a copy button,
 * shown once, and the list of keys with their prefix, creation, last use and expiry, each revocable.
 * The behaviour is in {@link AccessKeyList}; messages go to the one status region of the settings
 * page, through `mk-settings-status`.
 */
@customElement('mk-access-keys')
export class MkAccessKeys extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    form {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 16px;
      align-items: flex-end;
      margin: 0 0 16px;
    }
    label {
      display: inline-flex;
      flex-direction: column;
      gap: 4px;
      font-size: 14px;
    }
    label.switch {
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
    input[type='text'],
    select {
      font: inherit;
      padding: 6px 8px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
      color: var(--mk-fg);
    }
    input[type='checkbox'] {
      accent-color: var(--mk-accent);
    }
    .secret {
      margin: 0 0 16px;
      padding: 12px 16px;
      border: 1px solid var(--mk-accent);
      border-radius: var(--mk-radius);
      background: var(--mk-accent-soft);
    }
    .secret p {
      margin: 0 0 8px;
    }
    .secret .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .secret input {
      flex: 1 1 320px;
      min-width: 0;
      font-family: var(--mk-font-mono, ui-monospace, monospace);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 12px;
    }
    li {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--mk-line);
    }
    li:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .name {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .tag {
      display: inline-block;
      margin-left: 8px;
      padding: 0 8px;
      border-radius: 999px;
      background: var(--mk-accent-soft);
      color: var(--mk-fg);
      font-size: 13px;
      font-weight: 600;
    }
    .muted {
      margin: 2px 0 0;
      color: var(--mk-muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    button {
      flex: none;
      font: inherit;
      padding: 4px 12px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
      cursor: pointer;
    }
    button[disabled] {
      cursor: default;
      opacity: 0.6;
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;
  /** The organizations of the person, among which a key acts on one. */
  @property({ attribute: false }) memberships: readonly Membership[] = [];
  /** The slug of the organization the shell acts on, chosen by default. */
  @property() organization = '';

  @state() private name = '';
  @state() private chosen = '';
  @state() private days = 0;
  @state() private write = false;

  private list: AccessKeyList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.list = new AccessKeyList(this.client, {
      changed: () => {
        this.requestUpdate();
      },
      announce: (message) => {
        this.dispatchEvent(
          new CustomEvent('mk-settings-status', { detail: message, bubbles: true, composed: true }),
        );
      },
    });
    void this.list.load();
  }

  override render(): unknown {
    const list = this.list;
    const keys = list?.keys;
    return html`
      <p class="muted">
        ${t(
          'Keys let your scripts and other programs call the platform as you, in one organization. Treat a key like a password; revoke it when you no longer need it.',
        )}
      </p>
      ${this.renderForm()} ${this.renderCreated()}
      ${
        keys === undefined
          ? nothing
          : keys.length === 0
            ? html`<p>${t('No access key.')}</p>`
            : html`<ul aria-label=${t('Access keys')}>
                ${keys.map((key) => this.renderKey(key))}
              </ul>`
      }
    `;
  }

  private renderForm(): unknown {
    const list = this.list;
    if (!list || this.memberships.length === 0) {
      return nothing;
    }
    const choices = expiryChoices(list.maxValidityDays);
    const days = choices.includes(this.days) ? this.days : (choices.at(-1) ?? list.maxValidityDays);
    const organization = this.chosenOrganization();
    return html`<form
      aria-label=${t('New access key')}
      @submit=${async (event: Event) => {
        event.preventDefault();
        const created = await list.create({
          name: this.name,
          organization,
          days,
          write: this.write,
        });
        if (created) {
          this.name = '';
          this.write = false;
        }
      }}
    >
      <label
        >${t('Name')}
        <input
          type="text"
          name="name"
          maxlength="100"
          required
          autocomplete="off"
          .value=${this.name}
          @input=${(event: Event) => {
            this.name = (event.target as HTMLInputElement).value;
          }}
      /></label>
      <label
        >${t('Organization')}
        <select
          name="organization"
          @change=${(event: Event) => {
            this.chosen = (event.target as HTMLSelectElement).value;
          }}
        >
          ${this.memberships.map(
            (membership) =>
              html`<option value=${membership.slug} ?selected=${membership.slug === organization}>
                ${membership.name}
              </option>`,
          )}
        </select></label
      >
      <label
        >${t('Expires after')}
        <select
          name="expiry"
          @change=${(event: Event) => {
            this.days = Number((event.target as HTMLSelectElement).value);
          }}
        >
          ${choices.map(
            (choice) =>
              html`<option value=${choice} ?selected=${choice === days}>
                ${t('{days} days', { days: choice })}
              </option>`,
          )}
        </select></label
      >
      <label class="switch"
        ><input
          type="checkbox"
          name="write"
          .checked=${this.write}
          @change=${(event: Event) => {
            this.write = (event.target as HTMLInputElement).checked;
          }}
        />${t('Allow changes (write)')}</label
      >
      <button type="submit" ?disabled=${list.busy}>${t('Create key')}</button>
    </form>`;
  }

  private chosenOrganization(): string {
    const slugs = this.memberships.map((membership) => membership.slug);
    if (slugs.includes(this.chosen)) {
      return this.chosen;
    }
    return slugs.includes(this.organization) ? this.organization : (slugs[0] ?? '');
  }

  private renderCreated(): unknown {
    const created = this.list?.created;
    if (!created?.secret) {
      return nothing;
    }
    return html`<div class="secret" role="group" aria-labelledby="new-key-title">
      <p id="new-key-title">
        <strong>${t('Your new key {name}', { name: created.name })}</strong>
      </p>
      <p>${t('Copy it now and keep it somewhere safe: it will not be shown again.')}</p>
      <div class="row">
        <input
          type="text"
          readonly
          aria-label=${t('The new access key')}
          .value=${created.secret}
          @focus=${(event: Event) => {
            (event.target as HTMLInputElement).select();
          }}
        />
        <button type="button" @click=${() => void this.list?.copy(navigator.clipboard)}>
          ${t('Copy')}
        </button>
        <button type="button" @click=${() => this.list?.dismiss()}>${t('Done')}</button>
      </div>
    </div>`;
  }

  private renderKey(key: AccessKey): unknown {
    const label = `key-${key.id}`;
    const organization =
      this.memberships.find((membership) => membership.slug === key.organization)?.name ??
      key.organization;
    return html`<li>
      <div>
        <div class="name" id=${label}>
          ${key.name}<span class="tag">${describeAccess(key)}</span>${
            key.expired ? html`<span class="tag">${t('Expired')}</span>` : nothing
          }
        </div>
        <p class="muted">${organization} · ${describeKey(key)}</p>
      </div>
      <button type="button" aria-describedby=${label} @click=${() => void this.list?.revoke(key)}>
        ${t('Revoke')}
      </button>
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-access-keys': MkAccessKeys;
  }
}
