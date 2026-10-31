//! Toolchain checks (`doctor`) and on-demand installation of the `wasm32` target.

use std::process::Command;

use anyhow::{bail, Result};

use crate::util::{capture, npm, run, which};

pub const WASM_TARGET: &str = "wasm32-unknown-unknown";
/// Oldest Rust that builds the plugin SDK (`rust-version` of `mosaikit-plugin-sdk`).
pub const MIN_RUST: (u32, u32) = (1, 85);
/// Oldest Node.js that runs the UI tools (Vite).
pub const MIN_NODE: u32 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ok,
    /// not needed for every plugin
    Warn,
    Fail,
}

#[derive(Debug, Clone)]
pub struct Check {
    pub name: &'static str,
    pub status: Status,
    pub detail: String,
    /// what to do when it is not Ok
    pub fix: Option<String>,
}

fn check(name: &'static str, status: Status, detail: impl Into<String>, fix: Option<&str>) -> Check {
    Check { name, status, detail: detail.into(), fix: fix.map(str::to_string) }
}

/// `rustc 1.99.1 (...)` -> (1, 99)
pub fn parse_rustc(s: &str) -> Option<(u32, u32)> {
    let v = s.split_whitespace().nth(1)?;
    let mut it = v.split('.');
    Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
}

/// `v24.21.0` -> 24
pub fn parse_node(s: &str) -> Option<u32> {
    s.trim().trim_start_matches('v').split('.').next()?.parse().ok()
}

pub fn wasm_target_installed() -> Option<bool> {
    let out = capture(Command::new("rustup").args(["target", "list", "--installed"]))?;
    Some(out.lines().any(|l| l.trim() == WASM_TARGET))
}

/// Installs the `wasm32` target with rustup if it is missing.
pub fn ensure_wasm_target() -> Result<()> {
    match wasm_target_installed() {
        Some(true) => Ok(()),
        Some(false) => {
            eprintln!("the {WASM_TARGET} target is missing: installing it with rustup");
            run(Command::new("rustup").args(["target", "add", WASM_TARGET]))
        }
        // no rustup (a system Rust): the target is there or it is not; cargo says it
        None if which("rustup").is_none() => Ok(()),
        None => bail!("cannot ask rustup for the installed targets (rustup target add {WASM_TARGET})"),
    }
}

/// Every check of `mosaikit-plugin doctor`. With `fix` it installs what it can (the `wasm32` target).
pub fn doctor(fix: bool) -> Vec<Check> {
    let mut v = Vec::new();
    v.push(check(
        "mosaikit-plugin",
        Status::Ok,
        format!("{} (plugin API {})", env!("CARGO_PKG_VERSION"), mosaikit_mskp::API_VERSION),
        None,
    ));
    match capture(Command::new("rustc").arg("--version")) {
        Some(s) => match parse_rustc(&s) {
            Some(r) if r >= MIN_RUST => v.push(check("rustc", Status::Ok, s, None)),
            _ => v.push(check(
                "rustc",
                Status::Fail,
                format!("{s} (needs {}.{} or newer)", MIN_RUST.0, MIN_RUST.1),
                Some("rustup update stable"),
            )),
        },
        None => v.push(check(
            "rustc",
            Status::Fail,
            "not found",
            Some("install Rust from https://rustup.rs (the logic of a plugin is Rust compiled to WASM)"),
        )),
    }
    match capture(Command::new("cargo").arg("--version")) {
        Some(s) => v.push(check("cargo", Status::Ok, s, None)),
        None => {
            v.push(check("cargo", Status::Fail, "not found", Some("install Rust from https://rustup.rs")))
        }
    }
    match wasm_target_installed() {
        Some(true) => v.push(check("wasm32 target", Status::Ok, WASM_TARGET, None)),
        Some(false) if fix => match ensure_wasm_target() {
            Ok(()) => {
                v.push(check("wasm32 target", Status::Ok, format!("{WASM_TARGET} installed now"), None))
            }
            Err(e) => v.push(check("wasm32 target", Status::Fail, e.to_string(), None)),
        },
        Some(false) => v.push(check(
            "wasm32 target",
            Status::Fail,
            format!("{WASM_TARGET} is not installed (build installs it by itself)"),
            Some(&format!("rustup target add {WASM_TARGET}, or run doctor --fix")),
        )),
        None => v.push(check(
            "wasm32 target",
            Status::Warn,
            "rustup not found: cannot tell (a system Rust needs the target from its own package)",
            None,
        )),
    }
    match capture(Command::new("node").arg("--version")) {
        Some(s) => match parse_node(&s) {
            Some(n) if n >= MIN_NODE => v.push(check("node", Status::Ok, s, None)),
            _ => v.push(check(
                "node",
                Status::Warn,
                format!("{s} (needs {MIN_NODE} or newer for the UI of a plugin)"),
                Some("install a current Node.js LTS from https://nodejs.org"),
            )),
        },
        None => v.push(check(
            "node",
            Status::Warn,
            "not found: only needed by plugins with a UI",
            Some("install Node.js LTS from https://nodejs.org"),
        )),
    }
    match capture(npm().arg("--version")) {
        Some(s) => v.push(check("npm", Status::Ok, s, None)),
        None => v.push(check("npm", Status::Warn, "not found: only needed by plugins with a UI", None)),
    }
    v
}

/// True when no check failed (warnings do not count).
pub fn all_good(checks: &[Check]) -> bool {
    checks.iter().all(|c| c.status != Status::Fail)
}

pub fn print(checks: &[Check]) {
    for c in checks {
        let tag = match c.status {
            Status::Ok => "ok  ",
            Status::Warn => "warn",
            Status::Fail => "FAIL",
        };
        println!("[{tag}] {:<16} {}", c.name, c.detail);
        if let (Some(f), true) = (&c.fix, c.status != Status::Ok) {
            println!("       -> {f}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_read() {
        assert_eq!(parse_rustc("rustc 1.99.1 (5f94df478 2026-08-27)"), Some((1, 99)));
        assert_eq!(parse_rustc("nonsense"), None);
        assert_eq!(parse_node("v24.21.0\n"), Some(24));
        assert_eq!(parse_node("22.1.0"), Some(22));
    }

    #[test]
    fn doctor_reports_the_toolchain() {
        let checks = doctor(false);
        assert!(checks.iter().any(|c| c.name == "rustc"));
        assert!(checks.iter().any(|c| c.name == "wasm32 target"));
        // the tests run with cargo: rustc is there
        assert_eq!(checks.iter().find(|c| c.name == "rustc").map(|c| c.status), Some(Status::Ok));
    }
}
