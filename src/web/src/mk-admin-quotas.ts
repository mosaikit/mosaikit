// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { filterQuotas, quotaMetrics } from './admin-pages.js';
import { adminStyles } from './admin-styles.js';
import type { KernelClient, Quota } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';
import {
  QuotaBoard,
  formatAmount,
  limitLabel,
  periodLabel,
  personLabel,
  share,
  sourceLabel,
} from './quotas.js';

/**
 * The quotas of the organization, for its administrators (MK-076): what it keeps and uses of each
 * measure against its limit, and the consumption of a month by person. Platform administrators also
 * set the limits of the organization here. The behaviour is in {@link QuotaBoard}.
 */
@customElement('mk-admin-quotas')
export class MkAdminQuotas extends LitElement {
  static override readonly styles = [
    adminStyles,
    css`
      table {
        margin-bottom: 24px;
      }
      td.number {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .muted {
        color: var(--mk-muted);
        font-size: 13px;
      }
      meter {
        width: 100%;
        max-width: 220px;
        display: block;
      }
      .limit {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 6px;
      }
      label {
        font-weight: 600;
      }
      input,
      select,
      button:not(.link) {
        font: inherit;
        padding: 6px 8px;
        border-radius: var(--mk-radius);
        border: 1px solid var(--mk-line);
        background: var(--mk-surface);
        color: var(--mk-fg);
      }
      input {
        width: 9em;
      }
      button {
        cursor: pointer;
      }
      :focus-visible {
        outline: 2px solid var(--mk-focus);
        outline-offset: 2px;
      }
      .period {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 12px;
      }
      .status {
        min-height: 1.5em;
        color: var(--mk-muted);
      }
      .error {
        color: var(--mk-danger);
      }
    `,
  ];

  @property({ attribute: false }) client: KernelClient | undefined;
  /** The organization whose quotas are shown. */
  @property() organization: string | undefined;
  /** Whether the person sets the limits: platform administrators only. */
  @property({ type: Boolean }) platformAdmin = false;

  @state() private message = '';
  @state() private failed = false;
  @state() private search = '';
  /** The measure in the side pane. */
  @state() private selected: string | undefined;
  /** What platform administrators typed as limits, by measure. */
  @state() private drafts: Record<string, string> = {};

  private board: QuotaBoard | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.board = new QuotaBoard(this.client, this.organization, {
      changed: () => {
        this.requestUpdate();
      },
      announce: (message, failed) => {
        this.message = message;
        this.failed = failed;
      },
    });
    void this.board.load();
  }

  override render(): unknown {
    const board = this.board;
    const quotas = board?.quotas;
    const shown = filterQuotas(quotas ?? [], this.search);
    const selected = quotas?.find((quota) => quota.measure === this.selected);
    const usage = board?.usage;
    return html`
      <mk-admin-view
        heading=${t('Quotas')}
        description=${t(
          'What your organization keeps and uses of each measure, against its limit. The figures are current: they change with every action.',
        )}
        name="mosaikit.admin.quotas"
        .metrics=${quotaMetrics(quotas)}
        ?detail-open=${selected !== undefined}
        @mk-detail-close=${() => {
          this.selected = undefined;
        }}
      >
        <label slot="filters" class="filter"
          >${t('Search measures')}
          <input
            type="search"
            .value=${this.search}
            @input=${(event: Event) => {
              this.search = (event.target as HTMLInputElement).value;
            }}
        /></label>
        ${
          board && usage
            ? html`<label slot="filters" class="filter"
                >${t('Month')}
                <select
                  id="quota-period"
                  @change=${(event: Event) => {
                    void board.load((event.target as HTMLSelectElement).value);
                  }}
                >
                  ${board
                    .periods()
                    .map(
                      (period) =>
                        html`<option value=${period} ?selected=${period === usage.period}>
                          ${period}
                        </option>`,
                    )}
                </select></label
              >`
            : nothing
        }
        ${
          quotas === undefined
            ? nothing
            : shown.length === 0
              ? html`<p>${t('No measure matches the filters.')}</p>`
              : this.renderQuotas(shown)
        }
        ${this.renderUsage()}
        <aside slot="detail" class="pane" aria-label=${selected?.label ?? t('Detail')}>
          ${selected ? this.renderDetail(selected) : nothing}
        </aside>
      </mk-admin-view>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderQuotas(quotas: readonly Quota[]): unknown {
    return html`<table>
      <caption class="muted">
        ${t('Limits')}
      </caption>
      <thead>
        <tr>
          <th scope="col">${t('Measure')}</th>
          <th scope="col">${t('Used')}</th>
          <th scope="col">${t('Limit')}</th>
          <th scope="col"><span class="muted">${t('Share of the limit')}</span></th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${quotas.map((quota) => {
          const used = share(quota);
          return html`<tr class=${quota.measure === this.selected ? 'selected' : ''}>
            <th scope="row">
              <button
                type="button"
                class="link"
                aria-label=${t('Details of {name}', { name: quota.label })}
                @click=${() => {
                  this.selected = quota.measure;
                }}
              >
                ${quota.label}
              </button>
              <div class="muted">${quota.extension ?? t('Built in')}</div>
            </th>
            <td>
              ${formatAmount(quota.used, quota.unit)}
              <div class="muted">${periodLabel(quota.period)}</div>
            </td>
            <td>
              ${limitLabel(quota)}
              <div class="muted">${sourceLabel(quota.source)}</div>
            </td>
            <td>
              ${
                used === undefined
                  ? nothing
                  : html`<meter
                        min="0"
                        max="100"
                        low="80"
                        high="95"
                        optimum="0"
                        .value=${used}
                        aria-label=${t('{measure}: {share}% of the limit', {
                          measure: quota.label,
                          share: String(used),
                        })}
                      ></meter>
                      <span class="muted">${used}%</span>`
              }
            </td>
            <td>
              ${
                this.platformAdmin
                  ? html`<button
                      type="button"
                      aria-label=${t('Change the limit of {measure}', { measure: quota.label })}
                      @click=${() => {
                        this.selected = quota.measure;
                      }}
                    >
                      ${t('Change the limit')}
                    </button>`
                  : nothing
              }
            </td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  private renderDetail(quota: Quota): unknown {
    const rows = this.board?.rowsOf(quota.measure) ?? [];
    return html`<h2>${quota.label}</h2>
      <dl>
        <dt>${t('Measure')}</dt>
        <dd>${quota.measure}</dd>
        <dt>${t('Used')}</dt>
        <dd>${formatAmount(quota.used, quota.unit)} · ${periodLabel(quota.period)}</dd>
        <dt>${t('Limit')}</dt>
        <dd>${limitLabel(quota)} · ${sourceLabel(quota.source)}</dd>
        <dt>${t('Default of the platform')}</dt>
        <dd>${limitLabel({ ...quota, limit: quota.installationLimit })}</dd>
      </dl>
      ${this.platformAdmin ? this.renderLimitForm(quota) : nothing}
      <h2 id="measure-usage">${t('Consumption by person')}</h2>
      ${
        rows.length === 0
          ? html`<p class="muted">${t('Nothing used in this month.')}</p>`
          : html`<ul aria-labelledby="measure-usage">
              ${rows.map(
                (row) =>
                  html`<li>${personLabel(row)}: ${formatAmount(row.amount, quota.unit)}</li>`,
              )}
            </ul>`
      }`;
  }
  private renderLimitForm(quota: Quota): unknown {
    const id = `limit-${quota.measure.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    return html`<form
      class="limit"
      @submit=${(event: Event) => {
        event.preventDefault();
        void this.saveLimit(quota);
      }}
    >
      <label class="muted" for=${id}>${t('New limit')}</label>
      <input
        id=${id}
        spellcheck="false"
        placeholder=${quota.unit === 'bytes' ? '10G' : '1000'}
        .value=${this.drafts[quota.measure] ?? ''}
        @input=${(event: Event) => {
          this.drafts = {
            ...this.drafts,
            [quota.measure]: (event.target as HTMLInputElement).value,
          };
        }}
      />
      <button type="submit" aria-label=${t('Set the limit of {measure}', { measure: quota.label })}>
        ${t('Set')}
      </button>
      ${
        quota.source === 'organization'
          ? html`<button
              type="button"
              aria-label=${t('Use the default of the platform for {measure}', {
                measure: quota.label,
              })}
              @click=${() => void this.board?.removeLimit(quota)}
            >
              ${t('Use the default')}
            </button>`
          : nothing
      }
    </form>`;
  }

  private renderUsage(): unknown {
    const board = this.board;
    const usage = board?.usage;
    if (!board || !usage) {
      return nothing;
    }
    return html`<h2>${t('Consumption by person')}</h2>
      <p class="muted">
        ${t('In {month}, chosen above the table. Storage is shown as it is now.', {
          month: usage.period,
        })}
      </p>
      ${
        usage.rows.length === 0
          ? html`<p>${t('Nothing used in this month.')}</p>`
          : html`<table>
              <caption class="muted">
                ${t('Consumption by person')}
              </caption>
              <thead>
                <tr>
                  <th scope="col">${t('Measure')}</th>
                  <th scope="col">${t('Period')}</th>
                  <th scope="col">${t('Person')}</th>
                  <th scope="col">${t('Used')}</th>
                </tr>
              </thead>
              <tbody>
                ${usage.rows.map((row) => {
                  const measure = board.measure(row.measure);
                  return html`<tr>
                    <td>${measure?.label ?? row.measure}</td>
                    <td>${periodLabel(row.period)}</td>
                    <th scope="row">${personLabel(row)}</th>
                    <td class="number">${formatAmount(row.amount, measure?.unit ?? '')}</td>
                  </tr>`;
                })}
              </tbody>
            </table>`
      }`;
  }

  private async saveLimit(quota: Quota): Promise<void> {
    const saved = await this.board?.setLimit(quota, this.drafts[quota.measure] ?? '');
    if (saved) {
      this.drafts = { ...this.drafts, [quota.measure]: '' };
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-quotas': MkAdminQuotas;
  }
}
