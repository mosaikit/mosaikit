# Mosaikit

Piattaforma a plugin **domain-agnostic**: il kernel non conosce alcun dominio
(GIS, task, contatti, siti statici…). I plugin dichiarano nel manifest cosa
aggiungono (icona + risorsa CRUD generica) e il kernel li ospita, li
autentica, li persiste. I plugin sono moduli **WebAssembly** caricabili
dinamicamente da pacchetti `.mskp`.

## Caratteristiche

- **Kernel std-only, zero dipendenze** (`mosaikit-kernel`): nessun crate
  esterno in modalita' base — portabile, auditabile, compilabile ovunque.
- **Autenticazione**: password PBKDF2-HMAC-SHA256, sessioni con scadenza,
  ruoli `Admin`/`User` con autorizzazioni per azione (installazione plugin
  solo Admin).
- **Plugin WASM**: formato pacchetto `.mskp` (manifest JSON leggibile senza
  esecuzione + binario wasm32), validazione dell'ABI prima
  dell'installazione, hook guest→host (`on_create`/`on_update`/`on_delete`),
  azioni generiche (`msk_action`), capability dichiarate nel manifest.
- **CRUD generico**: il kernel espone un CRUD completo su qualsiasi
  risorsa dichiarata da un plugin (campi: testo, multiline, numero, bool,
  choice, date; validazione required; filtro).
- **Persistenza**: registry plugin + dati CRUD su filesystem
  (`mosaikit-data/`), JSON in modalita' std-only o **SQLite** (feature
  `sqlite`, default nel kernel).
- **Web app + REST API** (`mosaikit-server`): server axum che serve un
  frontend **React** (Vite, embedded nel binario via rust-embed da
  `mosaikit-ui/dist`) e una REST API; auto-reload della pagina al riavvio
  del backend in dev.
- **6 plugin di esempio**: note, attivita', contatti, mappe (catalogo mappe con
  embed di GeoLibre Web come in Sestante: il progetto `.geolibre.json` arriva
  dal ponte di stato `geolibre:*` e si salva da solo nel record), siti statici da zip (upload di uno zip con
  `index.html`, visualizzazione nell'area content, aggiornamento ed
  eliminazione), file manager.
- **UI nei plugin (modello GeoLibre)**: il pacchetto .mskp v2 puo' contenere
  `ui.js` (JavaScript trusted, come i plugin JS di GeoLibre); l'host lo
  serve su `/plugins/{id}/ui.js`, lo esegue con un'API (container, user,
  get/post/put/del/upload autenticati) e ne esegue il cleanup. Tutti e 6 i
  plugin di esempio portano la propria UI (CRUD generico nelle risorse,
  file manager): il frontend host non contiene piu' viste di plugin.
  Attenzione: il codice ui.js e' trusted (pieni privilegi della sessione) —
  la sicurezza e' affidata alla cura del registry, come dichiarato da
  GeoLibre.
- **VFS sandboxato** (`kernel vfs.rs`): storage file per-utente sotto
  `data_dir/users/<user>/files`, path traversal rifiutato; REST `/files/*`.
- **Storage dei plugin**: un plugin che dichiara il permesso `storage.files`
  ha un'area file condivisa fra utenti (`data_dir/plugin-data/<id>/files`):
  estrazione zip (STORED/DEFLATE, decoder inflate std-only nel kernel,
  protezione zip-slip e zip-bomb) e lettura via **ticket** temporaneo nel
  path, cosi' un iframe carica pagina e risorse relative senza header
  Bearer. REST `/plugins/{id}/storage/*`.

## Architettura

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  ┌──────────────────────────┐      ┌───────────────────────────┐ │
│  │ mosaikit-ui (React+Vite) │ dev: │ Vite dev server :5173     │ │
│  │ App / IconRail/PluginView│ ───▶ │ (proxy API → :8080, HMR)  │ │
│  │ PluginManager / Login…   │ prod │                           │ │
│  └───────────┬──────────────┘      └───────────┬───────────────┘ │
└──────────────┼─────────────────────────────────┼─────────────────┘
               │ REST API (JSON, Bearer token)   │
┌──────────────▼─────────────────────────────────▼─────────────────┐
│  mosaikit-server (axum, tokio)          [adapter, non tocca     │
│  /login /logout /plugins /resources…     la logica di dominio]  │
└──────────────┬───────────────────────────────────────────────────┘
               │ chiamate sincrone in-process
┌──────────────▼───────────────────────────────────────────────────┐
│  mosaikit-kernel (lib, std-only)                                 │
│                                                                  │
│  app.rs        MosaikitApp: composizione + flussi (login,        │
│                install, activate, CRUD, IconBar/ContentArea)     │
│  auth.rs       PBKDF2-HMAC-SHA256, sessioni, ruoli, autorizz.    │
│  registry.rs   persistenza plugin su filesystem                  │
│  engine.rs     trait PluginEngine — confine kernel↔runtime       │
│  crud.rs       ResourceStore generico (validazione, filtro)      │
│  store.rs      trait Backend: MemBackend / JsonFile / SQLite     │
│  package.rs    formato .mskp          validate.rs: ABI wasm      │
│  manifest.rs   manifest + gating min_kernel                      │
│  json.rs       JSON std-only          sha256.rs: crypto          │
│  ziputil.rs    ZIP/base64 generici    model.rs: tipi generici    │
└──────────────┬───────────────────────────────────────────────────┘
               │ trait PluginEngine (oggi HeadlessEngine; wasmtime
               │ implementa lo stesso trait per eseguire i guest)
┌──────────────▼───────────────────────────────────────────────────┐
│  plugin-*/ (wasm32-unknown-unknown, cdylib)                      │
│  plugin.json   manifest: icona, label, risorsa, permessi, ui     │
│  ui/<res>.js   UI del plugin: CRUD/file manager (JS trusted)     │
│  src/lib.rs    export ABI: msk_manifest/on_activate/hook/action  │
│  .mskp         pacchetto: "MSKP" + manifest + wasm [+ ui.js]     │
└──────────────────────────────────────────────────────────────────┘
```

### Flussi principali

- **Login** → `auth.login()` verifica PBKDF2 e crea una sessione; tutte le
  chiamate successive passano da `auth.require(token, azione)` con ruoli.
- **Installazione** (Admin) → parsing `.mskp` (manifest letto senza
  eseguire nulla) → validazione ABI del WASM (export richiesti) → scrittura
  in `mosaikit-data/plugins/<id>/` (con `ui.js` se presente nel pacchetto).
- **Attivazione** → il plugin entra nella IconBar (`icon_bar`), viene creato
  lo store CRUD della sua risorsa (con backend di persistenza), i dati
  precedenti vengono ricaricati. Disattivazione = rimozione icona + vista
  (i dati restano).
- **CRUD** → la UI del plugin (`ui.js`) legge i metadati della risorsa da
  `GET /resources/{view}` e opera via REST; ogni operazione invoca anche
  l'eventuale hook del plugin (es. normalizzazione email, generazione
  deep-link GeoLibre).

### ABI plugin (wasm32-unknown-unknown)

Export del guest: `memory`, `msk_alloc`, `msk_dealloc`, `msk_manifest`,
`msk_on_activate`, `msk_on_deactivate` (+ opzionali `msk_on_create`,
`msk_on_update`, `msk_on_delete`, `msk_action`).
Import dal kernel: `env.msk_host_log`. Protocollo stringhe: puntatori a
memoria lineare NUL-terminated allocata con `msk_alloc`.

### Formato .mskp

    magic "MSKP" | u32 LE len | manifest JSON | bytes WASM

    v2 (manifest con "ui": true) — dopo il manifest:
    u32 LE len | bytes WASM | bytes ui.js (fino a fine pacchetto)

## Le cartelle in dettaglio

    mosaikit/
    ├── README.md                questo file
    ├── release.sh             release completa: plugin + frontend + server -> release/
    │
    ├── mosaikit-kernel/         kernel domain-agnostic (crate lib + bin demo)
    │   ├── src/
    │   │   ├── lib.rs           moduli esportati
    │   │   ├── main.rs          demo CLI end-to-end (install→activate→CRUD)
    │   │   ├── app.rs           MosaikitApp: stato applicativo + casi d'uso
    │   │   ├── auth.rs          utenti, sessioni, ruoli, autorizzazioni
    │   │   ├── sha256.rs        SHA-256/HMAC/PBKDF2 (con test vettoriali)
    │   │   ├── json.rs          parser/serializer JSON std-only
    │   │   ├── manifest.rs      parsing manifest, gating min_kernel
    │   │   ├── package.rs       lettura/scrittura pacchetti .mskp
    │   │   ├── validate.rs      parsing export WASM senza esecuzione
    │   │   ├── model.rs         Contribution, IconButton, CrudView, Row…
    │   │   ├── crud.rs          ResourceStore generico
    │   │   ├── store.rs         trait Backend: Mem / JSON file / SQLite
    │   │   ├── registry.rs      persistenza filesystem dei plugin
    │   │   ├── engine.rs        trait PluginEngine + HeadlessEngine
    │   │   └── ziputil.rs       ZIP STORED/DEFLATE + base64 (utility generiche)
    │   └── Cargo.toml           feature "sqlite" (default), zero deps di base
    │
    ├── mosaikit-server/         web app + REST API
    │   ├── src/main.rs          rotte axum, auth Bearer, upload .mskp,
    │   │                        embed UI (rust-embed di ../mosaikit-ui/dist)
    │   ├── dev-run.sh           cleanup istanza + cargo run (per cargo watch)
    │   └── Cargo.toml           axum, tokio, serde, rust-embed, tower-http
    │
    ├── mosaikit-ui/             frontend React + TypeScript (Vite)
    │   ├── src/
    │   │   ├── main.tsx         bootstrap React
    │   │   ├── App.tsx          shell: sessione, IconRail, viste, reload
    │   │   │   │                automatico al restart del backend
    │   │   ├── api.ts           client REST (token, raw upload, errText)
    │   │   ├── types.ts         tipi API (PluginInfo, …)
    │   │   ├── index.css        design system (shell, rail, modal…)
    │   │   └── components/
    │   │       ├── Login.tsx           schermata di login
    │   │       ├── IconRail.tsx        IconBar laterale + bottone 🧩
    │   │       ├── PluginView.tsx      host delle UI plugin (esegue ui.js
    │   │       │                       con api autenticata get/post/put/del)
    │   │       ├── PluginManager.tsx   modal attiva/disattiva/installa
    │   │       ├── StatusBar.tsx       barra di stato + logout
    │   │       └── ConfirmDialog.tsx   conferme (elimina/disinstalla)
    │   └── vite.config.ts       dev server :5173 + proxy API → :8080
    │
    └── plugin-*/                6 plugin WASM (struttura identica)
        ├── Cargo.toml           crate-type cdylib, zero dipendenze
        ├── plugin.json          manifest (id, icona, risorsa, permessi, ui)
        ├── ui/<res>.js          UI del plugin (JS trusted, senza build step)
        ├── build.sh             build wasm32 + pacchetto .mskp in dist/
        ├── .cargo/config.toml   link-arg --allow-undefined (import guest)
        └── src/lib.rs           ABI guest inline + hook del plugin

## Prerequisiti

| Strumento | Versione | Note |
|---|---|---|
| Rust (rustup) | stable | https://rustup.rs |
| Target wasm32 | — | `rustup target add wasm32-unknown-unknown` |
| Node.js + npm | 18+ | solo per `mosaikit-ui` |
| Git Bash | — | su Windows serve per `build.sh` dei plugin |
| C compiler | — | **solo** per la feature `sqlite` del kernel |
| cargo-watch | — | `cargo install cargo-watch` (hot-restart backend) |

Setup iniziale:

    rustup target add wasm32-unknown-unknown
    cargo install cargo-watch
    cd mosaikit-ui && npm install

## Sviluppo (hot reload)

Due terminali.

**1. Backend — hot-restart a ogni salvataggio dei `.rs`:**

    cd mosaikit-server
    cargo watch -x run

La data dir (`../mosaikit-data/`, nella root del progetto) e' FUORI dal
crate: cosi' cargo watch non reagisce alle scritture di runtime (sessioni,
CRUD, registry) e riavvia solo quando cambiano i sorgenti. Server e demo
CLI condividono la stessa data dir.

Alternativa con cleanup esplicito (Git Bash): `cargo watch -s "bash dev-run.sh"`.
Da PowerShell usare `cargo watch -x run` oppure il path assoluto di Git Bash
(`"C:\Program Files\Git\bin\bash.exe" dev-run.sh`): il comando `bash`
puo' risolversi in WSL e fallire con errori di mount.

**2. Frontend — HMR istantaneo dei `.tsx`/`.css`:**

    cd mosaikit-ui
    npm run dev

Apri **http://localhost:5173** (proxy API verso `127.0.0.1:8080` gia'
configurato in `vite.config.ts`). Al riavvio del backend la pagina si
ricarica automaticamente (poll su `ServiceInfo.started`).

**Plugin — ricompilare un `.mskp` dopo modifiche** (Git Bash):

    cd plugin-notes && ./build.sh        # -> dist/com.mosaikit.notes.mskp

Poi installalo dalla UI (🧩 → upload).

**Credenziali demo:** `admin / mosaikit2026!` (installa/disinstalla plugin),
`user / demo1234` (CRUD + attiva/disattiva).

**Test del kernel:**

    cd mosaikit-kernel && cargo test
    # std-only (niente C compiler): cargo test --no-default-features

## Release

**Tutto in un colpo solo** (Git Bash, dalla root del progetto):

    bash release.sh

Lo script esegue i passi seguenti e assembla la cartella `release/`
(eseguibile + plugin + istruzioni d'avvio).

### Passi singoli (equivalenti)

1. **Plugin** — build wasm + pacchetto (wasm + ui.js):

       for p in plugin-notes plugin-tasks plugin-contacts plugin-maps plugin-static-site plugin-files; do
         (cd $p && bash build.sh)
       done

2. **Frontend** — build di produzione (genera `mosaikit-ui/dist/` per rust-embed):

       cd mosaikit-ui && npm install && npm run build

3. **Server** — build release (UI embedded nel binario):

       cd ../mosaikit-server && cargo build --release

4. **Assemblaggio manuale** (se non usi `release.sh`):

       mkdir -p release/plugins
       cp mosaikit-server/target/release/mosaikit-server.exe release/
       cp plugin-*/dist/*.mskp release/plugins/

### Avvio della release

    cd release
    mosaikit-server.exe                          # http://127.0.0.1:8080
    # porta custom (Git Bash):    PORT=8081 mosaikit-server.exe
    # porta custom (PowerShell):  $env:PORT="8081"; .\mosaikit-server.exe

L'eseguibile non richiede file esterni: la web app e' embedded. I dati
(`mosaikit-data/`) vengono creati nella directory di avvio; i plugin in
`release/plugins/*.mskp` si installano dall'interfaccia (🧩 → upload).

Per un binario piu' leggero, aggiungere in `mosaikit-server/Cargo.toml`:

    [profile.release]
    lto = true
    codegen-units = 1
    strip = "symbols"

## REST API (riassunto)

    POST /login {"username","password"}          -> {"token"}
    GET  /plugins                                 -> icone, vista, stato attivo, has_ui
    POST /plugins/install          (body raw .mskp, max 32 MB)
    POST /plugins/{id}/activate | POST /plugins/{id}/deactivate
    DELETE /plugins/{id}
    GET  /resources/{view}?filter=                -> {"fields":[...],"rows":[...]}
    POST /resources/{view}/rows    {"values":{...}}
    PUT  /resources/{view}/rows/{id}
    DELETE /resources/{view}/rows/{id}
    GET  /api                                     -> info servizio (started)

    File manager (root sandboxata data_dir/users/<user>/files):
    GET  /files/list?path= | GET /files/download|preview?path=
    POST /files/upload?path= (raw) | /files/mkdir|rename|delete|move|copy (JSON)
    GET  /plugins/{id}/ui.js                     -> UI del plugin (JS trusted)

    Storage dei plugin (permesso "storage.files", plugin attivo;
    root condivisa data_dir/plugin-data/<id>/files):
    POST /plugins/{id}/storage/unzip?path=       (body raw zip) estrae in path, sostituendolo
    POST /plugins/{id}/storage/delete            {"path"}
    POST /plugins/{id}/storage/ticket            {"path"} -> {"ticket","base"} (8 h)
    GET  /plugins/{id}/storage/t/{ticket}/{*path} serve i file (cartella -> index.html)

Autenticazione: header `Authorization: Bearer <token>`.

## Note e limiti della PoC

- Backend single-process con lock globale: una richiesta alla volta.
- Sandbox WASM: capability host limitate a `msk_host_log`; il runtime
  wasmtime si integra implementando `PluginEngine` (sostituire
  `HeadlessEngine` nel server).
- `plugin-static-site`: lo zip (max 32 MB, 256 MB estratti; niente ZIP64 ne'
  cifratura) viene estratto dall'host in una cartella nuova a ogni upload,
  quindi il sito precedente resta valido finche' il record non e' aggiornato.
  La pagina iniziale e' l'`index.html` meno annidato. Il sito gira in un
  iframe `sandbox` senza `allow-same-origin` (piu' CSP `sandbox` sulle
  risposte): non puo' leggere token/localStorage della web app, ma per lo
  stesso motivo non puo' usare localStorage/cookie propri. I link assoluti
  (`/css/x.css`) non funzionano: servono link relativi. Eliminare un record
  da fuori della UI del plugin lascia i file nello storage.
- `plugin-maps`: la configurazione di una mappa e' il progetto
  `.geolibre.json` condiviso di GeoLibre. L'UI del plugin embedda
  `web.geolibre.app` in un iframe: in creazione/modifica l'utente configura
  la mappa nell'app completa e la salva con **Project → Share…** (sign-in a
  share.geolibre.app), incollando il link pubblico nel record; "Apri" la
  rivisualizza con `layout=viewer`. Sul pubblico `web.geolibre.app` l'API
  postMessage e' disattivata (niente allowlist), quindi il salvataggio non
  puo' essere automatizzato lato host; con un self-hosted e
  `sharing.embedOrigins` configurato si puo' valutare il bridge postMessage.
- Token UI in localStorage + CORS permissivo: accettabile in demo, non in
  produzione.
- Le UI dei plugin sono plain JS senza build step (una per plugin, in
  `plugin-*/ui/`): condividono le custom property CSS dell'host (--acc,
  --panel, --line…), con fallback nei `var()`. Il CRUD delle risorse e' lo
  stesso per tutti: si differenziano solo per risorsa e titolo.
