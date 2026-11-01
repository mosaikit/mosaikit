# Estensioni e layout

Tre tipi di plugin che aggiungono alla piattaforma senza essere un'app: **extension** (aggiunge a un altro plugin),
**layout** (dispone la shell) e **language** (una lingua dell'interfaccia). Architettura §8.9 e §14.1.
Versione inglese: [../extensions-layouts.md](../extensions-layouts.md).

```
mosaikit-plugin new acme-priority --variant extension        # oppure: --example note-priority
mosaikit-plugin new acme-layout   --variant layout
mosaikit-plugin new lang-fr       --variant language --lang fr
```

## Estensioni

Un'estensione (`kind = "extension"`) aggiunge campi, azioni e schede agli **elementi di una risorsa di un altro plugin**:

```toml
kind = "extension"

[extends]
plugin = "com.mosaikit.notes"
min_version = "0.4.0"        # la prima versione con i punti di estensione; predefinita 0.0.0

[[extension.fields]]         # campi sugli elementi
resource = "notes"
key = "priority"
label = "Priority"
kind = "choice"
options = ["low", "normal", "high"]
option_labels = { low = "Low", normal = "Normal", high = "High" }
# anche: multiline, hidden

[[extension.actions]]        # pulsanti nel dettaglio di un elemento
resource = "notes"
key = "mark_reviewed"
label = "Mark as reviewed"
set = { reviewed = true, reviewed_by = "$user" }    # oppure: command = "<comando della sua logica>"

[[extension.tabs]]           # una scheda nel dettaglio (richiede [ui])
resource = "notes"
key = "review"
label = "Review"             # al massimo 40 caratteri
icon = "clipboard-check"     # facoltativa
page = "tab.html"            # un file .html della sua UI; predefinita l'entry
```

Regole:

- `[extends]` è obbligatorio, e `[extension]` è solo per questo tipo. Il plugin esteso non può essere l'estensione stessa.
- Le chiavi dei campi sono uniche nell'estensione e non possono essere `resource_id`, `tenant_id`, `id`, `owner`, `my_level`.
- Un'azione ha **o** `set` **o** `command`. `set` scrive i valori dati: `$user` è il nome della persona, `$today` la data;
  ogni chiave deve essere un campo di questa estensione per quella risorsa, e il valore deve adattarsi al tipo (un bool per
  `bool`, un numero per `number`, una stringa per gli altri). Un `command` è il nome di un comando della logica propria
  dell'estensione (lettere, cifre, `_`, `.`, `-`); le azioni con comando sono sperimentali.
- Un'azione con comando riceve `{ resource, resource_id, item, values }` (l'elemento come lo vede la persona) e risponde
  `{ "set": { … } }`; ogni valore è controllato sui campi dichiarati.
- Una scheda richiede `[ui]`.
- L'estensione e la sua base devono essere entrambe **accese** nell'organizzazione, e la persona ha bisogno di `use`
  sull'estensione; se la base è spenta l'errore è `base_off`.

**Il contratto è stretto.** Un'estensione non legge mai le tabelle del plugin che estende. Il kernel conserva i suoi valori,
un insieme per elemento ed estensione, rimossi con l'elemento e con l'estensione, e li controlla con i **permessi
dell'elemento**: chi vede l'elemento vede i valori, chi può modificarlo li cambia ed esegue le azioni. La UI del plugin
esteso li legge con `msk.extensions('notes')`; `mountCrud` mostra i campi come colonne e nel dettaglio (non quelli
`hidden`) e le azioni come pulsanti, senza codice da parte tua.

**Una scheda** è una pagina dell'estensione mostrata nel dettaglio di un elemento, in un frame proprio **senza
`allow-same-origin`**: la sua origine è opaca, quindi nessuno dei due plugin entra nella pagina, nello storage o nei cookie
dell'altro, e la pagina non può usare `localStorage`. In quella pagina `msk.tab` dice dov'è e `msk.tabClient()` legge
l'elemento (`item()`), legge e cambia i valori (`values()`, `set()`, `action(key)`) e tiene l'altezza (`autoResize()`); il
kernel controlla il livello della persona a ogni chiamata. Dopo una modifica il plugin base riceve `ext.changed`.
Un'estensione con una UI non è un'app: non sta nella barra laterale.

Traduzioni: `[i18n.<lang>] extension = { fields = {…}, actions = {…}, tabs = {…} }`. L'esempio ufficiale è
`com.mosaikit.note-review` (due campi, un'azione e una scheda).

## Layout

Un layout (`kind = "layout"`) decide **dove stanno gli slot della shell**: non cambia mai ciò che fanno e non esegue
codice. Non ha risorse, `[ui]`, KPI né `[search]`. File:

```
plugin.toml
layout/layout.toml      la disposizione
layout/layout.css       stile facoltativo, controllato all'installazione e limitato al layout (al massimo 64 KiB)
layout/images/*.png     immagini facoltative (PNG, WebP o SVG sicuro; al massimo 8, ciascuna al massimo 512 KB)
```

`layout.toml` (chiavi sconosciute rifiutate):

```toml
pattern = "tabs"            # rail | sidebar | drawer | launcher | areas | tabs   (obbligatorio)
band_image = "band.png"     # facoltativa: un PNG di images/ sotto la banda

[band]
brand = true                # logo e nome nella banda (predefinito true)
breadcrumb = false          # predefinito false
search = "center"           # center | wide
tenant = "band"             # band | nav: dove sta il selettore dell'organizzazione

[nav]
card = false                # la navigazione come scheda fluttuante

[phone]
nav = "drawer"              # drawer | launcher: la navigazione su uno schermo di 900 px o meno

[style]                     # stile predefinito; vince quello della piattaforma o dell'organizzazione
tabs = "underline"
```

Variabili di stile e valori: `radius` (`square`, `medium`, `round`), `density` (`compact`, `comfortable`), `font`
(`system`, `humanist`, `serif`), `tabs` (`underline`, `pill`, `boxed`), `buttons` (`filled`, `outline`, `soft`). Una
variabile o un valore sconosciuto è rifiutato.

**Controllo del CSS.** Solo proprietà in lista consentita; `display`, `visibility`, `position`, `content`, `z-index`,
`@import`, `@font-face`, escape e `<` sono rifiutati; `url()` solo verso le immagini del pacchetto. Le regole sono limitate
sotto `.mskl-<id>` (i punti diventano trattini), quindi un layout stila le classi degli slot (`msk-band`, `msk-nav`,
`msk-nav-item`, `msk-tab-item`, `msk-launcher-tile`, `msk-main`…) e nient'altro. Landmark, il link «Salta al contenuto» e
l'ordine da tastiera restano quelli della shell.

**Immagine della banda.** PNG, al massimo 512 KB; il kernel stende sopra il colore della banda come velo finché il testo ha
un contrasto di 4,5:1, e rifiuta un'immagine troppo chiara anche con il velo più forte (`band_image_contrast`).

L'Administrator sceglie quali layout le organizzazioni possono usare; un'organizzazione ne sceglie uno (non c'è scelta
personale). Un layout spento o rimosso ripiega sul `teams` integrato. Layout ufficiali: `layout-workspace`,
`layout-suite`, `layout-project`, `layout-tabs` in `mosaikit-plugins`.

## Lingue

Un plugin lingua (`kind = "language"`) aggiunge una lingua dell'interfaccia, solo testi:

```toml
kind = "language"
[language]
code = "fr"                 # due o tre lettere minuscole; non en né it (integrate nell'host)
name = "Français"           # al massimo 60 caratteri
```

```
lang/host.json                      i testi della shell: frase inglese -> traduzione, stessi {segnaposto}
lang/plugins/<id del plugin>.toml   i testi del manifesto di un altro plugin, nella forma del suo [i18n.<code>]
```

Limiti: `host.json` al massimo 1 MiB e 6000 testi di al massimo 1000 caratteri; al massimo 100 file di plugin da 200 KiB. I
testi dentro la UI di un plugin (il suo iframe) restano affare di quel plugin; un plugin che ha il proprio `[i18n.<code>]`
lo tiene. Un plugin lingua è esente dal controllo di copertura i18n di `validate --strict`.
