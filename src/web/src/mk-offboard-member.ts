// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, OrganizationMember } from './api.js';
import { t } from './i18n.js';
import { Offboarding, OffboardingApi, heirs, ownedCount } from './offboarding.js';

/**
 * The removal of a member from the organization (MK-071), on the People tab of the permissions: it
 * first shows what the member owns, per extension, and asks who takes it over; the removal then gives
 * it to that person with its shares. Dispatches `mk-member-removed` with the email address. The
 * behaviour is in {@link Offboarding}.
 */
@customElement('mk-offboard-member')
export class MkOffboardMember extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      margin-top: 24px;
    }
    ul {
      margin: 4px 0 12px;
      padding-left: 20px;
    }
    .muted {
      color: var(--mk-muted);
    }
    .error {
      color: var(--mk-danger);
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
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
    button.danger {
      border-color: var(--mk-danger);
      color: var(--mk-danger);
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;
  /** The organization. */
  @property() organization = '';
  /** The member to remove. */
  @property() email = '';
  /** The members of the organization, among whom the new owner is chosen. */
  @property({ attribute: false }) members: readonly OrganizationMember[] = [];

  @state() private offboarding: Offboarding | undefined;
  @state() private message = '';
  @state() private failed = false;
  @state() private busy = false;

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('email') || changed.has('organization')) {
      this.offboarding = undefined;
      this.message = '';
    }
  }

  private readonly start = async (): Promise<void> => {
    const client = this.client;
    if (!client || !this.organization || !this.email) {
      return;
    }
    const offboarding = new Offboarding(
      new OffboardingApi((path, init) => client.request(path, init)),
      this.organization,
      this.email,
      {
        changed: () => {
          this.requestUpdate();
        },
        announce: (message, failed) => {
          this.message = message;
          this.failed = failed;
        },
      },
    );
    this.busy = true;
    if (await offboarding.load()) {
      this.offboarding = offboarding;
    }
    this.busy = false;
  };

  private readonly removeMember = async (): Promise<void> => {
    const offboarding = this.offboarding;
    if (!offboarding || this.busy) {
      return;
    }
    this.busy = true;
    const removed = await offboarding.remove();
    this.busy = false;
    if (removed) {
      this.offboarding = undefined;
      this.dispatchEvent(
        new CustomEvent('mk-member-removed', { detail: this.email, bubbles: true, composed: true }),
      );
    }
  };

  override render(): unknown {
    const offboarding = this.offboarding;
    return html`<h3>${t('Remove from the organization')}</h3>
      ${
        offboarding?.owned
          ? this.renderOwned(offboarding)
          : html`<p class="muted">
                ${t('First you see what they own, and choose who takes it over.')}
              </p>
              <button type="button" ?disabled=${this.busy} @click=${this.start}>
                ${t('Remove {email}…', { email: this.email })}
              </button>`
      }
      <p class=${this.failed ? 'error' : 'muted'} aria-live="polite">${this.message}</p>`;
  }

  private renderOwned(offboarding: Offboarding): unknown {
    const owned = offboarding.owned ?? [];
    const count = ownedCount(owned);
    const candidates = heirs(this.members, this.email);
    return html`${
        count === 0
          ? html`<p>${t('{email} owns nothing in the apps.', { email: this.email })}</p>`
          : html`<p>
                ${t('{email} owns {count} resources:', { email: this.email, count: String(count) })}
              </p>
              ${owned.map(
                (group) =>
                  html`<h4>${group.extensionName}</h4>
                    <ul>
                      ${group.resources.map(
                        (resource) =>
                          html`<li>
                            ${resource.title}
                            <span class="muted"
                              >${resource.typeTitle}${resource.trashed ? ` · ${t('in the trash')}` : ''}</span
                            >
                          </li>`,
                      )}
                    </ul>`,
              )}
              <label for="heir">${t('New owner, with their shares')}</label>
              <select
                id="heir"
                @change=${(event: Event) => {
                  offboarding.heir = (event.target as HTMLSelectElement).value;
                  this.requestUpdate();
                }}
              >
                <option value="" ?selected=${offboarding.heir === ''}>${t('Choose')}</option>
                ${candidates.map(
                  (member) =>
                    html`<option
                      value=${member.username}
                      ?selected=${member.username === offboarding.heir}
                    >
                      ${
                        member.displayName && member.displayName !== member.username
                          ? `${member.displayName} (${member.username})`
                          : member.username
                      }
                    </option>`,
                )}
              </select>`
      }
      <div class="actions">
        <button
          type="button"
          class="danger"
          ?disabled=${this.busy || !offboarding.ready}
          @click=${this.removeMember}
        >
          ${t('Remove from the organization')}
        </button>
        <button
          type="button"
          @click=${() => {
            this.offboarding = undefined;
          }}
        >
          ${t('Cancel')}
        </button>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-offboard-member': MkOffboardMember;
  }
}
