// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { t } from './i18n.js';
import {
  day,
  defineSharedView,
  linkRequest,
  openLink,
  type LinkAccess,
  type LinkOutcome,
} from './sharing.js';

/** A placed element of an extension that shows a resource opened with a link. */
interface SharedViewElement extends HTMLElement {
  resource?: LinkAccess['resource'];
  level?: string;
  request?: (path: string, init?: RequestInit) => Promise<Response>;
}

/**
 * The page of a link (MK-055), `/shared/<secret>`, also for people without an account: it opens the
 * link with the kernel, asks for its password when it has one, and places the element that the
 * extension contributes to `shared.view` for the type, which calls the API of the extension with the
 * link. A link that expired or was removed answers that it does not exist.
 */
@customElement('mk-shared-link')
export class MkSharedLink extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 720px;
      margin: 0 auto;
      padding: 24px 16px;
      box-sizing: border-box;
    }
    h1 {
      margin: 0 0 4px;
      overflow-wrap: anywhere;
    }
    .muted {
      color: var(--mk-muted);
    }
    form {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: end;
      margin-top: 12px;
    }
    .field {
      display: grid;
      gap: 4px;
      flex: 1 1 220px;
    }
    input,
    button {
      font: inherit;
      padding: 8px 10px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
      min-width: 0;
    }
    button {
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      font-weight: 600;
    }
    .error {
      color: var(--mk-danger);
    }
    #view {
      margin-top: 16px;
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property() token = '';

  @state() private outcome: LinkOutcome | undefined;
  @state() private password = '';
  @state() private noView = false;

  @query('#view') private view!: HTMLElement;

  /** Opens the link with the kernel; overridable for tests. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  protected override updated(changed: PropertyValues): void {
    if (changed.has('token') && this.token) {
      void this.open();
    }
  }

  private async open(password?: string): Promise<void> {
    this.outcome = await openLink((path, init) => this.fetchImpl(path, init), this.token, password);
    if (this.outcome.kind === 'opened') {
      await this.updateComplete;
      await this.place(this.outcome.access, password);
    }
  }

  /** Places the element of the extension that shows the resource, with the link as its credential. */
  private async place(access: LinkAccess, password: string | undefined): Promise<void> {
    const view = access.view;
    const request = linkRequest(this.token, password, this.fetchImpl);
    if (!view || !(await defineSharedView(view, request).catch(() => false))) {
      this.noView = true;
      return;
    }
    const element = document.createElement(view.element) as SharedViewElement;
    element.resource = access.resource;
    element.level = access.level;
    element.request = request;
    this.view.replaceChildren(element);
  }

  override render(): unknown {
    const outcome = this.outcome;
    if (!outcome) {
      return html`<p class="muted">${t('Opening the link…')}</p>`;
    }
    switch (outcome.kind) {
      case 'not-found':
        return html`<h1>${t('Link not found')}</h1>
          <p role="alert">
            ${t('This link does not exist: it may have expired or been removed. Ask who gave it to you for a new one.')}
          </p>`;
      case 'failed':
        return html`<p class="error" role="alert">
          ${t('The link cannot be opened: {reason}', { reason: outcome.reason })}
        </p>`;
      case 'password':
        return html`<h1>${t('This link asks for a password')}</h1>
          ${
            outcome.wrong
              ? html`<p class="error" role="alert">${t('The password is not correct.')}</p>`
              : nothing
          }
          <form
            @submit=${(event: Event) => {
              event.preventDefault();
              void this.open(this.password);
            }}
          >
            <span class="field"
              ><label for="link-password">${t('Password of the link')}</label
              ><input
                id="link-password"
                type="password"
                required
                autocomplete="off"
                .value=${this.password}
                @input=${(event: Event) => {
                  this.password = (event.target as HTMLInputElement).value;
                }}
            /></span>
            <button type="submit">${t('Open')}</button>
          </form>`;
      case 'opened':
        return html`<h1>${outcome.access.title}</h1>
          <p class="muted">
            ${t('Shared with you through a link, until {date}.', { date: day(outcome.access.expires) })}
          </p>
          ${
            this.noView
              ? html`<p>${t('Its app cannot show it here. Sign in to open it.')}</p>`
              : nothing
          }
          <div id="view"></div>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-shared-link': MkSharedLink;
  }
}
