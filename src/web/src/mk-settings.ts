// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Preferences } from './api.js';
import { LANGUAGES, t } from './i18n.js';
import type { LauncherEntry } from './navigation.js';

/** A section that a plugin adds to the settings with the point settings.section (MK-027). */
export interface SettingsSection {
  readonly pluginId: string;
  readonly id: string;
  readonly title: string;
  /** Custom element that renders the section. */
  readonly element: string;
}

/** An app of the app bar, with whether the organization pinned it (MK-030). */
export interface BarApp {
  readonly entry: LauncherEntry;
  readonly pinned: boolean;
}

declare global {
  interface HTMLElementEventMap {
    'mk-preferences': CustomEvent<Preferences>;
  }
}

const APPEARANCES = [
  { value: 'system', label: 'As the device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'contrast', label: 'High contrast' },
] as const;

/**
 * The personal settings (MK-027): appearance, theme, language, the apps of the app bar and the
 * sections of the plugins. Each change goes at once to the shell, which saves and applies it.
 */
@customElement('mk-settings')
export class MkSettings extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 760px;
    }
    fieldset {
      margin: 0 0 20px;
      padding: 16px 20px;
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
      background: var(--mk-surface);
    }
    legend {
      padding: 0 6px;
      font-weight: 700;
    }
    .choices {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 20px;
    }
    label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    select {
      font: inherit;
      padding: 6px 8px;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
      color: var(--mk-fg);
    }
    input {
      accent-color: var(--mk-accent);
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    .apps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    .status {
      min-height: 1.5em;
      color: var(--mk-muted);
    }
  `;

  @property({ attribute: false }) preferences: Preferences | undefined;
  /** The themes the person can choose, besides the default of the installation. */
  @property({ attribute: false }) themes: readonly { id: string; title: string }[] = [];
  @property({ attribute: false }) apps: readonly BarApp[] = [];
  @property({ attribute: false }) sections: readonly SettingsSection[] = [];
  /** The kinds of notifications the person received, as `<plugin id>/<kind>` (MK-038). */
  @property({ attribute: false }) notificationKinds: readonly string[] = [];
  /** The organization switch of the shell, rendered in the page. */
  @property({ attribute: false }) organizations: unknown = nothing;
  @property() status = '';
  @property() language = 'en';

  override render(): unknown {
    const preferences = this.preferences;
    if (!preferences) {
      return nothing;
    }
    const appearance = preferences.appearance ?? 'system';
    const hidden = new Set(preferences.hiddenApps);
    return html`
      <h1>${t('Your settings')}</h1>
      <fieldset>
        <legend>${t('Appearance')}</legend>
        <div class="choices" role="radiogroup" aria-label=${t('Appearance')}>
          ${APPEARANCES.map(
            (choice) =>
              html`<label
                ><input
                  type="radio"
                  name="appearance"
                  .value=${choice.value}
                  .checked=${appearance === choice.value}
                  @change=${() => {
                    this.change({ ...preferences, appearance: choice.value });
                  }}
                />${t(choice.label)}</label
              >`,
          )}
        </div>
      </fieldset>
      <fieldset>
        <legend>${t('Theme')} · ${t('Language')}</legend>
        <div class="choices">
          <label
            >${t('Theme')}
            <select
              @change=${(event: Event) => {
                const theme = (event.target as HTMLSelectElement).value;
                this.change({ ...preferences, theme: theme || null });
              }}
            >
              <option value="" ?selected=${!preferences.theme}>
                ${t('Default of the installation')}
              </option>
              ${this.themes.map(
                (theme) =>
                  html`<option value=${theme.id} ?selected=${preferences.theme === theme.id}>
                    ${theme.title}
                  </option>`,
              )}
            </select></label
          >
          <label
            >${t('Language')}
            <select
              @change=${(event: Event) => {
                this.change({
                  ...preferences,
                  language: (event.target as HTMLSelectElement).value as Preferences['language'],
                });
              }}
            >
              ${LANGUAGES.map(
                (language) =>
                  html`<option
                    value=${language.code}
                    lang=${language.code}
                    ?selected=${(preferences.language ?? this.language) === language.code}
                  >
                    ${language.name}
                  </option>`,
              )}
            </select></label
          >
          ${this.organizations}
        </div>
      </fieldset>
      ${
        this.apps.length > 0
          ? html`<fieldset>
              <legend>${t('Apps in the app bar')}</legend>
              <ul class="apps">
                ${this.apps.map(({ entry, pinned }) => {
                  const key = `${entry.pluginId}/${entry.id}`;
                  return html`<li>
                    <label
                      ><input
                        type="checkbox"
                        .checked=${pinned || !hidden.has(key)}
                        ?disabled=${pinned}
                        aria-describedby=${pinned ? `pinned-${entry.id}` : nothing}
                        @change=${(event: Event) => {
                          const shown = (event.target as HTMLInputElement).checked;
                          const others = preferences.hiddenApps.filter((app) => app !== key);
                          this.change({
                            ...preferences,
                            hiddenApps: shown ? others : [...others, key],
                          });
                        }}
                      />${entry.title}</label
                    >
                    ${
                      pinned
                        ? html`<span id=${`pinned-${entry.id}`} class="muted"
                            >${t('Pinned by your organization')}</span
                          >`
                        : nothing
                    }
                  </li>`;
                })}
              </ul>
            </fieldset>`
          : nothing
      }
      ${
        this.notificationKinds.length > 0
          ? html`<fieldset>
              <legend>${t('Notifications')}</legend>
              <ul class="apps">
                ${this.notificationKinds.map((kind) => {
                  const muted = (preferences.mutedNotifications ?? []).includes(kind);
                  return html`<li>
                    <label
                      ><input
                        type="checkbox"
                        .checked=${!muted}
                        @change=${(event: Event) => {
                          const wanted = (event.target as HTMLInputElement).checked;
                          const others = (preferences.mutedNotifications ?? []).filter(
                            (other) => other !== kind,
                          );
                          this.change({
                            ...preferences,
                            mutedNotifications: wanted ? others : [...others, kind],
                          });
                        }}
                      />${kind.slice(kind.lastIndexOf('/') + 1)}
                      <span class="muted">${kind.slice(0, kind.lastIndexOf('/'))}</span></label
                    >
                  </li>`;
                })}
              </ul>
            </fieldset>`
          : nothing
      }
      ${this.sections.map(
        (section) =>
          html`<fieldset>
            <legend>${section.title}</legend>
            <div class="section" data-section=${`${section.pluginId}/${section.id}`}></div>
          </fieldset>`,
      )}
      <p class="status" role="status" aria-live="polite">${this.status}</p>
    `;
  }

  /** Mounts the custom element of each section of a plugin in its place. */
  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    // A section reads context.locale when it connects: a new language mounts it again.
    const remount = changed.has('language') && changed.get('language') !== undefined;
    for (const section of this.sections) {
      const host = this.renderRoot.querySelector<HTMLElement>(
        `[data-section="${section.pluginId}/${section.id}"]`,
      );
      if (host && (remount || host.firstElementChild?.localName !== section.element)) {
        host.replaceChildren(document.createElement(section.element));
      }
    }
  }

  private change(preferences: Preferences): void {
    this.dispatchEvent(
      new CustomEvent('mk-preferences', { detail: preferences, bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-settings': MkSettings;
  }
}
