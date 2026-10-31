//! `mosaikit-plugin`: the tool of the developers of Mosaikit plugins.
//!
//! Everything that `cargo xtask plugin` does for the repository (scaffold, build, pack, keys) lives here, with
//! `validate`, `sign`, `install`, `test` and `doctor` added. Nothing in this crate knows the layout of the
//! `mosaikit` repository: a plugin is a folder with a `plugin.toml`, wherever it is. `xtask` calls these
//! functions for the plugins of a distribution.

pub mod install;
pub mod package;
pub mod project;
pub mod scaffold;
pub mod toolchain;
pub mod util;
pub mod validate;

use std::process::Command;

use anyhow::{bail, Result};

pub use project::Plugin;

/// `test`: validates the plugin, runs the tests of its logic (native, with the SDK's mock host) and the
/// type check, lint and unit tests of its UI.
pub fn test(p: &Plugin) -> Result<()> {
    let report = validate::validate(&p.dir)?;
    report.print();
    if !report.ok() {
        bail!("{}: the plugin does not validate", p.id);
    }
    if let (Some(c), Some(ws)) = (&p.crate_name, &p.cargo_root) {
        util::run(
            Command::new("cargo").current_dir(ws).env_remove("CARGO_TARGET_DIR").args(["test", "-p", c]),
        )?;
    }
    if p.has_ui {
        // the type check, the lint (a standalone UI has its own) and the unit tests of the UI, where it defines them
        for script in ["typecheck", "lint", "test"] {
            if project::ui_has_script(p, script) {
                project::ensure_npm_in(&project::ui_workspace(p).0)?;
                util::run(&mut project::npm_ui(p, script))?;
            }
        }
    }
    Ok(())
}
