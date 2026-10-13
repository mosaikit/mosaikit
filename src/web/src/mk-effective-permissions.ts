// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { EffectivePermission } from './api.js';
import { t } from './i18n.js';
import { sourcesLabel } from './permissions.js';

/**
 * The permissions that a person holds, or would hold, and where each comes from (MK-056): a
 * profile, a team, a personal exception, or being an administrator of the organization. A
 * permission granted while all the apps of its extension are off is listed as withheld.
 */
@customElement('mk-effective-permissions')
export class MkEffectivePermissions extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 12px;
      justify-content: space-between;
      padding: 6px 0;
      border-top: 1px solid var(--mk-line);
    }
    .title {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .from {
      color: var(--mk-muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .withheld {
      flex-basis: 100%;
      color: var(--mk-danger);
      font-size: 13px;
    }
  `;

  @property({ attribute: false }) permissions: readonly EffectivePermission[] = [];
  /** The accessible name of the list. */
  @property() label = '';

  override render(): unknown {
    if (this.permissions.length === 0) {
      return html`<p>${t('No permissions.')}</p>`;
    }
    return html`<ul aria-label=${this.label || nothing}>
      ${this.permissions.map(
        (permission) =>
          html`<li data-permission=${permission.id}>
            <span class="title">${permission.title}</span>
            <span class="from"
              >${t('From: {sources}', { sources: sourcesLabel(permission.sources) })}</span
            >
            ${
              permission.granted
                ? nothing
                : html`<span class="withheld"
                    >${t('Not held: all the apps of its extension are off.')}</span
                  >`
            }
          </li>`,
      )}
    </ul>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-effective-permissions': MkEffectivePermissions;
  }
}
