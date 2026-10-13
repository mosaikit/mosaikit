// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type {
  KernelClient,
  OrganizationMember,
  OrganizationTeam,
  PermissionPreview,
  PermissionProfile,
  ProposedMember,
} from './api.js';
import { t } from './i18n.js';
import './mk-effective-permissions.js';

type Role = ProposedMember['role'];

/**
 * The dialog with which the administrators of an organization invite a person (MK-056): email,
 * role, profile and teams, and, before anything is sent, the permissions the person will hold with
 * where each comes from. A platform administrator adds the person to the organization; an
 * administrator of the organization gives profile and teams to a person who is already a member,
 * and for someone else sees the preview only: adding people waits for invitations by link (MK-068).
 * `mk-invited` tells the page.
 */
@customElement('mk-invite-person')
export class MkInvitePerson extends LitElement {
  static override readonly styles = css`
    dialog {
      width: min(560px, calc(100vw - 32px));
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
    h2,
    h3 {
      margin: 0 0 12px;
    }
    h3 {
      margin-top: 16px;
      font-size: 15px;
    }
    .field {
      display: grid;
      gap: 4px;
      margin-bottom: 12px;
    }
    input[type='email'],
    input[type='text'],
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
    fieldset {
      margin: 0 0 12px;
      padding: 6px 10px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
    }
    fieldset label {
      display: flex;
      gap: 8px;
      padding: 2px 0;
    }
    input[type='checkbox'] {
      accent-color: var(--mk-accent);
    }
    .hint {
      font-size: 13px;
      color: var(--mk-muted);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
    }
    button.primary {
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      font-weight: 600;
    }
    .error {
      color: var(--mk-danger);
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;
  @property() organization: string | undefined;
  @property({ attribute: false }) profiles: readonly PermissionProfile[] = [];
  @property({ attribute: false }) teams: readonly OrganizationTeam[] = [];
  /** The members of the organization, to recognise a person who is already one. */
  @property({ attribute: false }) members: readonly OrganizationMember[] = [];
  /** Whether the person using the dialog is a platform administrator, who adds people. */
  @property({ type: Boolean }) platformAdmin = false;

  @state() private email = '';
  @state() private personName = '';
  @state() private memberRole: Role = 'organization-user';
  @state() private profile = '';
  @state() private chosenTeams: readonly string[] = [];
  @state() private preview: PermissionPreview | undefined;
  @state() private message = '';
  @state() private sending = false;

  @query('dialog') private dialog!: HTMLDialogElement;

  /** Opens the dialog empty, with the preview of a member with the default profile. */
  async openDialog(): Promise<void> {
    this.email = '';
    this.personName = '';
    this.memberRole = 'organization-user';
    this.profile = '';
    this.chosenTeams = [];
    this.message = '';
    await this.updateComplete;
    this.dialog.showModal();
    await this.refreshPreview();
  }

  /** The member with the email address written, if any. */
  private existing(): OrganizationMember | undefined {
    const email = this.email.trim().toLowerCase();
    return this.members.find((member) => member.username === email);
  }

  /** Whether the role is the one the person has, which only a platform administrator changes. */
  private roleFixed(): boolean {
    return !this.platformAdmin && this.existing() !== undefined;
  }

  /** The role of the proposal: the one the member has when it cannot change, the chosen one otherwise. */
  private proposedRole(): Role {
    const existing = this.roleFixed() ? this.existing() : undefined;
    if (!existing) {
      return this.memberRole;
    }
    return existing.roles.includes('organization-admin')
      ? 'organization-admin'
      : existing.roles.includes('organization-user')
        ? 'organization-user'
        : 'organization-guest';
  }

  /** Whether the dialog can send: a platform administrator, or a person already a member. */
  private canSend(): boolean {
    return this.platformAdmin || this.existing() !== undefined;
  }

  override render(): unknown {
    const role = this.proposedRole();
    const fresh = this.email.trim() !== '' && !this.canSend();
    const fallback = this.profiles.find(
      (profile) => profile.defaultForRole === 'organization-user',
    );
    return html`<dialog aria-labelledby="invite-title" @close=${this.closed}>
      <form method="dialog" @submit=${this.send}>
        <h2 id="invite-title">${t('Invite a person')}</h2>
        <div class="field">
          <label for="invite-email">${t('Email')}</label>
          <input
            id="invite-email"
            type="email"
            required
            autocomplete="off"
            .value=${this.email}
            @input=${(event: Event) => {
              const before = this.proposedRole();
              this.email = (event.target as HTMLInputElement).value;
              if (this.proposedRole() !== before) {
                void this.refreshPreview();
              }
            }}
          />
        </div>
        <div class="field">
          <label for="invite-name">${t('Name')}</label>
          <input
            id="invite-name"
            type="text"
            autocomplete="off"
            .value=${this.personName}
            @input=${(event: Event) => {
              this.personName = (event.target as HTMLInputElement).value;
            }}
          />
          <span class="hint">${t('For a person who has no account yet.')}</span>
        </div>
        <div class="field">
          <label for="invite-role">${t('Role')}</label>
          <select id="invite-role" ?disabled=${this.roleFixed()} @change=${this.changeRole}>
            <option value="organization-user" ?selected=${role === 'organization-user'}>
              ${t('Member')}
            </option>
            <option value="organization-admin" ?selected=${role === 'organization-admin'}>
              ${t('Administrator')}
            </option>
            ${
              role === 'organization-guest'
                ? html`<option value="organization-guest" selected>${t('Guest')}</option>`
                : nothing
            }
          </select>
        </div>
        <div class="field">
          <label for="invite-profile">${t('Profile')}</label>
          <select
            id="invite-profile"
            ?disabled=${role !== 'organization-user'}
            @change=${this.changeProfile}
          >
            <option value="" ?selected=${this.profile === ''}>
              ${
                fallback
                  ? t('Default profile of members ({name})', { name: fallback.name })
                  : t('Default profile of members (none)')
              }
            </option>
            ${this.profiles.map(
              (profile) =>
                html`<option value=${profile.id} ?selected=${this.profile === profile.id}>
                  ${profile.name}
                </option>`,
            )}
          </select>
          ${
            role === 'organization-admin'
              ? html`<span class="hint">${t('Administrators hold every permission.')}</span>`
              : nothing
          }
        </div>
        ${
          this.teams.length > 0
            ? html`<fieldset>
                <legend>${t('Teams')}</legend>
                ${this.teams.map(
                  (team) =>
                    html`<label>
                      <input
                        type="checkbox"
                        .checked=${this.chosenTeams.includes(team.id)}
                        @change=${(event: Event) => {
                          this.changeTeam(team.id, (event.target as HTMLInputElement).checked);
                        }}
                      />
                      ${team.name}
                    </label>`,
                )}
              </fieldset>`
            : nothing
        }
        <section aria-labelledby="invite-preview" aria-live="polite">
          <h3 id="invite-preview">${t('What they will be able to do')}</h3>
          ${
            this.preview
              ? html`<mk-effective-permissions
                  .permissions=${this.preview.permissions}
                  label=${t('What they will be able to do')}
                ></mk-effective-permissions>`
              : nothing
          }
        </section>
        ${
          fresh
            ? html`<p class="hint" id="invite-new">
                ${t(
                  'This person is not a member yet: a platform administrator adds them, until invitations by link arrive. The preview shows what they would hold.',
                )}
              </p>`
            : nothing
        }
        <p class="error" role="alert">${this.message || nothing}</p>
        <div class="actions">
          <button type="button" @click=${this.cancel}>${t('Cancel')}</button>
          <button
            class="primary"
            type="submit"
            aria-describedby=${fresh ? 'invite-new' : nothing}
            ?disabled=${this.sending || fresh}
          >
            ${this.roleFixed() ? t('Apply') : t('Invite')}
          </button>
        </div>
      </form>
    </dialog>`;
  }

  /** What the dialog proposes, for the preview. */
  private proposed(): ProposedMember {
    const role = this.proposedRole();
    return {
      role,
      profile: role === 'organization-user' && this.profile ? this.profile : null,
      teams: this.chosenTeams,
    };
  }

  private async refreshPreview(): Promise<void> {
    if (!this.client || !this.organization) {
      return;
    }
    const asked = this.proposed();
    try {
      const preview = await this.client.previewPermissions(this.organization, asked);
      // A late answer for a choice that changed since is not shown.
      if (JSON.stringify(asked) === JSON.stringify(this.proposed())) {
        this.preview = preview;
      }
    } catch (error) {
      this.message = t('The preview failed: {reason}', { reason: String(error) });
    }
  }

  private readonly changeRole = (event: Event): void => {
    this.memberRole = (event.target as HTMLSelectElement).value as Role;
    void this.refreshPreview();
  };

  private readonly changeProfile = (event: Event): void => {
    this.profile = (event.target as HTMLSelectElement).value;
    void this.refreshPreview();
  };

  private changeTeam(id: string, on: boolean): void {
    this.chosenTeams = on
      ? [...this.chosenTeams.filter((team) => team !== id), id]
      : this.chosenTeams.filter((team) => team !== id);
    void this.refreshPreview();
  }

  private readonly send = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!this.client || !this.organization) {
      return;
    }
    const email = this.email.trim();
    if (!email) {
      this.message = t('Write the email address of the person.');
      return;
    }
    if (!this.canSend()) {
      return;
    }
    this.sending = true;
    this.message = '';
    const proposed = this.proposed();
    const existing = this.roleFixed() ? this.existing() : undefined;
    try {
      await this.client.invite(this.organization, email, {
        // An administrator of the organization keeps the roles the member has.
        roles: existing
          ? existing.roles
          : proposed.role === 'organization-admin'
            ? ['organization-admin', 'organization-user']
            : ['organization-user'],
        ...(this.personName.trim() ? { displayName: this.personName.trim() } : {}),
        profile: proposed.profile,
        teams: proposed.teams,
      });
      this.dialog.close();
      this.dispatchEvent(
        new CustomEvent<string>('mk-invited', { detail: email, bubbles: true, composed: true }),
      );
    } catch (error) {
      this.message = t('Not invited: {reason}', { reason: String(error) });
    } finally {
      this.sending = false;
    }
  };

  private readonly cancel = (): void => {
    this.dialog.close();
  };

  private readonly closed = (): void => {
    this.preview = undefined;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-invite-person': MkInvitePerson;
  }
}
