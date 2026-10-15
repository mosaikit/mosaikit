// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  AccessRequestList,
  AccessRequestsApi,
  levelTitle,
  requesterOf,
  type PendingAccessRequest,
} from './access-requests.js';
import type { KernelClient } from './api.js';
import { t } from './i18n.js';
import { when } from './sessions.js';

/**
 * The requests for access the person may decide (MK-058), in one list for every resource of every
 * extension: those for the resources they own, and for an administrator those of the organization.
 * Each is approved with the level asked or another, or declined with a reason. The behaviour is in
 * {@link AccessRequestList}.
 */
@customElement('mk-access-requests')
export class MkAccessRequests extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      height: 100%;
    }
    article {
      display: grid;
      gap: 6px;
      padding: 12px 14px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
    }
    h2 {
      margin: 0;
      font-size: 1rem;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    blockquote {
      margin: 0;
      padding-left: 10px;
      border-left: 3px solid var(--mk-line);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    select,
    input,
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
    button.primary {
      background: var(--mk-accent);
      border-color: var(--mk-accent);
      color: var(--mk-on-accent, #fff);
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    .announce {
      min-height: 1.5em;
      margin: 0;
      padding: 0 24px;
      color: var(--mk-muted);
    }
    .announce.error {
      color: var(--mk-danger);
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private message = '';
  @state() private failed = false;
  @state() private loadFailed = false;

  private list: AccessRequestList | undefined;
  private readonly granted = new Map<string, string>();
  private readonly reasons = new Map<string, string>();

  override connectedCallback(): void {
    super.connectedCallback();
    const client = this.client;
    this.list = new AccessRequestList(
      client ? new AccessRequestsApi((path, init) => client.request(path, init)) : undefined,
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
    void this.load();
  }

  private async load(): Promise<void> {
    await this.list?.load();
    this.loadFailed = this.list?.requests === undefined;
  }

  override render(): unknown {
    const requests = this.list?.requests;
    return html`<mk-list-page heading=${t('Requests for access')} count=${requests?.length ?? 0}>
      <p class="announce ${this.failed ? 'error' : ''}" aria-live="polite">${this.message}</p>
      ${
        this.loadFailed
          ? html`<mk-empty-state
              kind="failed"
              @mk-retry=${() => void this.load()}
            ></mk-empty-state>`
          : requests === undefined
            ? nothing
            : requests.length === 0
              ? html`<mk-empty-state kind="empty" heading=${t('No requests to decide')}>
                  ${t(
                    'When someone asks for access to a resource you may share, the request shows here.',
                  )}
                </mk-empty-state>`
              : requests.map((request) => this.renderRequest(request))
      }
    </mk-list-page>`;
  }

  private renderRequest(request: PendingAccessRequest): unknown {
    const name = requesterOf(request);
    const level = this.granted.get(request.id) ?? request.level;
    return html`<article aria-labelledby="request-${request.id}">
      <h2 id="request-${request.id}">
        ${t('{name} asks for {level} on {title}', {
          name,
          level: levelTitle(request, request.level),
          title: request.title,
        })}
      </h2>
      <span class="muted">
        ${request.typeTitle} · ${request.extensionName} · ${when(request.created)}
        ${request.requesterEmail && request.requesterName ? html` · ${request.requesterEmail}` : nothing}
      </span>
      ${request.message ? html`<blockquote>${request.message}</blockquote>` : nothing}
      <div class="actions">
        <label>
          ${t('Level')}
          <select
            aria-label=${t('Level to grant to {name}', { name })}
            @change=${(event: Event) => {
              this.granted.set(request.id, (event.target as HTMLSelectElement).value);
            }}
          >
            ${request.levels.map(
              (found) =>
                html`<option value=${found.name} ?selected=${found.name === level}>
                  ${found.title}
                </option>`,
            )}
          </select>
        </label>
        <button
          type="button"
          class="primary"
          aria-label=${t('Approve the request of {name}', { name })}
          @click=${() => void this.list?.approve(request, this.granted.get(request.id))}
        >
          ${t('Approve')}
        </button>
        <input
          type="text"
          maxlength="1000"
          aria-label=${t('Reason for declining the request of {name}', { name })}
          placeholder=${t('Reason (optional)')}
          @input=${(event: Event) => {
            this.reasons.set(request.id, (event.target as HTMLInputElement).value);
          }}
        />
        <button
          type="button"
          aria-label=${t('Decline the request of {name}', { name })}
          @click=${() => void this.list?.reject(request, this.reasons.get(request.id))}
        >
          ${t('Decline')}
        </button>
      </div>
    </article>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-access-requests': MkAccessRequests;
  }
}
