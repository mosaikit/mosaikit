//! Utilita' comuni: percorsi, esecuzione di comandi, ricerca dei binari.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};

/// Radice del workspace (la cartella che contiene `xtask/`).
pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("xtask dentro il workspace").to_path_buf()
}

pub fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// `npm` su Windows e' `npm.cmd`.
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
    let status = cmd.status().with_context(|| format!("avvio di {shown}"))?;
    if !status.success() {
        bail!("comando fallito ({status}): {shown}");
    }
    Ok(())
}

pub fn output(cmd: &mut Command) -> Result<String> {
    let out = cmd.stderr(Stdio::inherit()).output().with_context(|| format!("avvio di {cmd:?}"))?;
    if !out.status.success() {
        bail!("comando fallito ({}): {cmd:?}", out.status);
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Cerca un eseguibile nel PATH.
pub fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|p| p.join(exe(name))).find(|p| p.is_file())
}

/// Cartella `bin` di PostgreSQL: `MOSAIKIT_PG_BIN`, PATH, poi i percorsi d'installazione tipici.
pub fn pg_bin() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("MOSAIKIT_PG_BIN") {
        let p = PathBuf::from(p);
        if p.join(exe("pg_ctl")).is_file() {
            return Some(p);
        }
    }
    if let Some(p) = std::env::var_os("PGBIN") {
        let p = PathBuf::from(p);
        if p.join(exe("pg_ctl")).is_file() {
            return Some(p);
        }
    }
    if let Some(p) = which("pg_ctl") {
        return p.parent().map(Path::to_path_buf);
    }
    let bases: &[&str] = if cfg!(windows) {
        &[r"C:\Program Files\PostgreSQL"]
    } else {
        &["/usr/lib/postgresql", "/usr/local/opt", "/opt/homebrew/opt"]
    };
    let mut found: Vec<PathBuf> = Vec::new();
    for base in bases {
        if let Ok(rd) = std::fs::read_dir(base) {
            for e in rd.flatten() {
                let bin = e.path().join("bin");
                if bin.join(exe("pg_ctl")).is_file() {
                    found.push(bin);
                }
            }
        }
    }
    found.sort();
    found.pop()
}

pub fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from).with_context(|| format!("lettura {}", from.display()))? {
        let e = e?;
        let dest = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &dest)?;
        } else {
            std::fs::copy(e.path(), &dest).with_context(|| format!("copia {}", e.path().display()))?;
        }
    }
    Ok(())
}

/// Tutti i file di una cartella, con percorso relativo in stile `a/b.txt`.
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
