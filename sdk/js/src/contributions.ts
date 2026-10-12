// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/** A contribution of an extension to an extension point, as delivered by the kernel. */
export interface Contribution {
  /** Extension point, for example `launcher.app`. */
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
  /** Extension points that the frontend offers to other extensions (MK-020). */
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

/** Reads a string attribute of a contribution, or returns `undefined` when it is missing or not a string. */
export function stringAttribute(contribution: Contribution, name: string): string | undefined {
  const value = contribution.attributes[name];
  return typeof value === 'string' ? value : undefined;
}
