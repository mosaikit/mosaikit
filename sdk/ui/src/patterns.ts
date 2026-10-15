// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * The logic of the page patterns of the UI kit (MK-105): the list page, the empty and error states
 * and the resizable pane. The elements (`<mk-list-page>`, `<mk-empty-state>`, `<mk-split-pane>`)
 * are defined by `@mosaikit/ui/components`; what they decide is here, without the DOM.
 */

/**
 * Below this width, in pixels, the list page shows its facets from a button instead of a column
 * (the medium breakpoint of the console, ADR-0039). It applies to the width of the page, not of
 * the window, so that a list page in a narrow pane behaves as on a narrow screen.
 */
export const MEDIUM_BREAKPOINT = 900;

/** How the list page lays out its items. */
export type ListLayout = 'grid' | 'rows';

/** The layout an attribute names: rows unless it says grid. */
export function listLayout(value: string | null | undefined): ListLayout {
  return value === 'grid' ? 'grid' : 'rows';
}

/** A count from an attribute: a whole number from 0, or 0 when it is missing or not a number. */
export function countOf(value: string | null | undefined): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/** The texts of the patterns, in English; an app passes its own (`labels`) in another language. */
export interface PatternLabels {
  /** The button that opens the facets on narrow pages. */
  readonly filters: string;
  /** The same button with active filters; `{count}` is their number. */
  readonly filtersActive: string;
  /** Closes the facets opened from the button. */
  readonly closeFilters: string;
  /** The number of selected items in the bar of bulk actions; `{count}` is the number. */
  readonly selected: string;
  readonly clearSelection: string;
  readonly grid: string;
  readonly rows: string;
  /** The handle that resizes a pane. */
  readonly resize: string;
}

export const DEFAULT_LABELS: PatternLabels = {
  filters: 'Filters',
  filtersActive: 'Filters ({count} active)',
  closeFilters: 'Close the filters',
  selected: '{count} selected',
  clearSelection: 'Clear the selection',
  grid: 'Grid',
  rows: 'Rows',
  resize: 'Resize the pane',
};

/** The texts an app gave over the default ones; a missing or empty one stays the default. */
export function labelsOf(given: Partial<PatternLabels> | undefined): PatternLabels {
  const labels: Record<string, string> = { ...DEFAULT_LABELS };
  for (const [key, value] of Object.entries(given ?? {})) {
    if (key in DEFAULT_LABELS && typeof value === 'string' && value !== '') {
      labels[key] = value;
    }
  }
  return labels as unknown as PatternLabels;
}

/** Puts a count into a text with `{count}`. */
export function withCount(text: string, count: number): string {
  return text.replaceAll('{count}', String(count));
}

/** The text of the button that opens the facets: it says how many filters are active. */
export function filtersButtonText(active: number, labels: PatternLabels = DEFAULT_LABELS): string {
  return active > 0 ? withCount(labels.filtersActive, active) : labels.filters;
}

/**
 * What an empty panel says happened: nothing yet, every item filtered out, the request failed, no
 * network, or no permission. Each one has its own icon, tone, texts and action, so that a failed
 * request never looks like an empty list.
 */
export const EMPTY_KINDS = ['empty', 'filtered', 'failed', 'offline', 'denied'] as const;
export type EmptyKind = (typeof EMPTY_KINDS)[number];

/** The kind an attribute names; `empty` when it names none of them. */
export function emptyKind(value: string | null | undefined): EmptyKind {
  return EMPTY_KINDS.find((kind) => kind === value) ?? 'empty';
}

/** What a state shows when the app gives no text of its own. */
export interface EmptyStateText {
  readonly title: string;
  readonly explanation: string;
  /** The default action, a button that dispatches `event`; none for `empty`, where the app knows. */
  readonly action?: { readonly label: string; readonly event: string };
  /** `problem` for what went wrong (failed, offline, denied), `neutral` otherwise. */
  readonly tone: 'neutral' | 'problem';
  /** The name of the icon of the state. */
  readonly icon: 'inbox' | 'filter' | 'error' | 'offline' | 'lock';
}

const EMPTY_TEXTS: Record<EmptyKind, EmptyStateText> = {
  empty: {
    title: 'Nothing here yet',
    explanation: 'When there is something, it shows here.',
    tone: 'neutral',
    icon: 'inbox',
  },
  filtered: {
    title: 'Nothing matches the filters',
    explanation: 'There are items, but the filters hide all of them.',
    action: { label: 'Clear the filters', event: 'mk-clear-filters' },
    tone: 'neutral',
    icon: 'filter',
  },
  failed: {
    title: 'This could not be loaded',
    explanation: 'Something went wrong on our side. What you had is not lost.',
    action: { label: 'Try again', event: 'mk-retry' },
    tone: 'problem',
    icon: 'error',
  },
  offline: {
    title: 'You are offline',
    explanation: 'This shows again when the connection is back.',
    action: { label: 'Try again', event: 'mk-retry' },
    tone: 'problem',
    icon: 'offline',
  },
  denied: {
    title: 'You do not have access',
    explanation: 'Ask the owner or an administrator of the organization for access.',
    tone: 'problem',
    icon: 'lock',
  },
};

/** The default texts, icon, tone and action of a kind of empty state. */
export function emptyStateText(kind: EmptyKind): EmptyStateText {
  return EMPTY_TEXTS[kind];
}

/** The bounds and the step of a resizable pane, in pixels. */
export interface PaneBounds {
  readonly min: number;
  readonly max: number;
}

/** A width within the bounds of the pane, in whole pixels. */
export function clampWidth(width: number, bounds: PaneBounds): number {
  const max = Math.max(bounds.min, bounds.max);
  return Math.round(Math.min(max, Math.max(bounds.min, width)));
}

/** The pixels a key moves the handle of a pane; with Shift, a larger step. */
export const PANE_STEP = 16;
export const PANE_LARGE_STEP = 64;

/**
 * The width after a key on the handle of a pane: arrows move it by a step (larger with Shift),
 * Home and End to the bounds. `undefined` for a key that does not resize.
 */
export function widthAfterKey(
  width: number,
  key: string,
  bounds: PaneBounds,
  shift = false,
): number | undefined {
  const step = shift ? PANE_LARGE_STEP : PANE_STEP;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampWidth(width - step, bounds);
    case 'ArrowRight':
    case 'ArrowUp':
      return clampWidth(width + step, bounds);
    case 'Home':
      return clampWidth(bounds.min, bounds);
    case 'End':
      return clampWidth(bounds.max, bounds);
    default:
      return undefined;
  }
}

/** The key, in the storage of the browser, of the width of a pane of an app. */
export function paneStorageKey(name: string): string {
  return `mk.pane-width.${name}`;
}

/** The part of `Storage` the pane uses, so that tests can pass their own. */
export type PaneStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The width a person left a pane at, within the bounds; `undefined` when there is none, it is not a
 * number, or the storage cannot be read (private windows, blocked site data).
 */
export function readPaneWidth(
  storage: PaneStorage | undefined,
  name: string,
  bounds: PaneBounds,
): number | undefined {
  try {
    const stored = storage?.getItem(paneStorageKey(name));
    if (stored == null || stored.trim() === '') {
      return undefined;
    }
    const width = Number(stored);
    return Number.isFinite(width) ? clampWidth(width, bounds) : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the width of a pane for the next visit; a storage that refuses it is ignored. */
export function writePaneWidth(
  storage: PaneStorage | undefined,
  name: string,
  width: number,
): void {
  try {
    storage?.setItem(paneStorageKey(name), String(Math.round(width)));
  } catch {
    // The width stays for this visit only.
  }
}
