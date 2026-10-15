// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { ExtensionContext } from './extension.js';
import type { SharedResourceRef } from './sharing.js';

/** Where the kernel resolves references to resources (MK-135). */
export const RESOLVE_REFERENCES_PATH = '/api/v1/resources/references/resolve';

/**
 * Whether a referred resource is available to the signed-in person, or why not: its extension is
 * absent from the organization (not installed, not able to run, or turned off), it was deleted, or
 * the person has no right to read it.
 */
export type ReferenceStatus = 'available' | 'extension-absent' | 'deleted' | 'forbidden';

/**
 * What brings an absent extension back, for administrators only: install it, restart the
 * installation, repair it (installed but not able to run), or turn its apps on in the organization.
 */
export type MissingExtensionAction = 'install' | 'restart' | 'repair' | 'turn-on';

/** The extension a reference needs, as the kernel tells administrators. */
export interface MissingExtension {
  /** The identifier of the extension, such as `org.example.ext.maps`. */
  readonly extension: string;
  /** Its name, when it is installed. */
  readonly name?: string;
  readonly action: MissingExtensionAction;
}

/** What a reference to a resource of an extension resolves to. */
export interface ResolvedReference extends SharedResourceRef {
  readonly status: ReferenceStatus;
  /** The title of the resource, when it is available. */
  readonly title?: string;
  /** Where the resource opens, a path of the shell, when it is available. */
  readonly link?: string;
  /** For administrators, when the extension is absent: which one, and what brings it back. */
  readonly missing?: MissingExtension;
}

/**
 * Resolves references to resources of other extensions, or of this one, kept in the data of the
 * extension (MK-135): each to the resource when the signed-in person may read it, or to the reason
 * it is not available. The answers come in the order of the references, at most 100 at once. Nothing
 * is changed: keep the references as they are, also while they are not available.
 *
 * @throws Error when the kernel refuses the request
 */
export async function resolveReferences(
  context: Pick<ExtensionContext, 'fetch'>,
  references: readonly SharedResourceRef[],
): Promise<ResolvedReference[]> {
  if (references.length === 0) {
    return [];
  }
  const response = await context.fetch(RESOLVE_REFERENCES_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(references.map(({ extension, type, id }) => ({ extension, type, id }))),
  });
  if (!response.ok) {
    throw new Error(`The references cannot be resolved (${String(response.status)})`);
  }
  return (await response.json()) as ResolvedReference[];
}

/**
 * Resolves references and resolves them again each time the extension of one of them comes or goes
 * in the organization (MK-133), so that an open page shows the resource again, without a reload,
 * when its extension comes back. `onResolved` receives every answer, in the order of the references;
 * an answer older than one already delivered is dropped. Call the returned function to stop.
 */
export function watchReferences(
  context: Pick<ExtensionContext, 'fetch' | 'extensions'>,
  references: readonly SharedResourceRef[],
  onResolved: (resolved: readonly ResolvedReference[]) => void,
  onError: (error: unknown) => void = (error) => {
    console.error('The references cannot be resolved', error);
  },
): () => void {
  const extensions = new Set(references.map((reference) => reference.extension));
  let asked = 0;
  let delivered = 0;
  let stopped = false;
  const resolve = (): void => {
    const turn = ++asked;
    resolveReferences(context, references).then(
      (resolved) => {
        if (!stopped && turn > delivered) {
          delivered = turn;
          onResolved(resolved);
        }
      },
      (error: unknown) => {
        if (!stopped) {
          onError(error);
        }
      },
    );
  };
  const unsubscribe = context.extensions.subscribe((change) => {
    if (extensions.has(change.extension)) {
      resolve();
    }
  });
  resolve();
  return () => {
    stopped = true;
    unsubscribe();
  };
}
