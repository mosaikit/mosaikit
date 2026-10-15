// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type {
  DeclaredPermission,
  KernelClient,
  MemberPermissions,
  OrganizationMember,
  OrganizationTeam,
  PermissionProfile,
  ProfileDraft,
  TeamPermissions,
} from './api.js';
import { t } from './i18n.js';
import './mk-effective-permissions.js';
import './mk-invite-person.js';
import type { MkInvitePerson } from './mk-invite-person.js';
import './mk-create-account.js';
import type { MkCreateAccount } from './mk-create-account.js';
import { awaitsPassword } from './password-links.js';
import './mk-offboard-member.js';
import './mk-permission-list.js';
import type { PermissionToggle } from './mk-permission-list.js';
import { byExtension, toggled, type PermissionGroup } from './permissions.js';

type Tab = 'profiles' | 'people' | 'teams';
const TABS: readonly Tab[] = ['profiles', 'people', 'teams'];
const MEMBER_ROLE = 'organization-user';
/** The profile being written, before it is saved for the first time. */
const NEW = '';

/**
 * Permissions of the organization, for its administrators (MK-056, ADR-0038), in the organization
 * group of the console (ADR-0039): the profiles with their permissions and the default profile of
 * members; for each person the profile, the personal exceptions and what they hold with its source;
 * the permissions of each team; and the invitation of a person, with what they will hold.
 */
@customElement('mk-admin-permissions')
export class MkAdminPermissions extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 960px;
    }
    h1 {
      margin-top: 0;
    }
    h2 {
      font-size: 18px;
      margin: 0 0 8px;
    }
    [role='tablist'] {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      border-bottom: 1px solid var(--mk-line);
      margin-bottom: 16px;
    }
    [role='tab'] {
      font: inherit;
      padding: 8px 14px;
      border: 0;
      border-bottom: 3px solid transparent;
      background: none;
      color: var(--mk-fg);
      cursor: pointer;
    }
    [role='tab'][aria-selected='true'] {
      border-bottom-color: var(--mk-accent);
      font-weight: 600;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }
    @media (max-width: 720px) {
      .split {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .list {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    .list button {
      width: 100%;
      text-align: left;
      margin-bottom: 4px;
    }
    .list button[aria-current='true'] {
      border-color: var(--mk-accent);
      font-weight: 600;
    }
    .field {
      display: grid;
      gap: 4px;
      margin-bottom: 12px;
    }
    .check {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }
    input[type='text'],
    select,
    button {
      font: inherit;
      padding: 6px 10px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
      min-width: 0;
      max-width: 100%;
    }
    input[type='checkbox'] {
      accent-color: var(--mk-accent);
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
      color: var(--mk-danger);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 12px 0;
    }
    .muted {
      color: var(--mk-muted);
    }
    .status {
      min-height: 1.5em;
      color: var(--mk-muted);
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
  /** The organization whose permissions are managed. */
  @property() organization: string | undefined;
  /** Whether the person is also a platform administrator, who adds people to the organization. */
  @property({ type: Boolean }) platformAdmin = false;

  @state() private tab: Tab = 'profiles';
  @state() private declared: DeclaredPermission[] = [];
  @state() private profiles: PermissionProfile[] = [];
  @state() private members: OrganizationMember[] = [];
  @state() private teams: OrganizationTeam[] = [];
  /** The profile shown in the editor, or {@link NEW}. */
  @state() private profileId: string | undefined;
  @state() private draft: ProfileDraft | undefined;
  @state() private memberEmail = '';
  @state() private member: MemberPermissions | undefined;
  @state() private teamId = '';
  @state() private team: TeamPermissions | undefined;
  @state() private busy = false;
  @state() private message = '';
  @state() private failed = false;

  @query('mk-invite-person') private inviteDialog!: MkInvitePerson;
  @query('mk-create-account') private createDialog!: MkCreateAccount;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private get groups(): PermissionGroup[] {
    return byExtension(this.declared);
  }

  private async load(): Promise<void> {
    const { client, organization } = this;
    if (!client || !organization) {
      return;
    }
    try {
      const [declared, profiles, members, teams] = await Promise.all([
        client.declaredPermissions(organization),
        client.permissionProfiles(organization),
        client.organizationMembers(organization),
        client.teams().catch(() => []),
      ]);
      this.declared = declared;
      this.profiles = profiles;
      this.members = members;
      this.teams = teams.filter((team) => !team.kind || team.kind === 'team');
      const first = profiles[0];
      if (this.profileId === undefined && first) {
        this.editProfile(first);
      }
    } catch (error) {
      this.show(t('Not loaded: {reason}', { reason: String(error) }), true);
    }
  }

  override render(): unknown {
    return html`
      <h1>${t('Permissions')}</h1>
      <p>
        ${t(
          'What the people of your organization may do in each extension. A permission is off until a profile, a team or a personal exception grants it; administrators hold every permission.',
        )}
      </p>
      <div role="tablist" aria-label=${t('Permissions')} @keydown=${this.tabKeys}>
        ${TABS.map(
          (tab) =>
            html`<button
              type="button"
              role="tab"
              id="tab-${tab}"
              aria-selected=${this.tab === tab ? 'true' : 'false'}
              aria-controls="panel-${tab}"
              tabindex=${this.tab === tab ? 0 : -1}
              @click=${() => {
                this.select(tab);
              }}
            >
              ${this.tabTitle(tab)}
            </button>`,
        )}
      </div>
      <div role="tabpanel" id="panel-${this.tab}" aria-labelledby="tab-${this.tab}">
        ${
          this.tab === 'profiles'
            ? this.renderProfiles()
            : this.tab === 'people'
              ? this.renderPeople()
              : this.renderTeams()
        }
      </div>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
      <mk-invite-person
        .client=${this.client}
        .organization=${this.organization}
        .profiles=${this.profiles}
        .teams=${this.teams}
        .members=${this.members}
        ?platformAdmin=${this.platformAdmin}
        @mk-invited=${this.invited}
      ></mk-invite-person>
      <mk-create-account
        .client=${this.client}
        .organization=${this.organization}
        @mk-account-created=${this.accountCreated}
      ></mk-create-account>
    `;
  }

  private tabTitle(tab: Tab): string {
    return tab === 'profiles' ? t('Profiles') : tab === 'people' ? t('People') : t('Teams');
  }

  private select(tab: Tab): void {
    this.tab = tab;
    this.message = '';
    if (tab === 'people' && !this.memberEmail && this.members[0]) {
      void this.openMember(this.members[0].username);
    }
    if (tab === 'teams' && !this.teamId && this.teams[0]) {
      void this.openTeam(this.teams[0].id);
    }
  }

  /** The arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern). */
  private readonly tabKeys = (event: KeyboardEvent): void => {
    const at = TABS.indexOf(this.tab);
    const next =
      event.key === 'ArrowRight'
        ? (at + 1) % TABS.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1;
    const tab = TABS[next];
    if (tab === undefined) {
      return;
    }
    event.preventDefault();
    this.select(tab);
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>(`#tab-${tab}`)?.focus();
    });
  };

  // Profiles.

  private renderProfiles(): unknown {
    const draft = this.draft;
    return html`<div class="split">
      <nav aria-label=${t('Profiles')}>
        <ul class="list">
          ${this.profiles.map(
            (profile) =>
              html`<li>
                <button
                  type="button"
                  aria-current=${this.profileId === profile.id ? 'true' : 'false'}
                  @click=${() => {
                    this.editProfile(profile);
                  }}
                >
                  ${profile.name}${
                    profile.defaultForRole === MEMBER_ROLE
                      ? html` <span class="muted">(${t('default')})</span>`
                      : nothing
                  }
                </button>
              </li>`,
          )}
        </ul>
        ${
          this.profiles.length === 0
            ? html`<p class="muted">${t('No profiles yet: members hold no permission.')}</p>`
            : nothing
        }
        <button type="button" @click=${this.newProfile}>${t('New profile')}</button>
      </nav>
      ${
        draft
          ? html`<form @submit=${this.saveProfile} aria-labelledby="profile-title">
              <h2 id="profile-title">
                ${this.profileId === NEW ? t('New profile') : t('Profile {name}', { name: draft.name })}
              </h2>
              <div class="field">
                <label for="profile-name">${t('Name')}</label>
                <input
                  id="profile-name"
                  type="text"
                  required
                  maxlength="100"
                  .value=${draft.name}
                  @input=${(event: Event) => {
                    this.changeDraft({ name: (event.target as HTMLInputElement).value });
                  }}
                />
              </div>
              <div class="field">
                <label for="profile-description">${t('Description')}</label>
                <input
                  id="profile-description"
                  type="text"
                  maxlength="500"
                  .value=${draft.description}
                  @input=${(event: Event) => {
                    this.changeDraft({ description: (event.target as HTMLInputElement).value });
                  }}
                />
              </div>
              <label class="check">
                <input
                  type="checkbox"
                  .checked=${draft.defaultForRole === MEMBER_ROLE}
                  @change=${(event: Event) => {
                    this.changeDraft({
                      defaultForRole: (event.target as HTMLInputElement).checked
                        ? MEMBER_ROLE
                        : null,
                    });
                  }}
                />
                ${t('Default profile of members: for those without a profile of their own')}
              </label>
              <mk-permission-list
                .groups=${this.groups}
                .selected=${new Set(draft.permissions)}
                @mk-permission-toggle=${(event: CustomEvent<PermissionToggle>) => {
                  this.changeDraft({
                    permissions: toggled(draft.permissions, event.detail.id, event.detail.on),
                  });
                }}
              ></mk-permission-list>
              <div class="actions">
                <button class="primary" type="submit" ?disabled=${this.busy}>${t('Save')}</button>
                ${
                  this.profileId !== NEW
                    ? html`<button
                        class="danger"
                        type="button"
                        ?disabled=${this.busy}
                        @click=${this.deleteProfile}
                      >
                        ${t('Delete')}
                      </button>`
                    : nothing
                }
              </div>
            </form>`
          : nothing
      }
    </div>`;
  }

  private editProfile(profile: PermissionProfile): void {
    this.profileId = profile.id;
    this.draft = {
      name: profile.name,
      description: profile.description,
      defaultForRole: profile.defaultForRole,
      permissions: [...profile.permissions],
    };
  }

  private readonly newProfile = (): void => {
    this.profileId = NEW;
    this.draft = { name: '', description: '', defaultForRole: null, permissions: [] };
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLInputElement>('#profile-name')?.focus();
    });
  };

  private changeDraft(change: Partial<ProfileDraft>): void {
    if (this.draft) {
      this.draft = { ...this.draft, ...change };
    }
  }

  private readonly saveProfile = async (event: Event): Promise<void> => {
    event.preventDefault();
    const { client, organization, draft } = this;
    if (!client || !organization || !draft || this.profileId === undefined) {
      return;
    }
    await this.act(async () => {
      const saved =
        this.profileId === NEW
          ? await client.createProfile(organization, draft)
          : await client.changeProfile(organization, this.profileId ?? '', draft);
      this.profiles = await client.permissionProfiles(organization);
      this.editProfile(saved);
      this.show(t('Saved.'), false);
    });
  };

  private readonly deleteProfile = async (): Promise<void> => {
    const { client, organization, draft, profileId } = this;
    if (!client || !organization || !draft || !profileId) {
      return;
    }
    if (
      !confirm(
        t('Delete the profile {name}? Its members go back to the default profile.', {
          name: draft.name,
        }),
      )
    ) {
      return;
    }
    await this.act(async () => {
      await client.deleteProfile(organization, profileId);
      this.profiles = await client.permissionProfiles(organization);
      this.profileId = undefined;
      this.draft = undefined;
      const first = this.profiles[0];
      if (first) {
        this.editProfile(first);
      }
      this.show(t('Deleted.'), false);
    });
  };

  // People.

  private renderPeople(): unknown {
    const member = this.member;
    const fallback = this.profiles.find((profile) => profile.defaultForRole === MEMBER_ROLE);
    return html`
      <div class="actions">
        <button class="primary" type="button" @click=${this.invite}>${t('Invite a person')}</button>
        <button type="button" @click=${this.createAccount}>${t('Create an account')}</button>
      </div>
      <div class="field">
        <label for="member">${t('Person')}</label>
        <select id="member" @change=${this.changeMember}>
          ${this.memberEmail ? nothing : html`<option value="" selected>${t('Choose')}</option>`}
          ${this.members.map(
            (person) =>
              html`<option
                value=${person.username}
                ?selected=${person.username === this.memberEmail}
              >
                ${
                  person.displayName && person.displayName !== person.username
                    ? `${person.displayName} (${person.username})`
                    : person.username
                }
              </option>`,
          )}
        </select>
      </div>
      ${
        member
          ? html`<section aria-labelledby="member-title">
              <h2 id="member-title">${this.memberName(member.email)}</h2>
              <p>${this.standing(member.standing)}</p>
              ${this.renderPasswordLink(member.email)}
              ${
                member.standing === 'member'
                  ? html`<div class="field">
                      <label for="member-profile">${t('Profile')}</label>
                      <select
                        id="member-profile"
                        ?disabled=${this.busy}
                        @change=${this.changeMemberProfile}
                      >
                        <option value="" ?selected=${!member.profileAssigned}>
                          ${
                            fallback
                              ? t('Default profile of members ({name})', { name: fallback.name })
                              : t('Default profile of members (none)')
                          }
                        </option>
                        ${this.profiles.map(
                          (profile) =>
                            html`<option
                              value=${profile.id}
                              ?selected=${member.profileAssigned && member.profile?.id === profile.id}
                            >
                              ${profile.name}
                            </option>`,
                        )}
                      </select>
                    </div>`
                  : nothing
              }
              ${
                member.standing === 'administrator'
                  ? nothing
                  : html`<h3>${t('Personal exceptions')}</h3>
                      <p class="muted">
                        ${t('Permissions given to this person only, on top of the others.')}
                      </p>
                      <mk-permission-list
                        .groups=${this.groups}
                        .selected=${new Set(member.exceptions)}
                        ?disabled=${this.busy}
                        @mk-permission-toggle=${this.toggleException}
                      ></mk-permission-list>`
              }
              <h3>${t('What they can do')}</h3>
              <mk-effective-permissions
                .permissions=${member.permissions}
                label=${t('What they can do')}
              ></mk-effective-permissions>
              <mk-offboard-member
                .client=${this.client}
                organization=${this.organization ?? ''}
                email=${member.email}
                .members=${this.members}
                @mk-member-removed=${this.memberRemoved}
              ></mk-offboard-member>
            </section>`
          : nothing
      }
    `;
  }

  /** For a created account whose person has not chosen a password yet, a new link (MK-048). */
  private renderPasswordLink(email: string): unknown {
    const person = this.members.find((candidate) => candidate.username === email);
    if (!person || !awaitsPassword(person)) {
      return nothing;
    }
    return html`<p class="muted">${t('Has not chosen a password yet.')}</p>
      <div class="actions">
        <button type="button" ?disabled=${this.busy} @click=${this.issueLink}>
          ${t('New link to set the password')}
        </button>
      </div>`;
  }

  private memberName(email: string): string {
    const person = this.members.find((candidate) => candidate.username === email);
    return person?.displayName && person.displayName !== email
      ? `${person.displayName} (${email})`
      : email;
  }

  private standing(standing: MemberPermissions['standing']): string {
    switch (standing) {
      case 'administrator':
        return t('Administrator of the organization: holds every permission.');
      case 'guest':
        return t('Guest: no profile; only what their teams and personal exceptions grant.');
      default:
        return t('Member: their profile, their teams and their personal exceptions.');
    }
  }

  private readonly changeMember = (event: Event): void => {
    void this.openMember((event.target as HTMLSelectElement).value);
  };

  private async openMember(email: string): Promise<void> {
    const { client, organization } = this;
    this.memberEmail = email;
    this.member = undefined;
    if (!client || !organization || !email) {
      return;
    }
    await this.act(async () => {
      const found = await client.memberPermissions(organization, email);
      // An answer for a person chosen before is not shown.
      if (this.memberEmail === email) {
        this.member = found;
      }
    }, false);
  }

  private readonly changeMemberProfile = async (event: Event): Promise<void> => {
    const { client, organization, memberEmail } = this;
    const value = (event.target as HTMLSelectElement).value;
    if (!client || !organization || !memberEmail) {
      return;
    }
    await this.act(async () => {
      this.member = await client.assignProfile(organization, memberEmail, value || null);
      this.show(t('Saved.'), false);
    });
  };

  private readonly toggleException = async (
    event: CustomEvent<PermissionToggle>,
  ): Promise<void> => {
    const { client, organization, memberEmail } = this;
    if (!client || !organization || !memberEmail) {
      return;
    }
    const { id, on } = event.detail;
    await this.act(async () => {
      this.member = await client.setException(organization, memberEmail, id, on);
      this.show(on ? t('Granted.') : t('Revoked.'), false);
    });
  };

  private readonly invite = (): void => {
    void this.inviteDialog.openDialog();
  };

  private readonly createAccount = (): void => {
    void this.createDialog.openDialog();
  };

  private readonly accountCreated = async (
    event: CustomEvent<OrganizationMember>,
  ): Promise<void> => {
    const { client, organization } = this;
    if (!client || !organization) {
      return;
    }
    this.members = await client.organizationMembers(organization).catch(() => this.members);
    await this.openMember(event.detail.username);
  };

  /** Issues a new link for the member shown; the previous one stops working. */
  private readonly issueLink = async (): Promise<void> => {
    const { client, organization, memberEmail } = this;
    if (!client || !organization || !memberEmail) {
      return;
    }
    this.busy = true;
    try {
      await this.createDialog.showLink(await client.issuePasswordLink(organization, memberEmail));
    } catch (error) {
      this.show(t('No new link: {reason}', { reason: String(error) }), true);
    } finally {
      this.busy = false;
    }
  };

  /** A member was removed (MK-071): the list no longer has them. */
  private readonly memberRemoved = async (event: CustomEvent<string>): Promise<void> => {
    const { client, organization } = this;
    if (!client || !organization) {
      return;
    }
    this.members = await client.organizationMembers(organization).catch(() => this.members);
    this.memberEmail = '';
    this.member = undefined;
    this.show(t('{email} was removed.', { email: event.detail }), false);
  };

  private readonly invited = async (event: CustomEvent<string>): Promise<void> => {
    const { client, organization } = this;
    if (!client || !organization) {
      return;
    }
    this.members = await client.organizationMembers(organization).catch(() => this.members);
    this.show(t('{email} is in the organization.', { email: event.detail }), false);
    await this.openMember(event.detail.trim().toLowerCase());
  };

  // Teams.

  private renderTeams(): unknown {
    if (this.teams.length === 0) {
      return html`<p class="muted">${t('The organization has no teams.')}</p>`;
    }
    const team = this.team;
    return html`
      <div class="field">
        <label for="team">${t('Team')}</label>
        <select id="team" @change=${this.changeTeam}>
          ${this.teamId ? nothing : html`<option value="" selected>${t('Choose')}</option>`}
          ${this.teams.map(
            (candidate) =>
              html`<option value=${candidate.id} ?selected=${candidate.id === this.teamId}>
                ${candidate.name}
              </option>`,
          )}
        </select>
      </div>
      ${
        team
          ? html`<section aria-labelledby="team-title">
              <h2 id="team-title">${t('Team {name}', { name: team.name })}</h2>
              <p class="muted">${t('Granted to every member and guest of the team.')}</p>
              <mk-permission-list
                .groups=${this.groups}
                .selected=${new Set(team.permissions)}
                ?disabled=${this.busy}
                @mk-permission-toggle=${this.toggleTeam}
              ></mk-permission-list>
            </section>`
          : nothing
      }
    `;
  }

  private readonly changeTeam = (event: Event): void => {
    void this.openTeam((event.target as HTMLSelectElement).value);
  };

  private async openTeam(id: string): Promise<void> {
    const { client, organization } = this;
    this.teamId = id;
    this.team = undefined;
    if (!client || !organization || !id) {
      return;
    }
    await this.act(async () => {
      const found = await client.teamPermissions(organization, id);
      // An answer for a team chosen before is not shown.
      if (this.teamId === id) {
        this.team = found;
      }
    }, false);
  }

  private readonly toggleTeam = async (event: CustomEvent<PermissionToggle>): Promise<void> => {
    const { client, organization, teamId } = this;
    if (!client || !organization || !teamId) {
      return;
    }
    const { id, on } = event.detail;
    await this.act(async () => {
      this.team = await client.setTeamPermission(organization, teamId, id, on);
      this.show(on ? t('Granted.') : t('Revoked.'), false);
    });
  };

  // Helpers.

  /**
   * Runs a call to the kernel, one at a time, shows its failure, and tells the shell that the
   * permissions changed, so that it shows the apps again.
   */
  private async act(call: () => Promise<void>, changes = true): Promise<void> {
    this.busy = true;
    try {
      await call();
      if (changes) {
        this.dispatchEvent(
          new CustomEvent('mk-permissions-changed', { bubbles: true, composed: true }),
        );
      }
    } catch (error) {
      this.show(t('Not saved: {reason}', { reason: String(error) }), true);
    } finally {
      this.busy = false;
    }
  }

  private show(message: string, failed: boolean): void {
    this.message = message;
    this.failed = failed;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-permissions': MkAdminPermissions;
  }
}
