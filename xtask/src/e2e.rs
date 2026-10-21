//! `cargo xtask e2e`: test nel browser su un'installazione completa.
//!
//! Database nuovo, plugin compilati, firmati e preinstallati dal registry
//! (come in produzione), server su 18080/18081 sotto il percorso base `/mosaikit`, Playwright.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};

use crate::dev::kill_tree;
use crate::plugins;
use crate::util::{exe, npm, output, pg_bin, root, run, which};

const DB: &str = "mosaikit_e2e";
const ADMIN_PASSWORD: &str = "e2e-admin-password";

/// Ruolo amministrativo dei test: `MOSAIKIT_TEST_DATABASE_URL` (CI) o il cluster di sviluppo.
fn admin_url() -> String {
    std::env::var("MOSAIKIT_TEST_DATABASE_URL").unwrap_or_else(|_| crate::db::test_url())
}

fn psql(sql: &str) -> Result<String> {
    let psql = pg_bin()
        .map(|b| b.join(exe("psql")))
        .or_else(|| which("psql"))
        .context("psql non trovato (MOSAIKIT_PG_BIN o PATH)")?;
    output(Command::new(psql).args(["-v", "ON_ERROR_STOP=1", "-d"]).arg(admin_url()).args(["-tAc", sql]))
}

fn reset_db() -> Result<()> {
    psql(&format!("drop database if exists {DB} with (force)"))?;
    for r in psql(&format!("select rolname from pg_roles where rolname like 'msk_{DB}%'"))?
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        psql(&format!("drop role if exists \"{r}\""))?;
    }
    psql(&format!("create database {DB}"))?;
    Ok(())
}

fn wait_health(url: &str) -> Result<()> {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(120) {
        let ok = Command::new("curl")
            .args(["-s", "-o", if cfg!(windows) { "NUL" } else { "/dev/null" }, "-w", "%{http_code}", url])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout) == "200")
            .unwrap_or(false);
        if ok {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    bail!("il server non risponde su {url}")
}

pub fn e2e(headed: bool) -> Result<()> {
    if std::env::var_os("MOSAIKIT_TEST_DATABASE_URL").is_none() {
        crate::db::up()?;
    }
    reset_db()?;
    let dir = root().join(".dev").join("e2e");
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;

    let all = plugins::discover()?;
    plugins::ensure_npm()?;
    run(npm().current_dir(root()).args(["run", "build"]))?;
    plugins::build_ui(&all)?;
    plugins::build_wasm(&all, false)?;
    plugins::pack_all(&all, false, &dir.join("registry"))?;
    let trusted = std::fs::read_to_string(dir.join("registry").join("trusted_key.txt"))?;
    let url = admin_url().replace("/postgres", &format!("/{DB}"));
    std::fs::write(
        dir.join("mosaikit.toml"),
        format!(
            "# installazione dei test e2e (proprieta' descritte in mosaikit.example.toml)\n\
             url = \"http://127.0.0.1:18080/mosaikit\"\ndata_dir = \"data\"\n\
             registry = \"registry/index.json\"\npreinstall = true\ntrusted_keys = [\"{}\"]\n\n[database]\nurl = \"{url}\"\n",
            trusted.trim()
        ),
    )?;
    run(Command::new("cargo").current_dir(root()).args(["build", "-p", "mosaikit-server"]))?;
    let mut server = Command::new(plugins::target_dir().join("debug").join(exe("mosaikit-server")))
        .args(["--config"])
        .arg(dir.join("mosaikit.toml"))
        .env("MOSAIKIT_ADMIN_PASSWORD", ADMIN_PASSWORD)
        .stdout(Stdio::from(std::fs::File::create(dir.join("server.log"))?))
        .stderr(Stdio::from(std::fs::File::create(dir.join("server.err.log"))?))
        .spawn()?;
    let result = (|| -> Result<()> {
        wait_health("http://127.0.0.1:18080/mosaikit/api/health")?;
        let mut cmd = npm();
        cmd.current_dir(root()).args(["run", "e2e", "-w", "e2e"]).env("E2E_ADMIN_PASSWORD", ADMIN_PASSWORD);
        if headed {
            cmd.env("E2E_HEADED", "1");
        }
        run(&mut cmd)
    })();
    kill_tree(&mut server);
    if result.is_err() {
        eprintln!("log del server: {}", dir.join("server.err.log").display());
    }
    result
}
