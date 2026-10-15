// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  EventBus,
  defineExtension,
  type AppAddress,
  type ExtensionContext,
  type FrontendExtension,
} from '@mosaikit/sdk';
import { describe, expect, it, vi } from 'vitest';
import { ShellAddress, appState, type PageHistory, type PageLocation } from '../src/address.js';
import {
  isFrameMessage,
  isShellMessage,
  type FrameMessage,
  type InitMessage,
  type ShellMessage,
} from '../src/bridge-protocol.js';
import { ExtensionLoader } from '../src/extension-loader.js';
import { FederatedSignIn, type KeyValueStore } from '../src/federation.js';
import { FrameAddress, FrameEventBus, connect, start, type FrameDocument } from '../src/frame.js';
import { entryForPath, launcherEntries, type LauncherEntry } from '../src/navigation.js';
import { ShellBridge } from '../src/shell-bridge.js';

const FILES = 'dev.example.files';
const NOTES = 'dev.example.notes';

const apps: readonly FrontendExtension[] = [
  {
    id: FILES,
    version: '1.0.0',
    entry: '/files.js',
    isolation: 'module',
    contributions: [
      {
        point: 'rail.app',
        id: 'files',
        attributes: { route: '/app/files', element: 'mk-files-app', title: 'Files' },
      },
    ],
  },
  {
    id: NOTES,
    version: '1.0.0',
    entry: '/notes.js',
    isolation: 'module',
    contributions: [
      {
        point: 'rail.app',
        id: 'notes',
        attributes: { route: '/app/notes', element: 'mk-notes-app', title: 'Notes' },
      },
    ],
  },
];

/**
 * A browser of the tests: an address and a history that the back and forward buttons walk, as the
 * window of a page does; `open` is another browser opening a copied address.
 */
class Browser implements PageLocation, PageHistory {
  pathname = '/';
  search = '';
  hash = '';
  private entries: string[] = ['/'];
  private index = 0;

  constructor(address = '/') {
    this.go(address);
    this.entries = [address];
  }

  get address(): string {
    return this.pathname + this.search + this.hash;
  }

  pushState(_data: unknown, _unused: string, url?: string | URL | null): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(String(url));
    this.index++;
    this.go(String(url));
  }

  replaceState(_data: unknown, _unused: string, url?: string | URL | null): void {
    this.entries[this.index] = String(url);
    this.go(String(url));
  }

  back(): void {
    this.index--;
    this.go(this.entries[this.index] ?? '/');
  }

  forward(): void {
    this.index++;
    this.go(this.entries[this.index] ?? '/');
  }

  private go(address: string): void {
    const url = new URL(address, 'https://mosaikit.example.org');
    this.pathname = url.pathname;
    this.search = url.search;
    this.hash = url.hash;
  }
}

function shell(address = '/app/files') {
  const browser = new Browser(address);
  const entries: LauncherEntry[] = launcherEntries(apps, 'en');
  const changed = vi.fn();
  const shellAddress = new ShellAddress(() => entries, changed, browser, browser);
  return { browser, shellAddress, changed };
}

describe('MK-099 the state of an app in the address of the page', () => {
  it('opens the app of a path under its route, the rest being its state', () => {
    const entries = launcherEntries(apps, 'en');

    expect(entryForPath(entries, '/app/files/folders/42')?.element).toBe('mk-files-app');
    expect(entryForPath(entries, '/app/files')?.element).toBe('mk-files-app');
    expect(entryForPath(entries, '/app/files-archive')).toBeUndefined();
    expect(
      appState('/app/files', {
        pathname: '/app/files/folders/42',
        search: '?sort=name',
        hash: '#x',
      }),
    ).toBe('/folders/42?sort=name#x');
    expect(appState('/app/files', { pathname: '/app/files', search: '', hash: '' })).toBe('');
  });

  it('an extension writes a state that another browser opening the address reads the same', () => {
    const { browser, shellAddress, changed } = shell();
    const files = shellAddress.for(FILES);

    expect(files.read()).toBe('');
    expect(files.write('/folders/42?sort=name')).toBe(true);
    expect(browser.address).toBe('/app/files/folders/42?sort=name');
    expect(changed).toHaveBeenCalledOnce();

    // The copied address, opened in another browser.
    const other = shell(browser.address);
    expect(other.shellAddress.for(FILES).read()).toBe('/folders/42?sort=name');
  });

  it('gives an extension the state of its own app only, and writes nothing for another', () => {
    const { browser, shellAddress } = shell('/app/files/folders/42');

    expect(shellAddress.for(NOTES).read()).toBe('');
    expect(shellAddress.for(NOTES).write('/memos/1')).toBe(false);
    expect(browser.address).toBe('/app/files/folders/42');
  });

  it('refuses a state that the address would not give back the same', () => {
    const { shellAddress } = shell();
    const files = shellAddress.for(FILES);

    for (const state of ['folders/42', '/../admin', '/a b', '/a\\b', '?']) {
      expect(() => files.write(state), state).toThrow(TypeError);
    }
    expect(files.write('/a%20b')).toBe(true);
  });

  it('the back and forward buttons move between the states the extension wrote', () => {
    const { browser, shellAddress } = shell();
    const files = shellAddress.for(FILES);
    const heard: string[] = [];
    const stop = files.subscribe((state) => heard.push(state));

    files.write('/folders/1');
    files.write('/folders/2');
    files.write('/folders/2?sort=size', { replace: true });
    // Writing the state that is already there adds no entry.
    files.write('/folders/2?sort=size');
    expect(heard).toEqual([]);

    browser.back();
    shellAddress.moved();
    expect(files.read()).toBe('/folders/1');
    browser.back();
    shellAddress.moved();
    browser.forward();
    shellAddress.moved();
    browser.forward();
    shellAddress.moved();
    expect(heard).toEqual(['/folders/1', '', '/folders/1', '/folders/2?sort=size']);

    stop();
    browser.back();
    shellAddress.moved();
    expect(heard).toHaveLength(4);
  });

  it('tells only the extension of the app shown, and one failing listener not the others', () => {
    const { browser, shellAddress } = shell('/app/notes');
    const notes = vi.fn();
    const files = vi.fn();
    const reported: unknown[] = [];
    shellAddress.for(NOTES).subscribe(() => {
      throw new Error('boom');
    });
    shellAddress.for(NOTES).subscribe(notes);
    shellAddress.for(FILES).subscribe(files);

    browser.pushState(null, '', '/app/notes?q=x');
    shellAddress.moved((error) => reported.push(error));
    browser.pushState(null, '', '/');
    shellAddress.moved();

    expect(notes).toHaveBeenCalledExactlyOnceWith('?q=x');
    expect(files).not.toHaveBeenCalled();
    expect(reported).toHaveLength(1);
  });

  it('gives the address to the extensions it activates', async () => {
    const { shellAddress } = shell('/app/files/folders/7');
    let received: ExtensionContext | undefined;
    const loader = new ExtensionLoader(
      () => Promise.resolve(new Response()),
      () => Promise.resolve({ default: defineExtension({ activate: (c) => void (received = c) }) }),
      undefined,
      undefined,
      undefined,
      (id) => shellAddress.for(id),
    );

    await loader.loadAll([apps[0] as FrontendExtension], {
      username: 'ada',
      displayName: 'Ada',
      roles: [],
    });

    expect(received?.address?.read()).toBe('/folders/7');
  });
});

describe('MK-099 the state in the address of an isolated frame', () => {
  const extension: FrontendExtension = {
    id: FILES,
    version: '1.0.0',
    entry: '/files.js',
    isolation: 'iframe',
    contributions: [],
  };

  it('checks the address messages of both sides', () => {
    expect(isFrameMessage({ mk: 1, type: 'address', state: '/a' })).toBe(true);
    expect(isFrameMessage({ mk: 1, type: 'address', state: '/a', replace: true })).toBe(true);
    expect(isFrameMessage({ mk: 1, type: 'address', state: 1 })).toBe(false);
    expect(isFrameMessage({ mk: 1, type: 'address', state: '/a', replace: 'yes' })).toBe(false);
    expect(isShellMessage({ mk: 1, type: 'address', state: '/a' })).toBe(true);
    expect(isShellMessage({ mk: 1, type: 'address' })).toBe(false);
  });

  it('the shell writes the state the frame sends, and reports an invalid one', () => {
    const { browser, shellAddress } = shell();
    const warnings: string[] = [];
    const bridge = new ShellBridge(
      extension,
      new EventBus(),
      () => Promise.resolve(new Response()),
      () => undefined,
      (warning) => warnings.push(warning),
      shellAddress.for(FILES),
    );

    expect(bridge.handle({ mk: 1, type: 'address', state: '/folders/3' })).toBe(false);
    bridge.handle({ mk: 1, type: 'address', state: '/folders/4', replace: true });
    bridge.handle({ mk: 1, type: 'address', state: 'nowhere' });

    expect(browser.address).toBe('/app/files/folders/4');
    browser.back();
    expect(browser.address).toBe('/app/files');
    expect(warnings).toEqual([expect.stringContaining('invalid address')]);

    // Without an address, as in shells that keep none, the message changes nothing.
    const without = new ShellBridge(extension, new EventBus(), vi.fn(), () => undefined);
    expect(without.handle({ mk: 1, type: 'address', state: '/x' })).toBe(false);
  });

  it('the frame reads the state of the init message, writes it through the shell and hears the moves', () => {
    const sent: FrameMessage[] = [];
    const address = new FrameAddress('/folders/1', (message) => sent.push(message));
    const heard: string[] = [];
    const stop = address.subscribe((state) => heard.push(state));
    address.subscribe(() => {
      throw new Error('a broken listener');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(address.read()).toBe('/folders/1');
    expect(address.write('/folders/2')).toBe(true);
    address.write('/folders/2');
    address.write('?q=a', { replace: true });
    expect(() => address.write('folders')).toThrow(TypeError);
    address.deliver('/folders/1');
    stop();
    address.deliver('');

    expect(sent).toEqual([
      { mk: 1, type: 'address', state: '/folders/2' },
      { mk: 1, type: 'address', state: '?q=a', replace: true },
    ]);
    expect(heard).toEqual(['/folders/1']);
    expect(address.read()).toBe('');
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('the runtime of the frame gives the extension the address, and follows the shell', async () => {
    const rendered: string[] = [];
    const doc: FrameDocument = {
      baseURI: 'https://mosaikit.example.org/',
      documentElement: { style: { setProperty: () => undefined } },
      body: {
        replaceChildren: (...nodes: unknown[]) => void rendered.push(String(nodes.length)),
        textContent: '',
      },
      createElement: (name) => ({ localName: name }) as HTMLElement,
    };
    let address: AppAddress | undefined;
    const importModule = () =>
      Promise.resolve({
        default: defineExtension({ activate: (context) => void (address = context.address) }),
      });
    const init: InitMessage = {
      mk: 1,
      type: 'init',
      extension: { id: FILES, version: '1.0.0' },
      entry: '/files.js',
      element: 'mk-files-app',
      contributions: [],
      user: { username: 'ada', displayName: 'Ada', roles: [] },
      locale: 'en',
      theme: {},
      address: '/folders/9',
    };

    await start(
      { ...init, address: undefined } as unknown as InitMessage,
      new FrameEventBus(() => undefined),
      vi.fn(),
      importModule,
      doc,
    );
    expect(address?.read()).toBe('');

    const channel = new MessageChannel();
    const fromFrame: unknown[] = [];
    channel.port2.onmessage = (event) => fromFrame.push(event.data);
    connect({ postMessage: () => undefined }, doc, importModule, channel);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
    const toFrame = (message: ShellMessage) => {
      channel.port2.postMessage(message);
    };

    toFrame({ mk: 1, type: 'address', state: '/ignored' });
    toFrame(init);
    await tick();
    expect(address?.read()).toBe('/folders/9');
    toFrame({ mk: 1, type: 'address', state: '/folders/8' });
    await tick();
    expect(address?.read()).toBe('/folders/8');
    address?.write('/folders/10');
    await tick();
    expect(fromFrame).toContainEqual({ mk: 1, type: 'address', state: '/folders/10' });
    channel.port1.close();
    channel.port2.close();
  });
});

class MapStore implements KeyValueStore {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('MK-099 the address opened before signing in', () => {
  const ISSUER = 'https://auth.example.org/realms/acme';
  const federation = { issuer: ISSUER, clientId: 'mosaikit' };
  const realm = () =>
    vi.fn((input: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            input.endsWith('/.well-known/openid-configuration')
              ? {
                  authorization_endpoint: `${ISSUER}/auth`,
                  token_endpoint: `${ISSUER}/token`,
                }
              : { access_token: 'access', expires_in: 60 },
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

  async function signInFrom(returnTo: string | undefined) {
    const signIn = new FederatedSignIn(realm(), new MapStore());
    const url = new URL(
      await signIn.begin(federation, 'ada@example.org', 'https://example.org/', returnTo),
    );
    const state = url.searchParams.get('state') ?? '';
    return signIn.complete(new URL(`https://example.org/?code=c&state=${state}`));
  }

  it('leads, after the sign-in of the realm, back to the same view with the same state', async () => {
    const result = await signInFrom('/app/files/folders/42?sort=name#item-7');

    expect(result?.returnTo).toBe('/app/files/folders/42?sort=name#item-7');
  });

  it('never leads to another site', async () => {
    for (const returnTo of [
      '//evil.example.org/x',
      '/\\evil.example.org',
      'https://evil.example.org/',
    ]) {
      expect((await signInFrom(returnTo))?.returnTo, returnTo).toBeUndefined();
    }
    expect((await signInFrom(undefined))?.returnTo).toBeUndefined();
  });
});
