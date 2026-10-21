//! Pacchetti plugin Mosaikit (`.mskp` v3).
//!
//! Un pacchetto e' uno zip con `plugin.toml`, `logic.wasm` (facoltativo),
//! `ui/**`, `migrations/**`, piu' `MANIFEST.sha256` (hash di ogni file) e
//! `SIGNATURE` (firma ed25519 di `MANIFEST.sha256`). Vedi `docs/architettura.md` §8.5.

mod collect;
mod manifest;
mod package;
mod signing;
mod version;

pub use collect::collect_plugin_dir;
pub use manifest::{
    is_plugin_id, schema_name, Contribution, FieldDecl, FieldKind, KpiDecl, Manifest, Permissions, Requires,
    ResourceDecl, UiDecl, ABI_VERSION,
};
pub use package::{
    pack, package_sha256, parse_migration_name, Package, MAX_FILE_BYTES, MAX_PACKAGE_BYTES, WASM_FILE,
};
pub use signing::{
    generate_key, public_key_b64, signing_key_from_b64, signing_key_to_b64, Signature, TrustedKeys,
};
pub use version::Version;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("manifest non valido: {0}")]
    Manifest(String),
    #[error("pacchetto non valido: {0}")]
    Package(String),
    #[error("firma non valida: {0}")]
    Signature(String),
    #[error("pacchetto non firmato")]
    Unsigned,
    #[error("chiave dell'editore non fidata: {0}")]
    UntrustedKey(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Identificatore SQL sicuro: minuscole, cifre e `_`, inizia con una lettera.
pub fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some('a'..='z'))
        && s.len() <= 48
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Percorso relativo sicuro dentro un pacchetto: niente assoluti, `..`, `\`.
pub fn is_safe_path(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && !p.contains('\\')
        && !p.contains(':')
        && p.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}
