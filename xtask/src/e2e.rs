//! `cargo xtask e2e`: tests in the browser on a full installation.
//!
//! New database, plugins built, signed and preinstalled from the registry
//! (as in production), server under the base path `/mosaikit`, Playwright.
//!
//! Several checkouts (worktrees) can run their suites at the same time: each one has its own
//! database (`mosaikit_e2e` plus the folder name of the checkout) and takes the first free ports
//! from 18080 (in steps of 10), or `MOSAIKIT_E2E_PORT`: the app, the plugins on the next one and
//! the test identity provider (`mosaikit-fake-idp`, OIDC) on the one after.

use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};

use crate::dev::kill_tree;
use crate::util::{exe, npm, output, pg_bin, root, run, which};
use crate::{plugins, report};

const ADMIN_PASSWORD: &str = "e2e-admin-password";

/// Administrative role of the tests: `MOSAIKIT_TEST_DATABASE_URL` (CI) or the development cluster.
pub(crate) fn admin_url() -> String {
    std::env::var("MOSAIKIT_TEST_DATABASE_URL").unwrap_or_else(|_| crate::db::test_url())
}

pub(crate) fn psql(sql: &str) -> Result<String> {
    let psql = pg_bin()
        .map(|b| b.join(exe("psql")))
        .or_else(|| which("psql"))
        .context("psql not found (MOSAIKIT_PG_BIN or PATH)")?;
    output(Command::new(psql).args(["-v", "ON_ERROR_STOP=1", "-d"]).arg(admin_url()).args(["-tAc", sql]))
}

/// The database of this checkout: `mosaikit_e2e` for a folder called `mosaikit`, otherwise with the
/// folder name (`mosaikit-phase8` → `mosaikit_e2e_phase8`).
fn db_name() -> String {
    let folder = root().file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
    let suffix: String = folder
        .strip_prefix("mosaikit")
        .unwrap_or(&folder)
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let suffix = suffix.trim_matches('_');
    if suffix.is_empty() {
        "mosaikit_e2e".into()
    } else {
        format!("mosaikit_e2e_{suffix}")
    }
}

/// The app port of this run (the plugins use the next one, the test identity provider the one after):
/// `MOSAIKIT_E2E_PORT`, or the first three free on 127.0.0.1 among 18080, 18090, 18100…
fn ports() -> Result<u16> {
    if let Some(p) = std::env::var("MOSAIKIT_E2E_PORT").ok().and_then(|p| p.parse().ok()) {
        return Ok(p);
    }
    let free = |p: u16| std::net::TcpListener::bind(("127.0.0.1", p)).is_ok();
    (0..20)
        .map(|i| 18080 + i * 10)
        .find(|&p| free(p) && free(p + 1) && free(p + 2))
        .context("no three free ports from 18080 to 18272")
}

pub(crate) fn reset_db(db: &str) -> Result<()> {
    psql(&format!("drop database if exists {db} with (force)"))?;
    // the roles of this database only: `msk_mosaikit_e2e_%` also matches the roles of another
    // checkout's `mosaikit_e2e_phase8`, so the roles of longer database names are left out
    let others = psql(&format!("select datname from pg_database where datname like '{db}\\_%'"))?;
    let mut sql = format!("select rolname from pg_roles where rolname like 'msk_{db}\\_%'");
    for o in others.lines().map(str::trim).filter(|l| !l.is_empty()) {
        sql.push_str(&format!(" and rolname not like 'msk_{o}\\_%'"));
    }
    for r in psql(&sql)?.lines().map(str::trim).filter(|l| !l.is_empty()) {
        psql(&format!("drop role if exists \"{r}\""))?;
    }
    psql(&format!("create database {db}"))?;
    Ok(())
}

pub(crate) fn wait_health(url: &str) -> Result<()> {
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
    bail!("the server does not answer on {url}")
}

pub fn e2e(headed: bool) -> Result<()> {
    if std::env::var_os("MOSAIKIT_TEST_DATABASE_URL").is_none() {
        crate::db::up()?;
    }
    let db = db_name();
    let port = ports()?;
    eprintln!("== e2e on http://127.0.0.1:{port}/mosaikit (plugins on {}), database {db}", port + 1);
    reset_db(&db)?;
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
    let url = admin_url().replace("/postgres", &format!("/{db}"));
    std::fs::write(
        dir.join("mosaikit.toml"),
        format!(
            "# installation of the e2e tests (properties described in mosaikit.example.toml)\n\
             url = \"http://127.0.0.1:{port}/mosaikit\"\ndata_dir = \"data\"\n\
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
    let idp_port = port + 2;
    let mut idp = Command::new(plugins::target_dir().join("debug").join(exe("mosaikit-fake-idp")))
        .args(["--port", &idp_port.to_string()])
        .stdout(Stdio::from(std::fs::File::create(dir.join("idp.log"))?))
        .stderr(Stdio::from(std::fs::File::create(dir.join("idp.err.log"))?))
        .spawn()?;
    let result = (|| -> Result<()> {
        wait_health(&format!("http://127.0.0.1:{port}/mosaikit/api/health"))?;
        wait_health(&format!("http://127.0.0.1:{idp_port}/.well-known/openid-configuration"))?;
        let mut cmd = npm();
        cmd.current_dir(root())
            .args(["run", "e2e", "-w", "e2e"])
            .env("E2E_ADMIN_PASSWORD", ADMIN_PASSWORD)
            .env("E2E_BASE_URL", format!("http://127.0.0.1:{port}/mosaikit/"))
            .env("E2E_PLUGIN_ORIGIN", format!("http://127.0.0.1:{}", port + 1))
            .env("E2E_IDP_URL", format!("http://127.0.0.1:{idp_port}"));
        if headed {
            cmd.env("E2E_HEADED", "1");
        }
        let json = report::dir().join("e2e.json");
        std::fs::create_dir_all(report::dir())?;
        let _ = std::fs::remove_file(&json);
        cmd.env("E2E_JSON", &json);
        let ok = report::run_suite(report::Suite {
            id: "e2e".into(),
            title: "End-to-end tests in the browser (Playwright)".into(),
            order: 90,
            format: report::Format::Playwright,
            junit_from: None,
            cmd: &mut cmd,
        })?;
        if !ok {
            bail!("end-to-end tests failed");
        }
        Ok(())
    })();
    kill_tree(&mut server);
    kill_tree(&mut idp);
    if result.is_err() {
        eprintln!("server log: {}", dir.join("server.err.log").display());
    }
    // the report also when the run failed (a missing result marks the suite)
    report::generate()?;
    result
}
