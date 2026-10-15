// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { ExtensionPresence, FrontendExtension } from '@mosaikit/sdk';
import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { homeWidgets, type HomeWidget } from './home.js';
import { t } from './i18n.js';

/**
 * The widgets that extensions contribute to the home page (MK-101), in a grid: for the roles of the
 * person, or the public ones for a visitor. A widget whose extension stops being active in the
 * organization disappears at once (MK-133).
 */
@customElement('mk-home-widgets')
export class MkHomeWidgets extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    .grid {
      list-style: none;
      padding: 0;
      margin: 24px 0 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      max-width: 1200px;
    }
    .widget {
      min-width: 0;
      padding: 16px;
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
      background: var(--mk-surface);
      color: var(--mk-fg);
    }
    .wide {
      grid-column: span 2;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 15px;
    }
    @media (max-width: 640px) {
      .wide {
        grid-column: auto;
      }
    }
  `;

  /** The frontends whose widgets to show, already loaded. */
  @property({ attribute: false }) extensions: readonly FrontendExtension[] = [];
  /** The extensions active in the organization of the session, absent for a visitor. */
  @property({ attribute: false }) presence: ExtensionPresence | undefined;
  /** The permissions the person holds, `undefined` while unknown. */
  @property({ attribute: false }) held: ReadonlySet<string> | undefined;
  @property() language = 'en';
  /** The name of the list, for assistive technologies. */
  @property() label = '';

  /** The elements of the widgets, created once, so that a new render keeps their state. */
  private readonly elements = new Map<string, HTMLElement>();
  private stopPresence: (() => void) | undefined;

  override disconnectedCallback(): void {
    this.stopPresence?.();
    this.stopPresence = undefined;
    super.disconnectedCallback();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.follow();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('presence')) {
      this.follow();
    }
  }

  private follow(): void {
    this.stopPresence?.();
    this.stopPresence = this.presence?.subscribe(() => {
      this.requestUpdate();
    });
  }

  private elementOf(widget: HomeWidget): HTMLElement {
    const key = `${widget.extensionId}/${widget.id}`;
    let element = this.elements.get(key);
    if (!element) {
      element = document.createElement(widget.element);
      this.elements.set(key, element);
    }
    return element;
  }

  override render(): unknown {
    const widgets = homeWidgets(this.extensions, {
      locale: this.language,
      held: this.held,
      presence: this.presence,
    });
    if (widgets.length === 0) {
      return nothing;
    }
    return html`<ul class="grid" aria-label=${this.label || t('Widgets')}>
      ${widgets.map(
        (widget) =>
          html`<li class=${widget.size === 'wide' ? 'widget wide' : 'widget'}>
            <h2>${widget.title}</h2>
            ${this.elementOf(widget)}
          </li>`,
      )}
    </ul>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-home-widgets': MkHomeWidgets;
  }
}
