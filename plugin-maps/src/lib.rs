//! ABI guest Mosaikit (inline, no-deps) — sezione comune ai plugin PoC.
//! Export: memory, msk_alloc, msk_dealloc, msk_manifest, msk_on_activate,
//! msk_on_deactivate (+ hook opzionali e msk_action). Import: env.msk_host_log.
//!
//! Il CRUD mappe vive interamente nella UI (`ui/maps.js`), con lo stesso
//! schema di Sestante (MapFrame/Editor): GeoLibre in iframe con `?embed=1`,
//! ponte di stato `geolibre:*` in tre fasi (probing -> restoring -> live) e
//! salvataggio automatico di ogni snapshot nel campo `config` del record.
//! Il guest non aggiunge logica server-side.

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

#[no_mangle]
pub extern "C" fn msk_manifest() -> u32 {
    reply(include_str!("../plugin.json"))
}

#[no_mangle]
pub extern "C" fn msk_on_activate() {}

#[no_mangle]
pub extern "C" fn msk_on_deactivate() {}
