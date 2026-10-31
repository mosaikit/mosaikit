//! Mosaikit plugin packages (`.mskp` v3).
//!
//! A package is a zip with `plugin.toml`, `logic.wasm` (optional),
//! `ui/**`, `migrations/**`, `layout/**` (layout plugins), plus `MANIFEST.sha256` (hash of every file) and
//! `SIGNATURE` (ed25519 signature of `MANIFEST.sha256`). See `docs/architecture.md` §8.5.

mod collect;
pub mod language;
pub mod layout;
mod manifest;
mod package;
mod signing;
mod version;

pub use collect::collect_plugin_dir;
pub use manifest::{
    is_media_name, is_plugin_id, is_service_id, schema_name, ConfigDecl, ConfigKind, Contribution,
    ExtActionDecl, ExtFieldDecl, ExtTabDecl, Extends, ExtensionDecl, ExtensionTranslation, FieldDecl,
    FieldKind, Incompatible, KeyScope, KpiDecl, KpiTranslation, Manifest, NavDecl, PermissionTranslation,
    Permissions, PluginKind, Requires, ResourceDecl, ResourceTranslation, ServiceKeyDecl, Translation,
    UiDecl, UserPermission, ABI_VERSION, API_VERSION, STANDARD_PERMISSIONS,
};
pub use package::{
    pack, package_sha256, parse_migration_name, Package, MAX_FILE_BYTES, MAX_PACKAGE_BYTES, WASM_FILE,
};
pub use signing::{
    generate_key, public_key_b64, signing_key_from_b64, signing_key_to_b64, Signature, TrustedKeys,
};
pub use version::{Version, VersionReq};

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

/// Safe relative path inside a package: no absolute paths, `..`, `\`, control characters, nor
/// names Windows treats as devices or rewrites (`CON`, `NUL`, `COM1`, `name.`, `name `…), on every
/// platform, so that a package or an archive behaves the same wherever it is unpacked.
pub fn is_safe_path(p: &str) -> bool {
    !p.is_empty()
        && !p.starts_with('/')
        && !p.contains('\\')
        && !p.contains(':')
        && !p.chars().any(char::is_control)
        && p.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != ".." && is_portable_name(seg))
}

/// A file or folder name that Windows does not reserve nor rewrite.
fn is_portable_name(seg: &str) -> bool {
    if seg.ends_with('.') || seg.ends_with(' ') {
        return false;
    }
    // the device names are reserved with any extension: `nul.txt` is the device `NUL`
    let stem = seg.split('.').next().unwrap_or(seg).trim_end().to_ascii_uppercase();
    let numbered = |prefix: &str| {
        stem.strip_prefix(prefix).is_some_and(|n| {
            matches!(n, "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³")
        })
    };
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || numbered("COM")
        || numbered("LPT");
    !device && !seg.chars().any(|c| matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
}

#[cfg(test)]
mod safe_path_tests {
    use super::is_safe_path;

    #[test]
    fn paths_safe_on_every_platform() {
        for ok in ["index.html", "assets/app.js", "a/b/c.txt", "console.log", "com10.txt", "lpt.txt"] {
            assert!(is_safe_path(ok), "{ok}");
        }
        for bad in [
            "",
            "/etc/passwd",
            "../x",
            "a/../b",
            "a\\b",
            "c:x",
            "a//b",
            "./a",
            "CON",
            "con.txt",
            "a/NUL",
            "nul.tar.gz",
            "Aux",
            "PRN.html",
            "COM1",
            "com9.log",
            "LPT1.txt",
            "COM¹",
            "name.",
            "name ",
            "dir./x",
            "a\u{0}b",
            "a\nb",
            "what?.txt",
            "a*b",
            "x|y",
            "<x>",
        ] {
            assert!(!is_safe_path(bad), "{bad:?}");
        }
    }
}
