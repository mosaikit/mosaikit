// Texts of the UI. English is the default; Italian and Spanish follow the language of the host
// (`msk.context.lang`). A text that a language does not have falls back to English.
// The texts of the manifest (names of the fields, of the KPIs) are translated in `[i18n.<lang>]`
// of plugin.toml, not here.

const en = {
  title: '{{label}}',
  newLabel: '＋ New',
  emptyTitle: 'Nothing here yet',
  emptyText: 'Add the first item to start.',
  failed: 'Cannot start the UI of the plugin: ',
}

type Texts = Record<keyof typeof en, string>

const it: Texts = {
  title: '{{label}}',
  newLabel: '＋ Nuovo',
  emptyTitle: 'Ancora niente',
  emptyText: 'Aggiungi il primo elemento per iniziare.',
  failed: 'Impossibile avviare la UI del plugin: ',
}

const es: Texts = {
  title: '{{label}}',
  newLabel: '＋ Nuevo',
  emptyTitle: 'Todavía no hay nada',
  emptyText: 'Añade el primer elemento para empezar.',
  failed: 'No se pudo iniciar la interfaz del plugin: ',
}

const TEXTS: Record<string, Texts> = { en, it, es }

/** The texts for a language code (`it`, `es-MX`, ...); English when the language is not known. */
export function texts(lang: string | undefined): Texts {
  const code = (lang ?? 'en').toLowerCase().split('-')[0] ?? 'en'
  return { ...en, ...TEXTS[code] }
}
