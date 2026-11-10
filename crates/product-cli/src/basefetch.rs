//! `--base 1.0.1`: the desktop kit of a released platform, downloaded once into a cache of the user, checked against
//! the signed `SHA256SUMS` of its release, and unpacked. A path (a folder or a `.zip`) is used as it is.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use mosaikit_mskp::{TrustedKeys, Version};
use mosaikit_plugin_cli::update;

/// The version a `--base` value names (`1.0.1` or `v1.0.1`), when it is not a path that exists.
pub fn version_of(base: &Path) -> Option<String> {
    if base.exists() {
        return None;
    }
    let s = base.to_str()?.trim_start_matches('v');
    Version::parse(s).map(|_| s.to_string())
}

/// The cache of the downloads: `MOSAIKIT_CACHE`, else the folder of caches of the system.
pub fn cache_dir() -> Result<PathBuf> {
    if let Some(c) = std::env::var_os("MOSAIKIT_CACHE").filter(|c| !c.is_empty()) {
        return Ok(PathBuf::from(c));
    }
    let home = |v: &str| std::env::var_os(v).map(PathBuf::from);
    let dir = if cfg!(windows) {
        home("LOCALAPPDATA").map(|p| p.join("mosaikit"))
    } else if cfg!(target_os = "macos") {
        home("HOME").map(|p| p.join("Library").join("Caches").join("mosaikit"))
    } else {
        home("XDG_CACHE_HOME")
            .map(|p| p.join("mosaikit"))
            .or_else(|| home("HOME").map(|p| p.join(".cache").join("mosaikit")))
    };
    dir.ok_or_else(|| anyhow!("no folder for the cache: set MOSAIKIT_CACHE"))
}

/// The base when `--base` is not given: the version of this tool, which is the version of the Mosaikit it came with.
pub fn this_version() -> PathBuf {
    PathBuf::from(env!("CARGO_PKG_VERSION"))
}

/// A `--base`: the path as it is, or the cached desktop kit of a version (downloaded when it is not there yet).
pub fn resolve(base: PathBuf) -> Result<PathBuf> {
    match version_of(&base) {
        Some(v) => ensure(&v, &cache_dir()?),
        None => Ok(base),
    }
}

pub fn resolve_opt(base: Option<PathBuf>) -> Result<Option<PathBuf>> {
    base.map(resolve).transpose()
}

/// Name of the desktop kit of a version in its release.
pub fn archive_name(version: &str) -> String {
    format!("mosaikit-{version}-desktop-windows-x86_64.zip")
}

/// The public key of the Mosaikit releases: `MOSAIKIT_KIT_KEY`, else `trusted_key.txt` of the kit this tool is part of.
fn trusted_keys() -> Result<TrustedKeys> {
    let raw = if let Some(k) = std::env::var("MOSAIKIT_KIT_KEY").ok().filter(|k| !k.trim().is_empty()) {
        k
    } else {
        let exe = std::env::current_exe()?;
        let kit = std::env::var_os("MOSAIKIT_KIT")
            .map(PathBuf::from)
            .or_else(|| exe.parent().and_then(Path::parent).map(Path::to_path_buf));
        let file = kit
            .map(|k| k.join(update::TRUSTED_KEY_FILE))
            .filter(|f| f.is_file())
            .ok_or_else(|| anyhow!("no trusted key to check the download: set MOSAIKIT_KIT_KEY to the public key of the Mosaikit releases, or run the tool from the kit (it has trusted_key.txt)"))?;
        std::fs::read_to_string(file)?
    };
    let keys: Vec<&str> = raw.split_whitespace().collect();
    Ok(TrustedKeys::from_b64(&keys)?)
}

/// The folder of the desktop kit of `version` under `cache`, downloaded and checked when needed.
pub fn ensure(version: &str, cache: &Path) -> Result<PathBuf> {
    let dir = cache.join("base").join(version);
    let ready = dir.join("kit");
    if dir.join(".verified").is_file() && ready.is_dir() {
        return Ok(ready);
    }
    let name = archive_name(version);
    eprintln!("downloading the desktop kit {version} of the base ({name})");
    let c = update::client()?;
    let api = format!("https://api.github.com/repos/{}/releases/tags/v{version}", update::REPO);
    let rel = update::parse_release(&String::from_utf8(update::get(&c, &api)?)?)?;
    let url = |n: &str| {
        rel.assets
            .iter()
            .find(|(a, _)| a == n)
            .map(|(_, u)| u.clone())
            .ok_or_else(|| anyhow!("the release v{version} has no {n}"))
    };
    let sums = String::from_utf8(update::get(&c, &url(update::SUMS_FILE)?)?)?;
    if !update::parse_sums(&sums).iter().any(|(_, n)| *n == name) {
        bail!(
            "{name} is not in the signed SHA256SUMS of the release v{version}, so it cannot be checked (releases before 1.0.2 do not list it). \
             Download it from the release page and give --base the zip or its folder"
        );
    }
    let sig = String::from_utf8(update::get(&c, &url("SHA256SUMS.sig")?)?)?;
    let zip = update::get(&c, &url(&name)?)?;
    let key = update::check_download(&name, &zip, &sums, &sig, &trusted_keys()?)?;
    eprintln!("signature and hash checked (key {key})");
    let tmp = dir.join("unpack");
    if dir.exists() {
        std::fs::remove_dir_all(&dir).with_context(|| format!("clearing {}", dir.display()))?;
    }
    std::fs::create_dir_all(&tmp)?;
    let file = dir.join(&name);
    std::fs::write(&file, &zip)?;
    let top = extract_zip(&file, &tmp)?;
    std::fs::rename(&top, &ready)?;
    std::fs::remove_dir_all(&tmp).ok();
    std::fs::remove_file(&file).ok();
    std::fs::write(dir.join(".verified"), update::sha256_hex(&zip))?;
    eprintln!("the desktop kit is in {}", ready.display());
    Ok(ready)
}

/// Unpacks a `.zip` into `target`; a folder with a single top folder gives that one.
pub fn extract_zip(zip_file: &Path, target: &Path) -> Result<PathBuf> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(zip_file)?)?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        let Some(rel) = f.enclosed_name() else { continue };
        let dst = target.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&dst)?;
        } else {
            if let Some(p) = dst.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::io::copy(&mut f, &mut std::fs::File::create(&dst)?)?;
        }
    }
    let tops: Vec<PathBuf> = std::fs::read_dir(target)?.flatten().map(|e| e.path()).collect();
    Ok(if tops.len() == 1 && tops[0].is_dir() { tops[0].clone() } else { target.to_path_buf() })
}

#[cfg(test)]
mod tests {
    #[test]
    fn without_a_base_it_is_the_version_of_the_tool() {
        assert_eq!(version_of(&this_version()).as_deref(), Some(env!("CARGO_PKG_VERSION")));
    }

    use super::*;

    #[test]
    fn a_version_is_told_from_a_path() {
        let t = tempfile::tempdir().unwrap();
        assert_eq!(version_of(Path::new("1.0.1")).as_deref(), Some("1.0.1"));
        assert_eq!(version_of(Path::new("v1.0.1")).as_deref(), Some("1.0.1"));
        assert_eq!(version_of(Path::new("../mosaikit-1.0.1-desktop")), None);
        assert_eq!(version_of(t.path()), None, "a folder that exists is a path");
    }

    #[test]
    fn a_checked_download_is_used_again_without_the_network() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("base").join("9.9.9");
        std::fs::create_dir_all(dir.join("kit")).unwrap();
        std::fs::write(dir.join(".verified"), "x").unwrap();
        assert_eq!(ensure("9.9.9", t.path()).unwrap(), dir.join("kit"));
    }

    #[test]
    fn a_zip_with_one_top_folder_gives_that_folder() {
        use std::io::Write;
        let t = tempfile::tempdir().unwrap();
        let zip_path = t.path().join("k.zip");
        let mut z = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
        z.start_file("top/mosaikit.exe", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(b"x").unwrap();
        z.finish().unwrap();
        let out = t.path().join("out");
        std::fs::create_dir_all(&out).unwrap();
        assert_eq!(extract_zip(&zip_path, &out).unwrap(), out.join("top"));
    }
}
