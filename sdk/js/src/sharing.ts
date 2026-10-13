// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { ExtensionContext } from './extension.js';

/**
 * The topic on which a frontend asks the shell to open the sharing dialog of the kernel for one of
 * its resources (MK-055), with a {@link SharedResourceRef} as payload.
 */
export const SHARE_TOPIC = 'shell.share';

/** A resource that an extension registered with the kernel (MK-054). */
export interface SharedResourceRef {
  /** The identifier of the extension, such as `dev.example.dashboards`. */
  readonly extension: string;
  /** A resource type that its manifest declares in `resources`. */
  readonly type: string;
  /** The identifier of the resource in the extension. */
  readonly id: string;
}

/**
 * Opens the sharing dialog of the kernel, the same for every resource type, for a resource of the
 * extension. A frontend isolated in an iframe declares `shell.share` in `frontend.bridge.publishes`.
 */
export function openSharing(
  context: Pick<ExtensionContext, 'events' | 'extension'>,
  type: string,
  id: string,
): void {
  const resource: SharedResourceRef = { extension: context.extension.id, type, id };
  context.events.publish(SHARE_TOPIC, resource);
}

/**
 * The level of the signed-in person on a resource of the extension, as the sharing dialog shows it
 * and `Sharing.level` gives the backend: `undefined` when they have none. Use it to hide what the
 * person cannot do; the backend checks with `Sharing.require` anyway.
 *
 * @throws Error when the kernel answers with another error
 */
export async function sharingLevel(
  context: Pick<ExtensionContext, 'fetch' | 'extension'>,
  type: string,
  id: string,
): Promise<string | undefined> {
  const path = [context.extension.id, type, id].map(encodeURIComponent).join('/');
  const response = await context.fetch(`/api/v1/sharing/resources/${path}`);
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`The level cannot be read (${String(response.status)})`);
  }
  return ((await response.json()) as { level?: string }).level;
}
