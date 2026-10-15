// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  DEFAULT_LABELS,
  clampWidth,
  countOf,
  readPaneWidth,
  widthAfterKey,
  writePaneWidth,
  type PaneBounds,
  type PaneStorage,
} from './patterns.js';

const TEMPLATE = `
<style>
  :host { display: flex; min-height: 0; min-width: 0; }
  :host([hidden]) { display: none; }
  .pane { flex: none; min-width: 0; overflow: auto; }
  .rest { flex: 1; min-width: 0; overflow: auto; }
  .handle {
    flex: none;
    width: 6px;
    margin: 0 -3px;
    position: relative;
    z-index: 1;
    cursor: col-resize;
    touch-action: none;
    background: linear-gradient(var(--mk-line), var(--mk-line)) center / 1px 100% no-repeat;
  }
  .handle:hover, .handle.dragging { background-color: var(--mk-accent-soft); }
  .handle:focus-visible { outline: 2px solid var(--mk-focus); outline-offset: -2px; }
</style>
<div class="pane" part="pane"><slot name="pane"></slot></div>
<div class="handle" part="handle" role="separator" aria-orientation="vertical" tabindex="0"></div>
<div class="rest" part="rest"><slot></slot></div>
`;

function storageOfPage(): PaneStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * `<mk-split-pane>`: a list pane (slot `pane`) beside the rest of the app, with a handle that the
 * person drags, or moves with the arrow keys, Home and End (MK-105). `name` names the pane within
 * the installation (for example `notes.list`): the width the person leaves is kept in the browser
 * and comes back at the next visit. `width` is the starting width, `min` and `max` the bounds, in
 * pixels. Each change dispatches `mk-pane-resize` with `{ width }`.
 */
export class MkSplitPane extends HTMLElement {
  static readonly observedAttributes = ['width', 'min', 'max', 'name', 'label'];

  /** Where the widths are kept; the storage of the page unless a test gives its own. */
  storage: PaneStorage | undefined = storageOfPage();

  private readonly root: ShadowRoot;
  private current: number | undefined;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = TEMPLATE;
    const handle = this.handle;
    handle.addEventListener('keydown', (event) => {
      const width = widthAfterKey(this.width, event.key, this.bounds, event.shiftKey);
      if (width !== undefined) {
        event.preventDefault();
        this.resize(width);
      }
    });
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      const start = event.clientX;
      const from = this.width;
      const rtl = getComputedStyle(this).direction === 'rtl';
      const move = (moved: PointerEvent): void => {
        const delta = (moved.clientX - start) * (rtl ? -1 : 1);
        this.resize(from + delta);
      };
      const stop = (): void => {
        handle.classList.remove('dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    });
  }

  /** The bounds of the pane: `min` (default 160) and `max` (default 640) pixels. */
  get bounds(): PaneBounds {
    return {
      min: countOf(this.getAttribute('min')) || 160,
      max: countOf(this.getAttribute('max')) || 640,
    };
  }

  /** The width of the pane now, in pixels. */
  get width(): number {
    return this.current ?? this.initialWidth();
  }

  connectedCallback(): void {
    this.current = undefined;
    this.apply(this.initialWidth());
  }

  attributeChangedCallback(): void {
    this.apply(this.width);
  }

  /** Sets the width of the pane, within its bounds, and keeps it for the next visit. */
  resize(width: number): void {
    const next = clampWidth(width, this.bounds);
    if (next === this.current) {
      return;
    }
    this.current = next;
    this.apply(next);
    const name = this.getAttribute('name');
    if (name) {
      writePaneWidth(this.storage, name, next);
    }
    this.dispatchEvent(
      new CustomEvent('mk-pane-resize', { detail: { width: next }, bubbles: true, composed: true }),
    );
  }

  private get handle(): HTMLElement {
    return this.root.querySelector<HTMLElement>('.handle') as HTMLElement;
  }

  private initialWidth(): number {
    const name = this.getAttribute('name');
    const stored = name ? readPaneWidth(this.storage, name, this.bounds) : undefined;
    return stored ?? clampWidth(countOf(this.getAttribute('width')) || 320, this.bounds);
  }

  private apply(width: number): void {
    const pane = this.root.querySelector<HTMLElement>('.pane');
    if (pane) {
      pane.style.width = `${String(width)}px`;
    }
    const bounds = this.bounds;
    const handle = this.handle;
    handle.setAttribute('aria-label', this.getAttribute('label') || DEFAULT_LABELS.resize);
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuemin', String(bounds.min));
    handle.setAttribute('aria-valuemax', String(bounds.max));
  }
}

if (!customElements.get('mk-split-pane')) {
  customElements.define('mk-split-pane', MkSplitPane);
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-split-pane': MkSplitPane;
  }
}
