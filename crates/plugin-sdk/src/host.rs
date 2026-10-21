//! Chiamate verso l'host: import WASM su wasm32, host simulato altrove.

use serde_json::{json, Value};

use crate::{Error, Result};

#[cfg(target_arch = "wasm32")]
mod imp {
    #[link(wasm_import_module = "msk")]
    extern "C" {
        fn host_call(ptr: *const u8, len: usize) -> i32;
        fn host_read(ptr: *mut u8);
        #[link_name = "log"]
        fn host_log(ptr: *const u8, len: usize);
    }

    pub fn call(msg: &[u8]) -> Option<Vec<u8>> {
        // SAFETY: il buffer vive per tutta la chiamata; l'host scrive al massimo `n` byte.
        unsafe {
            let n = host_call(msg.as_ptr(), msg.len());
            if n < 0 {
                return None;
            }
            let mut buf = vec![0u8; n as usize];
            host_read(buf.as_mut_ptr());
            Some(buf)
        }
    }

    pub fn log(msg: &str) {
        // SAFETY: puntatore e lunghezza di una stringa valida.
        unsafe { host_log(msg.as_ptr(), msg.len()) }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    pub fn call(msg: &[u8]) -> Option<Vec<u8>> {
        crate::testing::mock_call(msg)
    }
    pub fn log(msg: &str) {
        crate::testing::mock_log(msg)
    }
}

pub fn call(op: &str, req: Value) -> Result<Value> {
    let msg = serde_json::to_vec(&json!({ "op": op, "req": req }))?;
    let raw = imp::call(&msg).ok_or_else(|| Error::msg("chiamata all'host fallita"))?;
    let reply: Value = serde_json::from_slice(&raw)?;
    if let Some(e) = reply.get("err") {
        return Err(Error(e.as_str().map(str::to_string).unwrap_or_else(|| e.to_string())));
    }
    Ok(reply.get("ok").cloned().unwrap_or(Value::Null))
}

pub fn log(msg: &str) {
    imp::log(msg)
}
