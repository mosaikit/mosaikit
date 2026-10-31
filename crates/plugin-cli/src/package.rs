//! Signing keys, `.mskp` packages and the registry `index.json`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use ed25519_dalek::SigningKey;

use crate::project::{wasm_path, Plugin};

/// Where the key of a developer lives when nothing else is said: the user's configuration folder.
pub fn default_key_path() -> PathBuf {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
    };
    base.unwrap_or_else(|| PathBuf::from(".")).join("mosaikit").join("signing.key")
}

/// Signing key: `explicit` file, else `MOSAIKIT_SIGNING_KEY` (base64), `MOSAIKIT_SIGNING_KEY_FILE`, otherwise
/// the development key in `default_path` (created if missing). Returns the key and where it came from.
pub fn signing_key(explicit: Option<&Path>, default_path: &Path) -> Result<(SigningKey, String)> {
    if let Some(f) = explicit {
        let k = std::fs::read_to_string(f).with_context(|| format!("key file {}", f.display()))?;
        return Ok((mosaikit_mskp::signing_key_from_b64(&k)?, format!("key file {}", f.display())));
    }
    if let Some(k) = std::env::var("MOSAIKIT_SIGNING_KEY").ok().filter(|k| !k.trim().is_empty()) {
        return Ok((mosaikit_mskp::signing_key_from_b64(&k)?, "MOSAIKIT_SIGNING_KEY".into()));
    }
    if let Ok(f) = std::env::var("MOSAIKIT_SIGNING_KEY_FILE") {
        if Path::new(&f).is_file() {
            let k = std::fs::read_to_string(&f)?;
            return Ok((mosaikit_mskp::signing_key_from_b64(&k)?, "MOSAIKIT_SIGNING_KEY_FILE".into()));
        }
    }
    if !default_path.is_file() {
        std::fs::create_dir_all(default_path.parent().context("folder of the development key")?)?;
        let k = mosaikit_mskp::generate_key();
        std::fs::write(default_path, mosaikit_mskp::signing_key_to_b64(&k))?;
        eprintln!("created the development key {} (do not commit it)", default_path.display());
    }
    Ok((
        mosaikit_mskp::signing_key_from_b64(&std::fs::read_to_string(default_path)?)?,
        format!("development key {}", default_path.display()),
    ))
}

/// New key pair: (private, public), both base64. With `out` the private key goes to that file (never
/// over an existing one).
pub fn keygen(out: Option<&Path>) -> Result<(String, String)> {
    let k = mosaikit_mskp::generate_key();
    let private = mosaikit_mskp::signing_key_to_b64(&k);
    let public = mosaikit_mskp::public_key_b64(&k);
    if let Some(p) = out {
        if p.exists() {
            bail!("{} already exists: keep it, or delete it to make a new key", p.display());
        }
        if let Some(dir) = p.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(p, &private)?;
    }
    Ok((private, public))
}

/// Creates `<out>/<id>-<version>.mskp`, signed. Returns (path, sha256).
pub fn pack(p: &Plugin, release: bool, key: &SigningKey, out: &Path) -> Result<(PathBuf, String)> {
    let wasm = wasm_path(p, release);
    if let Some(w) = &wasm {
        if !w.is_file() {
            bail!("{}: {} not built (mosaikit-plugin build)", p.id, w.display());
        }
    }
    if p.has_ui && !p.dir.join("ui").join("dist").is_dir() {
        bail!("{}: UI not built (npm run build in {})", p.id, p.dir.join("ui").display());
    }
    let files: BTreeMap<String, Vec<u8>> = mosaikit_mskp::collect_plugin_dir(&p.dir, wasm.as_deref())?;
    let files: BTreeMap<String, Vec<u8>> = files.into_iter().filter(|(k, _)| !k.ends_with(".map")).collect();
    let bytes = mosaikit_mskp::pack(&files, Some(key))?;
    std::fs::create_dir_all(out)?;
    let path = out.join(format!("{}-{}.mskp", p.id, p.version));
    std::fs::write(&path, &bytes)?;
    Ok((path, mosaikit_mskp::package_sha256(&bytes)))
}

/// Signs a package again with another key (or signs an unsigned one). Writes to `out`, else in place.
/// Returns (path, sha256, public key).
pub fn sign(package: &Path, key: &SigningKey, out: Option<&Path>) -> Result<(PathBuf, String, String)> {
    let bytes = std::fs::read(package).with_context(|| package.display().to_string())?;
    let pkg = mosaikit_mskp::Package::read(&bytes)?;
    let signed = mosaikit_mskp::pack(&pkg.files, Some(key))?;
    let dest = out.unwrap_or(package).to_path_buf();
    std::fs::write(&dest, &signed)?;
    Ok((dest, mosaikit_mskp::package_sha256(&signed), mosaikit_mskp::public_key_b64(key)))
}

/// Packages of every plugin + `index.json` of the registry in `out`.
pub fn pack_registry(plugins: &[Plugin], release: bool, out: &Path, key: &SigningKey) -> Result<PathBuf> {
    let pkgs = out.join("plugins");
    let mut entries = Vec::new();
    for p in plugins {
        let (path, sha) = pack(p, release, key, &pkgs)?;
        let manifest =
            mosaikit_mskp::Manifest::from_toml(&std::fs::read_to_string(p.dir.join("plugin.toml"))?)?;
        eprintln!("  {} {} -> {}", p.id, p.version, path.display());
        // what changes in this version: RELEASE.md of the plugin, if it has one
        let notes = std::fs::read_to_string(p.dir.join("RELEASE.md"))
            .map(|s| s.trim().chars().take(4000).collect::<String>())
            .unwrap_or_default();
        entries.push(serde_json::json!({
            "id": p.id,
            "name": manifest.name,
            "description": manifest.description,
            "icon": manifest.contribution.icon,
            "versions": [{
                "version": p.version,
                "file": format!("plugins/{}", path.file_name().expect("file name").to_string_lossy()),
                "sha256": sha,
                "publisher": mosaikit_mskp::public_key_b64(key),
                "notes": notes,
                "kind": manifest.effective_kind().as_str(),
                "extends": manifest.extends.as_ref().map(|e| e.plugin.clone()),
                "mosaikit": manifest.requires.mosaikit,
                "api": manifest.requires.api,
            }],
        }));
    }
    let index = serde_json::json!({ "plugins": entries, "blocklist": [] });
    let path = out.join("index.json");
    std::fs::write(&path, serde_json::to_string_pretty(&index)?)?;
    std::fs::write(out.join("trusted_key.txt"), mosaikit_mskp::public_key_b64(key))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keygen_never_overwrites_a_key() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("k").join("publisher.key");
        let (private, public) = keygen(Some(&f)).unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), private);
        assert_eq!(
            mosaikit_mskp::public_key_b64(&mosaikit_mskp::signing_key_from_b64(&private).unwrap()),
            public
        );
        assert!(keygen(Some(&f)).is_err());
    }

    #[test]
    fn explicit_key_wins_and_default_key_is_created() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("a.key");
        keygen(Some(&f)).unwrap();
        let (_, source) = signing_key(Some(&f), &dir.path().join("none.key")).unwrap();
        assert!(source.starts_with("key file"));
        // no explicit key and no environment: the development key is created once and reused
        if std::env::var_os("MOSAIKIT_SIGNING_KEY").is_none()
            && std::env::var_os("MOSAIKIT_SIGNING_KEY_FILE").is_none()
        {
            let d = dir.path().join("dev").join("signing.key");
            let (k1, _) = signing_key(None, &d).unwrap();
            let (k2, _) = signing_key(None, &d).unwrap();
            assert_eq!(mosaikit_mskp::public_key_b64(&k1), mosaikit_mskp::public_key_b64(&k2));
        }
    }
}
