// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { afterEach, describe, expect, it } from 'vitest';
import { browserLanguage, isLanguage, language, setLanguage, t } from '../src/i18n.js';

describe('the languages of the shell (MK-027)', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('translates the texts and fills the values', () => {
    expect(t('Sign in')).toBe('Sign in');
    setLanguage('it');
    expect(language()).toBe('it');
    expect(t('Sign in')).toBe('Accedi');
    expect(t('Welcome, {name}', { name: 'Mario' })).toBe('Benvenuto, Mario');
    expect(t('{count} apps available.', { count: 3 })).toBe('3 app disponibili.');
  });

  it('keeps English for a text without translation, and unknown values as they are', () => {
    setLanguage('it');
    expect(t('A text nobody translated')).toBe('A text nobody translated');
    expect(t('Welcome, {name}')).toBe('Benvenuto, {name}');
  });

  it('knows its languages', () => {
    expect(isLanguage('it')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
    expect(['en', 'it']).toContain(browserLanguage());
  });
});
