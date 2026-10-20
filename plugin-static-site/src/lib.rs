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
pub extern "C" fn msk_on_activate() {}

#[no_mangle]
pub extern "C" fn msk_on_deactivate() {}

/// I file del sito vivono nello storage del plugin (permesso storage.files):
/// la UI estrae lo zip via host e registra qui cartella + pagina iniziale.
/// L'hook verifica solo che l'entry sia una pagina index.html.
#[no_mangle]
pub extern "C" fn msk_on_create(record_ptr: u32) -> u32 {
    let json = unsafe { read_str(record_ptr) };
    let entry = field(&json, "entry");
    if entry == "index.html" || entry.ends_with("/index.html") {
        log("msk_on_create: sito registrato");
    } else {
        log("msk_on_create: entry senza index.html");
    }
    0
}

#[no_mangle]
pub extern "C" fn msk_action(req_ptr: u32) -> u32 {
    let req = unsafe { read_str(req_ptr) };
    let zip_b64 = field(&req, "zip_b64");
    let bytes = match b64decode(&zip_b64) {
        Ok(b) => b,
        Err(e) => return reply(&format!("{{\"error\":\"{}\"}}", e)),
    };
    let entries = match zip_list(&bytes) {
        Ok(e) => e,
        Err(e) => return reply(&format!("{{\"error\":\"{}\"}}", e)),
    };
    if req.contains("\"cmd\":\"inspect\"") {
        let names: Vec<String> = entries.iter().map(|e| format!("\"{}\"", e.0)).collect();
        let entry = entries.iter().map(|e| e.0.clone())
            .find(|n| n.ends_with("index.html")).unwrap_or_default();
        return reply(&format!("{{\"entries\":[{}],\"entry\":\"{}\"}}", names.join(","), entry));
    }
    if req.contains("\"cmd\":\"extract\"") {
        let name = field(&req, "entry");
        return match zip_extract(&bytes, &name) {
            Ok(data) => match String::from_utf8(data) {
                Ok(s) => reply(&format!("{{\"content\":\"{}\"}}", s.replace('"', "'"))),
                Err(_) => reply("{\"error\":\"entry non UTF-8\"}"),
            },
            Err(e) => reply(&format!("{{\"error\":\"{}\"}}", e)),
        };
    }
    reply("{\"error\":\"cmd sconosciuto\"}")
}

fn field(json: &str, key: &str) -> String {
    let pat = format!("\"{}\":\"", key);
    if let Some(s) = json.find(&pat) {
        let start = s + pat.len();
        if let Some(rel) = json[start..].find('"') { return json[start..start + rel].to_string(); }
    }
    String::new()
}

fn b64decode(s: &str) -> Result<Vec<u8>, String> {
    fn val(c: u8) -> Option<u8> {
        match c { b'A'..=b'Z' => Some(c - b'A'), b'a'..=b'z' => Some(c - b'a' + 26),
                  b'0'..=b'9' => Some(c - b'0' + 52), b'+' => Some(62), b'/' => Some(63), _ => None }
    }
    let mut bytes: Vec<u8> = s.bytes().filter(|&b| b != b'=' && b != b'\n').collect();
    while bytes.len() % 4 != 0 { bytes.push(b'A'); }
    let mut out = Vec::new();
    for ch in bytes.chunks(4) {
        let v: Result<Vec<u8>, String> = ch.iter().map(|&b| val(b).ok_or_else(|| "base64 non valida".to_string())).collect();
        let v = v?;
        let n = ((v[0] as u32) << 18) | ((v[1] as u32) << 12) | ((v[2] as u32) << 6) | v[3] as u32;
        out.push((n >> 16) as u8);
        if ch.len() > 2 { out.push((n >> 8) as u8); }
        if ch.len() > 3 { out.push(n as u8); }
    }
    Ok(out)
}

fn zip_list(b: &[u8]) -> Result<Vec<(String, u16, u32, u32)>, String> {
    if b.len() < 22 { return Err("zip troppo piccolo".into()); }
    let mut i = b.len() - 22;
    let eocd = loop {
        if u32le(b, i) == 0x06054b50 { break i; }
        if i == 0 { return Err("EOCD non trovato".into()); }
        i -= 1;
    };
    let n = u16le(b, eocd + 10) as usize;
    let mut p = u32le(b, eocd + 16) as usize;
    let mut out = Vec::new();
    for _ in 0..n {
        if p + 46 > b.len() || u32le(b, p) != 0x02014b50 { return Err("central directory corrotta".into()); }
        let method = u16le(b, p + 10);
        let size = u32le(b, p + 24);
        let off = u32le(b, p + 42);
        let nl = u16le(b, p + 28) as usize;
        let el = u16le(b, p + 30) as usize;
        let cl = u16le(b, p + 32) as usize;
        if p + 46 + nl > b.len() { return Err("nome entry oltre il buffer".into()); }
        let name = String::from_utf8_lossy(&b[p + 46..p + 46 + nl]).into_owned();
        out.push((name, method, size, off));
        p += 46 + nl + el + cl;
    }
    Ok(out)
}

fn zip_extract(b: &[u8], name: &str) -> Result<Vec<u8>, String> {
    for (n, method, size, off) in zip_list(b)? {
        if n == name {
            if method != 0 { return Err(format!("entry compressa (method {}): PoC supporta solo STORED (zip -0)", method)); }
            let p = off as usize;
            if p + 30 > b.len() || u32le(b, p) != 0x04034b50 { return Err("local header non valido".into()); }
            let nl = u16le(b, p + 26) as usize;
            let xl = u16le(b, p + 28) as usize;
            let s = p + 30 + nl + xl;
            if s + size as usize > b.len() { return Err("entry troncata".into()); }
            return Ok(b[s..s + size as usize].to_vec());
        }
    }
    Err(format!("entry non trovata: {name}"))
}
