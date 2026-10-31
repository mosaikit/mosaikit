//! Running commands and finding binaries (no knowledge of any repository layout).

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};

pub fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// `npm` on Windows is `npm.cmd`.
pub fn npm() -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", "npm"]);
        c
    } else {
        Command::new("npm")
    }
}

pub fn run(cmd: &mut Command) -> Result<()> {
    let shown = format!("{cmd:?}");
    eprintln!("  $ {}", shown.replace('"', ""));
    let status = cmd.status().with_context(|| format!("starting {shown}"))?;
    if !status.success() {
        bail!("command failed ({status}): {shown}");
    }
    Ok(())
}

/// Standard output of a command (None if it cannot start or fails). Standard error is dropped.
pub fn capture(cmd: &mut Command) -> Option<String> {
    let out = cmd.stderr(Stdio::null()).stdin(Stdio::null()).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Looks for an executable in the PATH.
pub fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|p| p.join(exe(name))).find(|p| p.is_file())
}

/// Every file of a folder, with a relative path in the `a/b.txt` style.
pub fn walk_files(dir: &Path) -> Result<Vec<(String, PathBuf)>> {
    fn go(base: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) -> Result<()> {
        for e in std::fs::read_dir(dir)? {
            let e = e?;
            let p = e.path();
            if e.file_type()?.is_dir() {
                go(base, &p, out)?;
            } else {
                let rel = p.strip_prefix(base)?.to_string_lossy().replace('\\', "/");
                out.push((rel, p));
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    if dir.is_dir() {
        go(dir, dir, &mut out)?;
    }
    out.sort();
    Ok(out)
}
