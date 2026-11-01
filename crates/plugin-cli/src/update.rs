//! Signed kit archives and `self-update` (phase 7 of docs/plugin-devkit-plan.md).
//!
//! A release of the kit is, per platform, one archive (`mosaikit-devkit-<version>-<platform>.zip` on Windows,
//! `.tar.gz` elsewhere), a `SHA256SUMS` file and a signature of it (`SHA256SUMS.sig`: the JSON of a package
//! signature, ed25519, made with the key of the official packages). Every archive has its own `.sig` too.
//! `self-update` downloads a release (or reads a folder with `--from-dir`), checks the signature of `SHA256SUMS`
//! against a trusted key, then the hash of the archive, shows the breaking changes of the release and only then
//! replaces the kit. Nothing is installed from a download that did not verify.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use ed25519_dalek::SigningKey;
use mosaikit_mskp::{Signature, TrustedKeys, Version};
use sha2::{Digest, Sha256};

use crate::util::{exe, run};

/// GitHub repository the kit is released from.
pub const REPO: &str = "mosaikit/mosaikit";
/// Name of the file with the checksums of a release.
pub const SUMS_FILE: &str = "SHA256SUMS";
/// File of a kit folder with the public key that signed it (the key the next update is checked with).
pub const TRUSTED_KEY_FILE: &str = "trusted_key.txt";

/// `windows-x86_64`, `linux-x86_64`, `macos-aarch64`: the platform of this executable.
pub fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// Name of the archive of a version for a platform.
pub fn archive_name(version: &str, platform: &str) -> String {
    let ext = if platform.starts_with("windows") { "zip" } else { "tar.gz" };
    format!("mosaikit-devkit-{version}-{platform}.{ext}")
}

/// The version inside the name of an archive of `platform`.
pub fn version_of_archive(name: &str, platform: &str) -> Option<String> {
    let rest = name.strip_prefix("mosaikit-devkit-")?;
    let v = rest
        .strip_suffix(&format!("-{platform}.zip"))
        .or_else(|| rest.strip_suffix(&format!("-{platform}.tar.gz")))?;
    Version::parse(v).map(|_| v.to_string())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Signature (JSON of `{key, sig}`) of `data`.
pub fn sign_bytes(key: &SigningKey, data: &[u8]) -> String {
    serde_json::to_string(&Signature::sign(key, data)).expect("signature serializes") + "\n"
}

/// Checks a signature (JSON) of `data` and that its key is trusted. Returns the key (base64).
pub fn verify_bytes(sig_json: &str, data: &[u8], trusted: &TrustedKeys) -> Result<String> {
    let sig: Signature = serde_json::from_str(sig_json).context("the signature file is not valid")?;
    let key = sig.verify(data)?;
    if !trusted.contains(&key) {
        bail!("signed with a key that is not trusted ({}): the download is refused", sig.key);
    }
    Ok(sig.key)
}

/// `SHA256SUMS` text from (hash, file name) pairs, sorted by name.
pub fn sums_text(entries: &[(String, String)]) -> String {
    let mut e = entries.to_vec();
    e.sort_by(|a, b| a.1.cmp(&b.1));
    e.iter().map(|(h, n)| format!("{h}  {n}\n")).collect()
}

/// (hash, file name) pairs of a `SHA256SUMS` text.
pub fn parse_sums(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let (h, n) = l.split_once(char::is_whitespace)?;
            let n = n.trim().trim_start_matches('*');
            (h.len() == 64 && !n.is_empty()).then(|| (h.to_lowercase(), n.to_string()))
        })
        .collect()
}

/// The whole check of a download: the signature of the sums against the trusted keys, the archive listed in
/// them, and its hash.
pub fn check_download(
    name: &str,
    archive: &[u8],
    sums: &str,
    sums_sig: &str,
    trusted: &TrustedKeys,
) -> Result<String> {
    let key = verify_bytes(sums_sig, sums.as_bytes(), trusted).context("SHA256SUMS")?;
    let listed = parse_sums(sums)
        .into_iter()
        .find(|(_, n)| n == name)
        .ok_or_else(|| anyhow!("{name} is not in SHA256SUMS"))?;
    if listed.0 != sha256_hex(archive) {
        bail!("{name}: the hash does not match SHA256SUMS (corrupted or tampered download)");
    }
    Ok(key)
}

/// The text under a heading «Breaking changes» (any level) up to the next heading; None when the section is
/// missing or says there is nothing («None.»).
pub fn breaking_section(body: &str) -> Option<String> {
    let mut found = false;
    let mut out: Vec<&str> = Vec::new();
    for l in body.lines() {
        let t = l.trim();
        if t.starts_with('#') {
            if found {
                break;
            }
            found = t.trim_start_matches('#').trim().eq_ignore_ascii_case("breaking changes");
            continue;
        }
        if found {
            out.push(l);
        }
    }
    let text = out.join("\n").trim().to_string();
    let plain = text.trim_matches(|c: char| c == '.' || c == '-' || c.is_whitespace()).to_lowercase();
    (found && !plain.is_empty() && plain != "none" && plain != "nothing").then_some(text)
}

/// Whether an update needs an explicit yes: a new major version, or a release that lists breaking changes.
pub fn needs_ack(current: &str, new: &str, breaking: Option<&str>) -> bool {
    let major = |v: &str| Version::parse_lenient(v).map(|v| v.0);
    breaking.is_some() || major(new) > major(current)
}

/// A release as the GitHub API gives it.
#[derive(Debug, Clone)]
pub struct Release {
    pub version: String,
    pub body: String,
    pub assets: Vec<(String, String)>,
}

pub fn parse_release(json: &str) -> Result<Release> {
    let v: serde_json::Value = serde_json::from_str(json).context("the release is not valid JSON")?;
    let tag = v.get("tag_name").and_then(|t| t.as_str()).ok_or_else(|| anyhow!("the release has no tag"))?;
    let version = tag.trim_start_matches('v').to_string();
    let assets = v
        .get("assets")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    Some((
                        x.get("name")?.as_str()?.to_string(),
                        x.get("browser_download_url")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Release {
        version,
        body: v.get("body").and_then(|b| b.as_str()).unwrap_or_default().to_string(),
        assets,
    })
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// only say whether a newer version exists
    pub check: bool,
    /// a given version instead of the latest
    pub version: Option<String>,
    pub repo: Option<String>,
    /// a folder with the files of a release (archive, SHA256SUMS, SHA256SUMS.sig) instead of GitHub
    pub from_dir: Option<PathBuf>,
    /// public key (base64) or a file that holds it; default: `trusted_key.txt` of the installed kit
    pub trusted_key: Option<String>,
    /// accept the breaking changes of the release
    pub yes: bool,
    /// the kit folder to update (default: the parent of the folder of this executable)
    pub kit: Option<PathBuf>,
}

fn client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .user_agent(format!("mosaikit-plugin/{}", env!("CARGO_PKG_VERSION")))
        .build()?)
}

fn get(c: &reqwest::blocking::Client, url: &str) -> Result<Vec<u8>> {
    let r = c.get(url).send().with_context(|| format!("downloading {url}"))?;
    if !r.status().is_success() {
        bail!("{url}: the server answered {}", r.status());
    }
    Ok(r.bytes()?.to_vec())
}

/// The kit folder this executable belongs to: `<kit>/bin/mosaikit-plugin`.
fn kit_folder(o: &Options) -> Result<PathBuf> {
    if let Some(k) = &o.kit {
        return Ok(k.clone());
    }
    let me = std::env::current_exe()?;
    let bin = me.parent().ok_or_else(|| anyhow!("no folder for the executable"))?;
    let kit = bin.parent().ok_or_else(|| anyhow!("no kit folder"))?;
    if bin.file_name().is_some_and(|n| n == "bin") && kit.join("VERSION").is_file() {
        return Ok(kit.to_path_buf());
    }
    bail!(
        "this executable is not part of a Mosaikit kit folder ({} has no bin/ next to a VERSION file); if you installed it with cargo, update it with `cargo install mosaikit-plugin-cli --force`, otherwise pass --kit <folder>",
        bin.display()
    )
}

fn trusted_keys(o: &Options, kit: Option<&Path>) -> Result<TrustedKeys> {
    let raw = if let Some(k) = &o.trusted_key {
        let p = Path::new(k);
        if p.is_file() {
            std::fs::read_to_string(p)?
        } else {
            k.clone()
        }
    } else if let Some(k) = std::env::var("MOSAIKIT_KIT_KEY").ok().filter(|k| !k.trim().is_empty()) {
        k
    } else if let Some(f) = kit.map(|k| k.join(TRUSTED_KEY_FILE)).filter(|f| f.is_file()) {
        std::fs::read_to_string(f)?
    } else {
        bail!("no trusted key: pass --trusted-key <key or file> (the public key of the Mosaikit releases) or set MOSAIKIT_KIT_KEY")
    };
    let keys: Vec<&str> = raw.split_whitespace().collect();
    Ok(TrustedKeys::from_b64(&keys)?)
}

/// Files of the release: (version, archive bytes, sums, sums signature, release notes).
fn fetch(o: &Options, platform: &str) -> Result<(String, String, Vec<u8>, String, String, String)> {
    if let Some(d) = &o.from_dir {
        let mut best: Option<(Version, String, String)> = None;
        for e in std::fs::read_dir(d).with_context(|| format!("reading {}", d.display()))?.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(v) = version_of_archive(&name, platform) {
                let key = Version::parse(&v).expect("checked");
                let wanted = o.version.as_deref().map(|w| w.trim_start_matches('v') == v).unwrap_or(true);
                if wanted && best.as_ref().is_none_or(|b| key > b.0) {
                    best = Some((key, v, name));
                }
            }
        }
        let (_, version, name) =
            best.ok_or_else(|| anyhow!("no archive for {platform} in {}", d.display()))?;
        let read =
            |f: &str| std::fs::read_to_string(d.join(f)).with_context(|| format!("{f} in {}", d.display()));
        let notes = std::fs::read_to_string(d.join("RELEASE-NOTES.md")).unwrap_or_default();
        return Ok((
            version,
            name.clone(),
            std::fs::read(d.join(&name))?,
            read(SUMS_FILE)?,
            read("SHA256SUMS.sig")?,
            notes,
        ));
    }
    let c = client()?;
    let repo = o.repo.clone().unwrap_or_else(|| REPO.to_string());
    let api = match &o.version {
        Some(v) => {
            format!("https://api.github.com/repos/{repo}/releases/tags/v{}", v.trim_start_matches('v'))
        }
        None => format!("https://api.github.com/repos/{repo}/releases/latest"),
    };
    let rel = parse_release(&String::from_utf8(get(&c, &api)?)?)?;
    let name = archive_name(&rel.version, platform);
    let url = |n: &str| {
        rel.assets
            .iter()
            .find(|(a, _)| a == n)
            .map(|(_, u)| u.clone())
            .ok_or_else(|| anyhow!("release {} has no {n} (is there a kit for {platform}?)", rel.version))
    };
    let sums = String::from_utf8(get(&c, &url(SUMS_FILE)?)?)?;
    let sig = String::from_utf8(get(&c, &url("SHA256SUMS.sig")?)?)?;
    let archive = if o.check { Vec::new() } else { get(&c, &url(&name)?)? };
    Ok((rel.version.clone(), name, archive, sums, sig, rel.body))
}

/// Replaces the files of `kit` with those of the unpacked archive in `src` (the folder `mosaikit-devkit-...`).
/// A running executable is renamed aside first (Windows will not overwrite it).
pub fn install_kit(src: &Path, kit: &Path) -> Result<()> {
    for e in std::fs::read_dir(src)?.flatten() {
        let from = e.path();
        let to = kit.join(e.file_name());
        if from.is_dir() {
            if e.file_name() == "bin" {
                std::fs::create_dir_all(&to)?;
                for f in std::fs::read_dir(&from)?.flatten() {
                    let dest = to.join(f.file_name());
                    if dest.exists() {
                        let old = dest.with_extension("old");
                        let _ = std::fs::remove_file(&old);
                        std::fs::rename(&dest, &old)
                            .with_context(|| format!("replacing {}", dest.display()))?;
                    }
                    std::fs::copy(f.path(), &dest)?;
                }
            } else {
                if to.exists() {
                    std::fs::remove_dir_all(&to)?;
                }
                copy_tree(&from, &to)?;
            }
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)?.flatten() {
        let (f, t) = (e.path(), to.join(e.file_name()));
        if f.is_dir() {
            copy_tree(&f, &t)?;
        } else {
            std::fs::copy(&f, &t)?;
        }
    }
    Ok(())
}

/// `tar` that reads zip and tar.gz. On Windows it is the `tar.exe` of the system (bsdtar): the GNU tar that comes with
/// Git reads a path with a drive letter as a remote host.
pub fn tar() -> Command {
    if cfg!(windows) {
        if let Some(sys) = std::env::var_os("SystemRoot") {
            let p = PathBuf::from(sys).join("System32").join("tar.exe");
            if p.is_file() {
                return Command::new(p);
            }
        }
    }
    Command::new("tar")
}

/// Unpacks an archive (zip or tar.gz) into `dest`.
fn unpack(archive: &Path, dest: &Path) -> Result<()> {
    std::fs::create_dir_all(dest)?;
    run(tar().arg("-xf").arg(archive).arg("-C").arg(dest))
}

/// `self-update`. Returns the version now installed (or the newer one found with `check`), None when up to date.
pub fn self_update(o: &Options) -> Result<Option<String>> {
    let current = env!("CARGO_PKG_VERSION");
    let platform = platform();
    let kit = if o.check && o.kit.is_none() { kit_folder(o).ok() } else { Some(kit_folder(o)?) };
    let trusted = trusted_keys(o, kit.as_deref())?;
    let (version, name, archive, sums, sig, notes) = fetch(o, &platform)?;
    // the signature of the sums is checked before anything else of the release is believed
    let key = verify_bytes(&sig, sums.as_bytes(), &trusted).context("SHA256SUMS")?;
    let newer = Version::parse_lenient(&version) > Version::parse_lenient(current);
    if o.version.is_none() && !newer {
        println!("mosaikit-plugin {current} is up to date (latest release: {version})");
        return Ok(None);
    }
    let breaking = breaking_section(&notes);
    println!("release {version} (installed: {current}), signed by {key}");
    match &breaking {
        Some(b) => println!("\nBreaking changes in this release:\n{b}\n"),
        None => println!("no breaking changes listed in the release notes"),
    }
    if o.check {
        println!("update with: mosaikit-plugin self-update");
        return Ok(Some(version));
    }
    if needs_ack(current, &version, breaking.as_deref()) && !o.yes {
        bail!("this update is a new major version or lists breaking changes: read them above and run again with --yes");
    }
    check_download(&name, &archive, &sums, &sig, &trusted)?;
    let kit = kit.expect("kit folder known when installing");
    let work = std::env::temp_dir().join(format!("mosaikit-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work)?;
    let file = work.join(&name);
    std::fs::write(&file, &archive)?;
    let out = work.join("unpacked");
    unpack(&file, &out)?;
    let inner = std::fs::read_dir(&out)?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_dir())
        .ok_or_else(|| anyhow!("the archive is empty"))?;
    if !inner.join("bin").join(exe("mosaikit-plugin")).is_file() {
        bail!("the archive has no bin/{}: not a kit", exe("mosaikit-plugin"));
    }
    install_kit(&inner, &kit)?;
    let _ = std::fs::remove_dir_all(&work);
    println!("kit updated to {version} in {}", kit.display());
    Ok(Some(version))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> SigningKey {
        mosaikit_mskp::generate_key()
    }
    fn trusted(k: &SigningKey) -> TrustedKeys {
        TrustedKeys::from_b64(&[mosaikit_mskp::public_key_b64(k)]).unwrap()
    }

    #[test]
    fn names_and_versions_round_trip() {
        assert_eq!(archive_name("1.2.3", "windows-x86_64"), "mosaikit-devkit-1.2.3-windows-x86_64.zip");
        assert_eq!(archive_name("1.2.3", "linux-x86_64"), "mosaikit-devkit-1.2.3-linux-x86_64.tar.gz");
        assert_eq!(
            version_of_archive("mosaikit-devkit-1.2.3-linux-x86_64.tar.gz", "linux-x86_64").as_deref(),
            Some("1.2.3")
        );
        assert_eq!(version_of_archive("mosaikit-devkit-1.2.3-linux-x86_64.tar.gz", "macos-aarch64"), None);
    }

    #[test]
    fn sums_parse_and_check() {
        let k = key();
        let archive = b"archive bytes";
        let sums = sums_text(&[(sha256_hex(archive), "a.zip".into()), (sha256_hex(b"x"), "b.zip".into())]);
        let sig = sign_bytes(&k, sums.as_bytes());
        assert!(check_download("a.zip", archive, &sums, &sig, &trusted(&k)).is_ok());
        let e = check_download("a.zip", b"other", &sums, &sig, &trusted(&k)).unwrap_err();
        assert!(e.to_string().contains("hash does not match"));
        let e = check_download("c.zip", archive, &sums, &sig, &trusted(&k)).unwrap_err();
        assert!(e.to_string().contains("not in SHA256SUMS"));
    }

    #[test]
    fn a_tampered_sums_file_or_another_key_is_refused() {
        let (k, other) = (key(), key());
        let sums = sums_text(&[(sha256_hex(b"a"), "a.zip".into())]);
        let sig = sign_bytes(&k, sums.as_bytes());
        let tampered = sums.replace("a.zip", "b.zip");
        assert!(check_download("b.zip", b"a", &tampered, &sig, &trusted(&k)).is_err());
        let e = check_download("a.zip", b"a", &sums, &sig, &trusted(&other)).unwrap_err();
        assert!(format!("{e:#}").contains("not trusted"), "{e:#}");
    }

    #[test]
    fn the_breaking_section_is_found_or_absent() {
        let body = "## Changes\n- x\n\n### Breaking changes\n\n- the `foo` command is gone\n\n## Other\ntext";
        assert_eq!(breaking_section(body).as_deref(), Some("- the `foo` command is gone"));
        assert_eq!(breaking_section("## Breaking changes\n\nNone.\n"), None);
        assert_eq!(breaking_section("## Changes\n- x"), None);
    }

    #[test]
    fn a_major_version_or_breaking_changes_need_a_yes() {
        assert!(!needs_ack("1.0.0", "1.1.0", None));
        assert!(needs_ack("1.0.0", "2.0.0", None));
        assert!(needs_ack("1.0.0", "1.0.1", Some("- x")));
    }

    #[test]
    fn a_release_json_gives_version_and_assets() {
        let r = parse_release(
            r#"{"tag_name":"v1.4.0","body":"notes","assets":[{"name":"SHA256SUMS","browser_download_url":"https://x/s"}]}"#,
        )
        .unwrap();
        assert_eq!((r.version.as_str(), r.body.as_str()), ("1.4.0", "notes"));
        assert_eq!(r.assets, vec![("SHA256SUMS".to_string(), "https://x/s".to_string())]);
    }

    #[test]
    fn install_replaces_the_files_of_the_kit() {
        let d = tempfile::tempdir().unwrap();
        let (src, kit) = (d.path().join("src"), d.path().join("kit"));
        for (root, text) in [(&src, "new"), (&kit, "old")] {
            std::fs::create_dir_all(root.join("bin")).unwrap();
            std::fs::create_dir_all(root.join("docs")).unwrap();
            std::fs::write(root.join("bin").join("tool"), text).unwrap();
            std::fs::write(root.join("docs").join(format!("{text}.md")), text).unwrap();
            std::fs::write(root.join("VERSION"), text).unwrap();
        }
        install_kit(&src, &kit).unwrap();
        assert_eq!(std::fs::read_to_string(kit.join("bin").join("tool")).unwrap(), "new");
        assert_eq!(std::fs::read_to_string(kit.join("bin").join("tool.old")).unwrap(), "old");
        assert!(kit.join("docs").join("new.md").is_file() && !kit.join("docs").join("old.md").exists());
        assert_eq!(std::fs::read_to_string(kit.join("VERSION")).unwrap(), "new");
    }
}
