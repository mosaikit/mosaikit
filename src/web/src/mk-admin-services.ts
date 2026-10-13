// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, ServiceIdentity, ServiceKey } from './api.js';
import { t } from './i18n.js';
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
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 860px;
    }
    form {
      display: grid;
      gap: 12px;
      margin: 0 0 24px;
      padding: 16px 20px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
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
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    .status {
      min-height: 1.5em;
      color: var(--mk-muted);
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private form: ServiceIdentityForm = EMPTY;
  /** The identity being changed, and its form. */
  @state() private editing: { id: string; form: ServiceIdentityForm } | undefined;
  @state() private message = '';

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
    return html`
      <h1>${t('Service identities')}</h1>
      <p class="muted">
        ${t(
          'For the services that call the APIs of extensions without a person, such as a gateway. Each has its own key, the APIs it may call and no organization; it never opens the shell.',
        )}
      </p>
      <p class="status" role="status" aria-live="polite">${this.message}</p>
      ${this.renderCreated()} ${this.renderNew()}
      ${
        identities === undefined
          ? nothing
          : identities.length === 0
            ? html`<p>${t('No service identity.')}</p>`
            : html`<ul aria-label=${t('Service identities')}>
                ${identities.map((identity) => this.renderIdentity(identity))}
              </ul>`
      }
    `;
  }

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
    return html`<li class="identity">
      <div class="name" id=${label}>${identity.name}</div>
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
    </li>`;
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
