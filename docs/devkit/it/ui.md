# Riferimento della UI

La UI di un plugin è una pagina web (Vite e TypeScript nel template) in `ui/`, compilata in `ui/dist`, che la shell mostra
in un iframe sull'**origine non fidata**. Parla con l'host solo tramite il bridge postMessage del pacchetto npm
`@mosaikit/plugin-api` (plugin API 1). Sorgenti: `ui/plugin-api/src`; è pubblico solo ciò che esporta `src/index.ts`.
Architettura §8.4 e §8.11. Versione inglese: [../ui.md](../ui.md).

```ts
import '@mosaikit/plugin-api/style.css'
import { connect, mountCrud, errText } from '@mosaikit/plugin-api'

const msk = await connect()        // handshake: API, lingua, tema, modo, utente, organizzazione
mountCrud(document.getElementById('app')!, msk, 'notes', { title: 'Notes' })
```

## `connect()` e `Msk`

`connect()` legge il parametro `host` dell'URL dell'iframe (la pagina va aperta dentro Mosaikit), manda `hello` con
`{ api: API_VERSION }`, applica lingua, modo e tema a `<html>` e restituisce un `Msk`. Ogni messaggio va solo all'origine
dell'host ed è accettato solo da essa. Una chiamata che non riceve risposta in 120 s fallisce con
`the host did not answer <op>`.

| Membro | Cosa |
|---|---|
| `msk.api` | la plugin API che l'host parla |
| `msk.user` | `{ id, username, name }` (assente nei link pubblici) |
| `msk.tenant` | `{ slug, name, role: 'manager' \| 'member' }` |
| `msk.plugin` | `{ id, version }` |
| `msk.perms`, `msk.can(key)` | permessi della persona nel plugin; servono a nascondere ciò che non può fare (kernel e logica li applicano comunque). Host più vecchio: tutto consentito |
| `msk.context` | `{ lang, preset, mode, preference, contrast?, theme }`, aggiornato a ogni cambiamento |
| `msk.onContext(fn)` | chiamata quando cambiano lingua, tema o modo; restituisce la funzione per smettere |
| `msk.at` | il posto in cui si è aperta la pagina (da una notifica, o il `place` di una voce `[[nav]]`) |
| `msk.tab` | in una pagina di estensione aperta come scheda: `{ base, resource, item, key, level }` |
| `msk.isPublic`, `msk.publicResource`, `msk.publicGet()` | visualizzatore dei link pubblici (`public_view`) |

### Operazioni

| Chiamata | Cosa |
|---|---|
| `msk.crud(resource).list({ filter, parent, limit, cursor, sort, dir })` | le righe, l'ultima modificata per prima; tutte (fino a 5.000) o una pagina con `limit` (la successiva con `cursor` = il `next` precedente); `sort`, un campo dichiarato non nascosto oppure `created_at`, `updated_at`, `owner_name`, ordina tutta la lista; un campo sconosciuto è `sort_unknown` |
| `.get(id)`, `.create(values, parent?)`, `.update(id, values)`, `.remove(id)` | una riga; ognuna è limitata a questo plugin e gira con la sessione |
| `msk.call(name, args)` | un comando della logica |
| `msk.files.*` (`list`, `mkdir`, `upload`, `rename`, `move`, `copy`, `remove`, `blob`, `zip`, `url`) | l'API dei file, solo con `[permissions] files` |
| `msk.content.upload(id, zip)`, `.url(id)` | contenuto di cartelle, solo con `content` |
| `msk.web.probe(url, image?)` | se la pagina si può incorporare, il suo titolo e la sua immagine; solo con `web`. Sperimentale |
| `msk.resource(id)` | metadati di un elemento (proprietario, livello, dimensione…) |
| `msk.share(id)` | la finestra di condivisione dell'host |
| `msk.notify({ title, body?, at?, resource? })` | una notifica; restituisce quante persone l'hanno ricevuta. Sperimentale |
| `msk.toast(text, error?)`, `msk.confirm(text)` | un avviso; la finestra di conferma dell'host |
| `msk.extensions(resource)` | `list`, `values(ids)`, `set(id, ext, values)`, `action(id, ext, key)`, `mountTab(el, id, ext, tab)` |
| `msk.tabClient()` | in una pagina scheda: `item()`, `values()`, `set(values)`, `action(key)`, `resize(h)`, `autoResize(el?)` |
| `msk.onEvent(fn)` | ogni evento dell'host; vedi sotto |

Le righe di `crud.list` hanno `id, values, owner_id, owner_name, my_level ('read'|'write'|'manage'), shared, parent_id,
created_at, updated_at`; il risultato ha anche `fields` (con etichette e etichette delle scelte nella lingua dell'host) e,
con `limit`, `next` e `total`.

### Errori

Ogni fallimento è un `BridgeError` con `message` (nella lingua dell'host), `code`, `status` (HTTP, se la richiesta è
arrivata al server) e `serverMessage`. **Si ragiona su `code`, mai sul testo.** Il tipo `ErrorCode` elenca i codici della
piattaforma e resta aperto per i codici scelti dalla logica.

| Codice | Significato |
|---|---|
| `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `too_many`, `internal` | la categoria, quando non c'è un codice più preciso |
| `missing_permission` | il profilo di permesso non lo consente |
| `plugin_off`, `base_off`, `plugin_unavailable` | il plugin (o quello che un'estensione estende) non è acceso o non è disponibile |
| `plugin_error` | sollevato dalla logica senza codice (se la logica ne ha dato uno, arriva il suo) |
| `quota_exceeded`, `content_too_large`, `too_many_rows`, `too_many_notifications` | limiti |
| `sort_unknown`, `item_exists` | lista ed elementi |
| `web_blocked`, `web_unreachable`, `web_url` | `msk.web.probe` |
| `maintenance`, `server_unavailable`, `unexpected` | la piattaforma e la connessione |
| `incompatible_api` | l'handshake: `isIncompatible(e)` lo distingue |

`errText(e, lang?)` dà il testo per la persona: il messaggio tradotto dall'host, o la traduzione del codice quando l'host
non ha potuto, in inglese o italiano.

### Eventi

`context` (lingua, tema, modo: usare `msk.onContext`), `theme` (**deprecato**, le stesse variabili di `context`, ancora
inviato nell'API 1, rimosso nell'API 2), `ext.changed` `{ extension, id }`, `ext.tab.height` `{ handle, height }` (gestito
da `mountTab`).

## `mountCrud(root, msk, resource, options)`

Disegna una pagina intera dal manifesto: l'intestazione (`pageHead`), una casella di filtro, una `gridTable` (o le tue
viste) a pagine di 100 righe, un pannello di dettaglio con il modulo, condivisione, eliminazione, campi e schede delle
estensioni, e lo stato vuoto. Parla inglese, italiano e spagnolo da sé e segue i cambi di lingua. Restituisce una
funzione che la chiude.

| Opzione | Tipo | Cosa |
|---|---|---|
| `title` | string | il titolo della pagina; **darlo sempre** (`validate --strict` avvisa senza) |
| `section` | string | la sottosezione aperta, l'intestazione legge «titolo › sezione» |
| `columns` | string[] | campi nella tabella; predefiniti i campi visibili, al massimo 5 |
| `newLabel` | string | etichetta del pulsante nuovo; predefinita «New» |
| `where` | `(row) => boolean` | mostra solo le righe che passano: una pagina della navigazione («Mie», un tag) |
| `views` | `CrudView[]` | un disegno tuo accanto al pannello di dettaglio al posto della tabella; più di una aggiunge un selettore |
| `empty` | `{ art?, title?, text?, actions? }` | lo stato vuoto; predefiniti un'immagine generica, «Nothing here yet», «Create the first one to get started.» e il pulsante nuovo |
| `panel` | `'selected' \| 'always'` | il pannello di dettaglio solo mentre un elemento è aperto (predefinito), o sempre. Sperimentale |
| `detail` | `(row, box) => void` | strumenti tuoi nel dettaglio di un elemento esistente |
| `reader` | `(ctx: ItemCtx) => HTMLElement` | una vista di sola lettura dell'elemento aperto, con «Modifica» per i campi |
| `bar` | `HTMLElement[]` | una barra tua sopra la lista, sotto l'intestazione |
| `editor` | `(ctx: EditorCtx, box) => void` | una parte tua del modulo; i campi nascosti si impostano con `ctx.set` |
| `onLoad` | `(rows) => void` | chiamata con le righe a ogni caricamento della lista |

`CrudView`: `{ key, label, kind: 'list' | 'cards' | 'flow' | 'board', item(ctx), box?(ctx, el), columns? }`; un `board`
richiede `columns: [{ key, label(lang), match(row) }]`. `ItemCtx`: `row`, `fields`, `text(key)`, `value(key)`, `selected`,
`canWrite`, `lang`, `update(values)`. `EditorCtx`: `row` (null per un elemento nuovo), `value`, `set`, `canWrite`, `lang`.

I campi nascosti non sono colonne né campi del modulo; i campi che aggiungono le estensioni compaiono come colonne e nel
dettaglio, e le loro azioni come pulsanti. L'ordinamento di tutta la lista lo fa il server per i campi dichiarati e per il
proprietario.

## `gridTable(options)`

La tabella delle liste proprie: riga d'intestazione fissa, scorrono solo le righe, titoli ordinabili, il piede come ultima
riga (`.msk-grid`).

```ts
const grid = gridTable<Row>({
  label: 'Expenses',                       // nome accessibile
  columns: [
    { key: 'title', title: 'Title', sort: (r) => String(r.values.title) , cell: (r) => String(r.values.title) },
    { key: 'amount', title: 'Amount', align: 'right', width: '8rem', sort: (r) => Number(r.values.amount), cell: (r) => String(r.values.amount) },
  ],
})
card.append(grid.el)
grid.set(rows, footButton, 'No expenses')   // disegna le righe
```

| Opzione | Cosa |
|---|---|
| `columns` | `{ key, title, width?, align?: 'right', sort?, serverSort?, cell, className? }`; `width` è una traccia di griglia CSS, predefinita `minmax(7rem,1fr)`; un titolo è un pulsante solo con `sort` (locale) o `serverSort` (server) |
| `label` | nome accessibile della tabella |
| `decorate(row, tr)` | chiamata per ogni riga: classi, listener, `tabindex` |
| `local` | `{ step, more, of }`: una lista tutta in memoria mostrata a pagine, la successiva quando il piede entra in vista |
| `server` | `{ onSort({ field, dir } \| null) }`: righe paginate da un server che le ordina; ordinano solo le colonne con `serverSort` |

Restituisce `{ el, scroller, set(rows, foot?, empty?), columns(cols) }`. I numeri si ordinano come numeri, il testo secondo
la lingua con i numeri interni come numeri, i valori vuoti per ultimi; `aria-sort` è mantenuto.

## `emptyState`, `filteredEmpty`

```ts
emptyState({ art: 'tasks', title: 'No tasks yet', text: 'Add your first task.', actions: [newButton] })
filteredEmpty('No result', 'Clear filters', () => clear())   // un filtro che non trova nulla
```

`art` è `documents`, `maps`, `notes`, `tasks`, `contacts`, `apps` o `generic`. Mai una semplice riga «nessun elemento»
([Linee guida della UI](ui-guidelines.md)).

## `pageHead`, `pageBody`

```ts
document.body.append(
  pageHead({ title: 'Insights', section: 'Overview', sub: '12 expenses', filters: [search], actions: [newButton] }),
  pageBody(content),            // la parte che scorre
)
```

`pageHead` disegna l'intestazione di una pagina come quella della shell: titolo con la sottosezione, la riga sotto, filtri e
azioni a destra (l'azione principale per ultima). L'intestazione non scorre mai; `pageBody` è `.msk-body`, la parte che
scorre. Esportati anche: `avatar(name, big?)`, `chip(text, tone?)` (`ok`, `err`, `acc`), `el` (un piccolo costruttore di
elementi), `watchTableScroll()`.

## Token di tema e stile

`connect()` applica il tema dell'host a `<html>`: `lang`, `data-mode` (`light` o `dark`), `data-preset`,
`data-contrast` (`more` per l'alto contrasto), `color-scheme` e le variabili CSS. Importare `@mosaikit/plugin-api/style.css`
per lo stile di base e usare le variabili, mai colori fissi, così un plugin segue ogni tema, il modo scuro e l'alto
contrasto:

| Variabile | Uso |
|---|---|
| `--bg`, `--panel`, `--panel2` | pagina, scheda, superficie rialzata |
| `--fg`, `--dim` | testo, testo secondario |
| `--line` | bordi e divisori |
| `--acc`, `--acc-soft`, `--acc-line`, `--on-acc` | accento, il suo riempimento e la sua linea tenui, testo sull'accento |
| `--ok`, `--err`, `--on-err` | successo, errore, testo sul colore d'errore |
| `--font-ui`, `--font-mono` | caratteri |

Le classi dello stile di base (`.msk-btn`, `.msk-chip`, `.msk-grid`, `.msk-pagehead`, `.msk-body`, `.msk-emptystate`,
`.msk-field`, `.msk-toolbar`…) sono quelle che usa `mountCrud`; riusarle per le pagine proprie.

## i18n

- I testi del **manifesto** (nomi, etichette dei campi, etichette dei KPI, nav) si traducono in `[i18n.<lang>]`
  ([Riferimento del manifesto](manifest.md)); l'host li manda nella lingua della persona.
- I testi **dentro la tua UI** sono tuoi: leggere `msk.context?.lang` all'avvio e ridisegnare su `msk.onContext`. Il template
  ha `ui/src/i18n.ts` con `en`, `it`, `es`. `mountCrud` ha testi propri nelle stesse tre lingue e ripiega sull'inglese per
  un altro codice (un plugin lingua può aggiungere qualsiasi lingua).
- Date e numeri: formattare con `Intl` e `msk.context.lang`.

## Accessibilità

La shell è controllata con axe e con il contratto di layout; le pagine dei plugin devono tenere lo stesso livello.

- Usare controlli veri (`button`, `a`, `input` con `label`), un `h1` per pagina (lo fa `pageHead`) e il focus visibile.
- Dare alle tabelle un nome accessibile (`label` di `gridTable`) e tenere i titoli come pulsanti con `aria-sort`.
- Colori solo dalle variabili (il contrasto segue il tema); non indicare mai lo stato solo con il colore (`chip` ha il testo).
- Rispettare `data-contrast="more"` e `color-scheme`; non impostarli da sé.
- Tutto funziona a 390 px di larghezza, senza overflow orizzontale.
- Collaudare: `expectAccessible(page)` di `@mosaikit/plugin-testing` esegue axe sulla pagina e sul frame del plugin
  ([Test](testing.md)).
