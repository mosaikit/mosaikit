//! Reading, checking and writing `.mskp` packages.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Write};

use base64::Engine;
use ed25519_dalek::SigningKey;
use sha2::{Digest, Sha256};

use crate::signing::{Signature, TrustedKeys};
use crate::{is_safe_path, Error, Manifest, Result};

pub const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_FILE_BYTES: usize = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
const MAX_FILES: usize = 5000;

const MANIFEST_FILE: &str = "plugin.toml";
const HASHES_FILE: &str = "MANIFEST.sha256";
const SIGNATURE_FILE: &str = "SIGNATURE";
pub const WASM_FILE: &str = "logic.wasm";

/// Package read and checked for integrity (hash of every file).
#[derive(Debug, Clone)]
pub struct Package {
    pub manifest: Manifest,
    pub manifest_toml: String,
    /// files of the package (excluding `MANIFEST.sha256` and `SIGNATURE`)
    pub files: BTreeMap<String, Vec<u8>>,
    pub signature: Option<Signature>,
    hashes: Vec<u8>,
    /// sha256 of the whole `.mskp` file (for the registry)
    pub sha256: String,
}

impl Package {
    pub fn read(bytes: &[u8]) -> Result<Package> {
        let bad = |m: String| Error::Package(m);
        if bytes.len() > MAX_PACKAGE_BYTES {
            return Err(bad(format!("package over {} MB", MAX_PACKAGE_BYTES >> 20)));
        }
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| bad(format!("zip: {e}")))?;
        if zip.len() > MAX_FILES {
            return Err(bad("too many files".into()));
        }
        let mut files = BTreeMap::new();
        let mut total = 0u64;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| bad(format!("zip: {e}")))?;
            if f.is_dir() {
                continue;
            }
            let name = f.name().to_string();
            if !is_safe_path(&name) {
                return Err(bad(format!("unsafe path: {name}")));
            }
            if f.size() > MAX_FILE_BYTES as u64 || total.saturating_add(f.size()) > MAX_TOTAL_BYTES {
                return Err(bad("content beyond the limits".into()));
            }
            // the sizes in the headers are not trusted: the limits apply to what the entries inflate to
            let mut buf = Vec::with_capacity(f.size().min(16 << 20) as usize);
            (&mut f).take(MAX_FILE_BYTES as u64 + 1).read_to_end(&mut buf).map_err(|e| bad(e.to_string()))?;
            total += buf.len() as u64;
            if buf.len() > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES {
                return Err(bad("file beyond the limits".into()));
            }
            if files.insert(name.clone(), buf).is_some() {
                return Err(bad(format!("duplicate file: {name}")));
            }
        }

        let hashes = files.remove(HASHES_FILE).ok_or_else(|| bad(format!("missing {HASHES_FILE}")))?;
        let signature = match files.remove(SIGNATURE_FILE) {
            Some(raw) => Some(serde_json::from_slice(&raw).map_err(|e| Error::Signature(e.to_string()))?),
            None => None,
        };
        check_hashes(&hashes, &files)?;

        let manifest_toml = String::from_utf8(
            files.get(MANIFEST_FILE).ok_or_else(|| bad(format!("missing {MANIFEST_FILE}")))?.clone(),
        )
        .map_err(|_| bad("plugin.toml is not UTF-8".into()))?;
        let manifest = Manifest::from_toml(&manifest_toml)?;
        for name in files.keys() {
            if let Some(m) = name.strip_prefix("migrations/") {
                if parse_migration_name(m).is_none() {
                    return Err(bad(format!("invalid migration name: {name} (expected NNN_name.sql)")));
                }
            }
        }
        Ok(Package { manifest, manifest_toml, files, signature, hashes, sha256: package_sha256(bytes) })
    }

    /// Checks the signature. Returns the key of the publisher (base64) if signed.
    /// Without a signature it is accepted only with `allow_unsigned`.
    pub fn verify(&self, trusted: &TrustedKeys, allow_unsigned: bool) -> Result<Option<String>> {
        match &self.signature {
            None if allow_unsigned => Ok(None),
            None => Err(Error::Unsigned),
            Some(sig) => {
                let vk = sig.verify(&self.hashes)?;
                if trusted.contains(&vk) || allow_unsigned {
                    Ok(Some(sig.key.clone()))
                } else {
                    Err(Error::UntrustedKey(sig.key.clone()))
                }
            }
        }
    }

    pub fn wasm(&self) -> Option<&[u8]> {
        self.files.get(WASM_FILE).map(Vec::as_slice)
    }

    /// Migrations sorted by number: (number, file name, SQL).
    pub fn migrations(&self) -> Result<Vec<(u32, String, String)>> {
        let mut out = Vec::new();
        for (name, data) in &self.files {
            if let Some(m) = name.strip_prefix("migrations/") {
                let n = parse_migration_name(m).ok_or_else(|| Error::Package(format!("migration {name}")))?;
                let sql = String::from_utf8(data.clone())
                    .map_err(|_| Error::Package(format!("{name} is not UTF-8")))?;
                out.push((n, m.to_string(), sql));
            }
        }
        out.sort_by_key(|m| m.0);
        if out.windows(2).any(|w| w[0].0 == w[1].0) {
            return Err(Error::Package("duplicate migration numbers".into()));
        }
        Ok(out)
    }

    /// Files of the UI (paths relative to `ui/`).
    pub fn ui_files(&self) -> impl Iterator<Item = (&str, &[u8])> {
        self.files.iter().filter_map(|(k, v)| k.strip_prefix("ui/").map(|p| (p, v.as_slice())))
    }
}

/// `001_init.sql` -> 1
pub fn parse_migration_name(name: &str) -> Option<u32> {
    let stem = name.strip_suffix(".sql")?;
    let (num, rest) = stem.split_once('_')?;
    if num.len() != 3 || rest.is_empty() || name.contains('/') {
        return None;
    }
    num.parse().ok()
}

fn hashes_text(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut out = String::new();
    for (name, data) in files {
        out.push_str(&hex::encode(Sha256::digest(data)));
        out.push_str("  ");
        out.push_str(name);
        out.push('\n');
    }
    out.into_bytes()
}

fn check_hashes(hashes: &[u8], files: &BTreeMap<String, Vec<u8>>) -> Result<()> {
    if hashes != hashes_text(files).as_slice() {
        return Err(Error::Package(
            "MANIFEST.sha256 does not match the files (package altered or incomplete)".into(),
        ));
    }
    Ok(())
}

pub fn package_sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Creates a package from the files (relative paths). With `key` it adds the signature.
/// The zip is deterministic: same files, same bytes.
pub fn pack(files: &BTreeMap<String, Vec<u8>>, key: Option<&SigningKey>) -> Result<Vec<u8>> {
    if !files.contains_key(MANIFEST_FILE) {
        return Err(Error::Package("missing plugin.toml".into()));
    }
    for name in files.keys() {
        if !is_safe_path(name) || name == HASHES_FILE || name == SIGNATURE_FILE {
            return Err(Error::Package(format!("file name not allowed: {name}")));
        }
    }
    let manifest = std::str::from_utf8(&files[MANIFEST_FILE])
        .map_err(|_| Error::Package("plugin.toml is not UTF-8".into()))?;
    Manifest::from_toml(manifest)?;

    let hashes = hashes_text(files);
    let mut all: BTreeMap<&str, Vec<u8>> = files.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
    all.insert(HASHES_FILE, hashes.clone());
    if let Some(k) = key {
        let sig = Signature::sign(k, &hashes);
        all.insert(
            SIGNATURE_FILE,
            serde_json::to_vec_pretty(&sig).map_err(|e| Error::Package(e.to_string()))?,
        );
    }

    let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(zip::DateTime::default());
    for (name, data) in all {
        w.start_file(name, opts).map_err(|e| Error::Package(e.to_string()))?;
        w.write_all(&data).map_err(|e| Error::Package(e.to_string()))?;
    }
    Ok(w.finish().map_err(|e| Error::Package(e.to_string()))?.into_inner())
}

#[allow(dead_code)]
fn b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signing::{generate_key, public_key_b64};

    const TOML: &str = r#"
id = "com.test.demo"
name = "Demo"
version = "1.0.0"
[contribution]
icon = "x"
label = "Demo"
"#;

    fn files() -> BTreeMap<String, Vec<u8>> {
        let mut f = BTreeMap::new();
        f.insert("plugin.toml".to_string(), TOML.as_bytes().to_vec());
        f.insert("logic.wasm".to_string(), b"\0asm\x01\0\0\0".to_vec());
        f.insert("ui/index.html".to_string(), b"<h1>hello</h1>".to_vec());
        f.insert(
            "migrations/001_init.sql".to_string(),
            b"create table t (resource_id uuid not null, tenant_id uuid not null);".to_vec(),
        );
        f
    }

    #[test]
    fn signed_and_verified() {
        let key = generate_key();
        let bytes = pack(&files(), Some(&key)).unwrap();
        let pkg = Package::read(&bytes).unwrap();
        assert_eq!(pkg.manifest.id, "com.test.demo");
        assert_eq!(pkg.wasm().unwrap(), b"\0asm\x01\0\0\0");
        assert_eq!(pkg.migrations().unwrap()[0].0, 1);
        assert_eq!(pkg.ui_files().count(), 1);
        let trusted = TrustedKeys::from_b64(&[public_key_b64(&key)]).unwrap();
        assert_eq!(pkg.verify(&trusted, false).unwrap(), Some(public_key_b64(&key)));
        // deterministic
        assert_eq!(bytes, pack(&files(), Some(&key)).unwrap());
    }

    #[test]
    fn untrusted_key_and_unsigned_package() {
        let key = generate_key();
        let other = generate_key();
        let trusted = TrustedKeys::from_b64(&[public_key_b64(&other)]).unwrap();
        let signed = Package::read(&pack(&files(), Some(&key)).unwrap()).unwrap();
        assert!(matches!(signed.verify(&trusted, false), Err(Error::UntrustedKey(_))));
        let unsigned = Package::read(&pack(&files(), None).unwrap()).unwrap();
        assert!(matches!(unsigned.verify(&trusted, false), Err(Error::Unsigned)));
        assert_eq!(unsigned.verify(&trusted, true).unwrap(), None);
    }

    /// Rewrites the zip replacing/adding files without updating the hashes.
    fn tamper(bytes: &[u8], name: &str, data: Option<&[u8]>) -> Vec<u8> {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default();
        let mut replaced = false;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).unwrap();
            let fname = f.name().to_string();
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).unwrap();
            if fname == name {
                replaced = true;
                if let Some(d) = data {
                    buf = d.to_vec();
                } else {
                    continue;
                }
            }
            w.start_file(fname, opts).unwrap();
            w.write_all(&buf).unwrap();
        }
        if !replaced {
            w.start_file(name, opts).unwrap();
            w.write_all(data.unwrap()).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn tampering_refused() {
        let key = generate_key();
        let bytes = pack(&files(), Some(&key)).unwrap();
        // changed file
        assert!(Package::read(&tamper(&bytes, "ui/index.html", Some(b"<script>evil()</script>"))).is_err());
        // added file
        assert!(Package::read(&tamper(&bytes, "ui/extra.js", Some(b"x"))).is_err());
        // removed file
        assert!(Package::read(&tamper(&bytes, "logic.wasm", None)).is_err());
        // hashes regenerated but old signature: the signature does not match
        let mut f = files();
        f.insert("ui/index.html".into(), b"evil".to_vec());
        let resigned_hashes = pack(&f, None).unwrap();
        let sig = tamper(&bytes, "SIGNATURE", None);
        let _ = sig;
        let forged = {
            let original_sig = {
                let mut z = zip::ZipArchive::new(Cursor::new(bytes.as_slice())).unwrap();
                let mut s = Vec::new();
                z.by_name("SIGNATURE").unwrap().read_to_end(&mut s).unwrap();
                s
            };
            tamper(&resigned_hashes, "SIGNATURE", Some(&original_sig))
        };
        let pkg = Package::read(&forged).unwrap();
        let trusted = TrustedKeys::from_b64(&[public_key_b64(&key)]).unwrap();
        assert!(matches!(pkg.verify(&trusted, false), Err(Error::Signature(_))));
    }

    #[test]
    fn unsafe_paths_refused() {
        let mut f = files();
        f.insert("../evil".into(), b"x".to_vec());
        assert!(pack(&f, None).is_err());
        let ok = pack(&files(), None).unwrap();
        assert!(Package::read(&tamper(&ok, "../evil.txt", Some(b"x"))).is_err());
    }

    #[test]
    fn migration_names() {
        assert_eq!(parse_migration_name("001_init.sql"), Some(1));
        assert_eq!(parse_migration_name("12_init.sql"), None);
        assert_eq!(parse_migration_name("001_.sql"), None);
        assert_eq!(parse_migration_name("001_init.txt"), None);
    }
}
