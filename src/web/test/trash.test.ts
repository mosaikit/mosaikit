// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe as group, expect, it, vi } from 'vitest';
import { KernelClient, type TrashedResource } from '../src/api.js';
import { TrashList, describe } from '../src/trash.js';

const PLANS: TrashedResource = {
  id: '00000000-0000-0000-0000-000000000001',
  extension: 'org.example.ext.files',
  extensionName: 'Files',
  type: 'folder',
  typeTitle: 'Folder',
  resourceId: 'f1',
  title: 'Plans',
  owner: '00000000-0000-0000-0000-0000000000a1',
  ownerName: 'Ada',
  trashedAt: '2026-10-15T08:00:00Z',
  trashedByName: 'Ada',
  purgeableFrom: '2026-11-14T08:00:00Z',
  contents: 2,
};
const MEMO: TrashedResource = {
  ...PLANS,
  id: '00000000-0000-0000-0000-000000000002',
  type: 'file',
  typeTitle: 'File',
  resourceId: 'm1',
  title: 'Memo',
  contents: 0,
};

function events() {
  return { changed: vi.fn(), announce: vi.fn<(message: string, failed: boolean) => void>() };
}

function client(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    trash: vi.fn<(whole?: boolean) => Promise<TrashedResource[]>>(() =>
      Promise.resolve([PLANS, MEMO]),
    ),
    restoreFromTrash: vi.fn(() => Promise.resolve({ restored: 3 })),
    deleteFromTrash: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

group('the trash (MK-095)', () => {
  it('says what a resource is and what went with it', () => {
    expect(describe(MEMO)).toBe('File · Files');
    expect(describe(PLANS)).toBe('Folder · Files, with 2 items inside');
    expect(describe({ ...PLANS, contents: 1 })).toBe('Folder · Files, with 1 item inside');
  });

  it('reads the trash of the person, or of the whole organization', async () => {
    const kernel = client();
    const told = events();
    const list = new TrashList(kernel, told, (iso) => iso);

    await list.load();
    expect(list.resources).toEqual([PLANS, MEMO]);
    expect(kernel.trash).toHaveBeenLastCalledWith(false);

    await list.show(true);
    expect(list.wholeOrganization).toBe(true);
    expect(kernel.trash).toHaveBeenLastCalledWith(true);
    expect(told.changed).toHaveBeenCalledTimes(2);
    expect(list.deletedOn(PLANS)).toBe('Deleted for good on 2026-11-14T08:00:00Z');
  });

  it('restores a resource and deletes one for good', async () => {
    const kernel = client();
    const told = events();
    const list = new TrashList(kernel, told, (iso) => iso);

    kernel.trash.mockResolvedValueOnce([MEMO]);
    expect(await list.restore(PLANS)).toBe(true);
    expect(kernel.restoreFromTrash).toHaveBeenCalledWith(PLANS.id);
    expect(list.resources).toEqual([MEMO]);
    expect(told.announce).toHaveBeenLastCalledWith('Plans restored.', false);

    kernel.trash.mockResolvedValueOnce([]);
    expect(await list.remove(MEMO)).toBe(true);
    expect(kernel.deleteFromTrash).toHaveBeenCalledWith(MEMO.id);
    expect(list.resources).toEqual([]);
    expect(told.announce).toHaveBeenLastCalledWith('Memo deleted for good.', false);
  });

  it('says why the kernel refused', async () => {
    const kernel = client({
      trash: vi.fn(() => Promise.reject(new Error('Offline'))),
      restoreFromTrash: vi.fn(() => Promise.reject(new Error('Restore its folder first'))),
      deleteFromTrash: vi.fn(() => Promise.reject(new Error('Not in your trash'))),
    });
    const told = events();
    const list = new TrashList(kernel, told, (iso) => iso);

    await list.load();
    expect(told.announce).toHaveBeenLastCalledWith('The trash cannot be read: Offline', true);
    expect(await list.restore(MEMO)).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not restored: Restore its folder first', true);
    expect(await list.remove(MEMO)).toBe(false);
    expect(told.announce).toHaveBeenLastCalledWith('Not deleted for good: Not in your trash', true);
  });

  it('does nothing without a kernel', async () => {
    const told = events();
    const list = new TrashList(undefined, told, (iso) => iso);
    await list.load();
    expect(await list.restore(MEMO)).toBe(false);
    expect(await list.remove(MEMO)).toBe(false);
    expect(told.announce).not.toHaveBeenCalled();
  });

  it('asks the kernel', async () => {
    const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        new Response(JSON.stringify([PLANS]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const kernel = new KernelClient(fetchMock, undefined);

    expect(await kernel.trash()).toEqual([PLANS]);
    expect(await kernel.trash(true)).toEqual([PLANS]);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ restored: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(await kernel.restoreFromTrash(PLANS.id)).toEqual({ restored: 3 });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await kernel.deleteFromTrash(PLANS.id);

    const calls = fetchMock.mock.calls.map(([path, init]) => `${init?.method ?? ''} ${path}`);
    expect(calls).toEqual([
      'GET /api/v1/trash',
      'GET /api/v1/trash?scope=organization',
      `POST /api/v1/trash/${PLANS.id}/restore`,
      `DELETE /api/v1/trash/${PLANS.id}`,
    ]);
  });
});
