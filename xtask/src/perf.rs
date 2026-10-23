//! `cargo xtask perf`: load test of a full installation (docs/reports/performance.md).
//!
//! A database of its own (`mosaikit_perf` on the development cluster, or a SQLite file), the plugins
//! built in release, signed and preinstalled from the registry as in production, the server built in
//! release. `xtask/perf/run.mjs` seeds the data at scale (SQL, not the API: millions of rows), then
//! measures the interactive calls and the queries of the background jobs and writes
//! `.dev/perf/<backend>-<scale>.json`.
//!
//! `--reuse` keeps the database and the data of the previous run: the server starts on them (and
//! applies new migrations, e.g. indexes) and only the measures run again.

use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};

use crate::dev::kill_tree;
use crate::e2e::{admin_url, psql, reset_db, wait_health};
use crate::plugins;
use crate::util::{exe, pg_bin, root, run, which};

const DB: &str = "mosaikit_perf";
const ADMIN_PASSWORD: &str = "perf-admin-password";
const PORT: u16 = 18400;

pub fn perf(backend: &str, scale: &str, reuse: bool, no_build: bool) -> Result<()> {
    let sqlite = match backend {
        "postgres" => false,
        "sqlite" => true,
        other => bail!("unknown backend {other}: postgres or sqlite"),
    };
    let dir = root().join(".dev").join("perf").join(backend);
    let db_url = admin_url().replace("/postgres", &format!("/{DB}"));
    if !reuse {
        if !sqlite {
            reset_db(DB)?;
        }
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
    }
    std::fs::create_dir_all(&dir)?;

    let all = plugins::discover()?;
    if !reuse || !dir.join("registry").exists() {
        plugins::build_ui(&all)?;
        plugins::build_wasm(&all, true)?;
        plugins::pack_all(&all, true, &dir.join("registry"))?;
    }
    let trusted = std::fs::read_to_string(dir.join("registry").join("trusted_key.txt"))?;
    let database = if sqlite {
        "[database]\nbackend = \"sqlite\"\n".to_string()
    } else {
        format!("[database]\nurl = \"{db_url}\"\n")
    };
    std::fs::write(
        dir.join("mosaikit.toml"),
        format!(
            "# installation of the load test (properties described in mosaikit.example.toml)\n\
             url = \"http://127.0.0.1:{PORT}\"\ndata_dir = \"data\"\n\
             registry = \"registry/index.json\"\npreinstall = true\ntrusted_keys = [\"{}\"]\n\n{database}",
            trusted.trim()
        ),
    )?;
    if !no_build {
        run(Command::new("cargo").current_dir(root()).args(["build", "--release", "-p", "mosaikit-server"]))?;
    }
    let mut server = Command::new(plugins::target_dir().join("release").join(exe("mosaikit-server")))
        .args(["--config"])
        .arg(dir.join("mosaikit.toml"))
        .current_dir(&dir)
        .env("MOSAIKIT_ADMIN_PASSWORD", ADMIN_PASSWORD)
        .stdout(Stdio::from(std::fs::File::create(dir.join("server.log"))?))
        .stderr(Stdio::from(std::fs::File::create(dir.join("server.err.log"))?))
        .spawn()?;
    let psql_bin = pg_bin()
        .map(|b| b.join(exe("psql")))
        .or_else(|| which("psql"))
        .context("psql not found (MOSAIKIT_PG_BIN or PATH)")?;
    let result = (|| -> Result<()> {
        wait_health(&format!("http://127.0.0.1:{PORT}/api/health"))?;
        run(Command::new("node")
            .current_dir(root())
            .arg(root().join("xtask").join("perf").join("run.mjs"))
            .env("PERF_BASE", format!("http://127.0.0.1:{PORT}"))
            .env("PERF_BACKEND", backend)
            .env("PERF_SCALE", scale)
            .env("PERF_SEED", if reuse { "0" } else { "1" })
            .env("PERF_DB_URL", &db_url)
            .env("PERF_SQLITE", dir.join("data").join("mosaikit.db"))
            .env("PERF_PSQL", &psql_bin)
            .env("PERF_SERVER_PID", server.id().to_string())
            .env("PERF_OUT", dir.join(format!("{backend}-{scale}.json"))))
    })();
    kill_tree(&mut server);
    if result.is_err() {
        eprintln!("server log: {}", dir.join("server.err.log").display());
    }
    if result.is_ok() {
        eprintln!(
            "the data stay in {} (and {DB}): --reuse measures again, --clean drops them",
            dir.display()
        );
    }
    result
}

/// Drops the database and the data of the load test.
pub fn clean() -> Result<()> {
    psql(&format!("drop database if exists {DB} with (force)"))?;
    for r in psql(&format!("select rolname from pg_roles where rolname like 'msk_{DB}%'"))?
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        psql(&format!("drop role if exists \"{r}\""))?;
    }
    let dir = root().join(".dev").join("perf");
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    Ok(())
}
