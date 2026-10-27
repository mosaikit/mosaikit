//! `cargo xtask clean-temp`: disk usage of the temporary work folder and removal of stale build folders.
//!
//! Only `target` folders inside worktree containers (and old loose files at the top of the temp folder)
//! are deleted, never worktrees themselves (use `worktree remove`). Without `--yes` it only reports.
//! A `target` folder is stale when nothing in it changed for `--days` days and no live heavy run
//! holds a slot from inside its container.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::Result;

use crate::heavy::{live_holders, temp_dir};

/// Size in bytes of a folder and newest modification time, never following junctions or symlinks.
fn measure(p: &Path) -> (u64, Option<SystemTime>) {
    let Ok(meta) = std::fs::symlink_metadata(p) else { return (0, None) };
    if meta.file_type().is_symlink() {
        return (0, None);
    }
    if !meta.is_dir() {
        return (meta.len(), meta.modified().ok());
    }
    let (mut size, mut newest) = (0, None::<SystemTime>);
    if let Ok(rd) = std::fs::read_dir(p) {
        for e in rd.flatten() {
            let (s, t) = measure(&e.path());
            size += s;
            newest = newest.max(t);
        }
    }
    (size, newest)
}

pub fn human(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut v = bytes as f64;
    let mut u = 0;
    while v >= 1024.0 && u < UNITS.len() - 1 {
        v /= 1024.0;
        u += 1;
    }
    format!("{v:.1} {}", UNITS[u])
}

/// Stale: the newest change is older than `days` days (a folder without files counts as stale).
pub fn is_stale_age(newest: Option<SystemTime>, now: SystemTime, days: u64) -> bool {
    match newest {
        None => true,
        Some(t) => now.duration_since(t).is_ok_and(|d| d > Duration::from_secs(days * 86_400)),
    }
}

pub fn clean_temp(days: u64, yes: bool) -> Result<()> {
    let temp = temp_dir();
    let now = SystemTime::now();
    println!(
        "{} (stale = unchanged for {days} days){}",
        temp.display(),
        if yes { "" } else { ", dry run (--yes deletes)" }
    );
    let busy: Vec<String> =
        ["e2e", "test"].iter().flat_map(|k| live_holders(&temp, k)).map(|h| h.dir.to_lowercase()).collect();
    let in_use = |p: &Path| {
        let p = p.to_string_lossy().to_lowercase();
        busy.iter().any(|d| d.starts_with(&p) || p.starts_with(d.as_str()))
    };
    let mut freed = 0u64;
    let mut kept = 0u64;
    let Ok(rd) = std::fs::read_dir(&temp) else {
        println!("nothing to clean");
        return Ok(());
    };
    let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if name == "locks" {
            continue;
        }
        let (size, newest) = measure(&p);
        let stale = is_stale_age(newest, now, days);
        if p.is_dir() {
            println!(
                "{:>10}  {name}/{}",
                human(size),
                if stale { "  (stale: `worktree remove` if done)" } else { "" }
            );
            // build folders inside this container
            let mut targets = Vec::new();
            if let Ok(rd) = std::fs::read_dir(&p) {
                for sub in rd.flatten() {
                    targets.push(sub.path().join("target"));
                }
            }
            for t in targets.into_iter().filter(|t| {
                t.is_dir() && !std::fs::symlink_metadata(t).is_ok_and(|m| m.file_type().is_symlink())
            }) {
                let (ts, tn) = measure(&t);
                let old = is_stale_age(tn, now, days);
                let used = in_use(&p);
                let verdict = if used {
                    "in use"
                } else if old {
                    if yes {
                        "deleted"
                    } else {
                        "would delete"
                    }
                } else {
                    "recent"
                };
                println!(
                    "{:>10}    {}  [{verdict}]",
                    human(ts),
                    t.strip_prefix(&temp).unwrap_or(&t).display()
                );
                if old && !used {
                    if yes {
                        std::fs::remove_dir_all(&t)?;
                    }
                    freed += ts;
                } else {
                    kept += ts;
                }
            }
        } else if stale {
            println!("{:>10}  {name}  [{}]", human(size), if yes { "deleted" } else { "would delete" });
            if yes {
                std::fs::remove_file(&p)?;
            }
            freed += size;
        }
    }
    let shared = temp.parent().map(|d| d.join(".cargo-target-shared"));
    if let Some(s) = shared.filter(|s| s.is_dir()) {
        println!("{:>10}  {} (shared build cache, never deleted here)", human(measure(&s).0), s.display());
    }
    println!(
        "{} {}, build folders kept: {}",
        if yes { "freed" } else { "would free" },
        human(freed),
        human(kept)
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staleness_by_age() {
        let now = SystemTime::now();
        let day = Duration::from_secs(86_400);
        assert!(is_stale_age(None, now, 7));
        assert!(!is_stale_age(Some(now - day * 3), now, 7));
        assert!(is_stale_age(Some(now - day * 8), now, 7));
    }

    #[test]
    fn sizes() {
        assert_eq!(human(512), "512.0 B");
        assert_eq!(human(3 * 1024 * 1024), "3.0 MB");
    }
}
