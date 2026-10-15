// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { ExtensionContext } from './extension.js';

/** Where the kernel keeps the tags of resources (MK-097). */
export const TAGS_PATH = '/api/v1/resources/tags';

type Context = Pick<ExtensionContext, 'fetch' | 'extension'>;

function resourcePath(context: Context, type: string, id?: string): string {
  const parts = id === undefined ? [context.extension.id, type] : [context.extension.id, type, id];
  return `${TAGS_PATH}/${parts.map(encodeURIComponent).join('/')}`;
}

async function answer<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${what} (${String(response.status)})`);
  }
  return (await response.json()) as T;
}

/**
 * A tag in the form the kernel stores it: trimmed, inner spaces collapsed to one, in lowercase.
 * Use it to show a tag as it will be kept while the person types.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The tags of a resource of the extension, in alphabetical order, when the signed-in person may read
 * it.
 *
 * @throws Error when the kernel refuses, also when the person may not read the resource (404)
 */
export async function resourceTags(context: Context, type: string, id: string): Promise<string[]> {
  return answer(await context.fetch(resourcePath(context, type, id)), 'The tags cannot be read');
}

/**
 * Replaces the tags of a resource of the extension, when the signed-in person may edit it: the
 * kernel keeps them in lowercase without duplicates, and answers the tags it kept. An empty list
 * removes them.
 *
 * @throws Error when the kernel refuses, such as a tag with a comma (400) or a person who may only
 *     view the resource (403)
 */
export async function replaceTags(
  context: Context,
  type: string,
  id: string,
  tags: readonly string[],
): Promise<string[]> {
  const response = await context.fetch(resourcePath(context, type, id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tags),
  });
  return answer(response, 'The tags cannot be changed');
}

/**
 * The tags used in the organization that start with what the person is typing, on resources of any
 * extension they may read: the most used first. The same suggestions in every extension.
 *
 * @param limit at most this many, up to 50
 */
export async function suggestTags(
  context: Pick<ExtensionContext, 'fetch'>,
  prefix: string,
  limit = 10,
): Promise<string[]> {
  const query = new URLSearchParams({ prefix, limit: String(limit) });
  return answer(await context.fetch(`${TAGS_PATH}/suggestions?${query.toString()}`), 'No suggestions');
}

/**
 * The identifiers of the resources of one type of the extension that carry any of the tags and that
 * the signed-in person may read, to filter a list by tags. No tag finds nothing.
 */
export async function taggedResources(
  context: Context,
  type: string,
  tags: readonly string[],
): Promise<string[]> {
  if (tags.length === 0) {
    return [];
  }
  const query = new URLSearchParams(tags.map((tag) => ['tag', tag]));
  return answer(
    await context.fetch(`${resourcePath(context, type)}?${query.toString()}`),
    'The tagged resources cannot be found',
  );
}
