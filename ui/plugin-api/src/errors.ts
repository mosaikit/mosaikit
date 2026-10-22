// Text of an error for the person: the host already sends it in its language; when it could not (an older
// host, or a code the host does not know) the plugin side translates the codes a plugin UI meets most,
// in the language of the host (`msk.context.lang`, or `<html lang>` applied by `applyContext`).

import { BridgeError } from './bridge.ts'

const CODES: Record<'en' | 'it', Record<string, string>> = {
  en: {
    missing_permission: 'Your permission profile does not allow it',
    plugin_off: 'This plugin is not turned on in the tenant',
    base_off: 'The plugin this extension extends is turned off',
    quota_exceeded: 'The tenant has reached one of its quotas: nothing more can be added',
    maintenance: 'The platform is under maintenance: try again later',
    forbidden: 'You are not allowed to do this',
    not_found: 'Not found',
    server_unavailable: 'The server is not responding. Try again shortly',
  },
  it: {
    missing_permission: 'Il tuo profilo di permesso non lo consente',
    plugin_off: 'Questo plugin non è acceso nel tenant',
    base_off: 'Il plugin che questa estensione estende è spento',
    quota_exceeded: 'Il tenant ha raggiunto una delle sue quote: non si può aggiungere altro',
    maintenance: 'La piattaforma è in manutenzione: riprova più tardi',
    forbidden: 'Non hai i permessi per farlo',
    not_found: 'Non trovato',
    server_unavailable: 'Il server non risponde. Riprova tra poco',
  },
}

function current(): string {
  return typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en'
}

/**
 * The text of an error in `lang` (default: the language of the page). A message the host translated is
 * kept; an untranslated one is replaced by the translation of its code when there is one, otherwise the
 * message of the server stays.
 */
export function errorText(e: unknown, lang: string = current()): string {
  if (!(e instanceof Error)) return String(e)
  if (e instanceof BridgeError && e.code) {
    const untranslated = e.serverMessage === undefined || e.message === e.serverMessage
    const t = CODES[lang.toLowerCase().startsWith('it') ? 'it' : 'en'][e.code]
    if (untranslated && t) return t
  }
  return e.message
}
