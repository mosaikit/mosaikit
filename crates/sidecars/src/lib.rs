//! `[[sidecars]]` of `distribution.toml` (the model, its checks and the desktop bundle; shared by `xtask` and `mosaikit-product`): extra processes or services a distribution ships next to
//! the kernel (e.g. a native service the plugins call over HTTP).
//!
//! - desktop release: the executables are copied into `sidecars/` and described in `sidecars.toml`,
//!   which the desktop launcher reads (start before the kernel, stop after it);
//! - Docker release: `compose.sidecars.yml` (an override merged through `COMPOSE_FILE` in `.env`);
//! - Kubernetes release: `sidecars.yaml` (a Deployment and a Service per sidecar).
//!
//! A sidecar with a `port` is added to `MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS` (exact `host:port` list
//! read by the kernel): `127.0.0.1:<port>` on the desktop, `<name>:<port>` in containers.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
pub enum Restart {
    #[serde(rename = "never")]
    Never,
    #[default]
    #[serde(rename = "on-failure")]
    OnFailure,
    #[serde(rename = "always")]
    Always,
}

/// `service` (default): a long-running process, supervised and health-checked. `oneshot`: runs to
/// completion before its dependants start (exit code 0 = success); it must be idempotent because it
/// runs once at every start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
pub enum Kind {
    #[default]
    #[serde(rename = "service")]
    Service,
    #[serde(rename = "oneshot")]
    Oneshot,
}

/// A file of the distribution placed where the sidecar expects it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FileSpec {
    /// file relative to the distribution folder
    pub source: String,
    /// desktop: relative to `sidecars/<name>/`; Docker and Kubernetes: absolute path in the container
    pub target: String,
    /// octal permissions, e.g. "0644" (Kubernetes always; desktop on Unix; ignored by Docker bind mounts)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Sidecar {
    /// unique identifier: lower case, digits, '-' (service name in containers)
    pub name: String,
    #[serde(default, skip_serializing_if = "is_service")]
    pub kind: Kind,
    /// files of the distribution placed where the sidecar expects them
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<FileSpec>,
    /// executable, relative to the distribution folder (desktop and bundle)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// environment; a value `env:NAME` is read from the variable NAME of the environment that
    /// starts the sidecar (launcher), from `.env` (Compose) or from the secret (Kubernetes)
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    /// readiness: "/path" (HTTP GET on `port`, 2xx) or "tcp" (connection on `port`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// container image (Docker and Kubernetes releases)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    /// `source:/container/path[:ro]`; source = volume name, or a path (Compose only)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub volumes: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub restart: Restart,
    /// seconds to wait for the health check at start (default 30)
    #[serde(default = "default_timeout")]
    pub start_timeout_secs: u64,
}

fn default_timeout() -> u64 {
    30
}

fn is_service(k: &Kind) -> bool {
    *k == Kind::Service
}

impl Sidecar {
    pub fn oneshot(&self) -> bool {
        self.kind == Kind::Oneshot
    }

    pub fn http_path(&self) -> Option<&str> {
        self.health.as_deref().filter(|h| h.starts_with('/'))
    }
}

/// The checks that do not depend on the target of the release.
pub fn validate(list: &[Sidecar], desktop_port: u16) -> Result<()> {
    let mut names = BTreeSet::new();
    let mut ports: BTreeMap<u16, &str> = BTreeMap::new();
    for s in list {
        let n = &s.name;
        let ok = !n.is_empty()
            && n.len() <= 40
            && !n.starts_with('-')
            && !n.ends_with('-')
            && n.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
        if !ok {
            bail!("sidecar \"{n}\": the name must be lower case letters, digits and '-' (at most 40, not starting or ending with '-')");
        }
        if !names.insert(n.as_str()) {
            bail!("sidecar \"{n}\": duplicate name");
        }
        if s.command.is_none() && s.image.is_none() {
            bail!("sidecar \"{n}\": it needs `command` (desktop) and/or `image` (Docker, Kubernetes)");
        }
        if s.command.as_ref().is_some_and(|c| c.as_os_str().is_empty()) || s.image.as_deref() == Some("") {
            bail!("sidecar \"{n}\": `command` and `image` must not be empty");
        }
        if let Some(c) = &s.command {
            if c.is_absolute() || c.components().any(|x| matches!(x, std::path::Component::ParentDir)) {
                bail!("sidecar \"{n}\": `command` must be relative to the distribution and stay inside it");
            }
        }
        if let Some(p) = s.port {
            if p < 1024 {
                bail!("sidecar \"{n}\": port {p} is not allowed (use 1024-65535)");
            }
            if p == desktop_port || p == desktop_port.saturating_add(1) || p == 8080 || p == 8081 {
                bail!("sidecar \"{n}\": port {p} is used by the app");
            }
            if let Some(other) = ports.insert(p, n) {
                bail!("sidecar \"{n}\": port {p} is already used by \"{other}\"");
            }
        }
        match s.health.as_deref() {
            None => {}
            Some("tcp") => {}
            Some(h) if h.starts_with('/') => {}
            Some(h) => {
                bail!("sidecar \"{n}\": health \"{h}\" must be \"tcp\" or an HTTP path starting with '/'")
            }
        }
        if s.health.is_some() && s.port.is_none() {
            bail!("sidecar \"{n}\": `health` needs `port`");
        }
        if s.oneshot() && (s.port.is_some() || s.health.is_some()) {
            bail!("sidecar \"{n}\": a oneshot sidecar runs to completion: `port` and `health` make no sense");
        }
        validate_files(s)?;
        if s.start_timeout_secs == 0 || s.start_timeout_secs > 3600 {
            bail!("sidecar \"{n}\": start_timeout_secs must be between 1 and 3600");
        }
        for k in s.env.keys() {
            if k.is_empty() || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                bail!("sidecar \"{n}\": invalid environment variable name \"{k}\"");
            }
        }
        for v in s.env.values() {
            if v.strip_prefix("env:")
                .is_some_and(|r| r.is_empty() || !r.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
            {
                bail!("sidecar \"{n}\": \"{v}\" is not a valid env:NAME reference");
            }
        }
        for v in &s.volumes {
            let mut p = v.splitn(3, ':');
            let (src, dst) = (p.next().unwrap_or(""), p.next().unwrap_or(""));
            if src.is_empty() || !dst.starts_with('/') {
                bail!("sidecar \"{n}\": volume \"{v}\" must be source:/container/path[:ro]");
            }
        }
    }
    for s in list {
        for d in &s.depends_on {
            if d == &s.name {
                bail!("sidecar \"{}\": depends on itself", s.name);
            }
            if !names.contains(d.as_str()) {
                bail!("sidecar \"{}\": depends_on \"{d}\" is not a sidecar of the distribution", s.name);
            }
        }
    }
    // cycles: repeatedly remove the ones whose dependencies are all removed
    let mut left: Vec<&Sidecar> = list.iter().collect();
    let mut done: BTreeSet<&str> = BTreeSet::new();
    while !left.is_empty() {
        let before = left.len();
        left.retain(|s| {
            if s.depends_on.iter().all(|d| done.contains(d.as_str())) {
                done.insert(s.name.as_str());
                false
            } else {
                true
            }
        });
        if left.len() == before {
            let names: Vec<&str> = left.iter().map(|s| s.name.as_str()).collect();
            bail!("sidecars depend on each other in a cycle: {}", names.join(", "));
        }
    }
    Ok(())
}

fn has_parent_dir(p: &str) -> bool {
    p.split(['/', '\\']).any(|c| c == "..")
}

fn is_absolute_like(p: &str) -> bool {
    p.starts_with('/') || p.starts_with('\\') || p.as_bytes().get(1) == Some(&b':')
}

fn validate_files(s: &Sidecar) -> Result<()> {
    let n = &s.name;
    let mut targets = BTreeSet::new();
    for f in &s.files {
        let (src, dst) = (f.source.as_str(), f.target.as_str());
        if src.is_empty() || is_absolute_like(src) || has_parent_dir(src) {
            bail!("sidecar \"{n}\": file source \"{src}\" must be relative to the distribution and stay inside it");
        }
        if dst.is_empty() || has_parent_dir(dst) {
            bail!("sidecar \"{n}\": file target \"{dst}\" must not be empty or contain `..`");
        }
        let key = dst.replace('\\', "/");
        let key = key.trim_start_matches("./").trim_end_matches('/').to_string();
        if !targets.insert(key) {
            bail!("sidecar \"{n}\": duplicate file target \"{dst}\"");
        }
        if let Some(m) = &f.mode {
            if !(3..=4).contains(&m.len()) || !m.chars().all(|c| ('0'..='7').contains(&c)) {
                bail!("sidecar \"{n}\": file mode \"{m}\" must be octal such as \"0644\"");
            }
        }
    }
    Ok(())
}

/// The sources of the files exist (regular files) in the distribution folder.
pub fn check_file_sources(list: &[Sidecar], dir: &Path) -> Result<()> {
    for s in list {
        for f in &s.files {
            if !dir.join(&f.source).is_file() {
                bail!(
                    "sidecar \"{}\": file source {} not found (it must be a file of the distribution)",
                    s.name,
                    dir.join(&f.source).display()
                );
            }
        }
    }
    Ok(())
}

/// Copies the files of a sidecar to `dest/<source>` (the layout the bundles refer to).
pub fn copy_file_sources(s: &Sidecar, dir: &Path, dest: &Path) -> Result<()> {
    for f in &s.files {
        let to = dest.join(&f.source);
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(dir.join(&f.source), &to)?;
    }
    Ok(())
}

/// Folder of the desktop bundle (relative to `sidecars.toml`) with the overlay sources of a sidecar.
pub fn bundle_files_dir(name: &str) -> String {
    format!("sidecars/{name}/_files")
}

/// Host folder (relative to the Compose project) with the files of a sidecar.
pub fn docker_files_dir(name: &str) -> String {
    format!("sidecar-files/{name}")
}

/// Desktop release: every sidecar needs an executable that exists.
pub fn check_desktop(list: &[Sidecar], dir: &Path) -> Result<()> {
    for s in list {
        let Some(c) = &s.command else {
            bail!("sidecar \"{}\": the desktop release needs `command`", s.name);
        };
        for f in &s.files {
            if is_absolute_like(&f.target) {
                bail!(
                    "sidecar \"{}\": file target \"{}\" must be relative to sidecars/{}/ on the desktop",
                    s.name,
                    f.target,
                    s.name
                );
            }
        }
        if resolve_command(dir, c).is_none() {
            bail!("sidecar \"{}\": executable {} not found", s.name, dir.join(c).display());
        }
    }
    Ok(())
}

/// Docker and Kubernetes releases: every sidecar needs an image.
pub fn check_containers(list: &[Sidecar]) -> Result<()> {
    for s in list {
        if s.image.is_none() {
            bail!("sidecar \"{}\": the Docker and Kubernetes releases need `image`", s.name);
        }
        for f in &s.files {
            if !f.target.starts_with('/') {
                bail!(
                    "sidecar \"{}\": file target \"{}\" must be an absolute path in the container (Docker and Kubernetes)",
                    s.name,
                    f.target
                );
            }
        }
    }
    Ok(())
}

/// The file of the command: as written or, on Windows, with `.exe`.
pub fn resolve_command(dir: &Path, command: &Path) -> Option<PathBuf> {
    let p = dir.join(command);
    if p.is_file() {
        return Some(p);
    }
    if cfg!(windows) && p.extension().is_none() {
        let e = p.with_extension("exe");
        if e.is_file() {
            return Some(e);
        }
    }
    None
}

/// Entries to add to MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS: `127.0.0.1:<port>` (desktop) or `<name>:<port>`.
pub fn fetch_hosts(list: &[Sidecar], containers: bool) -> Vec<String> {
    list.iter()
        .filter(|s| !s.oneshot())
        .filter_map(|s| {
            s.port.map(|p| if containers { format!("{}:{p}", s.name) } else { format!("127.0.0.1:{p}") })
        })
        .collect()
}

/// `sidecars.toml` of the desktop bundle: commands rewritten to `sidecars/<name>/...`.
pub fn desktop_toml(list: &[Sidecar]) -> Result<String> {
    #[derive(Serialize)]
    struct File<'a> {
        sidecars: &'a [Sidecar],
    }
    let mut v: Vec<Sidecar> = list.to_vec();
    for s in &mut v {
        if let Some(c) = &s.command {
            // forward slashes on every platform: the same file is read by the launcher
            let rel = bundle_rel(c).to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
            s.command = Some(PathBuf::from(format!("sidecars/{}/{rel}", s.name)));
        }
        s.image = None;
        s.volumes.clear();
        // the overlay sources travel in `sidecars/<name>/_files/` of the bundle
        for f in &mut s.files {
            f.source = format!("{}/{}", bundle_files_dir(&s.name), f.source.replace('\\', "/"));
        }
    }
    let body = toml::to_string(&File { sidecars: &v })?;
    Ok(format!(
        "# Sidecars started by the desktop launcher before the kernel (generated by the release)\n\n{body}"
    ))
}

/// Path of the command inside `sidecars/<name>/`: the file name when it sits in the distribution
/// folder, otherwise the layout below its first folder (that folder is what the bundle copies).
pub fn bundle_rel(command: &Path) -> PathBuf {
    if command.components().count() > 1 {
        command.components().skip(1).collect()
    } else {
        command.to_path_buf()
    }
}

/// The folder (or file) to copy for a command, relative to the distribution.
pub fn bundle_source(command: &Path) -> PathBuf {
    match command.components().next() {
        Some(first) if command.components().count() > 1 => PathBuf::from(first.as_os_str()),
        _ => command.to_path_buf(),
    }
}
