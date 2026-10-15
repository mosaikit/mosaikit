// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, PersonState, PlatformPerson } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';
import { PAGE_SIZE, PeopleDirectory, organizationsOf } from './people.js';
import { when } from './sessions.js';
import { AccountSuspensions, MAX_REASON, accountName, describeStatus } from './suspensions.js';

/**
 * The people of the installation, for platform administrators, on the model of the administration
 * pages (MK-072): metrics on top, filters above the table, the actions of each row and the detail of
 * a person in a side pane, with their organizations. A person is suspended with a reason, which ends
 * their sessions at once, and reinstated (MK-125). The behaviour is in {@link PeopleDirectory} and
 * {@link AccountSuspensions}.
 */
@customElement('mk-admin-accounts')
export class MkAdminAccounts extends LitElement {
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
    button.link {
      border: none;
      background: none;
      padding: 0;
      color: var(--mk-accent);
      text-decoration: underline;
      text-align: left;
    }
    .actions,
    .pages {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .pages {
      margin-top: 12px;
    }
    h2 {
      margin: 0;
      font-size: 1.1em;
    }
    ul {
      margin: 0;
      padding-left: 1.2em;
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

  /** The address of the person in the side pane. */
  @state() private selected: string | undefined;
  @state() private search = '';
  @state() private stateFilter: PersonState = 'all';
  @state() private reason = '';
  @state() private message = '';
  @state() private failed = false;

  private directory: PeopleDirectory | undefined;
  private suspensions: AccountSuspensions | undefined;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    const events = {
      changed: () => {
        this.requestUpdate();
      },
      announce: (message: string, failed: boolean) => {
        this.message = message;
        this.failed = failed;
      },
    };
    this.directory = new PeopleDirectory(this.client, events);
    this.suspensions = new AccountSuspensions(this.client, events);
    void this.directory.load();
  }

  override disconnectedCallback(): void {
    clearTimeout(this.searchTimer);
    super.disconnectedCallback();
  }

  override render(): unknown {
    const directory = this.directory;
    const people = directory?.people;
    const person = people?.find((candidate) => candidate.username === this.selected);
    return html`
      <mk-admin-view
        heading=${t('People')}
        description=${t(
          'The people of the installation and their organizations. Suspend the account of a person who must not sign in any more, for example when they leave or lose a device: their sessions end at once, on every browser, and they sign in by no means until reinstated.',
        )}
        name="mosaikit.admin.people"
        .metrics=${directory?.metrics() ?? []}
        ?detail-open=${person !== undefined}
        detail-label=${person ? accountName(person) : t('Detail')}
        @mk-detail-close=${() => {
          this.selected = undefined;
        }}
      >
        <label slot="filters"
          >${t('Search people')}
          <input
            type="search"
            .value=${this.search}
            @input=${(event: Event) => {
              this.search = (event.target as HTMLInputElement).value;
              clearTimeout(this.searchTimer);
              this.searchTimer = setTimeout(() => void this.refilter(), 250);
            }}
        /></label>
        <label slot="filters"
          >${t('State')}
          <select
            .value=${this.stateFilter}
            @change=${(event: Event) => {
              this.stateFilter = (event.target as HTMLSelectElement).value as PersonState;
              void this.refilter();
            }}
          >
            <option value="all">${t('All')}</option>
            <option value="active">${t('Active')}</option>
            <option value="suspended">${t('Suspended')}</option>
          </select></label
        >
        ${
          people === undefined
            ? nothing
            : people.length === 0
              ? html`<p>${t('Nobody matches the filters.')}</p>`
              : this.renderTable(people)
        }
        <div slot="detail" class="pane">${person ? this.renderDetail(person) : nothing}</div>
      </mk-admin-view>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderTable(people: readonly PlatformPerson[]): unknown {
    const directory = this.directory;
    return html`<table aria-label=${t('People')}>
        <thead>
          <tr>
            <th scope="col">${t('Person')}</th>
            <th scope="col">${t('Organizations')}</th>
            <th scope="col">${t('State')}</th>
            <th scope="col"><span class="muted">${t('Actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          ${people.map(
            (person) =>
              html`<tr class=${person.username === this.selected ? 'selected' : ''}>
                <th scope="row">
                  <button
                    type="button"
                    class="link"
                    aria-label=${t('Details of {name}', { name: person.username })}
                    @click=${() => {
                      this.select(person);
                    }}
                  >
                    ${accountName(person)}
                  </button>
                  ${person.platformAdmin ? html`<span class="muted">${t('platform administrator')}</span>` : nothing}
                </th>
                <td>${organizationsOf(person) || html`<span class="muted">${t('None')}</span>`}</td>
                <td>
                  ${
                    person.suspended
                      ? html`<span class="pill suspended">${t('Suspended')}</span>`
                      : html`<span class="pill">${t('Active')}</span>`
                  }
                </td>
                <td>
                  ${
                    person.suspended
                      ? html`<button
                          type="button"
                          aria-label=${t('Reinstate {name}', { name: person.username })}
                          @click=${() => void this.reinstate(person)}
                        >
                          ${t('Reinstate')}
                        </button>`
                      : html`<button
                          type="button"
                          aria-label=${t('Suspend {name}', { name: person.username })}
                          @click=${() => {
                            this.select(person);
                          }}
                        >
                          ${t('Suspend')}
                        </button>`
                  }
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${
        directory && (directory.hasNext || directory.hasPrevious)
          ? html`<div class="pages">
              <button
                type="button"
                ?disabled=${!directory.hasPrevious}
                @click=${() => void directory.page(-1)}
              >
                ${t('Previous')}
              </button>
              <span class="muted"
                >${t('{from}–{to} of {total}', {
                  from: String(directory.offset + 1),
                  to: String(Math.min(directory.offset + PAGE_SIZE, directory.matching)),
                  total: String(directory.matching),
                })}</span
              >
              <button
                type="button"
                ?disabled=${!directory.hasNext}
                @click=${() => void directory.page(1)}
              >
                ${t('Next')}
              </button>
            </div>`
          : nothing
      }`;
  }

  private renderDetail(person: PlatformPerson): unknown {
    return html`<h2>${accountName(person)}</h2>
      <p>${describeStatus(person, when)}</p>
      <p class="muted">${t('Account created {when}.', { when: when(person.createdAt) })}</p>
      <h2 id="person-organizations">${t('Organizations')}</h2>
      ${
        person.organizations.length === 0
          ? html`<p class="muted">${t('None')}</p>`
          : html`<ul aria-labelledby="person-organizations">
              ${person.organizations.map(
                (organization) =>
                  html`<li>
                    ${organization.name}
                    <span class="muted"
                      >${organization.roles.includes('organization-admin') ? t('administrator') : t('member')}${
                        organization.suspended ? `, ${t('suspended')}` : ''
                      }</span
                    >
                  </li>`,
              )}
            </ul>`
      }
      ${
        person.suspended
          ? html`<div class="actions">
              <button type="button" class="primary" @click=${() => void this.reinstate(person)}>
                ${t('Reinstate')}
              </button>
            </div>`
          : html`<form
              @submit=${(event: Event) => {
                event.preventDefault();
                void this.confirmSuspend(person);
              }}
              aria-labelledby="suspend-title"
              novalidate
            >
              <h2 id="suspend-title">${t('Suspend {name}', { name: person.username })}</h2>
              <label
                >${t('Reason for the suspension')}
                <textarea
                  maxlength=${MAX_REASON}
                  aria-describedby="suspension-reason-help"
                  .value=${this.reason}
                  @input=${(event: Event) => {
                    this.reason = (event.target as HTMLTextAreaElement).value;
                  }}
                ></textarea>
              </label>
              <span class="muted" id="suspension-reason-help">
                ${t('Shown to the other platform administrators and kept in the audit log.')}
              </span>
              <div class="actions">
                <button type="submit" class="danger">${t('Suspend')}</button>
              </div>
            </form>`
      }`;
  }

  private select(person: PlatformPerson): void {
    this.selected = person.username;
    this.reason = '';
  }

  private async refilter(): Promise<void> {
    await this.directory?.filter(this.search, this.stateFilter);
  }

  private async reinstate(person: PlatformPerson): Promise<void> {
    if (await this.suspensions?.reinstate(person)) {
      await this.directory?.load();
    }
  }

  private async confirmSuspend(person: PlatformPerson): Promise<void> {
    if (!this.reason.trim()) {
      // The suspensions say what is missing.
      await this.suspensions?.suspend(person, this.reason);
      return;
    }
    if (
      !confirm(
        t('Suspend {name}? Their sessions end at once and they cannot sign in until reinstated.', {
          name: accountName(person),
        }),
      )
    ) {
      return;
    }
    if (await this.suspensions?.suspend(person, this.reason)) {
      this.reason = '';
      await this.directory?.load();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-accounts': MkAdminAccounts;
  }
}
