| `target` | obbligatorio: l'indirizzo dell'endpoint del servizio, `https://svc:8080/schedules/run`; la sua origine deve stare in `permissions.network`; niente credenziali nell'indirizzo. Il kernel fa qui il `POST` dell'esecuzione; il risultato si legge dallo stesso indirizzo con un `/run` finale sostituito da `/runs/{id}` (`/schedules/runs/{id}`), oppure con `/runs/{id}` aggiunto |
| `service_key` | facoltativa: l'`id` di una voce di `[[service_keys]]`; la sua chiave condivisa (quella dell'organizzazione, altrimenti quella della piattaforma) è inviata al target come `Authorization: Bearer` |# Riferimento del manifesto

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
| `run_commands` | array di identificatori | comandi della logica che un **ticket di esecuzione** può chiamare per conto di una persona (un processo in background di una distribuzione), al massimo 32. **Sensibile**; richiede `[requires] mosaikit = ">=1.0"`. Vedi [Logica](logic.md#comandi-di-esecuzione-chiamate-per-conto-di-un-run) |
| `run_targets` | array di id di plugin | altri plugin che un ticket di esecuzione di questo plugin può chiamare (un processo in background che a metà run ha bisogno di un comando di un altro plugin), al massimo 16, non il plugin stesso, solo con `run_commands`. Si raggiungono solo i comandi che il bersaglio dichiara nei propri `run_commands`, e solo per una persona che lo usa. **Sensibile**; richiede `[requires] mosaikit = ">=1.0"`. Vedi [Logica](logic.md) |
| `directory` | bool | il plugin può cercare tra le persone e i gruppi del tenant (`ctx.directory()`, `msk.directory.search`), per chi è Tenant Manager o può condividere nel plugin; solo id, username e nome. **Sensibile**; richiede `[requires] mosaikit = ">=1.0"`. Vedi [Logica](logic.md#directory) |

Un'origine è `http://` o `https://` e un host di lettere, cifre e `.-:[]`, senza `/`.
`validate --strict` confronta i permessi con ciò che la logica chiama: una chiamata senza permesso è un errore, e lo è
anche `files_read`, `notify` o `calls` chiesti e mai usati.

## `[[kpi]]`

| Chiave | Regola |
|---|---|
| `view` | il nome di una vista del plugin, che inizia con `kpi_`; deve esistere dopo le migrazioni, con una colonna `tenant_id` |
| `label` | obbligatoria |
| `columns` | etichette facoltative delle colonne della vista |

Solo il ruolo di reporting legge le viste `kpi_*`. Una vista può confrontare o combinare colonne, quindi un KPI con due conteggi è una sola vista:

```sql
create view kpi_notes_health as
  select tenant_id, count(*) as notes, count(*) filter (where tag is null) as untagged
  from notes group by tenant_id;
```

con `columns = ["Notes", "Untagged"]` nella voce `[[kpi]]`.

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
| `public` | bool, predefinito false: la pagina di un link pubblico può leggerla (`msk.publicConfig()`). **Un `secret` non può essere pubblico**: il manifesto viene rifiutato |

## `[[public_commands]]`

Comandi della logica che **chiunque abbia un link pubblico** può eseguire, in sola lettura, sull'elemento condiviso.
**Sensibile**: l'Administrator li vede in «Cosa chiede» quando il plugin viene installato, e un'organizzazione deve attivare
la regola «Comandi pubblici» (disattivata di default) perché funzionino. Richiede `[requires] mosaikit = ">=1.0"` (un Mosaikit
più vecchio rifiuta la chiave); `validate` avvisa se l'intervallo manca, con `--strict` fallisce. Vedi
[Logica](logic.md#comandi-pubblici) e [Sicurezza](security.md#comandi-dei-link-pubblici-lista-di-revisione).

| Chiave | Regola |
|---|---|
| `name` | il comando della logica, identificatore, unico |
| `description` | obbligatoria: cosa può farci un visitatore, mostrata all'Administrator |
| `max_arg_bytes` | facoltativa, da 1 a 16384 (predefinito e massimo) |

## `[[schedules]]`

Lavori che una persona può mettere in calendario (un'espressione cron) per farli eseguire più tardi, a suo nome, da un servizio
esterno. Al massimo 8. **Sensibile**: `validate` lo elenca fra i permessi che l'Administrator rivede (la schermata di installazione lo mostra col passo della shell della funzione). Richiede `[requires] mosaikit = ">=1.0"`; `validate` avvisa se l'intervallo manca, con `--strict` fallisce.
Il kernel tiene l'elenco (crea, elenca, sospendi, riprendi, elimina, rileva, esegui ora) e un worker avvia i lavori alla scadenza:
ricontrolla i diritti dell'autore, emette un ticket di esecuzione per il solo comando e invia l'esecuzione al `target`. Vedi
architettura §8.17.

| Chiave | Regola |
|---|---|
| `name` | identificatore, unico nel plugin; è ciò che la UI invia quando registra una pianificazione |
| `command` | obbligatorio: un comando di `permissions.run_commands` |
| `targets` | facoltativo: plugin di `permissions.run_targets` che il run di questa pianificazione può chiamare, con tutti i loro `run_commands` (predefinito: nessuno) |
| `target` | obbligatorio: l'indirizzo dell'endpoint del servizio, `https://svc:8080/run`; la sua origine deve stare in `permissions.network`; niente credenziali nell'indirizzo |
| `service_key` | facoltativa: l'`id` di una voce di `[[service_keys]]`, inviata al target come chiave bearer |
| `min_interval_minutes` | facoltativa, predefinita 15: i minuti minimi fra due esecuzioni; il minimo del kernel è 5 e prevale |
| `max_runtime_minutes` | facoltativa, predefinita 15, al massimo 60 |
| `max_per_tenant` | facoltativa, predefinita 10, al massimo 50: pianificazioni con questo nome in un'organizzazione |
| `resources_required` | facoltativa, predefinita `false`: una pianificazione deve indicare le risorse a cui è limitata |

L'espressione cron ha cinque campi (`minuto ora giorno-del-mese mese giorno-della-settimana`): `*`, numeri, intervalli, elenchi e passi, niente nomi.
Si legge nel fuso orario della pianificazione (un nome IANA, es. `Europe/Rome`, scelto quando la persona la registra; UTC se non c'è). Quando
l'ora avanza, un'ora che non esiste viene eseguita una volta, subito dopo il salto; quando torna indietro, un'ora che capita due volte
viene eseguita una volta, la prima.

**L'invio.** Il corpo è JSON: `tenant`, `user` (l'autore), `schedule`, `schedule_name`, `run`, `run_ref`, `plugin`, `command`, `args`,
`ticket`, `ticket_path` (`/api/run/<ticket>`) e `expires_at`. Il servizio risponde subito `2xx` (`202`) con `{ "run_id": "..." }` e lavora in
background, chiamando il plugin col ticket (`POST /api/run/<ticket>/call/...`) e chiudendo con `DELETE /api/run/<ticket>`. Il kernel chiede
`GET .../runs/{id}` ogni 30 secondi per `{ "status": "running" oppure "succeeded" oppure "failed", "error"? }` (un `404` è un fallimento). Senza
`run_id` l'esecuzione finisce quando il servizio chiude il ticket. Un'esecuzione non finita dopo `max_runtime_minutes` è `timed_out` e il suo
ticket è revocato. Il ticket porta il solo `command` della voce; la logica vede `ctx.on_behalf().schedule`.

Un invio fallito, un'esecuzione fallita o un timeout contano come fallimento: la prossima esecuzione è anticipata a un nuovo tentativo (5
minuti, raddoppiando, al massimo 60) se è prima del calendario, e dopo 5 fallimenti di fila la pianificazione è sospesa. Un'esecuzione
saltata perché il kernel era spento viene scartata, salvo che la pianificazione sia stata registrata con `catch_up_once`: allora viene
eseguita una volta.

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
testo supera i 300 caratteri. **Quando togli o rinomini un campo, una risorsa, una vista KPI o un permesso, toglilo anche da ogni `[i18n.<lang>]`**
(il template traduce i suoi campi d'esempio in `it` ed `es`): `validate` fallisce con `i18n.es: field 'inventory.status' does not exist`, che nomina lingua e campo.

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
