//! `cargo xtask <command>`: development, tests and release of Mosaikit without bash scripts.

mod ci;
mod db;
mod dev;
mod dist;
mod e2e;
mod perf;
mod plugins;
mod release;
mod report;
mod util;

use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "cargo xtask", about = "Automation of the Mosaikit project")]
struct Cli {
    /// distribution to use (folder or distribution.toml file; default: the one of mosaikit)
    #[arg(long, global = true, env = "MOSAIKIT_DIST")]
    dist: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Development PostgreSQL (.dev/pg, port 55432)
    Db {
        #[command(subcommand)]
        cmd: DbCmd,
    },
    /// Development environment with hot reload (DB, server, Vite, plugins)
    Dev {
        /// do not start Vite for the host UI
        #[arg(long)]
        no_ui: bool,
    },
    /// Plugins: build, packages, scaffolding
    Plugin {
        #[command(subcommand)]
        cmd: PluginCmd,
    },
    /// Rust tests (with PostgreSQL) and UI tests
    Test {
        /// do not start the development cluster (use MOSAIKIT_TEST_DATABASE_URL)
        #[arg(long)]
        skip_db: bool,
    },
    /// CI checks: fmt, clippy, deny, typecheck, lint, build, test
    Ci,
    /// tests/results/test-results.md from the latest results of every suite (tests/results/raw)
    TestReport,
    /// End-to-end tests in the browser (Playwright) on a full installation
    E2e {
        /// show the browser
        #[arg(long)]
        headed: bool,
    },
    /// Load test of a full installation at scale (docs/reports/performance.md)
    Perf {
        /// postgres or sqlite
        #[arg(long, default_value = "postgres")]
        backend: String,
        /// size of the data: full (200 tenants, 1M items, 5M events), medium, desktop
        #[arg(long, default_value = "full")]
        scale: String,
        /// measure again on the data of the previous run (new migrations are applied)
        #[arg(long)]
        reuse: bool,
        /// do not build the server: measure the binary already in target/release (before and after)
        #[arg(long)]
        no_build: bool,
        /// drop the database and the data of the load test
        #[arg(long)]
        clean: bool,
    },
    /// Release
    Release {
        #[command(subcommand)]
        cmd: ReleaseCmd,
    },
}

#[derive(Subcommand)]
enum DbCmd {
    /// Starts (and if needed initializes) the development cluster
    Up,
    /// Stops the development cluster
    Down,
    /// Recreates the development cluster from scratch
    Reset,
    /// Deletes the databases left by interrupted tests
    CleanTests,
    /// Prints the connection URLs
    Url,
}

#[derive(Subcommand)]
enum PluginCmd {
    /// Builds logic (WASM) and UI of every plugin
    Build {
        #[arg(long)]
        release: bool,
    },
    /// Creates the signed .mskp packages and the index.json of the registry
    Pack {
        #[arg(long)]
        release: bool,
        #[arg(long, default_value = "dist/registry")]
        out: PathBuf,
    },
    /// New plugin from the template (xtask/templates/plugin)
    New {
        name: String,
        /// id of the plugin (default com.example.<name>)
        #[arg(long)]
        id: Option<String>,
        /// without WASM logic (manifest, migrations and UI only)
        #[arg(long)]
        no_logic: bool,
        /// folder to create it in (default: the first of [plugins] roots of the distribution)
        #[arg(long)]
        into: Option<PathBuf>,
    },
    /// Resets schema and data of a plugin in the development database
    DbReset { id: String },
    /// Generates an ed25519 key pair to sign the packages
    Keygen {
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum ReleaseCmd {
    /// Release server + signed plugins + registry in a folder
    Bundle {
        #[arg(long)]
        out: PathBuf,
        /// the UI is already built (e.g. in the Dockerfile)
        #[arg(long)]
        skip_ui: bool,
        #[arg(long, value_enum, default_value = "server")]
        flavor: release::Flavor,
    },
    /// Desktop zip in dist/ (SQLite; embedded PostgreSQL if the distribution asks for it)
    Desktop {
        /// distribution with a postgres database: PostgreSQL folder to include (bin/, lib/, share/)
        #[arg(long)]
        pg_dir: Option<PathBuf>,
        /// distribution with a postgres database: do not include it (the installed one will be used)
        #[arg(long)]
        no_pg: bool,
    },
    /// Docker image of the server + Docker (compose) and Kubernetes folders in dist/
    Docker {
        #[arg(long)]
        tag: Option<String>,
    },
    /// Kubernetes manifests only (kustomize) in dist/, without building the image
    K8s {
        /// image (default <image of the distribution>:<version>)
        #[arg(long)]
        tag: Option<String>,
    },
    /// Every release in dist/: desktop, Docker and Kubernetes
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
                println!("development: {}", db::dev_url());
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
        Cmd::TestReport => report::generate().map(|_| ()),
        Cmd::E2e { headed } => e2e::e2e(headed),
        Cmd::Perf { clean: true, .. } => perf::clean(),
        Cmd::Perf { backend, scale, reuse, no_build, .. } => perf::perf(&backend, &scale, reuse, no_build),
        Cmd::Release { cmd } => match cmd {
            ReleaseCmd::Bundle { out, skip_ui, flavor } => release::bundle(&out, skip_ui, flavor),
            ReleaseCmd::Desktop { pg_dir, no_pg } => release::desktop(pg_dir, no_pg),
            ReleaseCmd::Docker { tag } => release::docker(tag),
            ReleaseCmd::K8s { tag } => release::k8s(tag),
            ReleaseCmd::All { pg_dir, no_pg } => release::all(pg_dir, no_pg),
        },
    }
}
