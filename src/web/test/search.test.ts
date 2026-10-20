// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KernelClient } from '../src/api.js';
import { setLanguage } from '../src/i18n.js';
import {
  PAGE_SIZE,
  incompleteText,
  isShellLink,
  pillTitle,
  readSearchAddress,
  search,
  searchAddress,
  searchProviders,
} from '../src/search.js';

function client(answer: unknown, status = 200) {
  const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(JSON.stringify(answer), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
  return { kernel: new KernelClient(fetchImpl, undefined), fetchImpl };
}

describe('the global search of the shell (MK-040)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('asks All for the first results of every provider, and a pill for a page', async () => {
    const answer = { query: 'ada', sections: [] };
    const all = client(answer);
    await expect(search(all.kernel, { query: 'ada rossi' })).resolves.toEqual(answer);
    expect(all.fetchImpl.mock.calls[0]?.[0]).toBe('/api/v1/search?q=ada+rossi');

    const pill = client(answer);
    await search(pill.kernel, { query: 'ada', provider: 'org.example.files/files', offset: 40 });
    expect(pill.fetchImpl.mock.calls[0]?.[0]).toBe(
      `/api/v1/search?q=ada&provider=org.example.files%2Ffiles&offset=40&limit=${String(PAGE_SIZE)}`,
    );
  });

  it('reads the pills, and tells why a search was refused', async () => {
    const pills = [{ id: 'people', title: 'People' }];
    await expect(searchProviders(client(pills).kernel)).resolves.toEqual(pills);
    await expect(
      search(client({ title: 'Bad Request', detail: 'q must contain a word' }, 400).kernel, {
        query: '-',
      }),
    ).rejects.toThrow('q must contain a word');
    await expect(searchProviders(client({}, 500).kernel)).rejects.toThrow();
  });

  it('keeps the search in the address of the page', () => {
    expect(searchAddress({ query: 'ada rossi' })).toBe('/search?q=ada+rossi');
    expect(searchAddress({ query: 'ada', provider: 'people', offset: 20 })).toBe(
      '/search?q=ada&in=people&from=20',
    );
    expect(searchAddress({ query: 'ada', provider: 'people', offset: 0 })).toBe(
      '/search?q=ada&in=people',
    );
    expect(readSearchAddress('?q=+ada+&in=people&from=20')).toEqual({
      query: 'ada',
      provider: 'people',
      offset: 20,
    });
    // An offset counts only in a pill, and only when it is a positive number.
    expect(readSearchAddress('?q=ada&from=20')).toEqual({ query: 'ada' });
    expect(readSearchAddress('?q=ada&in=teams&from=x')).toEqual({
      query: 'ada',
      provider: 'teams',
    });
    expect(readSearchAddress('')).toEqual({ query: '' });
  });

  it('names the pills in the language of the person', () => {
    const files = {
      id: 'org.example.files/files',
      title: 'Files',
      i18n: { it: 'File' },
      extension: 'org.example.files',
    };
    expect(pillTitle(files, 'en')).toBe('Files');
    expect(pillTitle(files, 'it')).toBe('File');
    expect(pillTitle(files, 'it-CH')).toBe('File');
    expect(pillTitle({ id: files.id, title: files.title, extension: files.extension }, 'it')).toBe(
      'Files',
    );
    setLanguage('it');
    expect(pillTitle({ id: 'people', title: 'People' }, 'it')).toBe('Persone');
  });

  it('says why the results of a provider are missing', () => {
    expect(incompleteText('Files', { status: 'complete' })).toBeUndefined();
    expect(incompleteText('Files', { status: 'incomplete', reason: 'timeout' })).toBe(
      'Files did not answer in time: its results are missing.',
    );
    expect(incompleteText('Files', { status: 'incomplete', reason: 'failed' })).toBe(
      'Files could not search: its results are missing.',
    );
    setLanguage('it');
    expect(incompleteText('File', { status: 'incomplete', reason: 'timeout' })).toBe(
      'File non ha risposto in tempo: i suoi risultati mancano.',
    );
  });

  it('opens only the pages of the shell', () => {
    expect(isShellLink('/app/files?file=1')).toBe(true);
    expect(isShellLink('//example.org')).toBe(false);
    expect(isShellLink('/\\example.org')).toBe(false);
    expect(isShellLink('https://example.org')).toBe(false);
    expect(isShellLink(undefined)).toBe(false);
  });
});
