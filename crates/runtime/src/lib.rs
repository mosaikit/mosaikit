//! Esecuzione sandboxata della logica dei plugin.
//!
//! - interprete **wasmi** (puro Rust), nessuna WASI: il guest non ha file,
//!   rete o orologio se non tramite l'host;
//! - istanza nuova per ogni chiamata, limite di istruzioni (fuel) e di memoria;
//! - ABI v1 (vedi `docs/architettura.md` §8.3):
//!   export `msk_alloc(len) -> ptr`, `msk_call(ptr, len) -> (ptr << 32) | len`;
//!   import `msk.host_call(ptr, len) -> len`, `msk.host_read(ptr)`, `msk.log(ptr, len)`.

use serde_json::{json, Value};
use wasmi::{Caller, Config, Extern, Linker, Memory, Store, StoreLimits, StoreLimitsBuilder, TypedFunc};

pub const ABI_EXPORTS: &[&str] = &["memory", "msk_alloc", "msk_call"];

#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("modulo WASM non valido: {0}")]
    Invalid(String),
    #[error("limite di istruzioni superato")]
    OutOfFuel,
    #[error("il plugin e' terminato con un errore: {0}")]
    Trap(String),
    #[error("messaggio non valido dal plugin: {0}")]
    Protocol(String),
}

pub type Result<T> = std::result::Result<T, RuntimeError>;

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// istruzioni WASM (circa) per chiamata
    pub fuel: u64,
    /// memoria lineare massima del guest
    pub memory_bytes: usize,
    /// dimensione massima di un messaggio in ingresso o uscita
    pub max_message: usize,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits { fuel: 2_000_000_000, memory_bytes: 64 << 20, max_message: 16 << 20 }
    }
}

/// Servizi che l'host offre al guest durante una chiamata.
pub trait Host {
    /// Operazione richiesta dal guest (es. `db.query`). L'errore diventa `{"err": ...}`.
    fn call(&mut self, op: &str, req: &Value) -> std::result::Result<Value, String>;
    fn log(&mut self, msg: &str);
}

pub struct Engine {
    engine: wasmi::Engine,
    pub limits: Limits,
}

/// Modulo compilato, riusabile per molte chiamate.
#[derive(Clone)]
pub struct Module {
    inner: wasmi::Module,
}

struct State<H> {
    host: H,
    pending: Option<Vec<u8>>,
    limits: StoreLimits,
    max_message: usize,
}

impl Engine {
    pub fn new(limits: Limits) -> Engine {
        let mut config = Config::default();
        config.consume_fuel(true);
        Engine { engine: wasmi::Engine::new(&config), limits }
    }

    /// Compila e verifica gli export dell'ABI, senza eseguire nulla.
    pub fn compile(&self, wasm: &[u8]) -> Result<Module> {
        let inner =
            wasmi::Module::new(&self.engine, wasm).map_err(|e| RuntimeError::Invalid(e.to_string()))?;
        let exports: Vec<String> = inner.exports().map(|e| e.name().to_string()).collect();
        for need in ABI_EXPORTS {
            if !exports.iter().any(|e| e == need) {
                return Err(RuntimeError::Invalid(format!("export mancante: {need}")));
            }
        }
        for imp in inner.imports() {
            if imp.module() != "msk" || !["host_call", "host_read", "log"].contains(&imp.name()) {
                return Err(RuntimeError::Invalid(format!(
                    "import non consentito: {}.{} (solo msk.host_call, msk.host_read, msk.log)",
                    imp.module(),
                    imp.name()
                )));
            }
        }
        Ok(Module { inner })
    }

    /// Esegue una chiamata in un'istanza nuova. Ritorna sempre l'host, anche in caso di errore.
    pub fn call<H: Host + 'static>(&self, module: &Module, input: &Value, host: H) -> (Result<Value>, H) {
        self.call_with_fuel(module, input, host, self.limits.fuel)
    }

    pub fn call_with_fuel<H: Host + 'static>(
        &self,
        module: &Module,
        input: &Value,
        host: H,
        fuel: u64,
    ) -> (Result<Value>, H) {
        let state = State {
            host,
            pending: None,
            limits: StoreLimitsBuilder::new().memory_size(self.limits.memory_bytes).instances(1).build(),
            max_message: self.limits.max_message,
        };
        let mut store = Store::new(&self.engine, state);
        store.limiter(|s| &mut s.limits);
        let result = self.run(&mut store, module, input, fuel);
        (result, store.into_data().host)
    }

    fn run<H: Host + 'static>(
        &self,
        store: &mut Store<State<H>>,
        module: &Module,
        input: &Value,
        fuel: u64,
    ) -> Result<Value> {
        store.set_fuel(fuel).map_err(|e| RuntimeError::Invalid(e.to_string()))?;
        let mut linker = <Linker<State<H>>>::new(&self.engine);
        link(&mut linker).map_err(|e| RuntimeError::Invalid(e.to_string()))?;
        let instance = linker
            .instantiate(&mut *store, &module.inner)
            .and_then(|pre| pre.start(&mut *store))
            .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
        let memory = instance
            .get_memory(&*store, "memory")
            .ok_or_else(|| RuntimeError::Invalid("memory non esportata".into()))?;
        let alloc: TypedFunc<i32, i32> = instance
            .get_typed_func(&*store, "msk_alloc")
            .map_err(|e| RuntimeError::Invalid(e.to_string()))?;
        let call: TypedFunc<(i32, i32), i64> =
            instance.get_typed_func(&*store, "msk_call").map_err(|e| RuntimeError::Invalid(e.to_string()))?;

        let msg = serde_json::to_vec(input).map_err(|e| RuntimeError::Protocol(e.to_string()))?;
        if msg.len() > self.limits.max_message {
            return Err(RuntimeError::Protocol("messaggio in ingresso troppo grande".into()));
        }
        let len = msg.len() as i32;
        let ptr = alloc.call(&mut *store, len).map_err(trap)?;
        memory.write(&mut *store, ptr as usize, &msg).map_err(|e| RuntimeError::Protocol(e.to_string()))?;
        let packed = call.call(&mut *store, (ptr, len)).map_err(trap)?;
        let (out_ptr, out_len) = ((packed as u64 >> 32) as usize, (packed as u64 & 0xffff_ffff) as usize);
        if out_len > self.limits.max_message {
            return Err(RuntimeError::Protocol("risposta troppo grande".into()));
        }
        let mut out = vec![0u8; out_len];
        memory.read(&*store, out_ptr, &mut out).map_err(|e| RuntimeError::Protocol(e.to_string()))?;
        serde_json::from_slice(&out).map_err(|e| RuntimeError::Protocol(e.to_string()))
    }
}

fn trap(e: wasmi::Error) -> RuntimeError {
    if let Some(code) = e.as_trap_code() {
        if code == wasmi::core::TrapCode::OutOfFuel {
            return RuntimeError::OutOfFuel;
        }
    }
    let s = e.to_string();
    if s.contains("fuel") {
        RuntimeError::OutOfFuel
    } else {
        RuntimeError::Trap(s)
    }
}

fn memory_of<H>(caller: &Caller<'_, State<H>>) -> std::result::Result<Memory, wasmi::Error> {
    match caller.get_export("memory") {
        Some(Extern::Memory(m)) => Ok(m),
        _ => Err(wasmi::Error::new("memory non esportata")),
    }
}

fn read_bytes<H>(
    caller: &Caller<'_, State<H>>,
    ptr: i32,
    len: i32,
) -> std::result::Result<Vec<u8>, wasmi::Error> {
    if len < 0 || len as usize > caller.data().max_message {
        return Err(wasmi::Error::new("messaggio troppo grande"));
    }
    let mut buf = vec![0u8; len as usize];
    memory_of(caller)?
        .read(caller, ptr as u32 as usize, &mut buf)
        .map_err(|e| wasmi::Error::new(e.to_string()))?;
    Ok(buf)
}

fn link<H: Host + 'static>(linker: &mut Linker<State<H>>) -> std::result::Result<(), wasmi::Error> {
    linker.func_wrap(
        "msk",
        "host_call",
        |mut caller: Caller<'_, State<H>>, ptr: i32, len: i32| -> std::result::Result<i32, wasmi::Error> {
            let raw = read_bytes(&caller, ptr, len)?;
            let reply = match serde_json::from_slice::<Value>(&raw) {
                Ok(req) => {
                    let op = req.get("op").and_then(Value::as_str).unwrap_or_default().to_string();
                    let body = req.get("req").cloned().unwrap_or(Value::Null);
                    match caller.data_mut().host.call(&op, &body) {
                        Ok(v) => json!({ "ok": v }),
                        Err(e) => json!({ "err": e }),
                    }
                }
                Err(e) => json!({ "err": format!("richiesta non valida: {e}") }),
            };
            let bytes = serde_json::to_vec(&reply).map_err(|e| wasmi::Error::new(e.to_string()))?;
            if bytes.len() > caller.data().max_message {
                return Err(wasmi::Error::new("risposta dell'host troppo grande"));
            }
            let n = bytes.len() as i32;
            caller.data_mut().pending = Some(bytes);
            Ok(n)
        },
    )?;
    linker.func_wrap(
        "msk",
        "host_read",
        |mut caller: Caller<'_, State<H>>, ptr: i32| -> std::result::Result<(), wasmi::Error> {
            let bytes = caller.data_mut().pending.take().unwrap_or_default();
            memory_of(&caller)?
                .write(&mut caller, ptr as u32 as usize, &bytes)
                .map_err(|e| wasmi::Error::new(e.to_string()))
        },
    )?;
    linker.func_wrap(
        "msk",
        "log",
        |mut caller: Caller<'_, State<H>>, ptr: i32, len: i32| -> std::result::Result<(), wasmi::Error> {
            let raw = read_bytes(&caller, ptr, len.min(8192))?;
            let msg = String::from_utf8_lossy(&raw).into_owned();
            caller.data_mut().host.log(&msg);
            Ok(())
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
