# Test

Tre livelli, dal più economico al più completo: conformità statica, test unitari, end to end contro il server di sviluppo.
Versione inglese: [../testing.md](../testing.md).

```
mosaikit-plugin test [dir]
```

esegue `validate --strict`, poi `cargo test` della logica, poi il controllo dei tipi e gli script `lint` e `test` della UI
dove esistono. Esce con 1 se qualcosa fallisce.

## 1. `validate --strict`: la suite di conformità

```
mosaikit-plugin validate [dir | file.mskp] [--strict]
```

Senza `--strict` controlla il manifesto, le migrazioni rispetto alla lista SQL consentita del server, i permessi,
l'integrità e la firma del pacchetto e le pagine d'ingresso. **Con `--strict`** è la suite che un plugin supera prima di
essere proposto a un Administrator. È statica: nessun server, nessun browser. Gli errori la fanno uscire con 1; gli avvisi
(chiavi vecchie, nessun `[requires]`, un pacchetto non firmato) no.

| Controllo | Come |
|---|---|
| Manifesto | lo schema (chiavi sconosciute rifiutate); `description`, `author` e `license` obbligatorie |
| Permessi rispetto alla logica | in una cartella si scandisce il sorgente Rust (`src/**/*.rs`, fino a `#[cfg(test)]`, commenti esclusi) per `.files()`, `.notify(`, `.call_plugin("id"`, `.http()`, `.service_key(` e nomi letterali di operazioni dell'host; in un pacchetto si scandisce `logic.wasm` per i letterali che l'SDK collega (`files.*`, `plugin.call`, `http.fetch`, `key.get`; `notify` non ne ha, quindi si controlla solo nel sorgente). Una chiamata senza il suo permesso è un errore; `files_read`, `notify` o `calls` chiesti e mai usati sono errori; un hook elencato senza `"<risorsa>.<hook>"` registrato è un errore; `network` non usato è un avviso |
| Migrazioni | numerate da 001 senza buchi né duplicati, nomi minuscoli, niente `drop table`, `drop column`, `truncate`, SQL accettato dalla guardia di PostgreSQL (solo il proprio schema) e dalla traduzione per SQLite |
| UI | al massimo 10 MiB; nessuno script, `<link>`, immagine, frame o media da un'origine esterna, nessun `url()` o `@import` di una, nessun `fetch`, `import()`, `WebSocket`… verso un indirizzo letterale esterno se non dichiarato in `network` o `frame_src`; niente che la CSP blocchi (`<script>` inline, gestori `on...=`, `javascript:`); `eval` e `new Function` sono un avviso senza `script_eval`; la pagina d'ingresso ha titolo, charset e viewport |
| i18n | ogni `[i18n.<lang>]` dichiarata copre `description`, `details`, etichetta, risorse e campi visibili, navigazione, KPI e permessi utente (un plugin lingua è esente) |
| Contratto di layout delle pagine `mountCrud` | sul sorgente, al meglio: la risorsa della chiamata è dichiarata, la UI importa `@mosaikit/plugin-api/style.css` e chiama `connect()`, la pagina ha l'opzione `title` (avviso), una `<table>` propria al posto di `gridTable` è un avviso |

Non coperto: il test di fumo di accessibilità (sotto) e tutto ciò che richiede un server in esecuzione.

## 2. Test unitari della logica: `MockHost`

La logica si compila in nativo per i test (`cargo test`); `MockHost` fa la parte dell'host ([Riferimento della
logica](logic.md)). Il template ha esempi funzionanti.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mosaikit_plugin_sdk::testing::{FakeFile, MockHost};

    #[test]
    fn a_hook_sets_the_default() {
        let host = MockHost::new();
        let v = host.hook(&__msk_registry(), "before_create", "notes", json!({ "title": "x" })).unwrap().unwrap();
        assert_eq!(v.str("tag"), "personal");
    }

    #[test]
    fn the_error_keeps_its_code() {
        let host = MockHost::new().with_perms(&["use"]);       // il chiamante non può esportare
        let err = host.command_err(&__msk_registry(), "notes.export", json!({})).unwrap_err();
        assert_eq!(err.code.as_deref(), Some("export_not_allowed"));
    }
}
```

Ricette (la documentazione del modulo le ha tutte):

| Per provare | Fare |
|---|---|
| `db.query`, `db.exec` | `.on("db.query", \|req\| { assert_eq!(req["params"][0], "work"); Ok(json!([…])) })` |
| `notify` | niente da programmare; leggere `host.notifications()`. Un rifiuto: `.on("notify", \|_\| Err("…".into()))` |
| `call_plugin` | `.with_plugin_command("com.example.other", "other.total", \|args\| Ok(json!({ "total": args["n"] })))` |
| permessi | `.with_perms(&["use", "export"])`; un'operazione che il manifesto non consente: `.deny("files.read", "…")` |
| gruppi | `.with_groups(&[("g1", "Field")])` |
| l'area File | `.with_files(vec![FakeFile::folder("d1", "Reports"), FakeFile::file("f1", "a.txt", b"hello").in_folder("d1")])` |
| cosa è stato chiesto | `host.calls()`, `host.logs()` |

Un'operazione senza risposta fa fallire la chiamata con `MockHost: no answer for <op>`: un test che ne dimentica una
fallisce in modo evidente. Le regole pure della UI (formattazione, filtri, date) vanno in moduli TypeScript semplici
provati con `vitest`, senza browser (`tasks.test.ts` nell'esempio `todo`).

## 3. End to end: `@mosaikit/plugin-testing`

Helper Playwright che pilotano il plugin in una shell vera contro il server di sviluppo (`mosaikit-plugin dev`). Il
pacchetto distribuisce sorgente TypeScript; Playwright lo esegue così com'è. Dipendenze peer: `@playwright/test` e,
facoltativa, `@axe-core/playwright`.

```ts
import { test, expect } from '@playwright/test'
import { attachDevServer, signIn, openPlugin, createItem, expectAccessible } from '@mosaikit/plugin-testing'

test('Alice creates a note', async ({ page }) => {
  const dev = await attachDevServer()               // MOSAIKIT_DEV_URL, altrimenti http://localhost:8080/
  await signIn(page, dev.url, 'alice')
  const frame = await openPlugin(page, dev.url, 'com.example.notes')
  const row = await createItem(frame, { title: 'Plan the week' })
  await expect(row).toContainText('Plan the week')
  await expectAccessible(page)                      // axe: violazioni gravi e critiche della pagina e del frame del plugin
})
```

| Funzione | Cosa |
|---|---|
| `startDevServer({ plugin, port, fresh, … })` | avvia `mosaikit-plugin dev --no-open --no-watch` per una cartella, aspetta l'indirizzo e `/api/health`; `stop()` lo chiude. Lo strumento è `MOSAIKIT_PLUGIN_BIN` o `mosaikit-plugin` |
| `attachDevServer(url?)` | usa un server in esecuzione (`MOSAIKIT_DEV_URL`, il kit Docker); rifiuta uno che non è nel profilo sviluppatore |
| `signIn(page, app, user)` | `admin`, `manager`, `alice` o `bob` (organizzazione `dev`, password `mosaikit-dev`: `DEV_USERS`, `DEV_PASSWORD`) |
| `openPlugin(page, app, pluginId)` | apre il plugin nella shell e restituisce il frame della sua UI |
| `createItem(frame, { title })` | in una pagina `mountCrud`: Nuovo, compila i campi per chiave, Salva; restituisce la riga |
| `accessibilityViolations`, `expectAccessible`, `formatViolations` | il test di fumo axe |
| `pluginUrl`, `waitForHealth`, `devArgs`, `parseDevOutput`, `freePort` | piccoli pezzi per test che fanno a modo loro |

La shell è pilotata in inglese, quindi le etichette che gli helper cliccano sono quelle inglesi. Funzionano solo contro un
server nel profilo sviluppatore. Per provare condivisione o ruoli, accedere come `bob` o `manager` in un altro contesto.

## Ricette per la CI

La cartella generata ha `.github/workflows/ci.yml`, con i passi che valgono per la sua variante. Non serve una copia di
Mosaikit; `mosaikit-plugin` e i due pacchetti del kit vengono dalla cartella che nomina la variabile del repository
`MOSAIKIT_KIT` (ha `bin/`, `sdk/` e `plugin-api/`), finché un registro pubblico non li ha:

```yaml
env:
  MOSAIKIT_KIT: ${{ vars.MOSAIKIT_KIT }}
steps:
  - uses: actions/checkout@v4
  - run: echo "$MOSAIKIT_KIT/bin" >> "$GITHUB_PATH"
  - run: mosaikit-plugin validate                    # aggiungere --strict per imporre la suite di conformità
  - uses: dtolnay/rust-toolchain@stable
    with: { targets: wasm32-unknown-unknown }
  - run: |                                           # puntare Cargo all'SDK del kit
      mkdir -p .cargo
      printf '[patch.crates-io]\nmosaikit-plugin-sdk = { path = "%s/sdk" }\n' "$MOSAIKIT_KIT" > .cargo/config.toml
  - run: cargo test
  - run: mosaikit-plugin build --release
  - uses: actions/setup-node@v4
    with: { node-version: 24 }
  - working-directory: ui                            # puntare npm al pacchetto della UI del kit
    run: |
      npm pkg set "dependencies.@mosaikit/plugin-api=file:$MOSAIKIT_KIT/plugin-api"
      npm install --no-audit --no-fund
      npm run typecheck && npm run lint && npm test
```

Per pubblicare dalla CI aggiungere `mosaikit-plugin pack --release` con la chiave in `MOSAIKIT_SIGNING_KEY` (un segreto del
repository, in base64). Per il livello end to end avviare `mosaikit-plugin dev --no-open --no-watch` in background e
collegarsi con `MOSAIKIT_DEV_URL`; per PostgreSQL usare il kit Docker.

## Cosa provare, in breve

- Ogni hook e comando: il caso felice e ogni rifiuto con il suo **codice**.
- Ogni ramo che dipende dai permessi (`with_perms`).
- Ogni chiamata all'host che fa la logica (`calls()` mostra cosa ha chiesto).
- Le regole della UI come funzioni semplici; un test end to end per pagina che apre, crea e controlla l'accessibilità.
- `validate --strict` in CI a ogni modifica.
