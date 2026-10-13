// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { LiveChannel } from './live.js';
import type { Contribution, OwnedContribution } from './contributions.js';
import type { DataCollection, DataOptions } from './data.js';
import type { EventBus } from './events.js';

/** Information about the signed-in person, as far as an extension needs it. */
export interface CurrentUser {
  readonly username: string;
  readonly displayName: string;
  readonly roles: readonly string[];
}

/**
 * What the shell gives to an extension when it activates it.
 *
 * The context is a facade: extensions never reach the internals of the shell, so the shell can
 * change without breaking them.
 */
export interface ExtensionContext {
  /** The extension being activated. */
  readonly extension: { readonly id: string; readonly version: string };
  /** Contributions of this extension, as declared in its manifest. */
  readonly contributions: readonly Contribution[];
  /**
   * The contributions of every active extension to one of the extension points that this extension
   * declares in `frontend.points` (MK-020), in a stable order; empty for other points, and in an
   * isolated frame, where the elements of other extensions are not loaded.
   */
  readonly contributionsTo: (point: string) => readonly OwnedContribution[];
  /** Event channel shared by all extensions. */
  readonly events: EventBus;
  /** Current language, as a BCP 47 tag. */
  readonly locale: string;
  /** Signed-in person. */
  readonly user: CurrentUser;
  /** Calls the kernel API with the credentials of the signed-in person. */
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  /**
   * A collection of documents that the extension declares in `data.collections` of its manifest,
   * kept by the kernel for the organization of the person (ADR-0031); with `team`, the documents
   * shared with that team only, which its members alone read (MK-032).
   */
  readonly data: <T extends object = Record<string, unknown>>(
    collection: string,
    options?: DataOptions,
  ) => DataCollection<T>;
  /** Events of the kernel in real time (MK-031); nothing arrives in an isolated frame. */
  readonly live: LiveChannel;
  /**
   * Notifies people of the organization, by email address, in their activity feed (MK-038); the
   * people who turned off the kind receive nothing. Not available in an isolated frame.
   */
  readonly notify: (notification: {
    readonly to: readonly string[];
    /** Lowercase letters, digits and '-', such as `mention`: people can turn a kind off. */
    readonly kind: string;
    readonly title: string;
    readonly body?: string;
    /** Where it opens: a path of the shell, such as `/app/notes`. */
    readonly link?: string;
  }) => Promise<void>;
}

/** The module exported by an extension frontend. */
export interface MosaikitExtension {
  /** Called once, after the module is loaded. Registers custom elements and subscriptions. */
  activate(context: ExtensionContext): void | Promise<void>;
  /** Called when the shell unloads the extension, for example at sign-out. */
  deactivate?(): void | Promise<void>;
}

/** Declares an extension frontend with type checking. */
export function defineExtension(extension: MosaikitExtension): MosaikitExtension {
  return extension;
}

/** Returns `true` if a loaded module looks like an extension frontend. */
export function isMosaikitExtension(candidate: unknown): candidate is MosaikitExtension {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    'activate' in candidate &&
    typeof candidate.activate === 'function'
  );
}
