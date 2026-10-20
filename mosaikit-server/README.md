# mosaikit-server

Web application completa + REST API, sopra `mosaikit-kernel` (adapter:
il kernel non cambia). La UI è **React** (sorgenti in `../mosaikit-ui`),
servita **embedded** dal binario via `rust-embed` — zero file statici
 esterni, zero CDN.

## Prerequisito UI (una tantum)

    cd ../mosaikit-ui
    npm install
    npm run build        # genera dist/, richiesto per compilare il server

Senza `dist/` la compilazione del server fallisce (rust-embed embedded
la cartella nel binario; in debug la legge da disco a ogni richiesta).

## Avvio

    cargo run            # apri http://127.0.0.1:8080 (UI embedded)

Dev con **HMR** (consigliato per lavorare sulla UI): due terminali/task

    cargo watch -w . -w ../mosaikit-kernel -s "bash dev-run.sh"   # server su :8080
    npm run dev                                                   # Vite su :5173

e apri **http://localhost:5173** — Vite fa hot reload dei componenti e
prossa `/api /login /logout /plugins /resources` su :8080. Anche il
server Rust resta utile da solo: a ogni restart la UI (sia servita da
Vite sia quella embedded su :8080) si ricarica da sola in debug
(poll su `/api`, campo `started`; in release nessun reload automatico).
Nota: al riavvio le sessioni in memoria si perdono → si torna al login.

Serve in un unico binario:

- **UI web** (React + TypeScript + Vite, embedded):
  login → IconBar con le icone dei plugin attivi → vista CRUD generica
  (tabella, form per tipo di campo: testo, multiline, numero, bool, choice,
  date, filtro live) → pannello gestione plugin (attiva/disattiva/
  disinstalla/installa da file .mskp via upload).
- **REST API** (la UI la usa; utilizzabile anche da curl, vedi sotto).
- **Autenticazione**: PBKDF2 + sessioni del kernel; token Bearer
  (la UI lo tiene in localStorage — accorgimento da rivedere in produzione).
- **Persistenza**: `./mosaikit-data` — registry dei plugin + dati CRUD
  (JSON file in questa configurazione std-only; abilitare la feature
  `sqlite` del kernel per SQLite).

## Credenziali demo

    admin / mosaikit2026!     # installa/disinstalla plugin
    user  / demo1234          # CRUD + attiva/disattiva

## Flusso tipico dall'UI

1. Login con admin.
2. 🧩 → scegli un file `.mskp` (es. `../plugin-notes/dist/com.mosaikit.notes.mskp`)
   → **Installa pacchetto**.
3. **Attiva** → l'icona 📝 appare nella IconBar.
4. Clicca l'icona → tabella + form CRUD completo; filtra, crea, modifica,
   elimina. I dati persistono al riavvio del server.

## REST API (riassunto)

    POST /login {"username","password"}            -> {"token"}
    GET  /plugins                                   -> icone, vista, stato
    POST /plugins/install          (body raw .mskp)
    POST /plugins/{id}/activate | /plugins/{id}/deactivate
    DELETE /plugins/{id}
    GET  /resources/{view}?filter=                  -> {"fields":[...],"rows":[...]}
    POST /resources/{view}/rows {"values":{...}}
    PUT  /resources/{view}/rows/{id}
    DELETE /resources/{view}/rows/{id}
    GET  /api                                        -> info servizio
    GET  /*                (non API)                -> UI embedded (fallback SPA)

Esempio con curl:

    TOKEN=$(curl -s -X POST localhost:8080/login -H 'Content-Type: application/json' \
        -d '{"username":"admin","password":"mosaikit2026!"}' \
        | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
    curl -X POST localhost:8080/plugins/install \
        -H "Authorization: Bearer $TOKEN" \
        --data-binary @../plugin-notes/dist/com.mosaikit.notes.mskp
    curl -X POST localhost:8080/plugins/com.mosaikit.notes/activate \
        -H "Authorization: Bearer $TOKEN"
    curl localhost:8080/resources/notes -H "Authorization: Bearer $TOKEN"

## Note / limiti PoC

- Lock globale sullo stato: una richiesta alla volta.
- CORS permissivo; token in localStorage (ok per demo, non per produzione).
- Plugin WASM reali (hook sandboxati) richiedono il runtime wasmtime nel
  server; con HeadlessEngine regole, ruoli, registry e CRUD sono comunque
  quelli del kernel.
