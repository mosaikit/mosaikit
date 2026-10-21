//! `cargo xtask <comando>`: sviluppo, test e release di Mosaikit senza script bash.

mod ci;
mod db;
mod dev;
mod dist;
mod e2e;
mod plugins;
mod release;
mod util;

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "cargo xtask", about = "Automazione del progetto Mosaikit")]
struct Cli {
    /// distribuzione da usare (cartella o file distribution.toml; default: quella di mosaikit)
    #[arg(long, global = true, env = "MOSAIKIT_DIST")]
    dist: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// PostgreSQL di sviluppo (.dev/pg, porta 55432)
    Db {
        #[command(subcommand)]
        cmd: DbCmd,
    },
    /// Ambiente di sviluppo con hot reload (DB, server, Vite, plugin)
    Dev {
        /// non avviare Vite per la UI host
        #[arg(long)]
        no_ui: bool,
    },
    /// Plugin: build, pacchetti, scaffolding
    Plugin {
        #[command(subcommand)]
        cmd: PluginCmd,
    },
    /// Test Rust (con PostgreSQL) e test delle UI
    Test {
        /// non avviare il cluster di sviluppo (usa MOSAIKIT_TEST_DATABASE_URL)
        #[arg(long)]
        skip_db: bool,
    },
    /// Controlli della CI: fmt, clippy, deny, typecheck, lint, build, test
    Ci,
    /// Test end-to-end nel browser (Playwright) su un'installazione completa
    E2e {
        /// mostra il browser
        #[arg(long)]
        headed: bool,
    },
    /// Release
    Release {
        #[command(subcommand)]
        cmd: ReleaseCmd,
    },
}

#[derive(Subcommand)]
enum DbCmd {
    /// Avvia (e se serve inizializza) il cluster di sviluppo
    Up,
    /// Ferma il cluster di sviluppo
    Down,
    /// Ricrea da zero il cluster di sviluppo
    Reset,
    /// Elimina i database lasciati da test interrotti
    CleanTests,
    /// Stampa gli URL di connessione
    Url,
}

#[derive(Subcommand)]
enum PluginCmd {
    /// Compila logica (WASM) e UI di tutti i plugin
    Build {
        #[arg(long)]
        release: bool,
    },
    /// Crea i pacchetti .mskp firmati e l'index.json del registry
    Pack {
        #[arg(long)]
        release: bool,
        #[arg(long, default_value = "dist/registry")]
        out: PathBuf,
    },
    /// Nuovo plugin dal template (xtask/templates/plugin)
    New {
        name: String,
        /// id del plugin (default com.example.<nome>)
        #[arg(long)]
        id: Option<String>,
        /// senza logica WASM (solo manifest, migrazioni e UI)
        #[arg(long)]
        no_logic: bool,
        /// cartella in cui crearlo (default: la prima di [plugins] roots della distribuzione)
        #[arg(long)]
        into: Option<PathBuf>,
    },
    /// Azzera schema e dati di un plugin nel database di sviluppo
    DbReset { id: String },
    /// Genera una coppia di chiavi ed25519 per firmare i pacchetti
    Keygen {
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum ReleaseCmd {
    /// Server release + plugin firmati + registry in una cartella
    Bundle {
        #[arg(long)]
        out: PathBuf,
        /// la UI e' gia' compilata (es. nel Dockerfile)
        #[arg(long)]
        skip_ui: bool,
        #[arg(long, value_enum, default_value = "server")]
        flavor: release::Flavor,
    },
    /// Zip desktop in dist/ (SQLite; PostgreSQL embedded se la distribuzione lo chiede)
    Desktop {
        /// distribuzione con database postgres: cartella di PostgreSQL da includere (bin/, lib/, share/)
        #[arg(long)]
        pg_dir: Option<PathBuf>,
        /// distribuzione con database postgres: non includerlo (usera' quello installato)
        #[arg(long)]
        no_pg: bool,
    },
    /// Immagine Docker del server + cartelle Docker (compose) e Kubernetes in dist/
    Docker {
        #[arg(long)]
        tag: Option<String>,
    },
    /// Solo i manifest Kubernetes (kustomize) in dist/, senza costruire l'immagine
    K8s {
        /// immagine (default <immagine della distribuzione>:<versione>)
        #[arg(long)]
        tag: Option<String>,
    },
    /// Tutte le release in dist/: desktop, Docker e Kubernetes
    All {
        #[arg(long)]
        pg_dir: Option<PathBuf>,
        #[arg(long)]
        no_pg: bool,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    dist::init(cli.dist)?;
    match cli.cmd {
        Cmd::Db { cmd } => match cmd {
            DbCmd::Up => db::up(),
            DbCmd::Down => db::down(),
            DbCmd::Reset => db::reset(),
            DbCmd::CleanTests => db::clean_tests(),
            DbCmd::Url => {
                println!("sviluppo: {}", db::dev_url());
                println!("test:     {}", db::test_url());
                Ok(())
            }
        },
        Cmd::Dev { no_ui } => dev::dev(no_ui),
        Cmd::Plugin { cmd } => match cmd {
            PluginCmd::Build { release } => {
                let all = plugins::discover()?;
                plugins::build_wasm(&all, release)?;
                plugins::build_ui(&all)
            }
            PluginCmd::Pack { release, out } => {
                let all = plugins::discover()?;
                plugins::build_wasm(&all, release)?;
                plugins::build_ui(&all)?;
                let out = if out.is_relative() { util::root().join(out) } else { out };
                let index = plugins::pack_all(&all, release, &out)?;
                println!("registry: {}", index.display());
                Ok(())
            }
            PluginCmd::New { name, id, no_logic, into } => plugins::new_plugin(&name, id, no_logic, into),
            PluginCmd::DbReset { id } => plugins::db_reset(&id),
            PluginCmd::Keygen { out } => plugins::keygen(out),
        },
        Cmd::Test { skip_db } => ci::test(skip_db),
        Cmd::Ci => ci::ci(),
        Cmd::E2e { headed } => e2e::e2e(headed),
        Cmd::Release { cmd } => match cmd {
            ReleaseCmd::Bundle { out, skip_ui, flavor } => release::bundle(&out, skip_ui, flavor),
            ReleaseCmd::Desktop { pg_dir, no_pg } => release::desktop(pg_dir, no_pg),
            ReleaseCmd::Docker { tag } => release::docker(tag),
            ReleaseCmd::K8s { tag } => release::k8s(tag),
            ReleaseCmd::All { pg_dir, no_pg } => release::all(pg_dir, no_pg),
        },
    }
}
