//! Mosaikit plugin packages (`.mskp` v3).
//!
//! A package is a zip with `plugin.toml`, `logic.wasm` (optional),
//! `ui/**`, `migrations/**`, plus `MANIFEST.sha256` (hash of every file) and
//! `SIGNATURE` (ed25519 signature of `MANIFEST.sha256`). See `docs/architecture.md` §8.5.

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
    #[error("invalid manifest: {0}")]
    Manifest(String),
    #[error("invalid package: {0}")]
    Package(String),
    #[error("invalid signature: {0}")]
    Signature(String),
    #[error("unsigned package")]
    Unsigned,
    #[error("publisher key not trusted: {0}")]
    UntrustedKey(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Safe SQL identifier: lower case, digits and `_`, starts with a letter.
pub fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some('a'..='z'))
        && s.len() <= 48
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Safe relative path inside a package: no absolute paths, `..`, `\`.
pub fn is_safe_path(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && !p.contains('\\')
        && !p.contains(':')
        && p.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}
