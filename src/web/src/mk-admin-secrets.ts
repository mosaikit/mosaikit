// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, Secret, SecretKind } from './api.js';
import { t } from './i18n.js';
import {
  SECRET_KINDS,
  SecretList,
  type SecretStore,
  audience,
  describeChange,
  emptyForm,
  formFor,
  kindLabel,
  organizationSecrets,
  type SecretForm,
} from './secrets.js';

/**
 * The credentials of the organization, for its administrators (MK-062): the keys and passwords that
 * the backends of its extensions use to call other services. A value is typed once and never shown
 * again; the list shows a masked hint. The behaviour is in {@link SecretList}.
 */
@customElement('mk-admin-secrets')
export class MkAdminSecrets extends LitElement {
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
    .hint {
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
    .field {
      display: grid;
      gap: 4px;
    }
    label {
      font-weight: 600;
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
    }
    button {
      cursor: pointer;
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    button.primary {
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
  /** The organization whose credentials are shown. */
  @property() organization: string | undefined;

  @state() private form: SecretForm = emptyForm();
  /** The name of the credential being replaced, or undefined for a new one. */
  @state() private replacing: string | undefined;
  @state() private message = '';
  @state() private failed = false;

  private list: SecretList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.list = new SecretList(this.secretStore(), {
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

  /** Where the credentials of this page are kept: the organization. */
  protected secretStore(): SecretStore | undefined {
    return organizationSecrets(this.client, this.organization);
  }

  /** The title of the page. */
  protected heading(): string {
    return t('Credentials');
  }

  /** What the page is for. */
  protected introduction(): string {
    return t(
      'Keys and passwords with which the extensions of your organization call other services. They are encrypted, only the servers of the extensions read them, and nobody sees a value again after saving it.',
    );
  }

  override render(): unknown {
    const secrets = this.list?.secrets;
    return html`
      <h1>${this.heading()}</h1>
      <p>${this.introduction()}</p>
      ${
        secrets === undefined
          ? nothing
          : secrets.length === 0
            ? html`<p>${t('No credential yet.')}</p>`
            : this.renderTable(secrets)
      }
      ${this.renderForm()}
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderTable(secrets: readonly Secret[]): unknown {
    return html`<table>
      <thead>
        <tr>
          <th scope="col">${t('Name')}</th>
          <th scope="col">${t('Kind')}</th>
          <th scope="col">${t('Value')}</th>
          <th scope="col">${t('For')}</th>
          <th scope="col">${t('Changed')}</th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${secrets.map(
          (secret) =>
            html`<tr>
              <th scope="row">
                ${secret.name}
                ${secret.description ? html`<div class="muted">${secret.description}</div>` : nothing}
              </th>
              <td>${kindLabel(secret.kind)}</td>
              <td class="hint">${secret.hint}</td>
              <td>${audience(secret)}</td>
              <td>${describeChange(secret)}</td>
              <td>
                <div class="actions">
                  <button
                    type="button"
                    aria-label=${t('Replace {name}', { name: secret.name })}
                    @click=${() => {
                      this.edit(secret);
                    }}
                  >
                    ${t('Replace')}
                  </button>
                  <button
                    type="button"
                    aria-label=${t('Delete {name}', { name: secret.name })}
                    @click=${() => void this.confirmDelete(secret)}
                  >
                    ${t('Delete')}
                  </button>
                </div>
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
  }

  private renderForm(): unknown {
    const replacing = this.replacing !== undefined;
    return html`<form @submit=${this.submit} aria-labelledby="secret-form-title" novalidate>
      <h2 id="secret-form-title">
        ${replacing ? t('Replace {name}', { name: this.replacing ?? '' }) : t('Store a credential')}
      </h2>
      <div class="field">
        <label for="secret-name">${t('Name')}</label>
        <input
          id="secret-name"
          autocomplete="off"
          spellcheck="false"
          aria-describedby="secret-name-help"
          .value=${this.form.name}
          ?disabled=${replacing}
          required
          @input=${(event: Event) => {
            this.change({ name: (event.target as HTMLInputElement).value });
          }}
        />
        <span class="muted" id="secret-name-help">
          ${t('How the extensions ask for it, such as model-provider.')}
        </span>
      </div>
      <div class="field">
        <label for="secret-kind">${t('Kind')}</label>
        <select
          id="secret-kind"
          @change=${(event: Event) => {
            this.change({ kind: (event.target as HTMLSelectElement).value as SecretKind });
          }}
        >
          ${SECRET_KINDS.map(
            (kind) =>
              html`<option value=${kind} ?selected=${this.form.kind === kind}>
                ${kindLabel(kind)}
              </option>`,
          )}
        </select>
      </div>
      <div class="field">
        <label for="secret-value">${replacing ? t('New value') : t('Value')}</label>
        <input
          id="secret-value"
          type="password"
          autocomplete="new-password"
          spellcheck="false"
          aria-describedby="secret-value-help"
          .value=${this.form.value}
          ?required=${!replacing}
          @input=${(event: Event) => {
            this.change({ value: (event.target as HTMLInputElement).value });
          }}
        />
        <span class="muted" id="secret-value-help">
          ${
            replacing
              ? t('Leave it empty to keep the current value.')
              : t('It is encrypted at once and never shown again.')
          }
        </span>
      </div>
      <div class="field">
        <label for="secret-description">${t('Description')}</label>
        <input
          id="secret-description"
          .value=${this.form.description}
          @input=${(event: Event) => {
            this.change({ description: (event.target as HTMLInputElement).value });
          }}
        />
      </div>
      <div class="field">
        <label for="secret-extension">${t('Only for the extension')}</label>
        <input
          id="secret-extension"
          spellcheck="false"
          aria-describedby="secret-extension-help"
          .value=${this.form.extension}
          @input=${(event: Event) => {
            this.change({ extension: (event.target as HTMLInputElement).value });
          }}
        />
        <span class="muted" id="secret-extension-help">
          ${t('Its identifier, such as org.example.reports. Empty: any extension may use it.')}
        </span>
      </div>
      <div class="actions">
        <button class="primary" type="submit">
          ${replacing ? t('Save changes') : t('Store credential')}
        </button>
        ${
          replacing
            ? html`<button type="button" @click=${this.cancel}>${t('Cancel')}</button>`
            : nothing
        }
      </div>
    </form>`;
  }

  private change(change: Partial<SecretForm>): void {
    this.form = { ...this.form, ...change };
  }

  private edit(secret: Secret): void {
    this.replacing = secret.name;
    this.form = formFor(secret);
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>('#secret-value')?.focus();
    });
  }

  private readonly cancel = (): void => {
    this.replacing = undefined;
    this.form = emptyForm();
  };

  private readonly submit = async (event: Event): Promise<void> => {
    event.preventDefault();
    const form = { ...this.form };
    const saved = await this.list?.save(form, this.replacing !== undefined);
    // The value never stays in the page, saved or not.
    this.form = saved ? emptyForm() : { ...this.form, value: '' };
    if (saved) {
      this.replacing = undefined;
    }
  };

  private async confirmDelete(secret: Secret): Promise<void> {
    if (
      !confirm(
        t('Delete the credential {name}? The extensions that use it stop working with it.', {
          name: secret.name,
        }),
      )
    ) {
      return;
    }
    if (this.replacing === secret.name) {
      this.cancel();
    }
    await this.list?.remove(secret);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-secrets': MkAdminSecrets;
  }
}
