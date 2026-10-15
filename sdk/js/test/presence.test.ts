// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { PresenceStore, isPresenceChange, type ExtensionPresenceChange } from '../src/index.js';

const CATALOG = 'org.example.ext.catalog';
const BOARDS = 'org.example.ext.boards';

describe('presence of other extensions (MK-133)', () => {
  it('answers from the list of the session, without a request', () => {
    const presence = new PresenceStore([
      { id: CATALOG, version: '1.2.0' },
      { id: BOARDS, version: '0.3.0' },
    ]);

    expect(presence.isActive(CATALOG)).toBe(true);
    expect(presence.version(CATALOG)).toBe('1.2.0');
    // Of an extension that is not installed, only its absence.
    expect(presence.isActive('org.example.ext.absent')).toBe(false);
    expect(presence.version('org.example.ext.absent')).toBeUndefined();
    expect(presence.active()).toEqual([
      { id: BOARDS, version: '0.3.0' },
      { id: CATALOG, version: '1.2.0' },
    ]);
    expect(new PresenceStore().active()).toEqual([]);
  });

  it('applies the changes the kernel sends and tells the subscribers once', () => {
    const presence = new PresenceStore([{ id: CATALOG, version: '1.2.0' }]);
    const seen: [string, boolean, boolean][] = [];
    const stop = presence.subscribe((change) =>
      seen.push([change.extension, change.active, presence.isActive(change.extension)]),
    );

    presence.apply({ extension: BOARDS, active: true, version: '1.0.0', reason: 'installed' });
    presence.apply({ extension: BOARDS, active: true, version: '1.0.0', reason: 'enabled' });
    presence.apply({
      extension: BOARDS,
      active: true,
      version: '1.1.0',
      reason: 'updated',
      previousVersion: '1.0.0',
    });
    presence.apply({ extension: CATALOG, active: false, version: '1.2.0', reason: 'disabled' });
    presence.apply({ extension: CATALOG, active: false, version: '1.2.0', reason: 'removed' });
    stop();
    presence.apply({ extension: CATALOG, active: true, version: '1.2.0', reason: 'enabled' });

    expect(seen).toEqual([
      [BOARDS, true, true],
      [BOARDS, true, true],
      [CATALOG, false, false],
    ]);
    expect(presence.version(BOARDS)).toBe('1.1.0');
    expect(presence.isActive(CATALOG)).toBe(true);
  });

  it('keeps telling the other subscribers when one fails', () => {
    const failed = vi.fn();
    const presence = new PresenceStore([], failed);
    const received: string[] = [];
    presence.subscribe(() => {
      throw new Error('boom');
    });
    presence.subscribe((change) => received.push(change.extension));

    presence.apply({ extension: CATALOG, active: true, version: '1.0.0', reason: 'installed' });

    expect(failed).toHaveBeenCalledOnce();
    expect(received).toEqual([CATALOG]);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const quiet = new PresenceStore();
    quiet.subscribe(() => {
      throw new Error('boom');
    });
    quiet.apply({ extension: CATALOG, active: true, version: '1.0.0', reason: 'installed' });
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });

  it('replaces the whole list, telling what changed', () => {
    const presence = new PresenceStore([
      { id: CATALOG, version: '1.0.0' },
      { id: BOARDS, version: '1.0.0' },
    ]);
    const changes: ExtensionPresenceChange[] = [];
    presence.subscribe((change) => changes.push(change));

    presence.replace([
      { id: CATALOG, version: '2.0.0' },
      { id: 'org.example.ext.processes', version: '0.1.0' },
    ]);

    expect(changes).toEqual([
      { extension: BOARDS, active: false, version: '1.0.0', reason: 'removed' },
      {
        extension: CATALOG,
        active: true,
        version: '2.0.0',
        reason: 'updated',
        previousVersion: '1.0.0',
      },
      {
        extension: 'org.example.ext.processes',
        active: true,
        version: '0.1.0',
        reason: 'installed',
      },
    ]);
  });

  it('recognizes a change received from the kernel', () => {
    expect(
      isPresenceChange({ extension: CATALOG, active: true, version: '1.0.0', reason: 'installed' }),
    ).toBe(true);
    expect(isPresenceChange({ extension: CATALOG, active: 'yes', version: '1', reason: 'x' })).toBe(
      false,
    );
    expect(isPresenceChange({ extension: CATALOG, active: true, reason: 'x' })).toBe(false);
    expect(isPresenceChange(null)).toBe(false);
    expect(isPresenceChange('extension')).toBe(false);
  });
});
