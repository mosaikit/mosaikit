# Mosaikit

Piattaforma web **multi-tenant a plugin**. Il kernel è domain-agnostic: conosce
tenant, utenti e ruoli, risorse, permessi, link pubblici, KPI e plugin. Ogni
dominio vive in un plugin:
- logica WebAssembly in sandbox;
- UI isolata in un iframe;
- dati propri, protetti con le stesse regole su **PostgreSQL** (Row-Level
  Security) o su **SQLite** (riscrittura delle query, trigger e authorizer).

Su Mosaikit si costruiscono **distribuzioni**: prodotti con un proprio marchio,
una propria scelta di plugin ed eventuali plugin propri. Una distribuzione e' un
progetto separato che fa riferimento a Mosaikit; Mosaikit non ne conosce nessuna.

Architettura completa: **[docs/architettura.md](docs/architettura.md)**.

## Indice

- [Cosa offre](#cosa-offre)
- [Progetti e struttura](#progetti-e-struttura)
- [Prerequisiti](#prerequisiti)
- [Avvio rapido in sviluppo](#avvio-rapido-in-sviluppo)
- [Distribuzioni e marchio](#distribuzioni-e-marchio)
- [Sviluppare un plugin](#sviluppare-un-plugin)
- [Database: PostgreSQL o SQLite](#database-postgresql-o-sqlite)
- [Test](#test)
- [Release desktop](#release-desktop)
- [Release server con Docker](#release-server-con-docker)
- [Release Kubernetes](#release-kubernetes)
- [Configurazione](#configurazione)
- [Amministrazione](#amministrazione)
- [Comandi xtask](#comandi-xtask)

## Cosa offre

- **Tre ruoli**:
  - **Administrator**: di sistema; gestisce tenant, plugin, KPI globali e gli
    altri Administrator;
  - **Tenant Manager**: gestisce utenti, inviti, gruppi, policy e KPI del
    proprio tenant;
  - **User**: lavora con le proprie risorse e con quelle condivise con lui.

  Ogni utente si autentica sempre sul proprio tenant di appartenenza e può
  essere invitato in altri tenant, con un ruolo diverso in ciascuno.
- **Panoramica**: è la pagina iniziale dopo l'accesso e mostra i dati del ruolo:
  - per tutti: le proprie risorse, le condivisioni fatte e ricevute, i link
    pubblici, l'attività recente;
  - per il Tenant Manager, in più: gli aggregati del tenant;
  - per l'Administrator, in più: quelli di tutto il sistema.
- **Risorse con proprietario**:
  - si condividono con utenti e gruppi del tenant a tre livelli (lettura,
    scrittura, gestione), con ereditarietà sulle cartelle;
  - quando un utente esce dal tenant, il Tenant Manager ne riassegna le risorse.
- **Link pubblici**: in sola lettura, con scadenza, password facoltativa e
  conteggio delle visite.
- **KPI**: per tenant (Tenant Manager) e su tutti i tenant (Administrator).
  Solo metadati e aggregati, mai i contenuti.
- **Plugin**:
  - pacchetti `.mskp` firmati (ed25519), con catalogo e blocklist;
  - logica in WASM (wasmi: fuel e memoria limitati; file, rete e orologio solo
    tramite l'host);
  - UI su un'origine separata, che parla con l'host solo via `postMessage`;
  - SQL limitato alle proprie tabelle;
  - chiamate ai comandi di altri plugin, se dichiarate;
  - requisiti dichiarati (es. PostgreSQL + PostGIS).
- **Sicurezza web**: password argon2id, cookie di sessione `HttpOnly`, token
  CSRF, CSP restrittive. I contenuti caricati dagli utenti sono sempre serviti
  in sandbox.
- **Marchio**: nome, versione, logo, favicon, colori, testi della pagina di
  accesso e icona desktop, da un file `brand.toml`.

Plugin ufficiali (in `../mosaikit-plugins`): Note, Attività, Contatti, Mappe
(GeoLibre), Siti statici, File.

## Progetti e struttura

Progetti affiancati nella stessa cartella:

```
mosaikit/            piattaforma (questo repository)
mosaikit-plugins/    plugin ufficiali: workspace Cargo e npm propri
<prodotto>/          eventuali distribuzioni: fanno riferimento a ../mosaikit
```

```
mosaikit/
  crates/
    mskp/        formato dei pacchetti, manifest v3, firma
    sql-guard/   whitelist SQL dei plugin + traduzione PostgreSQL -> SQLite
    db/          accesso ai dati: PostgreSQL (RLS, ruoli) e SQLite (stesse regole)
    runtime/     esecuzione WASM (wasmi)
    plugin-sdk/  SDK Rust per la logica dei plugin (+ host simulato per i test)
    kernel/      tenant, identita', ruoli, permessi, link, KPI, Panoramica, plugin, marchio
    server/      HTTP (axum): API, UI host incorporata, UI dei plugin, link pubblici
    desktop/     mosaikit.exe: app desktop senza console, icona nell'area di notifica
  ui/
    host/        UI host (React + Vite)
    plugin-api/  @mosaikit/plugin-api: bridge, CRUD generico, tema
  branding/      marchio di Mosaikit (brand.toml documentato)
  e2e/           test nel browser (Playwright)
  deploy/        Dockerfile e compose
  xtask/         automazione: cargo xtask <comando>
    templates/plugin/    scheletro per `cargo xtask plugin new`
    mosaikit.dev.toml    configurazione di `cargo xtask dev`
  docs/          architettura
  distribution.toml        la distribuzione "Mosaikit"
  mosaikit.example.toml    tutte le proprieta' di configurazione, descritte
```

## Prerequisiti

| Strumento | Versione | Note |
|---|---|---|
| Rust | stabile recente | `rustup target add wasm32-unknown-unknown` |
| Node.js | 20 o successivo | npm workspaces |
| PostgreSQL | 15 o successivo | per sviluppo e test (binari locali o Docker); PostGIS se una distribuzione lo richiede |
| Docker | facoltativo | per l'immagine server, o come PostgreSQL di sviluppo |

SQLite è incluso nell'eseguibile: non serve installarlo.

Su Windows tutto funziona da PowerShell: non servono bash né WSL. PostgreSQL
viene cercato nel `PATH`, in `C:\Program Files\PostgreSQL\*\bin`, oppure dove
indica `MOSAIKIT_PG_BIN`.

Il repository `mosaikit-plugins` deve stare accanto a `mosaikit`.

## Avvio rapido in sviluppo

```powershell
rustup target add wasm32-unknown-unknown
npm install
cargo xtask dev                       # Mosaikit
cargo xtask --dist ../prodotto dev    # oppure una distribuzione (marchio e plugin suoi)
```

`cargo xtask dev` fa quattro cose:

1. Avvia un **PostgreSQL di sviluppo dedicato** in `.dev/pg`, sulla porta 55432.
   Se PostgreSQL ha PostGIS, lo attiva (anche nei database dei test).
2. Compila logica e UI dei plugin della distribuzione, presi dalle cartelle in
   `[plugins] roots`.
3. Avvia il **server** in modalità sviluppo con `xtask/mosaikit.dev.toml`:
   - API su :47080;
   - plugin e contenuti su :47081;
   - plugin letti dalle loro cartelle, con `MOSAIKIT_DEV_PLUGINS`.
4. Avvia **Vite** per la UI host su **http://127.0.0.1:5173**.

Primo accesso: tenant `system`, utente `admin`, password `admin-sviluppo`
(oppure il valore di `MOSAIKIT_ADMIN_PASSWORD`).

| Modifica | Effetto |
|---|---|
| `ui/host/**` | HMR di Vite, senza ricaricare la pagina |
| `<plugin>/ui/**` | `vite build --watch` ricompila la UI e l'host ricarica l'iframe del plugin |
| `<plugin>/src/**` | ricompila il WASM; il server ricarica il modulo senza riavviarsi |
| `<plugin>/migrations/**`, `plugin.toml` | applica le migrazioni nuove, ricarica il manifest, aggiorna la barra laterale |
| `crates/**` | ricompila e riavvia il server; le sessioni restano valide |

Se modifichi una migrazione già applicata, il server lo segnala. A quel punto
crea una migrazione nuova, oppure azzera i dati del plugin con
`cargo xtask plugin db-reset <id>`.

```powershell
cargo xtask db up | down | reset | url      # PostgreSQL di sviluppo
```

## Distribuzioni e marchio

Una distribuzione è un prodotto basato su Mosaikit. Il kernel resta lo stesso;
cambiano nome, versione, marchio e plugin. È descritta da `distribution.toml`:

```toml
[product]
id = "prodotto"             # nomi dei file di release e dell'immagine Docker
name = "Prodotto"
version = "0.1.0"
executable = "prodotto"     # prodotto.exe nella versione desktop

[brand]
dir = "branding"            # brand.toml + logo, favicon, icona

[plugins]
roots = ["../mosaikit-plugins", "plugins"]   # cartelle dei plugin
include = ["com.mosaikit.notes", "com.esempio.catasto"]   # o "*"

[desktop]
database = "sqlite"         # o "postgres" (PostgreSQL embedded, es. per PostGIS)
port = 48080

[docker]
image = "prodotto"
postgres_image = "postgis/postgis:17-3.5-alpine"

[tests]
cargo = ["tests"]           # test di integrazione della distribuzione
```

Ogni comando xtask accetta `--dist <cartella>` (oppure `MOSAIKIT_DIST`); senza,
usa la distribuzione di Mosaikit (`distribution.toml` qui).

**Marchio** (`branding/brand.toml`, tutte le proprietà descritte nel file):
- nome, versione, frase e messaggio della pagina di accesso, piè di pagina;
- logo, favicon e icona `.ico`;
- colori del tema (`accent`, `bg`, `panel`, `fg`, ...).

Ecco dove si applicano:
- **server**: titolo e colori iniettati nella pagina; `/api/brand`;
  `brand/logo` e `brand/favicon`;
- **UI**: accesso, barra laterale, barra di stato; le UI dei plugin ricevono
  lo stesso tema;
- **versione desktop**: nome nell'area di notifica, icona; nome, descrizione e
  icona dell'eseguibile (impostati dalla release).

I colori accettano solo `#rrggbb`, quindi niente CSS arbitrario nella pagina.

## Sviluppare un plugin

```powershell
cargo xtask plugin new catasto --id com.comune.catasto                  # in ../mosaikit-plugins
cargo xtask --dist ../prodotto plugin new rilievi --id com.esempio.rilievi   # nei plugin della distribuzione
cargo xtask dev
```

Il plugin viene creato nella prima cartella di `[plugins] roots` (oppure dove
indica `--into`) e aggiunto ai workspace Cargo e npm di quella cartella. Con
`--no-logic` si crea un plugin senza WASM (solo manifest, migrazioni e UI).

```
catasto/
├── plugin.toml        manifest: risorse CRUD, permessi, requisiti, UI, KPI
├── Cargo.toml         logica WASM (facoltativa)
├── src/lib.rs         hook e comandi (mosaikit-plugin-sdk)
├── migrations/        SQL del plugin: tabelle, viste, viste kpi_*
└── ui/                Vite + TypeScript, @mosaikit/plugin-api
```

**Manifest.** Ogni voce di `[[resources]]` diventa una tabella generata
dall'host. Ogni riga è una risorsa del kernel: ha un proprietario, si condivide
e può avere un link pubblico. Le altre sezioni:

- `[permissions]`:
  - `hooks`, `files`, `content`;
  - `network` e `frame_src` (origini);
  - `calls`: id dei plugin di cui la logica chiama i comandi.
- `[requires]`:
  - `database = "postgres"`, per usare funzioni di PostgreSQL;
  - `extensions = ["postgis"]`.

  Su SQLite, o senza l'estensione, l'installazione si ferma con un messaggio
  chiaro.

**Logica** (`src/lib.rs`):

```rust
use mosaikit_plugin_sdk::prelude::*;

fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    if v.str("status").is_empty() { v.set("status", "bozza"); }
    Ok(Some(v))                       // Err(...) rifiuta e annulla la transazione
}

fn riepilogo(ctx: &Ctx, _args: Value) -> Result<Value> {
    // l'utente vede solo le righe a cui ha accesso (RLS o filtro su SQLite)
    Ok(Value::Array(ctx.db().query("select status, count(*)::int n from catasto group by 1", &[])?))
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "catasto.before_create" => before_create },
    commands: { "catasto.riepilogo" => riepilogo },
}
```

- `ctx.call_plugin("com.altro.plugin", "comando", args)` chiama un plugin
  dichiarato in `calls`, con lo stesso utente; funziona solo su PostgreSQL.
- La logica si prova in nativo, senza server, con
  `mosaikit_plugin_sdk::testing::MockHost` e `cargo test -p catasto`.

**Migrazioni** (`migrations/NNN_nome.sql`). L'SQL si scrive per PostgreSQL;
su SQLite viene tradotto.

- Ogni tabella deve avere `resource_id uuid not null` e
  `tenant_id uuid not null default core.ctx_tenant()`. L'host aggiunge chiave
  esterna, indice e regole di accesso (policy RLS o trigger).
- Le viste `kpi_*` (con `tenant_id`) alimentano i KPI. Le altre viste
  rispettano i permessi di chi le legge.
- Sono rifiutati funzioni, policy, `GRANT`, `SET` e riferimenti ad altri schemi.

**UI** (`ui/src/main.ts`):

```ts
import '@mosaikit/plugin-api/style.css'
import { connect, mountCrud } from '@mosaikit/plugin-api'

const msk = await connect()                       // handshake con l'host, tema
mountCrud(document.getElementById('app')!, msk, 'catasto', { title: 'Catasto' })
// oppure su misura: msk.crud('catasto').list(), msk.call('catasto.riepilogo'),
// msk.share(id), msk.files.*, msk.content.*
```

La UI non fa `fetch` verso l'app e non vede token né cookie. Ogni richiesta
passa dall'host, che la limita a quel plugin e al tenant attivo.

**Pacchetto firmato** (per l'installazione su un server):

```powershell
cargo xtask plugin keygen --out editore.key   # una volta: chiave privata dell'editore
$env:MOSAIKIT_SIGNING_KEY_FILE = "editore.key"
cargo xtask plugin pack --release             # dist/registry/plugins/*.mskp + index.json
```

Il server accetta il pacchetto solo se la chiave pubblica dell'editore è in
`trusted_keys`. L'Administrator lo installa da *Sistema → Plugin*, caricando il
file oppure dal catalogo.

## Database: PostgreSQL o SQLite

| | PostgreSQL | SQLite |
|---|---|---|
| Uso tipico | server, Docker, distribuzioni con PostGIS | desktop (default), installazioni piccole |
| Righe visibili ai plugin | RLS + ruolo PostgreSQL per plugin | query riscritte: ogni lettura delle tabelle protette passa dal filtro sul livello di accesso |
| Scritture dei plugin | policy `WITH CHECK` | trigger che rifiutano righe non consentite |
| SQL scritto dal plugin | ruolo senza privilegi fuori dal suo schema | solo le sue tabelle; authorizer di SQLite contro segreti, PRAGMA, ATTACH, scritture altrove |
| `plugin.call`, PostGIS | sì | no (una sola transazione di scrittura alla volta) |

**Scelta del backend**:
- `database.backend = "sqlite" | "postgres"`, oppure `MOSAIKIT_DATABASE`;
- senza indicazioni si usa `postgres` se c'è `database.url` (o `embedded`),
  altrimenti `sqlite` con il file `<data_dir>/mosaikit.db`.

Le regole sono verificate dagli stessi test sui due backend (vedi [Test](#test)).

## Test

```powershell
cargo xtask test                         # Rust su PostgreSQL e su SQLite, plugin, UI
cargo xtask --dist ../prodotto test      # in piu' i plugin e i test della distribuzione
cargo xtask e2e                          # nel browser, su un'installazione completa
cargo xtask ci                           # fmt, clippy -D warnings, cargo-deny, typecheck, lint, build, test
```

| Suite | Cosa verifica |
|---|---|
| `crates/db/tests` | **su entrambi i backend**: filtri per livello, ereditarietà, isolamento tra tenant, plugin confinato nel suo spazio, link pubblici in sola lettura, KPI, rifiuto di schemi non conformi, disinstallazione |
| `crates/kernel/tests` | (anche con `MOSAIKIT_TEST_BACKEND=sqlite`) identità, tre ruoli e più Administrator, tenant e inviti, condivisione, Panoramica per ruolo, riassegnazione, hook e comandi WASM, KPI, file, siti, firma dei pacchetti, migrazioni, catalogo e blocklist, plugin malevoli, modalità sviluppo |
| `crates/server/tests` | (anche su SQLite) cookie e CSRF, header di sicurezza, separazione delle origini, contenuti in sandbox, link pubblici, percorso base, marchio |
| unit test dei crate e dei plugin | configurazione, manifest, pacchetti, guard e traduzione SQL, runtime, SDK, logica dei plugin |
| `ui/*`, `<plugin>/ui` (vitest) | bridge, instradamento delle operazioni, CRUD generico, file manager |
| `e2e` (Playwright) | sotto il percorso base `/mosaikit`: Administrator, tenant, Tenant Manager, User, Panoramica, plugin in iframe, condivisione, link pubblico, KPI, isolamento dell'iframe |

I test PostgreSQL creano database usa e getta (`msk_t_*`) sul cluster di
sviluppo, oppure dove indica `MOSAIKIT_TEST_DATABASE_URL`; serve un ruolo con
CREATEDB e CREATEROLE. Database orfani di test interrotti:
`cargo xtask db clean-tests`.

Per gli e2e, su Windows Playwright usa Edge già installato; altrove
`npx playwright install chromium` ed `E2E_CHANNEL=chromium`.

## Release desktop

```powershell
$env:MOSAIKIT_SIGNING_KEY_FILE = "editore.key"   # senza: chiave di sviluppo .dev/signing.key
cargo xtask release desktop                       # Mosaikit, con SQLite
cargo xtask --dist ../prodotto release desktop    # una distribuzione (SQLite o PostgreSQL embedded)
cargo xtask --dist ../prodotto release desktop --pg-dir "C:\pgsql"   # PostgreSQL da una cartella
```

Le release vanno nella cartella `dist/` **della distribuzione**: quelle di
Mosaikit in `mosaikit/dist`, quelle di una distribuzione in `<prodotto>/dist`.

```
mosaikit/dist/
├── mosaikit-1.0.0-desktop-windows-x86_64/
│   ├── mosaikit.exe             unico eseguibile: app con icona nell'area di notifica,
│   │                            da terminale anche i comandi di amministrazione
│   ├── mosaikit.toml            configurazione commentata (SQLite, apre il browser)
│   ├── mosaikit.example.toml    tutte le proprieta', descritte
│   ├── branding/                marchio
│   ├── registry/                index.json + plugins/*.mskp firmati (preinstallati)
│   └── AVVIO.txt
├── mosaikit-1.0.0-desktop-windows-x86_64.zip
├── mosaikit-1.0.0-docker/       (da `release docker`, vedi sotto)
├── mosaikit-1.0.0-k8s/          (da `release docker` o `release k8s`, vedi sotto)
└── SHA256SUMS                   zip e immagini Docker
```

Con `[desktop] database = "postgres"` lo zip contiene anche `pgsql/`, cioè
`bin/`, `lib/` e `share/` di PostgreSQL. Il programma crea un cluster privato
in `data\pg`, con PostGIS se disponibile.

**Uso:**

1. Doppio clic sull'eseguibile: compare l'icona del prodotto nell'area di
   notifica. Se l'avvio dura più di mezzo secondo (tipicamente il primo, o con
   PostgreSQL embedded), una finestrella mostra logo, nome, **versione** e fase in
   corso, con uno spinner.
2. Al primo avvio crea il database (`data\mosaikit.db` oppure `data\pg`), poi
   installa e attiva i plugin.
3. Quando è pronto, al **primo avvio** si apre il browser su
   http://127.0.0.1:48080 (`url` in `mosaikit.toml`). **Dai successivi** compare
   una notifica di Windows con l'indirizzo, che si apre con un clic. Con
   `open_browser = false` c'è sempre e solo la notifica. Per riaprire l'app basta
   un clic sull'icona o un nuovo doppio clic.
4. La password iniziale di `admin` è in `data\initial-admin-password.txt`
   (menu dell'icona → *Credenziali iniziali*).
5. Menu dell'icona → *Esci*: ferma tutto. Gli errori di avvio compaiono in una
   finestra di messaggio.

Il log è in `data\logs\mosaikit.log`. **Backup**: a programma fermo, copia la
cartella `data\`.

## Release server con Docker

```powershell
cargo xtask release docker                        # immagine mosaikit:<versione> + mosaikit/dist/mosaikit-<versione>-docker
cargo xtask --dist ../prodotto release docker     # immagine prodotto:<versione> + prodotto/dist/prodotto-<versione>-docker
cargo xtask release all                           # desktop + Docker + Kubernetes (senza Docker attivo: desktop + Kubernetes)
```

`release docker` genera anche la cartella Kubernetes (vedi sotto), con la stessa
immagine.

La distribuzione Docker è una cartella pronta da copiare sul server:

```
mosaikit/dist/mosaikit-1.0.0-docker/
├── mosaikit-1.0.0-image.tar     immagine (docker load -i ...)
├── compose.yml                  PostgreSQL (o PostGIS) + app
├── .env                         immagine, password, indirizzi e porte da modificare
├── initdb/                      creazione di ruolo, database ed eventuale PostGIS
└── README.md                    installazione, produzione, backup, aggiornamento
```

Sul server: `docker load -i mosaikit-1.0.0-image.tar`, poi si modifica `.env`
e si lancia `docker compose up -d`. Dal repository, senza la cartella, basta
`docker compose -f deploy/compose.yml up -d`.

Il `README.md` della cartella nasce da `deploy/README.docker.md`.

**Build.** `xtask` prepara un contesto di build temporaneo con mosaikit, le
cartelle dei plugin e la cartella della distribuzione, letti da
`distribution.toml`, senza build, dipendenze e dati. Il Dockerfile multi-stage:
- compila UI, server e plugin della distribuzione (`--build-arg DIST=...`);
- firma i plugin con la chiave passata come *secret* di BuildKit;
- l'immagine gira come utente non root, con i dati nel volume `/data`.

**Variabili principali** (vedi `deploy/compose.yml`):

| Variabile | Esempio |
|---|---|
| `MOSAIKIT_URL` | `https://gis.esempio.it/mosaikit` (anche con percorso base) |
| `MOSAIKIT_PLUGIN_URL` | `https://plugins.esempio.it/mosaikit` (origine diversa) |
| `MOSAIKIT_DATABASE_URL` | `postgres://mosaikit_app:***@db:5432/mosaikit` |
| `MOSAIKIT_ADMIN_PASSWORD` | password iniziale di `admin` (solo al primo avvio) |
| `MOSAIKIT_TRUST_PROXY` | `true` dietro un reverse proxy (X-Forwarded-For) |
| `MOSAIKIT_IMAGE`, `POSTGRES_IMAGE` | `prodotto`, `postgis/postgis:17-3.5-alpine` |

**Database.** `deploy/initdb/01-mosaikit.sh` crea il ruolo applicativo
`mosaikit_app` (non superutente, con `CREATEROLE` per i ruoli dei plugin), il
database e, se l'immagine la include, l'estensione PostGIS.

**Produzione.** Metti un reverse proxy HTTPS davanti, con **due hostname**: uno
per l'app (→ 8080) e uno per plugin, contenuti e link pubblici (→ 8081). Con
`https://` il cookie di sessione diventa `Secure`.

## Release Kubernetes

```powershell
cargo xtask release k8s                           # solo i manifest: mosaikit/dist/mosaikit-<versione>-k8s
cargo xtask release k8s --tag registry.esempio.it/mosaikit:1.0.0
```

Manifest **kustomize** generati dai modelli di `deploy/k8s` (segnaposto
`{{id}}`, `{{image}}`, `{{version}}`... sostituiti con i dati della
distribuzione):

```
mosaikit/dist/mosaikit-1.0.0-k8s/
├── kustomization.yaml   namespace, immagini, ConfigMap e Secret generati
├── namespace.yaml
├── postgres.yaml        StatefulSet PostgreSQL (o PostGIS) + volume
├── app.yaml             Deployment (1 replica, Recreate) + Service + volume /data
├── ingress.yaml         due hostname: app e plugin (origini separate)
├── config.env           MOSAIKIT_URL, MOSAIKIT_PLUGIN_URL... (ConfigMap)
├── secret.env           password (Secret)
├── initdb/
└── README.md            requisiti, installazione, database gestito, backup
```

Installazione: immagine nel registry del cluster, hostname e password da
modificare, poi `kubectl apply -k .`. Se `kubectl` è installato, la release
verifica i manifest con `kubectl kustomize` (non serve un cluster).

## Configurazione

Il file è `mosaikit.toml`: accanto all'eseguibile, nella cartella corrente,
oppure indicato con `--config` o `MOSAIKIT_CONFIG`. Le variabili `MOSAIKIT_*`
hanno la precedenza sul file. Ogni proprietà, con la variabile corrispondente,
è descritta in **[mosaikit.example.toml](mosaikit.example.toml)**.

Basta un indirizzo:

```toml
url = "http://127.0.0.1:8080/mosaikit"   # con l'eventuale percorso base
```

Da `url` si ricavano:
- `plugin_url`: stessa base sulla porta successiva, quindi un'origine diversa
  per le UI dei plugin;
- le porte di ascolto (`listen`, `plugin_listen`): solo locali se l'host è
  locale.

Dietro un reverse proxy si impostano `plugin_url` (un secondo hostname) e le
porte interne. Per controllare la configurazione risolta: `mosaikit-server config`
(server) oppure `mosaikit.exe config` (desktop).

## Amministrazione

```powershell
mosaikit-server migrate                                  # applica le migrazioni ed esce
$env:MOSAIKIT_NEW_PASSWORD = "..."; mosaikit-server reset-password --tenant system --user admin
```

Nella versione desktop c'e' un solo eseguibile: gli stessi comandi si danno a
`mosaikit.exe` (o `<prodotto>.exe`) da un terminale, ad applicazione chiusa,
ad esempio `.\mosaikit.exe reset-password --tenant system --user admin`.
L'output compare nel terminale.

- **Administrator**: da *Sistema*:
  - **Tenant**: crea i tenant, ciascuno con il suo Tenant Manager;
  - **Administrator**: assegna o toglie il ruolo; ne resta sempre almeno uno
    attivo;
  - **Plugin** e **KPI globali**.
- **Tenant Manager**: da *Gestione*: utenti, inviti, gruppi, policy, risorse
  (riassegnazione) e KPI del tenant.
- **Accesso BI ai KPI** (PostgreSQL): il ruolo `<prefisso>_reporting` legge
  solo le viste `kpi_*`. È creato `NOLOGIN`; per abilitarlo:
  `ALTER ROLE msk_mosaikit_reporting LOGIN PASSWORD '...'`.

## Comandi xtask

Tutti accettano `--dist <cartella della distribuzione>`.

| Comando | Descrizione |
|---|---|
| `cargo xtask dev [--no-ui]` | ambiente di sviluppo con hot reload |
| `cargo xtask db up\|down\|reset\|url\|clean-tests` | PostgreSQL di sviluppo |
| `cargo xtask plugin new <nome> [--id] [--no-logic] [--into]` | nuovo plugin dal template |
| `cargo xtask plugin build [--release]` | compila WASM e UI dei plugin della distribuzione |
| `cargo xtask plugin pack [--release] [--out]` | pacchetti firmati + registry |
| `cargo xtask plugin keygen [--out]` | chiavi di firma dell'editore |
| `cargo xtask plugin db-reset <id>` | azzera i dati di un plugin (sviluppo) |
| `cargo xtask test` / `e2e` / `ci` | test e controlli |
| `cargo xtask release bundle\|desktop\|docker\|k8s\|all` | release della distribuzione |
