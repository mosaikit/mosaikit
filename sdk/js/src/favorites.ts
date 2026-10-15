// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { ExtensionContext } from './extension.js';
import type { MissingExtension } from './references.js';
import type { SharedResourceRef } from './sharing.js';

/** Where the kernel keeps the favorites of the signed-in person (MK-094). */
export const FAVORITES_PATH = '/api/v1/favorites';

/**
 * A resource that the signed-in person marked as favorite (MK-094), as the kernel lists it: available,
 * with the link that opens it in its extension, or with its extension absent from the organization,
 * shown as a placeholder (MK-135). A favorite the person may no longer read is left out of the list.
 */
export interface Favorite extends SharedResourceRef {
  readonly status: 'available' | 'extension-absent';
  /** The current title, or the one it had when it was marked while its extension is absent. */
  readonly title: string;
  /** Where the resource opens, a path of the shell, when it is available. */
  readonly link?: string;
  /** For administrators, when the extension is absent: which one, and what brings it back. */
  readonly missing?: MissingExtension;
  /** When it was marked, as an ISO 8601 instant. */
  readonly markedAt: string;
}

function favoritePath(extension: string, type: string, id: string): string {
  return `${FAVORITES_PATH}/${[extension, type, id].map(encodeURIComponent).join('/')}`;
}

/**
 * The favorites of the signed-in person in the organization, of every extension, the last marked
 * first.
 *
 * @throws Error when the kernel refuses the request
 */
export async function listFavorites(context: Pick<ExtensionContext, 'fetch'>): Promise<Favorite[]> {
  const response = await context.fetch(FAVORITES_PATH);
  if (!response.ok) {
    throw new Error(`The favorites cannot be read (${String(response.status)})`);
  }
  return (await response.json()) as Favorite[];
}

/**
 * Whether a resource of the extension is a favorite of the signed-in person, to show a star marked or
 * not.
 *
 * @throws Error when the kernel answers with another error
 */
export async function isFavorite(
  context: Pick<ExtensionContext, 'fetch' | 'extension'>,
  type: string,
  id: string,
): Promise<boolean> {
  const response = await context.fetch(favoritePath(context.extension.id, type, id));
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`The favorite cannot be read (${String(response.status)})`);
  }
  return true;
}

/**
 * Marks a resource of the extension, registered with the kernel (MK-054), as favorite of the
 * signed-in person; marking it again changes nothing. The person finds it in Favorites of the shell,
 * with the favorites of every other extension.
 *
 * @throws Error when the person may not open the resource (404) or the kernel refuses the request
 */
export async function markFavorite(
  context: Pick<ExtensionContext, 'fetch' | 'extension'>,
  type: string,
  id: string,
): Promise<Favorite> {
  const response = await context.fetch(favoritePath(context.extension.id, type, id), {
    method: 'PUT',
  });
  if (!response.ok) {
    throw new Error(`The favorite cannot be marked (${String(response.status)})`);
  }
  return (await response.json()) as Favorite;
}

/**
 * Removes a resource of the extension from the favorites of the signed-in person; nothing happens when
 * it is not one.
 *
 * @throws Error when the kernel refuses the request
 */
export async function unmarkFavorite(
  context: Pick<ExtensionContext, 'fetch' | 'extension'>,
  type: string,
  id: string,
): Promise<void> {
  const response = await context.fetch(favoritePath(context.extension.id, type, id), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`The favorite cannot be removed (${String(response.status)})`);
  }
}
