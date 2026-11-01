# Linee guida della UI

Le regole di [../../refactoring-ui.md](../../refactoring-ui.md) (in inglese) che valgono per le pagine dei plugin. Una
pagina di plugin deve avere l'aspetto e il comportamento di una pagina della shell: la stessa intestazione, la stessa
tabella, lo stesso stato vuoto. Il **contratto di layout** della shell (`tests/e2e/specs/15-layout-contract.spec.ts`)
gira sulle pagine di ogni app installata; gli id delle regole qui sotto sono i suoi. `mountCrud` le rispetta tutte da sé:
le pagine proprie si scrivono con gli stessi pezzi. Versione inglese: [../ui-guidelines.md](../ui-guidelines.md).

| Pezzo | Uso | Pacchetto |
|---|---|---|
| Intestazione | `pageHead({ title, section?, sub?, filters?, actions? })` e `pageBody(...)` | `@mosaikit/plugin-api` |
| Tabella | `gridTable({ columns, label })` | idem |
| Stato vuoto | `emptyState({ art, title, text, actions })`, `filteredEmpty(...)` | idem |
| Pagina CRUD intera | `mountCrud(root, msk, resource, { title, ... })` | idem |
| Colori, caratteri | le variabili CSS del tema | `@mosaikit/plugin-api/style.css` |

## Intestazione (R-1, R-2, R-5, R-6, R-7)

- Una intestazione per pagina, costruita con `pageHead`: il titolo della pagina (la voce della navigazione) e, per una
  sottosezione aperta, «Pagina › Sottosezione» (`section`).
- L'intestazione e la riga di filtri sotto sono fissate e interamente visibili: non si muovono quando il contenuto scorre.
  Il contenuto sotto (`pageBody`, `.msk-body`) è ciò che scorre.
- Il filtro e l'unica azione principale («Nuovo …») stanno sulla prima riga, **allineati a destra, il filtro subito a
  sinistra del pulsante**; su un telefono vanno a capo sotto il titolo. Le altre azioni vanno prima di quella principale,
  mai dopo.
- Stesso carattere, altezza e spaziatura dell'intestazione dell'host: non aggiungere stili propri a `h1`.

## Tabella (R-3, R-11, R-12)

- Una pagina di lista o tabella non scorre nel suo insieme: la tabella riempie l'altezza rimasta e scorre **dentro di sé**,
  con una riga d'intestazione fissa; scorrono solo le righe.
- Le liste si disegnano con `gridTable`: titoli di colonna ordinabili (`aria-sort`), numeri ordinati come numeri, e altre
  righe caricate solo quando la fine delle righe entra in vista (il pulsante «Carica altri» resta per la tastiera). Una
  `<table>` scritta a mano è un avviso di `validate --strict`.
- Una casella di filtro che cerca in ogni campo visibile sta nell'intestazione; per una lista paginata dal server filtro e
  ordinamento restano sul server (`server` e `serverSort`).
- Matrici e griglie di input (permessi, quote) non sono liste di record: usare la classe `msk-matrix` con riga
  d'intestazione e prima colonna fisse.

## Stato vuoto (R-10)

Una pagina o una lista senza nulla dentro **non** è mai una riga «Nessun elemento». È lo stato vuoto illustrato: un'immagine,
un titolo in grassetto, una breve riga grigia e i pulsanti di ciò che si può fare, tra cui l'**azione principale della
pagina ripetuta**. Centrato nell'area del contenuto, e non la fa mai scorrere.

- `emptyState({ art, title, text, actions })`; scegliere `art` tra `documents`, `maps`, `notes`, `tasks`, `contacts`,
  `apps`, `generic`.
- Una lista vuota **solo per un filtro** non è uno stato vuoto: `filteredEmpty(message, 'Clear filters', onClear)` dà il
  piccolo messaggio semplice con «Cancella i filtri».
- Gli errori tengono un riquadro semplice.
- `mountCrud` lo mostra di default; si cambia con l'opzione `empty`. Ogni testo deve essere traducibile.

## Pannello di dettaglio

Una pagina fatta con `mountCrud` e `views` mostra il pannello di dettaglio solo mentre un elemento è aperto o se ne sta
scrivendo uno nuovo (`panel: 'selected'`, il predefinito): altrimenti la lista ha tutta la larghezza. Cliccare un altro
elemento cambia il pannello; Annulla, Esc ed Elimina lo chiudono. Il pannello è una regione con nome; il focus entra quando
si apre e torna sull'elemento quando si chiude; su un telefono è un foglio sopra la lista. Un'anteprima di sola lettura di
un elemento (`reader`) non è un editor.

## Colori e densità

- Usare le variabili del tema (`--bg`, `--panel`, `--fg`, `--dim`, `--line`, `--acc`, `--ok`, `--err`, `--on-acc`,
  `--on-err`), mai colori fissi: l'host le cambia con il tema, il modo scuro e l'alto contrasto.
- Tenere il contrasto almeno AA; non indicare lo stato solo con il colore (`chip` ha il testo).
- La densità segue lo stile della piattaforma (`data-style-*`): non impostare raggio degli angoli, carattere o stile delle
  schede propri.
- Nessun overflow orizzontale a 390 px di larghezza (R-9); nessuna fascia vuota tra la barra superiore e l'intestazione (R-2).

## Lingua

I testi sono in inglese con le traduzioni (`i18n.ts` nel plugin, `[i18n.<lang>]` nel manifesto). Usare il glossario della
shell: **Tenant** (in italiano organizzazione), **Tenant Manager**, **Plugin** (tipi App, Servizio, Estensione), **Registro**
(Log), **Accesso** (Sign-in). Un plugin è un plugin per ogni ruolo.

## Verifica

```
cargo xtask e2e -- specs/15-layout-contract.spec.ts      # nel repository di Mosaikit
mosaikit-plugin validate --strict                        # il contratto di layout delle pagine mountCrud, sui sorgenti
```

`expectAccessible(page)` di `@mosaikit/plugin-testing` esegue axe sulla pagina ([Test](testing.md)).
