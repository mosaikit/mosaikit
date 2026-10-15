// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { emptyKind, emptyStateText, type EmptyStateText } from './patterns.js';

const ICONS: Record<EmptyStateText['icon'], string> = {
  inbox: 'M4 13h4l2 3h4l2-3h4M4 13l3-8h10l3 8v6H4z',
  filter: 'M4 5h16l-6 8v5l-4 2v-7z',
  error: 'M12 3l9 16H3zM12 10v4M12 17h.01',
  offline:
    'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.8M19 13a10 10 0 0 0-2-1.6M12 20h.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
};

const TEMPLATE = `
<style>
  :host {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 36px 16px;
    text-align: center;
    color: var(--mk-fg);
    font-family: var(--mk-font, inherit);
    border: 1px dashed var(--mk-line);
    border-radius: var(--mk-radius, 12px);
  }
  :host([hidden]),
  [hidden] { display: none !important; }
  svg { width: 32px; height: 32px; color: var(--mk-muted); }
  :host([data-tone='problem']) svg { color: var(--mk-danger); }
  :host([kind='offline']) svg, :host([kind='denied']) svg { color: var(--mk-warning); }
  h2 { margin: 4px 0 0; font-size: 1rem; font-weight: 600; }
  .explanation { margin: 0; max-width: 46ch; color: var(--mk-muted); }
  .action { margin-top: 6px; display: flex; gap: 8px; justify-content: center; }
</style>
<svg part="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path></path></svg>
<h2 part="title"></h2>
<p class="explanation" part="explanation"><span class="default-explanation"></span><slot></slot></p>
<div class="action" part="action"><slot name="action"><fluent-button role="button" class="default-action"
  appearance="primary"></fluent-button></slot></div>
`;

/**
 * `<mk-empty-state>`: what a panel without content shows (MK-105). `kind` says what happened,
 * `empty` (nothing yet), `filtered` (the filters hide everything), `failed`, `offline` or `denied`;
 * each kind has its own icon, tone and default texts. `heading` is the title, the content is the
 * explanation, the slot `action` the action. Without an action of the app, `filtered` offers
 * "Clear the filters" (event `mk-clear-filters`), `failed` and `offline` "Try again" (`mk-retry`).
 */
export class MkEmptyState extends HTMLElement {
  static readonly observedAttributes = ['kind', 'heading'];

  private readonly root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = TEMPLATE;
    this.root.querySelector('.default-action')?.addEventListener('click', () => {
      const event = emptyStateText(emptyKind(this.getAttribute('kind'))).action?.event;
      if (event) {
        this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
      }
    });

    const own = this.root.querySelector<HTMLSlotElement>('slot:not([name])');
    own?.addEventListener('slotchange', () => {
      const given = own
        .assignedNodes()
        .some((node) => node.nodeType === Node.ELEMENT_NODE || node.textContent?.trim());
      const fallback = this.root.querySelector<HTMLElement>('.default-explanation');
      if (fallback) {
        fallback.hidden = given;
      }
    });
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(): void {
    this.render();
  }

  private render(): void {
    const text = emptyStateText(emptyKind(this.getAttribute('kind')));
    this.dataset.tone = text.tone;
    this.root.querySelector('path')?.setAttribute('d', ICONS[text.icon]);
    const title = this.root.querySelector('h2');
    if (title) {
      title.textContent = this.getAttribute('heading') || text.title;
    }
    const explanation = this.root.querySelector('.default-explanation');
    if (explanation) {
      explanation.textContent = text.explanation;
    }
    const action = this.root.querySelector<HTMLElement>('.default-action');
    if (action) {
      action.textContent = text.action?.label ?? '';
      action.hidden = !text.action;
    }
  }
}

if (!customElements.get('mk-empty-state')) {
  customElements.define('mk-empty-state', MkEmptyState);
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-empty-state': MkEmptyState;
  }
}
