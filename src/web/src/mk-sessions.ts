// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { AccountSession, KernelClient } from './api.js';
import { language, t } from './i18n.js';
import { describeDevice as describe } from './sessions.js';

declare global {
  interface HTMLElementEventMap {
    /** The person ended the session of this browser from the list. */
    'mk-signed-out': CustomEvent<void>;
  }
}

/**
 * The live sessions of the signed-in person, in their settings (MK-125): device, address, when it
 * was opened and last used, this browser marked. Ending one refuses its cookie, its "remember me" and
 * the tokens of its realm session at once; ending the session of this browser signs it out.
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
    .status {
      min-height: 1.5em;
      margin: 8px 0 0;
      color: var(--mk-muted);
    }
    .error {
      color: var(--mk-danger);
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private sessions: readonly AccountSession[] | undefined;
  @state() private message = '';
  @state() private failed = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.sessions = await this.client?.sessions();
    } catch (error) {
      this.show(t('The sessions cannot be read: {reason}', { reason: reason(error) }), true);
    }
  }

  override render(): unknown {
    const sessions = this.sessions;
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
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message}
      </p>
    `;
  }

  private renderSession(session: AccountSession): unknown {
    const device = describe(session);
    const label = `session-${session.id}`;
    return html`<li>
      <div>
        <div class="device" id=${label}>
          ${device}${
            session.current ? html`<span class="current">${t('This browser')}</span>` : nothing
          }
        </div>
        <p class="muted">
          ${t('Signed in {created} · last used {seen}', {
            created: when(session.createdAt),
            seen: when(session.lastSeenAt),
          })}${session.address ? ` · ${session.address}` : ''}${
            session.kind === 'realm' ? ` · ${t('through your organization')}` : ''
          }
        </p>
      </div>
      <button
        type="button"
        aria-describedby=${label}
        @click=${() => void this.end(session, device)}
      >
        ${session.current ? t('Sign out') : t('End session')}
      </button>
    </li>`;
  }

  private async end(session: AccountSession, device: string): Promise<void> {
    try {
      await this.client?.endSession(session.id);
    } catch (error) {
      this.show(t('The session was not ended: {reason}', { reason: reason(error) }), true);
      await this.load();
      return;
    }
    if (session.current) {
      this.dispatchEvent(new CustomEvent('mk-signed-out', { bubbles: true, composed: true }));
      return;
    }
    this.sessions = this.sessions?.filter((other) => other.id !== session.id);
    this.show(t('Session ended: {device}', { device }), false);
  }

  private show(message: string, failed: boolean): void {
    this.message = message;
    this.failed = failed;
  }
}

function when(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime())
    ? instant
    : date.toLocaleString(language(), { dateStyle: 'medium', timeStyle: 'short' });
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-sessions': MkSessions;
  }
}
