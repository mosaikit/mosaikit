// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/** A contribution of an extension to an extension point, as delivered by the kernel. */
export interface Contribution {
  /**
   * Extension point, for example `launcher.app`; with the major version it targets after the first,
   * such as `dashboard.widget@2` (MK-134).
   */
  readonly point: string;
  /** Identifier, unique within the extension and the point. */
  readonly id: string;
  /** Attributes defined by the schema of the extension point. */
  readonly attributes: Readonly<Record<string, unknown>>;
}

/**
 * What a frontend isolated in an iframe may do through the shell (MK-014): nothing that is not
 * declared here passes.
 */
export interface FrontendBridge {
  /** Topics it may publish; an entry ending with `.*` stands for every topic below the prefix. */
  readonly publishes: readonly string[];
  /** Topics or prefixes it may subscribe to. */
  readonly subscribes: readonly string[];
  /** Services of the shell it may call: `api` is the backend API of the extension itself. */
  readonly services: readonly string[];
  /** Path of the backend API of the extension, such as `/api/v1/ext/notes/`, when it has one. */
  readonly api?: string | null;
  /** Path of the collections of the extension, such as `/api/v1/data/<id>/`, when it declares some. */
  readonly data?: string | null;
}

/** Frontend of an active extension, as returned by `GET /api/v1/shell/extensions`. */
export interface FrontendExtension {
  readonly id: string;
  readonly version: string;
  /** URL of the ES module to import. */
  readonly entry: string;
  /** `iframe` when the frontend runs isolated, by its own choice or because its publisher is not verified. */
  readonly isolation: 'module' | 'iframe';
  /** What the frontend may do through the shell when isolated; absent means nothing. */
  readonly bridge?: FrontendBridge;
  readonly contributions: readonly Contribution[];
  /**
   * Extension points that the frontend offers to other extensions (MK-020), one identifier per major
   * version: `dashboard.widget`, `dashboard.widget@2` (MK-134).
   */
  readonly points?: readonly string[];
}

/** A contribution together with the extension that made it. */
export interface OwnedContribution extends Contribution {
  readonly extensionId: string;
}

/** Collects the contributions of every extension to one extension point, in a stable order. */
export function contributionsTo(
  extensions: readonly FrontendExtension[],
  point: string,
): OwnedContribution[] {
  return extensions
    .flatMap((extension) =>
      extension.contributions
        .filter((contribution) => contribution.point === point)
        .map((contribution) => ({ ...contribution, extensionId: extension.id })),
    )
    .sort((a, b) => a.extensionId.localeCompare(b.extensionId) || a.id.localeCompare(b.id));
}

/**
 * A contribution whose attributes have the type of the payload of its extension point (MK-134): the
 * kernel refuses at installation the contributions that do not match the JSON Schema that the point
 * declares, and never gives them to the owner.
 */
export type TypedContribution<T extends object> = Omit<OwnedContribution, 'attributes'> & {
  readonly attributes: Readonly<T>;
};

/**
 * The identifier of one major version of an extension point (MK-134): the name for version 1, as
 * points were declared before versions, and `name@version` after it.
 */
export function pointId(name: string, version = 1): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new RangeError(
      `The version of an extension point is a whole number from 1, not ${String(version)}`,
    );
  }
  return version === 1 ? name : `${name}@${String(version)}`;
}

/**
 * The contributions to one version of an extension point that the extension declares in
 * `frontend.points`, typed by the payload of that version (MK-134):
 *
 * ```ts
 * interface Widget { readonly element: string; readonly title: string; readonly size?: 'small' | 'large' }
 * const widgets = typedContributions<Widget>(context, 'dashboard.widget', 2);
 * ```
 *
 * The type parameter states what the JSON Schema of that version of the point guarantees; empty for
 * a point the extension does not declare.
 */
export function typedContributions<T extends object>(
  context: { readonly contributionsTo: (point: string) => readonly OwnedContribution[] },
  point: string,
  version = 1,
): readonly TypedContribution<T>[] {
  return context.contributionsTo(pointId(point, version)) as readonly TypedContribution<T>[];
}

/** Reads a string attribute of a contribution, or returns `undefined` when it is missing or not a string. */
export function stringAttribute(contribution: Contribution, name: string): string | undefined {
  const value = contribution.attributes[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads a text attribute of a contribution in a language (MK-053): the text of the `i18n` block of the
 * contribution for that language (`i18n: { it: { title: Catalogo } }`), or for its main language
 * (`it` for `it-CH`), otherwise the attribute itself.
 */
export function textAttribute(
  contribution: Contribution,
  name: string,
  language: string,
): string | undefined {
  const i18n = contribution.attributes.i18n;
  if (i18n && typeof i18n === 'object') {
    const texts = i18n as Readonly<Record<string, unknown>>;
    for (const tag of [language, language.split('-')[0] ?? language]) {
      const forLanguage = texts[tag];
      if (forLanguage && typeof forLanguage === 'object') {
        const text = (forLanguage as Readonly<Record<string, unknown>>)[name];
        if (typeof text === 'string' && text.trim() !== '') {
          return text;
        }
      }
    }
  }
  return stringAttribute(contribution, name);
}
