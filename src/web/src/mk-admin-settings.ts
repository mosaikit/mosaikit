// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { KernelClient, PlatformSettings } from './api.js';
import { t } from './i18n.js';

/**
 * The settings of the platform for platform administrators (MK-048): whether people can create
 * their own account. Each change is saved at once and recorded in the audit log.
 */
@customElement('mk-admin-settings')
export class MkAdminSettings extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 720px;
    }
    .setting {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      padding: 16px 20px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
    }
    .setting label {
      font-weight: 600;
    }
    .setting p {
      margin: 4px 0 0;
      color: var(--mk-muted);
      font-size: 14px;
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
  `;

  @property({ attribute: false }) client: KernelClient | undefined;

  @state() private settings: PlatformSettings | undefined;
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
    return html`
      <h1>${t('Platform settings')}</h1>
      ${
        this.settings
          ? html`<div class="setting">
              <div>
                <label for="registration">${t('People can create their own account')}</label>
                <p id="registration-help">
                  ${t(
                    'On the sign-in page, in the organizations that allow it. A link sent by mail confirms the address before the first sign-in.',
                  )}
                </p>
              </div>
              <input
                id="registration"
                type="checkbox"
                role="switch"
                aria-describedby="registration-help"
                .checked=${this.settings.registration}
                @change=${this.toggleRegistration}
              />
            </div>`
          : nothing
      }
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
