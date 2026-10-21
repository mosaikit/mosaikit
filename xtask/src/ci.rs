//! Test e controlli di qualita' (gli stessi della CI), su mosaikit e sulle
//! cartelle dei plugin della distribuzione (es. ../mosaikit-plugins).

use std::process::Command;

use anyhow::Result;

use crate::plugins;
use crate::util::{npm, root, run, which};

/// Test Rust (con PostgreSQL) e test delle UI.
pub fn test(skip_db: bool) -> Result<()> {
    if !skip_db && std::env::var_os("MOSAIKIT_TEST_DATABASE_URL").is_none() {
        crate::db::up()?;
    }
    let url = std::env::var("MOSAIKIT_TEST_DATABASE_URL").unwrap_or_else(|_| crate::db::test_url());
    let all = plugins::discover()?;
    plugins::build_wasm(&all, false)?;
    run(Command::new("cargo")
        .current_dir(root())
        .args(["test", "--workspace"])
        .env("MOSAIKIT_TEST_DATABASE_URL", &url))?;
    // stessi test di kernel e server sul backend SQLite (default della versione desktop)
    eprintln!("== test su SQLite");
    run(Command::new("cargo")
        .current_dir(root())
        .args(["test", "-p", "mosaikit-kernel", "-p", "mosaikit-server"])
        .env("MOSAIKIT_TEST_BACKEND", "sqlite"))?;
    for ws in plugins::cargo_roots(&all) {
        run(Command::new("cargo")
            .current_dir(&ws)
            .env_remove("CARGO_TARGET_DIR")
            .args(["test", "--workspace"]))?;
    }
    // test di integrazione della distribuzione (es. geoportal/tests)
    for dir in &crate::dist::current().tests.cargo {
        eprintln!("== test della distribuzione in {}", dir.display());
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

/// fmt, clippy, test, typecheck, lint e build delle UI, cargo-deny se installato.
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
        eprintln!(
            "cargo-deny non installato: controllo licenze/vulnerabilita' saltato (cargo install cargo-deny)"
        );
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
    eprintln!("\nCI locale: tutto verde");
    Ok(())
}
