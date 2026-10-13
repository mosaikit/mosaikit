// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { EventBus, SHARE_TOPIC, openSharing, sharingLevel } from '../src/index.js';

const extension = { id: 'dev.example.dashboards', version: '1.0.0' };

describe('sharing from an extension frontend (MK-055)', () => {
  it('asks the shell to open the sharing dialog for a resource of the extension', () => {
    const events = new EventBus();
    const heard = vi.fn();
    events.on(SHARE_TOPIC, heard);

    openSharing({ events, extension }, 'dashboard', '42');

    expect(heard).toHaveBeenCalledWith(
      { extension: 'dev.example.dashboards', type: 'dashboard', id: '42' },
      'shell.share',
    );
  });

  it('reads the level of the person as the sharing dialog shows it', async () => {
    const fetch = vi.fn((path: string) =>
      Promise.resolve(
        path.endsWith('/42')
          ? new Response(JSON.stringify({ level: 'edit', canShare: false }), { status: 200 })
          : new Response(null, { status: path.endsWith('/7') ? 404 : 500 }),
      ),
    );

    expect(await sharingLevel({ fetch, extension }, 'dashboard', '42')).toBe('edit');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/sharing/resources/dev.example.dashboards/dashboard/42',
    );
    expect(await sharingLevel({ fetch, extension }, 'dashboard', '7')).toBeUndefined();
    await expect(sharingLevel({ fetch, extension }, 'dashboard', '9')).rejects.toThrow('(500)');
  });
});
