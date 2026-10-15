// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, SignInMethod } from './api.js';
import { t } from './i18n.js';
import {
  type Created,
  EMPTY_DRAFT,
  type OrganizationDraft,
  STEPS,
  type Step,
  createOrganization,
  domainsOf,
  problems,
  slugFrom,
  usesRealm,
} from './organization-wizard.js';
import { signInLabel } from './organizations.js';

const STEP_TITLES: Record<Step, string> = {
  organization: 'Organization',
  'sign-in': 'Sign-in',
  administrator: 'Administrator',
  review: 'Review',
};

/**
 * The guided creation of an organization (MK-072): its name and address, how its members sign in, its
 * first administrator, and a review before it is created; then how the administrator gets in, shown
 * once. The behaviour is in `organization-wizard.ts`. Dispatches `mk-organization-created` with the
 * organization, and `mk-wizard-cancel`.
 */
@customElement('mk-new-organization')
export class MkNewOrganization extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    form {
      display: grid;
      gap: 12px;
    }
    h2 {
      margin: 0 0 4px;
      font-size: 1.1em;
    }
    ol.steps {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      margin: 0 0 8px;
      padding: 0;
      list-style: none;
      font-size: 13px;
      color: var(--mk-muted);
    }
    ol.steps [aria-current='step'] {
      color: var(--mk-fg);
      font-weight: 600;
    }
    label {
      display: grid;
      gap: 4px;
      font-weight: 600;
    }
    label.check {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: normal;
    }
    fieldset {
      display: grid;
      gap: 6px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      padding: 8px 12px;
    }
    fieldset label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: normal;
    }
    input,
    textarea,
    button {
      font: inherit;
      padding: 6px 8px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
    }
    input[type='radio'],
    input[type='checkbox'] {
      padding: 0;
    }
    .hint {
      font-weight: normal;
      font-size: 13px;
      color: var(--mk-muted);
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
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
    ul.problems {
      margin: 0;
      color: var(--mk-danger);
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
    code {
      font-family: var(--mk-font-mono, monospace);
      overflow-wrap: anywhere;
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private draft: OrganizationDraft = EMPTY_DRAFT;
  @state() private step: Step = 'organization';
  /** Whether the slug follows the name, until the person changes it. */
  @state() private slugFollowsName = true;
  @state() private shown: readonly string[] = [];
  @state() private busy = false;
  @state() private created: Created | undefined;
  @state() private failure = '';

  override render(): unknown {
    if (this.created) {
      return this.renderCreated(this.created);
    }
    const index = STEPS.indexOf(this.step);
    return html`<form @submit=${this.next} aria-labelledby="wizard-title" novalidate>
      <h2 id="wizard-title">${t('New organization')}</h2>
      <ol class="steps" aria-label=${t('Steps')}>
        ${STEPS.map(
          (step, position) =>
            html`<li aria-current=${step === this.step ? 'step' : 'false'}>
              ${String(position + 1)}. ${t(STEP_TITLES[step])}
            </li>`,
        )}
      </ol>
      ${this.renderStep()}
      ${
        this.shown.length > 0
          ? html`<ul class="problems">
              ${this.shown.map((problem) => html`<li>${problem}</li>`)}
            </ul>`
          : nothing
      }
      ${this.failure ? html`<p class="problems" role="alert">${this.failure}</p>` : nothing}
      <div class="buttons">
        ${
          index > 0
            ? html`<button type="button" @click=${this.back} ?disabled=${this.busy}>
                ${t('Back')}
              </button>`
            : nothing
        }
        <button class="primary" type="submit" ?disabled=${this.busy}>
          ${this.step === 'review' ? t('Create the organization') : t('Next')}
        </button>
        <button type="button" @click=${this.cancel} ?disabled=${this.busy}>${t('Cancel')}</button>
      </div>
    </form>`;
  }

  private renderStep(): unknown {
    const draft = this.draft;
    switch (this.step) {
      case 'organization':
        return html`<label
            >${t('Name')}
            <input
              name="name"
              maxlength="120"
              autocomplete="off"
              .value=${draft.name}
              @input=${(event: Event) => {
                const name = (event.target as HTMLInputElement).value;
                this.change({ name, ...(this.slugFollowsName ? { slug: slugFrom(name) } : {}) });
              }}
          /></label>
          <label
            >${t('Address name')}
            <input
              name="slug"
              maxlength="63"
              spellcheck="false"
              autocomplete="off"
              aria-describedby="slug-hint"
              .value=${draft.slug}
              @input=${(event: Event) => {
                this.slugFollowsName = false;
                this.change({ slug: (event.target as HTMLInputElement).value });
              }}
            />
          </label>
          <span class="hint" id="slug-hint"
            >${t('In addresses and sub-domains; it cannot change later.')}</span
          >
          <label class="check"
            ><input
              type="checkbox"
              .checked=${draft.selfRegistration}
              @change=${(event: Event) => {
                this.change({ selfRegistration: (event.target as HTMLInputElement).checked });
              }}
            />${t('People can create their own account in it')}</label
          >`;
      case 'sign-in':
        return html`<fieldset>
            <legend>${t('How its members sign in')}</legend>
            ${(['password', 'realm', 'password-or-realm'] as const).map(
              (method: SignInMethod) =>
                html`<label
                  ><input
                    type="radio"
                    name="sign-in"
                    value=${method}
                    .checked=${draft.signIn === method}
                    @change=${() => {
                      this.change({ signIn: method });
                    }}
                  />${signInLabel(method)}</label
                >`,
            )}
          </fieldset>
          ${
            usesRealm(draft)
              ? html`<label
                    >${t('Email domains of the organization')}
                    <textarea
                      name="email-domains"
                      rows="2"
                      spellcheck="false"
                      aria-describedby="domains-hint"
                      .value=${draft.emailDomains}
                      @input=${(event: Event) => {
                        this.change({ emailDomains: (event.target as HTMLTextAreaElement).value });
                      }}
                    ></textarea>
                  </label>
                  <span class="hint" id="domains-hint"
                    >${t(
                      'The kernel creates the identity provider of the organization; people with these domains sign in through it. Separate them with commas.',
                    )}</span
                  >`
              : html`<p class="hint">
                  ${t('Its members sign in with a password of this installation.')}
                </p>`
          }`;
      case 'administrator':
        return html`<p class="hint">
            ${
              usesRealm(draft)
                ? t(
                    'The administrator is created in the identity provider of the organization, with a temporary password shown once.',
                  )
                : t(
                    'The administrator gets a link to set the password; a person with an account already becomes an administrator of the organization.',
                  )
            }
          </p>
          <label
            >${t('Email address of the administrator')}
            <input
              name="administrator-email"
              type="email"
              autocomplete="off"
              spellcheck="false"
              .value=${draft.administratorEmail}
              @input=${(event: Event) => {
                this.change({ administratorEmail: (event.target as HTMLInputElement).value });
              }}
          /></label>
          <label
            >${t('First name')}
            <input
              name="administrator-first-name"
              maxlength="120"
              autocomplete="off"
              .value=${draft.administratorFirstName}
              @input=${(event: Event) => {
                this.change({ administratorFirstName: (event.target as HTMLInputElement).value });
              }}
          /></label>
          <label
            >${t('Last name')}
            <input
              name="administrator-last-name"
              maxlength="120"
              autocomplete="off"
              .value=${draft.administratorLastName}
              @input=${(event: Event) => {
                this.change({ administratorLastName: (event.target as HTMLInputElement).value });
              }}
          /></label>`;
      case 'review':
        return html`<dl aria-label=${t('The new organization')}>
          <dt>${t('Name')}</dt>
          <dd>${draft.name.trim()}</dd>
          <dt>${t('Address name')}</dt>
          <dd><code>${draft.slug}</code></dd>
          <dt>${t('Sign-in')}</dt>
          <dd>${signInLabel(draft.signIn)}</dd>
          ${
            usesRealm(draft)
              ? html`<dt>${t('Email domains')}</dt>
                  <dd>${domainsOf(draft).join(', ')}</dd>`
              : nothing
          }
          <dt>${t('Administrator')}</dt>
          <dd>
            ${draft.administratorFirstName.trim()} ${draft.administratorLastName.trim()}
            (${draft.administratorEmail.trim()})
          </dd>
          <dt>${t('Self-registration')}</dt>
          <dd>${draft.selfRegistration ? t('Yes') : t('No')}</dd>
        </dl>`;
    }
  }

  private renderCreated(created: Created): unknown {
    const access = created.access;
    let how: unknown;
    switch (access.kind) {
      case 'temporary-password':
        how = html`<p>
          ${t(
            'The administrator signs in through the identity provider of the organization as {username}, with this temporary password, changed at the first sign-in. It is shown only now:',
            { username: access.username },
          )}
          <code>${access.password}</code>
        </p>`;
        break;
      case 'link':
        how = access.mailed
          ? html`<p>${t('The administrator received a mail with a link to set the password.')}</p>`
          : html`<p>
              ${t(
                'Pass this link on to the administrator, to set the password; it is shown only now:',
              )}
              <code>${access.link}</code>
            </p>`;
        break;
      case 'member':
        how = html`<p>
          ${t('The administrator had an account already, and is now an administrator of it.')}
        </p>`;
        break;
      case 'failed':
        how = html`<p role="alert">
          ${t(
            'The administrator could not be added: {reason} Add one from the people of the organization.',
            { reason: access.reason },
          )}
        </p>`;
        break;
    }
    return html`<section aria-labelledby="created-title">
      <h2 id="created-title">${t('{name} is created', { name: created.organization.name })}</h2>
      ${how}
      <div class="buttons">
        <button type="button" class="primary" @click=${this.cancel}>${t('Done')}</button>
      </div>
    </section>`;
  }

  private change(values: Partial<OrganizationDraft>): void {
    this.draft = { ...this.draft, ...values };
    this.shown = [];
  }

  private readonly back = (): void => {
    const index = STEPS.indexOf(this.step);
    this.step = STEPS[Math.max(0, index - 1)] ?? 'organization';
    this.shown = [];
    this.failure = '';
  };

  private readonly cancel = (): void => {
    this.dispatchEvent(new CustomEvent('mk-wizard-cancel', { bubbles: true, composed: true }));
  };

  private readonly next = async (event: Event): Promise<void> => {
    event.preventDefault();
    const found = problems(this.draft, this.step);
    this.shown = found;
    if (found.length > 0 || !this.client) {
      return;
    }
    if (this.step !== 'review') {
      this.step = STEPS[STEPS.indexOf(this.step) + 1] ?? 'review';
      return;
    }
    this.busy = true;
    this.failure = '';
    try {
      this.created = await createOrganization(this.client, this.draft);
      this.dispatchEvent(
        new CustomEvent('mk-organization-created', {
          detail: this.created,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      this.failure = t('The organization cannot be created: {reason}', {
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.busy = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-new-organization': MkNewOrganization;
  }
}
