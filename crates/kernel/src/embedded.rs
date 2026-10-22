//! Embedded PostgreSQL for the desktop release.
//!
//! The cluster lives in `<data_dir>/pg`, listens on 127.0.0.1 only with
//! scram-sha-256 authentication. The credentials of the superuser and of the
//! application role are generated at the first start and saved in `<data_dir>/pg/`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::util::random_token;
use crate::{Config, Error, Result};

pub struct EmbeddedPg {
    pub url: String,
    bin: PathBuf,
    data: PathBuf,
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// PostgreSQL `bin` folder: configured, next to the executable (`pgsql/bin`), or in the PATH.
fn find_bin(cfg: &Config) -> Result<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(b) = &cfg.database.pg_bin {
        candidates.push(b.clone());
    }
    if let Ok(me) = std::env::current_exe() {
        if let Some(dir) = me.parent() {
            candidates.push(dir.join("pgsql").join("bin"));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path));
    }
    candidates
        .into_iter()
        .find(|d| d.join(exe("pg_ctl")).is_file() && d.join(exe("initdb")).is_file())
        .ok_or_else(|| {
            Error::bad("embedded PostgreSQL: binaries not found (pgsql/bin next to the executable or database.pg_bin)")
        })
}

fn run(cmd: &mut Command) -> Result<String> {
    let out = cmd.stdin(Stdio::null()).output().map_err(|e| Error::internal(format!("{cmd:?}: {e}")))?;
    if !out.status.success() {
        return Err(Error::internal(format!(
            "{cmd:?}: {}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn free_port(preferred: u16) -> u16 {
    (preferred..preferred + 200)
        .find(|p| std::net::TcpListener::bind(("127.0.0.1", *p)).is_ok())
        .unwrap_or(preferred)
}

/// Starts `pg_ctl` without tying it to the console of the caller (see xtask/db.rs).
fn start_server(bin: &Path, data: &Path, log: &Path, port: u16) -> Result<()> {
    let mut cmd = Command::new(bin.join(exe("pg_ctl")));
    cmd.arg("-D")
        .arg(data)
        .arg("-l")
        .arg(log)
        .arg("-o")
        .arg(format!("-p {port} -c listen_addresses=127.0.0.1"))
        .arg("start")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // a console of its own, hidden: the postgres processes do not depend on the window of the server
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let status = cmd.status().map_err(|e| Error::internal(format!("pg_ctl: {e}")))?;
    if !status.success() {
        return Err(Error::internal(format!("pg_ctl start failed: see {}", log.display())));
    }
    Ok(())
}

impl EmbeddedPg {
    pub async fn start(cfg: &Config) -> Result<EmbeddedPg> {
        let bin = find_bin(cfg)?;
        let dir = cfg.data_dir.join("pg");
        let data = dir.join("data");
        std::fs::create_dir_all(&dir)?;
        let su_file = dir.join("superuser.pw");
        let app_file = dir.join("app.pw");
        if !data.join("PG_VERSION").is_file() {
            let su = random_token(16);
            std::fs::write(&su_file, &su)?;
            run(Command::new(bin.join(exe("initdb")))
                .arg("-D")
                .arg(&data)
                .args(["-U", "postgres", "-E", "UTF8", "--no-locale", "--auth=scram-sha-256"])
                .arg(format!("--pwfile={}", su_file.display())))?;
        }
        let su = std::fs::read_to_string(&su_file)?.trim().to_string();
        let port_file = dir.join("port");
        let preferred = cfg.database.embedded_port.unwrap_or(55433);
        let running = run(Command::new(bin.join(exe("pg_ctl"))).arg("status").arg("-D").arg(&data)).is_ok();
        let port = if running {
            std::fs::read_to_string(&port_file).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(preferred)
        } else {
            let port = free_port(preferred);
            std::fs::write(&port_file, port.to_string())?;
            start_server(&bin, &data, &dir.join("server.log"), port)?;
            port
        };
        // wait: ready to accept connections
        let su_url = format!("postgres://postgres:{su}@127.0.0.1:{port}/postgres");
        let mut admin = None;
        for _ in 0..120 {
            if let Ok(pool) = sqlx::postgres::PgPoolOptions::new().max_connections(1).connect(&su_url).await {
                admin = Some(pool);
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        let admin = admin.ok_or_else(|| Error::internal("embedded PostgreSQL does not answer"))?;
        // application role (not a superuser) and database
        if !app_file.is_file() {
            std::fs::write(&app_file, random_token(16))?;
        }
        let app_pw = std::fs::read_to_string(&app_file)?.trim().to_string();
        let exists: bool =
            sqlx::query_scalar("select exists (select 1 from pg_roles where rolname = 'mosaikit_app')")
                .fetch_one(&admin)
                .await?;
        if !exists {
            sqlx::raw_sql(&format!("create role mosaikit_app login createrole password '{app_pw}'"))
                .execute(&admin)
                .await?;
        }
        let db: bool =
            sqlx::query_scalar("select exists (select 1 from pg_database where datname = 'mosaikit')")
                .fetch_one(&admin)
                .await?;
        if !db {
            sqlx::raw_sql("create database mosaikit owner mosaikit_app").execute(&admin).await?;
        }
        admin.close().await;
        // PostGIS (geospatial plugins) if included in the PostgreSQL distribution:
        // the application role cannot create extensions that are not "trusted"
        let su_db = format!("postgres://postgres:{su}@127.0.0.1:{port}/mosaikit");
        if let Ok(pool) = sqlx::postgres::PgPoolOptions::new().max_connections(1).connect(&su_db).await {
            let available: bool = sqlx::query_scalar(
                "select exists (select 1 from pg_available_extensions where name = 'postgis')",
            )
            .fetch_one(&pool)
            .await
            .unwrap_or(false);
            if available {
                if let Err(e) = sqlx::raw_sql("create extension if not exists postgis").execute(&pool).await {
                    tracing::warn!("PostGIS not enabled: {e}");
                }
            }
            pool.close().await;
        }
        Ok(EmbeddedPg {
            url: format!("postgres://mosaikit_app:{app_pw}@127.0.0.1:{port}/mosaikit"),
            bin,
            data,
        })
    }

    pub fn stop(self) {
        let _ = Command::new(self.bin.join(exe("pg_ctl")))
            .arg("-D")
            .arg(&self.data)
            .args(["-m", "fast", "-w", "stop"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}
