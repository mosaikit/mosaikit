//! Tests and quality checks (the same as the CI), on mosaikit and on the
//! plugin folders of the distribution (e.g. ../mosaikit-plugins).

use std::path::Path;
use std::process::Command;

use anyhow::{bail, Result};

use crate::util::{npm, root, run, which};
use crate::{plugins, report};

/// Rust tests of the workspace: through cargo-nextest when it is installed (tests in parallel
/// processes, much faster on many integration test binaries; JUnit of the `profile` in
/// .config/nextest.toml), otherwise `cargo test` (libtest output).
fn rust_suite<'a>(
    cmd: &'a mut Command,
    id: &str,
    title: &str,
    order: u32,
    profile: &str,
    args: &[&str],
) -> report::Suite<'a> {
    cmd.current_dir(root());
    let nextest = which("cargo-nextest").is_some();
    if nextest {
        cmd.args(["nextest", "run", "--no-fail-fast", "--profile", profile]).args(args);
    } else {
        cmd.arg("test").args(args).arg("--no-fail-fast");
    }
    report::Suite {
        id: id.into(),
        title: title.into(),
        order,
        format: if nextest { report::Format::Junit } else { report::Format::Libtest },
        junit_from: nextest.then(|| plugins::target_dir().join("nextest").join(profile).join("junit.xml")),
        cmd,
    }
}

/// `cargo test` in another folder (plugins, distribution), recorded from its libtest output.
fn cargo_test_suite<'a>(cmd: &'a mut Command, id: String, title: String, order: u32) -> report::Suite<'a> {
    report::Suite { id, title, order, format: report::Format::Libtest, junit_from: None, cmd }
}

/// The `test` script of an npm workspace, as a suite.
struct NpmRun {
    id: String,
    title: String,
    order: u32,
    cmd: Command,
    format: report::Format,
}

/// The npm workspaces of `npm_root` with a `test` script: vitest ones write their JSON results.
fn npm_suites(npm_root: &Path, prefix: &str, title: &str, order: u32) -> Result<Vec<NpmRun>> {
    let pkg: serde_json::Value = serde_json::from_slice(&std::fs::read(npm_root.join("package.json"))?)?;
    let mut out = Vec::new();
    for (i, ws) in pkg["workspaces"].as_array().into_iter().flatten().filter_map(|w| w.as_str()).enumerate() {
        let Ok(bytes) = std::fs::read(npm_root.join(ws).join("package.json")) else { continue };
        let wp: serde_json::Value = serde_json::from_slice(&bytes)?;
        let Some(script) = wp["scripts"]["test"].as_str() else { continue };
        let id = format!("{prefix}-{}", ws.replace(['/', '\\'], "-"));
        let mut cmd = npm();
        cmd.current_dir(npm_root).args(["run", "test", "-w", ws]);
        let format = if script.contains("vitest") {
            let file = report::dir().join(format!("{id}.json"));
            let _ = std::fs::remove_file(&file);
            cmd.arg("--")
                .args(["--reporter=default", "--reporter=json"])
                .arg(format!("--outputFile.json={}", file.display()));
            report::Format::Vitest
        } else {
            report::Format::Status
        };
        out.push(NpmRun { id, title: format!("{title}: {ws}"), order: order + i as u32, cmd, format });
    }
    Ok(out)
}

/// Rust tests (with PostgreSQL and SQLite), tests of the plugins and of the distribution, UI tests.
/// Every suite runs even when an earlier one fails; the results go to tests/results/test-results.md
/// (`cargo xtask test-report`), then the command fails if any suite failed.
pub fn test(skip_db: bool) -> Result<()> {
    if !skip_db && std::env::var_os("MOSAIKIT_TEST_DATABASE_URL").is_none() {
        crate::db::up()?;
    }
    let url = std::env::var("MOSAIKIT_TEST_DATABASE_URL").unwrap_or_else(|_| crate::db::test_url());
    let all = plugins::discover()?;
    plugins::build_wasm(&all, false)?;
    // the results of this command are replaced; the ones of the e2e stay
    for prefix in ["rust-", "vitest-", "npm-"] {
        report::clear(prefix)?;
    }
    let mut failed: Vec<String> = Vec::new();

    let mut c = Command::new("cargo");
    let s = rust_suite(&mut c, "rust-postgres", "Rust tests on PostgreSQL", 10, "pg", &["--workspace"]);
    s.cmd.env("MOSAIKIT_TEST_DATABASE_URL", &url);
    let t = s.title.clone();
    note(&mut failed, report::run_suite(s)?, &t);
    if which("cargo-nextest").is_some() {
        let mut c = Command::new("cargo");
        c.current_dir(root()).args(["test", "--workspace", "--doc"]);
        let s = cargo_test_suite(&mut c, "rust-doc".into(), "Rust doc tests".into(), 20);
        note(&mut failed, report::run_suite(s)?, "Rust doc tests");
    }
    // the same kernel, server and db tests on the SQLite backend (default of the desktop version)
    let mut c = Command::new("cargo");
    let s = rust_suite(
        &mut c,
        "rust-sqlite",
        "Rust tests on SQLite (kernel, server, db)",
        30,
        "sqlite",
        &["-p", "mosaikit-kernel", "-p", "mosaikit-server", "-p", "mosaikit-db"],
    );
    s.cmd.env("MOSAIKIT_TEST_BACKEND", "sqlite");
    let t = s.title.clone();
    note(&mut failed, report::run_suite(s)?, &t);
    for (i, ws) in plugins::cargo_roots(&all).iter().enumerate() {
        let name = folder(ws);
        let mut c = Command::new("cargo");
        c.current_dir(ws).env_remove("CARGO_TARGET_DIR").args(["test", "--workspace", "--no-fail-fast"]);
        let title = format!("Rust tests of the plugins in {name}");
        let s = cargo_test_suite(&mut c, format!("rust-plugins-{name}"), title.clone(), 40 + i as u32);
        note(&mut failed, report::run_suite(s)?, &title);
    }
    // integration tests of the distribution (`[tests] cargo` in distribution.toml)
    for (i, dir) in crate::dist::current().tests.cargo.iter().enumerate() {
        let name = folder(dir);
        let mut c = Command::new("cargo");
        c.current_dir(dir).args(["test", "--no-fail-fast"]).env("MOSAIKIT_TEST_DATABASE_URL", &url);
        let title = format!("Integration tests of the distribution in {name}");
        let s = cargo_test_suite(&mut c, format!("rust-distribution-{name}"), title.clone(), 50 + i as u32);
        note(&mut failed, report::run_suite(s)?, &title);
    }
    plugins::ensure_npm()?;
    let mut npm_runs = npm_suites(&root(), "vitest", "UI tests", 60)?;
    for (i, dir) in plugins::npm_roots(&all).iter().enumerate() {
        plugins::ensure_npm_in(dir)?;
        let name = folder(dir);
        npm_runs.extend(npm_suites(
            dir,
            &format!("vitest-plugins-{name}"),
            &format!("UI tests of the plugins in {name}"),
            70 + 10 * i as u32,
        )?);
    }
    for NpmRun { id, title, order, mut cmd, format } in npm_runs {
        let ok = report::run_suite(report::Suite {
            id,
            title: title.clone(),
            order,
            format,
            junit_from: None,
            cmd: &mut cmd,
        })?;
        note(&mut failed, ok, &title);
    }
    report::generate()?;
    if !failed.is_empty() {
        bail!("failed: {}", failed.join("; "));
    }
    Ok(())
}

fn note(failed: &mut Vec<String>, ok: bool, title: &str) {
    if !ok {
        failed.push(title.to_owned());
    }
}

fn folder(p: &Path) -> String {
    p.canonicalize()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .or_else(|| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .unwrap_or_else(|| "folder".into())
}

/// fmt, clippy, tests, typecheck, lint and build of the UIs, cargo-deny if installed.
pub fn ci() -> Result<()> {
    let all = plugins::discover()?;
    let cargo_roots = plugins::cargo_roots(&all);
    for ws in std::iter::once(root()).chain(cargo_roots.iter().cloned()) {
        run(Command::new("cargo").current_dir(&ws).args(["fmt", "--all", "--check"]))?;
    }
    plugins::build_wasm(&all, false)?;
    run(Command::new("cargo").current_dir(root()).args([
        "clippy",
        "--workspace",
        "--all-targets",
        "--",
        "-D",
        "warnings",
    ]))?;
    for ws in &cargo_roots {
        run(Command::new("cargo").current_dir(ws).env_remove("CARGO_TARGET_DIR").args([
            "clippy",
            "--workspace",
            "--target",
            "wasm32-unknown-unknown",
            "--",
            "-D",
            "warnings",
        ]))?;
    }
    if which("cargo-deny").is_some() {
        run(Command::new("cargo").current_dir(root()).args(["deny", "check"]))?;
    } else {
        eprintln!("cargo-deny not installed: license/vulnerability check skipped (cargo install cargo-deny)");
    }
    plugins::ensure_npm()?;
    let npm_roots = plugins::npm_roots(&all);
    for dir in std::iter::once(root()).chain(npm_roots.iter().cloned()) {
        plugins::ensure_npm_in(&dir)?;
        for script in ["typecheck", "lint", "build"] {
            run(npm().current_dir(&dir).args(["run", script]))?;
        }
    }
    test(false)?;
    eprintln!("\nlocal CI: all green");
    Ok(())
}
