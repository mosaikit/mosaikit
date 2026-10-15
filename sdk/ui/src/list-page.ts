// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  MEDIUM_BREAKPOINT,
  countOf,
  filtersButtonText,
  labelsOf,
  listLayout,
  withCount,
  type ListLayout,
  type PatternLabels,
} from './patterns.js';

const NARROW = `@container mk-list-page (max-width: ${String(MEDIUM_BREAKPOINT - 1)}px)`;

const TEMPLATE = `
<style>
  :host {
    display: block;
    height: 100%;
    min-height: 0;
    container: mk-list-page / inline-size;
    color: var(--mk-fg);
    font-family: var(--mk-font, inherit);
  }
  :host([hidden]),
  [hidden] { display: none !important; }
  .page { display: flex; height: 100%; min-height: 0; position: relative; }
  .facets {
    flex: none;
    width: 264px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
    padding: 14px 16px 12px;
    box-sizing: border-box;
    border-right: 1px solid var(--mk-line);
    background: var(--mk-bg);
  }
  .facets-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .facets-head b { font-weight: 600; }
  .close, .filters-button, .scrim { display: none; }
  .content { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-height: 56px;
    padding: 8px 24px;
    box-sizing: border-box;
    background: var(--mk-bg);
    border-bottom: 1px solid var(--mk-line);
  }
  .title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .heading { margin: 0; font-size: 1.15rem; font-weight: 600; }
  .count { color: var(--mk-muted); font-variant-numeric: tabular-nums; }
  .selection {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 12px;
    border-left: 1px solid var(--mk-line);
  }
  .selected { font-weight: 600; color: var(--mk-accent); white-space: nowrap; }
  .spacer { flex: 1; }
  .layout { display: inline-flex; gap: 2px; }
  .items { flex: 1; min-height: 0; overflow: auto; padding: 16px 24px 24px; }
  .items[data-layout='rows'] { display: flex; flex-direction: column; gap: 4px; }
  .items[data-layout='grid'] {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--mk-list-card-width, 240px), 1fr));
    align-content: start;
    gap: 12px;
  }
  .badge {
    display: inline-block;
    min-width: 18px;
    margin-left: 6px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 9px;
    font-size: 12px;
    line-height: 18px;
    text-align: center;
    color: var(--mk-accent-fg);
    background: var(--mk-accent);
  }
  ${NARROW} {
    .facets { display: none; }
    .filters-button { display: inline-flex; }
    .head { padding: 8px 16px; }
    .items { padding: 12px 16px 24px; }
    :host([facets-open]) .facets {
      display: flex;
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 4;
      width: min(300px, 86%);
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
    }
    :host([facets-open]) .close { display: inline-flex; }
    :host([facets-open]) .scrim {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 3;
      background: rgb(5 10 18 / 0.35);
    }
  }
</style>
<div class="page">
  <aside class="facets" part="facets" id="facets">
    <div class="facets-head">
      <b class="facets-title"></b>
      <fluent-button role="button" class="close" appearance="subtle" size="small"></fluent-button>
    </div>
    <slot name="facets"></slot>
  </aside>
  <div class="scrim" part="scrim"></div>
  <section class="content">
    <header class="head" part="header">
      <fluent-button role="button" class="filters-button" aria-controls="facets" aria-expanded="false"
        ><span class="filters-text"></span><span class="badge" aria-hidden="true"></span
      ></fluent-button>
      <div class="title">
        <span class="heading" role="heading" part="heading"></span>
        <span class="count" part="count"></span>
      </div>
      <div class="selection" part="selection" role="group" hidden>
        <span class="selected"></span>
        <slot name="bulk-actions"></slot>
        <fluent-button role="button" class="clear" appearance="subtle"></fluent-button>
      </div>
      <span class="spacer"></span>
      <div class="layout" role="group" part="layout">
        <fluent-button role="button" class="to-grid" appearance="subtle" data-layout="grid"></fluent-button>
        <fluent-button role="button" class="to-rows" appearance="subtle" data-layout="rows"></fluent-button>
      </div>
      <slot name="actions"></slot>
    </header>
    <div class="items" part="items"><slot></slot></div>
  </section>
</div>
`;

/**
 * `<mk-list-page>`: the page of an app that lists resources (MK-105, ADR-0039). The facets go in
 * the slot `facets`, a side column that, below the medium breakpoint, opens from a button showing
 * the number of active filters (`active-filters`). The fixed header has the `heading`, the `count`
 * and the slot `actions`; the items, in the default slot, are laid out as a `grid` of cards or as
 * `rows` (`layout`, which the person switches: event `mk-layout-change`). When `selected` is above
 * zero, the header shows the bar of the bulk actions the app puts in the slot `bulk-actions`, with
 * the number selected and a button that dispatches `mk-selection-clear`.
 */
export class MkListPage extends HTMLElement {
  static readonly observedAttributes = [
    'heading',
    'count',
    'layout',
    'selected',
    'active-filters',
    'level',
  ];

  private readonly root: ShadowRoot;
  private given: Partial<PatternLabels> | undefined;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = TEMPLATE;
    this.el('.filters-button').addEventListener('click', () => {
      this.facetsOpen = !this.facetsOpen;
    });
    this.el('.close').addEventListener('click', () => {
      this.facetsOpen = false;
    });
    this.el('.scrim').addEventListener('click', () => {
      this.facetsOpen = false;
    });
    this.root.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape' && this.facetsOpen) {
        this.facetsOpen = false;
        this.el('.filters-button').focus();
      }
    });
    this.el('.clear').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('mk-selection-clear', { bubbles: true, composed: true }));
    });
    for (const button of this.root.querySelectorAll<HTMLElement>('.layout [data-layout]')) {
      button.addEventListener('click', () => {
        const layout = listLayout(button.dataset.layout);
        if (layout !== this.layout) {
          this.layout = layout;
          this.dispatchEvent(
            new CustomEvent('mk-layout-change', {
              detail: { layout },
              bubbles: true,
              composed: true,
            }),
          );
        }
      });
    }
  }

  /** The texts of the page in another language than English. */
  get labels(): PatternLabels {
    return labelsOf(this.given);
  }

  set labels(labels: Partial<PatternLabels> | undefined) {
    this.given = labels;
    this.render();
  }

  get layout(): ListLayout {
    return listLayout(this.getAttribute('layout'));
  }

  set layout(layout: ListLayout) {
    this.setAttribute('layout', layout);
  }

  /** Whether the facets are open over the page, below the medium breakpoint. */
  get facetsOpen(): boolean {
    return this.hasAttribute('facets-open');
  }

  set facetsOpen(open: boolean) {
    this.toggleAttribute('facets-open', open);
    this.render();
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(): void {
    this.render();
  }

  private el(selector: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(selector) as HTMLElement;
  }

  private render(): void {
    const labels = this.labels;
    const heading = this.getAttribute('heading') ?? '';
    const active = countOf(this.getAttribute('active-filters'));
    const selected = countOf(this.getAttribute('selected'));
    const layout = this.layout;

    const title = this.el('.heading');
    title.textContent = heading;
    title.setAttribute('aria-level', String(countOf(this.getAttribute('level')) || 1));
    this.el('.count').textContent = this.getAttribute('count') ?? '';

    this.el('.facets').setAttribute('aria-label', labels.filters);
    this.el('.facets-title').textContent = labels.filters;
    const close = this.el('.close');
    close.textContent = '×';
    close.setAttribute('aria-label', labels.closeFilters);

    const button = this.el('.filters-button');
    button.setAttribute('aria-expanded', String(this.facetsOpen));
    button.setAttribute('aria-label', filtersButtonText(active, labels));
    this.el('.filters-text').textContent = labels.filters;
    const badge = this.el('.badge');
    badge.textContent = String(active);
    badge.hidden = active === 0;

    const selection = this.el('.selection');
    selection.hidden = selected === 0;
    selection.setAttribute('aria-label', withCount(labels.selected, selected));
    this.el('.selected').textContent = withCount(labels.selected, selected);
    this.el('.clear').textContent = labels.clearSelection;

    this.el('.layout').setAttribute('aria-label', `${labels.grid} / ${labels.rows}`);
    for (const [selector, value, text] of [
      ['.to-grid', 'grid', labels.grid],
      ['.to-rows', 'rows', labels.rows],
    ] as const) {
      const toggle = this.el(selector);
      toggle.textContent = text;
      toggle.setAttribute('aria-pressed', String(layout === value));
    }
    this.el('.items').dataset.layout = layout;
  }
}

if (!customElements.get('mk-list-page')) {
  customElements.define('mk-list-page', MkListPage);
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-list-page': MkListPage;
  }
}
