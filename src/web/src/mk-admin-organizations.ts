// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, OrganizationSummary } from './api.js';
import { t } from './i18n.js';
import { OrganizationList, confirms } from './organizations.js';
import { when } from './sessions.js';

/**
 * The organizations of the installation, for platform administrators: the list, and the deletion of
 * one after its slug is written again (MK-130). The behaviour is in {@link OrganizationList}.
 */
@customElement('mk-admin-organizations')
export class MkAdminOrganizations extends LitElement {
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
    tbody th {
      font-size: inherit;
      color: var(--mk-fg);
    }
    .slug {
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
      border: 1px solid var(--mk-danger);
      border-radius: calc(var(--mk-radius) * 2);
      margin-bottom: 24px;
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
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    button.danger {
      border-color: var(--mk-danger);
      color: var(--mk-danger);
      font-weight: 600;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.6;
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

  /** The organization whose deletion is being confirmed. */
  @state() private deleting: OrganizationSummary | undefined;
  @state() private typed = '';
  @state() private message = '';
  @state() private failed = false;

  private list: OrganizationList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.list = new OrganizationList(
      this.client,
      {
        changed: () => {
          this.requestUpdate();
        },
        announce: (message, failed) => {
          this.message = message;
          this.failed = failed;
        },
      },
      when,
    );
    void this.list.load();
  }

  override render(): unknown {
    const organizations = this.list?.organizations;
    return html`
      <h1>${t('Organizations')}</h1>
      <p>
        ${t(
          'The organizations of the installation. Deleting one ends the access of its people at once; its data stay for the retention of the installation, then are removed.',
        )}
      </p>
      ${this.deleting ? this.renderConfirmation(this.deleting) : nothing}
      ${
        organizations === undefined
          ? nothing
          : organizations.length === 0
            ? html`<p>${t('No organization yet.')}</p>`
            : this.renderTable(organizations)
      }
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderTable(organizations: readonly OrganizationSummary[]): unknown {
    return html`<table>
      <thead>
        <tr>
          <th scope="col">${t('Name')}</th>
          <th scope="col">${t('Slug')}</th>
          <th scope="col">${t('Created')}</th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${organizations.map(
          (organization) =>
            html`<tr>
              <th scope="row">${organization.name}</th>
              <td class="slug">${organization.slug}</td>
              <td>${when(organization.createdAt)}</td>
              <td>
                <button
                  type="button"
                  class="danger"
                  aria-label=${t('Delete {name}', { name: organization.name })}
                  @click=${() => {
                    this.deleting = organization;
                    this.typed = '';
                  }}
                >
                  ${t('Delete')}
                </button>
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
  }

  private renderConfirmation(organization: OrganizationSummary): unknown {
    return html`<form @submit=${this.submitDelete} aria-labelledby="delete-title" novalidate>
      <h2 id="delete-title">${t('Delete {name}', { name: organization.name })}</h2>
      <p>
        ${t(
          'Its people lose access at once and it appears nowhere any more; its extensions are told. Its data stay for the retention of the installation, then are removed for good.',
        )}
      </p>
      <label for="delete-confirmation">
        ${t('Write {slug} to confirm', { slug: organization.slug })}
      </label>
      <input
        id="delete-confirmation"
        spellcheck="false"
        autocomplete="off"
        .value=${this.typed}
        @input=${(event: Event) => {
          this.typed = (event.target as HTMLInputElement).value;
        }}
      />
      <div class="actions">
        <button class="danger" type="submit" ?disabled=${!confirms(organization, this.typed)}>
          ${t('Delete the organization')}
        </button>
        <button
          type="button"
          @click=${() => {
            this.deleting = undefined;
            this.typed = '';
          }}
        >
          ${t('Cancel')}
        </button>
      </div>
    </form>`;
  }

  private readonly submitDelete = async (event: Event): Promise<void> => {
    event.preventDefault();
    const organization = this.deleting;
    if (organization && (await this.list?.remove(organization, this.typed))) {
      this.deleting = undefined;
      this.typed = '';
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-organizations': MkAdminOrganizations;
  }
}
