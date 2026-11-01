# Riferimento del manifesto

`plugin.toml` alla radice del plugin. È letto con le **chiavi sconosciute rifiutate** in ogni tabella: una chiave scritta
male è un errore, e un kernel che non conosce una chiave rifiuta il manifesto. Fonte di verità:
`crates/mskp/src/manifest.rs`; `mosaikit-plugin validate` applica le stesse regole prima dell'installazione.
Versione inglese: [../manifest.md](../manifest.md).

Identificatori (nomi di risorse, chiavi dei campi, nomi delle viste, chiavi dei permessi): prima una lettera minuscola,
poi lettere minuscole, cifre e `_`, al massimo 48 caratteri. Nomi di icone: minuscole, cifre e `-`, al massimo 48
caratteri (un nome del set Lucide; un nome sconosciuto disegna un'icona predefinita).

## Un manifesto completo

```toml
id = "com.acme.notes"
name = "Notes"
version = "0.3.0"
description = "Personal and shared notes"
author = "Acme"
license = "Apache-2.0"
kind = "app"
icon = "notebook-pen"

[requires]
mosaikit = ">=1.0, <2"
api = 1

[[resources]]
name = "notes"
title_field = "title"
fields = [
  { key = "title", label = "Title", kind = "text", required = true },
  { key = "tag",   label = "Tag",   kind = "choice", options = ["personal", "work"] },
]

[ui]
entry = "index.html"

[permissions]
hooks = ["notes"]

[[kpi]]
view = "kpi_notes_by_tag"
label = "Notes by tag"
```

## Primo livello

| Chiave | Tipo | Regola |
|---|---|---|
| `id` | stringa, obbligatoria | almeno due segmenti separati da `.`, ciascuno di lettere minuscole, cifre e `-` (senza `-` iniziale), al massimo 64 caratteri: `com.acme.notes` |
| `name` | stringa, obbligatoria | non vuoto |
| `version` | stringa, obbligatoria | `MAJOR.MINOR.PATCH`. Una versione più nuova aggiorna quella installata; un downgrade è rifiutato |
| `description` | stringa | mostrata nel catalogo; obbligatoria per `validate --strict` |
| `author`, `license` | stringa | al massimo 120 e 80 caratteri; obbligatorie per `validate --strict` |
| `homepage` | stringa | un indirizzo `http://` o `https://`, senza spazi, al massimo 300 caratteri |
| `details` | stringa | il testo lungo della pagina del plugin, al massimo 4000 caratteri; una riga vuota separa i paragrafi |
| `screenshots` | array di stringhe | fino a 8 nomi di file di `media/` (lettere, cifre, `- _ .`; estensione `png`, `jpg`, `jpeg`, `webp`, `svg`); ciascuno deve essere nel pacchetto |
| `kind` | `app`, `service`, `extension`, `layout`, `language` | vedi Tipi. Se manca: `extension` con `[extends]`, altrimenti `app` con `[ui]`, altrimenti `service` (regola mantenuta per i vecchi manifesti) |
| `icon` | stringa | icona della shell |
| `abi`, `min_kernel` | | **deprecate**, vedi `[requires]` |

### Tipi

| Tipo | Richiede | Rifiuta |
|---|---|---|
| `app` | normalmente `[ui]`; può avere `[[nav]]` | |
| `service` | | `[[nav]]` |
| `extension` | `[extends]` | `[[nav]]`; `[extension]` è solo per questo tipo |
| `layout` | file in `layout/` | `[[resources]]`, `[ui]`, `[[kpi]]`, `[search]` |
| `language` | `[language]` | `[[resources]]`, `[ui]`, `[[kpi]]`, `[search]`, `[[nav]]`, `[extension]` |

`[extends]` è solo per `extension`, e `[language]` solo per `language`.

## `[requires]`

Facoltativa. Senza, il plugin accetta qualsiasi versione e l'API corrente, e `validate` avvisa.

| Chiave | Tipo | Regola |
|---|---|---|
| `mosaikit` | stringa | un intervallo di versioni di Mosaikit: confronti separati da virgola `>=`, `>`, `<=`, `<`, `=`, `^`, `~`; una versione sola vale `^`, quindi `"1.2"` significa `>=1.2, <2`. Esempio `">=1.2, <2"` |
| `api` | intero | la plugin API per cui il plugin è costruito, 1 o più. Un valore diverso da quello del kernel è rifiutato con `plugin_incompatible`, che nomina entrambi |
| `database` | `"postgres"` | il plugin usa funzioni di PostgreSQL: non si installa su SQLite. Ogni altro valore è un errore |
| `extensions` | array di identificatori | estensioni PostgreSQL che devono essere installate (es. `["postgis"]`); richiede `database = "postgres"` |

Le vecchie `abi` (l'API) e `min_kernel` (un limite inferiore `MAJOR.MINOR.PATCH`) funzionano ancora per una versione
maggiore quando `[requires]` non dice nulla; un plugin caricato dalla sua cartella in sviluppo scrive un avviso per
ciascuna.

## `[contribution]`

Facoltativa, mantenuta per gli host più vecchi: `icon` (un'emoji) e `label`. Se manca, l'etichetta è il `name` e l'icona una
predefinita. La shell usa `name` e `icon`.

## `[[resources]]`

Dichiara gli elementi che la piattaforma conserva per il plugin. L'host crea la tabella (con il nome della risorsa) con le
colonne dei campi, più `resource_id`, `tenant_id`, la chiave esterna e la row level security, e dà CRUD, ricerca,
condivisione, cestino e le chiamate `crud.*` della UI.

| Chiave | Tipo | Regola |
|---|---|---|
| `name` | identificatore, obbligatorio | unico nel plugin; non può iniziare con `kpi_` |
| `label` | stringa | mostrata nella UI |
| `title_field` | stringa | un campo della risorsa; predefinito il primo campo `text` |
| `due_field` | stringa | un campo `date`: il kernel lo copia e la Home di una persona elenca ciò che scade presto |
| `done_field` | stringa | un campo `bool`: un elemento fatto non scade più |
| `fields` | array, obbligatorio | almeno uno |

### Campi

| Chiave | Tipo | Regola |
|---|---|---|
| `key` | identificatore, obbligatorio | unico nella risorsa; non `resource_id`, `tenant_id`, `id`, `owner`, `my_level` |
| `label` | stringa | |
| `kind` | `text`, `number`, `bool`, `date`, `choice`, obbligatorio | tipi SQL: `text`, `double precision`, `boolean`, `date`, `text`. Un campo già esistente non può cambiare tipo |
| `required` | bool | |
| `multiline` | bool | per `text` |
| `options` | array di stringhe | obbligatorio (non vuoto) per `choice` |
| `option_labels` | tabella valore → etichetta | ogni chiave deve essere una delle `options`; il valore memorizzato resta l'opzione |
| `hidden` | bool | calcolato (per esempio da un hook): non appare nei moduli né nell'ordinamento della UI; tenuto per le estensioni |
| `search` | bool | se la ricerca della shell guarda nel campo. Se manca: sì per i campi `text` visibili, no per gli altri |

Aggiungere un campo a una risorsa di un plugin installato aggiunge una colonna all'aggiornamento; la nuova chiave non deve
entrare in conflitto.

## `[ui]`

| Chiave | Regola |
|---|---|
| `entry` | la pagina della UI, relativa a `ui/dist`; predefinita `index.html` |
| `public_view` | visualizzatore facoltativo per i link pubblici, relativo a `ui/dist` |

Entrambe sono percorsi relativi sicuri (niente `..`, niente percorsi assoluti, niente `\`, niente `:`, niente nomi che
Windows riserva).

## `[permissions]`

Tutto è spento per impostazione predefinita. L'Administrator vede ciò che un plugin chiede quando lo installa.

| Chiave | Tipo | Cosa consente |
|---|---|---|
| `hooks` | array di nomi di risorsa | la logica riceve gli hook su queste risorse; ciascuna deve essere dichiarata |
| `files` | bool | l'API di file e cartelle con contenuto su disco (il plugin possiede file) |
| `content` | bool | contenuto di cartelle caricato da uno zip (siti) |
| `network` | array di origini | origini che la logica raggiunge con `http.fetch` e la UI con `connect-src`: `https://example.com`, senza percorso |
| `frame_src` | array di origini | origini che la UI può incorporare |
| `web` | bool | la UI può chiamare `msk.web.probe(url)` e incorporare qualsiasi sito web (`frame-src https: http:`) |
| `calls` | array di id di plugin | plugin di cui la logica chiama i comandi con `plugin.call`; non se stesso |
| `notify` | bool | la logica può inviare notifiche (`ctx.notify`) |
| `files_read` | bool | la logica legge l'area File come il chiamante. **Sensibile** |
| `script_eval` | bool | la CSP della UI consente `'unsafe-eval'` e `'wasm-unsafe-eval'`. **Sensibile** |

Un'origine è `http://` o `https://` e un host di lettere, cifre e `.-:[]`, senza `/`.
`validate --strict` confronta i permessi con ciò che la logica chiama: una chiamata senza permesso è un errore, e lo è
anche `files_read`, `notify` o `calls` chiesti e mai usati.

## `[[kpi]]`

| Chiave | Regola |
|---|---|
| `view` | il nome di una vista del plugin, che inizia con `kpi_`; deve esistere dopo le migrazioni, con una colonna `tenant_id` |
| `label` | obbligatoria |
| `columns` | etichette facoltative delle colonne della vista |

Solo il ruolo di reporting legge le viste `kpi_*`.

## `[[nav]]`

Pagine di un'`app` nella navigazione della shell. Al massimo 40 voci, due livelli.

| Chiave | Regola |
|---|---|
| `id` | identificatore, unico |
| `label` | da 1 a 60 caratteri |
| `icon` | nome di icona |
| `place` | lettere, cifre, `-`, `_`, al massimo 64: dove si apre l'app (`msk.at`); se manca, l'`id`. Una voce con figli e senza `place` è solo un gruppo |
| `parent` | l'`id` di un'altra voce che non ha genitore |
| `permission` | un permesso standard o una chiave `[[user_permissions]]` dichiarata; la voce si vede solo a chi lo ha |

## `[[user_permissions]]`

| Chiave | Regola |
|---|---|
| `key` | identificatore, unico, non `use`, `create`, `delete`, `share` |
| `label` | obbligatoria |
| `description` | |
| `default` | bool, predefinito `true`: dato dai profili che non elencano il plugin |

Sperimentale, insieme a `ctx.can`.

## `[[service_keys]]`

Chiavi di servizi esterni che il plugin usa, condivise con gli altri plugin che dichiarano lo stesso `id`.

| Chiave | Regola |
|---|---|
| `id` | lettere minuscole, cifre e `-`, al massimo 40, senza `-` iniziale o finale |
| `label` | obbligatoria |
| `description` | |
| `address` | bool: il valore è un indirizzo (un modello self-hosted), mostrato per intero; `http.fetch` può raggiungerlo |
| `scopes` | sottoinsieme di `platform`, `tenant`, `personal`, non vuoto, senza ripetizioni; predefinito tutti e tre |

## `[[config]]`

Impostazioni che l'Administrator fissa per la piattaforma (Plugin › Configurazione). Sperimentale.

| Chiave | Regola |
|---|---|
| `key` | identificatore, unico |
| `label` | obbligatoria |
| `description` | |
| `kind` | `text`, `number`, `bool`, `choice`, `secret` |
| `options` | obbligatorie per `choice` |
| `default` | deve adattarsi al tipo; non ammesso per `secret` |

## `[search]`

`command = "<nome>"`: un comando della logica (un identificatore semplice, senza punti) che aggiunge risultati alla ricerca
della shell. Riceve `{ "q": "..." }` e risponde `{ "results": [{ "id", "snippet" }] }`. Sperimentale. Non per layout e
lingue.

## `[extends]` e `[extension]`

Per `kind = "extension"`: `[extends] plugin = "<id>"`, `min_version = "MAJOR.MINOR.PATCH"` (predefinita `0.0.0`);
`[[extension.fields]]`, `[[extension.actions]]`, `[[extension.tabs]]`. Dettagli in
[Estensioni e layout](extensions-layouts.md).

## `[language]`

Per `kind = "language"`: `code` (due o tre lettere minuscole, non `en` né `it`) e `name` (al massimo 60 caratteri).

## `[i18n.<lang>]`

Traduzioni del manifesto. `<lang>` è di due o tre lettere minuscole, non `en` (l'inglese è il manifesto stesso). Ogni
chiave è facoltativa e ripiega sull'inglese; una chiave che nomina qualcosa che il manifesto non ha è un errore, e nessun
testo supera i 300 caratteri.

```toml
[i18n.it]
name = "Note"
description = "Note personali e condivise"
label = "Note"                       # l'etichetta della contribution
[i18n.it.resources.notes]
label = "Note"
fields = { title = "Titolo" }
options.tag = { personal = "personale", work = "lavoro" }
[i18n.it.kpi.kpi_notes_by_tag]
label = "Note per tag"
columns = { notes = "note" }
[i18n.it.permissions.export]         # una chiave di [[user_permissions]]
label = "Esportare"
```

Anche: `details`, `nav.<id>`, `config.<key>` e `service_keys.<id>` (`label`, `description`),
`extension = { fields = {...}, actions = {...}, tabs = {...} }`. I valori dei campi restano identificatori; un plugin che
traduce valori memorizzati li converte con una migrazione. La shell manda la sua lingua a ogni richiesta
(`Accept-Language`). `validate --strict` richiede che una lingua dichiarata copra tutto ciò che ha il manifesto inglese.

## File del pacchetto

```
plugin.toml  logic.wasm  migrations/NNN_name.sql  ui/**  media/**  layout/**  lang/**
```

Le migrazioni sono `NNN_name.sql`, numerate da 001 senza buchi né duplicati ([Dati](data.md)). I percorsi sono relativi e
sicuri su ogni piattaforma. Limiti di un pacchetto: [Pacchetto e firma](packaging.md).
