//! `[[sidecars]]` of `distribution.toml`: extra processes or services a distribution ships next to
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
use std::fmt::Write as _;
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Sidecar {
    /// unique identifier: lower case, digits, '-' (service name in containers)
    pub name: String,
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

impl Sidecar {
    fn http_path(&self) -> Option<&str> {
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

/// Desktop release: every sidecar needs an executable that exists.
pub fn check_desktop(list: &[Sidecar], dir: &Path) -> Result<()> {
    for s in list {
        let Some(c) = &s.command else {
            bail!("sidecar \"{}\": the desktop release needs `command`", s.name);
        };
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

fn is_named_volume(src: &str) -> bool {
    !(src.starts_with('.')
        || src.starts_with('/')
        || src.starts_with('~')
        || src.contains('\\')
        || src.as_bytes().get(1) == Some(&b':'))
}

fn q(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// `${NAME:-}` for an `env:NAME` reference (Compose), otherwise the literal value (`$` doubled).
fn compose_value(v: &str) -> String {
    match v.strip_prefix("env:") {
        Some(n) => q(&format!("${{{n}:-}}")),
        None => q(&v.replace('$', "$$")),
    }
}

/// Variables read from the environment (`env:NAME`) by the sidecars, sorted.
pub fn env_refs(list: &[Sidecar]) -> Vec<String> {
    let set: BTreeSet<String> = list
        .iter()
        .flat_map(|s| s.env.values())
        .filter_map(|v| v.strip_prefix("env:").map(String::from))
        .collect();
    set.into_iter().collect()
}

/// `compose.sidecars.yml`: an override of `compose.yml` (a service per sidecar; the `app` service
/// depends on them and learns their addresses).
pub fn compose(list: &[Sidecar]) -> String {
    let by_name: BTreeMap<&str, &Sidecar> = list.iter().map(|s| (s.name.as_str(), s)).collect();
    let cond = |s: &Sidecar| if s.health.is_some() { "service_healthy" } else { "service_started" };
    let mut o = String::from(
        "# Sidecars of the distribution (generated). Merged with compose.yml through COMPOSE_FILE in .env.\n\nservices:\n  app:\n    depends_on:\n",
    );
    for s in list {
        let _ = writeln!(o, "      {}:\n        condition: {}", s.name, cond(s));
    }
    let hosts = fetch_hosts(list, true);
    if !hosts.is_empty() {
        let _ = writeln!(
            o,
            "    environment:\n      # private hosts the plugins may reach (exact host:port list)\n      MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS: ${{MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS:-{}}}",
            hosts.join(",")
        );
    }
    let mut volumes: BTreeSet<String> = BTreeSet::new();
    for s in list {
        let _ = writeln!(o, "\n  {}:\n    image: {}", s.name, s.image.as_deref().unwrap_or_default());
        let restart = match s.restart {
            Restart::Never => "\"no\"",
            Restart::OnFailure => "on-failure",
            Restart::Always => "unless-stopped",
        };
        let _ = writeln!(o, "    restart: {restart}");
        if !s.args.is_empty() {
            let a: Vec<String> = s.args.iter().map(|a| q(&a.replace('$', "$$"))).collect();
            let _ = writeln!(o, "    command: [{}]", a.join(", "));
        }
        if !s.env.is_empty() {
            let _ = writeln!(o, "    environment:");
            for (k, v) in &s.env {
                let _ = writeln!(o, "      {k}: {}", compose_value(v));
            }
        }
        if let Some(p) = s.port {
            let _ = writeln!(o, "    expose:\n      - \"{p}\"");
        }
        if !s.volumes.is_empty() {
            let _ = writeln!(o, "    volumes:");
            for v in &s.volumes {
                let src = v.split(':').next().unwrap_or_default();
                if is_named_volume(src) {
                    volumes.insert(src.to_string());
                }
                let _ = writeln!(o, "      - {}", q(v));
            }
        }
        if !s.depends_on.is_empty() {
            let _ = writeln!(o, "    depends_on:");
            for d in &s.depends_on {
                let c = by_name.get(d.as_str()).map(|x| cond(x)).unwrap_or("service_started");
                let _ = writeln!(o, "      {d}:\n        condition: {c}");
            }
        }
        if let (Some(h), Some(p)) = (&s.health, s.port) {
            let test = match s.http_path() {
                Some(path) => format!(
                    "wget -q -O /dev/null http://127.0.0.1:{p}{path} || curl -fsS -o /dev/null http://127.0.0.1:{p}{path}"
                ),
                None => {
                    debug_assert_eq!(h, "tcp");
                    format!("nc -z 127.0.0.1 {p}")
                }
            };
            let _ = writeln!(
                o,
                "    healthcheck:\n      # needs wget, curl or nc in the image\n      test: [\"CMD-SHELL\", {}]\n      interval: 5s\n      timeout: 3s\n      retries: {}\n      start_period: 5s",
                q(&test),
                (s.start_timeout_secs / 5).max(3)
            );
        }
    }
    if !volumes.is_empty() {
        o.push_str("\nvolumes:\n");
        for v in volumes {
            let _ = writeln!(o, "  {v}:");
        }
    }
    o
}

/// Lines to add to `.env` for the sidecars of a Compose release.
pub fn compose_env(list: &[Sidecar]) -> String {
    let mut o = String::from("# sidecars: compose.yml + compose.sidecars.yml\nCOMPOSE_PATH_SEPARATOR=,\nCOMPOSE_FILE=compose.yml,compose.sidecars.yml\n");
    for n in env_refs(list) {
        let _ = writeln!(o, "{n}=");
    }
    o
}

/// `sidecars.yaml` of the Kubernetes release: PVCs, a Deployment and a Service per sidecar.
/// Volumes with a path as a source are not supported (a volume name becomes a PVC).
pub fn k8s(list: &[Sidecar], id: &str) -> Result<String> {
    let mut o =
        String::from("# Sidecars of the distribution (generated): a Deployment and a Service per sidecar.\n");
    for s in list {
        let n = &s.name;
        let mut mounts = String::new();
        let mut vols = String::new();
        for (i, v) in s.volumes.iter().enumerate() {
            let mut p = v.splitn(3, ':');
            let (src, dst, mode) = (p.next().unwrap_or(""), p.next().unwrap_or(""), p.next());
            if !is_named_volume(src) {
                bail!("sidecar \"{n}\": volume \"{v}\": Kubernetes supports only volume names, not paths");
            }
            let vn = format!("v{i}");
            let ro = if mode == Some("ro") { "\n              readOnly: true" } else { "" };
            let _ = write!(mounts, "            - name: {vn}\n              mountPath: {dst}{ro}\n");
            let _ = write!(
                vols,
                "        - name: {vn}\n          persistentVolumeClaim:\n            claimName: {n}-{src}\n"
            );
            let _ = write!(
                o,
                "---\napiVersion: v1\nkind: PersistentVolumeClaim\nmetadata:\n  name: {n}-{src}\nspec:\n  accessModes: [\"ReadWriteOnce\"]\n  resources:\n    requests:\n      storage: 1Gi\n"
            );
        }
        let _ = write!(
            o,
            "---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {n}\n  labels:\n    app.kubernetes.io/name: {n}\n    app.kubernetes.io/component: sidecar\nspec:\n  replicas: 1\n  strategy:\n    type: Recreate\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: {n}\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name: {n}\n        app.kubernetes.io/component: sidecar\n    spec:\n      containers:\n        - name: {n}\n          image: {}\n",
            s.image.as_deref().unwrap_or_default()
        );
        if !s.args.is_empty() {
            let a: Vec<String> = s.args.iter().map(|a| q(a)).collect();
            let _ = writeln!(o, "          args: [{}]", a.join(", "));
        }
        if let Some(p) = s.port {
            let _ =
                writeln!(o, "          ports:\n            - name: main\n              containerPort: {p}");
        }
        if !s.env.is_empty() {
            let _ = writeln!(o, "          env:");
            for (k, v) in &s.env {
                match v.strip_prefix("env:") {
                    Some(r) => {
                        let _ = write!(
                            o,
                            "            - name: {k}\n              valueFrom:\n                secretKeyRef:\n                  name: {id}-secret\n                  key: {r}\n"
                        );
                    }
                    None => {
                        let _ = write!(o, "            - name: {k}\n              value: {}\n", q(v));
                    }
                }
            }
        }
        if let (Some(_), Some(p)) = (&s.health, s.port) {
            let probe = match s.http_path() {
                Some(path) => format!("httpGet:\n              path: {path}\n              port: {p}"),
                None => format!("tcpSocket:\n              port: {p}"),
            };
            let _ = write!(
                o,
                "          startupProbe:\n            {probe}\n            periodSeconds: 5\n            failureThreshold: {}\n          readinessProbe:\n            {probe}\n            periodSeconds: 10\n",
                (s.start_timeout_secs / 5).max(3)
            );
        }
        if !mounts.is_empty() {
            let _ = write!(o, "          volumeMounts:\n{mounts}");
        }
        if !vols.is_empty() {
            let _ = write!(o, "      volumes:\n{vols}");
        }
        if let Some(p) = s.port {
            let _ = write!(
                o,
                "---\napiVersion: v1\nkind: Service\nmetadata:\n  name: {n}\n  labels:\n    app.kubernetes.io/name: {n}\nspec:\n  selector:\n    app.kubernetes.io/name: {n}\n  ports:\n    - name: main\n      port: {p}\n      targetPort: main\n"
            );
        }
    }
    Ok(o)
}

/// Adds the sidecars to the rendered Kubernetes templates: `sidecars.yaml`, the resource in the
/// kustomization, the allowed hosts in `config.env` and the secret variables in `secret.env`.
pub fn apply_k8s(out: &Path, list: &[Sidecar], id: &str) -> Result<()> {
    if list.is_empty() {
        return Ok(());
    }
    check_containers(list)?;
    std::fs::write(out.join("sidecars.yaml"), k8s(list, id)?)?;
    let kz = out.join("kustomization.yaml");
    let text = std::fs::read_to_string(&kz)?;
    if !text.contains("  - app.yaml\n") {
        bail!("kustomization.yaml has no app.yaml resource to extend");
    }
    std::fs::write(&kz, text.replacen("  - app.yaml\n", "  - app.yaml\n  - sidecars.yaml\n", 1))?;
    let hosts = fetch_hosts(list, true);
    if !hosts.is_empty() {
        let c = out.join("config.env");
        let mut t = std::fs::read_to_string(&c)?;
        let _ = write!(t, "\n# sidecars: private hosts the plugins may reach (exact host:port list)\nMOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS={}\n", hosts.join(","));
        std::fs::write(c, t)?;
    }
    let refs = env_refs(list);
    if !refs.is_empty() {
        let c = out.join("secret.env");
        let mut t = std::fs::read_to_string(&c)?;
        t.push_str("\n# sidecars: values of the env:NAME references\n");
        for r in refs {
            let _ = writeln!(t, "{r}=");
        }
        std::fs::write(c, t)?;
    }
    Ok(())
}

/// `cargo xtask sidecars`: validates the section and prints what each target will get.
pub fn show() -> Result<()> {
    let d = crate::dist::current();
    let list = &d.sidecars;
    println!("{} sidecar(s) in {}", list.len(), d.dir.display());
    for s in list {
        println!(
            "- {}: command={} image={} port={} health={} restart={:?} depends_on={:?}",
            s.name,
            s.command.as_ref().map_or("-".into(), |c| c.display().to_string()),
            s.image.as_deref().unwrap_or("-"),
            s.port.map_or("-".into(), |p| p.to_string()),
            s.health.as_deref().unwrap_or("-"),
            s.restart,
            s.depends_on
        );
    }
    println!("desktop MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS={}", fetch_hosts(list, false).join(","));
    println!("container MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS={}", fetch_hosts(list, true).join(","));
    if list.iter().all(|s| s.image.is_some()) && !list.is_empty() {
        println!("\n--- compose.sidecars.yml ---\n{}", compose(list));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(t: &str) -> Vec<Sidecar> {
        #[derive(Deserialize)]
        struct F {
            sidecars: Vec<Sidecar>,
        }
        toml::from_str::<F>(t).expect("parse").sidecars
    }

    const FULL: &str = r#"
[[sidecars]]
name = "geo"
command = "bin/geo-service"
args = ["--listen", "127.0.0.1:9100"]
env = { TOKEN = "env:GEO_TOKEN", MODE = "fast" }
health = "/health"
port = 9100
image = "registry.example.com/geo:1.2"
volumes = ["geodata:/var/lib/geo", "geoconf:/etc/geo:ro"]
restart = "always"
start_timeout_secs = 60

[[sidecars]]
name = "cache"
command = "cache.exe"
port = 9200
health = "tcp"
image = "redis:7"
depends_on = ["geo"]
"#;

    #[test]
    fn parses_and_validates() {
        let l = parse(FULL);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].restart, Restart::Always);
        assert_eq!(l[1].restart, Restart::OnFailure);
        assert_eq!(l[1].start_timeout_secs, 30);
        validate(&l, 48080).expect("valid");
    }

    #[test]
    fn unknown_key_and_bad_restart_are_rejected() {
        let t = "[[sidecars]]\nname='a'\ncommand='a'\nfoo=1\n";
        #[derive(Deserialize)]
        struct F {
            #[allow(dead_code)]
            sidecars: Vec<Sidecar>,
        }
        assert!(toml::from_str::<F>(t).is_err());
        let t = "[[sidecars]]\nname='a'\ncommand='a'\nrestart='sometimes'\n";
        assert!(toml::from_str::<F>(t).is_err());
    }

    fn err(mut l: Vec<Sidecar>, f: impl FnOnce(&mut Vec<Sidecar>)) -> String {
        f(&mut l);
        validate(&l, 48080).expect_err("must fail").to_string()
    }

    #[test]
    fn validation_errors() {
        let base = parse(FULL);
        assert!(err(base.clone(), |l| l[1].name = "geo".into()).contains("duplicate"));
        assert!(err(base.clone(), |l| l[1].name = "Bad_Name".into()).contains("name"));
        assert!(err(base.clone(), |l| l[1].depends_on = vec!["nope".into()]).contains("not a sidecar"));
        assert!(err(base.clone(), |l| l[0].depends_on = vec!["cache".into()]).contains("cycle"));
        assert!(err(base.clone(), |l| l[1].depends_on = vec!["cache".into()]).contains("itself"));
        assert!(err(base.clone(), |l| l[1].port = Some(9100)).contains("already used"));
        assert!(err(base.clone(), |l| l[1].port = Some(80)).contains("not allowed"));
        assert!(err(base.clone(), |l| l[1].port = Some(48081)).contains("used by the app"));
        assert!(err(base.clone(), |l| {
            l[1].command = None;
            l[1].image = None;
        })
        .contains("needs"));
        assert!(err(base.clone(), |l| l[1].health = Some("ready".into())).contains("health"));
        assert!(err(base.clone(), |l| l[1].port = None).contains("needs `port`"));
        assert!(err(base.clone(), |l| l[0].command = Some("../x".into())).contains("inside"));
        assert!(err(base.clone(), |l| l[0].start_timeout_secs = 0).contains("start_timeout_secs"));
        assert!(err(base.clone(), |l| l[0].env.insert("A".into(), "env:".into()).map(drop).unwrap_or(()))
            .contains("env:NAME"));
        assert!(err(base, |l| l[0].volumes = vec!["nopath".into()]).contains("volume"));
    }

    #[test]
    fn target_checks() {
        let mut l = parse(FULL);
        assert!(check_containers(&l).is_ok());
        l[0].image = None;
        assert!(check_containers(&l).unwrap_err().to_string().contains("image"));
        let tmp = std::env::temp_dir().join("mosaikit-sidecar-check");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let e = check_desktop(&l, &tmp).unwrap_err().to_string();
        assert!(e.contains("not found"), "{e}");
        std::fs::create_dir_all(tmp.join("bin")).unwrap();
        std::fs::write(tmp.join("bin/geo-service"), "").unwrap();
        std::fs::write(tmp.join("cache.exe"), "").unwrap();
        assert!(check_desktop(&l, &tmp).is_ok());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn fetch_hosts_per_target() {
        let l = parse(FULL);
        assert_eq!(fetch_hosts(&l, false), ["127.0.0.1:9100", "127.0.0.1:9200"]);
        assert_eq!(fetch_hosts(&l, true), ["geo:9100", "cache:9200"]);
    }

    #[test]
    fn bundle_paths() {
        assert_eq!(bundle_source(Path::new("bin/geo-service")), Path::new("bin"));
        assert_eq!(bundle_rel(Path::new("bin/geo-service")), Path::new("geo-service"));
        assert_eq!(bundle_source(Path::new("geo.exe")), Path::new("geo.exe"));
        assert_eq!(bundle_rel(Path::new("geo.exe")), Path::new("geo.exe"));
        assert_eq!(bundle_rel(Path::new("bin/x/geo")), Path::new("x/geo"));
    }

    #[test]
    fn desktop_toml_roundtrip() {
        let t = desktop_toml(&parse(FULL)).unwrap();
        assert!(t.contains("command = \"sidecars/geo/geo-service\""), "{t}");
        assert!(!t.contains("image"));
        assert!(!t.contains("volumes"));
        let back = parse(&t);
        assert_eq!(back[1].depends_on, ["geo"]);
    }

    #[test]
    fn compose_snapshot() {
        let got = compose(&parse(FULL));
        let want = r#"# Sidecars of the distribution (generated). Merged with compose.yml through COMPOSE_FILE in .env.

services:
  app:
    depends_on:
      geo:
        condition: service_healthy
      cache:
        condition: service_healthy
    environment:
      # private hosts the plugins may reach (exact host:port list)
      MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS: ${MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS:-geo:9100,cache:9200}

  geo:
    image: registry.example.com/geo:1.2
    restart: unless-stopped
    command: ["--listen", "127.0.0.1:9100"]
    environment:
      MODE: "fast"
      TOKEN: "${GEO_TOKEN:-}"
    expose:
      - "9100"
    volumes:
      - "geodata:/var/lib/geo"
      - "geoconf:/etc/geo:ro"
    healthcheck:
      # needs wget, curl or nc in the image
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:9100/health || curl -fsS -o /dev/null http://127.0.0.1:9100/health"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s

  cache:
    image: redis:7
    restart: on-failure
    expose:
      - "9200"
    depends_on:
      geo:
        condition: service_healthy
    healthcheck:
      # needs wget, curl or nc in the image
      test: ["CMD-SHELL", "nc -z 127.0.0.1 9200"]
      interval: 5s
      timeout: 3s
      retries: 6
      start_period: 5s

volumes:
  geoconf:
  geodata:
"#;
        assert_eq!(got, want, "\n{got}");
        let env = compose_env(&parse(FULL));
        assert!(env.contains("COMPOSE_FILE=compose.yml,compose.sidecars.yml"));
        assert!(env.contains("GEO_TOKEN=\n"));
    }

    #[test]
    fn k8s_snapshot() {
        let got = k8s(&parse(FULL), "prod").unwrap();
        for needle in [
            "kind: PersistentVolumeClaim\nmetadata:\n  name: geo-geodata",
            "kind: Deployment\nmetadata:\n  name: geo\n",
            "image: registry.example.com/geo:1.2",
            "args: [\"--listen\", \"127.0.0.1:9100\"]",
            "name: TOKEN\n              valueFrom:\n                secretKeyRef:\n                  name: prod-secret\n                  key: GEO_TOKEN",
            "httpGet:\n              path: /health\n              port: 9100",
            "tcpSocket:\n              port: 9200",
            "claimName: geo-geoconf",
            "readOnly: true",
            "kind: Service\nmetadata:\n  name: cache\n",
        ] {
            assert!(got.contains(needle), "missing {needle:?} in\n{got}");
        }
        let mut l = parse(FULL);
        l[0].volumes = vec!["./data:/d".into()];
        assert!(k8s(&l, "prod").unwrap_err().to_string().contains("volume names"));
    }

    #[test]
    fn apply_k8s_extends_templates() {
        let tmp = std::env::temp_dir().join("mosaikit-sidecar-k8s");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("kustomization.yaml"), "resources:\n  - app.yaml\n  - ingress.yaml\n")
            .unwrap();
        std::fs::write(tmp.join("config.env"), "A=1\n").unwrap();
        std::fs::write(tmp.join("secret.env"), "B=2\n").unwrap();
        apply_k8s(&tmp, &parse(FULL), "prod").unwrap();
        let k = std::fs::read_to_string(tmp.join("kustomization.yaml")).unwrap();
        assert!(k.contains("  - app.yaml\n  - sidecars.yaml\n  - ingress.yaml"));
        assert!(std::fs::read_to_string(tmp.join("config.env"))
            .unwrap()
            .contains("MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS=geo:9100,cache:9200"));
        assert!(std::fs::read_to_string(tmp.join("secret.env")).unwrap().contains("GEO_TOKEN="));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
