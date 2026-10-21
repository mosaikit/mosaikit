//! `mosaikit-server`: avvia l'applicazione o esegue comandi di amministrazione.
//! E' l'eseguibile delle installazioni server e di Docker; la versione desktop
//! ha un solo eseguibile con gli stessi comandi (crates/desktop).

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use mosaikit_kernel::{Config, Kernel};
use mosaikit_server::admin::{self, AdminCmd};
use mosaikit_server::{config_path, open_browser};

#[derive(Parser)]
#[command(name = "mosaikit-server", version, about = "Mosaikit: piattaforma a plugin multi-tenant")]
struct Cli {
    /// file di configurazione (default: MOSAIKIT_CONFIG, poi mosaikit.toml accanto all'eseguibile o nella cartella corrente)
    #[arg(long, short, global = true)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Avvia il server (default)
    Serve,
    #[command(flatten)]
    Admin(AdminCmd),
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("MOSAIKIT_LOG")
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();
    let cli = Cli::parse();
    let (path, base) = config_path(cli.config);
    let cfg = match Config::load(path.as_deref(), &base) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("configurazione: {e}");
            std::process::exit(2);
        }
    };
    if let Some(p) = &path {
        tracing::info!("configurazione: {}", p.display());
    }
    if let Some(Cmd::Admin(cmd)) = cli.cmd {
        std::process::exit(admin::run(cfg, cmd).await);
    }
    let k = match Kernel::start(cfg).await {
        Ok(k) => k,
        Err(e) => {
            eprintln!("avvio non riuscito: {e}");
            std::process::exit(1);
        }
    };
    if k.cfg.open_browser {
        open_browser(&k.cfg.app_url);
    }
    let code = match mosaikit_server::serve(k.clone()).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("server: {e}");
            1
        }
    };
    k.shutdown().await;
    std::process::exit(code);
}
