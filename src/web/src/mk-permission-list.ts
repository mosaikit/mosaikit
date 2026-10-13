// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from './i18n.js';
import type { PermissionGroup } from './permissions.js';

/** A permission switched on or off in a {@link MkPermissionList}. */
export interface PermissionToggle {
  readonly id: string;
  readonly on: boolean;
}

/**
 * The permissions of the active extensions, grouped by extension, each with a check box (MK-056):
 * those of a profile, of a team, or the personal exceptions of a person. A permission is off until
 * it is in `selected`. Changes are announced with `mk-permission-toggle`; the owner saves them.
 */
@customElement('mk-permission-list')
export class MkPermissionList extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    fieldset {
      margin: 0 0 12px;
      padding: 8px 12px 10px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
      min-width: 0;
    }
    legend {
      padding: 0 4px;
      font-weight: 600;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      padding: 6px 0;
      border-top: 1px solid var(--mk-line);
    }
    li:first-child {
      border-top: 0;
    }
    label {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      cursor: pointer;
    }
    input {
      margin-top: 3px;
      accent-color: var(--mk-accent);
    }
    .title {
      overflow-wrap: anywhere;
    }
    .description {
      display: block;
      padding-left: 26px;
    }
    .description,
    .note {
      font-size: 13px;
      color: var(--mk-muted);
      overflow-wrap: anywhere;
    }
    .note {
      margin: 0 0 6px;
    }
    .tag {
      display: inline-block;
      margin-left: 6px;
      padding: 0 6px;
      border-radius: 8px;
      border: 1px solid var(--mk-line);
      font-size: 12px;
      color: var(--mk-muted);
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  /** The permissions to show, grouped by extension. */
  @property({ attribute: false }) groups: readonly PermissionGroup[] = [];
  /** The permissions that are on. */
  @property({ attribute: false }) selected: ReadonlySet<string> = new Set();
  /** Whether the check boxes cannot be changed, such as while a change is saved. */
  @property({ type: Boolean }) disabled = false;

  override render(): unknown {
    if (this.groups.length === 0) {
      return html`<p>${t('No active extension declares permissions.')}</p>`;
    }
    return this.groups.map(
      (group) =>
        html`<fieldset>
          <legend>${group.name}</legend>
          ${
            group.off
              ? html`<p class="note">
                  ${t('All the apps of this extension are off: nobody holds its permissions.')}
                </p>`
              : nothing
          }
          <ul>
            ${group.permissions.map((permission) => {
              const describedBy = `d-${permission.id.replace(/[^a-zA-Z0-9-]/g, '-')}`;
              return html`<li>
                <label>
                  <input
                    type="checkbox"
                    data-permission=${permission.id}
                    aria-describedby=${permission.description ? describedBy : nothing}
                    .checked=${this.selected.has(permission.id)}
                    ?disabled=${this.disabled}
                    @change=${(event: Event) => {
                      this.toggle(permission.id, (event.target as HTMLInputElement).checked);
                    }}
                  />
                  <span class="title"
                    >${permission.title}${
                      permission.app ? html`<span class="tag">${t('App')}</span>` : nothing
                    }</span
                  >
                </label>
                ${
                  permission.description
                    ? html`<span class="description" id=${describedBy}
                        >${permission.description}</span
                      >`
                    : nothing
                }
              </li>`;
            })}
          </ul>
        </fieldset>`,
    );
  }

  private toggle(id: string, on: boolean): void {
    this.dispatchEvent(
      new CustomEvent<PermissionToggle>('mk-permission-toggle', {
        detail: { id, on },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-permission-list': MkPermissionList;
  }
}
