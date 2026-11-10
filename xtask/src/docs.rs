//! `cargo xtask docs`: the PDF manuals and the PowerPoint presentation (tools/docs, a Node script), made from the
//! Markdown of docs/ and from docs/presentation/deck.json. `--check` only verifies the sources and the translations.

use std::path::Path;
use std::process::Command;

use anyhow::Result;

use crate::util::{npm, root, run};

pub fn make(out: Option<&Path>, check: bool, lang: Option<&str>) -> Result<()> {
    let dir = root().join("tools").join("docs");
    if !dir.join("node_modules").is_dir() {
        run(npm().current_dir(&dir).args(["ci", "--no-audit", "--no-fund"]))?;
    }
    let mut cmd = Command::new("node");
    cmd.current_dir(&dir).arg("build.mjs").arg(if check { "check" } else { "all" });
    if let Some(o) = out {
        cmd.arg("--out").arg(o);
    }
    if let Some(l) = lang {
        cmd.args(["--lang", l]);
    }
    run(&mut cmd)
}
