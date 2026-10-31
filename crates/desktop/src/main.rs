//! `mosaikit.exe`: Mosaikit desktop without a console window.
//!
//! The server runs in a thread with its own tokio runtime; the main thread
//! handles the icon in the notification area (menu: Open, Initial credentials,
//! Data folder, Log, Quit). "Quit" stops the server in an orderly way and with it
//! the embedded PostgreSQL. Log in `<data_dir>/logs/mosaikit.log`.
//! Sidecars of the distribution (`sidecars.toml` next to the executable) start before the kernel and stop
//! after it (see `sidecar.rs`).
//! A second run, with Mosaikit already active, only opens the browser.
//!
//! During the start, if it takes more than half a second, a small window shows name,
//! version and current phase. When the app is ready: at the first start the browser
//! opens, at the following ones a Windows notification with the address appears.
//!
//! It is the only executable of the desktop version: from a terminal it also accepts
//! the administration commands (`migrate`, `reset-password`, `config`, `--help`),
//! writing into the console it was started from.

// no console in release; in debug it stays, to see the logs
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod icon;
#[cfg(windows)]
mod notify;
mod sidecar;
#[cfg(windows)]
mod splash;
#[cfg(windows)]
mod tray;

use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};

use clap::Parser;
use mosaikit_kernel::{Config, Kernel};
use mosaikit_server::admin::{self, AdminCmd};

/// Without commands it starts the app with the icon in the notification area.
#[derive(Parser)]
#[command(
    version,
    about = "Desktop version: without commands it starts the app with the icon in the notification area"
)]
struct Cli {
    /// configuration file (default: MOSAIKIT_CONFIG, then mosaikit.toml next to the executable)
    #[arg(long, short, global = true)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Option<AdminCmd>,
}

/// Administration command in the console of the terminal; returns the exit code.
fn run_admin(path: Option<PathBuf>, base: PathBuf, cmd: AdminCmd) -> i32 {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("MOSAIKIT_LOG").unwrap_or_else(|_| "warn".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    let cfg = match Config::load(path.as_deref(), &base) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("configuration: {e}");
            return 2;
        }
    };
    if !matches!(cmd, AdminCmd::Config) && already_running(&cfg.bind) {
        eprintln!("the application is running: close it (icon menu > Quit) and try again");
        return 1;
    }
    match tokio::runtime::Runtime::new() {
        Ok(rt) => rt.block_on(admin::run(cfg, cmd)),
        Err(e) => {
            eprintln!("runtime: {e}");
            1
        }
    }
}

/// Notifications from the server thread to the interface thread.
pub enum Status {
    /// phase of the start (splash window)
    Progress(String),
    Ready,
    Failed(String),
    Stopped(Option<String>),
}

pub struct App {
    /// name of the product (brand)
    pub name: String,
    /// version of the product (brand)
    pub version: String,
    /// colours of the brand (splash window)
    pub colors: std::collections::BTreeMap<String, String>,
    /// icon of the brand for the notification area (.ico), if any
    pub icon: Option<PathBuf>,
    /// icon in an .ico file (splash window, notifications): the brand's or the Mosaikit one
    pub icon_file: PathBuf,
    /// first start: the browser opens; afterwards only the notification
    pub first_run: bool,
    pub app_url: String,
    pub data_dir: PathBuf,
    pub log_file: PathBuf,
    pub open_browser: bool,
}

fn init_log(dir: &Path) -> PathBuf {
    let logs = dir.join("logs");
    let _ = std::fs::create_dir_all(&logs);
    let file = logs.join("mosaikit.log");
    let filter = tracing_subscriber::EnvFilter::try_from_env("MOSAIKIT_LOG")
        .unwrap_or_else(|_| "info,sqlx=warn".into());
    match std::fs::OpenOptions::new().create(true).append(true).open(&file) {
        Ok(f) => tracing_subscriber::fmt()
            .with_env_filter(filter)
            .with_ansi(false)
            .with_writer(std::sync::Mutex::new(f))
            .init(),
        Err(_) => tracing_subscriber::fmt().with_env_filter(filter).init(),
    }
    file
}

/// File that marks that the app has already been started (and the browser already opened once).
pub fn first_run_marker(data_dir: &Path) -> PathBuf {
    data_dir.join(".avviato")
}

/// Does Mosaikit already answer on this address?
fn already_running(bind: &str) -> bool {
    use std::net::ToSocketAddrs;
    bind.to_socket_addrs().ok().and_then(|mut a| a.next()).is_some_and(|addr| {
        std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(500)).is_ok()
    })
}

/// Starts the server in a thread. `stop` stops the server; the state arrives on `status`.
fn spawn_server(
    cfg: Config,
    stop: tokio::sync::oneshot::Receiver<()>,
    status: mpsc::Sender<Status>,
    sidecars: (Vec<sidecar::Def>, PathBuf),
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        // sidecars first: the plugins may need them as soon as the kernel runs
        let (defs, base) = sidecars;
        let mut started = None;
        if !defs.is_empty() {
            let progress = status.clone();
            let report = move |p: &str| {
                let _ = progress.send(Status::Progress(p.to_string()));
            };
            match sidecar::start_all(&defs, &base, &cfg.data_dir.join("logs"), &report) {
                Ok(r) => started = Some(r),
                Err(e) => {
                    tracing::error!("{e}");
                    let _ = status.send(Status::Failed(e));
                    return;
                }
            }
        }
        // the kernel reports to a relay: before a final state (Failed, Stopped) reaches the interface
        // thread, which may exit the process, the sidecars are stopped (after the kernel, which has
        // already closed by then)
        let running = Arc::new(Mutex::new(started));
        let (relay_tx, relay_rx) = mpsc::channel();
        let relay = {
            let running = running.clone();
            std::thread::spawn(move || {
                for s in relay_rx {
                    if matches!(s, Status::Failed(_) | Status::Stopped(_)) {
                        let mut g = running.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(r) = g.as_mut() {
                            r.stop_all(&|m| tracing::info!("{m}"));
                        }
                        *g = None;
                    }
                    let _ = status.send(s);
                }
            })
        };
        serve_blocking(cfg, stop, relay_tx);
        let _ = relay.join();
    })
}

/// The kernel in this thread until `stop` fires (or the start fails).
fn serve_blocking(cfg: Config, stop: tokio::sync::oneshot::Receiver<()>, status: mpsc::Sender<Status>) {
    {
        let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(rt) => rt,
            Err(e) => {
                let _ = status.send(Status::Failed(format!("runtime: {e}")));
                return;
            }
        };
        let progress = status.clone();
        rt.block_on(async move {
            let report = move |p: &str| {
                let _ = progress.send(Status::Progress(p.to_string()));
            };
            let k = match Kernel::start_with_progress(cfg, &report).await {
                Ok(k) => k,
                Err(e) => {
                    tracing::error!("start failed: {e}");
                    let _ = status.send(Status::Failed(format!("start failed: {e}")));
                    return;
                }
            };
            let listeners = match mosaikit_server::bind(&k).await {
                Ok(l) => l,
                Err(e) => {
                    tracing::error!("{e}");
                    k.shutdown().await;
                    let _ = status.send(Status::Failed(e.to_string()));
                    return;
                }
            };
            let _ = status.send(Status::Ready);
            let r = mosaikit_server::serve_until(k.clone(), listeners, async {
                let _ = stop.await;
            })
            .await;
            tracing::info!("shutdown: closing the database");
            k.shutdown().await;
            let _ = status.send(Status::Stopped(r.err().map(|e| e.to_string())));
        });
    }
}

pub fn fatal(msg: &str) -> ! {
    tracing::error!("{msg}");
    #[cfg(windows)]
    tray::message_box("Mosaikit", msg, true);
    #[cfg(not(windows))]
    eprintln!("{msg}");
    std::process::exit(1)
}

fn main() {
    // with arguments it is used from a terminal: the output goes to its console
    #[cfg(windows)]
    if std::env::args_os().len() > 1 {
        tray::attach_parent_console();
    }
    let cli = Cli::parse();
    let (path, base) = mosaikit_server::config_path(cli.config);
    if let Some(cmd) = cli.cmd {
        std::process::exit(run_admin(path, base, cmd));
    }
    // sidecars of the distribution: their addresses are allowed for the plugins' fetches
    // (the variable must be set before the configuration is read)
    let sidecars = sidecar::load(&base).unwrap_or_else(|e| fatal(&format!("Invalid sidecars: {e}")));
    sidecar::export_fetch_hosts(&sidecars);
    let cfg = match Config::load(path.as_deref(), &base) {
        Ok(c) => c,
        Err(e) => fatal(&format!("Invalid configuration: {e}")),
    };
    let log_file = init_log(&cfg.data_dir);
    tracing::info!("Mosaikit desktop {} — configuration {:?}", mosaikit_kernel::KERNEL_VERSION, path);
    if already_running(&cfg.bind) {
        // second run: opening the app already active is enough
        mosaikit_server::open_browser(&cfg.app_url);
        return;
    }
    let brand = match &cfg.brand {
        Some(dir) => mosaikit_kernel::brand::Brand::load(dir).unwrap_or_else(|e| fatal(&e.to_string())),
        None => mosaikit_kernel::brand::Brand::default(),
    };
    let icon_file = brand.file("icon").unwrap_or_else(|| {
        // Mosaikit icon in a temporary .ico (the window and the notifications read a file)
        let f = std::env::temp_dir().join("mosaikit-icon.ico");
        let _ = std::fs::write(&f, icon::ico());
        f
    });
    let app = App {
        name: brand.name.clone(),
        version: brand.version().to_string(),
        colors: brand.colors.clone(),
        icon: brand.file("icon"),
        icon_file,
        first_run: !first_run_marker(&cfg.data_dir).is_file(),
        app_url: cfg.app_url.clone(),
        data_dir: cfg.data_dir.clone(),
        log_file,
        open_browser: cfg.open_browser,
    };
    let (stop_tx, stop_rx) = tokio::sync::oneshot::channel();
    let (status_tx, status_rx) = mpsc::channel();
    let server = spawn_server(cfg, stop_rx, status_tx, (sidecars, base));

    #[cfg(windows)]
    tray::run(&app, stop_tx, status_rx);

    #[cfg(not(windows))]
    {
        // outside Windows: no icon, it stops with Ctrl+C
        let _ = &app;
        let stop = std::sync::Mutex::new(Some(stop_tx));
        let _ = std::thread::spawn(move || {
            if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
                rt.block_on(async {
                    let _ = tokio::signal::ctrl_c().await;
                });
            }
            if let Some(tx) = stop.lock().ok().and_then(|mut s| s.take()) {
                let _ = tx.send(());
            }
        });
        for s in status_rx {
            match s {
                Status::Progress(p) => tracing::info!("start: {p}"),
                Status::Ready => {
                    if app.open_browser {
                        mosaikit_server::open_browser(&app.app_url);
                    }
                }
                Status::Failed(e) => fatal(&e),
                Status::Stopped(_) => break,
            }
        }
    }
    let _ = server.join();
}
