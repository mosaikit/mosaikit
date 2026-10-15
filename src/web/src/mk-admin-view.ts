// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Metric } from './admin-view.js';
import { t } from './i18n.js';

/**
 * The one model of the administration pages (MK-072, ADR-0039): the title and the actions of the
 * page, its metrics on top, the filters above the table, the table with the actions of each row, and
 * the detail of a row in a side pane that the person resizes (`<mk-split-pane>` of MK-105). The page
 * owns the data; this element lays it out:
 *
 * ```html
 * <mk-admin-view heading="Organizations" .metrics=${metrics} detail-open>
 *   <button slot="actions">New organization</button>
 *   <label slot="filters">Search <input type="search" /></label>
 *   <table>…</table>
 *   <aside slot="detail" aria-label="Acme">…</aside>
 * </mk-admin-view>
 * ```
 *
 * The page names the detail with its own landmark (an `aside` with a label), so that its content
 * belongs to it; the close button of the pane dispatches `mk-detail-close`.
 */
@customElement('mk-admin-view')
export class MkAdminView extends LitElement {
  static override readonly styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-height: 0;
    }
    header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px 16px;
    }
    h1 {
      margin: 0;
    }
    .description {
      margin: 4px 0 0;
      max-width: 72ch;
      color: var(--mk-muted);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .metric {
      display: grid;
      gap: 2px;
      padding: 12px 14px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
    }
    .metric .label {
      font-size: 13px;
      color: var(--mk-muted);
    }
    .metric .value {
      font-size: 1.5rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .metric .note {
      font-size: 13px;
      color: var(--mk-muted);
    }
    .metric[data-tone='ok'] {
      border-left: 4px solid var(--mk-success, var(--mk-accent));
    }
    .metric[data-tone='warn'] {
      border-left: 4px solid var(--mk-warning, var(--mk-accent));
    }
    .metric[data-tone='problem'] {
      border-left: 4px solid var(--mk-danger);
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 8px 16px;
    }
    .body {
      display: flex;
      min-height: 0;
      min-width: 0;
    }
    .table {
      flex: 1;
      min-width: 0;
      overflow: auto;
    }
    mk-split-pane {
      flex: 1;
      min-width: 0;
    }
    mk-split-pane .table {
      padding-right: 8px;
    }
    .detail {
      position: relative;
      min-height: 100%;
      box-sizing: border-box;
      padding: 16px 20px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
      margin-left: 8px;
    }
    .close {
      position: absolute;
      top: 8px;
      right: 8px;
      font: inherit;
      padding: 2px 8px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
      cursor: pointer;
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    @media (max-width: 720px) {
      .body.open {
        flex-direction: column;
      }
    }
  `;

  /** The title of the page. */
  @property() heading = '';

  /** What the page is for, below the title. */
  @property() description = '';

  /** The metrics on top. */
  @property({ attribute: false }) metrics: readonly Metric[] = [];

  /** Whether the side pane shows the detail of a row. */
  @property({ type: Boolean, attribute: 'detail-open', reflect: true }) detailOpen = false;

  /** Names the pane in the installation, so that its width is kept for the next visit. */
  @property() name = '';

  override render(): unknown {
    return html`
      <header>
        <div>
          <h1>${this.heading}</h1>
          ${this.description ? html`<p class="description">${this.description}</p>` : nothing}
        </div>
        <div class="actions"><slot name="actions"></slot></div>
      </header>
      ${
        this.metrics.length > 0
          ? html`<ul class="metrics" aria-label=${t('Metrics')}>
              ${this.metrics.map(
                (metric) =>
                  html`<li class="metric" data-tone=${metric.tone ?? nothing}>
                    <span class="label">${metric.label}</span>
                    <span class="value">${metric.value}</span>
                    ${metric.note ? html`<span class="note">${metric.note}</span>` : nothing}
                  </li>`,
              )}
            </ul>`
          : nothing
      }
      <div class="filters" role="search" aria-label=${t('Filters')}>
        <slot name="filters"></slot>
      </div>
      <div class="body ${this.detailOpen ? 'open' : ''}">
        ${
          this.detailOpen
            ? html`<mk-split-pane
                name=${this.name || nothing}
                width="560"
                min="320"
                max="1400"
                label=${t('Resize the table and the detail')}
              >
                <div class="table" slot="pane"><slot></slot></div>
                <div class="detail">
                  <button
                    type="button"
                    class="close"
                    aria-label=${t('Close the detail')}
                    @click=${() => {
                      this.dispatchEvent(
                        new CustomEvent('mk-detail-close', { bubbles: true, composed: true }),
                      );
                    }}
                  >
                    ×
                  </button>
                  <slot name="detail"></slot>
                </div>
              </mk-split-pane>`
            : html`<div class="table"><slot></slot></div>`
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-view': MkAdminView;
  }
}
