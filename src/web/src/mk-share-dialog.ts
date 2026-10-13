// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { KernelClient } from './api.js';
import { t } from './i18n.js';
import {
  ShareDialogState,
  SharingApi,
  defaultLinkDay,
  dateValue,
  levelTitle,
  levelsFor,
  linkAddress,
  subjectLabel,
  whoShares,
  type NewSubject,
  type ResourceRef,
  type SharingGrant,
  type SubjectKind,
} from './sharing.js';

type Who = Exclude<SubjectKind, 'link'>;

/**
 * The sharing dialog of the kernel (MK-055), the same for every resource type of every extension: the
 * level of the person, who has access with the names of people and teams, sharing with a person, a
 * team, the organization or the public at a level, links with an expiry and an optional password
 * whose address is shown once, revocation, and who may share. An extension opens it by publishing
 * `shell.share` with the resource.
 */
@customElement('mk-share-dialog')
export class MkShareDialog extends LitElement {
  static override readonly styles = css`
    dialog {
      width: min(600px, calc(100vw - 32px));
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
      margin: 0 0 4px;
      overflow-wrap: anywhere;
    }
    .muted,
    .hint {
      color: var(--mk-muted);
      font-size: 13px;
    }
    ul {
      list-style: none;
      margin: 12px 0;
      padding: 0;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-top: 1px solid var(--mk-line);
    }
    li .who {
      flex: 1 1 200px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    fieldset {
      margin: 12px 0 0;
      padding: 8px 12px 12px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: end;
    }
    label {
      display: grid;
      gap: 4px;
      flex: 1 1 140px;
      min-width: 0;
      font-size: 14px;
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
    button.primary {
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      font-weight: 600;
    }
    .made {
      margin-top: 8px;
      padding: 8px;
      border: 1px solid var(--mk-accent);
      border-radius: var(--mk-radius);
    }
    .made input {
      width: 100%;
      box-sizing: border-box;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }
    .error {
      color: var(--mk-danger);
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) client: Pick<KernelClient, 'request' | 'teams'> | undefined;

  @state() private message = '';
  @state() private who: Who = 'person';
  @state() private email = '';
  @state() private team = '';
  @state() private level = '';
  @state() private linkLevel = '';
  @state() private linkDay = '';
  @state() private linkPassword = '';
  @state() private copied = false;

  @query('dialog') private dialog!: HTMLDialogElement;

  private model: ShareDialogState | undefined;

  /** Opens the dialog for a resource. */
  async openFor(ref: ResourceRef): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    this.model = new ShareDialogState(
      new SharingApi((path, init) => client.request(path, init)),
      () => client.teams(),
      {
        changed: () => {
          this.requestUpdate();
        },
        announce: (message) => {
          this.message = message;
        },
      },
    );
    this.message = '';
    this.email = '';
    this.linkPassword = '';
    this.copied = false;
    await this.updateComplete;
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
    await this.model.load(ref);
    const resource = this.model.resource;
    if (resource) {
      this.who = resource.subjects.find((kind): kind is Who => kind !== 'link') ?? 'person';
      this.level = levelsFor(resource, this.who)[0]?.name ?? '';
      this.linkLevel = levelsFor(resource, 'link')[0]?.name ?? '';
      this.linkDay = defaultLinkDay(resource.linkMaxExpiry);
      this.team = this.model.teams[0]?.id ?? '';
    }
  }

  private close(): void {
    this.dialog.close();
    this.model = undefined;
    this.requestUpdate();
  }

  override render(): unknown {
    const model = this.model;
    const resource = model?.resource;
    return html`<dialog aria-labelledby="share-title" @close=${() => (this.model = undefined)}>
      <h2 id="share-title">
        ${resource ? t('Share {title}', { title: resource.title }) : t('Share')}
      </h2>
      ${
        resource
          ? html`<p class="muted">
              ${t('Your level: {level}', { level: levelTitle(resource.levels, resource.level) })}
            </p>`
          : nothing
      }
      ${model?.failure ? html`<p class="error" role="alert">${model.failure}</p>` : nothing}
      ${model?.resource ? this.renderBody(model) : nothing}
      <p class="hint" aria-live="polite">${this.message}</p>
      <div class="actions">
        <button
          @click=${() => {
            this.close();
          }}
        >
          ${t('Close')}
        </button>
      </div>
    </dialog>`;
  }

  private renderBody(model: ShareDialogState): unknown {
    const resource = model.resource;
    if (!resource) {
      return nothing;
    }
    if (!resource.canShare) {
      return html`<p>${whoShares(resource)}</p>`;
    }
    return html`<ul aria-label=${t('Who has access')}>
        ${
          model.grants.length === 0
            ? html`<li>
                <span class="who muted">${t('Only who owns it and the administrators.')}</span>
              </li>`
            : model.grants.map((grant) => this.renderGrant(model, grant))
        }
      </ul>
      ${this.renderShare(model)} ${this.renderLink(model)}
      <p class="hint">${whoShares(resource)}</p>`;
  }

  private renderGrant(model: ShareDialogState, grant: SharingGrant): unknown {
    const resource = model.resource;
    if (!resource) {
      return nothing;
    }
    const subject = subjectLabel(grant);
    const levels = levelsFor(resource, grant.subject.kind);
    return html`<li>
      <span class="who"
        >${subject}${
          grant.subject.kind === 'person' && grant.subject.email && grant.subject.name
            ? html` <span class="muted">${grant.subject.email}</span>`
            : nothing
        }</span
      >
      ${
        grant.subject.kind === 'link' || levels.length < 2
          ? html`<span>${levelTitle(resource.levels, grant.level)}</span>`
          : html`<select
              aria-label=${t('Level of {subject}', { subject })}
              @change=${(event: Event) =>
                void model.share(this.subjectOf(grant), (event.target as HTMLSelectElement).value)}
            >
              ${levels.map(
                (level) =>
                  html`<option value=${level.name} ?selected=${level.name === grant.level}>
                    ${levelTitle(resource.levels, level.name)}
                  </option>`,
              )}
            </select>`
      }
      <button
        aria-label=${t('Remove access of {subject}', { subject })}
        @click=${() => void model.revoke(grant)}
      >
        ${t('Remove')}
      </button>
    </li>`;
  }

  /** The subject of an existing grant, to change its level. */
  private subjectOf(grant: SharingGrant): NewSubject {
    switch (grant.subject.kind) {
      case 'person':
        return { kind: 'person', email: grant.subject.email ?? '' };
      case 'group':
        return { kind: 'group', id: grant.subject.id ?? '' };
      case 'public':
        return { kind: 'public' };
      default:
        return { kind: 'organization' };
    }
  }

  private renderShare(model: ShareDialogState): unknown {
    const resource = model.resource;
    if (!resource) {
      return nothing;
    }
    const kinds = resource.subjects.filter((kind): kind is Who => kind !== 'link');
    if (kinds.length === 0) {
      return nothing;
    }
    const names: Record<Who, string> = {
      person: t('A person'),
      group: t('A team'),
      organization: t('Everyone in the organization'),
      public: t('Everyone, also without an account'),
    };
    const levels = levelsFor(resource, this.who);
    return html`<form @submit=${(event: Event) => void this.share(event, model)}>
      <fieldset>
        <legend>${t('Share with')}</legend>
        <div class="row">
          <label
            >${t('Who')}
            <select
              .value=${this.who}
              @change=${(event: Event) => {
                this.who = (event.target as HTMLSelectElement).value as Who;
                this.level = levelsFor(resource, this.who)[0]?.name ?? '';
              }}
            >
              ${kinds.map(
                (kind) =>
                  html`<option value=${kind} ?selected=${kind === this.who}>
                    ${names[kind]}
                  </option>`,
              )}
            </select></label
          >
          ${
            this.who === 'person'
              ? html`<label
                  >${t('Email')}
                  <input
                    type="email"
                    required
                    autocomplete="off"
                    .value=${this.email}
                    @input=${(event: Event) => {
                      this.email = (event.target as HTMLInputElement).value;
                    }}
                /></label>`
              : nothing
          }
          ${
            this.who === 'group'
              ? html`<label
                  >${t('Team')}
                  <select
                    required
                    .value=${this.team}
                    @change=${(event: Event) => {
                      this.team = (event.target as HTMLSelectElement).value;
                    }}
                  >
                    ${model.teams.map(
                      (team) =>
                        html`<option value=${team.id} ?selected=${team.id === this.team}>
                          ${team.name}
                        </option>`,
                    )}
                  </select></label
                >`
              : nothing
          }
          <label
            >${t('Level')}
            <select
              .value=${this.level}
              @change=${(event: Event) => {
                this.level = (event.target as HTMLSelectElement).value;
              }}
            >
              ${levels.map(
                (level) =>
                  html`<option value=${level.name} ?selected=${level.name === this.level}>
                    ${levelTitle(resource.levels, level.name)}
                  </option>`,
              )}
            </select></label
          >
          <button class="primary" type="submit">${t('Share')}</button>
        </div>
      </fieldset>
    </form>`;
  }

  private async share(event: Event, model: ShareDialogState): Promise<void> {
    event.preventDefault();
    const subject: NewSubject =
      this.who === 'person'
        ? { kind: 'person', email: this.email.trim() }
        : this.who === 'group'
          ? { kind: 'group', id: this.team }
          : { kind: this.who };
    if (await model.share(subject, this.level)) {
      this.email = '';
    }
  }

  private renderLink(model: ShareDialogState): unknown {
    const resource = model.resource;
    if (!resource?.subjects.includes('link')) {
      return nothing;
    }
    const tomorrow = dateValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const latest = resource.linkMaxExpiry ? dateValue(new Date(resource.linkMaxExpiry)) : '';
    const made = model.madeLink;
    return html`<form @submit=${(event: Event) => void this.createLink(event, model)}>
      <fieldset>
        <legend>${t('Link')}</legend>
        <p class="hint">
          ${t('Anyone with the link opens it, also without an account, until it expires or is removed.')}
        </p>
        <div class="row">
          <label
            >${t('Link level')}
            <select
              .value=${this.linkLevel}
              @change=${(event: Event) => {
                this.linkLevel = (event.target as HTMLSelectElement).value;
              }}
            >
              ${levelsFor(resource, 'link').map(
                (level) =>
                  html`<option value=${level.name} ?selected=${level.name === this.linkLevel}>
                    ${levelTitle(resource.levels, level.name)}
                  </option>`,
              )}
            </select></label
          >
          <label
            >${t('Expires on')}
            <input
              type="date"
              required
              min=${tomorrow}
              max=${latest || nothing}
              .value=${this.linkDay}
              @input=${(event: Event) => {
                this.linkDay = (event.target as HTMLInputElement).value;
              }}
          /></label>
          <label
            >${t('Password (optional)')}
            <input
              type="password"
              autocomplete="new-password"
              .value=${this.linkPassword}
              @input=${(event: Event) => {
                this.linkPassword = (event.target as HTMLInputElement).value;
              }}
          /></label>
          <button class="primary" type="submit">${t('Create link')}</button>
        </div>
        ${
          made
            ? html`<div class="made">
                <label
                  >${t('Address of the link')}
                  <input readonly .value=${linkAddress(made.token)} @focus=${this.selectAll}
                /></label>
                <p class="hint">
                  ${t('Shown only now: copy it and give it to the people you choose.')}
                </p>
                <button type="button" @click=${() => void this.copy(linkAddress(made.token))}>
                  ${this.copied ? t('Copied') : t('Copy the address')}
                </button>
              </div>`
            : nothing
        }
      </fieldset>
    </form>`;
  }

  private async createLink(event: Event, model: ShareDialogState): Promise<void> {
    event.preventDefault();
    this.copied = false;
    if (await model.createLink(this.linkLevel, this.linkDay, this.linkPassword)) {
      this.linkPassword = '';
    }
  }

  private readonly selectAll = (event: Event): void => {
    (event.target as HTMLInputElement).select();
  };

  private async copy(address: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      this.copied = true;
    } catch {
      this.message = t('Select the address and copy it.');
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-share-dialog': MkShareDialog;
  }
}
