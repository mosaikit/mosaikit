// Lingua dell'interfaccia: italiano e inglese (i18next), scelta da chi usa l'app e ricordata dal browser
// (al primo accesso quella del browser). I testi sono indicizzati dalla frase italiana: `t('Accedi')`;
// i segnaposto si scrivono {nome}; con `count` i18next sceglie la forma plurale (`chiave_one`,
// `chiave_other` nei dizionari). Gli errori del server si traducono dal loro codice (`errors.<codice>`),
// altrimenti resta il messaggio del server.

import { useSyncExternalStore } from 'react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { setErrorTranslator } from '../api.ts'
import { EN } from './locales/en.ts'
import { IT } from './locales/it.ts'

export type Lang = 'it' | 'en'
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'it', name: 'Italiano' },
  { id: 'en', name: 'English' },
]

const KEY = 'msk_lang'
function initial(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'it' || v === 'en') return v
  } catch {
    /* storage non disponibile */
  }
  return navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en'
}

void i18next.use(initReactI18next).init({
  lng: initial(),
  // senza traduzione resta la frase italiana, che e' la chiave
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
    /* storage non disponibile */
  }
}

export function lang(): Lang {
  return i18next.language === 'en' ? 'en' : 'it'
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

/** Il testo nella lingua scelta (la chiave e' la frase italiana). */
export function t(it: string, vars: Record<string, string | number> = {}): string {
  return i18next.t(it, vars)
}

/** Un numero nel formato della lingua scelta. */
export function fmtNumber(n: number, o?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(lang(), o).format(n)
}

/** Una data (e ora) nel formato della lingua scelta. */
export function fmtDay(iso: string | null | undefined, o: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(lang(), o).format(d)
}
