// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient } from './api.js';
import { t } from './i18n.js';
import {
  PAGE_SIZE,
  incompleteText,
  isShellLink,
  pillTitle,
  readSearchAddress,
  search,
  searchAddress,
  searchProviders,
  type SearchAnswer,
  type SearchHit,
  type SearchProvider,
  type SearchRequest,
  type SearchSection,
} from './search.js';

declare global {
  interface HTMLElementEventMap {
    'mk-search-go': CustomEvent<{ route: string }>;
  }
}

/**
 * The page of the global search (MK-040): the pills All, People, Teams and those of the extensions;
 * All shows the first results of every provider, a pill the results of its provider a page at a time.
 * The search lives in the address (`/search?q=…&in=…`): the page asks the shell to go there, with
 * `mk-search-go`, when the person changes pill or page or opens a result.
 */
@customElement('mk-search')
export class MkSearch extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 860px;
    }
    .pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
    }
    .pills button {
      font: inherit;
      font-size: 14px;
      padding: 4px 14px;
      border: 1px solid var(--mk-line);
      border-radius: 999px;
      background: var(--mk-surface);
      color: var(--mk-fg);
      cursor: pointer;
    }
    .pills button[aria-pressed='true'] {
      background: var(--mk-accent);
      border-color: var(--mk-accent);
      color: #ffffff;
    }
    section {
      margin-bottom: 20px;
    }
    h2 {
      font-size: 16px;
      margin: 0 0 8px;
    }
    ul.results {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .hit {
      display: grid;
      gap: 2px;
      padding: 10px 14px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
      color: var(--mk-fg);
      text-decoration: none;
    }
    a.hit:hover {
      border-color: var(--mk-accent);
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    .incomplete {
      color: var(--mk-muted);
      font-style: italic;
    }
    .paging {
      display: flex;
      gap: 8px;
      margin-top: 12px;
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

  @property({ attribute: false }) client: KernelClient | undefined;
  /** The query string of the address of the page, such as `?q=budget&in=people`. */
  @property() address = '';
  @property() language = 'en';

  @state() private providers: SearchProvider[] = [];
  @state() private answer: SearchAnswer | undefined;
  @state() private busy = false;
  @state() private error: string | undefined;
  private asked = 0;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('client') && this.client) {
      void this.loadProviders();
    }
    if (changed.has('address') || changed.has('client')) {
      void this.load();
    }
  }

  private get request(): SearchRequest {
    return readSearchAddress(this.address);
  }

  private async loadProviders(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.providers = await searchProviders(this.client);
    } catch {
      // The pills of the results remain.
    }
  }

  private async load(): Promise<void> {
    const request = this.request;
    if (!this.client || request.query === '') {
      this.answer = undefined;
      return;
    }
    const asked = ++this.asked;
    this.busy = true;
    this.error = undefined;
    try {
      const answer = await search(this.client, request);
      if (asked === this.asked) {
        this.answer = answer;
      }
    } catch (error) {
      if (asked === this.asked) {
        this.answer = undefined;
        this.error = error instanceof Error ? error.message : t('The search failed. Try again.');
      }
    } finally {
      if (asked === this.asked) {
        this.busy = false;
      }
    }
  }

  private go(request: SearchRequest): void {
    this.dispatchEvent(
      new CustomEvent('mk-search-go', {
        detail: { route: searchAddress(request) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private titleOf(id: string, fallback: string): string {
    const provider = this.providers.find((candidate) => candidate.id === id);
    if (provider) {
      return pillTitle(provider, this.language);
    }
    // A pill the list does not have yet: the kernel ones have no slash in their identifier.
    return pillTitle(
      id.includes('/') ? { id, title: fallback, extension: id } : { id, title: fallback },
      this.language,
    );
  }

  override render(): unknown {
    const request = this.request;
    if (request.query === '') {
      return html`<h1>${t('Search')}</h1>
        <p class="muted">
          ${t('Type in the search box to find people, teams and the data of your apps.')}
        </p>`;
    }
    return html`
      <h1>${t('Results for “{query}”', { query: request.query })}</h1>
      ${this.renderPills(request)}
      ${
        this.error
          ? html`<mk-empty-state
              kind="failed"
              role="alert"
              heading=${t('The search failed. Try again.')}
              @mk-retry=${() => void this.load()}
              >${this.error}</mk-empty-state
            >`
          : nothing
      }
      ${this.busy && !this.answer ? html`<p class="muted">${t('Searching…')}</p>` : nothing}
      ${this.answer ? (request.provider ? this.renderPage(request, this.answer) : this.renderAll(this.answer)) : nothing}
    `;
  }

  private renderPills(request: SearchRequest): unknown {
    const pills = [
      { id: undefined, title: t('All') },
      ...this.providers.map((provider) => ({
        id: provider.id,
        title: pillTitle(provider, this.language),
      })),
    ];
    return html`<ul class="pills" aria-label=${t('Search in')}>
      ${pills.map(
        (pill) =>
          html`<li>
            <button
              type="button"
              aria-pressed=${request.provider === pill.id ? 'true' : 'false'}
              @click=${() => {
                this.go({ query: request.query, ...(pill.id ? { provider: pill.id } : {}) });
              }}
            >
              ${pill.title}
            </button>
          </li>`,
      )}
    </ul>`;
  }

  /** All: the first results of every provider, the empty ones left out. */
  private renderAll(answer: SearchAnswer): unknown {
    const shown = answer.sections.filter(
      (section) => section.results.length > 0 || section.status === 'incomplete',
    );
    if (shown.length === 0) {
      return html`<mk-empty-state
        kind="empty"
        heading=${t('Nothing found for “{query}”.', { query: answer.query })}
        >${t('Try other words, or only the beginning of a word.')}</mk-empty-state
      >`;
    }
    return shown.map((section) => {
      const title = this.titleOf(section.provider, section.title);
      return html`<section aria-label=${title}>
        <h2>${title}</h2>
        ${this.renderSection(title, section)}
        ${
          section.more
            ? html`<button
                type="button"
                class="secondary"
                @click=${() => {
                  this.go({ query: answer.query, provider: section.provider });
                }}
              >
                ${t('More in {title}', { title })}
              </button>`
            : nothing
        }
      </section>`;
    });
  }

  /** A pill: a page of the results of its provider. */
  private renderPage(request: SearchRequest, answer: SearchAnswer): unknown {
    const section = answer.sections[0];
    if (!section) {
      return nothing;
    }
    const title = this.titleOf(section.provider, section.title);
    const offset = request.offset ?? 0;
    if (section.status === 'complete' && section.results.length === 0) {
      return html`<mk-empty-state
        kind="empty"
        heading=${t('Nothing found for “{query}” in {title}.', { query: answer.query, title })}
        >${t('Try other words, or look in All.')}</mk-empty-state
      >`;
    }
    return html`${this.renderSection(title, section)}
      <div class="paging">
        ${
          offset > 0
            ? html`<button
                type="button"
                class="secondary"
                @click=${() => {
                  this.go({ ...request, offset: Math.max(0, offset - PAGE_SIZE) });
                }}
              >
                ${t('Previous')}
              </button>`
            : nothing
        }
        ${
          section.more
            ? html`<button
                type="button"
                class="secondary"
                @click=${() => {
                  this.go({ ...request, offset: offset + PAGE_SIZE });
                }}
              >
                ${t('Next')}
              </button>`
            : nothing
        }
      </div>`;
  }

  private renderSection(title: string, section: SearchSection): unknown {
    const incomplete = incompleteText(title, section);
    return html`${incomplete ? html`<p class="incomplete">${incomplete}</p>` : nothing}
    ${
      section.results.length > 0
        ? html`<ul class="results" aria-label=${title}>
            ${section.results.map((hit) => html`<li>${this.renderHit(hit)}</li>`)}
          </ul>`
        : nothing
    }`;
  }

  private renderHit(hit: SearchHit): unknown {
    const body = html`<strong>${hit.title}</strong>${
        hit.detail ? html`<span class="muted">${hit.detail}</span>` : nothing
      }`;
    if (!isShellLink(hit.link)) {
      return html`<div class="hit">${body}</div>`;
    }
    const link = hit.link;
    return html`<a
      class="hit"
      href=${link}
      @click=${(event: MouseEvent) => {
        event.preventDefault();
        this.dispatchEvent(
          new CustomEvent('mk-search-go', {
            detail: { route: link },
            bubbles: true,
            composed: true,
          }),
        );
      }}
      >${body}</a
    >`;
  }
}
