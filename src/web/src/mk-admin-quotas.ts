// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, Quota } from './api.js';
import { t } from './i18n.js';
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
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 960px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--mk-surface);
      margin-bottom: 24px;
    }
    th,
    td {
      text-align: left;
      padding: 8px 10px;
      border-top: 1px solid var(--mk-line);
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th {
      font-size: 13px;
      color: var(--mk-muted);
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
    button {
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
  `;

  @property({ attribute: false }) client: KernelClient | undefined;
  /** The organization whose quotas are shown. */
  @property() organization: string | undefined;
  /** Whether the person sets the limits: platform administrators only. */
  @property({ type: Boolean }) platformAdmin = false;

  @state() private message = '';
  @state() private failed = false;
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
    const quotas = this.board?.quotas;
    return html`
      <h1>${t('Quotas')}</h1>
      <p>
        ${t(
          'What your organization keeps and uses of each measure, against its limit. The figures are current: they change with every action.',
        )}
      </p>
      ${quotas === undefined ? nothing : this.renderQuotas(quotas)} ${this.renderUsage()}
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
        </tr>
      </thead>
      <tbody>
        ${quotas.map((quota) => {
          const used = share(quota);
          return html`<tr>
            <th scope="row">
              ${quota.label}
              <div class="muted">${quota.extension ?? t('Built in')}</div>
            </th>
            <td>
              ${formatAmount(quota.used, quota.unit)}
              <div class="muted">${periodLabel(quota.period)}</div>
            </td>
            <td>
              ${limitLabel(quota)}
              <div class="muted">${sourceLabel(quota.source)}</div>
              ${this.platformAdmin ? this.renderLimitForm(quota) : nothing}
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
          </tr>`;
        })}
      </tbody>
    </table>`;
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
      <div class="period">
        <label for="quota-period">${t('Month')}</label>
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
        </select>
        <span class="muted">${t('Storage is shown as it is now.')}</span>
      </div>
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
