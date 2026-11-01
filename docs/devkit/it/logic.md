# Riferimento della logica

La logica di un plugin è Rust compilato in WebAssembly (`wasm32-unknown-unknown`) con il crate `mosaikit-plugin-sdk`. È
facoltativa: un plugin con sole risorse e una UI non ne ha bisogno. Sorgenti: `crates/plugin-sdk`, runtime
`crates/runtime`, lato host `crates/kernel/src/host.rs`. Architettura §8.3. Versione inglese: [../logic.md](../logic.md).

## Anatomia

```rust
use mosaikit_plugin_sdk::prelude::*;

fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    if v.str("tag").is_empty() { v.set("tag", "personal"); }
    Ok(Some(v))                       // Some: cambia i valori; None: lasciali; Err: rifiuta
}

fn count_by_tag(ctx: &Ctx, _args: Value) -> Result<Value> {
    Ok(Value::Array(ctx.db().query("select tag, count(*) as n from notes group by tag", &[])?))
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "notes.before_create" => before_create },
    commands: { "notes.count_by_tag" => count_by_tag },
}
```

Il `Cargo.toml` ha `crate-type = ["cdylib", "rlib"]` e dipende dall'SDK; il template lo ha già. Su `wasm32` la macro
genera gli export dell'ABI; sugli altri target la logica si collauda con `MockHost` (sotto).

## ABI v1

Il runtime è **wasmi** (un interprete in puro Rust): una **nuova istanza a ogni chiamata**, un limite di istruzioni
(fuel), un limite di memoria, niente WASI (niente file, rete, orologio se non tramite l'host). Non lo si scrive a mano:
lo fa l'SDK.

| Lato | Simbolo | Significato |
|---|---|---|
| export del plugin | `msk_alloc(len) -> ptr` | allocazione nella memoria del guest |
| export del plugin | `msk_call(ptr, len) -> i64` | messaggio JSON in ingresso; risposta `(ptr << 32) \| len` |
| import dell'host | `msk.host_call(ptr, len) -> i32` | richiesta JSON all'host; lunghezza della risposta (negativa: errore) |
| import dell'host | `msk.host_read(ptr)` | copia nel guest la risposta in attesa |
| import dell'host | `msk.log(ptr, len)` | log |

In ingresso: `{"abi":1,"kind":"command","name":…,"args":…,"ctx":…}` oppure
`{"abi":1,"kind":"hook","hook":"before_create"|"before_update"|"after_delete","resource":…,"id":…,"values":…,"previous":…}`.
Risposta: `{"ok":…}` oppure `{"err":"…","code":"…"}`.

## Comandi

Un comando è una funzione `fn(&Ctx, Value) -> Result<Value>` registrata con un nome. La UI lo chiama con
`msk.call("notes.count_by_tag", args)`, un altro plugin con `ctx.call_plugin(...)`. I nomi sono stringhe libere; usare
`<risorsa-o-plugin>.<verbo>`. Un nome sconosciuto è l'errore `unknown command: <nome>`. Un comando gira in una
transazione: un errore annulla tutto ciò che ha fatto.

## Hook

Un hook si registra come `"<risorsa>.<hook>"` e gira **nella stessa transazione** dell'operazione, con i valori:

| Hook | Quando | Risultato |
|---|---|---|
| `before_create` | prima che una riga sia creata | `Some(values)` sostituisce i valori, `None` li tiene, `Err` rifiuta e annulla |
| `before_update` | prima di una modifica; `hook.previous` ha i valori vecchi | uguale |
| `after_delete` | dopo l'eliminazione di una riga | `Err` annulla l'eliminazione |

La risorsa deve essere elencata in `[permissions] hooks`; `validate --strict` boccia un hook elencato e mai registrato.
`Hook` ha `hook`, `resource`, `id`, `values`, `previous`. `Values` legge `str`, `f64`, `bool` (`true`, `1`, `yes`), `get`,
e scrive `set`, `remove`.

## Contesto

`ctx: &Ctx` (`#[non_exhaustive]`; nei test se ne crea uno con `Ctx::default()`):

| Campo o metodo | Cosa |
|---|---|
| `ctx.user`, `ctx.username`, `ctx.tenant` | id e nome del chiamante |
| `ctx.plugin` | l'id di questo plugin |
| `ctx.perms`, `ctx.can("key")` | permessi del chiamante: `use`, `create`, `delete`, `share` e i `[[user_permissions]]` che ha |
| `ctx.groups` | i gruppi dell'organizzazione a cui il chiamante appartiene, `[{id, name}]` (vuoto se nessuno), letti a ogni chiamata |
| `ctx.config`, `ctx.setting("key")` | le impostazioni `[[config]]` della piattaforma (`None` se non impostata; segreti inclusi, mai mandarli alla UI) |
| `ctx.log("testo")` | una riga nel log del server |

## Operazioni dell'host

`ctx.<area>()` manda una richiesta JSON `{"op": …, "req": …}`; l'operazione va all'host, che la esegue come il chiamante con
i controlli qui sotto. I permessi sono i `[permissions]` del manifesto.

| Operazione | SDK | Richiede | Risposta |
|---|---|---|---|
| `db.query` | `ctx.db().query(sql, &params)`, `query_one` | | righe come oggetti JSON |
| `db.exec` | `ctx.db().exec(sql, &params)` | | numero di righe |
| `resource.create` | `ctx.resources().create(kind, title, parent)` | | l'id (sperimentale) |
| `resource.delete` | `ctx.resources().delete(id)` | livello di gestione | niente (sperimentale) |
| `http.fetch` | `ctx.http().get(url)`, `fetch(method, url, body)`, `fetch_with_key(…, service)` | `network` o un servizio con indirizzo | `{status, body}` (sperimentale) |
| `key.get` | `ctx.service_key("id")` | `[[service_keys]]` | la chiave in uso, o `None` |
| `notify` | `ctx.notify(&Notice)` | `notify = true` | niente (sperimentale) |
| `plugin.call` | `ctx.call_plugin(plugin, name, args)` | `calls` | il risultato (sperimentale) |
| `files.list`, `files.describe`, `files.read` | `ctx.files().list(parent)`, `describe(id)`, `read(id, max_bytes)` | `files_read = true` | righe, vedi sotto |

### `db`

`query` esegue `SELECT`, oppure `INSERT/UPDATE/DELETE` con `RETURNING`; `exec` esegue DML senza `RETURNING`. I parametri
`$1..$n` sono testo, numeri, bool o null: fare il cast in SQL (`$1::uuid`). Un'istruzione per chiamata; la **guardia SQL**
accetta solo `SELECT/INSERT/UPDATE/DELETE` (e `WITH`), niente `SET`, funzioni di sistema o altri schemi, e l'istruzione gira
con il ruolo del plugin: la row level security filtra le righe ([Dati](data.md)). `db.query` su un'istruzione che non
produce righe dice `db.query requires SELECT or RETURNING: use db.exec`. Le istruzioni girano sotto un savepoint, quindi
un errore SQL non avvelena la transazione.

### `http`

Metodi `GET`, `POST`, `PUT`, `DELETE`; l'origine deve essere in `permissions.network` o essere l'indirizzo che un
Administrator ha impostato per una chiave di servizio con `address = true`; si raggiungono solo indirizzi pubblici (chi
installa può esentare destinazioni private per le origini che il plugin dichiara); il corpo torna come testo, al massimo
4 MiB. `fetch_with_key` aggiunge `Authorization: Bearer <chiave>` per un servizio di `[[service_keys]]`: la logica non
legge mai la chiave. Errori: `origin not declared in permissions.network: <origine>`, `method not allowed: <m>`,
`no key of the service <s> is set`, `HTTP response over 4 MB`.

### `notify`

```rust
ctx.notify(&Notice::new("Due today").body("Site visit").at("notes/1").resource(&id))?;
```

`title` è obbligatorio (tagliato a 160 caratteri), `body` facoltativo (600). Il plugin non indica mai i destinatari: senza
`resource` la notifica va al solo chiamante; con l'id di un elemento dello stesso plugin e organizzazione su cui il
chiamante ha il livello di scrittura, va a chi può vedere l'elemento, escluso il chiamante. `at` è un posto dentro il
plugin (lettere, cifre e `/_-.=&?%:`, fino a 200): il link è sempre `#/t/<tenant>/p/<plugin>/<at>`. Limite: 30 al minuto
per ogni persona e plugin. Una forma sbagliata o il limite fanno fallire subito la chiamata; i destinatari sono risolti e
la notifica inviata dopo il commit dell'operazione, quindi un'operazione annullata non notifica nessuno.

### `call_plugin`

Il plugin chiamato deve essere in `[permissions] calls`. Il comando gira con **lo stesso utente e organizzazione**, in una
transazione propria e con il proprio ruolo e le proprie regole; può chiamarne altri fino a **3 livelli**. Richiede
PostgreSQL: su SQLite l'errore è `plugin.call requires PostgreSQL`. Errori: `plugin not declared in permissions.calls: <id>`,
`too many nested calls between plugins`.

### `files`

Legge l'area File con i permessi del **chiamante**, le regole che applica la UI dei File: nessuno vede più di quanto vede
nella UI, un link pubblico non è un chiamante. `files.list {parent?}` risponde `{entries, truncated}` (al massimo 1000
righe); `files.describe {id}` una riga; `files.read {id, max_bytes?}` risponde `{entry, base64, size, truncated}`, con
`max_bytes` tagliato a 4 MiB. Una riga ha `id, name, is_dir, size, mime, created, modified, owner_id, owner_name, my_level,
shared, parent_id` e mai un percorso di archiviazione.

### Gruppi e web

`ctx.groups` (sopra) è il modo di leggere i gruppi; non c'è un'operazione. `msk.web.probe` (permesso `web`) appartiene alla
UI ([Riferimento della UI](ui.md)); la logica ha `http.fetch` per il web.

## Errori

```rust
Err(Error::coded("invoice_locked", "The invoice is closed"))   // un codice e il testo per la persona
Err(Error::msg("something went wrong"))                        // senza codice
Err("text".into())                                             // lo stesso
```

`Error` è una struct con `message` e `code: Option<String>` (`#[non_exhaustive]`; si costruisce con `msg`, `coded`,
`with_code`). Un codice è `[a-z][a-z0-9_]*`, al massimo 48 caratteri. Un errore **annulla la transazione**. La shell
mostra il messaggio (codice d'errore `plugin_error`); la UI del plugin riceve il tuo codice come `BridgeError.code` e può
reagire senza leggere il testo. Si ragiona sui codici, mai sul testo.

Anche l'errore di un'operazione dell'host è un `Error`. Le operazioni `files` portano un codice stabile, che una logica che
restituisce l'errore invariato passa alla sua UI:

| Codice | Causa |
|---|---|
| `permission_denied` | il manifesto non ha `files_read` (o il chiamante non può) |
| `not_found` | manca, o il chiamante non lo vede: i due casi non si distinguono |
| `invalid_argument` | id sbagliato, una cartella data a `files.read`, `max_bytes` sbagliato |
| `internal` | tutto il resto |

Se è la logica stessa a fallire, il kernel risponde con: `instruction limit exceeded`, `the plugin ended with an error: <trap>`
(un panic o un trap wasm), `invalid message from the plugin: <perché>` (per esempio `answer too large`), `invalid WASM
module: <perché>`.

## Limiti

| Limite | Valore |
|---|---|
| istruzioni (fuel) | 2.000.000.000 per comando; 500.000.000 per hook |
| memoria del guest | 64 MiB |
| dimensione di un messaggio (in o out) | 16 MiB |
| risposta di `http.fetch` | 4 MiB |
| `plugin.call` annidate | 3 livelli |
| `files.list` | 1000 righe; `files.read` 4 MiB |
| `notify` | 30 al minuto per persona e plugin; titolo 160, corpo 600, `at` 200 |
| tempo di un'istruzione SQL su PostgreSQL | 15 s (`statement_timeout` del ruolo) |
| codice d'errore | 48 caratteri |

Una nuova istanza a ogni chiamata significa che nessuno stato sopravvive tra le chiamate: lo stato va nel database.

## `MockHost`: test nativi

`mosaikit_plugin_sdk::testing::MockHost` esegue comandi e hook in nativo, contro risposte che si programmano. La guardia del
server qui non c'è; `validate --strict` controlla le migrazioni e il server le query.

```rust
use mosaikit_plugin_sdk::testing::MockHost;

let host = MockHost::new().on("db.query", |req| {
    assert_eq!(req["params"][0], "work");
    Ok(json!([{ "tag": "work", "n": 2 }]))
});
let out = host.command(&__msk_registry(), "notes.count_by_tag", json!({}));
assert_eq!(out.unwrap()[0]["n"], 2);
```

| Metodo | Uso |
|---|---|
| `on(op, f)` | la risposta a un'operazione dell'host; un'operazione senza risposta fallisce con `MockHost: no answer for <op>` (tranne `notify`, accettata) |
| `with_perms(&[…])` | `ctx.perms` (predefiniti i quattro standard) |
| `with_groups(&[(id, name)])` | `ctx.groups` |
| `with_plugin_command(plugin, name, f)` | ciò che restituisce `call_plugin` |
| `deny(op, message)` | l'host rifiuta un'operazione, come quando il permesso non è nel manifesto |
| `with_files(vec![FakeFile::folder(..), FakeFile::file(..).in_folder(..)])` | l'area File per `files.*` |
| `command(reg, name, args)`, `command_err(..)`, `hook(reg, hook, resource, values)` | eseguirlo; `command_err` tiene l'errore intero con il suo codice |
| `calls()`, `notifications()`, `logs()` | ciò che la logica ha chiesto, inviato e scritto nel log |

Altre ricette in [Test](testing.md).
