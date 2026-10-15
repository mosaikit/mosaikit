// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { isAppState, type AppAddress } from '@mosaikit/sdk';
import { entryForPath, type LauncherEntry } from './navigation.js';

/** The parts of `location` the address reads, so that tests can pass their own. */
export interface PageLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

/** The parts of `history` the address writes. */
export type PageHistory = Pick<History, 'pushState' | 'replaceState'>;

/** The state of an app in an address: what follows its route (MK-099). */
export function appState(route: string, location: PageLocation): string {
  return location.pathname.slice(route.length) + location.search + location.hash;
}

/**
 * The state of the apps in the address of the page (MK-099): each extension reads and writes the
 * state of its app that is shown, after the route of the app, and hears when the person moves to
 * another state with the back and forward buttons.
 */
export class ShellAddress {
  private readonly listeners = new Map<string, Set<(state: string) => void>>();

  /**
   * @param entries the apps of the app bar
   * @param changed called after an extension wrote the address, for the shell to follow it
   */
  constructor(
    private readonly entries: () => readonly LauncherEntry[],
    private readonly changed: () => void = () => undefined,
    private readonly location: PageLocation = globalThis.location,
    private readonly history: PageHistory = globalThis.history,
  ) {}

  /** The app shown, from the address. */
  current(): LauncherEntry | undefined {
    return entryForPath(this.entries(), this.location.pathname);
  }

  /** What one extension sees of the address. */
  for(extensionId: string): AppAddress {
    return {
      read: () => {
        const entry = this.shownOf(extensionId);
        return entry ? appState(entry.route, this.location) : '';
      },
      write: (state, options) => {
        if (!isAppState(state)) {
          throw new TypeError(
            `'${state}' is not an address state: empty, or '/', '?' or '#' and encoded parts`,
          );
        }
        const entry = this.shownOf(extensionId);
        if (!entry) {
          return false;
        }
        if (appState(entry.route, this.location) !== state) {
          const url = entry.route + state;
          if (options?.replace) {
            this.history.replaceState(null, '', url);
          } else {
            this.history.pushState(null, '', url);
          }
          this.changed();
        }
        return true;
      },
      subscribe: (listener) => {
        let listeners = this.listeners.get(extensionId);
        if (!listeners) {
          listeners = new Set();
          this.listeners.set(extensionId, listeners);
        }
        const own = listeners;
        const wrapped = (state: string): void => {
          listener(state);
        };
        own.add(wrapped);
        return () => {
          own.delete(wrapped);
        };
      },
    };
  }

  /**
   * Tells the extension of the app shown its state, after the person moved with the back or forward
   * button or opened a link of the shell; a listener that fails does not stop the others.
   */
  moved(
    report: (error: unknown) => void = (error) => {
      console.error(error);
    },
  ): void {
    const entry = this.current();
    if (!entry) {
      return;
    }
    const state = appState(entry.route, this.location);
    for (const listener of [...(this.listeners.get(entry.extensionId) ?? [])]) {
      try {
        listener(state);
      } catch (error) {
        report(error);
      }
    }
  }

  private shownOf(extensionId: string): LauncherEntry | undefined {
    const entry = this.current();
    return entry?.extensionId === extensionId ? entry : undefined;
  }
}
