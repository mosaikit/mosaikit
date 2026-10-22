// Language of the interface: English (the default) and Italian (i18next), chosen by whoever uses the app
// and remembered by the browser (at the first visit the one of the browser: Italian if it asks for it,
// otherwise English). Texts are keyed by the English phrase: `t('Sign in')`; placeholders are written
// {name}; with `count` i18next picks the plural form (`key_one`, `key_other` in the dictionaries).
// Server errors are translated from their code (`errors.<code>`), otherwise the message of the server
// stays.

import { useSyncExternalStore } from 'react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { setErrorTranslator } from '../api.ts'
import { EN } from './locales/en.ts'
import { IT } from './locales/it.ts'

export type Lang = 'it' | 'en'
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'it', name: 'Italiano' },
]

const KEY = 'msk_lang'
function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'it' || v === 'en') return v
  } catch {
    /* storage not available */
  }
  return navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en'
}

void i18next.use(initReactI18next).init({
  lng: initial(),
  // without a translation the English phrase stays, which is the key
  fallbackLng: false,
  resources: { it: { translation: IT }, en: { translation: EN } },
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
  initAsync: false,
})
document.documentElement.lang = i18next.language

setErrorTranslator((code, message) => {
  const k = code ? `errors.${code}` : ''
  return k && i18next.exists(k) ? i18next.t(k) : message
})

export function setLang(l: Lang) {
  void i18next.changeLanguage(l)
  document.documentElement.lang = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* storage not available */
  }
}

export function lang(): Lang {
  return i18next.language === 'it' ? 'it' : 'en'
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      i18next.on('languageChanged', f)
      return () => i18next.off('languageChanged', f)
    },
    lang,
  )
}

/** The text in the chosen language (the key is the English phrase). */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  return i18next.t(key, vars)
}

/** A number in the format of the chosen language. */
export function fmtNumber(n: number, o?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(lang(), o).format(n)
}

/** A date (and time) in the format of the chosen language. */
export function fmtDay(iso: string | null | undefined, o: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(lang(), o).format(d)
}
