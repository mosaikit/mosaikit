//! `cargo xtask worktree add|remove|list`: parallel checkouts of the kernel and of the plugins, ready to build.
//!
//! Layout (the plugin build needs a real folder `mosaikit` beside `mosaikit-plugins`):
//!
//! ```text
//! <temp>/<name>/mosaikit            git worktree of the kernel, branch work-<name>
//! <temp>/<name>/mosaikit-plugins    git worktree of the plugins, branch <name>-plugins
//! <temp>/<name>/.worktree.env       MOSAIKIT_E2E_PORT, MOSAIKIT_DB_SUFFIX, optional cache settings
//! ```
//!
//! `node_modules` folders are junctions to the ones of the main checkouts. Rule: a junction is never
//! followed by a delete (once it destroyed tracked files), so `remove` unlinks every one of them
//! with `rmdir` before anything else touches the folder.
//!
//! The `.worktree.env` of the container is loaded by `main` into the environment of every xtask command
//! (variables already set win): that is the single mechanism for the e2e port and database name.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

use crate::heavy::temp_dir;
use crate::util::{output, root, run};

const ENV_FILE: &str = ".worktree.env";
/// First e2e port handed out; each worktree takes 10 (app, plugins, identity provider).
const PORT_BASE: u16 = 18200;
const PORT_STEP: u16 = 10;
const PORT_COUNT: u16 = 40;
/// Folder of the build caches: `MOSAIKIT_DEV_ROOT`, else the parent of the folder that holds the checkouts.
fn dev_root() -> PathBuf {
    std::env::var_os("MOSAIKIT_DEV_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| root().parent().and_then(Path::parent).map(Path::to_path_buf).unwrap_or_else(root))
}

/// Loads the `.worktree.env` of the container of this checkout (the folder that contains `mosaikit/`),
/// or the one in the root of the checkout, into the process environment. Variables already set win.
pub fn load_env() {
    let r = root();
    for dir in [Some(r.clone()), r.parent().map(Path::to_path_buf)].into_iter().flatten() {
        if let Ok(text) = std::fs::read_to_string(dir.join(ENV_FILE)) {
            for (k, v) in parse_env(&text) {
                if std::env::var_os(&k).is_none() {
                    std::env::set_var(&k, v);
                }
            }
            return;
        }
    }
}

/// `KEY=value` lines; blank lines and `#` comments are ignored.
pub fn parse_env(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
        .collect()
}

/// A name usable in folders, branches and database names: lower case letters, digits and dashes.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 20
        && name.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Database suffix of a worktree: `wt_<name>` (dashes become underscores), so the e2e database is
/// `mosaikit_e2e_wt_<name>`.
pub fn db_suffix(name: &str) -> String {
    format!("wt_{}", name.replace('-', "_"))
}

/// First free port block (app, plugins, identity provider) given the ports already assigned.
pub fn next_port(used: &[u16]) -> Option<u16> {
    (0..PORT_COUNT).map(|i| PORT_BASE + i * PORT_STEP).find(|p| !used.contains(p))
}

/// Containers of `temp` with a `.worktree.env`: (name, its variables).
fn containers(temp: &Path) -> Vec<(String, BTreeMap<String, String>)> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(temp) {
        for e in rd.flatten() {
            if let Ok(text) = std::fs::read_to_string(e.path().join(ENV_FILE)) {
                out.push((e.file_name().to_string_lossy().into_owned(), parse_env(&text)));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Main checkout of a repository, from any of its worktrees.
fn main_checkout(dir: &Path) -> Result<PathBuf> {
    let common = output(Command::new("git").current_dir(dir).args([
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
    ]))?;
    // git prints forward slashes; `mklink` and `rmdir` take them for options
    let common = PathBuf::from(if cfg!(windows) {
        common.trim().replace('/', "\\")
    } else {
        common.trim().to_owned()
    });
    common.parent().map(Path::to_path_buf).context("git common dir without parent")
}

fn is_link(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

/// `node_modules` folders of a checkout (depth up to 3), junctions included, never entering them.
fn find_node_modules(base: &Path) -> Vec<PathBuf> {
    fn go(dir: &Path, depth: u8, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let p = e.path();
            if name == "node_modules" {
                out.push(p);
            } else if depth < 3
                && !matches!(name.as_str(), "target" | ".git" | "dist" | ".dev")
                && !is_link(&p)
                && p.is_dir()
            {
                go(&p, depth + 1, out);
            }
        }
    }
    let mut out = Vec::new();
    go(base, 0, &mut out);
    out.sort();
    out
}

fn junction(link: &Path, target: &Path) -> Result<()> {
    if cfg!(windows) {
        run(Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null()))
    } else {
        #[cfg(unix)]
        {
            return Ok(std::os::unix::fs::symlink(target, link)?);
        }
        #[allow(unreachable_code)]
        Ok(())
    }
}

/// Unlinks a junction (or symlink) without touching its target.
fn unlink(link: &Path) -> Result<()> {
    if cfg!(windows) {
        run(Command::new("cmd").args(["/C", "rmdir"]).arg(link))
    } else {
        Ok(std::fs::remove_file(link)?)
    }
}

fn link_node_modules(main: &Path, wt: &Path) -> Result<usize> {
    let mut n = 0;
    for src in find_node_modules(main) {
        if is_link(&src) {
            continue;
        }
        let rel = src.strip_prefix(main)?;
        let dest = wt.join(rel);
        if dest.parent().is_some_and(Path::is_dir) && !dest.exists() {
            junction(&dest, &src)?;
            n += 1;
        }
    }
    Ok(n)
}

pub fn add(name: &str, base: &str) -> Result<()> {
    if !valid_name(name) {
        bail!("invalid name '{name}': 1-20 characters, lower case letters, digits and dashes");
    }
    let temp = temp_dir();
    let container = temp.join(name);
    if container.exists() {
        bail!("{} already exists (worktree remove {name} first)", container.display());
    }
    let used: Vec<u16> =
        containers(&temp).iter().filter_map(|(_, v)| v.get("MOSAIKIT_E2E_PORT")?.parse().ok()).collect();
    let port = next_port(&used).context("no free e2e port block left (remove old worktrees)")?;

    let kernel = main_checkout(&root())?;
    let plugins = kernel.parent().context("kernel without parent folder")?.join("mosaikit-plugins");
    if !plugins.is_dir() {
        bail!("{} not found", plugins.display());
    }
    std::fs::create_dir_all(&container)?;
    let (wk, wp) = (container.join("mosaikit"), container.join("mosaikit-plugins"));
    // first of all: after a failure half way, `worktree remove` can still clean up
    let env = format!(
        "# worktree '{name}': loaded by cargo xtask (variables already set win)\n\
         MOSAIKIT_E2E_PORT={port}\n\
         MOSAIKIT_DB_SUFFIX={suffix}\n\
         SCCACHE_DIR={sccache}\n\
         # shared build cache for every worktree that opts in (less disk, more cache hits; builds of\n\
         # different checkouts then queue on the same target folder lock):\n\
         # CARGO_TARGET_DIR={shared}\n",
        suffix = db_suffix(name),
        sccache = dev_root().join(".sccache").display(),
        shared = dev_root().join(".cargo-target-shared").display()
    );
    std::fs::write(container.join(ENV_FILE), &env)?;
    let branch = format!("work-{name}");
    run(Command::new("git")
        .current_dir(&kernel)
        .args(["worktree", "add", "-b", &branch])
        .arg(&wk)
        .arg(base))?;
    let pbranch = format!("{name}-plugins");
    run(Command::new("git").current_dir(&plugins).args(["worktree", "add", "-b", &pbranch]).arg(&wp))?;
    let n = link_node_modules(&kernel, &wk)? + link_node_modules(&plugins, &wp)?;
    eprintln!("created {} ({n} node_modules junctions)", container.display());
    println!("cd {}", wk.display());
    println!("{}", env.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join("\n"));
    println!("(xtask loads {ENV_FILE} by itself; to use the same values in other tools, export them)");
    Ok(())
}

pub fn list() -> Result<()> {
    let temp = temp_dir();
    let rows = containers(&temp);
    if rows.is_empty() {
        println!("no worktrees in {}", temp.display());
    }
    for (name, env) in rows {
        let kernel = temp.join(&name).join("mosaikit");
        let branch = output(Command::new("git").current_dir(&kernel).args(["branch", "--show-current"]))
            .map(|b| b.trim().to_owned())
            .unwrap_or_else(|_| "?".into());
        println!(
            "{name:<20} port {:<6} db suffix {:<18} branch {branch}  {}",
            env.get("MOSAIKIT_E2E_PORT").map_or("-", String::as_str),
            env.get("MOSAIKIT_DB_SUFFIX").map_or("-", String::as_str),
            kernel.display()
        );
    }
    Ok(())
}

pub fn remove(name: &str) -> Result<()> {
    if !valid_name(name) {
        bail!("invalid name '{name}'");
    }
    let temp = temp_dir();
    let container = temp.join(name);
    if !container.join(ENV_FILE).is_file() {
        bail!("{} is not a worktree container made by `worktree add`", container.display());
    }
    let (wk, wp) = (container.join("mosaikit"), container.join("mosaikit-plugins"));
    let kernel = main_checkout(&wk).ok();
    let plugins = main_checkout(&wp).ok();
    // 1. junctions first: nothing below may ever see through them
    for base in [&wk, &wp] {
        for nm in find_node_modules(base).into_iter().filter(|p| is_link(p)) {
            unlink(&nm)?;
        }
    }
    // 2. worktrees
    if let Some(k) = &kernel {
        let _ = run(Command::new("git").current_dir(k).args(["worktree", "remove", "--force"]).arg(&wk));
    }
    if let Some(p) = &plugins {
        let _ = run(Command::new("git").current_dir(p).args(["worktree", "remove", "--force"]).arg(&wp));
    }
    // 3. branches, only when merged (`-d`)
    for (repo, branch) in [(&kernel, format!("work-{name}")), (&plugins, format!("{name}-plugins"))] {
        if let Some(r) = repo {
            if Command::new("git")
                .current_dir(r)
                .args(["branch", "-d", &branch])
                .status()
                .is_ok_and(|s| !s.success())
            {
                eprintln!("branch {branch} kept (not merged)");
            }
        }
    }
    // 4. database and roles of this worktree
    let suffix = db_suffix(name);
    for base in ["mosaikit_e2e", "mosaikit_perf"] {
        if let Err(e) = crate::e2e::drop_db(&format!("{base}_{suffix}")) {
            eprintln!("database {base}_{suffix} not dropped ({e:#})");
        }
    }
    // 5. the folder, after checking that no link is left in it
    let mut left = Vec::new();
    find_links(&container, &mut left);
    if !left.is_empty() {
        bail!("links left in {}: {left:?}; not deleting", container.display());
    }
    if container.exists() {
        std::fs::remove_dir_all(&container).with_context(|| format!("deleting {}", container.display()))?;
    }
    eprintln!("removed {}", container.display());
    Ok(())
}

pub(crate) fn find_links(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if is_link(&p) {
                out.push(p);
            } else if p.is_dir() {
                find_links(&p, out);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(valid_name("devtools"));
        assert!(valid_name("phase-8"));
        assert!(!valid_name(""));
        assert!(!valid_name("Up"));
        assert!(!valid_name("-x"));
        assert!(!valid_name("a_b"));
        assert!(!valid_name("a-name-that-is-way-too-long"));
        assert_eq!(db_suffix("phase-8"), "wt_phase_8");
    }

    #[test]
    fn ports_skip_the_used_ones() {
        assert_eq!(next_port(&[]), Some(18200));
        assert_eq!(next_port(&[18200, 18220]), Some(18210));
        let all: Vec<u16> = (0..PORT_COUNT).map(|i| PORT_BASE + i * PORT_STEP).collect();
        assert_eq!(next_port(&all), None);
    }

    #[test]
    fn env_file() {
        let e =
            parse_env("# c\n\nMOSAIKIT_E2E_PORT=18210\n MOSAIKIT_DB_SUFFIX = wt_x \n# CARGO_TARGET_DIR=z\n");
        assert_eq!(e.len(), 2);
        assert_eq!(e["MOSAIKIT_E2E_PORT"], "18210");
        assert_eq!(e["MOSAIKIT_DB_SUFFIX"], "wt_x");
    }
}
