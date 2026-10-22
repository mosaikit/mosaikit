//! Development PostgreSQL: a dedicated cluster in `.dev/pg` (port 55432),
//! with the local PostgreSQL binaries or, if they are missing, with Docker.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};

use crate::util::{exe, output, pg_bin, root, run, which};

pub const PORT: u16 = 55432;
pub const DEV_USER: &str = "mosaikit_dev";
pub const DEV_PASSWORD: &str = "mosaikit_dev";
const SUPERUSER_PASSWORD: &str = "postgres";

/// URL of the development database (used by `xtask/mosaikit.dev.toml`).
pub fn dev_url() -> String {
    format!("postgres://{DEV_USER}:{DEV_PASSWORD}@127.0.0.1:{PORT}/mosaikit")
}

/// URL for the tests: every test creates and destroys its own database.
pub fn test_url() -> String {
    format!("postgres://{DEV_USER}:{DEV_PASSWORD}@127.0.0.1:{PORT}/postgres")
}

fn dir() -> PathBuf {
    root().join(".dev").join("pg")
}

fn data_dir() -> PathBuf {
    dir().join("data")
}

enum Backend {
    Local(PathBuf),
    Docker,
}

fn backend() -> Result<Backend> {
    if let Some(bin) = pg_bin() {
        return Ok(Backend::Local(bin));
    }
    if which("docker").is_some() {
        return Ok(Backend::Docker);
    }
    bail!(
        "PostgreSQL not found: install PostgreSQL >= 15 (or set MOSAIKIT_PG_BIN to the bin folder), \
         or install Docker"
    )
}

fn compose_file() -> PathBuf {
    root().join("deploy").join("compose.dev.yml")
}

pub fn up() -> Result<()> {
    match backend()? {
        Backend::Local(bin) => up_local(&bin),
        Backend::Docker => {
            run(Command::new("docker")
                .args(["compose", "-f"])
                .arg(compose_file())
                .args(["up", "-d", "--wait"]))?;
            eprintln!("PostgreSQL (Docker) ready on 127.0.0.1:{PORT}");
            Ok(())
        }
    }
}

fn is_running(bin: &std::path::Path) -> bool {
    data_dir().join("PG_VERSION").is_file()
        && Command::new(bin.join(exe("pg_ctl")))
            .arg("status")
            .arg("-D")
            .arg(data_dir())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
}

fn up_local(bin: &std::path::Path) -> Result<()> {
    let data = data_dir();
    std::fs::create_dir_all(dir())?;
    if !data.join("PG_VERSION").is_file() {
        eprintln!("initializing the development cluster in {}", data.display());
        let pw = dir().join("superuser.pw");
        std::fs::write(&pw, SUPERUSER_PASSWORD)?;
        run(Command::new(bin.join(exe("initdb")))
            .arg("-D")
            .arg(&data)
            .args(["-U", "postgres", "-E", "UTF8", "--no-locale", "--auth=scram-sha-256"])
            .arg(format!("--pwfile={}", pw.display())))?;
        let _ = std::fs::remove_file(&pw);
    }
    if !is_running(bin) {
        start_detached(bin, &data)?;
        wait_ready(bin)?;
    }
    // development role and database (idempotent)
    let psql = |sql: &str| -> Result<String> {
        output(
            Command::new(bin.join(exe("psql")))
                .env("PGPASSWORD", SUPERUSER_PASSWORD)
                .args(["-h", "127.0.0.1", "-p", &PORT.to_string(), "-U", "postgres", "-d", "postgres"])
                .args(["-v", "ON_ERROR_STOP=1", "-tAc", sql]),
        )
    };
    if psql(&format!("select 1 from pg_roles where rolname = '{DEV_USER}'"))?.trim() != "1" {
        psql(&format!("create role {DEV_USER} login createdb createrole password '{DEV_PASSWORD}'"))?;
    }
    if psql("select 1 from pg_database where datname = 'mosaikit'")?.trim() != "1" {
        psql(&format!("create database mosaikit owner {DEV_USER}"))?;
    }
    // PostGIS (plugins that require it) if installed: in the template, so that
    // the test databases inherit it too, and in the development database
    if psql("select 1 from pg_available_extensions where name = 'postgis'")?.trim() == "1" {
        for db in ["template1", "mosaikit"] {
            output(
                Command::new(bin.join(exe("psql")))
                    .env("PGPASSWORD", SUPERUSER_PASSWORD)
                    .args(["-h", "127.0.0.1", "-p", &PORT.to_string(), "-U", "postgres", "-d", db])
                    .args(["-v", "ON_ERROR_STOP=1", "-tAc", "create extension if not exists postgis"]),
            )?;
        }
    }
    eprintln!("development PostgreSQL ready: {}", dev_url());
    Ok(())
}

/// Starts the server detached from the terminal.
///
/// On Windows `pg_ctl` passes its own handles to the `postgres` process: if
/// it descended from this terminal it would keep its pipe open (whoever captures
/// the output would wait forever) and when the console closes the
/// child processes would fail with 0xC0000142. `Start-Process` uses
/// ShellExecute: no inherited handle, a console of its own, hidden.
fn start_detached(bin: &std::path::Path, data: &std::path::Path) -> Result<()> {
    let pg_ctl = bin.join(exe("pg_ctl"));
    let log = dir().join("server.log");
    let opts = format!("-p {PORT} -c listen_addresses=127.0.0.1 -c max_connections=300");
    if cfg!(windows) {
        let q = |p: &std::path::Path| p.display().to_string().replace('\'', "''");
        let script = format!(
            "Start-Process -WindowStyle Hidden -FilePath '{}' -ArgumentList @('-D','\"{}\"','-l','\"{}\"','-o','\"{}\"','start')",
            q(&pg_ctl),
            q(data),
            q(&log),
            opts
        );
        run(Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &script]))
    } else {
        run(Command::new(pg_ctl)
            .arg("-D")
            .arg(data)
            .arg("-l")
            .arg(log)
            .arg("-o")
            .arg(opts)
            .arg("start")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null()))
    }
}

fn wait_ready(bin: &std::path::Path) -> Result<()> {
    for _ in 0..120 {
        let ok = Command::new(bin.join(exe("pg_isready")))
            .args(["-h", "127.0.0.1", "-p", &PORT.to_string(), "-q"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    bail!("PostgreSQL does not answer after 30 s: see {}", dir().join("server.log").display())
}

pub fn down() -> Result<()> {
    match backend()? {
        Backend::Local(bin) => {
            if is_running(&bin) {
                run(Command::new(bin.join(exe("pg_ctl")))
                    .arg("-D")
                    .arg(data_dir())
                    .args(["-m", "fast", "stop"]))?;
            }
            Ok(())
        }
        Backend::Docker => {
            run(Command::new("docker").args(["compose", "-f"]).arg(compose_file()).arg("down"))
        }
    }
}

/// Deletes the `msk_t_*` databases left by interrupted tests and their roles.
pub fn clean_tests() -> Result<()> {
    let Backend::Local(bin) = backend()? else {
        bail!("clean-tests is available with the local cluster");
    };
    let psql = |db: &str, sql: &str| -> Result<String> {
        output(
            Command::new(bin.join(exe("psql")))
                .env("PGPASSWORD", DEV_PASSWORD)
                .args(["-h", "127.0.0.1", "-p", &PORT.to_string(), "-U", DEV_USER, "-d", db])
                .args(["-v", "ON_ERROR_STOP=1", "-tAc", sql]),
        )
    };
    let dbs = psql("postgres", "select datname from pg_database where datname like 'msk_t_%'")?;
    for db in dbs.lines().map(str::trim).filter(|l| !l.is_empty()) {
        psql("postgres", &format!("drop database if exists \"{db}\" with (force)"))?;
    }
    let roles = psql("postgres", "select rolname from pg_roles where rolname like 'msk_t_%'")?;
    for r in roles.lines().map(str::trim).filter(|l| !l.is_empty()) {
        psql("postgres", &format!("drop role if exists \"{r}\""))?;
    }
    eprintln!("test databases removed");
    Ok(())
}

pub fn reset() -> Result<()> {
    down()?;
    if data_dir().exists() {
        std::fs::remove_dir_all(data_dir()).context("removing the development cluster")?;
    }
    up()
}
