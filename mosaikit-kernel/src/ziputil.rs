//! Utility ZIP std-only, generiche (non di dominio): lettura central
//! directory, estrazione entry STORED e DEFLATE (inflate RFC 1951
//! std-only), base64. Usate dallo storage dei plugin (`Vfs::unzip`) e dalla
//! demo CLI; con un runtime WASM il PLUGIN puo' fare lo stesso lavoro
//! sandboxato via msk_action. Limiti: niente ZIP64 ne' cifratura, CRC non
//! verificato.

pub struct ZipEntry {
    pub name: String,
    pub method: u16, // 0 = STORED, 8 = DEFLATE
    pub size: u32,   // dimensione non compressa
    csize: u32,      // dimensione compressa
    flags: u16,
    offset: u32,
}

impl ZipEntry {
    pub fn is_dir(&self) -> bool { self.name.ends_with('/') || self.name.ends_with('\\') }
}

fn u16le(b: &[u8], o: usize) -> u16 { u16::from_le_bytes([b[o], b[o + 1]]) }
fn u32le(b: &[u8], o: usize) -> u32 { u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]) }

pub fn list_entries(b: &[u8]) -> Result<Vec<ZipEntry>, String> {
    if b.len() < 22 { return Err("file troppo piccolo per essere uno zip".into()); }
    let mut i = b.len() - 22;
    let eocd = loop {
        if u32le(b, i) == 0x06054b50 { break i; }
        if i == 0 { return Err("EOCD (End Of Central Directory) non trovato".into()); }
        i -= 1;
    };
    let n = u16le(b, eocd + 10) as usize;
    let mut p = u32le(b, eocd + 16) as usize;
    let mut out = Vec::new();
    for _ in 0..n {
        if p + 46 > b.len() || u32le(b, p) != 0x02014b50 { return Err("central directory corrotta".into()); }
        let nl = u16le(b, p + 28) as usize;
        let el = u16le(b, p + 30) as usize;
        let cl = u16le(b, p + 32) as usize;
        if p + 46 + nl > b.len() { return Err("nome entry oltre il buffer".into()); }
        out.push(ZipEntry {
            name: String::from_utf8_lossy(&b[p + 46..p + 46 + nl]).into_owned(),
            method: u16le(b, p + 10),
            size: u32le(b, p + 24),
            csize: u32le(b, p + 20),
            flags: u16le(b, p + 8),
            offset: u32le(b, p + 42),
        });
        p += 46 + nl + el + cl;
    }
    Ok(out)
}

/// Estrae una entry STORED (per le entry compresse usare `extract`).
pub fn extract_stored(b: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let e = find(b, name)?;
    if e.method != 0 { return Err(format!("'{}' e' compressa (method {}): usare extract()", e.name, e.method)); }
    extract_entry(b, &e)
}

/// Estrae una entry per nome (STORED o DEFLATE).
pub fn extract(b: &[u8], name: &str) -> Result<Vec<u8>, String> {
    extract_entry(b, &find(b, name)?)
}

fn find(b: &[u8], name: &str) -> Result<ZipEntry, String> {
    list_entries(b)?.into_iter().find(|e| e.name == name)
        .ok_or_else(|| format!("entry non trovata: {name}"))
}

/// Estrae i dati di una entry letta dalla central directory.
pub fn extract_entry(b: &[u8], e: &ZipEntry) -> Result<Vec<u8>, String> {
    if e.flags & 1 != 0 { return Err(format!("'{}' e' cifrata: non supportato", e.name)); }
    let p = e.offset as usize;
    if p + 30 > b.len() || u32le(b, p) != 0x04034b50 { return Err("local header non valido".into()); }
    let nl = u16le(b, p + 26) as usize;
    let xl = u16le(b, p + 28) as usize;
    let s = p + 30 + nl + xl;
    let end = s + e.csize as usize;
    if end > b.len() { return Err(format!("'{}' troncata", e.name)); }
    let raw = &b[s..end];
    let data = match e.method {
        0 => raw.to_vec(),
        8 => inflate(raw, e.size as usize)?,
        m => return Err(format!("'{}': compressione {m} non supportata (solo STORED/DEFLATE)", e.name)),
    };
    if data.len() != e.size as usize {
        return Err(format!("'{}': estratti {} byte invece di {}", e.name, data.len(), e.size));
    }
    Ok(data)
}

// ---------------------------------------------------------------------------
// Inflate (RFC 1951) std-only: decoder Huffman canonico in stile "puff" (zlib).
// ---------------------------------------------------------------------------

struct Bits<'a> { data: &'a [u8], pos: usize, buf: u32, cnt: u32 }

impl Bits<'_> {
    fn bits(&mut self, n: u32) -> Result<u32, String> {
        while self.cnt < n {
            let byte = *self.data.get(self.pos).ok_or("deflate: dati terminati prematuramente")?;
            self.buf |= (byte as u32) << self.cnt;
            self.pos += 1;
            self.cnt += 8;
        }
        let v = self.buf & ((1u32 << n) - 1);
        self.buf >>= n;
        self.cnt -= n;
        Ok(v)
    }
}

struct Huffman { count: [u16; 16], symbol: Vec<u16> }

impl Huffman {
    fn new(lengths: &[u8]) -> Self {
        let mut count = [0u16; 16];
        for &l in lengths { count[l as usize] += 1; }
        let mut offs = [0u16; 16];
        for i in 1..15 { offs[i + 1] = offs[i] + count[i]; }
        let mut symbol = vec![0u16; lengths.len()];
        for (s, &l) in lengths.iter().enumerate() {
            if l != 0 {
                symbol[offs[l as usize] as usize] = s as u16;
                offs[l as usize] += 1;
            }
        }
        Huffman { count, symbol }
    }

    fn decode(&self, br: &mut Bits) -> Result<u16, String> {
        let (mut code, mut first, mut index) = (0i32, 0i32, 0i32);
        for len in 1..16 {
            code |= br.bits(1)? as i32;
            let count = self.count[len] as i32;
            if code - count < first {
                return self.symbol.get((index + code - first) as usize).copied()
                    .ok_or_else(|| "deflate: codice Huffman non valido".to_string());
            }
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        Err("deflate: codice Huffman non valido".into())
    }
}

const LBASE: [u16; 29] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE: [u16; 30] = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

/// Decomprime uno stream DEFLATE raw. `max` limita l'output (anti zip-bomb):
/// per una entry zip e' la dimensione non compressa dichiarata.
pub fn inflate(data: &[u8], max: usize) -> Result<Vec<u8>, String> {
    let mut br = Bits { data, pos: 0, buf: 0, cnt: 0 };
    let mut out: Vec<u8> = Vec::with_capacity(max.min(64 << 20));
    loop {
        let last = br.bits(1)?;
        match br.bits(2)? {
            0 => {
                // blocco non compresso: si riallinea al byte scartando i bit residui
                br.buf = 0;
                br.cnt = 0;
                let p = br.pos;
                if p + 4 > data.len() { return Err("deflate: blocco stored troncato".into()); }
                let len = u16le(data, p) as usize;
                if len != !u16le(data, p + 2) as usize { return Err("deflate: LEN/NLEN incoerenti".into()); }
                if p + 4 + len > data.len() { return Err("deflate: blocco stored troncato".into()); }
                if out.len() + len > max { return Err("deflate: output oltre la dimensione dichiarata".into()); }
                out.extend_from_slice(&data[p + 4..p + 4 + len]);
                br.pos = p + 4 + len;
            }
            1 => {
                let mut l = [0u8; 288];
                for (i, v) in l.iter_mut().enumerate() {
                    *v = match i { 0..=143 => 8, 144..=255 => 9, 256..=279 => 7, _ => 8 };
                }
                codes(&mut br, &mut out, &Huffman::new(&l), &Huffman::new(&[5u8; 30]), max)?;
            }
            2 => {
                let nlen = br.bits(5)? as usize + 257;
                let ndist = br.bits(5)? as usize + 1;
                let ncode = br.bits(4)? as usize + 4;
                if nlen > 286 || ndist > 30 { return Err("deflate: header dinamico non valido".into()); }
                const ORDER: [usize; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
                let mut cl = [0u8; 19];
                for &o in ORDER.iter().take(ncode) { cl[o] = br.bits(3)? as u8; }
                let lencode = Huffman::new(&cl);
                let mut lengths = vec![0u8; nlen + ndist];
                let mut i = 0;
                while i < nlen + ndist {
                    let sym = lencode.decode(&mut br)?;
                    let (val, rep) = match sym {
                        0..=15 => (sym as u8, 1),
                        16 => {
                            if i == 0 { return Err("deflate: ripetizione senza lunghezza precedente".into()); }
                            (lengths[i - 1], 3 + br.bits(2)? as usize)
                        }
                        17 => (0, 3 + br.bits(3)? as usize),
                        _ => (0, 11 + br.bits(7)? as usize),
                    };
                    if i + rep > nlen + ndist { return Err("deflate: troppe lunghezze di codice".into()); }
                    for _ in 0..rep { lengths[i] = val; i += 1; }
                }
                if lengths[256] == 0 { return Err("deflate: manca il codice di fine blocco".into()); }
                codes(&mut br, &mut out, &Huffman::new(&lengths[..nlen]), &Huffman::new(&lengths[nlen..]), max)?;
            }
            _ => return Err("deflate: tipo di blocco non valido".into()),
        }
        if last == 1 { return Ok(out); }
    }
}

fn codes(br: &mut Bits, out: &mut Vec<u8>, lit: &Huffman, dist: &Huffman, max: usize) -> Result<(), String> {
    loop {
        let sym = lit.decode(br)? as usize;
        if sym < 256 {
            if out.len() >= max { return Err("deflate: output oltre la dimensione dichiarata".into()); }
            out.push(sym as u8);
        } else if sym == 256 {
            return Ok(());
        } else {
            let s = sym - 257;
            if s >= 29 { return Err("deflate: simbolo di lunghezza non valido".into()); }
            let len = LBASE[s] as usize + br.bits(LEXT[s] as u32)? as usize;
            let ds = dist.decode(br)? as usize;
            if ds >= 30 { return Err("deflate: simbolo di distanza non valido".into()); }
            let d = DBASE[ds] as usize + br.bits(DEXT[ds] as u32)? as usize;
            if d > out.len() { return Err("deflate: distanza oltre l'inizio dell'output".into()); }
            if out.len() + len > max { return Err("deflate: output oltre la dimensione dichiarata".into()); }
            let start = out.len() - d;
            for k in 0..len {
                let c = out[start + k];
                out.push(c);
            }
        }
    }
}

/// Scrive uno zip STORED valido (per esempi/test). CRC a 0: i lettori
/// della PoC non lo verificano (limitazione documentata).
pub fn write_stored_zip(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in entries {
        let off = out.len() as u32;
        out.extend_from_slice(&0x04034b50u32.to_le_bytes());
        out.extend_from_slice(&20u16.to_le_bytes()); // version needed
        out.extend_from_slice(&0u16.to_le_bytes());  // flags
        out.extend_from_slice(&0u16.to_le_bytes());  // method: STORED
        out.extend_from_slice(&0u16.to_le_bytes());  // time
        out.extend_from_slice(&0u16.to_le_bytes());  // date
        out.extend_from_slice(&0u32.to_le_bytes());  // crc32 (non verificato nella PoC)
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(name.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());  // extra len
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(data);

        central.extend_from_slice(&0x02014b50u32.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes()); // version made by
        central.extend_from_slice(&20u16.to_le_bytes()); // version needed
        central.extend_from_slice(&[0u8; 8]);            // flags(2), method(2), time(2), date(2)
        central.extend_from_slice(&0u32.to_le_bytes());  // crc32
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(name.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0u8; 8]);            // extra(2), comment(2), disk(2), int attrs(2)
        central.extend_from_slice(&0u32.to_le_bytes());  // external attrs
        central.extend_from_slice(&off.to_le_bytes());
        central.extend_from_slice(name.as_bytes());
    }
    let cd_off = out.len() as u32;
    out.extend_from_slice(&central);
    let cd_size = central.len() as u32;
    out.extend_from_slice(&0x06054b50u32.to_le_bytes());
    out.extend_from_slice(&[0u8; 4]); // EOCD: disk number(2) + cd start disk(2)
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&cd_size.to_le_bytes());
    out.extend_from_slice(&cd_off.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

pub fn base64_encode(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for ch in b.chunks(3) {
        let n = ((ch[0] as u32) << 16) | ((ch.get(1).copied().unwrap_or(0) as u32) << 8) | ch.get(2).copied().unwrap_or(0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if ch.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if ch.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn stored_zip_roundtrip() {
        let zip = write_stored_zip(&[
            ("index.html".to_string(), b"<h1>Ciao</h1>".to_vec()),
            ("assets/style.css".to_string(), b"body{}".to_vec()),
        ]);
        let entries = list_entries(&zip).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "index.html");
        assert_eq!(entries[0].method, 0);
        let html = String::from_utf8(extract_stored(&zip, "index.html").unwrap()).unwrap();
        assert_eq!(html, "<h1>Ciao</h1>");
        assert!(extract_stored(&zip, "mancante.txt").is_err());
    }

    pub(crate) fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    /// Testo della pagina usata nei vettori generati con zlib (Python).
    pub(crate) fn sample_html() -> Vec<u8> {
        let mut s = String::from("<!doctype html><html><head><title>Sito</title><link rel=stylesheet href=css/style.css></head><body><h1>Mosaikit</h1>");
        for i in 0..40 { s.push_str(&format!("<p>riga {i} del sito statico di prova</p>")); }
        s.push_str("</body></html>");
        s.into_bytes()
    }

    #[test]
    fn inflate_blocchi_fixed_dynamic_stored() {
        // fixed Huffman (zlib, livello 9, stream raw)
        let fixed = hex("4bce4ccc5748462572f38b1333b3334b00");
        assert_eq!(inflate(&fixed, 1000).unwrap(), b"ciao ciao ciao ciao mosaikit");
        // dynamic Huffman
        let dynamic = hex("8dd54d4ec4300c86e1ab980b106cf32b657203569c203486461326556321f5f65453c4966f5345ed2b2ff2a849bc297df26d319afdaba5f8fbb45c52f4eacdd25bf51ec3b18ead5eceb45a3b0ddf9a8dd9cc695eede3348d11aeef6ef7558ae198f0decbb64fe3f4da47aee7eafb074e71496bfdcc7447c51a8d7d3e0dcf5ea74ea5d2b2f6ef1cc3f297319609962996dd63d903963d62d913963d63d90bb8bd2803e8c0200483120c523068c12006831a0c7230e821a087a0ff05e821a087801e027a08e821a087801e027a28e8a1a087a20715e8a1a087821e0a7a28e8a1a087fee7118edb245cafa81f");
        assert_eq!(inflate(&dynamic, 1720).unwrap(), sample_html());
        // stored: BFINAL=1, BTYPE=00, LEN, NLEN, dati
        let mut stored = vec![0x01, 5, 0, !5u8, 0xff];
        stored.extend_from_slice(b"mosai");
        assert_eq!(inflate(&stored, 5).unwrap(), b"mosai");
    }

    #[test]
    fn inflate_rifiuta_output_oltre_il_limite_e_dati_corrotti() {
        let fixed = hex("4bce4ccc5748462572f38b1333b3334b00");
        assert!(inflate(&fixed, 10).is_err());
        assert!(inflate(&fixed[..8], 1000).is_err());
        assert!(inflate(&[0x07], 10).is_err()); // BTYPE=11 riservato
    }

    #[test]
    fn base64_roundtrip() {
        let data = b"hello mosaikit";
        assert_eq!(base64_encode(data), "aGVsbG8gbW9zYWlraXQ=");
    }
}
