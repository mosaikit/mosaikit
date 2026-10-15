// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { filterSettings, platformSettings, settingMetrics } from './admin-pages.js';
import { adminStyles } from './admin-styles.js';
import type { KernelClient, PlatformSettings } from './api.js';
import { t } from './i18n.js';
import './mk-admin-view.js';

/**
 * The settings of the platform for platform administrators (MK-048): whether people can create
 * their own account. Each change is saved at once and recorded in the audit log. On the model of the
 * administration pages (MK-072): metrics on top, filters above the table, the switch of each setting
 * on its row, and its detail in a side pane.
 */
@customElement('mk-admin-settings')
export class MkAdminSettings extends LitElement {
  static override readonly styles = [
    adminStyles,
    css`
      p.help {
        margin: 4px 0 0;
        color: var(--mk-muted);
        font-size: 14px;
        font-weight: normal;
      }
      /* A checkbox drawn as a switch, with the native semantics and keyboard of a checkbox. */
      input[role='switch'] {
        appearance: none;
        flex: none;
        width: 44px;
        height: 24px;
        margin: 2px 0 0;
        border-radius: 12px;
        background: var(--mk-line);
        position: relative;
        cursor: pointer;
        transition: background 0.15s;
      }
      input[role='switch']::after {
        content: '';
        position: absolute;
        top: 3px;
        left: 3px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #ffffff;
        transition: transform 0.15s;
      }
      input[role='switch']:checked {
        background: var(--mk-accent);
      }
      input[role='switch']:checked::after {
        transform: translateX(20px);
      }
      input[role='switch']:focus-visible {
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
      @media (prefers-reduced-motion: reduce) {
        input[role='switch'],
        input[role='switch']::after {
          transition: none;
        }
      }
    `,
  ];

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private settings: PlatformSettings | undefined;
  @state() private search = '';
  /** The setting in the side pane. */
  @state() private selected: string | undefined;
  @state() private message = '';
  @state() private failed = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.settings = await this.client?.platformSettings();
    } catch (error) {
      this.show(`The settings cannot be read: ${String(error)}`, true);
    }
  }

  override render(): unknown {
    const settings = platformSettings(this.settings);
    const shown = filterSettings(settings, this.search);
    const selected = settings.find((setting) => setting.id === this.selected);
    return html`
      <mk-admin-view
        heading=${t('Platform settings')}
        description=${t(
          'The settings of the whole installation. Each change is saved at once and recorded in the audit log.',
        )}
        name="mosaikit.admin.settings"
        .metrics=${settingMetrics(settings)}
        ?detail-open=${selected !== undefined}
        @mk-detail-close=${() => {
          this.selected = undefined;
        }}
      >
        <label slot="filters" class="filter"
          >${t('Search settings')}
          <input
            type="search"
            .value=${this.search}
            @input=${(event: Event) => {
              this.search = (event.target as HTMLInputElement).value;
            }}
        /></label>
        ${
          this.settings === undefined
            ? nothing
            : shown.length === 0
              ? html`<p>${t('No setting matches the filters.')}</p>`
              : html`<table aria-label=${t('Platform settings')}>
                  <thead>
                    <tr>
                      <th scope="col">${t('Setting')}</th>
                      <th scope="col">${t('State')}</th>
                      <th scope="col"><span class="muted">${t('Actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${shown.map(
                      (setting) =>
                        html`<tr class=${setting.id === this.selected ? 'selected' : ''}>
                          <th scope="row">
                            <button
                              type="button"
                              class="link"
                              aria-label=${t('Details of {name}', { name: setting.title })}
                              @click=${() => {
                                this.selected = setting.id;
                              }}
                            >
                              ${setting.title}
                            </button>
                            <p class="help" id=${`${setting.id}-help`}>${setting.description}</p>
                          </th>
                          <td>${setting.on ? t('On') : t('Off')}</td>
                          <td>
                            <input
                              id=${setting.id}
                              type="checkbox"
                              role="switch"
                              aria-label=${setting.title}
                              aria-describedby=${`${setting.id}-help`}
                              .checked=${setting.on}
                              @change=${this.toggleRegistration}
                            />
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>`
        }
        <aside slot="detail" class="pane" aria-label=${selected?.title ?? t('Detail')}>
          ${
            selected
              ? html`<h2>${selected.title}</h2>
                  <p>${selected.description}</p>
                  <dl>
                    <dt>${t('State')}</dt>
                    <dd>${selected.on ? t('On') : t('Off')}</dd>
                    <dt>${t('Recorded as')}</dt>
                    <dd>platform.settings.changed</dd>
                  </dl>`
              : nothing
          }
        </aside>
      </mk-admin-view>
      <p class="status ${this.failed ? 'error' : ''}" role="status" aria-live="polite">
        ${this.message}
      </p>
    `;
  }

  private readonly toggleRegistration = async (event: Event): Promise<void> => {
    const registration = (event.target as HTMLInputElement).checked;
    try {
      this.settings = await this.client?.changePlatformSettings({ registration });
      this.show(
        registration ? t('People can create their own account.') : t('Self-registration is off.'),
        false,
      );
    } catch (error) {
      this.show(`Not saved: ${String(error)}`, true);
      await this.load();
    }
  };

  private show(message: string, failed: boolean): void {
    this.message = message;
    this.failed = failed;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-settings': MkAdminSettings;
  }
}
