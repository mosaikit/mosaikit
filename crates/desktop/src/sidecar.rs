//! Sidecars of the distribution: extra processes started before the kernel and stopped after it.
//!
//! The release writes `sidecars.toml` next to the executable (see `[[sidecars]]` in
//! `distribution.toml`, architecture §14). The launcher starts every sidecar in dependency order,
//! waits for its health check (progress messages for the splash window, a timeout with a clear
//! error), supervises it with its restart policy and writes its output to
//! `<data_dir>/logs/sidecar-<name>.log`. At exit the sidecars stop in reverse order.
//!
//! A sidecar of kind `oneshot` runs to completion (exit code 0) before the next one starts, so the ones
//! that depend on it wait for it; a failure or a timeout stops the start with the tail of its log.
//! The `files` of a sidecar are copied into `sidecars/<name>/` before it starts.

use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Deserialize;

/// Name of the variable the kernel reads (exact `host:port` list of private hosts plugins may fetch).
pub const FETCH_HOSTS_VAR: &str = "MOSAIKIT_ALLOW_PRIVATE_FETCH_HOSTS";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
pub enum Restart {
    #[serde(rename = "never")]
    Never,
    #[default]
    #[serde(rename = "on-failure")]
    OnFailure,
    #[serde(rename = "always")]
    Always,
}

/// `service`: long-running, supervised. `oneshot`: runs to completion (exit code 0) before the
/// sidecars that depend on it start; never restarted, not health-checked, runs once per start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
pub enum Kind {
    #[default]
    #[serde(rename = "service")]
    Service,
    #[serde(rename = "oneshot")]
    Oneshot,
}

/// A file copied into `sidecars/<name>/<target>` at every start.
#[derive(Debug, Clone, Deserialize)]
pub struct FileDef {
    /// relative to the folder of `sidecars.toml`
    pub source: String,
    /// relative to `sidecars/<name>/`
    pub target: String,
    /// octal permissions (applied on Unix only)
    #[cfg_attr(not(unix), allow(dead_code))]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Def {
    pub name: String,
    #[serde(default)]
    pub kind: Kind,
    #[serde(default)]
    pub files: Vec<FileDef>,
    /// executable, relative to the folder of `sidecars.toml` (or absolute)
    pub command: Option<PathBuf>,
    #[serde(default)]
    pub args: Vec<String>,
    /// values `env:NAME` are read from the environment of the launcher
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// "tcp" or an HTTP path starting with '/'
    pub health: Option<String>,
    pub port: Option<u16>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub restart: Restart,
    #[serde(default = "default_timeout")]
    pub start_timeout_secs: u64,
}

fn default_timeout() -> u64 {
    30
}

/// Reads `sidecars.toml` in `dir`; no file means no sidecars.
pub fn load(dir: &Path) -> Result<Vec<Def>, String> {
    #[derive(Deserialize)]
    struct File {
        #[serde(default)]
        sidecars: Vec<Def>,
    }
    let file = dir.join("sidecars.toml");
    if !file.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&file).map_err(|e| format!("reading {}: {e}", file.display()))?;
    toml::from_str::<File>(&text).map(|f| f.sidecars).map_err(|e| format!("{}: {e}", file.display()))
}

/// `127.0.0.1:<port>` of every sidecar with a port.
pub fn fetch_hosts(defs: &[Def]) -> Vec<String> {
    defs.iter()
        .filter(|d| d.kind == Kind::Service)
        .filter_map(|d| d.port.map(|p| format!("127.0.0.1:{p}")))
        .collect()
}

/// Adds the addresses of the sidecars to the allowed private fetch hosts (before the configuration
/// is read); what the user already set stays.
pub fn export_fetch_hosts(defs: &[Def]) {
    let mine = fetch_hosts(defs);
    if mine.is_empty() {
        return;
    }
    let mut all: Vec<String> = std::env::var(FETCH_HOSTS_VAR)
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    for h in mine {
        if !all.contains(&h) {
            all.push(h);
        }
    }
    std::env::set_var(FETCH_HOSTS_VAR, all.join(","));
}

/// Indexes of `defs` in start order (dependencies first, otherwise the order of the file).
pub fn start_order(defs: &[Def]) -> Result<Vec<usize>, String> {
    let mut order: Vec<usize> = Vec::new();
    let mut left: Vec<usize> = (0..defs.len()).collect();
    while !left.is_empty() {
        let before = left.len();
        let mut i = 0;
        while i < left.len() {
            let d = &defs[left[i]];
            let ready = d.depends_on.iter().all(|n| order.iter().any(|&o| defs[o].name == *n));
            if ready {
                order.push(left.remove(i));
            } else {
                i += 1;
            }
        }
        if left.len() == before {
            let names: Vec<&str> = left.iter().map(|&i| defs[i].name.as_str()).collect();
            return Err(format!("sidecars depend on each other or on a missing one: {}", names.join(", ")));
        }
    }
    Ok(order)
}

struct Entry {
    name: String,
    child: Arc<Mutex<Option<Child>>>,
    monitor: Option<JoinHandle<()>>,
}

/// The sidecars that are running; `stop_all` stops them (reverse order).
pub struct Running {
    entries: Vec<Entry>,
    stopping: Arc<AtomicBool>,
}

fn backoff(attempt: u32) -> Duration {
    if cfg!(test) {
        Duration::from_millis(100)
    } else {
        Duration::from_secs((1u64 << attempt.min(5)).min(30))
    }
}

fn resolve_env(d: &Def) -> Result<Vec<(String, String)>, String> {
    let mut v = Vec::new();
    for (k, val) in &d.env {
        let val = match val.strip_prefix("env:") {
            Some(n) => std::env::var(n).map_err(|_| {
                format!("sidecar \"{}\": the environment variable {n} (for {k}) is not set", d.name)
            })?,
            None => val.clone(),
        };
        v.push((k.clone(), val));
    }
    Ok(v)
}

fn find_executable(d: &Def, base: &Path) -> Result<PathBuf, String> {
    let c =
        d.command.as_ref().ok_or_else(|| format!("sidecar \"{}\": no command in sidecars.toml", d.name))?;
    let p = base.join(c);
    if p.is_file() {
        return Ok(p);
    }
    if cfg!(windows) && p.extension().is_none() && p.with_extension("exe").is_file() {
        return Ok(p.with_extension("exe"));
    }
    Err(format!("sidecar \"{}\": executable not found: {}", d.name, p.display()))
}

fn spawn(d: &Def, exe: &Path, log: &Path) -> Result<Child, String> {
    let env = resolve_env(d)?;
    if let Some(dir) = log.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|e| format!("sidecar \"{}\": log {}: {e}", d.name, log.display()))?;
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |t| t.as_secs());
    let _ = writeln!(f, "--- start (unix time {secs}) ---");
    let err = f.try_clone().map_err(|e| format!("sidecar \"{}\": log: {e}", d.name))?;
    let mut cmd = Command::new(exe);
    cmd.args(&d.args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(f))
        .stderr(Stdio::from(err))
        .env("MOSAIKIT_SIDECAR_NAME", &d.name);
    if let Some(p) = d.port {
        cmd.env("MOSAIKIT_SIDECAR_PORT", p.to_string());
    }
    cmd.envs(env);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map_err(|e| format!("sidecar \"{}\": cannot start {}: {e}", d.name, exe.display()))
}

/// One health probe: "tcp" connects, "/path" expects a 2xx answer.
fn healthy(health: &str, port: u16) -> bool {
    let Some(addr) = ("127.0.0.1", port).to_socket_addrs().ok().and_then(|mut a| a.next()) else {
        return false;
    };
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    if health == "tcp" {
        return true;
    }
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let req = format!("GET {health} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 64];
    let n = s.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]);
    // "HTTP/1.1 200 OK"
    head.split_whitespace().nth(1).is_some_and(|c| c.starts_with('2'))
}

fn exit_text(status: std::process::ExitStatus) -> String {
    status.code().map_or_else(|| "was terminated".to_string(), |c| format!("exited with code {c}"))
}

/// Waits until the sidecar is ready. Err = clear message (the caller stops what was started).
fn wait_ready(d: &Def, child: &mut Child, log: &Path, report: &dyn Fn(&str)) -> Result<(), String> {
    let started = Instant::now();
    let limit = Duration::from_secs(d.start_timeout_secs);
    let mut last_report = Duration::ZERO;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("sidecar \"{}\": {e}", d.name))? {
            return Err(format!(
                "sidecar \"{}\" {} before it was ready (see {})",
                d.name,
                exit_text(status),
                log.display()
            ));
        }
        match (&d.health, d.port) {
            (Some(h), Some(p)) => {
                if healthy(h, p) {
                    return Ok(());
                }
            }
            // no health check: running after a short moment is enough
            _ => {
                if started.elapsed() >= Duration::from_millis(300) {
                    return Ok(());
                }
            }
        }
        let e = started.elapsed();
        if e >= limit {
            return Err(format!(
                "sidecar \"{}\" did not become ready within {} s (health {}, port {}; see {})",
                d.name,
                d.start_timeout_secs,
                d.health.as_deref().unwrap_or("-"),
                d.port.map_or("-".into(), |p| p.to_string()),
                log.display()
            ));
        }
        if e - last_report >= Duration::from_secs(2) {
            last_report = e;
            report(&format!("Waiting for {} ({} s)", d.name, e.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Where the overlay files of a sidecar go: `<base>/sidecars/<name>/<target>`; a target that is
/// absolute or contains `..` is refused.
fn file_target(d: &Def, base: &Path, target: &str) -> Result<PathBuf, String> {
    let t = target.replace('\\', "/");
    if t.is_empty()
        || t.starts_with('/')
        || t.as_bytes().get(1) == Some(&b':')
        || t.split('/').any(|c| c == "..")
    {
        return Err(format!(
            "sidecar \"{}\": file target \"{target}\" must be relative to sidecars/{}/ and stay inside it",
            d.name, d.name
        ));
    }
    Ok(base.join("sidecars").join(&d.name).join(t))
}

/// The sources of the overlay exist and the targets are acceptable (nothing is written).
fn check_files(d: &Def, base: &Path) -> Result<(), String> {
    for f in &d.files {
        file_target(d, base, &f.target)?;
        let src = base.join(&f.source);
        if !src.is_file() {
            return Err(format!("sidecar \"{}\": file {} not found", d.name, src.display()));
        }
    }
    Ok(())
}

/// Copies the overlay files into the folder of the sidecar (at every start, replacing what is there).
fn apply_files(d: &Def, base: &Path) -> Result<(), String> {
    for f in &d.files {
        let to = file_target(d, base, &f.target)?;
        let from = base.join(&f.source);
        let ctx = |e: std::io::Error| {
            format!("sidecar \"{}\": copying {} to {}: {e}", d.name, from.display(), to.display())
        };
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p).map_err(ctx)?;
        }
        std::fs::copy(&from, &to).map_err(ctx)?;
        #[cfg(unix)]
        if let Some(m) = f.mode.as_deref().and_then(|m| u32::from_str_radix(m, 8).ok()) {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&to, std::fs::Permissions::from_mode(m)).map_err(ctx)?;
        }
    }
    Ok(())
}

/// The last lines this run wrote to the log (from byte `from`), for an error message.
fn log_tail(log: &Path, from: u64) -> String {
    let bytes = std::fs::read(log).unwrap_or_default();
    let text = String::from_utf8_lossy(&bytes[(from as usize).min(bytes.len())..]).to_string();
    let lines: Vec<&str> = text.lines().filter(|l| !l.starts_with("--- start")).collect();
    let tail = lines[lines.len().saturating_sub(15)..].join("\n");
    let n = tail.chars().count();
    let tail = if n > 2000 { tail.chars().skip(n - 2000).collect::<String>() } else { tail };
    if tail.trim().is_empty() {
        "(the log is empty)".to_string()
    } else {
        tail
    }
}

/// Runs a oneshot sidecar to completion: exit code 0 is success; another code or exceeding
/// `start_timeout_secs` is an error that shows the end of the log.
fn run_oneshot(d: &Def, exe: &Path, log: &Path, report: &dyn Fn(&str)) -> Result<(), String> {
    let from = std::fs::metadata(log).map_or(0, |m| m.len());
    let mut child = spawn(d, exe, log)?;
    let started = Instant::now();
    let limit = Duration::from_secs(d.start_timeout_secs);
    let mut last_report = Duration::ZERO;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("sidecar \"{}\": {e}", d.name))? {
            if status.success() {
                return Ok(());
            }
            return Err(format!(
                "sidecar \"{}\" (oneshot) {} instead of 0 (see {}). Last lines of its log:\n{}",
                d.name,
                exit_text(status),
                log.display(),
                log_tail(log, from)
            ));
        }
        let e = started.elapsed();
        if e >= limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "sidecar \"{}\" (oneshot) did not finish within {} s (see {}). Last lines of its log:\n{}",
                d.name,
                d.start_timeout_secs,
                log.display(),
                log_tail(log, from)
            ));
        }
        if e - last_report >= Duration::from_secs(2) {
            last_report = e;
            report(&format!("Running {} ({} s)", d.name, e.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Starts every sidecar in dependency order. On failure the ones already started are stopped.
/// A oneshot runs to completion before the next one starts, so its dependants wait for it.
pub fn start_all(
    defs: &[Def],
    base: &Path,
    log_dir: &Path,
    report: &dyn Fn(&str),
) -> Result<Running, String> {
    let order = start_order(defs)?;
    // every executable is checked first: a missing file must not leave anything running
    let mut exes = BTreeMap::new();
    for &i in &order {
        exes.insert(i, find_executable(&defs[i], base)?);
        check_files(&defs[i], base)?;
    }
    let stopping = Arc::new(AtomicBool::new(false));
    let mut run = Running { entries: Vec::new(), stopping: stopping.clone() };
    for (n, &i) in order.iter().enumerate() {
        let d = &defs[i];
        let log = log_dir.join(format!("sidecar-{}.log", d.name));
        let verb = if d.kind == Kind::Oneshot { "Running" } else { "Starting" };
        report(&format!("{verb} {} ({}/{})", d.name, n + 1, order.len()));
        if let Err(e) = apply_files(d, base) {
            run.stop_all(report);
            return Err(e);
        }
        if d.kind == Kind::Oneshot {
            if let Err(e) = run_oneshot(d, &exes[&i], &log, report) {
                run.stop_all(report);
                return Err(e);
            }
            continue;
        }
        let mut child = match spawn(d, &exes[&i], &log) {
            Ok(c) => c,
            Err(e) => {
                run.stop_all(report);
                return Err(e);
            }
        };
        if let Err(e) = wait_ready(d, &mut child, &log, report) {
            let _ = child.kill();
            let _ = child.wait();
            run.stop_all(report);
            return Err(e);
        }
        let slot = Arc::new(Mutex::new(Some(child)));
        let monitor = monitor(d.clone(), exes[&i].clone(), log, slot.clone(), stopping.clone());
        run.entries.push(Entry { name: d.name.clone(), child: slot, monitor: Some(monitor) });
    }
    Ok(run)
}

/// Supervision: restarts the process according to the policy (with a growing pause; it gives up
/// after 5 restarts in less than a minute).
fn monitor(
    d: Def,
    exe: PathBuf,
    log: PathBuf,
    slot: Arc<Mutex<Option<Child>>>,
    stopping: Arc<AtomicBool>,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut recent: Vec<Instant> = Vec::new();
        loop {
            std::thread::sleep(Duration::from_millis(100));
            if stopping.load(Ordering::SeqCst) {
                return;
            }
            let status = {
                let mut g = slot.lock().unwrap_or_else(|e| e.into_inner());
                match g.as_mut().map(Child::try_wait) {
                    Some(Ok(Some(s))) => s,
                    Some(_) => continue,
                    None => return,
                }
            };
            let restart = match d.restart {
                Restart::Never => false,
                Restart::OnFailure => !status.success(),
                Restart::Always => true,
            };
            tracing::warn!("sidecar {} {}", d.name, exit_text(status));
            if !restart {
                return;
            }
            recent.retain(|t| t.elapsed() < Duration::from_secs(60));
            if recent.len() >= 5 {
                tracing::error!("sidecar {}: too many restarts, giving up (see {})", d.name, log.display());
                return;
            }
            let pause = backoff(recent.len() as u32);
            recent.push(Instant::now());
            let until = Instant::now() + pause;
            while Instant::now() < until {
                if stopping.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            let mut g = slot.lock().unwrap_or_else(|e| e.into_inner());
            if stopping.load(Ordering::SeqCst) {
                return;
            }
            match spawn(&d, &exe, &log) {
                Ok(c) => {
                    tracing::info!("sidecar {} restarted", d.name);
                    *g = Some(c);
                }
                Err(e) => {
                    tracing::error!("{e}");
                    *g = None;
                    return;
                }
            }
        }
    })
}

impl Running {
    /// Stops the sidecars in reverse start order (the dependents first).
    pub fn stop_all(&mut self, report: &dyn Fn(&str)) {
        self.stopping.store(true, Ordering::SeqCst);
        while let Some(mut e) = self.entries.pop() {
            report(&format!("Stopping {}", e.name));
            if let Some(h) = e.monitor.take() {
                let _ = h.join();
            }
            let child = e.child.lock().unwrap_or_else(|x| x.into_inner()).take();
            if let Some(mut c) = child {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    const TEST_NAME: &str = "sidecar::tests::fake_sidecar_main";

    /// Not a test: the sidecar the tests start is this very test executable, running this function
    /// with FAKE_MODE set (serve = answer HTTP 200 on FAKE_PORT; crash_later = count the start in
    /// FAKE_COUNT and exit 1 after 600 ms; sleep = never listen).
    #[test]
    fn fake_sidecar_main() {
        let Ok(mode) = std::env::var("FAKE_MODE") else { return };
        match mode.as_str() {
            "serve" => {
                let port: u16 = std::env::var("FAKE_PORT").unwrap().parse().unwrap();
                let l = TcpListener::bind(("127.0.0.1", port)).unwrap();
                for s in l.incoming().flatten() {
                    let mut s = s;
                    let mut b = [0u8; 256];
                    let _ = s.read(&mut b);
                    let _ =
                        s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
                }
            }
            "crash_later" => {
                let f = std::env::var("FAKE_COUNT").unwrap();
                let mut o = std::fs::OpenOptions::new().create(true).append(true).open(f).unwrap();
                writeln!(o, "start").unwrap();
                drop(o);
                std::thread::sleep(Duration::from_millis(600));
                std::process::exit(1);
            }
            "oneshot_ok" => {
                // slow on purpose: a dependant that started too early would not see the marker
                std::thread::sleep(Duration::from_millis(700));
                let mark = std::env::var("FAKE_MARK").unwrap();
                let mut o = std::fs::OpenOptions::new().create(true).append(true).open(mark).unwrap();
                writeln!(o, "ran").unwrap();
            }
            "oneshot_fail" => {
                println!("connecting to the database");
                println!("boom: database unreachable");
                std::process::exit(3);
            }
            "record" => {
                let mark = std::env::var("FAKE_MARK").unwrap();
                let out = std::env::var("FAKE_OUT").unwrap();
                let seen = std::fs::read_to_string(mark).unwrap_or_default();
                std::fs::write(out, format!("marker lines: {}", seen.lines().count())).unwrap();
                std::thread::sleep(Duration::from_secs(120));
            }
            _ => std::thread::sleep(Duration::from_secs(120)),
        }
    }

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    fn def(name: &str, mode: &str, extra: &[(&str, String)]) -> Def {
        let mut env: BTreeMap<String, String> = BTreeMap::new();
        env.insert("FAKE_MODE".into(), mode.into());
        for (k, v) in extra {
            env.insert((*k).into(), v.clone());
        }
        Def {
            name: name.into(),
            kind: Kind::Service,
            files: vec![],
            command: Some(std::env::current_exe().unwrap()),
            args: ["--exact", TEST_NAME, "--nocapture", "--test-threads=1"].map(String::from).to_vec(),
            env,
            health: None,
            port: None,
            depends_on: vec![],
            restart: Restart::OnFailure,
            start_timeout_secs: 30,
        }
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mosaikit-sidecar-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn no_report(_: &str) {}

    #[test]
    fn parses_sidecars_toml_and_orders() {
        let d = tmp("parse");
        std::fs::write(
            d.join("sidecars.toml"),
            "[[sidecars]]\nname='b'\ncommand='b'\ndepends_on=['a']\nport=9001\n\n[[sidecars]]\nname='a'\ncommand='a'\nport=9000\nrestart='always'\n",
        )
        .unwrap();
        let defs = load(&d).unwrap();
        assert_eq!(defs[1].restart, Restart::Always);
        assert_eq!(defs[0].restart, Restart::OnFailure);
        assert_eq!(start_order(&defs).unwrap(), [1, 0]);
        assert_eq!(fetch_hosts(&defs), ["127.0.0.1:9001", "127.0.0.1:9000"]);
        assert!(load(&tmp("none")).unwrap().is_empty());
        let mut cyc = defs.clone();
        cyc[1].depends_on = vec!["b".into()];
        assert!(start_order(&cyc).unwrap_err().contains("depend"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_executable_is_a_clear_error() {
        let d = tmp("missing");
        let mut a = def("ghost", "serve", &[]);
        a.command = Some("no/such/ghost".into());
        let e = start_all(&[a], &d, &d.join("logs"), &no_report).err().unwrap();
        assert!(e.contains("ghost") && e.contains("executable not found"), "{e}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_env_variable_is_a_clear_error() {
        let d = tmp("env");
        let mut a = def("e", "sleep", &[]);
        a.env.insert("TOKEN".into(), "env:MOSAIKIT_TEST_SURELY_UNSET_VARIABLE".into());
        let e = start_all(&[a], &d, &d.join("logs"), &no_report).err().unwrap();
        assert!(e.contains("MOSAIKIT_TEST_SURELY_UNSET_VARIABLE") && e.contains("not set"), "{e}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn health_stop_order_and_log() {
        let d = tmp("health");
        let (pa, pb) = (free_port(), free_port());
        let mut a = def("alpha", "serve", &[("FAKE_PORT", pa.to_string())]);
        a.health = Some("/health".into());
        a.port = Some(pa);
        let mut b = def("beta", "serve", &[("FAKE_PORT", pb.to_string())]);
        b.health = Some("tcp".into());
        b.port = Some(pb);
        b.depends_on = vec!["alpha".into()];
        let msgs = Mutex::new(Vec::<String>::new());
        let report = |m: &str| msgs.lock().unwrap().push(m.to_string());
        // listed in the wrong order on purpose: beta needs alpha
        let mut run = start_all(&[b, a], &d, &d.join("logs"), &report).expect("start");
        assert!(healthy("/health", pa) && healthy("tcp", pb));
        run.stop_all(&report);
        assert!(!healthy("tcp", pa) && !healthy("tcp", pb), "the processes are stopped");
        let m = msgs.lock().unwrap().clone();
        let pos = |s: &str| m.iter().position(|x| x == s).unwrap_or_else(|| panic!("{s} in {m:?}"));
        assert!(pos("Starting alpha (1/2)") < pos("Starting beta (2/2)"));
        assert!(pos("Stopping beta") < pos("Stopping alpha"), "stop in reverse order: {m:?}");
        assert!(d.join("logs").join("sidecar-alpha.log").is_file());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn health_timeout_is_a_clear_error_and_stops_everything() {
        let d = tmp("timeout");
        let p = free_port();
        let mut a = def("slow", "sleep", &[]);
        a.health = Some("tcp".into());
        a.port = Some(p);
        a.start_timeout_secs = 1;
        let e = start_all(&[a], &d, &d.join("logs"), &no_report).err().unwrap();
        assert!(e.contains("did not become ready within 1 s") && e.contains("slow"), "{e}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn exit_before_ready_is_reported() {
        let d = tmp("early");
        let mut a = def("early", "crash_later", &[("FAKE_COUNT", d.join("n").display().to_string())]);
        a.health = Some("tcp".into());
        a.port = Some(free_port());
        let e = start_all(&[a], &d, &d.join("logs"), &no_report).err().unwrap();
        assert!(e.contains("exited with code 1 before it was ready"), "{e}");
        let _ = std::fs::remove_dir_all(&d);
    }

    fn oneshot(name: &str, mode: &str, extra: &[(&str, String)]) -> Def {
        Def { kind: Kind::Oneshot, ..def(name, mode, extra) }
    }

    #[test]
    fn oneshot_succeeds_and_dependant_waits() {
        let d = tmp("oneshot-ok");
        let (mark, out) = (d.join("mark"), d.join("out"));
        let init = oneshot("init", "oneshot_ok", &[("FAKE_MARK", mark.display().to_string())]);
        let mut app = def(
            "app",
            "record",
            &[("FAKE_MARK", mark.display().to_string()), ("FAKE_OUT", out.display().to_string())],
        );
        app.depends_on = vec!["init".into()];
        let msgs = Mutex::new(Vec::<String>::new());
        let report = |m: &str| msgs.lock().unwrap().push(m.to_string());
        // dependant listed first on purpose
        let mut run = start_all(&[app, init], &d, &d.join("logs"), &report).expect("start");
        let until = Instant::now() + Duration::from_secs(10);
        while !out.exists() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(50));
        }
        run.stop_all(&report);
        assert_eq!(
            std::fs::read_to_string(&out).unwrap(),
            "marker lines: 1",
            "the dependant started after the oneshot"
        );
        let m = msgs.lock().unwrap().clone();
        assert!(
            m.contains(&"Running init (1/2)".to_string()) && m.contains(&"Starting app (2/2)".to_string()),
            "{m:?}"
        );
        assert!(!m.iter().any(|x| x == "Stopping init"), "a finished oneshot is not stopped: {m:?}");
        assert!(d.join("logs").join("sidecar-init.log").is_file());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn oneshot_failure_shows_the_log_tail_and_blocks_dependants() {
        let d = tmp("oneshot-fail");
        let out = d.join("out");
        let init = oneshot("init", "oneshot_fail", &[]);
        let mut app = def(
            "app",
            "record",
            &[("FAKE_MARK", d.join("m").display().to_string()), ("FAKE_OUT", out.display().to_string())],
        );
        app.depends_on = vec!["init".into()];
        let e = start_all(&[init, app], &d, &d.join("logs"), &no_report).err().unwrap();
        assert!(e.contains("\"init\"") && e.contains("exited with code 3"), "{e}");
        assert!(e.contains("boom: database unreachable"), "log tail in the error: {e}");
        std::thread::sleep(Duration::from_millis(500));
        assert!(!out.exists(), "the dependant must not start");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn oneshot_timeout_is_a_clear_error() {
        let d = tmp("oneshot-timeout");
        let mut init = oneshot("slowinit", "sleep", &[]);
        init.start_timeout_secs = 1;
        let e = start_all(&[init], &d, &d.join("logs"), &no_report).err().unwrap();
        assert!(e.contains("slowinit") && e.contains("did not finish within 1 s"), "{e}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn oneshot_runs_at_every_start_and_is_not_a_fetch_host() {
        let d = tmp("oneshot-twice");
        let mark = d.join("mark");
        let mut init = oneshot("init", "oneshot_ok", &[("FAKE_MARK", mark.display().to_string())]);
        init.port = Some(9999);
        assert!(fetch_hosts(&[init.clone()]).is_empty());
        for _ in 0..2 {
            start_all(&[init.clone()], &d, &d.join("logs"), &no_report).expect("start").stop_all(&no_report);
        }
        assert_eq!(starts(&mark), 2, "once per start");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn file_overlay_is_copied_at_every_start() {
        let d = tmp("overlay");
        std::fs::create_dir_all(d.join("sidecars/init/_files/conf")).unwrap();
        std::fs::write(d.join("sidecars/init/_files/conf/a.cfg"), "v1").unwrap();
        let mut init = oneshot("init", "oneshot_ok", &[("FAKE_MARK", d.join("mark").display().to_string())]);
        init.files = vec![FileDef {
            source: "sidecars/init/_files/conf/a.cfg".into(),
            target: "etc/a.cfg".into(),
            mode: Some("0600".into()),
        }];
        let target = d.join("sidecars/init/etc/a.cfg");
        start_all(&[init.clone()], &d, &d.join("logs"), &no_report).expect("start");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "v1");
        std::fs::write(d.join("sidecars/init/_files/conf/a.cfg"), "v2").unwrap();
        start_all(&[init.clone()], &d, &d.join("logs"), &no_report).expect("start");
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "v2", "replaced at the next start");
        // unsafe or missing: nothing runs
        for (src, dst, want) in [
            ("sidecars/init/_files/conf/a.cfg", "../escape.cfg", "must be relative"),
            ("sidecars/init/_files/conf/a.cfg", "/abs.cfg", "must be relative"),
            ("sidecars/init/_files/conf/none.cfg", "x.cfg", "not found"),
        ] {
            let mut bad = init.clone();
            bad.files = vec![FileDef { source: src.into(), target: dst.into(), mode: None }];
            let e = start_all(&[bad], &d, &d.join("logs"), &no_report).err().unwrap();
            assert!(e.contains(want), "{e}");
        }
        assert!(!d.join("sidecars/escape.cfg").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn parses_kind_and_files() {
        let d = tmp("parse-kind");
        std::fs::write(
            d.join("sidecars.toml"),
            "[[sidecars]]\nname='i'\nkind='oneshot'\ncommand='i'\nfiles=[{source='s/a', target='a', mode='0644'}]\n\n[[sidecars]]\nname='s'\ncommand='s'\ndepends_on=['i']\n",
        )
        .unwrap();
        let defs = load(&d).unwrap();
        assert_eq!(defs[0].kind, Kind::Oneshot);
        assert_eq!(defs[1].kind, Kind::Service);
        assert_eq!(defs[0].files[0].target, "a");
        assert_eq!(start_order(&defs).unwrap(), [0, 1]);
        let _ = std::fs::remove_dir_all(&d);
    }

    fn starts(file: &Path) -> usize {
        std::fs::read_to_string(file).map_or(0, |t| t.lines().count())
    }

    #[test]
    fn restart_policy() {
        let d = tmp("restart");
        let count = d.join("count");
        let mut a = def("flaky", "crash_later", &[("FAKE_COUNT", count.display().to_string())]);
        a.restart = Restart::OnFailure;
        let mut run = start_all(&[a.clone()], &d, &d.join("logs"), &no_report).expect("start");
        let until = Instant::now() + Duration::from_secs(20);
        while starts(&count) < 2 && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(starts(&count) >= 2, "restarted after a failure");
        run.stop_all(&no_report);
        let n = starts(&count);
        std::thread::sleep(Duration::from_millis(900));
        assert_eq!(starts(&count), n, "no restart after the stop");

        // never: exits and stays down
        let count2 = d.join("count2");
        let mut b = def("once", "crash_later", &[("FAKE_COUNT", count2.display().to_string())]);
        b.restart = Restart::Never;
        let mut run = start_all(&[b], &d, &d.join("logs"), &no_report).expect("start");
        std::thread::sleep(Duration::from_millis(2000));
        assert_eq!(starts(&count2), 1, "restart = never");
        run.stop_all(&no_report);
        let _ = std::fs::remove_dir_all(&d);
    }
}
