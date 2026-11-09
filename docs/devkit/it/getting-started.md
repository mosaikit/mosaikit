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

Scegli da dove partire: un plugin **nuovo** (i comandi qui sotto) oppure la **copia di un esempio** (`--example todo`, `insights` o `note-priority`: completo, commentato, con un `WALKTHROUGH.md`; vedi [Un plugin di esempio da leggere](#un-plugin-di-esempio-da-leggere)). In entrambi i casi si crea una cartella autonoma che poi modifichi.

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
mosaikit-plugin install dist/com.example.acme-reports-0.1.0.mskp --server http://localhost:8080 --user admin --password mosaikit-dev   # sul kit Docker, sezione 6; il file è quello stampato da `pack`
```

`pack` firma con `--key`, altrimenti `MOSAIKIT_SIGNING_KEY`, altrimenti `MOSAIKIT_SIGNING_KEY_FILE`, altrimenti con una
chiave di sviluppo che lo strumento crea una volta per te. Un server installa un pacchetto firmato solo se si fida della
chiave pubblica; il profilo sviluppatore accetta anche quelli non firmati. Vedi [Pacchetto e firma](packaging.md) e
[Test](testing.md).

Cosa fanno i tre comandi:

- `test` controlla il plugin senza un server: il manifesto e le sue regole (`validate --strict`), le migrazioni su PostgreSQL e SQLite, le traduzioni, poi i test Rust, `tsc`, il lint e i test della UI.
- `pack` compila il plugin e scrive un solo file, `dist/<id>-<versione>.mskp`: la logica, la UI, le migrazioni e il manifesto, con una firma. Non invia nulla.
- `install` carica quel file su un server Mosaikit **in esecuzione**: accede come amministratore (`--user`, `--password`) e invia il pacchetto. Il server controlla la firma con le sue chiavi fidate e lo installa. `--server` è l'indirizzo di quel server.

## 6. Installare sul kit Docker

`dev` esegue il plugin dalla sua cartella, quindi non può installare anche il `.mskp`: un server che ha caricato un plugin
da una cartella rifiuta un pacchetto dello stesso plugin (`is loaded in development mode`), e disinstallare il plugin dalla
pagina web non dura, perché `dev` lo ricarica. Il pacchetto va su un **altro** server: il kit Docker, che è quanto di più
vicino a un'installazione vera (PostgreSQL, i ruoli e la sicurezza a livello di riga che la piattaforma crea per il plugin,
un elenco di chiavi fidate). Si fa quando il plugin supera `test`.

1. **Ferma `dev`** (Ctrl+C nella sua finestra). Occupa la porta 8080.
2. **Crea una chiave di firma** e tieni la chiave pubblica che stampa:
   `mosaikit-plugin keygen --out publisher.key`
3. **Fidati della chiave nel kit.** In `docker/.env` scrivi `MOSAIKIT_TRUSTED_KEYS=<la chiave pubblica>` **e** `MOSAIKIT_DEVELOPER_PROFILE_STRICT_SIGNATURES=1`. Senza la seconda riga il profilo sviluppatore accetta un pacchetto firmato con una chiave qualunque, e il controllo del passo 9 non può fallire. Lascia `PLUGIN_DIR` com'è: se punta alla cartella del plugin, il plugin torna "in sviluppo" e `install` fallisce.
4. **Avvia il kit**, nella cartella `docker/` del kit: `docker compose up -d`. Il primo avvio scarica l'immagine; se il download è rifiutato, vedi `docker/README.md` (l'immagine si può caricare da un archivio, offline). Apri `http://localhost:8080`.
5. **Impacchetta con quella chiave**, nella cartella del plugin:
   `mosaikit-plugin pack --key publisher.key`
6. **Installa**:
   `mosaikit-plugin install dist/com.example.acme-reports-0.1.0.mskp --server http://localhost:8080 --user admin --password mosaikit-dev` (il nome del file stampato da `pack`; non scrivere `<file>`)
   (anche il kit Docker è un profilo sviluppatore: stessi utenti di prova di `dev`).
7. **Accendi il plugin.** Dopo `install` è solo "installed": apri `#/admin`, Piattaforma > Plugin > il tuo plugin > **Turn on** (poi è `active` e disponibile all'organizzazione `dev`). Finché non è acceso la sua pagina non compare nella shell.
8. **Usalo.** Accedi come `alice` o `manager` (tenant `dev`) e crea, modifica e cancella una voce.
9. **Verifica che la chiave conti.** Impacchetta di nuovo con un'altra chiave che il kit non conosce (`mosaikit-plugin keygen --out other.key`, `pack --key other.key`) e rilancia `install`: deve essere rifiutato con `publisher key not trusted: <chiave>`. Senza questa prova non hai dimostrato che il kit controlla chi ha pubblicato un pacchetto.

Senza un server acceso `install` si ferma con `reaching <indirizzo>` e `os error 10061` (connessione rifiutata). Per
ripartire da zero: `docker compose down -v`. Le porte, il `.env` e la cartella del plugin sono in `docker/README.md`.

## Un plugin di esempio da leggere

Prima di scrivere il tuo, leggine uno finito. Nel kit i tre esempi sono in `examples/` (`todo`, `insights`,
`note-priority`); ognuno ha un `WALKTHROUGH.md` che spiega il plugin file per file, in ordine (circa 250 righe). Per avere
una copia funzionante da avviare e modificare:

```
mosaikit-plugin new my-todo --kit /percorso/del/kit --example todo
cd my-todo
mosaikit-plugin dev
```

Parti da `todo` (un elenco con un modulo, un valore salvato e un test). `insights` aggiunge KPI e una vista;
`note-priority` estende un altro plugin ([Estensioni e layout](extensions-layouts.md)).

## Un plugin o un prodotto?

| | Plugin | Prodotto (applicazione) |
|---|---|---|
| Cos'è | Una funzione che gira dentro Mosaikit: logica (WASM), una UI, dati propri | Mosaikit con un nome, un marchio, una scelta di plugin e impostazioni che sono tuoi |
| Si crea con | `mosaikit-plugin` | `mosaikit-product` |
| Cosa distribuisci | Un file `.mskp` firmato che un amministratore installa | Un archivio desktop e un'immagine Docker con il tuo marchio e i tuoi plugin |
| Cosa cambia | Cosa possono fare gli utenti | Cosa trovano al primo avvio: nome, logo, colori, plugin, impostazioni, primo tenant |
| Cosa non può cambiare | Il nucleo, le regole di sicurezza, la plugin API | Il nucleo, le regole di sicurezza, le origini, il modello di firma |
| Si parte da | Questo documento | [Costruire un'applicazione](building-an-application.md), poi [Prodotto di riferimento](../reference-product.md) (in inglese) |

Un prodotto contiene plugin: i suoi (creati con `mosaikit-plugin new <nome> --into plugins`) e quelli ufficiali che
tiene. Crea un plugin quando aggiungi una funzione a un Mosaikit esistente; crea un prodotto quando vuoi distribuire una tua
applicazione. Per iniziare un prodotto: `mosaikit-product new acme-maps`.

## Dopo

- Leggere il walkthrough di un esempio (`--example todo`): circa 250 righe, in ordine.
- [Concetti](concepts.md) dice cosa può e non può fare un plugin; il [Riferimento del manifesto](manifest.md) elenca ogni campo.
- Quando qualcosa non funziona: [Risoluzione dei problemi](troubleshooting.md).
