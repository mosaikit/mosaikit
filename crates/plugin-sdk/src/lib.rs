//! SDK per la logica dei plugin Mosaikit.
//!
//! ```ignore
//! use mosaikit_plugin_sdk::prelude::*;
//!
//! fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
//!     let mut v = hook.values.clone();
//!     if v.str("tag").is_empty() { v.set("tag", "personale"); }
//!     ctx.log("tag di default applicato");
//!     Ok(Some(v))
//! }
//!
//! fn count_by_tag(ctx: &Ctx, _args: Value) -> Result<Value> {
//!     Ok(Value::Array(ctx.db().query("select tag, count(*) as n from notes group by tag", &[])?))
//! }
//!
//! mosaikit_plugin_sdk::plugin! {
//!     hooks: { "notes.before_create" => before_create },
//!     commands: { "notes.count_by_tag" => count_by_tag },
//! }
//! ```
//!
//! Sul target `wasm32` la macro genera gli export dell'ABI; sugli altri target
//! la logica si prova con [`testing`] e un host simulato.

#![allow(unsafe_code)] // l'ABI WASM richiede puntatori grezzi: confinato in `abi`

pub mod abi;
mod host;
pub mod testing;
mod values;

pub use serde_json::{self, json, Map, Value};
pub use values::Values;

pub mod prelude {
    pub use crate::{json, Ctx, Error, Hook, Result, Value, Values};
}

/// Errore restituito al kernel: annulla la transazione dell'operazione.
#[derive(Debug, Clone, PartialEq)]
pub struct Error(pub String);

impl Error {
    pub fn msg(m: impl Into<String>) -> Error {
        Error(m.into())
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Error {}

impl From<String> for Error {
    fn from(s: String) -> Error {
        Error(s)
    }
}
impl From<&str> for Error {
    fn from(s: &str) -> Error {
        Error(s.to_string())
    }
}
impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Error {
        Error(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Contesto della chiamata: chi la fa, in quale tenant, per quale plugin.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Ctx {
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub tenant: Option<String>,
    #[serde(default)]
    pub plugin: String,
}

impl Ctx {
    pub fn db(&self) -> Db {
        Db(())
    }
    pub fn resources(&self) -> Resources {
        Resources(())
    }
    pub fn http(&self) -> Http {
        Http(())
    }
    pub fn log(&self, msg: &str) {
        host::log(msg);
    }
    /// Comando di un altro plugin (dichiarato in `permissions.calls`), con lo
    /// stesso utente: il plugin chiamato applica le proprie regole di accesso.
    pub fn call_plugin(&self, plugin: &str, name: &str, args: Value) -> Result<Value> {
        host::call("plugin.call", serde_json::json!({ "plugin": plugin, "name": name, "args": args }))
    }
}

/// Accesso SQL allo schema del plugin. Le query passano dal guard del kernel e
/// girano con il ruolo del plugin: la Row-Level Security filtra le righe.
pub struct Db(());

impl Db {
    /// `SELECT` (o DML con `RETURNING`): righe come oggetti JSON.
    /// I parametri `$1..$n` sono testo/numeri/bool/null: fare il cast in SQL (`$1::uuid`).
    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Value>> {
        match host::call("db.query", json!({ "sql": sql, "params": params }))? {
            Value::Array(rows) => Ok(rows),
            other => Err(Error(format!("risposta inattesa: {other}"))),
        }
    }

    /// Prima riga, se presente.
    pub fn query_one(&self, sql: &str, params: &[Value]) -> Result<Option<Value>> {
        Ok(self.query(sql, params)?.into_iter().next())
    }

    /// `INSERT/UPDATE/DELETE` senza `RETURNING`: numero di righe toccate.
    pub fn exec(&self, sql: &str, params: &[Value]) -> Result<u64> {
        let v = host::call("db.exec", json!({ "sql": sql, "params": params }))?;
        Ok(v.get("rows").and_then(Value::as_u64).unwrap_or(0))
    }
}

/// Risorse del kernel (proprieta', condivisione, gerarchia).
pub struct Resources(());

impl Resources {
    /// Crea una risorsa del plugin: proprietario = utente della chiamata.
    pub fn create(&self, kind: &str, title: &str, parent: Option<&str>) -> Result<String> {
        let v = host::call("resource.create", json!({ "kind": kind, "title": title, "parent": parent }))?;
        v.as_str().map(str::to_string).ok_or_else(|| Error::msg("id risorsa mancante"))
    }

    /// Elimina una risorsa (serve il livello gestione).
    pub fn delete(&self, id: &str) -> Result<()> {
        host::call("resource.delete", json!({ "id": id }))?;
        Ok(())
    }
}

/// HTTP verso le sole origini dichiarate in `permissions.network`.
pub struct Http(());

#[derive(Debug, Clone, PartialEq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

impl HttpResponse {
    pub fn json(&self) -> Result<Value> {
        Ok(serde_json::from_str(&self.body)?)
    }
}

impl Http {
    pub fn get(&self, url: &str) -> Result<HttpResponse> {
        self.fetch("GET", url, None)
    }

    pub fn fetch(&self, method: &str, url: &str, body: Option<&str>) -> Result<HttpResponse> {
        let v = host::call("http.fetch", json!({ "method": method, "url": url, "body": body }))?;
        Ok(HttpResponse {
            status: v.get("status").and_then(Value::as_u64).unwrap_or(0) as u16,
            body: v.get("body").and_then(Value::as_str).unwrap_or_default().to_string(),
        })
    }
}

/// Hook su una risorsa CRUD.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Hook {
    /// `before_create`, `before_update`, `after_delete`
    pub hook: String,
    pub resource: String,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub values: Values,
    /// valori precedenti (solo `before_update`)
    #[serde(default)]
    pub previous: Option<Values>,
}

pub type CommandFn = fn(&Ctx, Value) -> Result<Value>;
/// Ritorna `Some(valori)` per modificarli, `None` per lasciarli invariati, `Err` per rifiutare.
pub type HookFn = fn(&Ctx, &Hook) -> Result<Option<Values>>;

/// Comandi e hook del plugin (generati da [`plugin!`]).
pub struct Registry {
    pub commands: &'static [(&'static str, CommandFn)],
    pub hooks: &'static [(&'static str, HookFn)],
}

impl Registry {
    /// Gestisce un messaggio del kernel e produce la risposta `{"ok":..}` / `{"err":..}`.
    pub fn dispatch(&self, msg: &Value) -> Value {
        match self.dispatch_inner(msg) {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": e.0 }),
        }
    }

    fn dispatch_inner(&self, msg: &Value) -> Result<Value> {
        let ctx: Ctx =
            serde_json::from_value(msg.get("ctx").cloned().unwrap_or(Value::Null)).unwrap_or_default();
        match msg.get("kind").and_then(Value::as_str) {
            Some("command") => {
                let name = msg.get("name").and_then(Value::as_str).unwrap_or_default();
                let f = self
                    .commands
                    .iter()
                    .find(|(n, _)| *n == name)
                    .ok_or_else(|| Error(format!("comando sconosciuto: {name}")))?
                    .1;
                f(&ctx, msg.get("args").cloned().unwrap_or(Value::Null))
            }
            Some("hook") => {
                let hook: Hook = serde_json::from_value(msg.clone())?;
                let key = format!("{}.{}", hook.resource, hook.hook);
                match self.hooks.iter().find(|(n, _)| *n == key) {
                    Some((_, f)) => Ok(match f(&ctx, &hook)? {
                        Some(v) => json!({ "values": v }),
                        None => Value::Null,
                    }),
                    None => Ok(Value::Null),
                }
            }
            other => Err(Error(format!("tipo di messaggio sconosciuto: {other:?}"))),
        }
    }

    pub fn command_names(&self) -> Vec<&'static str> {
        self.commands.iter().map(|c| c.0).collect()
    }
}

/// Dichiara hook e comandi del plugin e, su wasm32, genera gli export dell'ABI.
#[macro_export]
macro_rules! plugin {
    (
        $( hooks: { $( $hk:literal => $hf:path ),* $(,)? } $(,)? )?
        $( commands: { $( $ck:literal => $cf:path ),* $(,)? } $(,)? )?
    ) => {
        pub fn __msk_registry() -> $crate::Registry {
            $crate::Registry {
                commands: &[ $( $( ($ck, $cf as $crate::CommandFn) ),* )? ],
                hooks: &[ $( $( ($hk, $hf as $crate::HookFn) ),* )? ],
            }
        }

        #[cfg(target_arch = "wasm32")]
        #[allow(unsafe_code)]
        #[no_mangle]
        pub extern "C" fn msk_alloc(len: i32) -> i32 {
            $crate::abi::alloc(len)
        }

        #[cfg(target_arch = "wasm32")]
        #[allow(unsafe_code)]
        #[no_mangle]
        pub extern "C" fn msk_call(ptr: i32, len: i32) -> i64 {
            $crate::abi::call(ptr, len, &__msk_registry())
        }
    };
}
