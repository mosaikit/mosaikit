// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * The state of an app in the address of the page (MK-099): what follows the route of the app, such
 * as `/folders/42`, `?sort=name` or `/folders/42?sort=name#item-7`, or the empty string. People
 * share a view by copying the address; the shell gives the state back to the app when the address
 * is opened, also in another browser and after sign-in, and when the person moves with the back and
 * forward buttons.
 */
export interface AppAddress {
  /** The state of the app of this extension that is shown; the empty string when none is. */
  read(): string;
  /**
   * Writes the state of the app of this extension that is shown, as a new entry of the history of
   * the browser, or in place of the current one with `replace`. Returns `false`, and writes nothing,
   * when no app of this extension is shown.
   *
   * @throws TypeError when the state is not an address state ({@link isAppState})
   */
  write(state: string, options?: { readonly replace?: boolean }): boolean;
  /**
   * Calls the listener with the state when the person moves to another one with the back or forward
   * button, or opens a link of the shell to the app shown; not for the states the extension writes.
   * Returns the function that stops listening.
   */
  subscribe(listener: (state: string) => void): () => void;
}

const PROBE_BASE = 'https://mosaikit.invalid';
const PROBE_ROUTE = '/app/x';

/**
 * Whether a string is an address state: empty, or starting with `/`, `?` or `#`, already encoded as
 * the browser keeps it (so that the address gives back exactly the same string: encode the parts with
 * `encodeURIComponent`), without `.` or `..` segments or backslashes.
 */
export function isAppState(state: string): boolean {
  if (state === '') {
    return true;
  }
  if (!/^[/?#]/.test(state)) {
    return false;
  }
  const probe = PROBE_ROUTE + state;
  try {
    const url = new URL(probe, PROBE_BASE);
    return url.origin === PROBE_BASE && url.pathname + url.search + url.hash === probe;
  } catch {
    return false;
  }
}
