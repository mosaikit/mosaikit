//! Export dell'ABI v1 (usati dalla macro `plugin!` su wasm32).

use crate::Registry;

/// Alloca `len` byte nella memoria del guest e ne ritorna l'indirizzo.
/// La memoria non viene mai liberata: ogni chiamata usa un'istanza nuova.
pub fn alloc(len: i32) -> i32 {
    let mut buf = Vec::<u8>::with_capacity(len.max(0) as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr as usize as i32
}

/// Legge il messaggio, lo smista e ritorna `(ptr << 32) | len` della risposta.
pub fn call(ptr: i32, len: i32, registry: &Registry) -> i64 {
    // SAFETY: `ptr`/`len` arrivano dall'host, che ha scritto `len` byte a partire
    // da un indirizzo restituito da `alloc`.
    let input = unsafe { std::slice::from_raw_parts(ptr as usize as *const u8, len.max(0) as usize) };
    let reply = match serde_json::from_slice(input) {
        Ok(msg) => registry.dispatch(&msg),
        Err(e) => serde_json::json!({ "err": format!("messaggio non valido: {e}") }),
    };
    let out = serde_json::to_vec(&reply).unwrap_or_else(|_| br#"{"err":"serializzazione"}"#.to_vec());
    let (p, n) = (out.as_ptr() as usize as u64, out.len() as u64);
    std::mem::forget(out);
    ((p << 32) | n) as i64
}
