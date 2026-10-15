// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { themeDefinition } from '@mosaikit/ui';
import {
  BRAND_IMAGES,
  type BrandImageKind,
  type Branding,
  type BrandingDraft,
  type KernelClient,
} from './api.js';
import {
  BrandingEditor,
  TOKENS,
  accentTooLight,
  imageOf,
  tokenValue,
  type Scheme,
  type Token,
} from './branding.js';
import { t } from './i18n.js';

declare global {
  interface HTMLElementEventMap {
    /** A draft of the branding to show on the open application; `undefined` ends the preview. */
    'mk-branding-preview': CustomEvent<BrandingDraft | undefined>;
    /** The branding of the organization was saved. */
    'mk-branding-changed': CustomEvent<Branding>;
  }
}

const TOKEN_NAMES: Record<Token, string> = {
  background: 'Background',
  surface: 'Surface',
  foreground: 'Text',
  muted: 'Secondary text',
  line: 'Lines',
  danger: 'Danger',
  success: 'Success',
  warning: 'Warning',
  focus: 'Focus ring',
};

const IMAGE_NAMES: Record<BrandImageKind, string> = {
  logo: 'Logo for light backgrounds',
  'logo-dark': 'Logo for dark backgrounds',
  icon: 'Icon',
  favicon: 'Favicon',
};

const ACCEPT =
  'image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,.ico,.svg';

/**
 * The branding of the organization, for its administrators (MK-074): the display name, the accent
 * color and the tokens of the theme, shown on the open application as they change and saved on
 * request, and the logos, the icon and the favicon. The behaviour is in {@link BrandingEditor}.
 */
@customElement('mk-admin-branding')
export class MkAdminBranding extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
      max-width: 900px;
    }
    section {
      display: grid;
      gap: 12px;
      padding: 16px 20px;
      margin-bottom: 20px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
    }
    h2 {
      margin: 0;
      font-size: 18px;
    }
    .field {
      display: grid;
      gap: 4px;
    }
    label {
      font-weight: 600;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      text-align: left;
      padding: 6px 8px;
      border-top: 1px solid var(--mk-line);
    }
    th {
      font-size: 13px;
      color: var(--mk-muted);
    }
    input,
    button {
      font: inherit;
      padding: 6px 8px;
      border-radius: var(--mk-radius);
      border: 1px solid var(--mk-line);
      background: var(--mk-surface);
      color: var(--mk-fg);
    }
    input[type='color'] {
      width: 48px;
      height: 32px;
      padding: 2px;
    }
    button {
      cursor: pointer;
    }
    button.primary {
      border-color: var(--mk-accent);
      background: var(--mk-accent);
      color: var(--mk-accent-fg);
      font-weight: 600;
    }
    :focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    .images {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }
    .image {
      display: grid;
      gap: 6px;
      align-content: start;
    }
    .preview {
      display: grid;
      place-items: center;
      height: 72px;
      border: 1px dashed var(--mk-line);
      border-radius: var(--mk-radius);
      color: var(--mk-muted);
      font-size: 13px;
    }
    .preview.dark {
      background: var(--mk-brand);
      color: #ffffff;
    }
    .preview img {
      max-width: 90%;
      max-height: 56px;
    }
    .muted {
      color: var(--mk-muted);
      font-size: 13px;
    }
    .status {
      min-height: 1.5em;
      color: var(--mk-muted);
    }
    .error,
    .warning {
      color: var(--mk-danger);
    }
  `;

  @property({ attribute: false }) client: KernelClient | undefined;
  /** The slug of the organization. */
  @property() organization: string | undefined;
  /** The theme of the installation, under the colors of the organization. */
  @property() base = 'mosaikit';

  @state() private message = '';
  @state() private failed = false;

  private editor: BrandingEditor | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.editor = new BrandingEditor(this.client, this.organization, {
      changed: () => {
        this.requestUpdate();
      },
      announce: (message, failed) => {
        this.message = message;
        this.failed = failed;
      },
      preview: (draft) => {
        this.dispatchEvent(
          new CustomEvent('mk-branding-preview', { detail: draft, bubbles: true, composed: true }),
        );
      },
      saved: (branding) => {
        this.dispatchEvent(
          new CustomEvent('mk-branding-changed', {
            detail: branding,
            bubbles: true,
            composed: true,
          }),
        );
      },
    });
    void this.editor.load();
  }

  override render(): unknown {
    const editor = this.editor;
    if (!editor) {
      return nothing;
    }
    const draft = editor.draft;
    return html`
      <h1>${t('Branding')}</h1>
      <p>
        ${t(
          'The name, the colors and the images of your organization, on its sign-in page and in the shell of its members. A person who chooses another theme in the settings keeps it.',
        )}
      </p>
      <p class="muted">
        ${t('The sign-in page of the organization: {address}', {
          address: `${location.origin}/?organization=${this.organization ?? ''}`,
        })}
      </p>
      <section aria-labelledby="branding-name">
        <h2 id="branding-name">${t('Name and color')}</h2>
        <div class="field">
          <label for="display-name">${t('Display name')}</label>
          <input
            id="display-name"
            maxlength="100"
            .value=${draft.displayName ?? ''}
            @input=${(event: Event) => {
              editor.setName((event.target as HTMLInputElement).value);
            }}
          />
        </div>
        <div class="field">
          <label for="accent">${t('Accent color')}</label>
          <div class="row">
            <input
              id="accent"
              type="color"
              .value=${draft.accent ?? themeDefinition(this.base).light.brand}
              @input=${(event: Event) => {
                editor.setAccent((event.target as HTMLInputElement).value);
              }}
            />
            <span>${draft.accent ?? t('The color of the installation')}</span>
            ${
              draft.accent
                ? html`<button
                    type="button"
                    @click=${() => {
                      editor.setAccent(null);
                    }}
                  >
                    ${t('Use the color of the installation')}
                  </button>`
                : nothing
            }
          </div>
          ${
            accentTooLight(draft.accent)
              ? html`<p class="warning">
                  ${t('White text on this color is hard to read: choose a darker one.')}
                </p>`
              : nothing
          }
        </div>
      </section>
      <section aria-labelledby="branding-tokens">
        <h2 id="branding-tokens">${t('Theme tokens')}</h2>
        <p class="muted">
          ${t('Every change shows at once on the application; nobody else sees it before you save.')}
        </p>
        ${this.renderTokens('light')} ${this.renderTokens('dark')}
        <div class="row">
          <button type="button" class="primary" ?disabled=${!editor.dirty} @click=${this.save}>
            ${t('Save')}
          </button>
          <button type="button" ?disabled=${!editor.dirty} @click=${this.discard}>
            ${t('Discard changes')}
          </button>
        </div>
      </section>
      <section aria-labelledby="branding-images">
        <h2 id="branding-images">${t('Images')}</h2>
        <p class="muted">${t('PNG, JPEG, WebP, ICO or SVG, up to 2 MB.')}</p>
        <div class="images">${BRAND_IMAGES.map((kind) => this.renderImage(kind))}</div>
      </section>
      <p class="status ${this.failed ? 'error' : ''}" role="status">${this.message}</p>
    `;
  }

  private renderTokens(scheme: Scheme): unknown {
    const editor = this.editor;
    if (!editor) {
      return nothing;
    }
    const caption = scheme === 'light' ? t('Light scheme') : t('Dark scheme');
    return html`<table>
      <caption>
        ${caption}
      </caption>
      <thead>
        <tr>
          <th scope="col">${t('Token')}</th>
          <th scope="col">${t('Color')}</th>
          <th scope="col"><span class="muted">${t('Changed')}</span></th>
        </tr>
      </thead>
      <tbody>
        ${TOKENS.map((token) => {
          const name = t(TOKEN_NAMES[token]);
          const label = t('{token}, {scheme}', { token: name, scheme: caption });
          const changed = editor.draft[scheme][token] !== undefined;
          return html`<tr>
            <th scope="row">${name}</th>
            <td>
              <input
                type="color"
                aria-label=${label}
                .value=${tokenValue(editor.draft, scheme, token, this.base)}
                @input=${(event: Event) => {
                  editor.setToken(scheme, token, (event.target as HTMLInputElement).value);
                }}
              />
            </td>
            <td>
              ${
                changed
                  ? html`<button
                      type="button"
                      aria-label=${t('Reset {token}', { token: label })}
                      @click=${() => {
                        editor.resetToken(scheme, token);
                      }}
                    >
                      ${t('Reset')}
                    </button>`
                  : nothing
              }
            </td>
          </tr>`;
        })}
      </tbody>
    </table>`;
  }

  private renderImage(kind: BrandImageKind): unknown {
    const editor = this.editor;
    const current = imageOf(editor?.branding, kind);
    const name = t(IMAGE_NAMES[kind]);
    const id = `image-${kind}`;
    return html`<div class="image">
      <label for=${id}>${name}</label>
      <div class="preview ${kind === 'logo-dark' ? 'dark' : ''}">
        ${current ? html`<img src=${current} alt=${name} />` : t('None: the one of the installation')}
      </div>
      <input
        id=${id}
        type="file"
        accept=${ACCEPT}
        @change=${async (event: Event) => {
          const input = event.target as HTMLInputElement;
          const file = input.files?.[0];
          if (file && editor) {
            await editor.upload(kind, file);
          }
          input.value = '';
        }}
      />
      ${
        current
          ? html`<button
              type="button"
              aria-label=${t('Remove {image}', { image: name })}
              @click=${() => void editor?.remove(kind)}
            >
              ${t('Remove')}
            </button>`
          : nothing
      }
    </div>`;
  }

  private readonly save = (): void => {
    void this.editor?.save();
  };

  private readonly discard = (): void => {
    this.editor?.discard();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'mk-admin-branding': MkAdminBranding;
  }
}
