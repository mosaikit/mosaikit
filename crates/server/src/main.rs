//! `mosaikit-server`: starts the application or runs administration commands.
//! It is the executable of the server and Docker installations; the desktop version
//! has a single executable with the same commands (crates/desktop).

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use mosaikit_kernel::{Config, Kernel};
use mosaikit_server::admin::{self, AdminCmd};
use mosaikit_server::{config_path, open_browser};

#[derive(Parser)]
#[command(name = "mosaikit-server", version, about = "Mosaikit: multi-tenant plugin platform")]
struct Cli {
    /// configuration file (default: MOSAIKIT_CONFIG, then mosaikit.toml next to the executable or in the current folder)
    #[arg(long, short, global = true)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Option<Cmd>,
}

#[derive(Subcommand)]
enum Cmd {
    /// Starts the server (default)
    Serve,
    #[command(flatten)]
    Admin(AdminCmd),
}

/// The futures of the start are deep in a debug build and the main thread of Windows has 1 MB of stack: the
/// server runs on a thread with a large one.
fn main() {
    let thread = std::thread::Builder::new()
        .name("mosaikit".into())
        .stack_size(64 << 20)
        .spawn(|| {
            tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("runtime").block_on(run())
        })
        .expect("thread of the server");
    if thread.join().is_err() {
        std::process::exit(1);
    }
}

async fn run() {
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
            eprintln!("configuration: {e}");
            std::process::exit(2);
        }
    };
    if let Some(p) = &path {
        tracing::info!("configuration: {}", p.display());
    }
    if let Some(Cmd::Admin(cmd)) = cli.cmd {
        std::process::exit(admin::run(cfg, cmd).await);
    }
    let k = match Kernel::start(cfg).await {
        Ok(k) => k,
        Err(e) => {
            eprintln!("start failed: {e}");
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
