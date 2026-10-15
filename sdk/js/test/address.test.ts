// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { isAppState } from '../src/index.js';

describe('MK-099 address states', () => {
  it('accepts the empty state and encoded paths, queries and fragments after the route', () => {
    for (const state of ['', '/', '/folders/42', '?sort=name', '#item-7', '/a%20b?q=x%2Fy#z']) {
      expect(isAppState(state), state).toBe(true);
    }
  });

  it('refuses what the address would not give back the same', () => {
    for (const state of ['folders', '/a b', '/../admin', '/./a', '/a\b', '?', '#', 'https://x']) {
      expect(isAppState(state), state).toBe(false);
    }
  });
});
