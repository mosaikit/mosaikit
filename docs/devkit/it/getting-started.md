# Per iniziare

Da zero a un plugin che gira in un Mosaikit vero in una decina di minuti. Servono Rust (con `rustup`) e Node.js; non
serve una copia di Mosaikit. Versione inglese: [../getting-started.md](../getting-started.md).

## 1. Installare il kit

Il kit è una cartella (o un archivio) con:

| Parte | Cosa |
|---|---|
| `bin/mosaikit-plugin` | lo strumento a riga di comando: `new`, `build`, `test`, `validate`, `pack`, `sign`, `keygen`, `install`, `dev`, `doctor`, `self-update` |
| `bin/mosaikit-server` | il server Mosaikit che avvia `dev` (profilo sviluppatore, SQLite) |
| `sdk/`, `plugin-api/` | l'SDK Rust (`mosaikit-plugin-sdk`) e il pacchetto della UI (`@mosaikit/plugin-api`), finché non li ha un registro |
| `docs/` | questi documenti |

Scaricare l'archivio della propria piattaforma dalle GitHub Releases di `mosaikit/mosaikit`
(`mosaikit-devkit-<versione>-<piattaforma>`), verificarlo ([Releasing the kit, in inglese](../releasing.md)), scompattarlo e mettere la sua cartella
`bin/` nel `PATH` (oppure puntare `MOSAIKIT_KIT` sulla cartella). L'archivio per Windows contiene il server; su Linux e macOS il
server di sviluppo è l'immagine Docker (`docker/README.md` nel kit). `mosaikit-plugin self-update` porta il kit alla versione successiva.
Senza un archivio, si compilano i due eseguibili dai sorgenti di Mosaikit
(`cargo build --release -p mosaikit-plugin-cli -p mosaikit-server`) e si usano `--sdk-path` e `--plugin-api-path`
(o `MOSAIKIT_SDK_PATH`, `MOSAIKIT_PLUGIN_API_PATH`) al posto di `--kit`.

Controllare la macchina:

```
mosaikit-plugin doctor          # Rust, il target wasm32-unknown-unknown, Node
mosaikit-plugin doctor --fix    # installa il target wasm32 se manca
```

## 2. Creare un plugin

```
mosaikit-plugin new acme-reports --kit <la cartella dove hai decompresso il kit>
cd acme-reports
```

L'id del plugin è `com.example.<nome>` salvo `--id com.acme.reports` (almeno due segmenti di lettere minuscole, cifre e
`-`). La cartella è autonoma: un proprio `Cargo.toml`, `ui/package.json`, `tsconfig.json`, `.oxlintrc.json`,
`.gitignore`, `README.md`, un file di CI, una migrazione d'esempio, test e testi in inglese, italiano e spagnolo.

| Opzione | Valori |
|---|---|
| `--variant` | `app` (logica e UI, predefinita), `ui`, `service` (solo logica), `extension`, `language`, `layout` |
| `--example` | `todo`, `insights`, `note-priority`: un plugin completo e commentato con un `WALKTHROUGH.md` |
| `--lang fr` | il codice di un pacchetto lingua (serve `--variant language`, o un nome come `lang-fr`) |
| `--kit`, `--sdk-path`, `--plugin-api-path` | da dove arrivano l'SDK e il pacchetto della UI |

`ui/package.json` punta al pacchetto della UI del kit con un percorso `file:` relativo (per esempio `file:../../../mosaikit-devkit/plugin-api`). Il percorso è
relativo a `ui/`: se sposti il plugin o il kit, correggilo (o esegui in `ui/` `npm pkg set "dependencies.@mosaikit/plugin-api=file:<nuovo percorso>"`).
I template hanno testo non ASCII (accenti): modificali con un editor UTF-8 (uno script che li legge come cp1252 su Windows li rovina).

Cosa c'è in una cartella `app`:

```
plugin.toml        il manifesto: dati, pagine, permessi, KPI, traduzioni
Cargo.toml         la logica (Rust, compilata in WebAssembly)
src/lib.rs         comandi e hook, con i loro test (MockHost)
migrations/        SQL del plugin (qui: una vista KPI)
ui/                la UI (Vite e TypeScript): ui/src/main.ts chiama mountCrud
```

## 3. Il ciclo di sviluppo

```
mosaikit-plugin dev
```

`dev` compila la logica e la UI, scrive una configurazione in `.mosaikit-dev/`, avvia `mosaikit-server` nel **profilo
sviluppatore**, aspetta che risponda, apre il browser e stampa gli indirizzi e gli utenti di prova:

| Utente | Ruolo | Password |
|---|---|---|
| `admin` | Administrator (accesso su `#/admin`; in questo profilo non c'è il secondo fattore) | `mosaikit-dev` |
| `manager` | Tenant Manager dell'organizzazione `dev` | `mosaikit-dev` |
| `alice`, `bob` | Utenti dell'organizzazione `dev` | `mosaikit-dev` |

L'organizzazione `dev` ha un gruppo, una notifica di benvenuto, voci nel Registro e, se il plugin dichiara una risorsa,
un elemento condiviso con Bob. Il plugin è caricato dalla sua cartella con ricarica a caldo: il server ricarica il
manifesto, le migrazioni, la UI (`ui/dist`) e la logica (il `.wasm` del `target/` della cartella) quando cambiano, e lo
strumento ricompila logica e UI quando cambiano i sorgenti. Un banner nella shell dice che il profilo è attivo.

Aprire **Strumenti sviluppatore** nella shell per vedere il manifesto come lo legge il server, le chiamate dell'host
fatte dal plugin con tempi ed errori, i permessi dell'utente connesso, il cambio tra i quattro utenti e un pulsante che
cancella i dati del plugin e rilancia le migrazioni. Se si cambia una migrazione già eseguita, la shell chiede se
cancellare i dati e ripartire: **una migrazione applicata non si modifica mai, se ne aggiunge una nuova** (vedi
[Dati](data.md)).

Opzioni: `--port`, `--data`, `--no-open`, `--no-build`, `--no-watch`, `--fresh` (nuovo database, organizzazione e
utenti). Il server viene da `--server`, da `MOSAIKIT_SERVER_BIN` o dal file accanto allo strumento. Il profilo si rifiuta
di partire dove altri potrebbero raggiungerlo (non loopback, database su un altro host, reverse proxy): è solo per il
proprio computer (architettura §8.12).

Per controllare migrazioni e row level security sul database vero (PostgreSQL) c'è il kit Docker: nella cartella
`docker/` del kit: lì `docker compose up -d` (`docker/README.md` dice da dove viene l'immagine, come caricarla offline e come impostare una chiave fidata).

## 4. Cambiare qualcosa

1. In `plugin.toml` aggiungere un campo alla risorsa: `{ key = "due", label = "Scadenza", kind = "date" }`. Il server aggiunge la colonna; modulo e tabella la mostrano. Poi dai un'etichetta al campo in ogni lingua che il plugin dichiara, altrimenti `mosaikit-plugin test` fallisce con `[i18n.it] is incomplete`: in `[i18n.it.resources.<risorsa>]` e in `[i18n.es.resources.<risorsa>]` aggiungi `due = "..."` a `fields` (per esempio `Scadenza`, `Vence`).
2. In `src/lib.rs` cambiare ciò che fa un hook. Lo strumento ricompila; ricaricare la pagina.
3. In `ui/src/main.ts` cambiare le opzioni di `mountCrud` (`title`, `columns`, `empty`).

## 5. Collaudare, impacchettare, installare

```
mosaikit-plugin test                       # validazione stretta, cargo test, tsc, lint e vitest della UI
mosaikit-plugin pack                       # dist/<id>-<versione>.mskp, firmato con la tua chiave
mosaikit-plugin install dist/<file>.mskp --server <indirizzo di un altro server> --user admin --password <password>
```

`pack` firma con `--key`, altrimenti `MOSAIKIT_SIGNING_KEY`, altrimenti `MOSAIKIT_SIGNING_KEY_FILE`, altrimenti con una
chiave di sviluppo che lo strumento crea una volta per te. Un server installa un pacchetto firmato solo se si fida della
chiave pubblica; il profilo sviluppatore accetta anche quelli non firmati. Vedi [Pacchetto e firma](packaging.md) e
[Test](testing.md).

Cosa fanno i tre comandi:

- `test` controlla il plugin senza un server: il manifesto e le sue regole (`validate --strict`), le migrazioni su PostgreSQL e SQLite, le traduzioni, poi i test Rust, `tsc`, il lint e i test della UI.
- `pack` compila il plugin e scrive un solo file, `dist/<id>-<versione>.mskp`: la logica, la UI, le migrazioni e il manifesto, con una firma. Non invia nulla.
- `install` carica quel file su un server Mosaikit **in esecuzione**: accede come amministratore (`--user`, `--password`) e invia il pacchetto. Il server controlla la firma con le sue chiavi fidate e lo installa. `--server` è l'indirizzo di quel server.

**`install` non va sul server che `dev` ha avviato per questo plugin.** `dev` carica il plugin dalla sua cartella e lo segna "in sviluppo": un server in questo stato rifiuta un `.mskp` dello stesso plugin (`is loaded in development mode`), e disinstallare il plugin dalla pagina web non dura, perché `dev` lo ricarica dalla cartella. Il `.mskp` va su un altro server, quello che useresti per davvero. Avviane uno in un'altra finestra e passa il suo indirizzo a `--server`:

- **Il kit Docker** (qualunque sistema): `docker compose -f docker/compose.yml up -d` nella cartella `docker/` del kit. L'indirizzo è `http://localhost:8080`; utente e password dell'amministratore sono quelli del `.env` del kit (`docker/README.md`). Ferma prima `dev` se occupa la porta 8080.
- **Un secondo server di sviluppo senza plugin** (Windows, dove il kit ha `bin/mosaikit-server`): crea un file `server.toml` fuori dalla cartella del plugin con

  ```toml
  url = "http://127.0.0.1:8090"
  listen = "127.0.0.1:8090"
  plugin_listen = "127.0.0.1:8091"
  data_dir = "C:/mosaikit-test-server"
  developer_profile = true
  ```

  e lancia `mosaikit-server --config server.toml serve`. Parte vuoto con gli stessi utenti di prova di `dev` (`admin`, password `mosaikit-dev`), accetta pacchetti non firmati e tiene i suoi dati. Poi `mosaikit-plugin install dist/<file>.mskp --server http://127.0.0.1:8090 --user admin --password mosaikit-dev`.

Senza un server `install` si ferma con `reaching <indirizzo>` e `os error 10061` (connessione rifiutata).

**Dopo `install` il plugin è solo "installed", non acceso.** Lo strumento lo dice. Un Administrator lo accende: apri `#/admin`, Piattaforma > Plugin >
il tuo plugin > **Turn on** (poi è `active` e disponibile all'organizzazione `dev`). Finché non è acceso la sua pagina non compare nella shell.

## Dopo

- Leggere il walkthrough di un esempio (`--example todo`): circa 250 righe, in ordine.
- [Concetti](concepts.md) dice cosa può e non può fare un plugin; il [Riferimento del manifesto](manifest.md) elenca ogni campo.
- Quando qualcosa non funziona: [Risoluzione dei problemi](troubleshooting.md).
