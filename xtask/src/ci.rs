//! Tests and quality checks (the same as the CI), on mosaikit and on the
//! plugin folders of the distribution (e.g. ../mosaikit-plugins).

use std::process::Command;

use anyhow::Result;

use crate::plugins;
use crate::util::{npm, root, run, which};

/// `cargo test` arguments run through cargo-nextest when it is installed (tests in parallel processes,
/// much faster on many integration test binaries); nextest skips doctests, so those run on their own.
fn rust_tests(args: &[&str]) -> Command {
    let mut c = Command::new("cargo");
    c.current_dir(root());
    if which("cargo-nextest").is_some() {
        c.args(["nextest", "run", "--no-fail-fast"]).args(args);
    } else {
        c.arg("test").args(args);
    }
    c
}

/// Rust tests (with PostgreSQL) and UI tests.
pub fn test(skip_db: bool) -> Result<()> {
    if !skip_db && std::env::var_os("MOSAIKIT_TEST_DATABASE_URL").is_none() {
        crate::db::up()?;
    }
    let url = std::env::var("MOSAIKIT_TEST_DATABASE_URL").unwrap_or_else(|_| crate::db::test_url());
    let all = plugins::discover()?;
    plugins::build_wasm(&all, false)?;
    run(rust_tests(&["--workspace"]).env("MOSAIKIT_TEST_DATABASE_URL", &url))?;
    if which("cargo-nextest").is_some() {
        run(Command::new("cargo").current_dir(root()).args(["test", "--workspace", "--doc"]))?;
    }
    // the same kernel, server and db tests on the SQLite backend (default of the desktop version)
    eprintln!("== tests on SQLite");
    run(rust_tests(&["-p", "mosaikit-kernel", "-p", "mosaikit-server", "-p", "mosaikit-db"])
        .env("MOSAIKIT_TEST_BACKEND", "sqlite"))?;
    for ws in plugins::cargo_roots(&all) {
        run(Command::new("cargo")
            .current_dir(&ws)
            .env_remove("CARGO_TARGET_DIR")
            .args(["test", "--workspace"]))?;
    }
    // integration tests of the distribution (`[tests] cargo` in distribution.toml)
    for dir in &crate::dist::current().tests.cargo {
        eprintln!("== tests of the distribution in {}", dir.display());
        run(Command::new("cargo").current_dir(dir).args(["test"]).env("MOSAIKIT_TEST_DATABASE_URL", &url))?;
    }
    plugins::ensure_npm()?;
    run(npm().current_dir(root()).args(["test"]))?;
    for dir in plugins::npm_roots(&all) {
        plugins::ensure_npm_in(&dir)?;
        run(npm().current_dir(&dir).args(["test"]))?;
    }
    Ok(())
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
