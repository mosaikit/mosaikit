// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, TrashedResource } from './api.js';
import { t } from './i18n.js';
import { when } from './sessions.js';
import { TrashList, describe } from './trash.js';

/**
 * The trash of the person (MK-095): the resources of extensions they deleted, which they restore,
 * with their shares, or delete for good; an administrator also sees those of the whole organization.
 * The behaviour is in {@link TrashList}.
 */
@customElement('mk-trash')
export class MkTrash extends LitElement {
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
    tbody th {
      font-size: inherit;
      color: var(--mk-fg);
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    button {
      font: inherit;
      padding: 6px 8px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
      cursor: pointer;
    }
    button.danger {
      border-color: var(--mk-danger);
      color: var(--mk-danger);
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .scope {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 16px;
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
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
  /** Whether the person administers the organization, and so may see its whole trash. */
  @property({ type: Boolean }) administrator = false;

  @state() private message = '';
  @state() private failed = false;

  private list: TrashList | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.list = new TrashList(
      this.client,
      {
        changed: () => {
          this.requestUpdate();
        },
        announce: (message, failed) => {
          this.message = message;
          this.failed = failed;
        },
      },
      when,
    );
    void this.list.load();
  }

  override render(): unknown {
    const resources = this.list?.resources;
    const whole = this.list?.wholeOrganization ?? false;
    return html`
      <h1>${t('Trash')}</h1>
      <p>
        ${t(
          'What you delete in the apps stays here for a while, with what was inside it: restore it, with its shares, or delete it for good. After the retention of the installation it is deleted for good.',
        )}
      </p>
      ${
        this.administrator
          ? html`<div class="scope">
              <input
                type="checkbox"
                id="whole"
                .checked=${whole}
                @change=${(event: Event) =>
                  void this.list?.show((event.target as HTMLInputElement).checked)}
              />
              <label for="whole">${t('Show the trash of the whole organization')}</label>
            </div>`
          : nothing
      }
      ${
        resources === undefined
          ? nothing
          : resources.length === 0
            ? html`<p>${t('The trash is empty.')}</p>`
            : this.renderTable(resources, whole)
      }
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message || nothing}
      </p>
    `;
  }

  private renderTable(resources: readonly TrashedResource[], whole: boolean): unknown {
    return html`<table>
      <thead>
        <tr>
          <th scope="col">${t('Name')}</th>
          <th scope="col">${t('Kind')}</th>
          ${whole ? html`<th scope="col">${t('Owner')}</th>` : nothing}
          <th scope="col">${t('Deleted')}</th>
          <th scope="col"><span class="muted">${t('Actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${resources.map(
          (resource) =>
            html`<tr>
              <th scope="row">${resource.title}</th>
              <td>${describe(resource)}</td>
              ${whole ? html`<td>${resource.ownerName ?? t('The organization')}</td>` : nothing}
              <td>
                ${when(resource.trashedAt)}
                ${resource.trashedByName ? html`<span class="muted">${resource.trashedByName}</span>` : nothing}
                <div class="muted">${this.list?.deletedOn(resource)}</div>
              </td>
              <td>
                <div class="actions">
                  <button
                    type="button"
                    aria-label=${t('Restore {title}', { title: resource.title })}
                    @click=${() => void this.list?.restore(resource)}
                  >
                    ${t('Restore')}
                  </button>
                  <button
                    type="button"
                    class="danger"
                    aria-label=${t('Delete {title} for good', { title: resource.title })}
                    @click=${() => {
                      if (
                        confirm(
                          t('Delete {title} for good? It cannot be restored any more.', {
                            title: resource.title,
                          }),
                        )
                      ) {
                        void this.list?.remove(resource);
                      }
                    }}
                  >
                    ${t('Delete for good')}
                  </button>
                </div>
              </td>
            </tr>`,
        )}
      </tbody>
    </table>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-trash': MkTrash;
  }
}
