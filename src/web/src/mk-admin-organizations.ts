// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, OrganizationSummary } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';
import './mk-new-organization.js';
import type { Created } from './organization-wizard.js';
import {
  MAX_SUSPENSION_REASON,
  OrganizationList,
  type OrganizationState,
  confirms,
  filterOrganizations,
  organizationMetrics,
  signInLabel,
} from './organizations.js';
import { when } from './sessions.js';

/** What the side pane shows. */
type Pane =
  | { readonly kind: 'detail'; readonly slug: string }
  | { readonly kind: 'delete'; readonly slug: string }
  | { readonly kind: 'new' };

/**
 * The organizations of the installation, for platform administrators, on the model of the
 * administration pages (MK-072): metrics on top, filters above the table, the actions of each row,
 * and the detail of a row in a side pane. A guided flow creates an organization with its
 * administrator and sign-in method; an organization is suspended and reactivated (MK-072), and
 * deleted after its slug is written again (MK-130). The behaviour is in {@link OrganizationList}.
 */
@customElement('mk-admin-organizations')
export class MkAdminOrganizations extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--mk-surface);
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
    tr.selected {
      background: var(--mk-accent-soft, transparent);
    }
    .slug,
    code {
      font-family: var(--mk-font-mono, monospace);
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    .pill {
      display: inline-block;
      padding: 0 8px;
      border-radius: 10px;
      font-size: 13px;
      border: 1px solid var(--mk-line);
    }
    .pill.suspended {
      border-color: var(--mk-danger);
      color: var(--mk-danger);
    }
    form,
    .pane {
      display: grid;
      gap: 12px;
    }
    label {
      display: grid;
      gap: 4px;
      font-weight: 600;
    }
    input,
    select,
    textarea,
    button,
    a.button {
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
    }
    button.primary {
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      font-weight: 600;
    }
    button.link {
      border: none;
      background: none;
      padding: 0;
      color: var(--mk-accent);
      text-decoration: underline;
      text-align: left;
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
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 12px;
      margin: 0;
    }
    dt {
      color: var(--mk-muted);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
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

  @state() private pane: Pane | undefined;
  @state() private search = '';
  @state() private stateFilter: OrganizationState = 'all';
  @state() private typed = '';
  @state() private reason = '';
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
    // The console opens the guided creation with /admin/organizations?new.
    if (new URLSearchParams(location.search).has('new')) {
      this.pane = { kind: 'new' };
    }
    void this.list.load();
  }

  override render(): unknown {
    const organizations = this.list?.organizations;
    const shown = filterOrganizations(organizations ?? [], this.search, this.stateFilter);
    const selected = this.selected();
    return html`
      <mk-admin-view
        heading=${t('Organizations')}
        description=${t(
          'The organizations of the installation. Suspending one stops the sign-in of its members until it is reactivated; deleting one ends the access of its people at once, and its data stay for the retention of the installation, then are removed.',
        )}
        name="mosaikit.admin.organizations"
        .metrics=${organizationMetrics(organizations ?? [])}
        ?detail-open=${this.pane !== undefined}
        @mk-detail-close=${this.closePane}
      >
        <button
          slot="actions"
          type="button"
          class="primary"
          @click=${() => {
            this.pane = { kind: 'new' };
          }}
        >
          ${t('New organization')}
        </button>
        <label slot="filters"
          >${t('Search organizations')}
          <input
            type="search"
            .value=${this.search}
            @input=${(event: Event) => {
              this.search = (event.target as HTMLInputElement).value;
            }}
        /></label>
        <label slot="filters"
          >${t('State')}
          <select
            .value=${this.stateFilter}
            @change=${(event: Event) => {
              this.stateFilter = (event.target as HTMLSelectElement).value as OrganizationState;
            }}
          >
            <option value="all">${t('All')}</option>
            <option value="active">${t('Active')}</option>
            <option value="suspended">${t('Suspended')}</option>
          </select></label
        >
        ${
          organizations === undefined
            ? nothing
            : organizations.length === 0
              ? html`<p>${t('No organization yet.')}</p>`
              : shown.length === 0
                ? html`<p>${t('No organization matches the filters.')}</p>`
                : this.renderTable(shown)
        }
        <aside
          slot="detail"
          class="pane"
          aria-label=${
            this.pane?.kind === 'new' ? t('New organization') : (selected?.name ?? t('Detail'))
          }
        >
          ${this.renderPane()}
        </aside>
      </mk-admin-view>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private selected(): OrganizationSummary | undefined {
    const pane = this.pane;
    if (!pane || pane.kind === 'new') {
      return undefined;
    }
    return this.list?.organizations?.find((organization) => organization.slug === pane.slug);
  }

  private renderTable(organizations: readonly OrganizationSummary[]): unknown {
    const selected = this.selected()?.slug;
    return html`<table aria-label=${t('Organizations')}>
      <thead>
        <tr>
          <th scope="col">${t('Name')}</th>
          <th scope="col">${t('Slug')}</th>
          <th scope="col">${t('Sign-in')}</th>
          <th scope="col">${t('State')}</th>
          <th scope="col">${t('Created')}</th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${organizations.map(
          (organization) =>
            html`<tr class=${organization.slug === selected ? 'selected' : ''}>
              <th scope="row">
                <button
                  type="button"
                  class="link"
                  aria-label=${t('Details of {name}', { name: organization.name })}
                  @click=${() => {
                    this.open({ kind: 'detail', slug: organization.slug });
                  }}
                >
                  ${organization.name}
                </button>
              </th>
              <td class="slug">${organization.slug}</td>
              <td>${signInLabel(organization.signIn)}</td>
              <td>
                ${
                  organization.suspended
                    ? html`<span class="pill suspended">${t('Suspended')}</span>`
                    : html`<span class="pill">${t('Active')}</span>`
                }
              </td>
              <td>${when(organization.createdAt)}</td>
              <td>
                <div class="actions">
                  ${
                    organization.suspended
                      ? html`<button
                          type="button"
                          aria-label=${t('Reactivate {name}', { name: organization.name })}
                          @click=${() => void this.list?.reactivate(organization)}
                        >
                          ${t('Reactivate')}
                        </button>`
                      : html`<button
                          type="button"
                          aria-label=${t('Suspend {name}', { name: organization.name })}
                          @click=${() => {
                            this.open({ kind: 'detail', slug: organization.slug });
                          }}
                        >
                          ${t('Suspend')}
                        </button>`
                  }
                  <button
                    type="button"
                    class="danger"
                    aria-label=${t('Delete {name}', { name: organization.name })}
                    @click=${() => {
                      this.open({ kind: 'delete', slug: organization.slug });
                    }}
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

  private renderPane(): unknown {
    const pane = this.pane;
    if (!pane) {
      return nothing;
    }
    if (pane.kind === 'new') {
      return html`<mk-new-organization
        .client=${this.client}
        @mk-wizard-cancel=${this.closePane}
        @mk-organization-created=${(event: CustomEvent<Created>) => {
          this.list?.added(event.detail.organization);
          this.message = t('{name} is created.', { name: event.detail.organization.name });
          this.failed = false;
        }}
      ></mk-new-organization>`;
    }
    const organization = this.selected();
    if (!organization) {
      return nothing;
    }
    return pane.kind === 'delete'
      ? this.renderConfirmation(organization)
      : this.renderDetail(organization);
  }

  private renderDetail(organization: OrganizationSummary): unknown {
    const suspension = organization.suspension;
    return html`<h2>${organization.name}</h2>
      <dl>
        <dt>${t('Slug')}</dt>
        <dd><code>${organization.slug}</code></dd>
        <dt>${t('Created')}</dt>
        <dd>${when(organization.createdAt)}</dd>
        <dt>${t('Sign-in')}</dt>
        <dd>${signInLabel(organization.signIn)}</dd>
        <dt>${t('Identity provider')}</dt>
        <dd>${organization.identityRealm ?? t('None')}</dd>
        <dt>${t('Email domains')}</dt>
        <dd>
          ${organization.emailDomains.length > 0 ? organization.emailDomains.join(', ') : t('None')}
        </dd>
        <dt>${t('State')}</dt>
        <dd>
          ${
            suspension
              ? `${t('Suspended {when} by {person}.', { when: when(suspension.at), person: suspension.by })} ${
                  suspension.reason
                    ? t('Reason: {reason}', { reason: suspension.reason })
                    : t('No reason was given.')
                }`
              : t('Active: its members sign in.')
          }
        </dd>
      </dl>
      ${
        organization.suspended
          ? html`<div class="actions">
              <button
                type="button"
                class="primary"
                @click=${() => void this.list?.reactivate(organization)}
              >
                ${t('Reactivate')}
              </button>
            </div>`
          : html`<form
              @submit=${(event: Event) => {
                event.preventDefault();
                void this.suspend(organization);
              }}
              aria-labelledby="suspend-title"
              novalidate
            >
              <h2 id="suspend-title">${t('Suspend {name}', { name: organization.name })}</h2>
              <label
                >${t('Reason for the suspension')}
                <textarea
                  maxlength=${MAX_SUSPENSION_REASON}
                  aria-describedby="suspend-help"
                  .value=${this.reason}
                  @input=${(event: Event) => {
                    this.reason = (event.target as HTMLTextAreaElement).value;
                  }}
                ></textarea>
              </label>
              <span class="muted" id="suspend-help">
                ${t(
                  'Its members cannot sign in to it until it is reactivated, and their sessions in it end at once; its data stay. The reason is kept in the audit log.',
                )}
              </span>
              <div class="actions">
                <button type="submit" class="danger">${t('Suspend the organization')}</button>
              </div>
            </form>`
      }`;
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
        <button type="button" @click=${this.closePane}>${t('Cancel')}</button>
      </div>
    </form>`;
  }

  private open(pane: Pane): void {
    this.pane = pane;
    this.typed = '';
    this.reason = '';
  }

  private readonly closePane = (): void => {
    this.pane = undefined;
    this.typed = '';
    this.reason = '';
  };

  private async suspend(organization: OrganizationSummary): Promise<void> {
    if (
      this.reason.trim() &&
      !confirm(
        t('Suspend {name}? Its members cannot sign in to it until it is reactivated.', {
          name: organization.name,
        }),
      )
    ) {
      return;
    }
    if (await this.list?.suspend(organization, this.reason)) {
      this.reason = '';
    }
  }

  private readonly submitDelete = async (event: Event): Promise<void> => {
    event.preventDefault();
    const pane = this.pane;
    const organization = this.selected();
    if (
      pane?.kind === 'delete' &&
      organization &&
      (await this.list?.remove(organization, this.typed))
    ) {
      this.closePane();
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-organizations': MkAdminOrganizations;
  }
}
