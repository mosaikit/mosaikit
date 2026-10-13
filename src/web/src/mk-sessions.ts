// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AccountSession, KernelClient } from './api.js';
import { t } from './i18n.js';
import { SessionList, describeDevice, describeUse } from './sessions.js';

declare global {
  interface HTMLElementEventMap {
    /** The person ended the session of this browser from the list. */
    'mk-signed-out': CustomEvent<void>;
    /** A message for the status region of the settings page, which this list has none of. */
    'mk-settings-status': CustomEvent<string>;
  }
}

/**
 * The view of the live sessions of the signed-in person, in their settings (MK-125): device, address,
 * when it was opened and last used, this browser marked. The behaviour is in {@link SessionList};
 * messages go to the one status region of the settings page.
 */
@customElement('mk-sessions')
export class MkSessions extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 12px;
    }
    li {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--mk-line);
    }
    li:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .device {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .current {
      display: inline-block;
      margin-left: 8px;
      padding: 0 8px;
      border-radius: 999px;
      background: var(--mk-accent-soft);
      color: var(--mk-fg);
      font-size: 13px;
      font-weight: 600;
    }
    .muted {
      margin: 2px 0 0;
      color: var(--mk-muted);
      font-size: 13px;
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
    button:focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  private list: SessionList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.list = new SessionList(this.client, {
      changed: () => {
        this.requestUpdate();
      },
      announce: (message) => {
        this.dispatchEvent(
          new CustomEvent('mk-settings-status', { detail: message, bubbles: true, composed: true }),
        );
      },
      signedOut: () => {
        this.dispatchEvent(new CustomEvent('mk-signed-out', { bubbles: true, composed: true }));
      },
    });
    void this.list.load();
  }

  override render(): unknown {
    const sessions = this.list?.sessions;
    return html`
      <p class="muted">
        ${t('Where you are signed in. End a session you do not recognize: it is signed out at once.')}
      </p>
      ${
        sessions === undefined
          ? nothing
          : sessions.length === 0
            ? html`<p>${t('No active session.')}</p>`
            : html`<ul aria-label=${t('Sessions')}>
                ${sessions.map((session) => this.renderSession(session))}
              </ul>`
      }
    `;
  }

  private renderSession(session: AccountSession): unknown {
    const label = `session-${session.id}`;
    return html`<li>
      <div>
        <div class="device" id=${label}>
          ${describeDevice(session)}${
            session.current ? html`<span class="current">${t('This browser')}</span>` : nothing
          }
        </div>
        <p class="muted">${describeUse(session)}</p>
      </div>
      <button type="button" aria-describedby=${label} @click=${() => void this.list?.end(session)}>
        ${session.current ? t('Sign out') : t('End session')}
      </button>
    </li>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-sessions': MkSessions;
  }
}
