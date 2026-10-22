# Mosaikit — Architettura

Documento di riferimento per chi sviluppa Mosaikit, il kernel o i plugin.
Descrive il modello multi-tenant, la sicurezza dei dati, il sistema dei
plugin, lo sviluppo e la release. Le scelte qui descritte sostituiscono la PoC
iniziale (kernel std-only, persistenza JSON, `ui.js` trusted).

## Indice

1. [Principi](#1-principi)
2. [Panoramica](#2-panoramica)
3. [Tenant, utenti e ruoli](#3-tenant-utenti-e-ruoli)
4. [Risorse, proprietà e condivisione](#4-risorse-proprietà-e-condivisione)
5. [Link pubblici](#5-link-pubblici)
6. [KPI](#6-kpi)
7. [Database: PostgreSQL e SQLite](#7-database-postgresql-e-sqlite)
8. [Plugin](#8-plugin)
9. [Sicurezza web: origini, cookie, CSP](#9-sicurezza-web-origini-cookie-csp)
10. [Configurazione e data dir](#10-configurazione-e-data-dir)
11. [Struttura del repository](#11-struttura-del-repository)
12. [Sviluppo](#12-sviluppo)
13. [Release](#13-release)
14. [Distribuzioni e marchio](#14-distribuzioni-e-marchio)
15. [Limiti noti e prossimi passi](#15-limiti-noti-e-prossimi-passi)

---

## 1. Principi

- **Kernel domain-agnostic.** Il kernel non sa cosa sia una mappa o una nota:
  conosce tenant, utenti, risorse, permessi e plugin. Ogni dominio vive in un
  plugin.
- **Sicurezza nel posto giusto.** I controlli di accesso ai dati sono applicati
  dallo strato dati, non dal codice dei plugin: Row-Level Security su
  PostgreSQL, riscrittura delle query e trigger su SQLite. Un plugin non può
  dimenticare un filtro perché i filtri non li scrive lui.
- **Isolamento dei plugin.** Logica in WebAssembly sandboxato, UI in un iframe
  su un'origine separata, dati in uno schema PostgreSQL dedicato con un ruolo
  dedicato (su SQLite: solo le proprie tabelle, imposto dalla traduzione e
  dall'authorizer). Un plugin non vede il token di sessione, i dati degli altri
  plugin, né le tabelle del kernel; può solo chiamare i comandi dei plugin che
  dichiara (§8.6).
- **Pacchetti verificabili.** I plugin sono distribuiti come `.mskp` firmati
  (ed25519) e verificati prima dell'installazione.
- **Un solo comando per sviluppare e rilasciare.** `cargo xtask …` funziona su
  Windows, Linux e macOS senza script bash.

## 2. Panoramica

```
 Browser ─────────────────────────────────────────────────────────────────────
  ┌───────────────────────────────┐        ┌───────────────────────────────┐
  │ Host UI (React)  app origin   │ post-  │ UI plugin (iframe)            │
  │ login, rail, condivisione,    │ Message│ plugin origin (separata)      │
  │ console gestore/admin         │◀──────▶│ @mosaikit/plugin-api          │
  └──────────────┬────────────────┘ bridge └───────────────────────────────┘
                 │ REST + cookie HttpOnly + X-CSRF-Token
 Server (mosaikit-server, un solo eseguibile) ─────────────────────────────────
  ┌──────────────▼────────────────────────────────────────────────────────┐
  │ axum: listener app (:8080)  ·  listener untrusted (:8081)             │
  │       API, UI host              UI plugin, contenuti utente, /p/{link}│
  ├───────────────────────────────────────────────────────────────────────┤
  │ kernel: identity · tenancy · acl · links · kpi · plugins · blobs      │
  │ runtime: wasmi (fuel, limite memoria, istanza nuova per chiamata)     │
  │ sql-guard: whitelist delle istruzioni SQL dei plugin                  │
  └──────────────┬─────────────────────────────┬──────────────────────────┘
                 │ ruolo app                   │ un pool per plugin, ruolo plg_*
 PostgreSQL ─────▼─────────────────────────────▼───────────────────────────────
   schema core (tenant, utenti, risorse, grant, link, eventi)   schema plg_* (RLS)
 oppure SQLite (un file) ─ tabelle core_* · plg_*__* (query riscritte, trigger)
 Disco ─── data dir: blobs/ (contenuti file e siti) · plugins/ (codice) · backups/
```

## 3. Tenant, utenti e ruoli

| Ruolo | Ambito | Dove | Può fare |
|---|---|---|---|
| **Administrator** | installazione | account del tenant di sistema (`core.users.is_system_admin`) | creare/sospendere tenant, nominare o sostituire i loro Tenant Manager e reimpostare password (utenti e ruoli, mai i contenuti), installare/attivare plugin, KPI cross-tenant, gestire gli account Administrator (ne resta sempre almeno uno attivo; chi viene disabilitato ha le sessioni chiuse) |
| **Tenant Manager** | un tenant | `core.memberships.role = 'tenant_manager'` | utenti, inviti, gruppi, metadati delle risorse, riassegnazione proprietà, KPI e policy del tenant |
| **User** | un tenant | `core.memberships.role = 'user'` | creare risorse, condividerle, usare quelle condivise |

Lo stesso utente puo' essere User in un tenant e Tenant Manager in un altro.

- **Administrator: account di piattaforma.** Esiste solo nel tenant di sistema
  (`system`), che **non e' uno spazio di lavoro**: nessuna membership, nessuna
  risorsa, nessun ospite (`caller` non lo risolve mai). Essere account di
  `system` e' essere Administrator: il ruolo non si assegna agli utenti dei
  tenant, quindi non c'e' mai sovrapposizione con i ruoli nei tenant. Chi e'
  anche Tenant Manager o User di un tenant ha la' un secondo account, distinto
  (`system/anna` e `alfa/anna` sono due identita'). Un gestore non puo'
  invitare, reimpostare o disabilitare un Administrator.
- **Accesso degli Administrator.** Pagina a parte (`#/admin`,
  `POST /api/auth/admin/login`), **sempre locale**: non dipende dagli IdP dei
  tenant (anche quando useranno OIDC, §15). Con `admin_totp` (default) serve il
  secondo fattore TOTP (RFC 6238): la password apre una sessione *in attesa*
  (`core.sessions.pending`, 10 minuti, valida solo per `/api/auth/totp/*`); al
  primo accesso si registra l'app (QR code) e si ricevono 10 codici di recupero
  monouso (salvati come sha256); un codice gia' usato non vale una seconda volta
  (`totp_last_step`). Completato il secondo fattore il token viene rinnovato.
  Accesso di emergenza dalla macchina: `reset-password --user` e `reset-totp`.
- **Pagina di accesso degli utenti.** Menu a tendina dei tenant attivi
  (`GET /api/auth/tenants`: solo slug, nome e metodo di accesso), nascosto se il
  tenant e' uno solo; `#/login/<tenant>` lo preseleziona. Il form dei tenant
  rifiuta il tenant di sistema.
- **Nessun tenant senza gestore.** Resta sempre almeno un Tenant Manager attivo
  per tenant: anche quando un utente viene disabilitato dal suo tenant di
  appartenenza, se e' l'unico gestore di un altro tenant l'operazione e'
  rifiutata. L'Administrator puo' comunque nominarne uno nuovo.

- **Tenant di appartenenza.** Ogni utente ha un `home_tenant`. Si autentica
  **sempre** lì (login con `tenant + username + password`; in futuro OIDC per
  tenant, vedi §15). Il tenant `system` contiene solo gli Administrator.
- **Inviti.** Il gestore del tenant B invita un utente di A con un ruolo. L'utente
  accetta dopo il login su A e ottiene una membership in B. Un utente può
  appartenere a più tenant con ruoli diversi.
- **Tenant attivo.** La sessione contiene l'identità e il tenant su cui si sta
  lavorando. Le API sono `/api/t/{tenant}/…`; a ogni richiesta il server verifica
  la membership.
- **Uscita.** Rimuovere un utente da un tenant richiede di indicare il nuovo
  proprietario delle sue risorse (§4). Disabilitare l'utente nel tenant di
  appartenenza invalida le sessioni e, di fatto, tutte le sue membership.
- **Panoramica.** E' la pagina iniziale dopo l'accesso
  (`GET /api/t/{tenant}/overview`) e mostra dati diversi secondo il ruolo:
  - per ogni utente: le proprie risorse per plugin, le condivisioni fatte e
    ricevute, i link pubblici attivi e le visite, l'attivita' recente (i titoli
    solo delle risorse ancora accessibili);
  - per il Tenant Manager, in piu': gli aggregati del tenant (§6);
  - per l'Administrator, che non ha tenant attivo, una panoramica a parte
    (`GET /api/admin/overview`): gli aggregati del sistema (tenant, utenti,
    Administrator, risorse, spazio, plugin, utenti attivi).

## 4. Risorse, proprietà e condivisione

Una **risorsa** è qualunque oggetto dichiarato da un plugin: un file, una
cartella, una mappa, un sito statico, una nota. Ogni risorsa ha tenant,
plugin, tipo, proprietario e, facoltativamente, un genitore (gerarchia, es.
cartelle).

**Livelli**, cumulativi:

| Livello | Valore | Permette |
|---|---|---|
| lettura | 1 | vedere la risorsa e il contenuto |
| scrittura | 2 | lettura + modifica del contenuto, creare figli |
| gestione | 3 | scrittura + condividere, revocare, link pubblici, spostare, eliminare |

- Il proprietario ha sempre il livello gestione.
- I grant si danno a **utenti** o **gruppi** dello stesso tenant (ospiti
  compresi). Non esistono condivisioni dirette tra tenant: si invita.
- **Ereditarietà.** Il livello effettivo è il massimo tra la risorsa e i suoi
  antenati: condividere una cartella condivide il suo contenuto; il
  proprietario di una cartella gestisce anche i file che altri vi hanno messo.
- **Gestore del tenant**: vede i **metadati** (tipo, proprietario, titolo,
  dimensione, date, numero di condivisioni) e i KPI, **mai il contenuto**. Con la
  policy `managers_see_titles = false` non vede nemmeno i titoli.
- **Amministratore di sistema**: stessa regola, su tutti i tenant.
- **Riassegnazione.** Il gestore, rimuovendo un utente, sceglie il nuovo
  proprietario di tutte le sue risorse nel tenant. I grant esistenti restano,
  quelli dell'utente uscente vengono rimossi. Tutto viene registrato negli eventi.

La finestra di condivisione è **dell'host**: i plugin la aprono con
`msk.share(resourceId)` e non reimplementano mai i controlli.

## 5. Link pubblici

- Li crea chi ha il livello gestione. Sono **in sola lettura**, con scadenza
  e password facoltativa; il token è salvato solo come hash.
- Policy del tenant: `public_links_enabled`, `public_link_max_days`.
- URL: `{public_url}/p/{token}` sull'**origine untrusted**. Se la risorsa ha un
  contenuto a cartella (sito statico) viene servito com'è; altrimenti si apre il
  visualizzatore pubblico del plugin (`public_view` nel manifest), che riceve
  solo i dati di quella risorsa (e dei suoi figli).
- Ogni visita incrementa `view_count` ed è un evento (KPI).

## 6. KPI

**KPI del kernel** (sempre disponibili): risorse per plugin e tipo, byte
occupati, utenti e membri, condivisioni, link pubblici attivi, eventi degli
ultimi 30 giorni.

**KPI dei plugin**: viste SQL `kpi_*` nelle migrazioni del plugin, con colonna
`tenant_id` obbligatoria, dichiarate nel manifest:

```sql
create view kpi_maps_by_layers as
  select tenant_id, count(*) as mappe, sum(layers) as livelli
  from maps group by tenant_id;
```

| Chi | Endpoint | Ambito |
|---|---|---|
| Gestore | `GET /api/t/{tenant}/manage/kpi` | solo il suo tenant |
| Admin di sistema | `GET /api/admin/kpi` | tutti i tenant, raggruppati |
| BI esterni | ruolo `<prefix>_reporting` | sola lettura delle viste KPI |

Le viste KPI sono aggregati e il plugin stesso non può leggerle (non vede gli
altri tenant). Che non espongano contenuti (es. un `group by title`) è un punto
di revisione del plugin prima della pubblicazione nel registry.

## 7. Database: PostgreSQL e SQLite

Due backend con le stesse regole, dietro un'unica API (`mosaikit-db`:
`query`/`query_scalar`, transazioni con contesto, operazioni sulle risorse,
SQL dei plugin, schemi dei plugin):

- **PostgreSQL ≥ 15**: server e Docker, distribuzioni con estensioni (PostGIS).
  Le regole sono nel database: ruoli, RLS, funzioni `SECURITY DEFINER` (§7.1-7.5).
- **SQLite** (incluso nell'eseguibile, default della versione desktop): un solo
  file; le stesse regole applicate dallo strato dati (§7.6).

L'SQL del kernel e dei plugin si scrive per PostgreSQL; su SQLite viene
tradotto (o, raramente, il kernel fornisce una variante con `.sqlite(...)`).
Le suite di test del database, del kernel e del server girano su entrambi.

### 7.1 Schemi e ruoli

| Oggetto | Proprietario | Contenuto |
|---|---|---|
| schema `core` | ruolo app | tenant, utenti, membership, inviti, sessioni, gruppi, plugin, risorse, grant, link, eventi, preferenze |
| schema `plg_<id>` | ruolo app | tabelle del plugin (RLS) |
| ruolo `<prefix>_p_<id>` | — | login del plugin: solo DML sul proprio schema, nessun accesso a `core` se non via funzioni |
| ruolo `<prefix>_reporting` | — | sola lettura delle viste KPI |

Il ruolo app deve avere `CREATEROLE` (crea i ruoli dei plugin). Il prefisso dei
ruoli deriva dal nome del database, così più database possono convivere nello
stesso cluster (es. i test).

### 7.2 Contesto di sicurezza

Ogni operazione sui dati di un plugin avviene in una transazione su una
connessione **autenticata come ruolo del plugin**:

1. l'host esegue `core.set_ctx(secret, user, tenant, plugin, link)`. La funzione
   è `SECURITY DEFINER`, verifica un segreto che i plugin non possono leggere e
   salva il contesto legato a backend e transazione correnti;
2. esegue le istruzioni (CRUD generico, comandi WASM, hook);
3. commit, oppure rollback se qualcosa fallisce.

Il contesto vale **solo in quella transazione**. Il plugin non può falsificarlo
(non conosce il segreto) né uscire dal proprio ruolo (la connessione è nata con
quel ruolo: non c'è un ruolo più privilegiato a cui tornare).

### 7.3 Row-Level Security

Funzioni `core` (tutte `SECURITY DEFINER`, `search_path` fissato):

| Funzione | Uso |
|---|---|
| `core.can_access(resource_id, level)` | regola di accesso: membership, proprietà, grant ereditati, link pubblico |
| `core.level_of(resource_id)` | livello effettivo (0–3), per la UI |
| `core.create_resource(kind, title, parent, meta)` | crea una risorsa del plugin corrente, proprietario = utente del contesto |
| `core.update_resource`, `core.move_resource`, `core.delete_resource` | modifiche con verifica del livello |
| vista `core.visible_resources` | metadati delle risorse del plugin corrente visibili all'utente |

Per ogni tabella di un plugin l'host crea le policy:

```sql
create policy msk_select on t for select using (core.can_access(resource_id, 1));
create policy msk_insert on t for insert with check (core.can_access(resource_id, 2)
                                                    and tenant_id = core.ctx_tenant());
create policy msk_update on t for update using (core.can_access(resource_id, 2));
create policy msk_delete on t for delete using (core.can_access(resource_id, 3));
```

### 7.4 Migrazioni dei plugin

Le migrazioni (`migrations/NNN_nome.sql`) sono applicate dall'host
all'installazione e all'aggiornamento:

1. ogni istruzione passa da **sql-guard**: ammessi `CREATE TABLE/INDEX/VIEW`,
   `ALTER TABLE`, `DROP TABLE/INDEX/VIEW`, `INSERT/UPDATE/DELETE`, `COMMENT`;
   vietati funzioni, trigger, policy, `GRANT`, `SET`/`RESET`, `DO`, `COPY`,
   riferimenti ad altri schemi;
2. le istruzioni girano con il ruolo del plugin (`SET LOCAL ROLE`), quindi non
   possono toccare `core` né altri plugin;
3. poi l'host, con il ruolo app: rifiuta le viste che usano oggetti fuori dallo
   schema del plugin (PostgreSQL controlla i privilegi delle viste solo all'uso:
   una vista su `core.users`, passata al ruolo app, li esporrebbe); trasferisce
   la proprietà degli oggetti al ruolo app; verifica che **ogni tabella** abbia
   `resource_id uuid not null` e
   `tenant_id uuid not null`; aggiunge la FK verso `core.resources` con
   `on delete cascade`; abilita la RLS e crea le policy; imposta
   `security_invoker` sulle viste normali; concede le viste `kpi_*` solo al ruolo
   reporting;
4. se un controllo fallisce l'installazione viene annullata (una transazione).

Le tabelle delle `[[resources]]` dichiarate nel manifest (CRUD generico) sono
generate dall'host con lo stesso processo.

Le estensioni richieste dal manifest (`[requires] extensions`) devono essere
installate nel database (con l'immagine `postgis/postgis` o, in sviluppo, nel
template del cluster); lo schema dell'estensione (es. `public`) viene aggiunto
al `search_path` del ruolo del plugin dopo il suo schema.

### 7.5 SQL dei plugin a runtime

Le query che la logica WASM invia (`ctx.db().query(...)`) passano da
**sql-guard** (solo `SELECT/INSERT/UPDATE/DELETE`, anche con `WITH`; una sola
istruzione; niente `SET`, funzioni di sistema, altri schemi) e vengono eseguite
come prepared statement con `statement_timeout` del ruolo. Il guard è una
seconda difesa: la prima sono ruolo e RLS.

### 7.6 SQLite: le stesse regole senza RLS

SQLite non ha schemi, ruoli ne' Row-Level Security. Mosaikit le sostituisce:

| PostgreSQL | SQLite |
|---|---|
| schema `core` | tabelle `core_*` (stesse colonne; uuid e istanti come testo, istanti RFC 3339 a millisecondi ordinabili, jsonb/array come JSON, bool 0/1) |
| schema `plg_<id>` | tabelle `plg_<id>__<nome>`; le viste normali del plugin sono salvate in `core_plugin_views` ed espanse a ogni uso; le viste `kpi_*` sono viste vere |
| `core.set_ctx` + tabella del contesto | contesto della transazione sul lato Rust della connessione, letto dalle funzioni `core_ctx_user()/tenant()/plugin()/link()/active()`: l'SQL non puo' modificarlo |
| `core.level_of`, `core.can_access`, `core.level_for`, `core.is_member` | espansi dalla traduzione in sottoquery sulle tabelle core (stessa logica: membership attiva, proprieta' propria o di un antenato, grant diretti o di gruppo, link pubblico in sola lettura) |
| `core.visible_resources` | sottoquery filtrata con le stesse colonne |
| policy `msk_select` | ogni lettura di una tabella protetta (con `resource_id`) diventa `(SELECT * FROM plg_x__t WHERE livello >= 1) AS t` |
| policy `msk_update`, `msk_delete` (`USING`) | condizione sul livello aggiunta al `WHERE` di UPDATE e DELETE |
| `WITH CHECK` di insert e update | trigger `BEFORE INSERT/UPDATE/DELETE` sulle tabelle del plugin, attivi nelle transazioni dei plugin: `RAISE(ABORT, 'mosaikit[42501]: ...')` |
| ruolo del plugin | l'SQL scritto dal plugin puo' nominare solo le sue tabelle, le sue viste e `core.visible_resources` (verifica sull'AST); in piu' l'**authorizer** di SQLite nega scritture fuori dal suo prefisso, letture di segreti/sessioni/password, PRAGMA, ATTACH, `load_extension` |
| `core.create/update/move/delete_resource` | stesse verifiche implementate in Rust nella transazione |

La traduzione (`mosaikit_sql_guard::sqlite`) lavora sull'AST di sqlparser:
nomi, cast, `now()`, intervalli e `make_interval`, `= ANY(...)` e `<> ALL(...)`
(su array JSON), `ILIKE`, `json_build_object`, `string_agg`, `EXTRACT`,
`to_char`/`date_trunc` comuni, `FOR UPDATE`, placeholder `$n` -> `?n`. Le
costruzioni senza equivalente sicuro sono rifiutate con un messaggio chiaro
(`json_agg` di righe intere, `DISTINCT ON`, espressioni regolari, `ALTER COLUMN
TYPE`). I modelli SQL valutano i propri argomenti in una sottoquery senza
tabelle: una colonna non qualificata dell'SQL chiamante non viene risolta per
errore sulle tabelle core interne.

Ogni transazione e' `BEGIN IMMEDIATE` (scritture serializzate, niente stalli da
promozione del lock); per questo `plugin.call` (§8.6) e i plugin con
`[requires] database = "postgres"` non sono disponibili su SQLite.

## 8. Plugin

### 8.1 Struttura

I plugin ufficiali sono in `../mosaikit-plugins`, quelli di una distribuzione
nelle sue cartelle (§14), ciascuna con il proprio workspace Cargo e npm.

```
mosaikit-plugins/notes/
├── plugin.toml          manifest v3
├── Cargo.toml           (se c'è logica) dipende da mosaikit-plugin-sdk
├── src/lib.rs           logica WASM: comandi e hook
├── migrations/          SQL del plugin (tabelle, viste kpi_*)
└── ui/                  UI (Vite + TypeScript) → ui/dist
    └── public/          (facoltativo) visualizzatore per i link pubblici
```

### 8.2 Manifest (`plugin.toml`)

```toml
id = "com.mosaikit.notes"
name = "Note"
version = "0.3.0"
abi = 1
min_kernel = "1.0.0"
description = "Note personali e condivise"

[contribution]
icon = "📝"
label = "Note"

[[resources]]            # CRUD generico: tabella generata dall'host
name = "notes"
title_field = "title"    # campo usato come titolo della risorsa
fields = [
  { key = "title", label = "Titolo", kind = "text", required = true },
  { key = "body",  label = "Testo",  kind = "text", multiline = true },
  { key = "tag",   label = "Tag",    kind = "choice", options = ["personale", "lavoro"] },
]

[ui]
entry = "index.html"     # dentro ui/dist
public_view = "public.html"   # facoltativo

[permissions]
hooks = ["notes"]        # hook WASM sulle risorse
files = false            # API file/cartelle con contenuto su disco
content = false          # contenuto a cartella da zip (siti)
network = []             # origini raggiungibili da http.fetch
frame_src = []           # origini incorporabili dalla UI
calls = []               # plugin di cui la logica chiama i comandi (§8.6)

[requires]               # facoltativo
database = "postgres"    # usa funzioni di PostgreSQL: non si installa su SQLite
extensions = ["postgis"] # devono essere installate nel database

[[kpi]]
view = "kpi_notes_by_tag"
label = "Note per tag"
```

Tipi di campo: `text` (anche `multiline`), `number`, `bool`, `date`, `choice`.

### 8.3 Logica WASM (ABI v1)

Il runtime usa **wasmi** (interprete puro Rust): istanza nuova per ogni
chiamata, limite di istruzioni (fuel), limite di memoria, nessuna WASI (niente
file, rete, orologio se non tramite l'host).

| Lato | Simbolo | Firma |
|---|---|---|
| export del plugin | `msk_alloc(len) -> ptr` | allocazione nella memoria del guest |
| export del plugin | `msk_call(ptr, len) -> i64` | messaggio JSON in ingresso, risposta `(ptr << 32) \| len` |
| import dall'host | `msk.host_call(ptr, len) -> i32` | richiesta JSON all'host, ritorna la lunghezza della risposta (<0 errore) |
| import dall'host | `msk.host_read(ptr)` | copia la risposta pendente nel guest |
| import dall'host | `msk.log(ptr, len)` | log |

Messaggi: `{"abi":1,"kind":"command","name":…,"args":…,"ctx":…}` oppure
`{"abi":1,"kind":"hook","hook":"before_create"|"before_update"|"after_delete",…}`;
risposta `{"ok":…}` o `{"err":"…"}`. Operazioni host: `db.query`, `db.exec`,
`resource.create`, `resource.delete`, `http.fetch` (solo verso `network`),
`plugin.call` (solo verso `calls`, §8.6).

Con il crate **`mosaikit-plugin-sdk`** il plugin non vede l'ABI:

```rust
use mosaikit_plugin_sdk::prelude::*;

fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    if v.str("tag").is_empty() { v.set("tag", "personale"); }
    ctx.log("tag di default applicato");
    Ok(Some(v))
}

fn count_by_tag(ctx: &Ctx, _args: Value) -> Result<Value> {
    ctx.db().query("select tag, count(*) as n from notes group by tag", &[])
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "notes.before_create" => before_create },
    commands: { "notes.count_by_tag" => count_by_tag },
}
```

Hook e comandi girano **nella stessa transazione** dell'operazione: un errore
annulla tutto.

### 8.4 UI

- Servita dall'**origine untrusted** (`{plugin_url}/ui/{id}/…`) in un iframe con
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups
  allow-downloads allow-modals"`. Essendo un'altra origine, non può leggere
  cookie, storage o DOM dell'host.
- Comunica solo con il **bridge postMessage** (`@mosaikit/plugin-api`).
  L'host verifica che il messaggio arrivi dall'iframe corrente, lo traduce in
  una chiamata REST **limitata a quel plugin** e la esegue con la sessione.

```ts
import { connect, mountCrud } from '@mosaikit/plugin-api'

const msk = await connect()                 // handshake, tema, utente, tenant
mountCrud(document.getElementById('app')!, msk, 'notes', { title: 'Note' })
// oppure a mano:
const rows = await msk.crud('notes').list({ filter: 'roma' })
await msk.call('notes.count_by_tag', {})
await msk.share(rows[0].id)                  // finestra di condivisione dell'host
```

API del bridge: `crud(name).list/get/create/update/delete`, `call`,
`files.*` (se `files`), `content.upload/ticket` (se `content`),
`resource.meta`, `share`, `toast`, `theme`.

**Lingua, tema e modo.** L'handshake porta `context`: `lang` (`it`, `en`…),
`preset` (tema dell'host), `mode` (`light` o `dark`, quello in uso),
`preference` (`light`, `dark` o `auto`) e `theme` (variabili CSS). A ogni
cambio l'host manda l'evento `context` con i valori nuovi (e, per i plugin
scritti prima, l'evento `theme` con le sole variabili). `connect()` li applica
a `<html>` (`lang`, `data-mode`, `data-preset`, `color-scheme`, variabili);
per reagire, ad esempio cambiando le etichette:

```ts
msk.context?.lang                          // all'avvio
msk.onContext((c) => render(c.lang))       // a ogni cambio
```

Il plugin li riceve anche quando l'Administrator nasconde i pulsanti di lingua
o tonalità dalla barra in alto.

### 8.5 Pacchetto `.mskp` v3 e firma

Uno zip con `plugin.toml`, `logic.wasm` (facoltativo), `ui/**`, `migrations/**`,
più:

- `MANIFEST.sha256`: hash di ogni file del pacchetto;
- `SIGNATURE`: firma ed25519 di `MANIFEST.sha256` (chiave dell'editore).

All'installazione l'host ricalcola gli hash (nessun file in più o in meno),
verifica la firma con le chiavi fidate della configurazione e controlla la
blocklist. Con `allow_unsigned = true` (solo sviluppo) accetta pacchetti non
firmati, segnalandoli.

### 8.6 Chiamate tra plugin

Un plugin non legge mai le tabelle di un altro. Puo' pero' chiamarne i comandi:
`ctx.call_plugin("com.esempio.dati", "dati.elenco", args)`, se il
plugin chiamato e' dichiarato in `[permissions] calls`. Il comando chiamato:

- gira con **lo stesso utente e tenant**, in una **sua transazione** e con il
  suo ruolo: applica le proprie regole (un cruscotto condiviso mostra a
  ciascuno solo i dati che puo' vedere);
- puo' a sua volta chiamare altri plugin, fino a 3 livelli;
- se fallisce, il chiamante riceve l'errore e decide (es. un job "fallito").

Richiede PostgreSQL (§7.6).

### 8.7 Registry (`registry/index.json`)

Catalogo dei plugin di cui l'installazione si fida: per ogni plugin le versioni,
il percorso o l'URL del pacchetto, lo sha256, l'editore e la **blocklist** delle
versioni revocate. Serve a: installare da una fonte fidata invece che da un
file qualunque, verificare l'integrità, mostrare gli aggiornamenti, revocare
versioni compromesse. La release ne include una copia per le installazioni
offline. Con una sola installazione e soli plugin interni basta la firma.

## 9. Sicurezza web: origini, cookie, CSP

| Origine | Listener | Contenuto |
|---|---|---|
| app (`url`) | `listen` (default: porta di `url`) | UI host, API, marchio |
| untrusted (`plugin_url`, default la porta successiva) | `plugin_listen` | UI dei plugin, contenuti caricati dagli utenti, link pubblici |

Entrambe le origini possono avere un **percorso base** (es.
`http://127.0.0.1:8080/mosaikit`): i router sono montati sotto il percorso,
`<base>` reindirizza a `<base>/`, la UI host usa percorsi relativi e i cookie
sono limitati al percorso.

- **Sessione**: cookie `msk_session` `HttpOnly; SameSite=Strict; Path=<base>/`
  (`Secure` con HTTPS). Il token è salvato nel DB solo come hash.
- **CSRF**: ogni richiesta che modifica dati richiede `X-CSRF-Token`, ottenuto da
  `GET /api/session` (same-origin). Un header custom forza il preflight CORS,
  che il server non autorizza per altre origini.
- **CORS** chiuso (nessuna origine esterna).
- **CSP** dell'host: `default-src 'self'`, `frame-src` limitato all'origine
  untrusted, `frame-ancestors 'none'`.
- **Contenuti utente** (siti statici, anteprime): sempre con
  `Content-Security-Policy: sandbox …` senza `allow-same-origin` (origine
  opaca), `nosniff`, `Referrer-Policy: no-referrer`.
- **Password**: argon2id. Login con limite di tentativi per utente/IP.
- In produzione le due origini sono due hostname dietro il reverse proxy
  (es. `app.esempio.it` e `plugins.esempio.it`), con HTTPS.

## 10. Configurazione e data dir

Configurazione: `mosaikit.toml` + variabili d'ambiente `MOSAIKIT_*` (che hanno
la precedenza). Ogni proprieta' e' descritta in `mosaikit.example.toml`, che e'
anche un test (il file deve restare valido).

```toml
url = "http://127.0.0.1:8080/mosaikit"   # l'unico indirizzo obbligatorio
# plugin_url = "https://plugins.esempio.it/mosaikit"   # default: porta successiva
# listen = "0.0.0.0:8080"                # default: dalla porta di url
data_dir = "data"
trusted_keys = ["<chiave pubblica ed25519 base64>"]
registry = "registry/index.json"
brand = "branding"

[database]
backend = "sqlite"      # o "postgres"; default: postgres se c'e' url o embedded
# url = "postgres://mosaikit_app:***@127.0.0.1:5432/mosaikit"
# embedded = true       # desktop: PostgreSQL locale nella data dir
```

```
<data_dir>/
├── plugins/<id>/<versione>/   codice dei plugin installati (sola lettura)
├── blobs/<tenant>/<resource>/ contenuti: file (file) e siti (site/...)
├── mosaikit.db                SQLite (con -wal e -shm), se il backend e' SQLite
├── pg/                        solo desktop con PostgreSQL: cluster embedded e credenziali generate
├── logs/mosaikit.log          solo desktop
└── credenziali-iniziali.txt   solo se al primo avvio sono state generate password
```

I contenuti di risorse eliminate vengono rimossi subito; all'avvio una pulizia
elimina eventuali residui (cartelle senza risorsa, piu' vecchie di un'ora).
Il backup consiste in un dump del database piu' la cartella `blobs/`; nella
versione desktop basta copiare l'intera data dir a server fermo.

I dati strutturati sono tutti nel database. Al primo avvio viene creato il
tenant `system` e l'Administrator `admin`: la password è `MOSAIKIT_ADMIN_PASSWORD`
oppure viene generata e scritta in `credenziali-iniziali.txt`. Con
`initial_tenant` (release desktop: `"locale"`) il primo avvio crea anche un
tenant di lavoro, con il nome del prodotto, e il suo Tenant Manager `utente`
(password generata, nello stesso file; con `initial_password`, release desktop:
`"mosaikit"`, entrambi gli account hanno quella, anche se piu' corta della
policy, che vale di nuovo al cambio): sul desktop si lavora subito, senza
passare dall'amministrazione. La migrazione `0003_admins`
porta le installazioni precedenti al modello attuale: un Administrator di un
altro tenant diventa un account di `system` con la stessa password (con
suffisso `-<tenant>` se il nome e' gia' preso), l'account originale resta senza
il ruolo; gli altri account di `system` vengono disabilitati e le membership che
coinvolgono `system` rimosse; tutte le sessioni vengono chiuse.

## 11. Struttura del repository

```
mosaikit/
├── Cargo.toml               workspace
├── crates/
│   ├── mskp/                formato pacchetto, manifest v3, firma
│   ├── sql-guard/           whitelist SQL (sqlparser) e traduzione verso SQLite
│   ├── db/                  API dei dati: PostgreSQL (migrazioni, RLS, ruoli) e SQLite (schema, filtri, trigger)
│   ├── runtime/             wasmi
│   ├── kernel/              servizi: identity, tenancy, acl, links, kpi, overview, brand, plugins, blobs
│   │                        (tenancy/: tenants, administrators, members, invitations, groups, settings, directory)
│   ├── server/              axum, due listener, UI host embedded
│   ├── desktop/             mosaikit.exe (Windows): senza console, icona nell'area di notifica
│   └── plugin-sdk/          crate per i plugin (lato guest)
├── ui/
│   ├── host/                UI host (React + Vite)
│   └── plugin-api/          @mosaikit/plugin-api (bridge, mountCrud)
├── branding/                marchio di Mosaikit (brand.toml documentato)
├── distribution.toml        distribuzione "Mosaikit" (§14)
├── mosaikit.example.toml    tutte le proprieta' di configurazione
├── e2e/                     test nel browser (Playwright)
├── deploy/                  Dockerfile, compose.yml, compose.dev.yml
├── xtask/                   dev, db, plugin, test, e2e, ci, release
│   ├── templates/plugin/    scheletro per `cargo xtask plugin new`
│   └── mosaikit.dev.toml    configurazione di `cargo xtask dev`
├── docs/
../mosaikit-plugins/         plugin ufficiali (notes, tasks, contacts, maps, static-site, files)
../<prodotto>/               eventuali distribuzioni (§14): fanno riferimento a mosaikit
```

## 12. Sviluppo

| Comando | Cosa fa |
|---|---|
| `cargo xtask db up` | avvia un PostgreSQL di sviluppo (binari locali o Docker) |
| `cargo xtask dev` | DB + build plugin + server in modalità dev + Vite dell'host, con hot reload |
| `cargo xtask plugin new <nome>` | crea un plugin dal template |
| `cargo xtask plugin pack <dir>` | compila e impacchetta (firma con la chiave di sviluppo) |
| `cargo xtask test` | test Rust su PostgreSQL e su SQLite, test dei plugin e della distribuzione, test UI |
| `cargo xtask ci` | fmt, clippy `-D warnings`, test, lint e build UI |

Tutti i comandi accettano `--dist <cartella>` (§14).

**Hot reload in sviluppo** (cartelle dei plugin da `MOSAIKIT_DEV_PLUGINS`,
impostata da `cargo xtask dev` con i plugin della distribuzione):

| Modifica | Effetto |
|---|---|
| `<plugin>/src/**` | ricompilazione wasm nel workspace del plugin; il server ricarica il modulo (istanza per chiamata: nessun riavvio) |
| `<plugin>/ui/**` | `vite build --watch`; l'host ricarica l'iframe del plugin |
| `<plugin>/migrations/**`, `plugin.toml` | migrazioni nuove applicate, manifest ricaricato, rail aggiornata |
| `ui/host/**` | HMR di Vite |
| `crates/**` | ricompilazione e riavvio del server; le sessioni restano (sono nel DB) |

I plugin in sviluppo sono letti dalla cartella, non serve impacchettarli; la
modalità dev esiste solo nelle build debug.

## 13. Release

| Release | Comando | Contenuto |
|---|---|---|
| Desktop | `cargo xtask [--dist ..] release desktop` | zip con eseguibile (nome, icona e descrizione del marchio), configurazione commentata, plugin firmati, registry; SQLite oppure PostgreSQL embedded (`[desktop] database`) |
| Server | `cargo xtask [--dist ..] release docker` | immagine Docker della distribuzione (contesto temporaneo: mosaikit, cartelle dei plugin e distribuzione, da distribution.toml) e cartella pronta all'uso: immagine salvata, `compose.yml` con PostgreSQL (o PostGIS), `.env`, `initdb/`, `README.md`; in più la cartella Kubernetes |
| Kubernetes | `cargo xtask [--dist ..] release k8s` | manifest kustomize da `deploy/k8s`: namespace, PostgreSQL (StatefulSet), app (Deployment `Recreate`, volume `/data`), Ingress con due hostname, ConfigMap e Secret da `config.env`/`secret.env`, `README.md`; verificati con `kubectl kustomize` |
| Tutte | `cargo xtask [--dist ..] release all` | desktop, Docker e Kubernetes (senza Docker attivo: desktop e Kubernetes) |

Le release vanno in `<distribuzione>/dist` (`mosaikit/dist` per Mosaikit).
La versione desktop ha **un solo eseguibile**: senza argomenti avvia l'app con
l'icona nell'area di notifica; da un terminale esegue i comandi di
amministrazione (`migrate`, `reset-password`, `reset-totp`, `config`) nella sua console.

In CI un tag `v*` produce le release (vedi `.github/workflows/release.yml`).
Dettagli operativi nel `README.md`.

## 14. Distribuzioni e marchio

Una **distribuzione** e' un prodotto basato su Mosaikit, descritto da
`distribution.toml`:

- `[product]`: id, nome, versione e nome dell'eseguibile;
- `[brand] dir`: cartella del marchio;
- `[plugins]`: cartelle dei plugin (`roots`) e plugin inclusi (`include`);
- `[desktop]`: database e porta;
- `[docker]`: immagine dell'app e immagine PostgreSQL;
- `[tests] cargo`: test di integrazione propri.

Mosaikit stesso e' la distribuzione di default. `cargo xtask --dist <cartella>`
la usa per sviluppo, test e release. Il kernel non cambia: cambiano marchio e
plugin.

**Marchio** (`brand.toml`): nome, versione, frase e messaggio della pagina di
accesso, piede, indirizzo di supporto, logo, favicon, icona `.ico` e colori del
tema (solo `#rrggbb`, convertiti in variabili CSS). Ecco come si applica:
- **server**: inietta titolo e colori nella pagina; espone `/api/brand`
  (pubblico) e `brand/logo|favicon|icon` (con CSP `sandbox`);
- **UI host**: lo usa in accesso, barra laterale e barra di stato; le UI dei
  plugin ricevono gli stessi colori con il tema del bridge;
- **app desktop**: lo mostra nell'area di notifica;
- **release desktop**: incorpora nell'eseguibile nome, versione e icona.

La dipendenza va in un solo verso: la distribuzione fa riferimento a Mosaikit
(SDK, `@mosaikit/plugin-api`, kernel per i test, xtask per build e release),
Mosaikit non fa riferimento a nessuna distribuzione.

## 15. Limiti noti e prossimi passi

- **OIDC per tenant** (Keycloak o IdP del cliente): non ancora implementato;
  oggi l'autenticazione dei tenant è locale (argon2id). La pagina di accesso
  riceve gia' il metodo di ogni tenant (`auth`). Da definire: configurazione
  per tenant (issuer, client, segreto cifrato, claim), identita' esterne
  (issuer + `sub`, mai collegate per email), creazione al primo accesso, una
  sola fonte dei ruoli per tenant (Mosaikit oppure gruppi dell'IdP), revoca
  (back-channel logout) e funzioni locali da disattivare nei tenant OIDC. Gli
  Administrator restano sempre locali.
- **Sottodomini per plugin**: tutte le UI dei plugin condividono l'origine
  untrusted; un sottodominio per plugin isolerebbe anche i plugin tra loro.
- **Storage S3** per i blob: oggi solo filesystem.
- **Firma dei pacchetti con chiave di produzione**: la release usa la chiave
  indicata in `MOSAIKIT_SIGNING_KEY` / `MOSAIKIT_SIGNING_KEY_FILE`; in sviluppo
  una chiave locale non committata (`.dev/signing.key`).
- **Backup automatico prima degli aggiornamenti dei plugin**: non ancora
  implementato; le migrazioni girano in una transazione (un errore annulla tutto).
- **Bridge delle UI**: nessun avanzamento durante gli upload (si conta per file),
  niente statistiche ricorsive delle cartelle.
- **SQLite**: niente `plugin.call` ne' estensioni; scritture serializzate (adatto
  al desktop e a installazioni piccole); `ILIKE` diventa `LIKE`, che non
  distingue maiuscole e minuscole solo per i caratteri ASCII.
