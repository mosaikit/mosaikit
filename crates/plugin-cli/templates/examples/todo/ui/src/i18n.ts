// STEP 6 - the texts of the UI. English is the default; Italian and Spanish follow the language of the host
// (`msk.context.lang`). A text that a language does not have falls back to English.
// The names of the fields, of the pages and of the KPIs are translated in plugin.toml (`[i18n.<lang>]`).

const en = {
  title: 'Tasks',
  newLabel: '＋ New task',
  due: 'Due {d}',
  mark: 'Mark as done: {t}',
  reopen: 'Reopen: {t}',
  late: 'Overdue',
  list: 'List',
  cards: 'Cards',
  emptyTitle: 'No tasks yet',
  emptyText: 'Add what has to be done and when.',
  failed: 'Cannot start the UI of the plugin: ',
}

type Texts = Record<keyof typeof en, string>

const it: Texts = {
  title: 'Attività',
  newLabel: '＋ Nuova attività',
  due: 'Scade {d}',
  mark: 'Segna come fatta: {t}',
  reopen: 'Riapri: {t}',
  late: 'In ritardo',
  list: 'Elenco',
  cards: 'Schede',
  emptyTitle: 'Ancora nessuna attività',
  emptyText: 'Aggiungi cosa c’è da fare e per quando.',
  failed: 'Impossibile avviare la UI del plugin: ',
}

const es: Texts = {
  title: 'Tareas',
  newLabel: '＋ Nueva tarea',
  due: 'Vence {d}',
  mark: 'Marcar como hecha: {t}',
  reopen: 'Reabrir: {t}',
  late: 'Atrasadas',
  list: 'Lista',
  cards: 'Tarjetas',
  emptyTitle: 'Todavía no hay tareas',
  emptyText: 'Añade lo que hay que hacer y para cuándo.',
  failed: 'No se pudo iniciar la interfaz del plugin: ',
}

const TEXTS: Record<string, Texts> = { en, it, es }

/** The texts for a language code (`it`, `es-MX`, ...); English when the language is not known. */
export function texts(lang: string | undefined): Texts {
  const code = (lang ?? 'en').toLowerCase().split('-')[0] ?? 'en'
  return { ...en, ...TEXTS[code] }
}

/** Replaces `{name}` in a text: `fill('Due {d}', { d: 'Mon' })`. */
export function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}
