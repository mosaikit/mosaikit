# Risoluzione dei problemi

Gli errori che restituiscono il kernel e gli strumenti, con causa e rimedio. I testi sono citati come li produce il codice
(`crates/kernel`, `crates/mskp`, `crates/plugin-cli`), quindi restano in inglese. Nella UI di un plugin si ragiona sempre sul
**codice**, mai sul testo ([Riferimento della UI](ui.md)). Versione inglese: [../troubleshooting.md](../troubleshooting.md).

## Installare un plugin

| Cosa si vede | Causa | Rimedio |
|---|---|---|
| `invalid manifest: …` (spesso `unknown field …`) | `plugin.toml` ha una chiave che il kernel non conosce, o una regola è violata | il messaggio nomina la chiave o la regola; controllare la chiave nel [Riferimento del manifesto](manifest.md). Le chiavi sconosciute sono rifiutate di proposito; anche un kernel più vecchio della chiave la rifiuta |
| `invalid package: …` (`unsafe path`, `too many files`, `package over 64 MB`, `duplicate file`, `invalid migration name … (expected NNN_name.sql)`, `screenshot media/x is not in the package`) | lo zip viola un limite o una regola | vedere i Limiti in [Pacchetto e firma](packaging.md); ricostruire con `mosaikit-plugin pack` |
| `unsigned package` | manca `SIGNATURE` | `mosaikit-plugin pack` o `sign`; un server di sviluppo può consentire pacchetti non firmati |
| `publisher key not trusted: <chiave>` | la firma è valida ma la chiave non è in `trusted_keys` | l'Administrator aggiunge la chiave pubblica (la stampa `keygen`) a `trusted_keys` / `MOSAIKIT_TRUSTED_KEYS` |
| `invalid signature: the signature does not match the content` | un file è cambiato dopo la firma | impacchettare di nuovo; non modificare il `.mskp` |
| `<id> <versione> is in the blocklist of the registry` | la versione è stata revocata | pubblicare una nuova versione |
| `downgrade not allowed (<vecchia> -> <nuova>)` | una versione più vecchia sopra una più nuova | alzare `version` |
| `<id> is loaded in development mode` | il plugin gira da una cartella in un server sviluppatore | fermare `dev` per esso, o usare un altro server |
| codice `plugin_incompatible`: `the plugin works with Mosaikit <intervallo> (this is <versione>)` oppure `the plugin uses plugin API <n> (this Mosaikit supports <m>)` | `[requires]` esclude questa piattaforma | allargare `mosaikit`, costruire per l'API che la piattaforma parla, o aggiornare la piattaforma |
| `<nome> requires PostgreSQL: this installation uses SQLite (database.backend)` | `[requires] database = "postgres"` sul desktop | usare PostgreSQL, o togliere la dipendenza |
| `<nome> requires the PostgreSQL extension <ext>: install it in the database with CREATE EXTENSION <ext>; (a superuser is required)` | `[requires] extensions` | installare l'estensione nel database |

## Migrazioni

| Cosa si vede | Causa | Rimedio |
|---|---|---|
| `migration <nome> differs from the one already applied` | una migrazione applicata è stata modificata | ripristinarla e aggiungere un nuovo file `NNN`. In sviluppo: azzerare i dati del plugin negli Strumenti sviluppatore |
| `migration <nome> was already applied and then changed: create a new migration or reset the data…` | idem, su un server di sviluppo | idem |
| `migration <nome>: statement not allowed in plugins: …` / `object not accessible to plugins: …` / `function not allowed in plugins: …` | la guardia SQL | vedere [Dati](data.md); usare solo le istruzioni consentite e il proprio schema |
| `the KPI view <v> declared in the manifest does not exist` | `[[kpi]] view` non ha un `create view` corrispondente | creare `kpi_*` in una migrazione |
| `field <risorsa>.<campo> is already of type <t>: it cannot change to …` | un campo ha cambiato tipo | tenere il tipo; aggiungere un campo nuovo e migrare i dati |
| una tabella senza `resource_id` o `tenant_id` | ogni tabella di plugin ha bisogno di entrambi | aggiungere `resource_id uuid not null`, `tenant_id uuid not null` ([Dati](data.md)) |
| `validate --strict`: `migrations are numbered 003 where 002 is expected`, `irreversible` | un buco o `drop table`/`column`/`truncate` | numerare senza buchi; le migrazioni solo aggiungono |
| `not accepted on SQLite: …` | un costrutto senza traduzione per SQLite (`DISTINCT ON`, espressioni regolari, `json_agg` di righe…) | scriverlo in altro modo, o richiedere PostgreSQL |

## Chiamate dalla UI e dalla logica

| Codice (HTTP) | Causa | Rimedio |
|---|---|---|
| `missing_permission` (403) | il profilo di permesso non lo consente (`use`, `create`, `delete`, `share` o i tuoi) | il Tenant Manager cambia il profilo o i permessi del plugin |
| `plugin_off` (404) | il plugin non è disponibile o non è acceso nell'organizzazione | Administrator: disponibile; Tenant Manager: accendere |
| `base_off` | il plugin base di un'estensione è spento | accendere prima la base |
| `sort_unknown` (400) | `sort` nomina un campo non dichiarato, `hidden`, o diverso da `created_at`, `updated_at`, `owner_name` | ordinare per un campo dichiarato e visibile |
| `quota_exceeded` | l'organizzazione è a una quota | il Tenant Manager chiede una quota più ampia |
| `content_too_large` | un caricamento oltre il limite | inviare meno |
| `incompatible_api` | il pacchetto della UI chiede una plugin API più nuova di quella della shell, o la shell è più vecchia del pacchetto | aggiornare la piattaforma o costruire per l'API che parla; `isIncompatible(e)` permette alla pagina di mostrare un messaggio |
| `plugin_error` | la logica ha restituito un errore senza codice | leggere il messaggio; dare codici agli errori (`Error::coded`) |
| un codice tuo | la logica ha restituito `Error::coded("…", …)` | gestirlo nella UI |
| `maintenance`, `server_unavailable` | la piattaforma è in manutenzione o non risponde | riprovare |
| `the host did not answer <op>` | nessuna risposta in 120 s | la pagina è chiusa o il server è sovraccarico |
| `this page must be opened inside Mosaikit (the host is missing)` | la pagina è stata aperta fuori dalla shell | aprirla dalla shell |

## Errori della logica

| Cosa si vede | Causa | Rimedio |
|---|---|---|
| `unknown command: <nome>` | il nome non è registrato in `plugin!` | controllare la stringa in `commands:` e in `msk.call` |
| `instruction limit exceeded` | più di 2.000.000.000 (comandi) o 500.000.000 (hook) istruzioni | fare meno per chiamata; fare il lavoro in SQL; dividerlo |
| `the plugin ended with an error: …` | un panic o trap nel WASM | niente `unwrap` sull'input; leggere il testo del trap; provare con `MockHost` |
| `invalid message from the plugin: answer too large` | un messaggio oltre 16 MiB | restituire meno; paginare |
| `db.query requires SELECT or RETURNING: use db.exec` | un'istruzione senza righe mandata a `query` | usare `exec` |
| `invalid SQL`, `statement not allowed in plugins`, `object not accessible to plugins`, `function not allowed in plugins`, `one statement per call only` | la guardia SQL | vedere [Dati](data.md) |
| `the plugin does not declare notify in [permissions]` | `notify` senza `notify = true` | aggiungerlo; `validate --strict` lo trova |
| `invalid notification: …`, `too many notifications` | forma sbagliata, o oltre 30 al minuto per persona e plugin | controllare titolo (160) e corpo (600); diradare |
| `origin not declared in permissions.network: <origine>` | `http.fetch` verso un'origine non dichiarata | aggiungere l'origine (`https://host`, senza percorso) |
| `HTTP response over 4 MB`, `method not allowed: <m>` | limiti di `http.fetch` | paginare la fonte; usare GET, POST, PUT o DELETE |
| `plugin not declared in permissions.calls: <id>` | `call_plugin` verso un plugin non dichiarato | aggiungerlo a `calls` |
| `too many nested calls between plugins` | più di 3 livelli | appiattire |
| `plugin.call requires PostgreSQL` | `call_plugin` su SQLite | usare PostgreSQL |
| `the plugin does not declare the service <s> in [[service_keys]]`, `no key of the service <s> is set` | `service_key` / `fetch_with_key` | dichiarare il servizio; impostare una chiave (personale, dell'organizzazione o della piattaforma) |
| `permission_denied` (file) | manca `files_read` | aggiungere `files_read = true`; è sensibile |
| `not_found` (file) | manca o il chiamante non lo vede | i due casi sono uguali di proposito |
| `invalid_argument` (file) | id sbagliato, una cartella a `files.read`, `max_bytes` sbagliato | correggere la chiamata |
| `MockHost: no answer for <op>` | un test senza risposta programmata | `.on("<op>", …)` |

## La UI non si carica o si rompe

| Cosa si vede | Causa | Rimedio |
|---|---|---|
| una pagina bianca, violazioni CSP nella console | script inline, gestore `on…=`, `javascript:`, un'origine esterna, o `eval` | mettere i file in `ui/dist`; dichiarare le origini in `network` / `frame_src`; `script_eval` solo se indispensabile. `validate --strict` le elenca |
| un errore del browser su `localStorage` in una scheda di estensione | le schede sono in sandbox senza `allow-same-origin` | non usare lo storage in una pagina scheda |
| CSS o carattere non applicato | `style.css` non importato | `import '@mosaikit/plugin-api/style.css'` |
| il tema non cambia | colori fissi nel CSS | usare le variabili ([Riferimento della UI](ui.md)) |
| una pagina non è nella barra laterale | un'`extension` o `service` non ha voce nella barra; oppure manca `use` | è elencata solo un'`app` con `[ui]` |

## Gli strumenti

| Cosa si vede | Causa | Rimedio |
|---|---|---|
| `mosaikit-plugin doctor` segnala il target wasm mancante | manca `wasm32-unknown-unknown` | `mosaikit-plugin doctor --fix` (si installa anche alla prima build) |
| `invalid id: … (e.g. com.company.<nome>)` | l'id viola la regola | almeno due segmenti, minuscole, cifre, `-` |
| `new` non trova l'SDK o il pacchetto della UI | ancora nessun registro | `--kit <cartella>`, `MOSAIKIT_KIT`, oppure `--sdk-path` e `--plugin-api-path` |
| `dev`: `the server executable … does not exist (--server / MOSAIKIT_SERVER_BIN)` | nessun `mosaikit-server` accanto allo strumento | `--server <percorso>` o `MOSAIKIT_SERVER_BIN` |
| `dev`: `the ports N and N+1 are not both free: choose another with --port` | l'app e l'origine dei plugin vogliono due porte | `--port` |
| `dev`: `the server stopped at start …` | il profilo sviluppatore si rifiuta di girare qui: non loopback, un database su un altro host, `trust_proxy`, oppure il database ha già organizzazioni oltre a `dev` | leggere il messaggio sopra; usare `--fresh` o `--data` per una cartella pulita. Non togliere la guardia |
| `dev`: `the server does not answer on <url> after 90 seconds` | avvio lento, un crash, una porta occupata | leggere l'output del server; provare `--port` |
| `<id>: the plugin does not validate: fix the manifest first` | `dev` valida prima di partire | eseguire `mosaikit-plugin validate` |
| `install`: `an Administrator is needed: --user and --password …` | mancano le credenziali | darle o usare le variabili `MOSAIKIT_ADMIN_*` |
| `install`: `this Administrator needs a second factor … add --totp <code>` / `the second factor … is not set up yet` | l'account ha un secondo fattore (non nel profilo sviluppatore) | `--totp`, o accedere una volta nella shell |
| le modifiche non si vedono in `dev` con un bind mount Docker | gli eventi dei file possono non passare da Windows o macOS al contenitore | riavviare l'app, o usare il kit desktop |

## Domande frequenti

**Un plugin può leggere i dati di un altro plugin?** No. Si chiamano i suoi comandi (`calls`); applica le sue regole per lo
stesso utente.

**Perché il mio SQL funziona su PostgreSQL e non sul desktop?** SQLite usa una traduzione; eseguire `validate --strict`, o
richiedere PostgreSQL.

**Posso modificare una migrazione?** Non dopo che è girata da qualche parte. Se ne aggiunge una nuova.

**Come mostro un errore tradotto?** Restituire `Error::coded("code", "testo inglese")` dalla logica; la UI associa il codice
a un testo nella lingua di `msk.context.lang`.

**Dove trovo quali permessi ha un utente?** Strumenti sviluppatore › Permessi nella shell, e `msk.perms`.

**Cosa è sperimentale?** La superficie che ha test del kernel ma ancora nessun esempio ufficiale; l'API 1 non promette che
resti com'è ([Changelog e compatibilità](changelog.md)).
