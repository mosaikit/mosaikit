//! ABI guest Mosaikit (inline, no-deps) — sezione comune ai plugin PoC.
//! Export: memory, msk_alloc, msk_dealloc, msk_manifest, msk_on_activate,
//! msk_on_deactivate (+ hook opzionali e msk_action). Import: env.msk_host_log.

use core::cell::UnsafeCell;
use core::sync::atomic::{AtomicUsize, Ordering};

struct Arena(UnsafeCell<[u8; 65536]>);
unsafe impl Sync for Arena {}
static ARENA: Arena = Arena(UnsafeCell::new([0; 65536]));
static BUMP: AtomicUsize = AtomicUsize::new(0);

#[no_mangle]
pub extern "C" fn msk_alloc(size: u32) -> u32 {
    let size = size as usize;
    let base = BUMP.fetch_add(size + 1, Ordering::Relaxed);
    if base + size + 1 > 65536 { return 0; }
    unsafe {
        let base_ptr = ARENA.0.get() as *mut u8; // puntatore ai byte, non all'array
        let p = base_ptr.add(base);
        core::ptr::write(p.add(size), 0u8); // NUL terminator
        p as u32
    }
}

#[no_mangle]
pub extern "C" fn msk_dealloc(_ptr: u32, _len: u32) {}

fn reply(s: &str) -> u32 {
    let p = msk_alloc(s.len() as u32);
    if p == 0 { return 0; }
    unsafe { core::ptr::copy_nonoverlapping(s.as_ptr(), p as *mut u8, s.len()); }
    p
}

extern "C" {
    #[link_name = "msk_host_log"]
    fn host_log(ptr: u32, len: u32);
}

fn log(msg: &str) {
    unsafe { host_log(msg.as_ptr() as u32, msg.len() as u32) }
}

unsafe fn read_str(ptr: u32) -> String {
    if ptr == 0 { return String::new(); }
    let p = ptr as *const u8;
    let mut len = 0usize;
    while *p.add(len) != 0 { len += 1; }
    String::from_utf8_lossy(core::slice::from_raw_parts(p, len)).into_owned()
}

#[allow(dead_code)]
#[inline]
fn u16le(b: &[u8], o: usize) -> u16 { u16::from_le_bytes([b[o], b[o + 1]]) }

#[allow(dead_code)]
#[inline]
fn u32le(b: &[u8], o: usize) -> u32 { u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) }

#[no_mangle]
pub extern "C" fn msk_manifest() -> u32 {
    reply(include_str!("../plugin.json"))
}

#[no_mangle]
pub extern "C" fn msk_on_activate() {
    log("tasks: plugin attivato");
}

#[no_mangle]
pub extern "C" fn msk_on_deactivate() {}

#[no_mangle]
pub extern "C" fn msk_on_update(record_ptr: u32) -> u32 {
    let json = unsafe { read_str(record_ptr) };
    if json.contains("\"priority\":\"alta\"") {
        log("msk_on_update: attivita' ad alta priorita' modificata");
    }
    0
}
