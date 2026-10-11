// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Registration, RegistrationOptions } from './api.js';
import { t } from './i18n.js';

/** What the person asked for on the sign-in page; the shell does it. */
export interface PasswordSignIn {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
}

declare global {
  interface HTMLElementEventMap {
    'mk-continue': CustomEvent<{ email: string }>;
    'mk-use-password': CustomEvent<undefined>;
    'mk-back': CustomEvent<undefined>;
    'mk-sign-in': CustomEvent<PasswordSignIn>;
    'mk-show-register': CustomEvent<undefined>;
    'mk-register': CustomEvent<Registration>;
    'mk-resend': CustomEvent<undefined>;
  }
}

/**
 * The sign-in page of the shell, in two steps: the email address chooses the organization and its
 * realm (MK-012); a person without a realm, or who asks for it, then enters a password and may be
 * remembered on the browser. It only shows the page and tells the shell what the person asked for,
 * with events. The credentials are native inputs, which password managers fill in. The buttons
 * repeat the role that Fluent UI gives them through ElementInternals as an attribute, which tools
 * that read only the DOM, such as Playwright and axe-core, understand too.
 */
@customElement('mk-sign-in')
export class MkSignIn extends LitElement {
  static override readonly styles = css`
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    :host {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(380px, 1fr);
      min-height: 100vh;
      background: var(--mk-bg);
      color: var(--mk-fg);
    }
    .hero {
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 56px;
      color: #ffffff;
      background:
        radial-gradient(circle at 15% 20%, rgb(255 255 255 / 0.16), transparent 45%),
        linear-gradient(140deg, var(--mk-brand), color-mix(in srgb, var(--mk-brand) 45%, #050b1a));
    }
    .mosaic {
      position: absolute;
      inset: -40px -40px auto auto;
      display: grid;
      grid-template-columns: repeat(6, 64px);
      gap: 12px;
      transform: rotate(-12deg);
      opacity: 0.9;
    }
    .mosaic span {
      height: 64px;
      border-radius: calc(var(--mk-radius) * 2);
      background: rgb(255 255 255 / var(--alpha));
      animation: glow 7s ease-in-out infinite;
      animation-delay: var(--delay);
    }
    @keyframes glow {
      50% {
        background: rgb(255 255 255 / calc(var(--alpha) + 0.14));
      }
    }
    .hero h2 {
      position: relative;
      font-size: clamp(30px, 3.4vw, 44px);
      line-height: 1.15;
      margin: 0 0 16px;
      max-width: 14em;
    }
    .hero ul {
      position: relative;
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 10px;
      font-size: 16px;
    }
    .hero li {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .hero li svg {
      flex: none;
    }
    .panel {
      display: grid;
      place-items: center;
      padding: 32px 20px;
    }
    .card {
      width: min(400px, 100%);
      display: grid;
      gap: 18px;
      padding: 36px 32px 28px;
      background: var(--mk-surface);
      border: 1px solid var(--mk-line);
      border-radius: calc(var(--mk-radius) * 2);
      box-shadow:
        0 1px 2px rgb(0 0 0 / 0.06),
        0 12px 40px rgb(0 0 0 / 0.08);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 18px;
    }
    h1 {
      margin: 0;
      font-size: 26px;
      line-height: 1.2;
    }
    .lead {
      margin: -10px 0 0;
      color: var(--mk-muted);
    }
    form {
      display: grid;
      gap: 14px;
    }
    label,
    .field {
      display: grid;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
    }
    .remember label {
      font-weight: 400;
      gap: 0;
    }
    .control {
      display: flex;
      align-items: stretch;
      border: 1px solid var(--mk-line);
      border-radius: var(--mk-radius);
      background: var(--mk-surface);
    }
    .control:focus-within {
      outline: 2px solid var(--mk-focus);
      outline-offset: 1px;
      border-color: var(--mk-accent);
    }
    input:not([type='checkbox']) {
      flex: 1;
      min-width: 0;
      font: inherit;
      font-weight: 400;
      font-size: 15px;
      padding: 10px 12px;
      border: 0;
      border-radius: var(--mk-radius);
      background: transparent;
      color: var(--mk-fg);
      outline: none;
    }
    .reveal {
      font: inherit;
      font-size: 13px;
      padding: 0 12px;
      border: 0;
      border-left: 1px solid var(--mk-line);
      background: transparent;
      color: var(--mk-accent);
      cursor: pointer;
    }
    .reveal:focus-visible {
      outline: 2px solid var(--mk-focus);
    }
    .remember {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      gap: 10px;
      font-weight: 400;
    }
    .remember input {
      width: 18px;
      height: 18px;
      margin: 2px 0 0;
      accent-color: var(--mk-accent);
    }
    .remember input:focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    .remember small {
      display: block;
      color: var(--mk-muted);
    }
    fluent-button {
      width: 100%;
    }
    .or {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--mk-muted);
      font-size: 13px;
    }
    .or::before,
    .or::after {
      content: '';
      flex: 1;
      border-top: 1px solid var(--mk-line);
    }
    .notice {
      margin: 0;
      padding: 10px 12px;
      border-radius: var(--mk-radius);
      border-left: 4px solid var(--mk-success);
      background: color-mix(in srgb, var(--mk-success) 9%, var(--mk-surface));
      color: var(--mk-fg);
    }
    .switch {
      margin: 0;
      text-align: center;
      color: var(--mk-muted);
    }
    .link {
      font: inherit;
      font-weight: 600;
      padding: 0;
      border: 0;
      background: none;
      color: var(--mk-accent);
      text-decoration: underline;
      cursor: pointer;
    }
    .link:focus-visible {
      outline: 2px solid var(--mk-focus);
      outline-offset: 2px;
    }
    .hint {
      font-weight: 400;
      color: var(--mk-muted);
    }
    select {
      flex: 1;
      font: inherit;
      font-size: 15px;
      padding: 10px 12px;
      border: 0;
      background: transparent;
      color: var(--mk-fg);
      outline: none;
    }
    .error {
      margin: 0;
      padding: 10px 12px;
      border-radius: var(--mk-radius);
      border-left: 4px solid var(--mk-danger);
      background: color-mix(in srgb, var(--mk-danger) 9%, var(--mk-surface));
      color: var(--mk-fg);
    }
    footer {
      display: flex;
      justify-content: space-between;
      color: var(--mk-muted);
      font-size: 12px;
    }
    @media (max-width: 900px) {
      :host {
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr;
      }
      .hero {
        padding: 28px 24px;
        min-height: 0;
      }
      .hero ul,
      .mosaic {
        display: none;
      }
      .hero h2 {
        font-size: 24px;
        margin: 0;
      }
      .panel {
        padding: 20px 16px;
      }
      .card {
        padding: 28px 20px 20px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .mosaic span {
        animation: none;
      }
    }
  `;

  /** Name and version of the installation. */
  @property() product = 'Mosaikit';
  @property() version: string | undefined;
  /** `undefined` for the first step; the address, possibly empty, for the password. */
  @property() email: string | undefined;
  @property({ type: Boolean }) busy = false;
  @property() error: string | undefined;
  /** How many days "remember me" lasts, as the kernel says. */
  @property({ type: Number }) rememberDays = 30;
  /** Which page: signing in, creating an account, or waiting for the confirmation of the address. */
  @property() mode: 'sign-in' | 'register' | 'sent' = 'sign-in';
  /** Whether the page offers to create an account (MK-048). */
  @property({ attribute: false }) registration: RegistrationOptions | undefined;
  /** Where the confirmation link went. */
  @property() sentTo: string | undefined;
  /** Good news to show above the form, such as a confirmed address. */
  @property() notice: string | undefined;
  /** The language of the texts (MK-027): a change renders the page again. */
  @property() language = 'en';

  @state() private revealed = false;

  override render(): unknown {
    return html`
      <section class="hero" aria-hidden="true">
        <div class="mosaic">${this.tiles()}</div>
        <h2>${t('All the apps of your organization, in one place.')}</h2>
        <ul>
          ${[
            'One sign-in for every app',
            'Your data stays in your organization',
            'On any device, accessible to everyone',
          ].map((text) => html`<li>${check}${t(text)}</li>`)}
        </ul>
      </section>
      <div class="panel">
        <div class="card">
          <div class="brand">${mark}<span>${this.product}</span></div>
          ${this.renderPage()}
          <footer>
            <span
              >${this.version ? t('Version {version}', { version: this.version }) : nothing}</span
            >
            <span>${t('Open source, MPL-2.0')}</span>
          </footer>
        </div>
      </div>
    `;
  }

  private renderPage(): unknown {
    const notice = this.notice ? html`<p class="notice" role="status">${this.notice}</p>` : nothing;
    switch (this.mode) {
      case 'register':
        return html`<h1 id="sign-in-title">${t('Create an account')}</h1>
          <p class="lead">
            ${t('Join {product} with your email address.', { product: this.product })}
          </p>
          ${this.renderRegister()}`;
      case 'sent':
        return html`<h1 id="sign-in-title">${t('Check your email')}</h1>
          ${this.renderSent()}`;
      default:
        return html`<h1 id="sign-in-title">${t('Sign in')}</h1>
          <p class="lead">${t('Welcome back to {product}.', { product: this.product })}</p>
          ${notice} ${this.email === undefined ? this.renderEmail() : this.renderPassword()}
          ${
            this.registration?.enabled
              ? html`<p class="switch">
                  ${t('New here?')}
                  <button type="button" class="link" @click=${this.showRegister}>
                    ${t('Create an account')}
                  </button>
                </p>`
              : nothing
          }`;
    }
  }

  private renderRegister(): unknown {
    const organizations = this.registration?.organizations ?? [];
    const only = organizations.length === 1 ? organizations[0] : undefined;
    return html`
      <form @submit=${this.register} aria-labelledby="sign-in-title">
        ${
          only
            ? html`<input type="hidden" name="organization" .value=${only.slug} />
                <p class="lead">${t('In {organization}.', { organization: only.name })}</p>`
            : html`<label>
                ${t('Organization')}
                <span class="control">
                  <select name="organization" required>
                    ${organizations.map(
                      (organization) =>
                        html`<option value=${organization.slug}>${organization.name}</option>`,
                    )}
                  </select>
                </span>
              </label>`
        }
        <label>
          ${t('Your name')}
          <span class="control">
            <input name="displayName" autocomplete="name" maxlength="120" required />
          </span>
        </label>
        <label>
          ${t('Email')}
          <span class="control">
            <input name="email" type="email" autocomplete="email" maxlength="254" required />
          </span>
        </label>
        <div class="field">
          <label for="new-password">${t('Password')}</label>
          <span class="control">
            <input
              id="new-password"
              name="password"
              type=${this.revealed ? 'text' : 'password'}
              autocomplete="new-password"
              minlength="12"
              maxlength="128"
              aria-describedby="password-hint"
              required
            />
            <button
              class="reveal"
              type="button"
              aria-pressed=${this.revealed ? 'true' : 'false'}
              aria-label=${this.revealed ? t('Hide the password') : t('Show the password')}
              @click=${this.toggleReveal}
            >
              ${this.revealed ? t('Hide') : t('Show')}
            </button>
          </span>
          <small id="password-hint" class="hint">${t('At least 12 characters.')}</small>
        </div>
        ${this.renderError()}
        <fluent-button
          role="button"
          type="submit"
          appearance="primary"
          size="large"
          ?disabled=${this.busy}
          >${t('Create account')}</fluent-button
        >
        <fluent-button role="button" type="button" appearance="subtle" @click=${this.back}
          >${t('Back to sign in')}</fluent-button
        >
      </form>
    `;
  }

  private renderSent(): unknown {
    return html`
      <p class="lead">${sentLead(this.sentTo ?? '')}</p>
      ${this.notice ? html`<p class="notice" role="status">${this.notice}</p>` : nothing}
      ${this.renderError()}
      <fluent-button
        role="button"
        type="button"
        appearance="outline"
        ?disabled=${this.busy}
        @click=${this.resend}
        >${t('Send the link again')}</fluent-button
      >
      <fluent-button role="button" type="button" appearance="subtle" @click=${this.back}
        >${t('Back to sign in')}</fluent-button
      >
    `;
  }

  private renderEmail(): unknown {
    return html`
      <form @submit=${this.continue} aria-labelledby="sign-in-title">
        <label>
          ${t('Email or username')}
          <span class="control">
            <input name="username" inputmode="email" autocomplete="username" required />
          </span>
        </label>
        ${this.renderError()}
        <fluent-button
          role="button"
          type="submit"
          appearance="primary"
          size="large"
          ?disabled=${this.busy}
          >${t('Continue')}</fluent-button
        >
        <div class="or">${t('or')}</div>
        <fluent-button
          role="button"
          type="button"
          appearance="outline"
          size="large"
          @click=${this.usePassword}
          >${t('Sign in with a password')}</fluent-button
        >
      </form>
    `;
  }

  private renderPassword(): unknown {
    return html`
      <form @submit=${this.signIn} aria-labelledby="sign-in-title">
        <label>
          ${t('Email or username')}
          <span class="control">
            <input
              name="username"
              inputmode="email"
              autocomplete="username"
              .value=${this.email ?? ''}
              required
            />
          </span>
        </label>
        <div class="field">
          <label for="password">${t('Password')}</label>
          <span class="control">
            <input
              id="password"
              name="password"
              type=${this.revealed ? 'text' : 'password'}
              autocomplete="current-password"
              required
            />
            <button
              class="reveal"
              type="button"
              aria-pressed=${this.revealed ? 'true' : 'false'}
              aria-label=${this.revealed ? t('Hide the password') : t('Show the password')}
              @click=${this.toggleReveal}
            >
              ${this.revealed ? t('Hide') : t('Show')}
            </button>
          </span>
        </div>
        <div class="remember">
          <input id="remember" type="checkbox" name="remember" aria-describedby="remember-hint" />
          <label for="remember"
            >${t('Remember me')}
            <small id="remember-hint"
              >${t('Stay signed in on this device for {days} days.', { days: this.rememberDays })}</small
            ></label
          >
        </div>
        ${this.renderError()}
        <fluent-button
          role="button"
          type="submit"
          appearance="primary"
          size="large"
          ?disabled=${this.busy}
          >${t('Sign in')}</fluent-button
        >
        <fluent-button role="button" type="button" appearance="subtle" @click=${this.back}
          >${t('Back')}</fluent-button
        >
      </form>
    `;
  }

  private renderError(): unknown {
    return this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing;
  }

  private tiles(): unknown {
    // A fixed pattern, so that every visit looks the same.
    const alphas = [0.05, 0.12, 0.2, 0.08, 0.16, 0.04, 0.1, 0.22, 0.06, 0.14, 0.18, 0.09];
    return Array.from({ length: 30 }, (_, index) => {
      const alpha = alphas[index % alphas.length] ?? 0.1;
      return html`<span style="--alpha: ${alpha}; --delay: -${(index * 0.7) % 7}s"></span>`;
    });
  }

  private emit<
    K extends
      | 'mk-continue'
      | 'mk-use-password'
      | 'mk-back'
      | 'mk-sign-in'
      | 'mk-show-register'
      | 'mk-register'
      | 'mk-resend',
  >(type: K, detail: HTMLElementEventMap[K]['detail']): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private readonly continue = (event: SubmitEvent): void => {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    this.emit('mk-continue', { email: text(data, 'username').trim() });
  };

  private readonly usePassword = (): void => {
    this.emit('mk-use-password', undefined);
  };

  private readonly back = (): void => {
    this.revealed = false;
    this.emit('mk-back', undefined);
  };

  private readonly showRegister = (): void => {
    this.revealed = false;
    this.emit('mk-show-register', undefined);
  };

  private readonly register = (event: SubmitEvent): void => {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    this.emit('mk-register', {
      organization: text(data, 'organization'),
      displayName: text(data, 'displayName').trim(),
      email: text(data, 'email').trim(),
      password: text(data, 'password'),
    });
  };

  private readonly resend = (): void => {
    this.emit('mk-resend', undefined);
  };

  private readonly toggleReveal = (): void => {
    this.revealed = !this.revealed;
  };

  private readonly signIn = (event: SubmitEvent): void => {
    event.preventDefault();
    const data = new FormData(event.target as HTMLFormElement);
    this.emit('mk-sign-in', {
      username: text(data, 'username').trim(),
      password: text(data, 'password'),
      remember: data.get('remember') === 'on',
    });
  };
}

/** A text field of a submitted form. */
function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

const check = html`<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
  <circle cx="10" cy="10" r="10" fill="rgb(255 255 255 / 0.2)" />
  <path
    d="M6 10.4l2.6 2.6L14 7.6"
    fill="none"
    stroke="#fff"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>`;

const mark = html`<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
  <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--mk-accent)" />
  <rect x="15" y="1" width="12" height="12" rx="3" fill="var(--mk-accent)" opacity="0.55" />
  <rect x="1" y="15" width="12" height="12" rx="3" fill="var(--mk-accent)" opacity="0.35" />
  <rect x="15" y="15" width="12" height="12" rx="3" fill="var(--mk-accent)" opacity="0.8" />
</svg>`;

/** "We sent a link to <address>…", with the address in bold in every language. */
function sentLead(address: string): unknown {
  const [before, after] = t(
    'We sent a link to {address}. Open it to confirm your address, then sign in.',
  ).split('{address}');
  return html`${before}<strong>${address}</strong>${after}`;
}
