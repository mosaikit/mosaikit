//! Formato pacchetto .mskp (Mosaikit Package):
//!   v1 (legacy): "MSKP" | u32 LE len(manifest) | manifest JSON | wasm bytes
//!   v2:          "MSKP" | u32 LE len(manifest) | manifest | u32 LE len(wasm) | wasm | ui.js
//! Il reader e' tollerante: se non trova la doppia lunghezza tratta tutto
//! il resto come wasm (ui vuota). I plugin senza UI restano validi.
//!
//! ui.js = bundle JavaScript trusted del plugin (modello GeoLibre): l'host
//! lo serve e lo esegue con accesso all'API dell'applicazione. Il plugin e'
//! quindi "trusted code": la sicurezza e' affidata alla cura del registry,
//! esattamente come dichiarato da GeoLibre per i suoi plugin JS.

use crate::json::Json;
use crate::manifest::Manifest;

pub const MAGIC: &[u8; 4] = b"MSKP";

pub struct Package {
    pub manifest: Manifest,
    pub wasm: Vec<u8>,
    pub ui: Vec<u8>,
}

pub fn pack(manifest_json: &str, wasm: &[u8]) -> Vec<u8> {
    pack_with_ui(manifest_json, wasm, &[])
}

pub fn pack_with_ui(manifest_json: &str, wasm: &[u8], ui: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(manifest_json.len() as u32).to_le_bytes());
    out.extend_from_slice(manifest_json.as_bytes());
    if !ui.is_empty() {
        out.extend_from_slice(&(wasm.len() as u32).to_le_bytes());
        out.extend_from_slice(wasm);
        out.extend_from_slice(ui);
    } else {
        out.extend_from_slice(wasm);
    }
    out
}

pub fn parse(bytes: &[u8]) -> Result<Package, String> {
    if bytes.len() < 8 || &bytes[..4] != MAGIC {
        return Err("pacchetto non valido: magic MSKP mancante".into());
    }
    let mlen = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let mstart: usize = 8;
    let mend = mstart.checked_add(mlen).ok_or("manifest length overflow")?;
    if bytes.len() < mend { return Err("pacchetto troncato (manifest)".into()); }
    let mjson = std::str::from_utf8(&bytes[mstart..mend]).map_err(|e| e.to_string())?;
    let manifest = Manifest::from_json(&Json::parse(mjson)?)?;
    let rest = &bytes[mend..];

    // v2? u32 wlen valido davanti
    let (wasm, ui) = if rest.len() >= 4 {
        let wlen = u32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]]) as usize;
        if rest.len() >= 4 + wlen {
            (rest[4..4 + wlen].to_vec(), rest[4 + wlen..].to_vec())
        } else {
            (rest.to_vec(), Vec::new())
        }
    } else {
        (rest.to_vec(), Vec::new())
    };

    if wasm.len() < 8 || &wasm[..4] != b"\0asm" {
        return Err("WASM non valido: magic mancante".into());
    }
    Ok(Package { manifest, wasm, ui })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::minimal_guest_module;

    const MJ: &str = r#"{"id":"com.x.y","name":"Y","version":"0.1.0","min_kernel":"0.1.0","permissions":[],"contribution":{"icon":"X","label":"Y","resource":{"name":"ys","fields":[]}}}"#;

    #[test]
    fn roundtrip_v1_e_v2() {
        let wasm = minimal_guest_module();
        // v1: niente ui
        let p1 = parse(&pack(MJ, &wasm)).unwrap();
        assert_eq!(p1.manifest.id, "com.x.y");
        assert_eq!(p1.wasm, wasm);
        assert!(p1.ui.is_empty());
        // v2: con ui.js
        let p2 = parse(&pack_with_ui(MJ, &wasm, b"console.log('ui')")).unwrap();
        assert_eq!(p2.wasm, wasm);
        assert_eq!(p2.ui, b"console.log('ui')");
    }
}
