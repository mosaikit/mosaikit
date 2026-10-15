// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { filterServices, serviceMetrics } from './admin-pages.js';
import { adminStyles } from './admin-styles.js';
import type { KernelClient, ServiceIdentity, ServiceKey } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';
import {
  ServiceIdentityList,
  describeGrants,
  describeServiceKey,
  type ServiceIdentityForm,
} from './service-identities.js';

const EMPTY: ServiceIdentityForm = {
  name: '',
  description: '',
  apis: '',
  endpoints: [],
  organizations: '',
};

/** What each endpoint of the kernel meant for services lets an identity do. */
const ENDPOINT_TITLES: Record<string, string> = {
  'check-session': 'Check the sessions of people',
  'check-key': 'Check the access keys of people',
};

/**
 * The service identities of the installation, for platform administrators (MK-124): a form to create
 * one (name, description, APIs of extensions, endpoints of the kernel, organizations), the secret of
 * the key just created with a copy button, shown once, and the list of identities with what they may
 * call and their keys, with the prefix, creation and last use of each; an identity can be changed, get
 * a new key to rotate the old one, and have a key revoked. The behaviour is in {@link
 * ServiceIdentityList}; the page has one status region.
 */
@customElement('mk-admin-services')
export class MkAdminServices extends LitElement {
  static override readonly styles = [
    adminStyles,
    css`
      form {
        display: grid;
        gap: 12px;
        margin: 8px 0 0;
      }
      h2.name {
        margin: 0;
        font-size: 1.1em;
      }
      fieldset {
        border: 0;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
      }
      legend {
        font-size: 14px;
        margin-bottom: 4px;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 14px;
      }
      label.check {
        flex-direction: row;
        align-items: center;
        gap: 8px;
      }
      input[type='text'] {
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
      .hint,
      .muted {
        margin: 2px 0 0;
        color: var(--mk-muted);
        font-size: 13px;
        overflow-wrap: anywhere;
      }
      .secret {
        margin: 0 0 24px;
        padding: 12px 16px;
        border: 1px solid var(--mk-accent);
        border-radius: var(--mk-radius);
        background: var(--mk-accent-soft);
      }
      .secret p {
        margin: 0 0 8px;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
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
        gap: 16px;
      }
      li.identity {
        padding-bottom: 16px;
        border-bottom: 1px solid var(--mk-line);
      }
      li.identity:last-child {
        border-bottom: 0;
      }
      .name {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      ul.keys {
        gap: 8px;
        margin: 8px 0;
      }
      ul.keys li {
        display: flex;
        gap: 16px;
        align-items: center;
        justify-content: space-between;
      }
      button:not(.link) {
        flex: none;
        font: inherit;
        padding: 4px 12px;
        border-radius: var(--mk-radius);
        border: 1px solid var(--mk-line);
        background: var(--mk-surface);
        color: var(--mk-fg);
        cursor: pointer;
      }
      button.primary {
        border-color: var(--mk-accent);
        background: var(--mk-accent);
        color: var(--mk-accent-fg);
        justify-self: start;
      }
      button[disabled] {
        cursor: default;
        opacity: 0.6;
      }
    `,
  ];

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private form: ServiceIdentityForm = EMPTY;
  /** The identity being changed, and its form. */
  @state() private editing: { id: string; form: ServiceIdentityForm } | undefined;
  @state() private message = '';
  @state() private search = '';
  /** Whether the side pane creates an identity. */
  @state() private creating = false;
  /** The identity in the side pane. */
  @state() private selected: string | undefined;

  private list: ServiceIdentityList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.list = new ServiceIdentityList(this.client, {
      changed: () => {
        this.requestUpdate();
      },
      announce: (message) => {
        this.message = message;
      },
    });
    void this.list.load();
  }

  override render(): unknown {
    const identities = this.list?.identities;
    const shown = filterServices(identities ?? [], this.search);
    const selected = identities?.find((identity) => identity.id === this.selected);
    return html`
      <mk-admin-view
        heading=${t('Service identities')}
        description=${t(
          'For the services that call the APIs of extensions without a person, such as a gateway. Each has its own key, the APIs it may call and no organization; it never opens the shell.',
        )}
        name="mosaikit.admin.services"
        .metrics=${serviceMetrics(identities, this.list?.maxKeys ?? 2)}
        ?detail-open=${this.creating || selected !== undefined}
        @mk-detail-close=${this.closePane}
      >
        <button
          slot="actions"
          type="button"
          class="primary"
          @click=${() => {
            this.selected = undefined;
            this.editing = undefined;
            this.creating = true;
          }}
        >
          ${t('New service identity')}
        </button>
        <label slot="filters" class="filter"
          >${t('Search service identities')}
          <input
            type="search"
            .value=${this.search}
            @input=${(event: Event) => {
              this.search = (event.target as HTMLInputElement).value;
            }}
        /></label>
        <p class="status" role="status" aria-live="polite">${this.message}</p>
        ${this.renderCreated()}
        ${
          identities === undefined
            ? nothing
            : identities.length === 0
              ? html`<p>${t('No service identity.')}</p>`
              : shown.length === 0
                ? html`<p>${t('No service identity matches the filters.')}</p>`
                : this.renderTable(shown)
        }
        <aside
          slot="detail"
          class="pane"
          aria-label=${selected ? selected.name : t('New service identity')}
        >
          ${this.creating ? this.renderNew() : nothing}
          ${selected ? this.renderIdentity(selected) : nothing}
        </aside>
      </mk-admin-view>
    `;
  }

  private renderTable(identities: readonly ServiceIdentity[]): unknown {
    const list = this.list;
    return html`<table aria-label=${t('Service identities')}>
      <thead>
        <tr>
          <th scope="col">${t('Name')}</th>
          <th scope="col">${t('May call')}</th>
          <th scope="col">${t('Live keys')}</th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${identities.map((identity) => {
          const label = `service-row-${identity.id}`;
          return html`<tr class=${identity.id === this.selected ? 'selected' : ''}>
            <th scope="row">
              <button
                type="button"
                class="link"
                id=${label}
                aria-label=${t('Details of {name}', { name: identity.name })}
                @click=${() => {
                  this.open(identity);
                }}
              >
                ${identity.name}
              </button>
              ${identity.description ? html`<p class="muted">${identity.description}</p>` : nothing}
            </th>
            <td>${describeGrants(identity)}</td>
            <td>
              ${
                identity.keys.length === 0
                  ? html`<span class="muted">${t('None')}</span>`
                  : identity.keys.map((key) => html`<div class="muted">${key.prefix}…</div>`)
              }
            </td>
            <td>
              <div class="row">
                <button
                  type="button"
                  aria-label=${t('New key for {name}', { name: identity.name })}
                  ?disabled=${!list?.canRotate(identity) || list.busy}
                  @click=${() => void list?.rotate(identity)}
                >
                  ${t('New key')}
                </button>
                <button
                  type="button"
                  aria-label=${t('Change what {name} may call', { name: identity.name })}
                  @click=${() => {
                    this.open(identity, true);
                  }}
                >
                  ${t('Change')}
                </button>
              </div>
            </td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  private open(identity: ServiceIdentity, edit = false): void {
    this.creating = false;
    this.selected = identity.id;
    this.editing = edit
      ? {
          id: identity.id,
          form: {
            name: identity.name,
            description: identity.description,
            apis: identity.apis.join(', '),
            endpoints: identity.endpoints,
            organizations: identity.organizations.join(', '),
          },
        }
      : undefined;
  }

  private readonly closePane = (): void => {
    this.creating = false;
    this.selected = undefined;
    this.editing = undefined;
  };

  private renderNew(): unknown {
    const list = this.list;
    if (!list) {
      return nothing;
    }
    return html`<form
      aria-label=${t('New service identity')}
      @submit=${async (event: Event) => {
        event.preventDefault();
        if (await list.create(this.form)) {
          this.form = EMPTY;
          // The new key shows above the table, once.
          this.creating = false;
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
          .value=${this.form.name}
          @input=${(event: Event) => {
            this.form = { ...this.form, name: (event.target as HTMLInputElement).value };
          }}
      /></label>
      ${this.renderFields('new', this.form, (form) => {
        this.form = form;
      })}
      <button class="primary" type="submit" ?disabled=${list.busy}>
        ${t('Create service identity')}
      </button>
    </form>`;
  }

  /** The fields shared by the creation and the change of an identity. */
  private renderFields(
    id: string,
    form: ServiceIdentityForm,
    change: (form: ServiceIdentityForm) => void,
  ): unknown {
    const endpoints = this.list?.endpoints ?? [];
    return html`<label
        >${t('Description')}
        <input
          type="text"
          name="description"
          maxlength="500"
          autocomplete="off"
          .value=${form.description}
          @input=${(event: Event) => {
            change({ ...form, description: (event.target as HTMLInputElement).value });
          }}
      /></label>
      <label
        >${t('APIs of extensions')}
        <input
          type="text"
          name="apis"
          autocomplete="off"
          aria-describedby="${id}-apis-hint"
          .value=${form.apis}
          @input=${(event: Event) => {
            change({ ...form, apis: (event.target as HTMLInputElement).value });
          }}
        />
        <span class="hint" id="${id}-apis-hint"
          >${t('The names in /api/v1/ext/<api>/, separated by commas, such as catalog.')}</span
        ></label
      >
      ${
        endpoints.length === 0
          ? nothing
          : html`<fieldset>
              <legend>${t('Endpoints of the kernel')}</legend>
              ${endpoints.map(
                (endpoint) =>
                  html`<label class="check"
                    ><input
                      type="checkbox"
                      name="endpoint"
                      value=${endpoint}
                      .checked=${form.endpoints.includes(endpoint)}
                      @change=${(event: Event) => {
                        const checked = (event.target as HTMLInputElement).checked;
                        change({
                          ...form,
                          endpoints: checked
                            ? [...form.endpoints, endpoint]
                            : form.endpoints.filter((other) => other !== endpoint),
                        });
                      }}
                    />${t(ENDPOINT_TITLES[endpoint] ?? endpoint)}</label
                  >`,
              )}
            </fieldset>`
      }
      <label
        >${t('Organizations it may name')}
        <input
          type="text"
          name="organizations"
          autocomplete="off"
          aria-describedby="${id}-organizations-hint"
          .value=${form.organizations}
          @input=${(event: Event) => {
            change({ ...form, organizations: (event.target as HTMLInputElement).value });
          }}
        />
        <span class="hint" id="${id}-organizations-hint"
          >${t(
            'Slugs, separated by commas; with the X-Mosaikit-Organization header, a call acts on one of them. Leave empty for none.',
          )}</span
        ></label
      >`;
  }

  private renderCreated(): unknown {
    const created = this.list?.created;
    if (!created) {
      return nothing;
    }
    return html`<div class="secret" role="group" aria-labelledby="new-service-key-title">
      <p id="new-service-key-title">
        <strong>${t('The new key of {name}', { name: created.identity })}</strong>
      </p>
      <p>
        ${t('Copy it now and put it in the configuration of the service: it will not be shown again.')}
      </p>
      <div class="row">
        <input
          type="text"
          readonly
          aria-label=${t('The new key of the service')}
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

  private renderIdentity(identity: ServiceIdentity): unknown {
    const list = this.list;
    const label = `service-${identity.id}`;
    const editing = this.editing?.id === identity.id ? this.editing : undefined;
    return html`<div class="identity">
      <h2 class="name" id=${label}>${identity.name}</h2>
      ${identity.description ? html`<p class="muted">${identity.description}</p>` : nothing}
      <p class="muted">${describeGrants(identity)}</p>
      ${
        identity.keys.length === 0
          ? html`<p class="muted">${t('No live key: create one to use this identity.')}</p>`
          : html`<ul class="keys" aria-label=${t('Keys of {name}', { name: identity.name })}>
              ${identity.keys.map((key) => this.renderKey(identity, key))}
            </ul>`
      }
      <div class="row">
        <button
          type="button"
          aria-describedby=${label}
          ?disabled=${!list?.canRotate(identity) || list.busy}
          @click=${() => void list?.rotate(identity)}
        >
          ${t('New key')}
        </button>
        <button
          type="button"
          aria-describedby=${label}
          aria-expanded=${editing ? 'true' : 'false'}
          @click=${() => {
            this.editing = editing
              ? undefined
              : {
                  id: identity.id,
                  form: {
                    name: identity.name,
                    description: identity.description,
                    apis: identity.apis.join(', '),
                    endpoints: identity.endpoints,
                    organizations: identity.organizations.join(', '),
                  },
                };
          }}
        >
          ${t('Change what it may call')}
        </button>
      </div>
      ${editing ? this.renderEdit(identity, editing.form) : nothing}
    </div>`;
  }

  private renderEdit(identity: ServiceIdentity, form: ServiceIdentityForm): unknown {
    const list = this.list;
    return html`<form
      aria-label=${t('Change {name}', { name: identity.name })}
      @submit=${async (event: Event) => {
        event.preventDefault();
        if (await list?.grant(identity, form)) {
          this.editing = undefined;
        }
      }}
    >
      ${this.renderFields(`edit-${identity.id}`, form, (changed) => {
        this.editing = { id: identity.id, form: changed };
      })}
      <div class="row">
        <button class="primary" type="submit" ?disabled=${list?.busy}>${t('Save')}</button>
        <button
          type="button"
          @click=${() => {
            this.editing = undefined;
          }}
        >
          ${t('Cancel')}
        </button>
      </div>
    </form>`;
  }

  private renderKey(identity: ServiceIdentity, key: ServiceKey): unknown {
    const label = `service-key-${key.id}`;
    return html`<li>
      <span class="muted" id=${label}>${describeServiceKey(key)}</span>
      <button
        type="button"
        aria-describedby=${label}
        @click=${() => void this.list?.revoke(identity, key)}
      >
        ${t('Revoke')}
      </button>
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-services': MkAdminServices;
  }
}
