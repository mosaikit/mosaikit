//! Exports of ABI v1 (used by the `plugin!` macro on wasm32).

use crate::Registry;

/// Allocates `len` bytes in the memory of the guest and returns the address.
/// The memory is never freed: every call uses a new instance.
pub fn alloc(len: i32) -> i32 {
    let mut buf = Vec::<u8>::with_capacity(len.max(0) as usize);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr as usize as i32
}

/// Reads the message, dispatches it and returns `(ptr << 32) | len` of the answer.
pub fn call(ptr: i32, len: i32, registry: &Registry) -> i64 {
    // SAFETY: `ptr`/`len` come from the host, which wrote `len` bytes starting
    // at an address returned by `alloc`.
    let input = unsafe { std::slice::from_raw_parts(ptr as usize as *const u8, len.max(0) as usize) };
    let reply = match serde_json::from_slice(input) {
        Ok(msg) => registry.dispatch(&msg),
        Err(e) => serde_json::json!({ "err": format!("invalid message: {e}") }),
    };
    let out = serde_json::to_vec(&reply).unwrap_or_else(|_| br#"{"err":"serialization"}"#.to_vec());
    let (p, n) = (out.as_ptr() as usize as u64, out.len() as u64);
    std::mem::forget(out);
    ((p << 32) | n) as i64
}
