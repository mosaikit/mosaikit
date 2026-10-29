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

fn server_cmd(plugins: &[Plugin]) -> Result<Command> {
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
    if let Some(b) = crate::dist::current().brand.dir.as_ref().filter(|b| b.is_dir()) {
        c.env("MOSAIKIT_BRAND", b);
    }
    Ok(c)
}

fn plugin_of<'a>(plugins: &'a [Plugin], path: &Path) -> Option<&'a Plugin> {
    plugins.iter().find(|p| path.starts_with(p.dir.join("src")) || path == p.dir.join("Cargo.toml"))
}

pub fn dev(no_ui: bool) -> Result<()> {
    crate::db::up()?;
    let plugins = plugins::discover()?;
    plugins::ensure_npm()?;
    for r in plugins.iter().filter_map(|p| p.npm_root.as_ref()) {
        plugins::ensure_npm_in(r)?;
    }
    eprintln!("== initial build of the plugins");
    plugins::build_wasm(&plugins, false)?;
    plugins::build_ui(&plugins)?;

    let stop = Arc::new(AtomicBool::new(false));
    {
        let stop = stop.clone();
        ctrlc::set_handler(move || stop.store(true, Ordering::SeqCst))?;
    }

    let mut children: Vec<(String, Child)> = Vec::new();
    for p in plugins.iter().filter(|p| p.has_ui) {
        let c = plugins::npm_ui(p, "watch").spawn()?;
        children.push((format!("ui {}", p.id), c));
    }
    if !no_ui {
        let c = npm().current_dir(root()).args(["run", "dev", "-w", "ui/host"]).spawn()?;
        children.push(("vite host".into(), c));
    }
    let mut server = server_cmd(&plugins)?.spawn()?;

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
    for p in plugins.iter().filter(|p| p.crate_name.is_some()) {
        watcher.watch(&p.dir.join("src"), RecursiveMode::Recursive)?;
    }

    println!(
        "\n  Mosaikit in development\n  app:            http://127.0.0.1:5173  (host UI with HMR)\n  \
         server:         http://127.0.0.1:47080 (API)  ·  plugin: http://127.0.0.1:47081\n  \
         administrator:  tenant system, user admin, password {}\n  \
         (the password holds for a new database; Ctrl+C to quit)\n",
        std::env::var("MOSAIKIT_ADMIN_PASSWORD").unwrap_or_else(|_| DEV_ADMIN_PASSWORD.into())
    );

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
                    server = server_cmd(&plugins)?.spawn()?;
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
            if run(Command::new("cargo").current_dir(root()).args(["build", "-p", "mosaikit-server"])).is_ok()
            {
                if !cfg!(windows) {
                    kill_tree(&mut server);
                }
                server = server_cmd(&plugins)?.spawn()?;
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
