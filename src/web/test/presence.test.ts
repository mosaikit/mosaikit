// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { PresenceStore, type LiveChannel } from '@mosaikit/sdk';
import { describe, expect, it } from 'vitest';
import { EXTENSIONS_TOPIC, followPresence } from '../src/presence.js';

const CATALOG = 'org.example.ext.catalog';

/** A real-time channel whose events the test sends. */
function fakeLive() {
  const handlers = new Map<string, (data: unknown) => void>();
  const live: LiveChannel = {
    subscribe: (topic, handler) => {
      handlers.set(topic, handler);
      return () => handlers.delete(topic);
    },
  };
  return { live, handlers, send: (data: unknown) => handlers.get(EXTENSIONS_TOPIC)?.(data) };
}

describe('the shell follows the extensions active in the organization (MK-133)', () => {
  it('reads the list once and applies the changes of the real-time channel', async () => {
    const { live, handlers, send } = fakeLive();
    let reads = 0;

    const { presence, stop } = await followPresence(live, () => {
      reads++;
      return Promise.resolve([{ id: CATALOG, version: '1.0.0' }]);
    });
    expect(presence.isActive(CATALOG)).toBe(true);

    send({ extension: CATALOG, active: false, version: '1.0.0', reason: 'disabled' });
    send('noise');
    expect(presence.isActive(CATALOG)).toBe(false);
    send({ extension: CATALOG, active: true, version: '1.1.0', reason: 'enabled' });
    // Questions never reach the server.
    expect(presence.version(CATALOG)).toBe('1.1.0');
    expect(presence.isActive('org.example.ext.absent')).toBe(false);
    expect(reads).toBe(1);

    stop();
    expect(handlers.size).toBe(0);
  });

  it('keeps what it knows when the list cannot be read', async () => {
    const { live } = fakeLive();
    const store = new PresenceStore([{ id: CATALOG, version: '1.0.0' }]);

    const { presence } = await followPresence(live, () => Promise.reject(new Error('down')), store);

    expect(presence).toBe(store);
    expect(presence.isActive(CATALOG)).toBe(true);
  });
});
