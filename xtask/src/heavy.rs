//! Machine-wide slots for heavy runs (`e2e`, `test`, `ci`), so that several agents or people working in
//! parallel worktrees do not overload the computer (flaky timeouts).
//!
//! A slot is a file `<temp>/locks/<kind>/slot-<n>.lock` created atomically (`create_new`) with the pid and
//! start time of the holder. A holder that is gone (crash, kill, power loss) is detected by pid and start
//! time, and its slot is taken over. The guard releases the slot on drop; a nested request for the same
//! kind inside one process (`ci` runs `test`) reuses the slot already held.
//!
//! `MOSAIKIT_HEAVY_SLOTS`: `3` (every kind) or `e2e=2,test=3`. Defaults: e2e 1, test 2.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::util::root;

static HELD: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn held() -> std::sync::MutexGuard<'static, Option<HashSet<String>>> {
    HELD.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Common folder of the temporary work of every worktree: `MOSAIKIT_TEMP`, the `mosaikit-temp` folder
/// that contains this checkout, or the one beside it.
pub fn temp_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("MOSAIKIT_TEMP") {
        return PathBuf::from(p);
    }
    let r = root();
    r.ancestors()
        .find(|a| a.file_name().is_some_and(|n| n == "mosaikit-temp"))
        .map(Path::to_path_buf)
        .unwrap_or_else(|| r.parent().unwrap_or(&r).join("mosaikit-temp"))
}

/// Number of slots of a kind from the value of `MOSAIKIT_HEAVY_SLOTS` (never less than 1).
pub fn slots_for(kind: &str, setting: Option<&str>) -> usize {
    let default = if kind == "e2e" { 1 } else { 2 };
    let Some(s) = setting else { return default };
    let mut all = None;
    for part in s.split(',').map(str::trim).filter(|p| !p.is_empty()) {
        match part.split_once('=') {
            Some((k, v)) if k.trim() == kind => {
                return v.trim().parse::<usize>().map_or(default, |n| n.max(1))
            }
            Some(_) => {}
            None => all = part.parse::<usize>().ok().map(|n| n.max(1)),
        }
    }
    all.unwrap_or(default)
}

/// Who holds a slot.
#[derive(Debug, PartialEq, Eq)]
pub struct Holder {
    pub pid: u32,
    /// start time of the process (seconds since the epoch), to tell a reused pid
    pub started: u64,
    pub label: String,
    pub dir: String,
}

impl Holder {
    pub fn parse(text: &str) -> Option<Holder> {
        let mut l = text.lines();
        Some(Holder {
            pid: l.next()?.trim().parse().ok()?,
            started: l.next()?.trim().parse().ok()?,
            label: l.next()?.trim().to_owned(),
            dir: l.next().unwrap_or("").trim().to_owned(),
        })
    }

    pub fn render(&self) -> String {
        format!("{}\n{}\n{}\n{}\n", self.pid, self.started, self.label, self.dir)
    }
}

/// A slot is stale when its process does not exist, or exists with another start time (reused pid).
/// `live_start` is the start time of the process now running with that pid, if any.
pub fn is_stale(holder: &Holder, live_start: Option<u64>) -> bool {
    match live_start {
        None => true,
        Some(s) => s.abs_diff(holder.started) > 2,
    }
}

fn live_start(pid: u32) -> Option<u64> {
    let mut sys = System::new();
    let p = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[p]), true);
    sys.process(p).map(sysinfo::Process::start_time)
}

/// Holders of every slot of a kind that are still alive (for `clean-temp` and messages).
pub fn live_holders(temp: &Path, kind: &str) -> Vec<Holder> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(temp.join("locks").join(kind)) {
        for e in rd.flatten() {
            if let Some(h) = std::fs::read_to_string(e.path()).ok().and_then(|t| Holder::parse(&t)) {
                if !is_stale(&h, live_start(h.pid)) {
                    out.push(h);
                }
            }
        }
    }
    out
}

pub struct Guard {
    file: Option<PathBuf>,
    kind: String,
}

impl Drop for Guard {
    fn drop(&mut self) {
        if let Some(f) = self.file.take() {
            let _ = std::fs::remove_file(f);
            if let Some(set) = held().as_mut() {
                set.remove(&self.kind);
            }
        }
    }
}

/// Waits for a free slot of `kind` and holds it until the guard is dropped.
pub fn acquire(kind: &str, label: &str) -> Result<Guard> {
    if !held().get_or_insert_with(HashSet::new).insert(kind.to_owned()) {
        return Ok(Guard { file: None, kind: kind.into() });
    }
    let result = acquire_in(&temp_dir(), kind, label);
    if result.is_err() {
        if let Some(set) = held().as_mut() {
            set.remove(kind);
        }
    }
    result
}

fn acquire_in(temp: &Path, kind: &str, label: &str) -> Result<Guard> {
    use std::io::Write;
    let n = slots_for(kind, std::env::var("MOSAIKIT_HEAVY_SLOTS").ok().as_deref());
    let dir = temp.join("locks").join(kind);
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    let pid = std::process::id();
    let me = Holder {
        pid,
        started: live_start(pid).unwrap_or(0),
        label: label.into(),
        dir: root().display().to_string(),
    };
    let began = Instant::now();
    let mut last_msg: Option<Instant> = None;
    loop {
        let mut busy = Vec::new();
        for i in 0..n {
            let path = dir.join(format!("slot-{i}.lock"));
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut f) => {
                    f.write_all(me.render().as_bytes())?;
                    if last_msg.is_some() {
                        eprintln!("== slot {kind} free: starting after {}s", began.elapsed().as_secs());
                    }
                    return Ok(Guard { file: Some(path), kind: kind.into() });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    match std::fs::read_to_string(&path).ok().and_then(|t| Holder::parse(&t)) {
                        Some(h) if !is_stale(&h, live_start(h.pid)) => busy.push(h),
                        Some(h) => {
                            eprintln!("== slot {kind}: removing stale lock of pid {} ({})", h.pid, h.label);
                            let _ = std::fs::remove_file(&path);
                        }
                        // unreadable: being written right now, or garbage left by a crash
                        None => {
                            let old = std::fs::metadata(&path)
                                .and_then(|m| m.modified())
                                .ok()
                                .and_then(|t| t.elapsed().ok())
                                .is_some_and(|d| d > Duration::from_secs(10));
                            if old {
                                let _ = std::fs::remove_file(&path);
                            }
                        }
                    }
                }
                Err(e) => return Err(e).with_context(|| format!("creating {}", path.display())),
            }
        }
        if last_msg.is_none_or(|t| t.elapsed() > Duration::from_secs(30)) {
            let who: Vec<String> =
                busy.iter().map(|h| format!("{} (pid {}, {})", h.label, h.pid, h.dir)).collect();
            eprintln!(
                "== waiting for a heavy-run slot '{kind}' ({n} at once); held by: {} [{}s]",
                who.join("; "),
                began.elapsed().as_secs()
            );
            last_msg = Some(Instant::now());
        }
        std::thread::sleep(Duration::from_secs(2));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_counts() {
        assert_eq!(slots_for("e2e", None), 1);
        assert_eq!(slots_for("test", None), 2);
        assert_eq!(slots_for("e2e", Some("3")), 3);
        assert_eq!(slots_for("test", Some("e2e=2,test=4")), 4);
        assert_eq!(slots_for("e2e", Some("e2e=2,test=4")), 2);
        assert_eq!(slots_for("e2e", Some("test=4")), 1);
        assert_eq!(slots_for("e2e", Some("0")), 1);
        assert_eq!(slots_for("e2e", Some("junk")), 1);
    }

    #[test]
    fn holder_round_trip_and_staleness() {
        let h = Holder { pid: 42, started: 1000, label: "e2e".into(), dir: "C:\\x".into() };
        assert_eq!(Holder::parse(&h.render()), Some(h));
        let h = Holder { pid: 42, started: 1000, label: "e2e".into(), dir: String::new() };
        assert!(is_stale(&h, None));
        assert!(!is_stale(&h, Some(1001)));
        assert!(is_stale(&h, Some(5000)), "same pid, other start time: pid reused");
        assert_eq!(Holder::parse("garbage"), None);
    }

    #[test]
    fn slots_are_exclusive_and_taken_over_when_stale() {
        let temp = std::env::temp_dir().join(format!("msk-heavy-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        let kind = "unit";
        let dir = temp.join("locks").join(kind);
        std::fs::create_dir_all(&dir).unwrap();
        // stale lock of a pid that cannot exist
        let dead = Holder { pid: u32::MAX - 1, started: 5, label: "dead".into(), dir: String::new() };
        std::fs::write(dir.join("slot-0.lock"), dead.render()).unwrap();
        let g = acquire_in(&temp, kind, "first").unwrap();
        assert_eq!(live_holders(&temp, kind).len(), 1);
        let path = g.file.clone().unwrap();
        assert!(path.exists());
        drop(g);
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&temp);
    }
}
