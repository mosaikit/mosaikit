// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { toError, type KernelClient } from './api.js';
import { t } from './i18n.js';

/** The page of the global search in the shell (MK-040). */
export const SEARCH_ROUTE = '/search';

/** A pill of the search box: people and teams of the kernel, then the providers of extensions. */
export interface SearchProvider {
  readonly id: string;
  readonly title: string;
  /** The title in other languages, by language tag. */
  readonly i18n?: Readonly<Record<string, string>>;
  /** The extension that provides it; absent for the kernel. */
  readonly extension?: string;
}

/** A result; `resource` when it stands for a resource of an extension the person may read. */
export interface SearchHit {
  readonly title: string;
  readonly detail?: string;
  /** A path of the shell, absent when the result opens nowhere. */
  readonly link?: string;
  readonly resource?: { readonly extension: string; readonly type: string; readonly id: string };
}

/** The results of one provider; `incomplete` when it did not answer in time or failed. */
export interface SearchSection {
  readonly provider: string;
  readonly title: string;
  readonly results: readonly SearchHit[];
  readonly more: boolean;
  readonly status: 'complete' | 'incomplete';
  readonly reason?: 'timeout' | 'failed';
}

export interface SearchAnswer {
  readonly query: string;
  readonly sections: readonly SearchSection[];
}

/** What the page searches: the text, the pill (none for All) and where the page starts. */
export interface SearchRequest {
  readonly query: string;
  readonly provider?: string;
  readonly offset?: number;
}

/** The results of a page of one pill. */
export const PAGE_SIZE = 20;

/** The pills the person may use. */
export async function searchProviders(client: KernelClient): Promise<SearchProvider[]> {
  const response = await client.request('/api/v1/search/providers');
  if (!response.ok) {
    throw await toError(response);
  }
  return (await response.json()) as SearchProvider[];
}

/** Searches: the first results of every provider for All, a page of one provider for a pill. */
export async function search(client: KernelClient, request: SearchRequest): Promise<SearchAnswer> {
  const parameters = new URLSearchParams({ q: request.query });
  if (request.provider) {
    parameters.set('provider', request.provider);
    parameters.set('offset', String(request.offset ?? 0));
    parameters.set('limit', String(PAGE_SIZE));
  }
  const response = await client.request(`/api/v1/search?${parameters.toString()}`);
  if (!response.ok) {
    throw await toError(response);
  }
  return (await response.json()) as SearchAnswer;
}

/** The address of the search page: `/search?q=…&in=…&from=…`, which can be bookmarked and shared. */
export function searchAddress(request: SearchRequest): string {
  const parameters = new URLSearchParams({ q: request.query });
  if (request.provider) {
    parameters.set('in', request.provider);
    if (request.offset) {
      parameters.set('from', String(request.offset));
    }
  }
  return `${SEARCH_ROUTE}?${parameters.toString()}`;
}

/** What the address of the search page asks for, from its query string. */
export function readSearchAddress(query: string): SearchRequest {
  const parameters = new URLSearchParams(query);
  const provider = parameters.get('in') ?? undefined;
  const from = Number.parseInt(parameters.get('from') ?? '0', 10);
  const offset = provider && Number.isFinite(from) && from > 0 ? from : undefined;
  return {
    query: (parameters.get('q') ?? '').trim(),
    ...(provider ? { provider } : {}),
    ...(offset ? { offset } : {}),
  };
}

/** The label of a pill in the language of the person: the kernel ones are translated by the shell. */
export function pillTitle(
  provider: Pick<SearchProvider, 'id' | 'title' | 'i18n' | 'extension'>,
  language: string,
): string {
  if (!provider.extension) {
    return t(provider.title);
  }
  const texts = provider.i18n ?? {};
  return texts[language] ?? texts[language.split('-')[0] ?? language] ?? provider.title;
}

/** Why the results of a provider are missing, for the note shown in their place. */
export function incompleteText(
  title: string,
  section: Pick<SearchSection, 'status' | 'reason'>,
): string | undefined {
  if (section.status !== 'incomplete') {
    return undefined;
  }
  return section.reason === 'timeout'
    ? t('{title} did not answer in time: its results are missing.', { title })
    : t('{title} could not search: its results are missing.', { title });
}

/** Whether a link of a result is a page of the shell, as the kernel checks: never an address elsewhere. */
export function isShellLink(link: string | undefined): link is string {
  return link !== undefined && /^\/(?![/\\])/.test(link);
}
