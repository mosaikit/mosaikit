// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  isPresenceChange,
  PresenceStore,
  type ActiveExtension,
  type LiveChannel,
} from '@mosaikit/sdk';

/** The real-time topic of the extensions that become active or inactive in the organization. */
export const EXTENSIONS_TOPIC = 'extensions';

/**
 * Follows the extensions active in the organization of the session (MK-133): subscribes to the
 * real-time topic first, so that no change is missed, then reads the list once. The frontends of
 * extensions ask the store, never the server.
 *
 * @returns the store, and the function that stops following
 */
export async function followPresence(
  live: LiveChannel,
  read: () => Promise<ActiveExtension[]>,
  presence: PresenceStore = new PresenceStore(),
): Promise<{ readonly presence: PresenceStore; readonly stop: () => void }> {
  const stop = live.subscribe(EXTENSIONS_TOPIC, (data) => {
    if (isPresenceChange(data)) {
      presence.apply(data);
    }
  });
  presence.replace(await read().catch(() => presence.active()));
  return { presence, stop };
}
