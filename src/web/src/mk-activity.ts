// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ActivityNotification } from './api.js';
import { t } from './i18n.js';

declare global {
  interface HTMLElementEventMap {
    'mk-open-notification': CustomEvent<ActivityNotification>;
    'mk-read-all': CustomEvent<undefined>;
  }
}

/**
 * The activity feed of the person (MK-038): the notifications of the plugins, newest first. Opening
 * one marks it as read and goes where it points; the shell does both.
 */
@customElement('mk-activity')
export class MkActivity extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 760px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    button.item {
      width: 100%;
      display: grid;
      gap: 2px;
      text-align: left;
      font: inherit;
      padding: 12px 16px;
      border: 1px solid var(--mk-line);
      border-left: 4px solid transparent;
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
      color: var(--mk-fg);
      cursor: pointer;
    }
    button.item.unread {
      border-left-color: var(--mk-accent);
    }
    button.item.unread strong {
      font-weight: 700;
    }
    button.item strong {
      font-weight: 400;
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    button.secondary {
      font: inherit;
      padding: 6px 12px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
      color: var(--mk-fg);
      cursor: pointer;
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) notifications: readonly ActivityNotification[] = [];
  @property({ type: Number }) unread = 0;
  @property() language = 'en';

  override render(): unknown {
    return html`
      <header>
        <h1>${t('Activity')}</h1>
        ${
          this.unread > 0
            ? html`<button class="secondary" type="button" @click=${this.readAll}>
                ${t('Mark all as read')}
              </button>`
            : nothing
        }
      </header>
      ${
        this.notifications.length === 0
          ? html`<p class="muted">${t('Nothing new.')}</p>`
          : html`<ul aria-label=${t('Notifications')}>
              ${this.notifications.map(
                (notification) =>
                  html`<li>
                    <button
                      type="button"
                      class="item ${notification.read ? '' : 'unread'}"
                      aria-label=${
                        notification.read
                          ? notification.title
                          : t('Unread: {title}', { title: notification.title })
                      }
                      @click=${() => {
                        this.open(notification);
                      }}
                    >
                      <strong>${notification.title}</strong>
                      ${notification.body ? html`<span>${notification.body}</span>` : nothing}
                      <span class="muted"
                        >${new Date(notification.createdAt).toLocaleString(this.language)}</span
                      >
                    </button>
                  </li>`,
              )}
            </ul>`
      }
    `;
  }

  private open(notification: ActivityNotification): void {
    this.dispatchEvent(
      new CustomEvent('mk-open-notification', {
        detail: notification,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private readonly readAll = (): void => {
    this.dispatchEvent(new CustomEvent('mk-read-all', { bubbles: true, composed: true }));
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-activity': MkActivity;
  }
}
