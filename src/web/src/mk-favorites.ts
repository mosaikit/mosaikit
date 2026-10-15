// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { Favorite } from '@mosaikit/sdk';
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { t } from './i18n.js';

declare global {
  interface HTMLElementEventMap {
    'mk-open-favorite': CustomEvent<Favorite>;
    'mk-remove-favorite': CustomEvent<Favorite>;
  }
}

/**
 * The favorites of the person (MK-094): resources of every extension in one list, the last marked
 * first. Opening one goes where its extension registered it; one whose extension is absent shows the
 * placeholder of the kernel (MK-135). The shell opens and removes them.
 */
@customElement('mk-favorites')
export class MkFavorites extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 760px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    li {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    li > :first-child {
      flex: 1;
    }
    button {
      font: inherit;
      color: var(--mk-fg);
      cursor: pointer;
    }
    button.item {
      display: grid;
      gap: 2px;
      text-align: left;
      padding: 12px 16px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
    }
    button.secondary {
      padding: 6px 12px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
  `;

  @property({ attribute: false }) favorites: readonly Favorite[] = [];
  /** The names of the extensions by their identifier, to say where each favorite comes from. */
  @property({ attribute: false }) names: Readonly<Record<string, string>> = {};
  @property() language = 'en';

  override render(): unknown {
    return html`
      <h1>${t('Favorites')}</h1>
      ${
        this.favorites.length === 0
          ? html`<p class="muted">
              ${t('No favorites yet. Mark a resource as favorite in its app to find it here.')}
            </p>`
          : html`<ul aria-label=${t('Favorites')}>
              ${this.favorites.map((favorite) => this.renderFavorite(favorite))}
            </ul>`
      }
    `;
  }

  private renderFavorite(favorite: Favorite): unknown {
    const remove = html`<button
      type="button"
      class="secondary"
      aria-label=${t('Remove {title} from favorites', { title: favorite.title })}
      @click=${() => {
        this.fire('mk-remove-favorite', favorite);
      }}
    >
      ${t('Remove')}
    </button>`;
    if (favorite.status !== 'available') {
      return html`<li>
        <mk-reference-placeholder
          label=${favorite.title}
          locale=${this.language}
          .reference=${favorite}
        ></mk-reference-placeholder>
        ${remove}
      </li>`;
    }
    const app = this.names[favorite.extension];
    return html`<li>
      <button
        type="button"
        class="item"
        @click=${() => {
          this.fire('mk-open-favorite', favorite);
        }}
      >
        <strong>${favorite.title}</strong>
        ${app ? html`<span class="muted">${app}</span>` : nothing}
      </button>
      ${remove}
    </li>`;
  }

  private fire(type: 'mk-open-favorite' | 'mk-remove-favorite', favorite: Favorite): void {
    this.dispatchEvent(new CustomEvent(type, { detail: favorite, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-favorites': MkFavorites;
  }
}
