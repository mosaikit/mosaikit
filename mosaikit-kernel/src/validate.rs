//! Validatore WASM std-only: parsing degli export senza eseguire il codice.
//! Il kernel puo' quindi verificare che un plugin esporti l'ABI richiesta
//! PRIMA di installarlo, senza dover istanziare un runtime.

pub const REQUIRED_EXPORTS: [&str; 6] = [
    "memory",
    "msk_alloc",
    "msk_dealloc",
    "msk_manifest",
    "msk_on_activate",
    "msk_on_deactivate",
];

pub fn export_names(wasm: &[u8]) -> Result<Vec<String>, String> {
    if wasm.len() < 8 || &wasm[..4] != b"\0asm" {
        return Err("WASM: magic mancante".into());
    }
    if wasm[4..8] != [1, 0, 0, 0] {
        return Err("WASM: versione non supportata".into());
    }
    let mut pos = 8;
    let mut names = Vec::new();
    while pos < wasm.len() {
        let id = wasm[pos];
        pos += 1;
        let size = leb_u32(wasm, &mut pos)? as usize;
        let end = pos.checked_add(size).ok_or("section size overflow")?;
        if end > wasm.len() { return Err("WASM troncato".into()); }
        if id == 7 {
            // Export section
            let mut p = pos;
            let count = leb_u32(wasm, &mut p)?;
            for _ in 0..count {
                let nlen = leb_u32(wasm, &mut p)? as usize;
                if p + nlen > end { return Err("export name oltre la sezione".into()); }
                let name = std::str::from_utf8(&wasm[p..p + nlen]).map_err(|e| e.to_string())?.to_string();
                p += nlen;
                p += 1; // kind
                leb_u32(wasm, &mut p)?; // index
                names.push(name);
            }
        }
        pos = end;
    }
    Ok(names)
}

pub fn validate_guest(wasm: &[u8]) -> Result<Vec<String>, String> {
    let names = export_names(wasm)?;
    for req in REQUIRED_EXPORTS {
        if !names.iter().any(|n| n == req) {
            return Err(format!("WASM: export obbligatorio mancante: {req}"));
        }
    }
    Ok(names)
}

fn leb_u32(b: &[u8], pos: &mut usize) -> Result<u32, String> {
    let mut result: u32 = 0;
    let mut shift = 0;
    loop {
        let byte = *b.get(*pos).ok_or("LEB128: fine inattesa")?;
        *pos += 1;
        result |= ((byte & 0x7f) as u32) << shift;
        if byte & 0x80 == 0 { return Ok(result); }
        shift += 7;
        if shift >= 35 { return Err("LEB128 overflow".into()); }
    }
}

/// Modulo WASM minimale ma valido che esporta l'ABI Mosaikit.
/// Usato dalla CLI per i pacchetti dimostrativi e dai test.
pub fn minimal_guest_module() -> Vec<u8> {
    fn section(id: u8, payload: &[u8], out: &mut Vec<u8>) {
        out.push(id);
        out.push(payload.len() as u8); // tutte le sezioni qui sono < 128 byte
        out.extend_from_slice(payload);
    }
    fn name(s: &str) -> Vec<u8> {
        let mut v = vec![s.len() as u8];
        v.extend_from_slice(s.as_bytes());
        v
    }
    let mut v = vec![0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0];

    // Type: t0 ()->i32, t1 (i32,i32)->(), t2 ()->()
    section(1, &[
        0x03, 0x60, 0x00, 0x01, 0x7f,
        0x60, 0x02, 0x7f, 0x7f, 0x00,
        0x60, 0x00, 0x00,
    ], &mut v);
    // Function: [t0(alloc), t1(dealloc), t0(manifest), t2(on_activate), t2(on_deactivate)]
    section(3, &[0x05, 0x00, 0x01, 0x00, 0x02, 0x02], &mut v);
    // Memory: 1 memoria, min 1 pagina
    section(5, &[0x01, 0x00, 0x01], &mut v);
    // Export
    let mut exp = vec![0x06u8];
    exp.extend_from_slice(&name("memory"));      exp.extend_from_slice(&[0x02, 0x00]);
    exp.extend_from_slice(&name("msk_alloc"));   exp.extend_from_slice(&[0x00, 0x00]);
    exp.extend_from_slice(&name("msk_dealloc")); exp.extend_from_slice(&[0x00, 0x01]);
    exp.extend_from_slice(&name("msk_manifest"));exp.extend_from_slice(&[0x00, 0x02]);
    exp.extend_from_slice(&name("msk_on_activate"));  exp.extend_from_slice(&[0x00, 0x03]);
    exp.extend_from_slice(&name("msk_on_deactivate"));exp.extend_from_slice(&[0x00, 0x04]);
    section(7, &exp, &mut v);
    // Code: alloc/manifest -> i32.const 0; dealloc/activate/deactivate -> vuoto
    let body_val = [0x04u8, 0x00, 0x41, 0x00, 0x0b];
    let body_nop = [0x02u8, 0x00, 0x0b];
    section(10, &[
        0x05,
        body_val[0], body_val[1], body_val[2], body_val[3], body_val[4],
        body_nop[0], body_nop[1], body_nop[2],
        body_val[0], body_val[1], body_val[2], body_val[3], body_val[4],
        body_nop[0], body_nop[1], body_nop[2],
        body_nop[0], body_nop[1], body_nop[2],
    ], &mut v);
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_module_exports() {
        let names = export_names(&minimal_guest_module()).unwrap();
        for req in REQUIRED_EXPORTS { assert!(names.iter().any(|n| n == req), "manca {req}"); }
    }

    #[test]
    fn rejects_bad_magic() {
        assert!(export_names(b"nope").is_err());
    }
}
