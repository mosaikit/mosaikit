// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { MissingExtension, ReferenceStatus, ResolvedReference } from './references.js';

/** The element that shows a reference that is not available (MK-135). */
export const REFERENCE_PLACEHOLDER_TAG = 'mk-reference-placeholder';

/** What the placeholder says, in the language of the person. */
export interface ReferencePlaceholderText {
  /** What is missing, such as `Not available: Rivers map`. */
  readonly title: string;
  /** Why it is missing. */
  readonly detail: string;
  /** For administrators, which extension to install or turn on; absent for the others. */
  readonly action?: string;
}

type Texts = {
  readonly titled: (label: string) => string;
  readonly untitled: string;
  readonly reasons: Readonly<Record<Exclude<ReferenceStatus, 'available'>, string>>;
  readonly actions: Readonly<Record<MissingExtension['action'], (extension: string) => string>>;
};

const TEXTS: Readonly<Record<'en' | 'it', Texts>> = {
  en: {
    titled: (label) => `Not available: ${label}`,
    untitled: 'This content is not available',
    reasons: {
      'extension-absent': 'The extension that provides it is not active in this organization.',
      deleted: 'It was deleted.',
      forbidden: 'You do not have access to it.',
    },
    actions: {
      install: (extension) =>
        `An administrator of the installation can install the extension ${extension}.`,
      restart: (extension) =>
        `The extension ${extension} is installed and becomes active when the installation restarts.`,
      repair: (extension) =>
        `The extension ${extension} is installed but cannot run: see Extensions in the administration of the installation.`,
      'turn-on': (extension) =>
        `Turn on the extension ${extension} in the apps of the organization.`,
    },
  },
  it: {
    titled: (label) => `Non disponibile: ${label}`,
    untitled: 'Questo contenuto non è disponibile',
    reasons: {
      'extension-absent': "L'estensione che lo fornisce non è attiva in questa organizzazione.",
      deleted: 'È stato eliminato.',
      forbidden: 'Non hai accesso a questo contenuto.',
    },
    actions: {
      install: (extension) =>
        `Un amministratore dell'installazione può installare l'estensione ${extension}.`,
      restart: (extension) =>
        `L'estensione ${extension} è installata e si attiva al prossimo riavvio dell'installazione.`,
      repair: (extension) =>
        `L'estensione ${extension} è installata ma non può funzionare: vedi Estensioni nell'amministrazione dell'installazione.`,
      'turn-on': (extension) => `Attiva l'estensione ${extension} nelle app dell'organizzazione.`,
    },
  },
};

function textsFor(locale: string | undefined): Texts {
  return locale?.toLowerCase().split('-')[0] === 'it' ? TEXTS.it : TEXTS.en;
}

/**
 * What the placeholder of a reference that is not available says (MK-135), in English or Italian:
 * what is missing, why, and to administrators which extension to install or turn on. `undefined` for
 * an available reference.
 *
 * @param label what the reference shows, in the words of the referring extension, such as
 *     `Rivers map`; without it the placeholder speaks of "this content"
 * @param locale a BCP 47 tag, such as `context.locale`; English for any other language
 */
export function referencePlaceholderText(
  reference: Pick<ResolvedReference, 'status' | 'missing'>,
  label?: string,
  locale?: string,
): ReferencePlaceholderText | undefined {
  if (reference.status === 'available') {
    return undefined;
  }
  const texts = textsFor(locale);
  const what = label?.trim();
  const missing = reference.status === 'extension-absent' ? reference.missing : undefined;
  const extension =
    missing === undefined
      ? undefined
      : missing.name
        ? `${missing.name} (${missing.extension})`
        : missing.extension;
  return {
    title: what ? texts.titled(what) : texts.untitled,
    detail: texts.reasons[reference.status],
    ...(missing && extension ? { action: texts.actions[missing.action](extension) } : {}),
  };
}

function escape(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
}

const STYLE = `
  :host { display: block; }
  :host([hidden]) { display: none; }
  .box { border: 1px dashed var(--mk-line, #c8c8c8); border-radius: var(--mk-radius, 4px);
         padding: 12px 16px; background: var(--mk-surface, transparent); color: var(--mk-muted, #616161); }
  .title { display: block; color: var(--mk-fg, inherit); font-weight: 600; }
  p { margin: 4px 0 0; }
`;

/** The content of the placeholder: empty for an available reference. */
export function referencePlaceholderHtml(text: ReferencePlaceholderText | undefined): string {
  if (text === undefined) {
    return '';
  }
  const action =
    text.action === undefined ? '' : `<p class="action" part="action">${escape(text.action)}</p>`;
  return (
    `<style>${STYLE}</style><div class="box" role="note" part="box">` +
    `<span class="title" part="title">${escape(text.title)}</span>` +
    `<p class="detail" part="detail">${escape(text.detail)}</p>${action}</div>`
  );
}

/** The placeholder element, as {@link defineReferencePlaceholder} defines it. */
export interface ReferencePlaceholderElement extends HTMLElement {
  /** The resolved reference to show; nothing is shown while it is absent or available. */
  reference: Pick<ResolvedReference, 'status' | 'missing'> | undefined;
}

/**
 * Defines the element `<mk-reference-placeholder>` (MK-135), so that every extension shows a reference
 * that is not available the same way: what is missing (the attribute `label`, in the words of the
 * referring extension), why, and to administrators which extension to install or turn on. Set its
 * `reference` property to a {@link ResolvedReference}; the attribute `locale` (or the `lang` of the
 * page) chooses English or Italian. It shows nothing for an available reference, so the referring
 * extension shows the resource in its place. The shell defines it for the extensions it loads as
 * modules; an extension in an isolated frame calls this function itself. Defining it again does
 * nothing.
 */
export function defineReferencePlaceholder(
  registry: Pick<CustomElementRegistry, 'get' | 'define'> = customElements,
): void {
  if (registry.get(REFERENCE_PLACEHOLDER_TAG)) {
    return;
  }
  class ReferencePlaceholder extends HTMLElement implements ReferencePlaceholderElement {
    static readonly observedAttributes = ['label', 'locale'];
    private current: Pick<ResolvedReference, 'status' | 'missing'> | undefined;

    get reference(): Pick<ResolvedReference, 'status' | 'missing'> | undefined {
      return this.current;
    }

    set reference(value: Pick<ResolvedReference, 'status' | 'missing'> | undefined) {
      this.current = value;
      this.render();
    }

    connectedCallback(): void {
      this.render();
    }

    attributeChangedCallback(): void {
      this.render();
    }

    private render(): void {
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      const locale =
        this.getAttribute('locale') ??
        (typeof document === 'undefined' ? undefined : document.documentElement.lang);
      const text =
        this.current === undefined
          ? undefined
          : referencePlaceholderText(
              this.current,
              this.getAttribute('label') ?? undefined,
              locale || undefined,
            );
      this.hidden = text === undefined;
      root.innerHTML = referencePlaceholderHtml(text);
    }
  }
  registry.define(REFERENCE_PLACEHOLDER_TAG, ReferencePlaceholder);
}
