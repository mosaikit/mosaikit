// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import {
  contributionsTo,
  pointId,
  typedContributions,
  type FrontendExtension,
} from '../src/contributions.js';

interface WidgetV1 {
  readonly element: string;
}

interface WidgetV2 {
  readonly element: string;
  readonly size: 'small' | 'large';
}

const extensions: FrontendExtension[] = [
  {
    id: 'dev.example.dashboard',
    version: '2.0.0',
    entry: '/d.js',
    isolation: 'module',
    contributions: [],
    points: ['dashboard.widget', 'dashboard.widget@2'],
  },
  {
    id: 'dev.example.weather',
    version: '1.0.0',
    entry: '/w.js',
    isolation: 'module',
    contributions: [
      { point: 'dashboard.widget', id: 'old', attributes: { element: 'weather-old' } },
      {
        point: 'dashboard.widget@2',
        id: 'new',
        attributes: { element: 'weather-card', size: 'large' },
      },
    ],
  },
];

/** The context of the owner of the points, as the shell builds it. */
const owner = {
  contributionsTo: (point: string) =>
    extensions[0]?.points?.includes(point) ? contributionsTo(extensions, point) : [],
};

describe('MK-134 typed contributions', () => {
  it('names a version of a point as the manifest does', () => {
    expect(pointId('dashboard.widget')).toBe('dashboard.widget');
    expect(pointId('dashboard.widget', 1)).toBe('dashboard.widget');
    expect(pointId('dashboard.widget', 2)).toBe('dashboard.widget@2');
    expect(() => pointId('dashboard.widget', 0)).toThrow(RangeError);
    expect(() => pointId('dashboard.widget', 1.5)).toThrow(RangeError);
  });

  it('gives the owner the contributions to each version, typed by its payload', () => {
    const v1 = typedContributions<WidgetV1>(owner, 'dashboard.widget');
    const v2 = typedContributions<WidgetV2>(owner, 'dashboard.widget', 2);

    expect(v1.map((widget) => widget.attributes.element)).toEqual(['weather-old']);
    expect(v2.map((widget) => [widget.extensionId, widget.attributes.size])).toEqual([
      ['dev.example.weather', 'large'],
    ]);
    expect(typedContributions<WidgetV2>(owner, 'dashboard.widget', 3)).toEqual([]);
  });
});
