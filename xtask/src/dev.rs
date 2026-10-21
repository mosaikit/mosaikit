//! `cargo xtask dev`: ambiente di sviluppo con hot reload.
//!
//! - PostgreSQL di sviluppo (`db up`);
//! - plugin delle cartelle della distribuzione (`../mosaikit-plugins`, ...): WASM ricompilato
//!   a ogni modifica di `src`, UI con `vite build --watch`;
//!   il server (modalita' dev) ricarica moduli, manifest e migrazioni da solo;
//! - server ricompilato e riavviato a ogni modifica di `crates/`;
//! - UI host con Vite (HMR) su http://127.0.0.1:5173.

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

/// Termina un processo con tutti i suoi figli (npm/vite su Windows sono catene di processi).
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
    eprintln!("== build iniziale dei plugin");
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

    // osserva sorgenti del server e logica dei plugin
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
        "\n  Mosaikit in sviluppo\n  app:            http://127.0.0.1:5173  (UI host con HMR)\n  \
         server:         http://127.0.0.1:47080 (API)  ·  plugin: http://127.0.0.1:47081\n  \
         amministratore: tenant system, utente admin, password {}\n  \
         (la password vale per un database nuovo; Ctrl+C per uscire)\n",
        std::env::var("MOSAIKIT_ADMIN_PASSWORD").unwrap_or_else(|_| DEV_ADMIN_PASSWORD.into())
    );

    let crates_dir = root().join("crates");
    while !stop.load(Ordering::SeqCst) {
        let first = match rx.recv_timeout(Duration::from_millis(300)) {
            Ok(p) => p,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(Some(status)) = server.try_wait() {
                    eprintln!("server terminato ({status}): riparte alla prossima modifica di crates/");
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
                "== ricompilo la logica: {}",
                wasm.iter().map(|p| p.id.as_str()).collect::<Vec<_>>().join(", ")
            );
            if let Err(e) = plugins::build_wasm(&wasm, false) {
                eprintln!("build WASM fallita: {e}");
            }
        }
        if server_changed {
            eprintln!("== crates/ modificato: ricompilo e riavvio il server");
            if run(Command::new("cargo").current_dir(root()).args(["build", "-p", "mosaikit-server"])).is_ok()
            {
                kill_tree(&mut server);
                server = server_cmd(&plugins)?.spawn()?;
            }
        }
    }
    eprintln!("\narresto...");
    kill_tree(&mut server);
    for (_, mut c) in children {
        kill_tree(&mut c);
    }
    Ok(())
}
