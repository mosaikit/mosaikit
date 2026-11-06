//! `cargo xtask dev`: development environment with hot reload.
//!
//! - development PostgreSQL (`db up`);
//! - plugins of the folders of the distribution (`../mosaikit-plugins`, ...): WASM rebuilt
//!   at every change of `src`, UI with `vite build --watch`;
//!   the server (dev mode) reloads modules, manifests and migrations by itself;
//! - server rebuilt and restarted at every change of `crates/`;
//! - host UI with Vite (HMR) on http://127.0.0.1:5173.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use notify::{RecursiveMode, Watcher};

use crate::plugins::{self, Plugin};
use crate::util::{npm, root, run};

pub const DEV_ADMIN_PASSWORD: &str = "admin-sviluppo";
/// Address of the development Administrator (the email is required for every account).
pub const DEV_ADMIN_EMAIL: &str = "admin@example.test";

/// Ends a process with all its children (npm/vite on Windows are chains of processes).
pub fn kill_tree(child: &mut Child) {
    if cfg!(windows) {
        let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// A second development instance next to the main one: own ports, database, data and build folder.
#[derive(Clone)]
pub struct Instance {
    pub name: String,
    /// Vite; the server is on the next port, the plugins on the one after
    pub port: u16,
    /// plugin UIs on `<plugin>.localhost` origins instead of one shared origin
    pub wildcard: bool,
}

impl Instance {
    pub fn new(name: &str, port: u16) -> Self {
        let name: String = name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' })
            .collect();
        Self { name, port, wildcard: false }
    }
    pub fn wildcard(mut self, on: bool) -> Self {
        self.wildcard = on;
        self
    }
    fn plugin_url(&self) -> String {
        let plug = self.port + 2;
        if self.wildcard {
            format!("http://*.localhost:{plug}")
        } else {
            format!("http://127.0.0.1:{plug}")
        }
    }
    fn db(&self) -> String {
        format!("mosaikit_{}", self.name)
    }
    /// Own build folder: the running executable of the other instance cannot be replaced on Windows.
    fn target(&self) -> PathBuf {
        crate::heavy::temp_dir().join(format!("target-dev-{}", self.name))
    }
    /// Environment of the server and of the commands that rebuild it.
    fn env(&self, c: &mut Command) {
        let (vite, api, plug) = (self.port, self.port + 1, self.port + 2);
        c.env("CARGO_TARGET_DIR", self.target())
            .env("MOSAIKIT_URL", format!("http://127.0.0.1:{vite}"))
            .env("MOSAIKIT_LISTEN", format!("127.0.0.1:{api}"))
            .env("MOSAIKIT_PLUGIN_URL", self.plugin_url())
            .env("MOSAIKIT_PLUGIN_LISTEN", format!("127.0.0.1:{plug}"))
            .env("MOSAIKIT_DATA_DIR", root().join(".dev").join(format!("data-{}", self.name)))
            .env(
                "MOSAIKIT_DATABASE_URL",
                crate::e2e::admin_url().replace("/postgres", &format!("/{}", self.db())),
            );
    }
    fn ensure_db(&self) -> Result<()> {
        let db = self.db();
        if crate::e2e::psql(&format!("select 1 from pg_database where datname = '{db}'"))?.trim().is_empty() {
            crate::e2e::psql(&format!("create database {db}"))?;
        }
        Ok(())
    }
}

fn build_server(inst: Option<&Instance>) -> Result<()> {
    let mut c = Command::new("cargo");
    c.current_dir(root()).args(["build", "-p", "mosaikit-server"]);
    if let Some(i) = inst {
        i.env(&mut c);
    }
    run(&mut c)
}

fn server_cmd(plugins: &[Plugin], inst: Option<&Instance>) -> Result<Command> {
    let dirs = std::env::join_paths(plugins.iter().map(|p| p.dir.clone()))?;
    let mut c = Command::new("cargo");
    c.current_dir(root())
        .args(["run", "-p", "mosaikit-server", "--", "--config"])
        .arg(root().join("xtask").join("mosaikit.dev.toml"))
        .env(
            "MOSAIKIT_ADMIN_PASSWORD",
            std::env::var("MOSAIKIT_ADMIN_PASSWORD").unwrap_or_else(|_| DEV_ADMIN_PASSWORD.into()),
        )
        .env("MOSAIKIT_DEV_EMAILS", "1")
        .env(
            "MOSAIKIT_ADMIN_EMAIL",
            std::env::var("MOSAIKIT_ADMIN_EMAIL").unwrap_or_else(|_| DEV_ADMIN_EMAIL.into()),
        )
        .env(
            "MOSAIKIT_LOG",
            std::env::var("MOSAIKIT_LOG").unwrap_or_else(|_| "info,sqlx=warn,mosaikit=debug".into()),
        )
        .env("MOSAIKIT_DEV_PLUGINS", dirs);
    if let Some(i) = inst {
        i.env(&mut c);
    }
    if let Some(b) = crate::dist::current().brand.dir.as_ref().filter(|b| b.is_dir()) {
        c.env("MOSAIKIT_BRAND", b);
    }
    if crate::dist::current().has_seeds() {
        c.env("MOSAIKIT_PLUGIN_SETTINGS_FILE", crate::dist::current().dir.join("distribution.toml"));
    }
    Ok(c)
}

fn plugin_of<'a>(plugins: &'a [Plugin], path: &Path) -> Option<&'a Plugin> {
    plugins.iter().find(|p| path.starts_with(p.dir.join("src")) || path == p.dir.join("Cargo.toml"))
}

pub fn dev(no_ui: bool, inst: Option<Instance>) -> Result<()> {
    crate::db::up()?;
    let plugins = plugins::discover()?;
    plugins::ensure_npm()?;
    if let Some(i) = &inst {
        // the plugins are built and watched by the main instance: here only the server is built
        i.ensure_db()?;
    } else {
        for r in plugins.iter().filter_map(|p| p.npm_root.as_ref()) {
            plugins::ensure_npm_in(r)?;
        }
        eprintln!("== initial build of the plugins");
        plugins::build_wasm(&plugins, false)?;
        plugins::build_ui(&plugins)?;
    }

    let stop = Arc::new(AtomicBool::new(false));
    {
        let stop = stop.clone();
        ctrlc::set_handler(move || stop.store(true, Ordering::SeqCst))?;
    }

    let mut children: Vec<(String, Child)> = Vec::new();
    for p in plugins.iter().filter(|p| p.has_ui && inst.is_none()) {
        let c = plugins::npm_ui(p, "watch").spawn()?;
        children.push((format!("ui {}", p.id), c));
    }
    if !no_ui {
        let mut c = npm();
        c.current_dir(root()).args(["run", "dev", "-w", "ui/host"]);
        if let Some(i) = &inst {
            c.env("MOSAIKIT_DEV_VITE_PORT", i.port.to_string())
                .env("MOSAIKIT_DEV_SERVER_PORT", (i.port + 1).to_string());
        }
        let c = c.spawn()?;
        children.push(("vite host".into(), c));
    }
    let mut server = server_cmd(&plugins, inst.as_ref())?.spawn()?;

    // watches sources of the server and logic of the plugins
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(
                ev.kind,
                notify::EventKind::Modify(_) | notify::EventKind::Create(_) | notify::EventKind::Remove(_)
            ) {
                for p in ev.paths {
                    let _ = tx.send(p);
                }
            }
        }
    })?;
    watcher.watch(&root().join("crates"), RecursiveMode::Recursive)?;
    for p in plugins.iter().filter(|p| p.crate_name.is_some() && inst.is_none()) {
        watcher.watch(&p.dir.join("src"), RecursiveMode::Recursive)?;
    }

    if let Some(i) = &inst {
        println!(
            "\n  Mosaikit, instance {}\n  app:            http://127.0.0.1:{}  (host UI with HMR)\n  \
             server:         http://127.0.0.1:{} (API)  ·  plugin: http://127.0.0.1:{}\n  \
             database {}  ·  administrator: tenant system, user admin, password {}\n  (Ctrl+C to quit)\n",
            i.name,
            i.port,
            i.port + 1,
            i.port + 2,
            i.db(),
            std::env::var("MOSAIKIT_ADMIN_PASSWORD").unwrap_or_else(|_| DEV_ADMIN_PASSWORD.into())
        );
    } else {
        println!(
            "\n  Mosaikit in development\n  app:            http://127.0.0.1:5173  (host UI with HMR)\n  \
             server:         http://127.0.0.1:47080 (API)  ·  plugin: http://127.0.0.1:47081\n  \
             administrator:  tenant system, user admin, password {}\n  \
             (the password holds for a new database; Ctrl+C to quit)\n",
            std::env::var("MOSAIKIT_ADMIN_PASSWORD").unwrap_or_else(|_| DEV_ADMIN_PASSWORD.into())
        );
    }

    let crates_dir = root().join("crates");
    // the server is down because the last build failed: it restarts with the next one that succeeds
    let mut down = false;
    while !stop.load(Ordering::SeqCst) {
        let first = match rx.recv_timeout(Duration::from_millis(300)) {
            Ok(p) => p,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if down {
                    continue;
                }
                if let Ok(Some(status)) = server.try_wait() {
                    eprintln!("server ended ({status}): it restarts at the next change of crates/");
                    server = server_cmd(&plugins, inst.as_ref())?.spawn()?;
                    std::thread::sleep(Duration::from_secs(2));
                }
                continue;
            }
            Err(_) => break,
        };
        let mut paths = vec![first];
        let until = Instant::now() + Duration::from_millis(400);
        while let Ok(p) = rx.recv_timeout(until.saturating_duration_since(Instant::now())) {
            paths.push(p);
        }
        let relevant = |p: &PathBuf| p.extension().is_some_and(|e| e == "rs" || e == "sql" || e == "toml");
        let server_changed = paths.iter().any(|p| p.starts_with(&crates_dir) && relevant(p));
        let mut wasm: Vec<Plugin> = Vec::new();
        for p in &paths {
            if let Some(pl) = plugin_of(&plugins, p) {
                if !wasm.iter().any(|w| w.id == pl.id) {
                    wasm.push(pl.clone());
                }
            }
        }
        if !wasm.is_empty() {
            eprintln!(
                "== rebuilding the logic: {}",
                wasm.iter().map(|p| p.id.as_str()).collect::<Vec<_>>().join(", ")
            );
            if let Err(e) = plugins::build_wasm(&wasm, false) {
                eprintln!("WASM build failed: {e}");
            }
        }
        if server_changed {
            eprintln!("== crates/ changed: rebuilding and restarting the server");
            // on Windows the running executable cannot be replaced ("Access denied"): the server
            // stops before the build; elsewhere it stays up until the new one is ready
            if cfg!(windows) {
                kill_tree(&mut server);
            }
            if build_server(inst.as_ref()).is_ok() {
                if !cfg!(windows) {
                    kill_tree(&mut server);
                }
                server = server_cmd(&plugins, inst.as_ref())?.spawn()?;
                down = false;
            } else if cfg!(windows) {
                eprintln!("build failed: the server restarts at the next change that compiles");
                down = true;
            }
        }
    }
    eprintln!("\nshutting down...");
    kill_tree(&mut server);
    for (_, mut c) in children {
        kill_tree(&mut c);
    }
    Ok(())
}
