// Language of the interface: English (the default) and Italian (i18next), chosen by whoever uses the app
// and remembered by the browser (at the first visit the one of the browser: Italian if it asks for it,
// otherwise English). Texts are keyed by the English phrase: `t('Sign in')`; placeholders are written
// {name}; with `count` i18next picks the plural form (`key_one`, `key_other` in the dictionaries).
// Server errors are translated from their code (`errors.<code>`), otherwise the message of the server
// stays. The languages offered and the default one come from the settings of the platform or of the
// tenant (Languages and formats): a choice of the person stays, if the language is still offered.

import { useSyncExternalStore } from 'react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { api, setErrorTranslator, setRequestLanguage } from '../api.ts'
import { EN } from './locales/en.ts'
import { IT } from './locales/it.ts'

// A language is its code: `en` and `it` are built in; the others come from language plugins (see
// refreshLanguages): their texts are fetched when the language is chosen.
export type Lang = string
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'it', name: 'Italiano' },
]
const BUILTIN = ['en', 'it']
const CODE = /^[a-z]{2,3}$/
const loaded = new Set<string>(BUILTIN)

const KEY = 'msk_lang'
function chosen(): Lang | null {
  try {
    const v = localStorage.getItem(KEY)
    if (v && CODE.test(v)) return v
  } catch {
    /* storage not available */
  }
  return null
}
function browser(): Lang {
  return navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en'
}
function initial(): Lang {
  // the language of a plugin is not there yet at start: English until its texts arrive
  const c = chosen() ?? browser()
  return BUILTIN.includes(c) ? c : 'en'
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
setRequestLanguage(i18next.language)
i18next.on('languageChanged', (l) => setRequestLanguage(l))

setErrorTranslator((code, message) => {
  const k = code ? `errors.${code}` : ''
  return k && i18next.exists(k) ? i18next.t(k) : message
})

/** The texts of a language of a plugin, fetched once. */
async function loadLanguage(code: string): Promise<boolean> {
  if (loaded.has(code)) return true
  try {
    const r = await api<{ strings: Record<string, string> }>('GET', `/api/languages/${encodeURIComponent(code)}`)
    i18next.addResourceBundle(code, 'translation', r.strings, true, true)
    loaded.add(code)
    return true
  } catch {
    return false
  }
}

async function switchTo(l: Lang) {
  if (!(await loadLanguage(l))) return
  void i18next.changeLanguage(l)
  document.documentElement.lang = l
  ctxListeners.forEach((f) => f())
}

export function setLang(l: Lang) {
  if (BUILTIN.includes(l)) {
    void i18next.changeLanguage(l)
    document.documentElement.lang = l
  } else void switchTo(l)
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* storage not available */
  }
}

export function lang(): Lang {
  return LANGS.some((l) => l.id === i18next.language) ? i18next.language : 'en'
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

/** Languages and formats of the place where one is (platform or tenant). */
export interface LanguageContext {
  /** languages offered (default: all) */
  enabled?: string[]
  /** default language for whoever did not choose ("auto": the one of the browser) */
  language?: string
  /** format of dates and numbers ("auto": the one of the language) */
  locale?: string
}

let enabled: Lang[] = LANGS.map((l) => l.id)
/** the languages of the plugins installed */
let installed: string[] = []
let lastContext: LanguageContext = {}
let locale = 'auto'
const ctxListeners = new Set<() => void>()

/** The languages offered here, and the default language for new visitors. */
export function setLanguageContext(c: LanguageContext) {
  lastContext = c
  applyContext()
}

/** What is offered: exactly the list of the settings (a language of a plugin is offered once the list names it and
 *  its plugin is installed); without a list, everything there is. */
function applyContext() {
  const c = lastContext
  const known = [...BUILTIN, ...installed]
  const given = (c.enabled ?? []).filter((x) => known.includes(x))
  enabled = given.length > 0 ? given : known
  locale = c.locale && c.locale !== 'auto' ? c.locale : 'auto'
  const own = chosen()
  const def: Lang = c.language && c.language !== 'auto' && enabled.includes(c.language) ? c.language : enabled.includes(browser()) ? browser() : enabled[0]
  const next = own && enabled.includes(own) ? own : enabled.includes(def) ? def : enabled[0]
  if (next !== lang()) {
    if (BUILTIN.includes(next)) {
      void i18next.changeLanguage(next)
      document.documentElement.lang = next
    } else void switchTo(next)
  }
  ctxListeners.forEach((f) => f())
}

/** Asks which languages the language plugins add and offers them in the language menus. */
export async function refreshLanguages() {
  let list: { code: string; name: string }[] = []
  try {
    list = await api<{ code: string; name: string }[]>('GET', '/api/languages')
  } catch {
    return
  }
  installed = list.map((l) => l.code).filter((c) => CODE.test(c) && !BUILTIN.includes(c))
  LANGS.splice(BUILTIN.length, LANGS.length, ...list.filter((l) => installed.includes(l.code)).map((l) => ({ id: l.code, name: l.name })))
  // the one chosen before, whose plugin has just been found
  applyContext()
}
// not in the unit tests: there is no server to ask
if (import.meta.env.MODE !== 'test') void refreshLanguages()

/** The languages offered where one is. */
export function useLanguages(): typeof LANGS {
  useSyncExternalStore(
    (f) => {
      ctxListeners.add(f)
      return () => ctxListeners.delete(f)
    },
    () => enabled.join(),
  )
  return LANGS.filter((l) => enabled.includes(l.id))
}

/** The format of dates and numbers: the one chosen in the settings, otherwise the language's. */
function fmtLocale(): string {
  return locale === 'auto' ? lang() : locale
}

/** The text in the chosen language (the key is the English phrase). */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  return i18next.t(key, vars)
}

/** A number in the format of the chosen language. */
export function fmtNumber(n: number, o?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(fmtLocale(), o).format(n)
}

/** A date (and time) in the format of the chosen language. */
export function fmtDay(iso: string | null | undefined, o: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(fmtLocale(), o).format(d)
}
