// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABELS,
  EMPTY_KINDS,
  MEDIUM_BREAKPOINT,
  clampWidth,
  countOf,
  REQUEST_ACCESS_EVENT,
  emptyKind,
  emptyStateAction,
  emptyStateText,
  requestedResource,
  filtersButtonText,
  labelsOf,
  listLayout,
  paneStorageKey,
  readPaneWidth,
  widthAfterKey,
  withCount,
  writePaneWidth,
  type PaneStorage,
} from '../src/patterns.js';

class MemoryStorage implements PaneStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const refusing: PaneStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('list page (MK-105)', () => {
  it('105.1 lays out the items as a grid or as rows, rows unless it says grid', () => {
    expect(listLayout('grid')).toBe('grid');
    expect(listLayout('rows')).toBe('rows');
    expect(listLayout('cards')).toBe('rows');
    expect(listLayout(null)).toBe('rows');
  });

  it('105.1 reads the count, the selected items and the active filters as whole numbers', () => {
    expect(countOf('3')).toBe(3);
    expect(countOf('2.7')).toBe(2);
    expect(countOf('-1')).toBe(0);
    expect(countOf('many')).toBe(0);
    expect(countOf(undefined)).toBe(0);
    expect(withCount(DEFAULT_LABELS.selected, 4)).toBe('4 selected');
  });

  it('105.1 takes the texts of the app over the English ones, ignoring unknown or empty ones', () => {
    const labels = labelsOf({
      filters: 'Filtri',
      selected: '{count} selezionati',
      clearSelection: '',
      ...({ other: 'x' } as object),
    });
    expect(labels.filters).toBe('Filtri');
    expect(withCount(labels.selected, 2)).toBe('2 selezionati');
    expect(labels.clearSelection).toBe(DEFAULT_LABELS.clearSelection);
    expect(labels).not.toHaveProperty('other');
    expect(labelsOf(undefined)).toEqual(DEFAULT_LABELS);
  });

  it('105.2 below the medium breakpoint the button of the facets says how many filters are active', () => {
    expect(MEDIUM_BREAKPOINT).toBe(900);
    expect(filtersButtonText(0)).toBe('Filters');
    expect(filtersButtonText(3)).toBe('Filters (3 active)');
    expect(filtersButtonText(1, labelsOf({ filtersActive: 'Filtri ({count} attivi)' }))).toBe(
      'Filtri (1 attivi)',
    );
  });
});

describe('empty and error states (MK-105)', () => {
  it('105.3 tells apart nothing yet, filtered out, failed, offline and denied', () => {
    expect(EMPTY_KINDS).toEqual(['empty', 'filtered', 'failed', 'offline', 'denied']);
    const texts = EMPTY_KINDS.map(emptyStateText);
    expect(new Set(texts.map((text) => text.title)).size).toBe(5);
    expect(new Set(texts.map((text) => text.explanation)).size).toBe(5);
    expect(new Set(texts.map((text) => text.icon)).size).toBe(5);
    for (const text of texts) {
      expect(text.title).not.toBe('');
      expect(text.explanation).not.toBe('');
    }
  });

  it('105.3 a failed request never looks like an empty list', () => {
    expect(emptyStateText('empty').tone).toBe('neutral');
    expect(emptyStateText('filtered').tone).toBe('neutral');
    for (const kind of ['failed', 'offline', 'denied'] as const) {
      expect(emptyStateText(kind).tone).toBe('problem');
    }
  });

  it('105.3 offers an action: clear the filters, or try again after a failure or offline', () => {
    expect(emptyStateText('filtered').action).toEqual({
      label: 'Clear the filters',
      event: 'mk-clear-filters',
    });
    expect(emptyStateText('failed').action?.event).toBe('mk-retry');
    expect(emptyStateText('offline').action?.event).toBe('mk-retry');
    // Only the app knows what creates the first item, or whom to ask for access.
    expect(emptyStateText('empty').action).toBeUndefined();
    expect(emptyStateText('denied').action).toBeUndefined();
  });

  it('105.3 a kind it does not know is an empty list', () => {
    expect(emptyKind('failed')).toBe('failed');
    expect(emptyKind('broken')).toBe('empty');
    expect(emptyKind(null)).toBe('empty');
  });
});

describe('resizable pane (MK-105)', () => {
  const bounds = { min: 160, max: 640 };

  it('105.4 keeps the width within the bounds, in whole pixels', () => {
    expect(clampWidth(300.4, bounds)).toBe(300);
    expect(clampWidth(20, bounds)).toBe(160);
    expect(clampWidth(2000, bounds)).toBe(640);
    // A maximum below the minimum leaves the minimum.
    expect(clampWidth(500, { min: 300, max: 200 })).toBe(300);
  });

  it('105.4 the person resizes it with the keyboard too', () => {
    expect(widthAfterKey(300, 'ArrowRight', bounds)).toBe(316);
    expect(widthAfterKey(300, 'ArrowUp', bounds)).toBe(316);
    expect(widthAfterKey(300, 'ArrowLeft', bounds)).toBe(284);
    expect(widthAfterKey(300, 'ArrowDown', bounds, true)).toBe(236);
    expect(widthAfterKey(300, 'ArrowRight', bounds, true)).toBe(364);
    expect(widthAfterKey(300, 'Home', bounds)).toBe(160);
    expect(widthAfterKey(300, 'End', bounds)).toBe(640);
    expect(widthAfterKey(630, 'ArrowRight', bounds)).toBe(640);
    expect(widthAfterKey(300, 'Enter', bounds)).toBeUndefined();
  });

  it('105.4 the app keeps the width the person left at the next visit', () => {
    const storage = new MemoryStorage();
    expect(readPaneWidth(storage, 'notes.list', bounds)).toBeUndefined();
    writePaneWidth(storage, 'notes.list', 412.6);
    expect(storage.items.get(paneStorageKey('notes.list'))).toBe('413');
    expect(readPaneWidth(storage, 'notes.list', bounds)).toBe(413);
    // Each pane of each app has its own width.
    expect(readPaneWidth(storage, 'tasks.list', bounds)).toBeUndefined();
  });

  it('105.4 a width kept out of the bounds, or not a number, is brought back or ignored', () => {
    const storage = new MemoryStorage();
    storage.setItem(paneStorageKey('a'), '9999');
    storage.setItem(paneStorageKey('b'), 'wide');
    storage.setItem(paneStorageKey('c'), ' ');
    expect(readPaneWidth(storage, 'a', bounds)).toBe(640);
    expect(readPaneWidth(storage, 'b', bounds)).toBeUndefined();
    expect(readPaneWidth(storage, 'c', bounds)).toBeUndefined();
  });

  it('105.4 without a storage the width lasts the visit and nothing fails', () => {
    expect(readPaneWidth(refusing, 'notes.list', bounds)).toBeUndefined();
    expect(() => {
      writePaneWidth(refusing, 'notes.list', 300);
    }).not.toThrow();
    expect(readPaneWidth(undefined, 'notes.list', bounds)).toBeUndefined();
    expect(() => {
      writePaneWidth(undefined, 'notes.list', 300);
    }).not.toThrow();
  });
});

describe('the request for access of a refused panel (MK-058)', () => {
  it('58.1 reads the resource a refused panel names', () => {
    expect(requestedResource('dev.example.dashboards/dashboard/42')).toEqual({
      extension: 'dev.example.dashboards',
      type: 'dashboard',
      id: '42',
    });
    expect(requestedResource('org.example.files/file/a/b')).toEqual({
      extension: 'org.example.files',
      type: 'file',
      id: 'a/b',
    });
    for (const value of [
      null,
      undefined,
      '',
      'dashboards/dashboard/42',
      'dev.example.dashboards/dashboard',
      'dev.example.dashboards/Dashboard/42',
      'dev.example.dashboards/dashboard/ ',
      `dev.example.dashboards/dashboard/${'x'.repeat(201)}`,
    ]) {
      expect(requestedResource(value)).toBeUndefined();
    }
  });

  it('58.1 offers Request access on a refused panel that names its resource', () => {
    const resource = { extension: 'dev.example.dashboards', type: 'dashboard', id: '42' };
    expect(emptyStateAction('denied', resource)).toEqual({
      label: 'Request access',
      event: REQUEST_ACCESS_EVENT,
    });
    expect(emptyStateAction('denied', resource, 'Chiedi accesso')?.label).toBe('Chiedi accesso');
    expect(emptyStateAction('denied', undefined)).toBeUndefined();
    expect(emptyStateAction('failed', resource)?.event).toBe('mk-retry');
    expect(REQUEST_ACCESS_EVENT).toBe('mk-request-access');
  });
});
