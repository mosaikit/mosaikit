//! `mosaikit.exe`: Mosaikit desktop senza finestra di console.
//!
//! Il server gira in un thread con il suo runtime tokio; il thread principale
//! gestisce l'icona nell'area di notifica (menu: Apri, Credenziali iniziali,
//! Cartella dati, Log, Esci). "Esci" ferma il server in modo ordinato e con lui
//! il PostgreSQL embedded. Log in `<data_dir>/logs/mosaikit.log`.
//! Una seconda esecuzione, con Mosaikit gia' attivo, apre solo il browser.
//!
//! Durante l'avvio, se dura piu' di mezzo secondo, una finestrella mostra nome,
//! versione e fase in corso. Quando l'app e' pronta: al primo avvio si apre il
//! browser, ai successivi compare una notifica di Windows con l'indirizzo.
//!
//! E' l'unico eseguibile della versione desktop: da un terminale accetta anche
//! i comandi di amministrazione (`migrate`, `reset-password`, `config`, `--help`),
//! scrivendo nella console da cui e' stato lanciato.

// in release nessuna console; in debug resta, per vedere i log
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod icon;
#[cfg(windows)]
mod notify;
#[cfg(windows)]
mod splash;
#[cfg(windows)]
mod tray;

use std::path::{Path, PathBuf};
use std::sync::mpsc;

use clap::Parser;
use mosaikit_kernel::{Config, Kernel};
use mosaikit_server::admin::{self, AdminCmd};

/// Senza comandi avvia l'app con l'icona nell'area di notifica.
#[derive(Parser)]
#[command(version, about = "Versione desktop: senza comandi avvia l'app con l'icona nell'area di notifica")]
struct Cli {
    /// file di configurazione (default: MOSAIKIT_CONFIG, poi mosaikit.toml accanto all'eseguibile)
    #[arg(long, short, global = true)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Option<AdminCmd>,
}

/// Comando di amministrazione nella console del terminale; ritorna il codice di uscita.
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
            eprintln!("configurazione: {e}");
            return 2;
        }
    };
    if !matches!(cmd, AdminCmd::Config) && already_running(&cfg.bind) {
        eprintln!("l'applicazione e' in esecuzione: chiudila (menu dell'icona > Esci) e riprova");
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

/// Notifiche dal thread del server al thread dell'interfaccia.
pub enum Status {
    /// fase dell'avvio (finestra di avvio)
    Progress(String),
    Ready,
    Failed(String),
    Stopped(Option<String>),
}

pub struct App {
    /// nome del prodotto (marchio)
    pub name: String,
    /// versione del prodotto (marchio)
    pub version: String,
    /// colori del marchio (finestra di avvio)
    pub colors: std::collections::BTreeMap<String, String>,
    /// icona del marchio per l'area di notifica (.ico), se presente
    pub icon: Option<PathBuf>,
    /// icona in un file .ico (finestra di avvio, notifiche): del marchio o quella di Mosaikit
    pub icon_file: PathBuf,
    /// primo avvio: si apre il browser; poi solo la notifica
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

/// File che segna che l'app e' gia' stata avviata (e il browser gia' aperto una volta).
pub fn first_run_marker(data_dir: &Path) -> PathBuf {
    data_dir.join(".avviato")
}

/// Mosaikit risponde gia' su questo indirizzo?
fn already_running(bind: &str) -> bool {
    use std::net::ToSocketAddrs;
    bind.to_socket_addrs().ok().and_then(|mut a| a.next()).is_some_and(|addr| {
        std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(500)).is_ok()
    })
}

/// Avvia il server in un thread. `stop` ferma il server; lo stato arriva su `status`.
fn spawn_server(
    cfg: Config,
    stop: tokio::sync::oneshot::Receiver<()>,
    status: mpsc::Sender<Status>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
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
                    tracing::error!("avvio non riuscito: {e}");
                    let _ = status.send(Status::Failed(format!("avvio non riuscito: {e}")));
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
            tracing::info!("arresto: chiusura del database");
            k.shutdown().await;
            let _ = status.send(Status::Stopped(r.err().map(|e| e.to_string())));
        });
    })
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
    // con argomenti si usa da un terminale: l'output va nella sua console
    #[cfg(windows)]
    if std::env::args_os().len() > 1 {
        tray::attach_parent_console();
    }
    let cli = Cli::parse();
    let (path, base) = mosaikit_server::config_path(cli.config);
    if let Some(cmd) = cli.cmd {
        std::process::exit(run_admin(path, base, cmd));
    }
    let cfg = match Config::load(path.as_deref(), &base) {
        Ok(c) => c,
        Err(e) => fatal(&format!("Configurazione non valida: {e}")),
    };
    let log_file = init_log(&cfg.data_dir);
    tracing::info!("Mosaikit desktop {} — configurazione {:?}", mosaikit_kernel::KERNEL_VERSION, path);
    if already_running(&cfg.bind) {
        // seconda esecuzione: basta aprire l'app gia' attiva
        mosaikit_server::open_browser(&cfg.app_url);
        return;
    }
    let brand = match &cfg.brand {
        Some(dir) => mosaikit_kernel::brand::Brand::load(dir).unwrap_or_else(|e| fatal(&e.to_string())),
        None => mosaikit_kernel::brand::Brand::default(),
    };
    let icon_file = brand.file("icon").unwrap_or_else(|| {
        // icona di Mosaikit in un .ico temporaneo (la finestra e le notifiche leggono un file)
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
    let server = spawn_server(cfg, stop_rx, status_tx);

    #[cfg(windows)]
    tray::run(&app, stop_tx, status_rx);

    #[cfg(not(windows))]
    {
        // fuori da Windows: niente icona, si ferma con Ctrl+C
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
                Status::Progress(p) => tracing::info!("avvio: {p}"),
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
