# Mosaikit — PoC kernel + plugin WASM

Quattro progetti indipendenti allo stesso livello:

    mosaikit/                  (questa directory)
    ├── mosaikit-kernel/       # kernel domain-agnostic, std-only (questo progetto)
    ├── plugin-notes/          # plugin WASM: CRUD note
    ├── plugin-tasks/          # plugin WASM: CRUD attività
    └── plugin-contacts/       # plugin WASM: CRUD contatti

Il kernel non conosce alcun dominio: i plugin dichiarano nel `plugin.json`
solo `icon` + `label` + `resource` (nome e campi), e il kernel renderizza
un CRUD generico. Esempio di estensione a nuovi domini: copiare un plugin,
cambiare il manifest, ricompilare — zero modifiche al kernel.

## Avvio rapido

    # 1. test del kernel (crypto, auth, validatore WASM, flusso completo)
    cd mosaikit-kernel && cargo test

    # 2. build dei plugin WASM + pacchetti .mskp
    cd ../plugin-notes && ./build.sh
    cd ../plugin-tasks && ./build.sh
    cd ../plugin-contacts && ./build.sh

    # 3. demo end-to-end (dal kernel: install -> activate -> CRUD -> deactivate)
    cd ../mosaikit-kernel && cargo run
    # oppure con pacchetti espliciti: cargo run -- ../plugin-notes/dist/com.mosaikit.notes.mskp

## Credenziali seed (solo PoC)

    admin / mosaikit2026!     # puo' installare/disinstallare plugin
    user  / demo1234          # puo' usare i CRUD e attivare/disattivare

## Formato pacchetto .mskp

    magic "MSKP" | u32 LE len | manifest JSON | bytes WASM

Il manifest è leggibile senza eseguire il WASM (pattern plugin.json di
GeoLibre). Il kernel valida il WASM analizzandone la sezione export
(validate.rs) *senza istanziare alcun runtime*, poi lo archivia in
`./mosaikit-data/plugins/<id>/` (manifest + wasm, come il bundle di GeoLibre).

## ABI plugin (wasm32-unknown-unknown)

Export del guest:          Import del kernel:
  memory                     env.msk_host_log(ptr, len)
  msk_alloc(size) -> ptr
  msk_dealloc(ptr, len)
  msk_manifest() -> ptr        JSON manifest NUL-terminated
  msk_on_activate()
  msk_on_deactivate()
  msk_on_create(ptr) -> ptr|0  hook opzionale (0 = pass-through)
  msk_on_update(ptr) -> ptr|0
  msk_on_delete(ptr) -> u32
  msk_action(ptr) -> ptr          # opzionale: comandi generici plugin-specific

Protocollo stringhe: il guest alloca nella propria memoria lineare con
msk_alloc e restituisce puntatori; l'host legge via export `memory`.

## Architettura del kernel (src/)

    main.rs       demo CLI end-to-end
    lib.rs        moduli
    auth.rs       PBKDF2-HMAC-SHA256 (std-only), sessioni, ruoli, autorizzazioni/azione
    json.rs       JSON parser/serializer minimale (std-only)
    sha256.rs     SHA-256 + HMAC + PBKDF2 (con vettori di test)
    manifest.rs   parsing manifest, gating min_kernel
    package.rs    formato .mskp
    validate.rs   parsing export WASM senza esecuzione + modulo wasm minimale
    model.rs      Contribution, IconButton, ContentArea, CrudView, Value/Row
    crud.rs       ResourceStore generico (required, validazione tipi, filtro)
    registry.rs   persistenza filesystem
    engine.rs     trait PluginEngine + HeadlessEngine (test/demo senza runtime)
    app.rs        MosaikitApp: composizione auth+registry+engine+CRUD

Il runtime WASM reale (wasmtime: istanziazione sandboxata, fuel limit,
capability) si inserisce implementando `engine::PluginEngine` — la CLI usa
`HeadlessEngine`, che esercita comunque parsing .mskp e validazione ABI reali.

## Persistenza: SQLite (scelta) + fallback JSON

Il kernel salva i record CRUD in **SQLite** (`mosaikit-data/mosaikit.db`, una
tabella per risorsa con colonne tipizzate dal manifest del plugin) via
`rusqlite` con feature `bundled` (default). Motivazione: file unico,
transazionale, portabile, stesso ecosistema di SpatiaLite/GeoPackage;
su WASM si portera' via wa-sqlite. DuckDB e' la scelta giusta per il motore
analitico (processing), non per il CRUD operativo.

    cargo test                              # backend SQLite (richiede C compiler)
    cargo test --no-default-features        # std-only: persistenza in JSON file
    cargo run --no-default-features         # kernel zero-dipendenze

Il trait `store::Backend` isola il kernel: alternative (sled, redb, remoto)
si aggiungono implementandolo.

## I due plugin aggiuntivi

**plugin-maps** (CRUD mappe + GeoLibre): la risorsa `maps` e' il catalogo
CRUD generico del kernel; l'hook `on_create` genera un deep-link GeoLibre
nel campo `geolibre_url` (convention PoC sul pattern dei parametri URL di
GeoLibre) e `msk_action` con `cmd=embed_snippet` produce uno snippet iframe.
Mosaikit resta il catalogo: la resa cartografica e' di GeoLibre.

**plugin-static-site** (siti da zip): risorsa `sites` (nome, percorso zip,
entry point, stato). Il parsing ZIP avviene DENTRO il guest sandboxato via
`msk_action` (`cmd=inspect` elenca le entry di QUALUNQUE zip, compresi
deflate; `cmd=extract` estrae entry STORED — `zip -0`). In modalita'
headless la demo usa `ziputil` del kernel (utility generica, stesso
algoritmo): il confine e' `PluginEngine::action`, che con il runtime WASM
sara' eseguito dal plugin. In un prodotto reale l'estrazione DEFLATE
richiede un inflate completo (o una libreria) nel guest.

## Limiti noti della PoC

- Non compilata in ambiente CI alla consegna: eseguire `cargo test` al primo avvio.
- Sandbox: fuel limit e hook pass-through; mancano capability host granulari,
  firma/hash dei pacchetti e blocklist (pattern GeoLibre) — vedi roadmap.
- Password seed hardcoded: in produzione provisioning esterno.
