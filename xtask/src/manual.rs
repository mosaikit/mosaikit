//! `cargo xtask manual-tests`: the checks of docs/manual-tests.md, automated (tests/manual).
//!
//! First the consistency between the document and the suite (every check id has its automated test and
//! the other way round), then a new installation like the one of the e2e tests (its own database
//! `mosaikit_manual` plus the folder name of the checkout, free ports, the test identity provider),
//! seeded like the development environment by the suite itself, and the suite in the browser.
//! Raw outputs, git-ignored: tests/results/raw/manual (Playwright JSON, state, downloads) and
//! tests/results/raw/manual-screens (one screenshot per check).

use std::process::Command;

use anyhow::Result;

use crate::e2e::Instance;
use crate::report;
use crate::util::{npm, root, run};

/// The consistency check only (no installation): `node tests/manual/catalog.mjs`.
pub fn check() -> Result<()> {
    run(Command::new("node").current_dir(root()).arg("tests/manual/catalog.mjs"))
}

/// Starts the seeded installation and keeps it running (for one check at a time while writing it):
/// prints the environment for `npx playwright test -c tests/manual/playwright.config.ts --grep <id>`.
pub fn serve() -> Result<()> {
    let _slot = crate::heavy::acquire("e2e", "xtask manual-tests --serve")?;
    check()?;
    let raw = root().join("tests").join("results").join("raw");
    let inst = Instance::start("manual")?;
    eprintln!("== the installation stays up until this command is stopped (Ctrl+C); in another shell:");
    eprintln!(
        "   E2E_BASE_URL=http://127.0.0.1:{}/mosaikit/ E2E_PLUGIN_ORIGIN=http://127.0.0.1:{} \\",
        inst.port,
        inst.port + 1
    );
    eprintln!(
        "   E2E_IDP_URL=http://127.0.0.1:{} E2E_ADMIN_PASSWORD={} \\",
        inst.idp_port,
        crate::e2e::ADMIN_PASSWORD
    );
    eprintln!(
        "   MANUAL_RUN_DIR={} MANUAL_SHOTS={} \\",
        raw.join("manual").display(),
        raw.join("manual-screens").display()
    );
    eprintln!("   npx playwright test -c tests/manual/playwright.config.ts --grep P3-12");
    // stopping this command (Ctrl+C) stops the server and the identity provider with it
    loop {
        std::thread::sleep(std::time::Duration::from_secs(3600));
    }
}

/// The Playwright arguments that select the checks of an area: the ids start with the prefix.
fn area_args(area: &str) -> Vec<String> {
    let escaped: String = area
        .chars()
        .flat_map(|c| if c.is_ascii_alphanumeric() || c == '-' { vec![c] } else { vec!['\\', c] })
        .collect();
    // `\b` first: the prefix at the start of a word (no `|` or parentheses: the argument goes through `cmd`)
    vec!["--grep".into(), format!(r"\b{escaped}")]
}

pub fn manual_tests(headed: bool, area: Option<String>, args: &[String]) -> Result<()> {
    let _slot = crate::heavy::acquire("e2e", "xtask manual-tests")?;
    check()?;
    let area_args = area.as_deref().map(area_args).unwrap_or_default();
    let raw = root().join("tests").join("results").join("raw");
    for d in ["manual", "manual-screens"] {
        let d = raw.join(d);
        if d.exists() {
            std::fs::remove_dir_all(&d)?;
        }
        std::fs::create_dir_all(&d)?;
    }
    let mut inst = Instance::start("manual")?;
    let mut cmd = npm();
    cmd.current_dir(root())
        .args(["run", "manual", "-w", "tests/manual", "--"])
        .args(&area_args)
        .args(args)
        .env("MANUAL_RUN_DIR", raw.join("manual"))
        .env("MANUAL_SHOTS", raw.join("manual-screens"));
    inst.env(&mut cmd);
    if headed {
        cmd.env("E2E_HEADED", "1");
    }
    let json = report::dir().join("manual.json");
    let _ = std::fs::remove_file(&json);
    cmd.env("MANUAL_JSON", &json);
    let ok = report::run_suite(report::Suite {
        id: "manual".into(),
        title: "Manual checks, automated (Playwright)".into(),
        order: 95,
        format: report::Format::Playwright,
        junit_from: None,
        cmd: &mut cmd,
    })?;
    inst.stop(!ok);
    eprintln!("screenshots: {}", raw.join("manual-screens").display());
    // the report also when the run failed (a missing result marks the suite)
    report::generate()?;
    if !ok {
        anyhow::bail!("manual checks failed");
    }
    Ok(())
}
