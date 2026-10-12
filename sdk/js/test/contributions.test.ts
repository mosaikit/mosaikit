// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { contributionsTo, stringAttribute, type FrontendExtension } from '../src/contributions.js';
import { defineExtension, isMosaikitExtension } from '../src/extension.js';

const extensions: FrontendExtension[] = [
  {
    id: 'dev.example.zeta',
    version: '1.0.0',
    entry: '/z.js',
    isolation: 'module',
    contributions: [{ point: 'launcher.app', id: 'zeta', attributes: { title: 'Zeta' } }],
  },
  {
    id: 'dev.example.alpha',
    version: '1.0.0',
    entry: '/a.js',
    isolation: 'module',
    contributions: [
      { point: 'launcher.app', id: 'second', attributes: {} },
      { point: 'launcher.app', id: 'first', attributes: { title: 42 } },
      { point: 'shell.command', id: 'cmd', attributes: {} },
    ],
  },
];

describe('contributionsTo', () => {
  it('collects the contributions to a point, ordered by extension and id', () => {
    const result = contributionsTo(extensions, 'launcher.app');

    expect(result.map((c) => `${c.extensionId}/${c.id}`)).toEqual([
      'dev.example.alpha/first',
      'dev.example.alpha/second',
      'dev.example.zeta/zeta',
    ]);
  });

  it('returns nothing for a point without contributions', () => {
    expect(contributionsTo(extensions, 'maps.toolbar')).toEqual([]);
  });
});

describe('stringAttribute', () => {
  it('returns string attributes only', () => {
    const [first, , zeta] = contributionsTo(extensions, 'launcher.app');

    expect(zeta && stringAttribute(zeta, 'title')).toBe('Zeta');
    expect(first && stringAttribute(first, 'title')).toBeUndefined();
  });
});

describe('extension modules', () => {
  it('recognizes objects with an activate function', () => {
    expect(isMosaikitExtension(defineExtension({ activate: () => undefined }))).toBe(true);
    expect(isMosaikitExtension({ activate: 'no' })).toBe(false);
    expect(isMosaikitExtension(null)).toBe(false);
    expect(isMosaikitExtension('module')).toBe(false);
  });
});
