//! Results of the automated tests: every suite run by `cargo xtask test`, `ci` and `e2e` leaves a
//! machine-readable file in `tests/results/raw/` (git-ignored: JUnit of nextest, libtest output of
//! `cargo test`, JSON of vitest and of Playwright) with a small `<suite>.meta.json`;
//! `cargo xtask test-report` turns the latest of them into `tests/results/test-results.md`.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::util::{output, root};

/// How the output of a suite is written.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Format {
    /// JUnit XML of cargo-nextest
    Junit,
    /// text output of `cargo test` (libtest)
    Libtest,
    /// JSON reporter of vitest
    Vitest,
    /// JSON reporter of Playwright
    Playwright,
    /// only the exit status (a script that is not a known test runner)
    Status,
}

#[derive(Debug, Serialize, Deserialize)]
struct Meta {
    suite: String,
    title: String,
    order: u32,
    format: Format,
    /// file name in the results folder
    file: Option<String>,
    ok: bool,
    duration_s: f64,
    commit: String,
    finished: String,
}

/// The folder of the machine-readable results of this checkout.
pub fn dir() -> PathBuf {
    root().join("tests").join("results").join("raw")
}

/// A suite to run and record.
pub struct Suite<'a> {
    /// identifier, also the base of the file names (`rust-postgres`, `vitest-ui-host`…)
    pub id: String,
    pub title: String,
    /// position in the report
    pub order: u32,
    pub format: Format,
    /// for JUnit: where nextest writes the file (copied into the results folder after the run)
    pub junit_from: Option<PathBuf>,
    pub cmd: &'a mut Command,
}

/// Runs a suite, keeps its output in the results folder and writes its meta file. Returns whether it
/// passed; a command that cannot start is an error.
pub fn run_suite(s: Suite) -> Result<bool> {
    std::fs::create_dir_all(dir())?;
    let shown = format!("{:?}", s.cmd);
    eprintln!("== {}\n  $ {}", s.title, shown.replace('"', ""));
    let start = Instant::now();
    let mut file = None;
    let ok = match s.format {
        Format::Libtest => {
            // the output goes to the terminal and to the file at the same time
            let name = format!("{}.txt", s.id);
            let mut out = std::fs::File::create(dir().join(&name))?;
            let mut child =
                s.cmd.stdout(Stdio::piped()).spawn().with_context(|| format!("starting {shown}"))?;
            let stdout = child.stdout.take().context("stdout of the tests")?;
            for line in BufReader::new(stdout).lines() {
                let line = line?;
                println!("{line}");
                writeln!(out, "{line}")?;
            }
            file = Some(name);
            child.wait()?.success()
        }
        _ => {
            if let Some(f) = s.cmd.get_envs().find(|(k, _)| *k == "E2E_JSON").and_then(|(_, v)| v) {
                file = Path::new(f).file_name().map(|n| n.to_string_lossy().into_owned());
            }
            s.cmd.status().with_context(|| format!("starting {shown}"))?.success()
        }
    };
    if s.format == Format::Junit {
        let name = format!("{}.xml", s.id);
        let _ = std::fs::remove_file(dir().join(&name));
        if let Some(from) = &s.junit_from {
            if from.is_file() {
                std::fs::copy(from, dir().join(&name))?;
                file = Some(name);
            }
        }
    }
    if s.format == Format::Vitest {
        let name = format!("{}.json", s.id);
        if dir().join(&name).is_file() {
            file = Some(name);
        }
    }
    let meta = Meta {
        suite: s.id.clone(),
        title: s.title,
        order: s.order,
        format: s.format,
        file,
        ok,
        duration_s: start.elapsed().as_secs_f64(),
        commit: commit(),
        finished: chrono::Utc::now().format("%Y-%m-%d %H:%M UTC").to_string(),
    };
    std::fs::write(dir().join(format!("{}.meta.json", s.id)), serde_json::to_vec_pretty(&meta)?)?;
    Ok(ok)
}

/// Removes the results of suites whose identifier starts with `prefix` (before a new run of them).
pub fn clear(prefix: &str) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(dir()) else { return Ok(()) };
    for e in entries.flatten() {
        if e.file_name().to_string_lossy().starts_with(prefix) {
            let _ = std::fs::remove_file(e.path());
        }
    }
    Ok(())
}

fn git(args: &[&str]) -> String {
    output(Command::new("git").current_dir(root()).args(args))
        .map(|s| s.trim().to_owned())
        .unwrap_or_default()
}

/// Whether the code changed since `commit` (the report in tests/results does not count).
fn changed_since(commit: &str) -> bool {
    if commit.is_empty() {
        return true;
    }
    if commit == self::commit() {
        return false;
    }
    let diff = output(Command::new("git").current_dir(root()).args([
        "diff",
        "--name-only",
        commit,
        "HEAD",
        "--",
        ".",
        ":(exclude)tests/results",
    ]));
    diff.map(|d| !d.trim().is_empty()).unwrap_or(true)
}

fn commit() -> String {
    git(&["rev-parse", "--short", "HEAD"])
}

// ------------------------------------------------------------------ parsing

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Status {
    Failed,
    Passed,
    Skipped,
}

#[derive(Debug)]
struct Case {
    group: String,
    name: String,
    status: Status,
    /// milliseconds
    duration: Option<f64>,
    message: Option<String>,
}

fn xml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';') else { break };
        let ent = &rest[1..end];
        let ch = match ent {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let key = format!(" {name}=\"");
    let i = tag.find(&key)? + key.len();
    let end = tag[i..].find('"')? + i;
    Some(xml_unescape(&tag[i..end]))
}

/// The `<testcase>` elements of a JUnit file (the format of cargo-nextest).
fn parse_junit(text: &str) -> Vec<Case> {
    let mut cases = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("<testcase") {
        rest = &rest[i..];
        let Some(tag_end) = rest.find('>') else { break };
        let tag = &rest[..tag_end];
        let self_closing = tag.ends_with('/');
        let body_end =
            if self_closing { tag_end + 1 } else { rest.find("</testcase>").unwrap_or(tag_end + 1) };
        let body = &rest[tag_end + 1..body_end.max(tag_end + 1)];
        let (status, message) = if let Some(j) = body.find("<failure").or_else(|| body.find("<error")) {
            let f = &body[j..];
            let ftag = &f[..f.find('>').unwrap_or(f.len())];
            let mut msg = attr(ftag, "message").unwrap_or_default();
            if msg.is_empty() {
                let text_start = f.find('>').map(|k| k + 1).unwrap_or(0);
                let text_end = f.find("</").unwrap_or(f.len());
                msg = xml_unescape(f[text_start..text_end.max(text_start)].trim());
            }
            (Status::Failed, Some(msg))
        } else if body.contains("<skipped") {
            (Status::Skipped, None)
        } else {
            (Status::Passed, None)
        };
        cases.push(Case {
            group: attr(tag, "classname").unwrap_or_default(),
            name: attr(tag, "name").unwrap_or_default(),
            status,
            duration: attr(tag, "time").and_then(|t| t.parse::<f64>().ok()).map(|s| s * 1000.0),
            message,
        });
        rest = &rest[body_end.min(rest.len())..];
        if self_closing && rest.starts_with('>') {
            rest = &rest[1..];
        }
    }
    cases
}

/// The `test … ok|FAILED|ignored` lines of `cargo test`, grouped by test binary or doc-tests.
fn parse_libtest(text: &str) -> Vec<Case> {
    let mut cases = Vec::new();
    let mut group = String::new();
    let mut failures: BTreeMap<String, String> = BTreeMap::new();
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.next() {
        let t = line.trim();
        if let Some(r) = t.strip_prefix("Running ") {
            // "Running unittests src/lib.rs (target\debug\deps\mosaikit_kernel-….exe)" or "Running tests\x.rs (…)"
            let what = r.split(" (").next().unwrap_or(r).trim_start_matches("unittests ").to_owned();
            let bin = r
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or("")
                .trim_end_matches(')')
                .split('-')
                .next()
                .unwrap_or("")
                .to_owned();
            group = if bin.is_empty() { what } else { format!("{bin} · {what}") };
        } else if let Some(r) = t.strip_prefix("Doc-tests ") {
            group = format!("{r} · doc-tests");
        } else if let Some(r) = t.strip_prefix("---- ") {
            // the output of a failed test, until the next marker
            let name = r.trim_end_matches(" stdout ----").trim_end_matches(" stderr ----").to_owned();
            let mut msg = Vec::new();
            while let Some(next) = lines.peek() {
                if next.starts_with("---- ") || next.trim() == "failures:" {
                    break;
                }
                msg.push(lines.next().unwrap_or_default());
            }
            failures.insert(name, msg.join("\n").trim().to_owned());
        } else if let Some(r) = t.strip_prefix("test ") {
            let Some((name, result)) = r.rsplit_once(" ... ") else { continue };
            let status = match result.trim() {
                "ok" => Status::Passed,
                "FAILED" => Status::Failed,
                s if s.starts_with("ignored") => Status::Skipped,
                _ => continue,
            };
            cases.push(Case {
                group: group.clone(),
                name: name.to_owned(),
                status,
                duration: None,
                message: None,
            });
        }
    }
    for c in &mut cases {
        if c.status == Status::Failed {
            c.message = failures.get(&c.name).cloned();
        }
    }
    cases
}

/// The JSON reporter of vitest (jest compatible).
fn parse_vitest(v: &Value) -> Vec<Case> {
    let mut cases = Vec::new();
    for file in v["testResults"].as_array().into_iter().flatten() {
        let path = file["name"].as_str().unwrap_or_default().replace('\\', "/");
        let group = short_path(&path);
        for a in file["assertionResults"].as_array().into_iter().flatten() {
            let status = match a["status"].as_str().unwrap_or_default() {
                "passed" => Status::Passed,
                "failed" => Status::Failed,
                _ => Status::Skipped,
            };
            let message = a["failureMessages"]
                .as_array()
                .and_then(|m| m.first())
                .and_then(Value::as_str)
                .map(str::to_owned);
            cases.push(Case {
                group: group.clone(),
                name: a["fullName"].as_str().or(a["title"].as_str()).unwrap_or_default().to_owned(),
                status,
                duration: a["duration"].as_f64(),
                message,
            });
        }
        // a file that fails to load has no assertions but a message
        if file["status"].as_str() == Some("failed")
            && file["assertionResults"].as_array().is_none_or(|a| a.is_empty())
        {
            cases.push(Case {
                group: group.clone(),
                name: "(the file did not run)".into(),
                status: Status::Failed,
                duration: None,
                message: file["message"].as_str().map(str::to_owned),
            });
        }
    }
    cases
}

/// The path from the workspace on (`ui/host/src/app/x.test.ts`), without the machine-specific part.
fn short_path(path: &str) -> String {
    for marker in ["/ui/", "/e2e/", "/mosaikit-plugins/"] {
        if let Some(i) = path.find(marker) {
            return path[i + 1..].to_owned();
        }
    }
    path.rsplit('/').next().unwrap_or(path).to_owned()
}

/// The JSON reporter of Playwright: suites of files, nested describe blocks, specs with their results.
fn parse_playwright(v: &Value) -> Vec<Case> {
    fn walk(suite: &Value, file: &str, prefix: &str, cases: &mut Vec<Case>) {
        let title = suite["title"].as_str().unwrap_or_default();
        let file = suite["file"].as_str().unwrap_or(file);
        // the top suite of a file has the file as title
        let prefix = if title.is_empty() || title == file || file.ends_with(title) {
            prefix.to_owned()
        } else if prefix.is_empty() {
            title.to_owned()
        } else {
            format!("{prefix} › {title}")
        };
        for spec in suite["specs"].as_array().into_iter().flatten() {
            for test in spec["tests"].as_array().into_iter().flatten() {
                let results = test["results"].as_array().cloned().unwrap_or_default();
                let last = results.last().cloned().unwrap_or(Value::Null);
                let status = match test["status"].as_str().unwrap_or_default() {
                    "expected" | "flaky" => Status::Passed,
                    "skipped" => Status::Skipped,
                    _ => Status::Failed,
                };
                let name = spec["title"].as_str().unwrap_or_default();
                let name = if prefix.is_empty() { name.to_owned() } else { format!("{prefix} › {name}") };
                let name =
                    if test["status"].as_str() == Some("flaky") { format!("{name} (flaky)") } else { name };
                let message = last["error"]["message"].as_str().map(str::to_owned);
                cases.push(Case {
                    group: file.to_owned(),
                    name,
                    status,
                    duration: Some(results.iter().filter_map(|r| r["duration"].as_f64()).sum()),
                    message,
                });
            }
        }
        for s in suite["suites"].as_array().into_iter().flatten() {
            walk(s, file, &prefix, cases);
        }
    }
    let mut cases = Vec::new();
    for s in v["suites"].as_array().into_iter().flatten() {
        walk(s, "", "", &mut cases);
    }
    cases
}

fn cases_of(m: &Meta) -> Option<Vec<Case>> {
    let path = dir().join(m.file.as_ref()?);
    let text = std::fs::read_to_string(&path).ok()?;
    Some(match m.format {
        Format::Junit => parse_junit(&text),
        Format::Libtest => parse_libtest(&text),
        Format::Vitest => parse_vitest(&serde_json::from_str(&text).ok()?),
        Format::Playwright => parse_playwright(&serde_json::from_str(&text).ok()?),
        Format::Status => return None,
    })
}

// ------------------------------------------------------------------ the document

fn machine() -> String {
    use sysinfo::System;
    let sys = System::new_all();
    let cpu = sys.cpus().first().map(|c| c.brand().trim().to_owned()).unwrap_or_default();
    let threads = sys.cpus().len();
    let cores = sys.physical_core_count().map(|c| c.to_string()).unwrap_or_else(|| "?".into());
    let ram = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
    let os = System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_owned());
    format!("{os} · {cpu} · {cores} cores, {threads} threads · {ram:.0} GB RAM")
}

fn ms(d: Option<f64>) -> String {
    match d {
        None => "—".into(),
        Some(d) if d >= 1000.0 => format!("{:.1} s", d / 1000.0),
        Some(d) => format!("{d:.0} ms"),
    }
}

fn duration(s: f64) -> String {
    if s >= 60.0 {
        format!("{}m {:02}s", (s / 60.0) as u64, (s % 60.0) as u64)
    } else {
        format!("{s:.0} s")
    }
}

fn cell(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ")
}

fn icon(s: Status) -> &'static str {
    match s {
        Status::Passed => "passed",
        Status::Failed => "**FAILED**",
        Status::Skipped => "skipped",
    }
}

/// Writes `tests/results/test-results.md` from the latest results of every suite.
pub fn generate() -> Result<PathBuf> {
    let mut metas: Vec<Meta> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir()) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().ends_with(".meta.json") {
                if let Ok(m) = serde_json::from_slice::<Meta>(&std::fs::read(e.path())?) {
                    metas.push(m);
                }
            }
        }
    }
    metas.sort_by(|a, b| (a.order, &a.suite).cmp(&(b.order, &b.suite)));
    let head = commit();
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"]);
    // the report itself does not count as a change of the code
    let dirty =
        !git(&["status", "--porcelain", "--untracked-files=no", "--", ".", ":(exclude)tests/results"])
            .is_empty();

    let mut doc = String::new();
    doc.push_str("# Mosaikit — Results of the automated tests\n\n");
    doc.push_str(
        "Generated by `cargo xtask test-report`, which `cargo xtask test`, `cargo xtask ci` and \
         `cargo xtask e2e` run at the end (also when a suite fails). Every phase commits this file \
         updated (docs/ui-plan.md). Do not edit it by hand.\n\n",
    );
    doc.push_str(&format!(
        "- Generated: {}\n- Commit: `{head}`{} on `{branch}`\n- Machine: {}\n\n",
        chrono::Utc::now().format("%Y-%m-%d %H:%M UTC"),
        if dirty { " (with uncommitted changes)" } else { "" },
        machine()
    ));
    if metas.is_empty() {
        doc.push_str("No results yet: run `cargo xtask test` and `cargo xtask e2e`.\n");
    }

    let parsed: Vec<(Meta, Option<Vec<Case>>)> = metas
        .into_iter()
        .map(|m| {
            let c = cases_of(&m);
            (m, c)
        })
        .collect();

    // summary
    if !parsed.is_empty() {
        let mut total = [0usize; 3];
        doc.push_str("## Summary\n\n| Suite | Result | Passed | Failed | Skipped | Duration | Run |\n|---|---|---:|---:|---:|---:|---|\n");
        for (m, cases) in &parsed {
            let count = |s: Status| cases.as_ref().map(|c| c.iter().filter(|x| x.status == s).count());
            let (p, f, k) = (count(Status::Passed), count(Status::Failed), count(Status::Skipped));
            for (i, n) in [p, f, k].iter().enumerate() {
                total[i] += n.unwrap_or(0);
            }
            let shown = |n: Option<usize>| n.map(|n| n.to_string()).unwrap_or_else(|| "—".into());
            let stale =
                if changed_since(&m.commit) { format!(" (commit `{}`)", m.commit) } else { String::new() };
            doc.push_str(&format!(
                "| [{}](#{}) | {} | {} | {} | {} | {} | {}{} |\n",
                m.title,
                m.suite,
                if m.ok { "passed" } else { "**FAILED**" },
                shown(p),
                shown(f),
                shown(k),
                duration(m.duration_s),
                m.finished,
                stale
            ));
        }
        doc.push_str(&format!(
            "| **Total** | | **{}** | **{}** | **{}** | | |\n\n",
            total[0], total[1], total[2]
        ));
        doc.push_str(
            "A suite run on an older version of the code shows its commit in the last column: its \
             results may not match the code above.\n\n",
        );
    }

    // one section per suite
    for (m, cases) in &parsed {
        doc.push_str(&format!("<a id=\"{}\"></a>\n\n## {}\n\n", m.suite, m.title));
        let Some(cases) = cases else {
            doc.push_str(&format!(
                "Exit status only: {}.\n\n",
                if m.ok { "passed" } else { "**failed** (see the output of the command)" }
            ));
            continue;
        };
        if cases.is_empty() {
            doc.push_str(if m.ok {
                "No tests reported.\n\n"
            } else {
                "**The suite failed before running its tests** (see the output of the command).\n\n"
            });
            continue;
        }
        let failed: Vec<&Case> = cases.iter().filter(|c| c.status == Status::Failed).collect();
        if !failed.is_empty() {
            doc.push_str("### Failures\n\n");
            for c in &failed {
                doc.push_str(&format!("- **{}** — {}\n", cell(&c.group), cell(&c.name)));
                if let Some(msg) = &c.message {
                    let lines: Vec<&str> = msg.lines().filter(|l| !l.trim().is_empty()).take(12).collect();
                    if !lines.is_empty() {
                        doc.push_str("\n  ```text\n");
                        for l in lines {
                            let l: String = l.chars().take(200).collect();
                            doc.push_str(&format!("  {l}\n"));
                        }
                        doc.push_str("  ```\n\n");
                    }
                }
            }
            doc.push('\n');
        }
        let mut groups: BTreeMap<&str, Vec<&Case>> = BTreeMap::new();
        for c in cases {
            groups.entry(c.group.as_str()).or_default().push(c);
        }
        for (group, mut list) in groups {
            list.sort_by(|a, b| a.name.cmp(&b.name));
            let passed = list.iter().filter(|c| c.status == Status::Passed).count();
            doc.push_str(&format!(
                "### {} ({passed}/{})\n\n| Test | Result | Duration |\n|---|---|---:|\n",
                if group.is_empty() { "(no group)" } else { group },
                list.len()
            ));
            for c in list {
                doc.push_str(&format!("| {} | {} | {} |\n", cell(&c.name), icon(c.status), ms(c.duration)));
            }
            doc.push('\n');
        }
    }

    doc.push_str(
        "## How to regenerate\n\n\
         ```\ncargo xtask ci     # fmt, clippy, lint, build and every test suite, then this report\n\
         cargo xtask e2e    # the browser tests, then this report\n\
         cargo xtask test-report   # only the report, from the latest results in tests/results/raw\n```\n",
    );
    let path = root().join("tests").join("results").join("test-results.md");
    std::fs::write(&path, doc)?;
    eprintln!("test results: {}", path.display());
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn junit_of_nextest() {
        let x = r#"<?xml version="1.0"?><testsuites><testsuite name="mosaikit-kernel::people" tests="3">
<testcase name="a &amp; b" classname="mosaikit-kernel::people" timestamp="x" time="0.250"></testcase>
<testcase name="bad" classname="mosaikit-kernel::people" time="1.5"><failure message="assertion failed" type="test failure">long text</failure></testcase>
<testcase name="later" classname="k" time="0"><skipped/></testcase>
<testcase name="short" classname="k" time="0.001"/>
</testsuite></testsuites>"#;
        let c = parse_junit(x);
        assert_eq!(c.len(), 4);
        assert_eq!((c[0].name.as_str(), c[0].status, c[0].duration), ("a & b", Status::Passed, Some(250.0)));
        assert_eq!((c[1].status, c[1].message.as_deref()), (Status::Failed, Some("assertion failed")));
        assert_eq!(c[2].status, Status::Skipped);
        assert_eq!((c[3].name.as_str(), c[3].status), ("short", Status::Passed));
    }

    #[test]
    fn libtest_output() {
        let t = "     Running unittests src/lib.rs (target\\debug\\deps\\files-1a2b.exe)\n\
                 running 2 tests\ntest tests::one ... ok\ntest tests::two ... FAILED\n\n\
                 failures:\n\n---- tests::two stdout ----\nthread panicked at x\nleft: 1\n\nfailures:\n    tests::two\n\
                 test result: FAILED. 1 passed; 1 failed\n   Doc-tests files\ntest src\\lib.rs - f (line 3) ... ignored\n";
        let c = parse_libtest(t);
        assert_eq!(c.len(), 3);
        assert_eq!(c[0].group, "files · src/lib.rs");
        assert_eq!(c[1].status, Status::Failed);
        assert!(c[1].message.as_deref().unwrap().contains("panicked"));
        assert_eq!((c[2].group.as_str(), c[2].status), ("files · doc-tests", Status::Skipped));
    }

    #[test]
    fn vitest_and_playwright_json() {
        let v: Value = serde_json::from_str(
            r#"{"testResults":[{"name":"C:/x/mosaikit/ui/host/src/a.test.ts","status":"passed","assertionResults":[
            {"fullName":"a works","status":"passed","duration":3.2,"failureMessages":[]},
            {"fullName":"a breaks","status":"failed","duration":1,"failureMessages":["expected 1"]}]}]}"#,
        )
        .unwrap();
        let c = parse_vitest(&v);
        assert_eq!(c[0].group, "ui/host/src/a.test.ts");
        assert_eq!((c[1].status, c[1].message.as_deref()), (Status::Failed, Some("expected 1")));

        let p: Value = serde_json::from_str(
            r#"{"suites":[{"title":"platform.spec.ts","file":"platform.spec.ts","specs":[],"suites":[
            {"title":"Shell","file":"platform.spec.ts","specs":[{"title":"sign in","tests":[
            {"status":"expected","results":[{"status":"passed","duration":1200}]}]},
            {"title":"flaky one","tests":[{"status":"flaky","results":[{"duration":10},{"duration":20}]}]},
            {"title":"broken","tests":[{"status":"unexpected","results":[{"duration":5,"error":{"message":"timeout"}}]}]}]}]}]}"#,
        )
        .unwrap();
        let c = parse_playwright(&p);
        assert_eq!(c.len(), 3);
        assert_eq!((c[0].name.as_str(), c[0].duration), ("Shell › sign in", Some(1200.0)));
        assert_eq!((c[1].name.as_str(), c[1].status), ("Shell › flaky one (flaky)", Status::Passed));
        assert_eq!((c[2].status, c[2].message.as_deref()), (Status::Failed, Some("timeout")));
    }
}
