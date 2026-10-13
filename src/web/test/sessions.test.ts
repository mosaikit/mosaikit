// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../src/i18n.js';
import { describeDevice } from '../src/sessions.js';

describe('the sessions in the settings (MK-125)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('names the browser and the system of a session', () => {
    expect(
      describeDevice({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0',
      }),
    ).toBe('Edge on Windows');
    expect(
      describeDevice({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      }),
    ).toBe('Safari on iPhone');
    setLanguage('it');
    expect(
      describeDevice({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Firefox/140.0' }),
    ).toBe('Firefox su Linux');
  });

  it('keeps an unknown client recognizable', () => {
    expect(describeDevice({ userAgent: 'curl/8.10' })).toBe('curl/8.10');
    expect(describeDevice({ userAgent: null })).toBe('Unknown device');
  });
});
