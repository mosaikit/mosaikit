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
use std::path::Path;

use anyhow::{bail, Result};

pub use mosaikit_sidecars::*;

/// Image of the initContainers that wait for a oneshot Job.
const KUBECTL_IMAGE: &str = "registry.k8s.io/kubectl:v1.31.0";

/// Largest total size of the files of one sidecar in a Kubernetes ConfigMap (the hard limit is 1 MiB).
pub const MAX_K8S_FILES_BYTES: u64 = 512 * 1024;

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

/// A YAML double-quoted scalar holding `s` verbatim (JSON escapes are valid YAML).
fn yaml_text(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '"' => o.push_str("\\\""),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(o, "\\u{:04x}", c as u32);
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
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
    let cond = |s: &Sidecar| {
        if s.oneshot() {
            "service_completed_successfully"
        } else if s.health.is_some() {
            "service_healthy"
        } else {
            "service_started"
        }
    };
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
            _ if s.oneshot() => "\"no\"",
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
        if !s.volumes.is_empty() || !s.files.is_empty() {
            let _ = writeln!(o, "    volumes:");
            for v in &s.volumes {
                let src = v.split(':').next().unwrap_or_default();
                if is_named_volume(src) {
                    volumes.insert(src.to_string());
                }
                let _ = writeln!(o, "      - {}", q(v));
            }
            // files of the distribution: read-only bind mounts from the bundle folder
            for f in &s.files {
                let host = format!("./{}/{}", docker_files_dir(&s.name), f.source.replace('\\', "/"));
                let _ = writeln!(o, "      - {}", q(&format!("{host}:{}:ro", f.target)));
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
pub fn k8s(list: &[Sidecar], id: &str, dir: &Path) -> Result<String> {
    let mut o = String::from(
        "# Sidecars of the distribution (generated): a Deployment and a Service per service sidecar, a Job per oneshot.\n",
    );
    let by_name: BTreeMap<&str, &Sidecar> = list.iter().map(|s| (s.name.as_str(), s)).collect();
    // a pod that depends on a oneshot waits for its Job in an initContainer (kubectl wait)
    let waits = list
        .iter()
        .any(|s| s.depends_on.iter().any(|d| by_name.get(d.as_str()).is_some_and(|x| x.oneshot())));
    if waits {
        let _ = write!(
            o,
            "---\napiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: {id}-sidecar-wait\n---\napiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: {id}-sidecar-wait\nrules:\n  - apiGroups: [\"batch\"]\n    resources: [\"jobs\"]\n    verbs: [\"get\", \"list\", \"watch\"]\n---\napiVersion: rbac.authorization.k8s.io/v1\nkind: RoleBinding\nmetadata:\n  name: {id}-sidecar-wait\nroleRef:\n  apiGroup: rbac.authorization.k8s.io\n  kind: Role\n  name: {id}-sidecar-wait\nsubjects:\n  - kind: ServiceAccount\n    name: {id}-sidecar-wait\n"
        );
    }
    for s in list {
        let n = &s.name;
        let mut mounts = String::new();
        let mut vols = String::new();
        if !s.files.is_empty() {
            let mut total = 0u64;
            let mut data = String::new();
            let mut items = String::new();
            for (i, f) in s.files.iter().enumerate() {
                let path = dir.join(&f.source);
                total += std::fs::metadata(&path)
                    .map_err(|e| anyhow::anyhow!("sidecar \"{n}\": file {}: {e}", path.display()))?
                    .len();
                if total > MAX_K8S_FILES_BYTES {
                    bail!(
                        "sidecar \"{n}\": the files exceed {} KiB, too large for a Kubernetes ConfigMap (use an image, a volume or fewer files)",
                        MAX_K8S_FILES_BYTES / 1024
                    );
                }
                let text = std::fs::read_to_string(&path).map_err(|_| {
                    anyhow::anyhow!(
                        "sidecar \"{n}\": file {} must be UTF-8 text for a Kubernetes ConfigMap",
                        path.display()
                    )
                })?;
                let _ =
                    write!(data, "  # f{i}: {}\n  f{i}: {}\n", f.source.replace('\\', "/"), yaml_text(&text));
                let mode = f.mode.as_deref().map(|m| u32::from_str_radix(m, 8).unwrap_or(0o644));
                let mode = mode.map_or(String::new(), |m| format!("\n              mode: {m}"));
                let _ = write!(items, "            - key: f{i}\n              path: f{i}{mode}\n");
                let _ = write!(
                    mounts,
                    "            - name: files\n              mountPath: {}\n              subPath: f{i}\n              readOnly: true\n",
                    q(&f.target)
                );
            }
            let _ = write!(
                o,
                "---\napiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {n}-files\n  labels:\n    app.kubernetes.io/name: {n}\ndata:\n{data}"
            );
            let _ = write!(vols, "        - name: files\n          configMap:\n            name: {n}-files\n            items:\n{items}");
        }
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
        if s.oneshot() {
            // runs once per apply; a Job is immutable, delete it before applying a new version
            let _ = write!(
                o,
                "---\napiVersion: batch/v1\nkind: Job\nmetadata:\n  name: {n}\n  labels:\n    app.kubernetes.io/name: {n}\n    app.kubernetes.io/component: sidecar-oneshot\nspec:\n  backoffLimit: 0\n  activeDeadlineSeconds: {}\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name: {n}\n        app.kubernetes.io/component: sidecar-oneshot\n    spec:\n      restartPolicy: Never\n      containers:\n        - name: {n}\n          image: {}\n",
                s.start_timeout_secs,
                s.image.as_deref().unwrap_or_default()
            );
        } else {
            let _ = write!(
                o,
                "---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {n}\n  labels:\n    app.kubernetes.io/name: {n}\n    app.kubernetes.io/component: sidecar\nspec:\n  replicas: 1\n  strategy:\n    type: Recreate\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: {n}\n  template:\n    metadata:\n      labels:\n        app.kubernetes.io/name: {n}\n        app.kubernetes.io/component: sidecar\n    spec:\n      containers:\n        - name: {n}\n          image: {}\n",
                s.image.as_deref().unwrap_or_default()
            );
        }
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
        let waited: Vec<&Sidecar> = s
            .depends_on
            .iter()
            .filter_map(|d| by_name.get(d.as_str()).copied())
            .filter(|x| x.oneshot())
            .collect();
        if !waited.is_empty() {
            let _ = writeln!(o, "      serviceAccountName: {id}-sidecar-wait\n      initContainers:");
            for w in waited {
                let _ = write!(
                    o,
                    "        - name: wait-{}\n          image: {KUBECTL_IMAGE}\n          args: [\"wait\", \"--for=condition=complete\", \"job/{}\", \"--timeout={}s\"]\n",
                    w.name, w.name, w.start_timeout_secs
                );
            }
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
pub fn apply_k8s(out: &Path, list: &[Sidecar], id: &str, dir: &Path) -> Result<()> {
    if list.is_empty() {
        return Ok(());
    }
    check_containers(list)?;
    std::fs::write(out.join("sidecars.yaml"), k8s(list, id, dir)?)?;
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
            "- {}: kind={:?} files={} command={} image={} port={} health={} restart={:?} depends_on={:?}",
            s.name,
            s.kind,
            s.files.len(),
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
    use serde::Deserialize;
    use std::path::PathBuf;

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
        let got = k8s(&parse(FULL), "prod", Path::new(".")).unwrap();
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
        assert!(k8s(&l, "prod", Path::new(".")).unwrap_err().to_string().contains("volume names"));
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
        apply_k8s(&tmp, &parse(FULL), "prod", &tmp).unwrap();
        let k = std::fs::read_to_string(tmp.join("kustomization.yaml")).unwrap();
        assert!(k.contains("  - app.yaml\n  - sidecars.yaml\n  - ingress.yaml"));
        assert!(std::fs::read_to_string(tmp.join("config.env"))
            .unwrap()
            .contains("MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS=geo:9100,cache:9200"));
        assert!(std::fs::read_to_string(tmp.join("secret.env")).unwrap().contains("GEO_TOKEN="));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    const ONESHOT: &str = r#"
[[sidecars]]
name = "init-db"
kind = "oneshot"
command = "bin/init-db"
image = "registry.example.com/geo-init:1"
args = ["--migrate"]
env = { PGPASSWORD = "env:DB_PASSWORD" }
start_timeout_secs = 90
files = [{ source = "conf/init.sql", target = "/etc/geo/init.sql", mode = "0640" }]

[[sidecars]]
name = "geoserver"
command = "bin/geoserver"
image = "registry.example.com/geo:2"
port = 9300
health = "/health"
depends_on = ["init-db"]
files = [
  { source = "conf/server.xml", target = "/etc/geo/server.xml" },
  { source = "conf/layers/a.json", target = "/etc/geo/layers/a.json" },
]
"#;

    fn files_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mosaikit-sidecar-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("conf/layers")).unwrap();
        std::fs::write(d.join("conf/init.sql"), "SELECT 1;\n").unwrap();
        std::fs::write(d.join("conf/server.xml"), "<a b=\"1\"/>\n").unwrap();
        std::fs::write(d.join("conf/layers/a.json"), "{}").unwrap();
        d
    }

    #[test]
    fn oneshot_and_files_validation() {
        let base = parse(ONESHOT);
        validate(&base, 48080).expect("valid");
        assert_eq!(base[0].kind, Kind::Oneshot);
        assert_eq!(base[1].kind, Kind::Service);
        assert!(err(base.clone(), |l| l[0].port = Some(9400)).contains("oneshot"));
        assert!(err(base.clone(), |l| {
            l[0].port = Some(9400);
            l[0].health = Some("tcp".into());
        })
        .contains("oneshot"));
        assert!(err(base.clone(), |l| l[1].files[0].source = "../x".into()).contains("source"));
        assert!(err(base.clone(), |l| l[1].files[0].source = "/etc/passwd".into()).contains("source"));
        assert!(err(base.clone(), |l| l[1].files[0].target = "/etc/../x".into()).contains("target"));
        assert!(err(base.clone(), |l| l[1].files[1].target = "/etc/geo/server.xml".into())
            .contains("duplicate file target"));
        assert!(err(base.clone(), |l| l[1].files[0].mode = Some("rw".into())).contains("mode"));
        // the kind is part of the toml: a typo is rejected
        #[derive(Deserialize)]
        struct F {
            #[allow(dead_code)]
            sidecars: Vec<Sidecar>,
        }
        assert!(toml::from_str::<F>("[[sidecars]]\nname='a'\ncommand='a'\nkind='daemon'\n").is_err());
        assert!(toml::from_str::<F>("[[sidecars]]\nname='a'\ncommand='a'\nfiles=[{source='a'}]\n").is_err());
    }

    #[test]
    fn file_sources_and_target_rules() {
        let dir = files_dir("rules");
        let mut l = parse(ONESHOT);
        check_file_sources(&l, &dir).expect("sources exist");
        l[1].files[0].source = "conf/missing.xml".into();
        assert!(check_file_sources(&l, &dir).unwrap_err().to_string().contains("not found"));
        // containers need absolute targets, the desktop relative ones
        let l = parse(ONESHOT);
        assert!(check_containers(&l).is_ok());
        assert!(check_desktop(&l, &dir).unwrap_err().to_string().contains("relative to sidecars/init-db/"));
        let mut r = parse(ONESHOT);
        for s in &mut r {
            for f in &mut s.files {
                f.target = f.target.trim_start_matches('/').to_string();
            }
        }
        assert!(check_containers(&r).unwrap_err().to_string().contains("absolute"));
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        std::fs::write(dir.join("bin/init-db"), "").unwrap();
        std::fs::write(dir.join("bin/geoserver"), "").unwrap();
        assert!(check_desktop(&r, &dir).is_ok());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn oneshot_is_not_a_fetch_host() {
        let mut l = parse(ONESHOT);
        assert_eq!(fetch_hosts(&l, true), ["geoserver:9300"]);
        l.remove(1);
        assert!(fetch_hosts(&l, false).is_empty());
    }

    #[test]
    fn desktop_toml_has_kind_and_overlay() {
        let t = desktop_toml(&parse(ONESHOT)).unwrap();
        assert!(t.contains("kind = \"oneshot\""), "{t}");
        assert!(t.contains("source = \"sidecars/geoserver/_files/conf/layers/a.json\""), "{t}");
        let back = parse(&t);
        assert_eq!(back[0].kind, Kind::Oneshot);
        assert_eq!(back[1].files.len(), 2);
        // a plain service does not get a kind line
        assert!(!desktop_toml(&parse(FULL)).unwrap().contains("kind"));
    }

    #[test]
    fn compose_oneshot_snapshot() {
        let got = compose(&parse(ONESHOT));
        let want = r#"# Sidecars of the distribution (generated). Merged with compose.yml through COMPOSE_FILE in .env.

services:
  app:
    depends_on:
      init-db:
        condition: service_completed_successfully
      geoserver:
        condition: service_healthy
    environment:
      # private hosts the plugins may reach (exact host:port list)
      MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS: ${MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS:-geoserver:9300}

  init-db:
    image: registry.example.com/geo-init:1
    restart: "no"
    command: ["--migrate"]
    environment:
      PGPASSWORD: "${DB_PASSWORD:-}"
    volumes:
      - "./sidecar-files/init-db/conf/init.sql:/etc/geo/init.sql:ro"

  geoserver:
    image: registry.example.com/geo:2
    restart: on-failure
    expose:
      - "9300"
    volumes:
      - "./sidecar-files/geoserver/conf/server.xml:/etc/geo/server.xml:ro"
      - "./sidecar-files/geoserver/conf/layers/a.json:/etc/geo/layers/a.json:ro"
    depends_on:
      init-db:
        condition: service_completed_successfully
    healthcheck:
      # needs wget, curl or nc in the image
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:9300/health || curl -fsS -o /dev/null http://127.0.0.1:9300/health"]
      interval: 5s
      timeout: 3s
      retries: 6
      start_period: 5s
"#;
        assert_eq!(got, want, "\n{got}");
    }

    #[test]
    fn k8s_oneshot_job_waiters_and_configmap() {
        let dir = files_dir("k8s");
        let got = k8s(&parse(ONESHOT), "prod", &dir).unwrap();
        for needle in [
            "kind: Job\nmetadata:\n  name: init-db\n",
            "backoffLimit: 0\n  activeDeadlineSeconds: 90\n",
            "restartPolicy: Never\n",
            "kind: ConfigMap\nmetadata:\n  name: init-db-files\n",
            "f0: \"SELECT 1;\\n\"",
            "f0: \"<a b=\\\"1\\\"/>\\n\"",
            "mountPath: \"/etc/geo/layers/a.json\"\n              subPath: f1\n",
            "path: f0\n              mode: 416\n",
            "kind: ServiceAccount\nmetadata:\n  name: prod-sidecar-wait\n",
            "serviceAccountName: prod-sidecar-wait\n      initContainers:\n        - name: wait-init-db\n",
            "args: [\"wait\", \"--for=condition=complete\", \"job/init-db\", \"--timeout=90s\"]",
            "kind: Deployment\nmetadata:\n  name: geoserver\n",
        ] {
            assert!(got.contains(needle), "missing {needle:?} in\n{got}");
        }
        // no oneshot, no waiters
        let plain = k8s(&parse(FULL), "prod", &dir).unwrap();
        assert!(!plain.contains("initContainers") && !plain.contains("ServiceAccount"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn k8s_files_size_limit_and_text() {
        let dir = files_dir("big");
        std::fs::write(dir.join("conf/server.xml"), vec![b'a'; 600 * 1024]).unwrap();
        let e = k8s(&parse(ONESHOT), "prod", &dir).unwrap_err().to_string();
        assert!(e.contains("512 KiB") && e.contains("geoserver"), "{e}");
        std::fs::write(dir.join("conf/server.xml"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(k8s(&parse(ONESHOT), "prod", &dir).unwrap_err().to_string().contains("UTF-8"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
