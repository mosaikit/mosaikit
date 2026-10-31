// The texts of the UI. English is the default; Italian and Spanish follow the language of the host
// (`msk.context.lang`). A text that a language does not have falls back to English.
// The names of the fields, of the pages and of the KPIs are translated in plugin.toml (`[i18n.<lang>]`).

const en = {
  title: 'Expenses',
  newLabel: '＋ New expense',
  overview: 'Overview',
  chartName: 'Total of the expenses by category',
  food: 'Food',
  travel: 'Travel',
  home: 'Home',
  other: 'Other',
  count: '{n} expenses in {c} categories',
  emptyTitle: 'No expenses yet',
  emptyText: 'Add the first expense, or a sample one, to see the chart.',
  emptyAction: 'Add a sample expense',
  sampleTitle: 'Coffee',
  failed: 'Cannot start the UI of the plugin: ',
}

type Texts = Record<keyof typeof en, string>

const it: Texts = {
  title: 'Spese',
  newLabel: '＋ Nuova spesa',
  overview: 'Riepilogo',
  chartName: 'Totale delle spese per categoria',
  food: 'Cibo',
  travel: 'Viaggi',
  home: 'Casa',
  other: 'Altro',
  count: '{n} spese in {c} categorie',
  emptyTitle: 'Ancora nessuna spesa',
  emptyText: 'Aggiungi la prima spesa, o una di prova, per vedere il grafico.',
  emptyAction: 'Aggiungi una spesa di prova',
  sampleTitle: 'Caffè',
  failed: 'Impossibile avviare la UI del plugin: ',
}

const es: Texts = {
  title: 'Gastos',
  newLabel: '＋ Nuevo gasto',
  overview: 'Resumen',
  chartName: 'Total de los gastos por categoría',
  food: 'Comida',
  travel: 'Viajes',
  home: 'Casa',
  other: 'Otros',
  count: '{n} gastos en {c} categorías',
  emptyTitle: 'Todavía no hay gastos',
  emptyText: 'Añade el primer gasto, o uno de prueba, para ver el gráfico.',
  emptyAction: 'Añadir un gasto de prueba',
  sampleTitle: 'Café',
  failed: 'No se pudo iniciar la interfaz del plugin: ',
}

const TEXTS: Record<string, Texts> = { en, it, es }

/** The texts for a language code (`it`, `es-MX`, ...); English when the language is not known. */
export function texts(lang: string | undefined): Texts {
  const code = (lang ?? 'en').toLowerCase().split('-')[0] ?? 'en'
  return { ...en, ...TEXTS[code] }
}

/** Replaces `{name}` in a text. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

/** The text of a category (`food`, `travel`...); an unknown one is shown as it is. */
export function categoryLabel(t: Texts, category: string): string {
  return (t as Record<string, string>)[category] ?? category
}
