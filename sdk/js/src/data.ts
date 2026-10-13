// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

import { NO_LIVE, type LiveChannel } from './live.js';

/**
 * The collections of documents that an extension keeps in the kernel without a backend of its own
 * (ADR-0031): JSON documents of the organization of the person, in the collections that the
 * manifest declares in `data.collections`.
 */

/** Which documents of a collection (MK-032). */
export interface DataOptions {
  /**
   * The identifier of a team of the person: the documents shared with that team, which only its
   * members read and write. Without it, the documents of the whole organization.
   */
  readonly team?: string;
}

/** A document of a collection, as the kernel returns it. */
export interface DataDocument<T extends object = Record<string, unknown>> {
  readonly id: string;
  /** The team it is shared with, or `null` for the whole organization. */
  readonly team?: string | null;
  readonly data: T;
  /** Changes at every update; pass it to `update` to refuse overwriting a newer version. */
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/** One collection of the extension. */
export interface DataCollection<T extends object = Record<string, unknown>> {
  /** Documents, newest first. */
  list(options?: { readonly offset?: number; readonly limit?: number }): Promise<DataDocument<T>[]>;
  get(id: string): Promise<DataDocument<T>>;
  create(data: T): Promise<DataDocument<T>>;
  /** Replaces a document; with `version`, refused if it changed since. */
  update(id: string, data: T, version?: number): Promise<DataDocument<T>>;
  remove(id: string): Promise<void>;
  /**
   * Calls `handler` when a document of the collection is created, replaced or deleted, by anyone
   * of the organization or of the team (MK-031), until the returned function is called; read the
   * collection again then.
   */
  onChange(handler: (change: { readonly id: string; readonly action: string }) => void): () => void;
}

/** A refusal of the kernel, with the detail of its problem (RFC 9457). */
export class DataError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DataError';
  }
}

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

async function failure(response: Response): Promise<DataError> {
  let detail = `HTTP ${String(response.status)}`;
  try {
    const problem = (await response.json()) as { detail?: unknown };
    if (typeof problem.detail === 'string') {
      detail = problem.detail;
    }
  } catch {
    // not a problem detail
  }
  return new DataError(response.status, detail);
}

/** The collections of an extension, through the `fetch` of its context. */
export function dataCollections(
  fetch: Fetch,
  extensionId: string,
  live: LiveChannel = NO_LIVE,
): <T extends object = Record<string, unknown>>(
  collection: string,
  options?: DataOptions,
) => DataCollection<T> {
  return <T extends object>(collection: string, options: DataOptions = {}): DataCollection<T> => {
    const base = `/api/v1/data/${encodeURIComponent(extensionId)}/${encodeURIComponent(collection)}`;
    const team = options.team;
    const shared = team === undefined ? '' : `team=${encodeURIComponent(team)}`;
    const json = { 'Content-Type': 'application/json' };
    const send = async <R>(path: string, init?: RequestInit): Promise<R> => {
      const response = await fetch(path, init);
      if (!response.ok) {
        throw await failure(response);
      }
      return (response.status === 204 ? undefined : await response.json()) as R;
    };
    const document = (id: string): string => `${base}/${encodeURIComponent(id)}`;
    return {
      list: (page = {}) =>
        send(
          `${base}?${shared ? `${shared}&` : ''}offset=${String(page.offset ?? 0)}&limit=${String(page.limit ?? 100)}`,
        ),
      get: (id) => send(document(id)),
      create: (data) =>
        send(shared ? `${base}?${shared}` : base, {
          method: 'POST',
          headers: json,
          body: JSON.stringify(data),
        }),
      update: (id, data, version) =>
        send(document(id), {
          method: 'PUT',
          headers: version === undefined ? json : { ...json, 'If-Match': String(version) },
          body: JSON.stringify(data),
        }),
      remove: (id) => send(document(id), { method: 'DELETE' }),
      onChange: (handler) =>
        live.subscribe(`documents.${extensionId}.${collection}`, (data) => {
          const change = data as { id?: unknown; action?: unknown; team?: unknown };
          // The events of the other teams, or of the whole organization, are not for this view.
          if ((change.team ?? undefined) !== team) {
            return;
          }
          handler({
            id: typeof change.id === 'string' ? change.id : '',
            action: typeof change.action === 'string' ? change.action : '',
          });
        }),
    };
  };
}
