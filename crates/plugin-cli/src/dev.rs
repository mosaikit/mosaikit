//! `dev`: starts the server of the kit in the developer profile for a plugin folder, opens the browser and prints
//! the addresses and the test users.
//!
//! The server is the `mosaikit-server` executable of the kit. Until the kit is downloaded (phase 7) it is found by
//! `--server <path>`, the variable `MOSAIKIT_SERVER_BIN`, or next to this executable; nothing else is looked at, so
//! the tool knows no layout of any repository. The server reads the plugin folder itself (`[dev] plugins`): it
//! reloads the manifest, the migrations, the UI (`ui/dist`) and the compiled logic when they change. This tool
//! adds the builds: it builds once, then rebuilds the logic or the UI when their sources change.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime};

use anyhow::{bail, Context, Result};

use crate::project::{self, Plugin};
use crate::util::exe;
use crate::validate;

/// The password of the test users (`mosaikit_kernel::devprofile::PASSWORD`; the tool does not link the kernel).
pub const PASSWORD: &str = "mosaikit-dev";
/// The test users: name, role, where they sign in.
pub const USERS: [(&str, &str, &str); 4] = [
    ("admin", "Administrator", "Administrator access (#/admin)"),
    ("manager", "Tenant Manager", "tenant dev"),
    ("alice", "User", "tenant dev"),
    ("bob", "User", "tenant dev"),
];

#[derive(Debug, Clone, Default)]
pub struct Options {
    pub dir: PathBuf,
    /// the `mosaikit-server` executable (default: `MOSAIKIT_SERVER_BIN`, then next to this tool)
    pub server: Option<PathBuf>,
    /// port of the app; the plugins are served on the next one (default: the first free pair from 8080)
    pub port: Option<u16>,
    /// data folder of the server (default: `.mosaikit-dev` in the plugin folder)
    pub data: Option<PathBuf>,
    pub no_open: bool,
    pub no_build: bool,
    pub no_watch: bool,
    /// delete the data folder first: a new database, the tenant and the test users again
    pub fresh: bool,
}

/// Where the server executable is, or why it is not found.
pub fn find_server(explicit: Option<&Path>) -> Result<PathBuf> {
    let from_env = std::env::var_os("MOSAIKIT_SERVER_BIN").filter(|v| !v.is_empty()).map(PathBuf::from);
    if let Some(p) = explicit.map(Path::to_path_buf).or(from_env) {
        if p.is_file() {
            return Ok(p);
        }
        bail!("the server executable {} does not exist (--server / MOSAIKIT_SERVER_BIN)", p.display());
    }
    let name = exe("mosaikit-server");
    if let Some(p) = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join(&name))) {
        if p.is_file() {
            return Ok(p);
        }
    }
    bail!(
        "the development server ({name}) was not found. Give its path with --server <path> or the variable \
         MOSAIKIT_SERVER_BIN, or put it next to {}. It is the server of the Mosaikit kit.",
        exe("mosaikit-plugin")
    )
}

fn free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// The first pair of free ports (app, plugins) from `from`, or exactly `want`.
pub fn ports(want: Option<u16>, from: u16) -> Result<u16> {
    if let Some(p) = want {
        if !(free(p) && free(p + 1)) {
            bail!("the ports {p} and {} are not both free: choose another with --port", p + 1);
        }
        return Ok(p);
    }
    (from..from + 200)
        .step_by(2)
        .find(|p| free(*p) && free(p + 1))
        .context("no free pair of ports from 8080: use --port")
}

/// A TOML literal string for a path (single quotes: no escapes, so the backslashes of Windows stay).
fn lit(p: &Path) -> String {
    format!("'{}'", p.display().to_string().trim_start_matches(r"\\?\"))
}

/// The configuration of the server for the plugin: the developer profile on a loopback address.
pub fn config(p: &Plugin, data: &Path, port: u16) -> String {
    let target = p.cargo_root.clone().unwrap_or_else(|| p.dir.clone()).join("target");
    format!(
        "# written by `mosaikit-plugin dev` at every start: do not edit\n\
         url = \"http://127.0.0.1:{port}\"\n\
         listen = \"127.0.0.1:{port}\"\n\
         plugin_listen = \"127.0.0.1:{plugin}\"\n\
         data_dir = {data}\n\
         developer_profile = true\n\n\
         [dev]\nplugins = [{dir}]\ntarget_dir = {target}\n",
        plugin = port + 1,
        data = lit(data),
        dir = lit(&p.dir),
        target = lit(&target)
    )
}

/// Kills the server when the tool ends, whatever the way.
struct Server(Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn wait_ready(server: &mut Server, url: &str) -> Result<()> {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(2)).build()?;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(90) {
        if let Some(status) = server.0.try_wait()? {
            bail!("the server stopped at start ({status}); its message is above (the developer profile refuses to run in some places)");
        }
        if client.get(format!("{url}/api/health")).send().is_ok_and(|r| r.status().is_success()) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    bail!("the server does not answer on {url} after 90 seconds")
}

fn open_in_browser(url: &str) {
    let r = if cfg!(windows) {
        Command::new("explorer").arg(url).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(url).spawn()
    } else {
        Command::new("xdg-open").arg(url).spawn()
    };
    if let Err(e) = r {
        eprintln!("the browser did not open ({e}): open {url} yourself");
    }
}

/// The newest change under the folders (the sources of the logic or of the UI), by modification time.
fn newest(roots: &[PathBuf], exts: &[&str]) -> Option<SystemTime> {
    fn go(dir: &Path, exts: &[&str], best: &mut Option<SystemTime>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if !matches!(name.as_str(), "node_modules" | "target" | "dist" | ".git" | ".mosaikit-dev") {
                    go(&p, exts, best);
                }
            } else if exts.iter().any(|x| name.ends_with(x)) {
                if let Ok(t) = e.metadata().and_then(|m| m.modified()) {
                    if best.is_none_or(|b| t > b) {
                        *best = Some(t);
                    }
                }
            }
        }
    }
    let mut best = None;
    for r in roots {
        if r.is_file() {
            if let Ok(t) = std::fs::metadata(r).and_then(|m| m.modified()) {
                if best.is_none_or(|b| t > b) {
                    best = Some(t);
                }
            }
        } else {
            go(r, exts, &mut best);
        }
    }
    best
}

/// Starts the server and keeps the builds going until the server stops or the tool is interrupted.
pub fn dev(o: &Options) -> Result<()> {
    let p = Plugin::load(&o.dir)?;
    let report = validate::validate(&p.dir)?;
    if !report.ok() {
        report.print();
        bail!("{}: the plugin does not validate: fix the manifest first", p.id);
    }
    let bin = find_server(o.server.as_deref())?;
    if !o.no_build {
        project::build_wasm(std::slice::from_ref(&p), false)?;
        project::build_ui(std::slice::from_ref(&p))?;
    }
    let data = o.data.clone().unwrap_or_else(|| p.dir.join(".mosaikit-dev"));
    let data = std::path::absolute(&data).unwrap_or(data);
    if o.fresh && data.exists() {
        std::fs::remove_dir_all(&data).with_context(|| format!("deleting {}", data.display()))?;
    }
    std::fs::create_dir_all(&data)?;
    let port = ports(o.port, 8080)?;
    let conf = data.join("mosaikit.toml");
    std::fs::write(&conf, config(&p, &data.join("data"), port))?;

    let mut cmd = Command::new(&bin);
    cmd.arg("--config").arg(&conf).arg("serve");
    // the profile is on from the file, on this computer, with its own SQLite database: nothing of the
    // environment of the developer (a DATABASE_URL, another address, the flag that lifts the guards) takes part
    for var in [
        "MOSAIKIT_DEVELOPER_PROFILE_ALLOW_REMOTE",
        "MOSAIKIT_DATABASE",
        "MOSAIKIT_DATABASE_URL",
        "DATABASE_URL",
        "MOSAIKIT_URL",
        "MOSAIKIT_PLUGIN_URL",
        "MOSAIKIT_LISTEN",
        "MOSAIKIT_PLUGIN_LISTEN",
        "MOSAIKIT_TRUST_PROXY",
        "MOSAIKIT_DEV_PLUGINS",
        "MOSAIKIT_DATA_DIR",
    ] {
        cmd.env_remove(var);
    }
    cmd.stdin(Stdio::null());
    let mut server = Server(cmd.spawn().with_context(|| format!("starting {}", bin.display()))?);
    let url = format!("http://127.0.0.1:{port}");
    wait_ready(&mut server, &url)?;

    println!();
    println!("Mosaikit developer profile for {} ({})", p.id, p.dir.display());
    println!("  app      {url}/");
    println!("  plugins  http://*.localhost:{} (one origin per plugin)", port + 1);
    println!("  data     {}", data.display());
    println!("  test users (password {PASSWORD}):");
    for (name, role, door) in USERS {
        println!("    {name:<8} {role:<15} {door}");
    }
    println!("  plugin   {url}/#/t/dev/p/{}", p.id);
    println!("The manifest, the migrations, the UI and the logic reload when they change. Ctrl+C stops it.");
    if !o.no_open {
        open_in_browser(&format!("{url}/#/t/dev/p/{}", p.id));
    }

    let logic: Vec<PathBuf> = [p.dir.join("src"), p.dir.join("Cargo.toml")].into();
    let ui: Vec<PathBuf> = [p.dir.join("ui").join("src"), p.dir.join("ui").join("index.html")].into();
    let (mut seen_logic, mut seen_ui) =
        (newest(&logic, &[".rs", ".toml"]), newest(&ui, &[".ts", ".tsx", ".css", ".html"]));
    loop {
        std::thread::sleep(Duration::from_millis(800));
        if let Some(status) = server.0.try_wait()? {
            bail!("the server stopped ({status})");
        }
        if o.no_watch || o.no_build {
            continue;
        }
        let now = newest(&logic, &[".rs", ".toml"]);
        if p.crate_name.is_some() && now != seen_logic {
            seen_logic = now;
            eprintln!("logic changed: building…");
            if let Err(e) = project::build_wasm(std::slice::from_ref(&p), false) {
                eprintln!("build of the logic failed: {e:#}");
            }
        }
        let now = newest(&ui, &[".ts", ".tsx", ".css", ".html"]);
        if p.has_ui && now != seen_ui {
            seen_ui = now;
            eprintln!("UI changed: building…");
            if let Err(e) = project::build_ui(std::slice::from_ref(&p)) {
                eprintln!("build of the UI failed: {e:#}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(dir: &Path) -> Plugin {
        std::fs::write(
            dir.join("plugin.toml"),
            "id = \"com.test.dev\"\nname = \"Dev\"\nversion = \"0.1.0\"\nabi = 1\n",
        )
        .unwrap();
        Plugin::load(dir).unwrap()
    }

    #[test]
    fn the_server_is_found_by_path_or_the_message_says_what_to_do() {
        let d = tempfile::tempdir().unwrap();
        let bin = d.path().join(exe("mosaikit-server"));
        std::fs::write(&bin, "").unwrap();
        assert_eq!(find_server(Some(&bin)).unwrap(), bin);
        let e = find_server(Some(&d.path().join("missing"))).unwrap_err().to_string();
        assert!(e.contains("does not exist"), "{e}");
    }

    #[test]
    fn the_configuration_turns_the_profile_on_for_loopback_only() {
        let d = tempfile::tempdir().unwrap();
        let p = plugin(d.path());
        let c = config(&p, &d.path().join("data"), 18080);
        let v: toml::Value = toml::from_str(&c).expect("valid toml");
        assert_eq!(v["developer_profile"].as_bool(), Some(true));
        assert_eq!(v["listen"].as_str(), Some("127.0.0.1:18080"));
        assert_eq!(v["plugin_listen"].as_str(), Some("127.0.0.1:18081"));
        assert_eq!(v["dev"]["plugins"][0].as_str(), Some(p.dir.display().to_string().as_str()));
        assert!(v.get("developer_profile_allow_remote").is_none());
    }

    #[test]
    fn ports_come_in_free_pairs() {
        let a = ports(None, 20000).unwrap();
        assert!(free(a) && free(a + 1));
        let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let taken = held.local_addr().unwrap().port();
        assert!(ports(Some(taken), 20000).is_err());
    }

    #[test]
    fn changes_are_seen_by_modification_time() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        assert!(newest(&[d.path().join("src")], &[".rs"]).is_none());
        std::fs::write(d.path().join("src").join("lib.rs"), "").unwrap();
        assert!(newest(&[d.path().join("src")], &[".rs"]).is_some());
        std::fs::create_dir_all(d.path().join("node_modules")).unwrap();
        std::fs::write(d.path().join("node_modules").join("x.rs"), "").unwrap();
        let before = newest(&[d.path().to_path_buf()], &[".rs"]);
        assert_eq!(before, newest(&[d.path().join("src")], &[".rs"]), "node_modules is left out");
    }
}
