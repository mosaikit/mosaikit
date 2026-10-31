//! A plugin folder: manifest, WASM crate, UI, and the Cargo / npm workspaces it belongs to.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};

use crate::toolchain;
use crate::util::{npm, run};

#[derive(Debug, Clone)]
pub struct Plugin {
    pub dir: PathBuf,
    pub id: String,
    pub version: String,
    /// name of the crate, if the plugin has WASM logic
    pub crate_name: Option<String>,
    pub has_ui: bool,
    /// Cargo workspace that contains the crate (the plugin folder itself, or an ancestor with `[workspace]`)
    pub cargo_root: Option<PathBuf>,
    /// npm workspace that contains the UI (ancestor folder with `workspaces`); none: the `ui` folder itself
    pub npm_root: Option<PathBuf>,
}

fn ancestor_with(dir: &Path, file: &str, marker: &str) -> Option<PathBuf> {
    dir.ancestors()
        .skip(1)
        .find(|a| std::fs::read_to_string(a.join(file)).is_ok_and(|t| t.contains(marker)))
        .map(Path::to_path_buf)
}

impl Plugin {
    /// Reads the plugin of a folder (it must contain `plugin.toml`).
    pub fn load(dir: &Path) -> Result<Plugin> {
        let dir = std::path::absolute(dir).unwrap_or_else(|_| dir.to_path_buf());
        let manifest_path = dir.join("plugin.toml");
        if !manifest_path.is_file() {
            bail!("{} has no plugin.toml: it is not a plugin folder", dir.display());
        }
        let manifest = mosaikit_mskp::Manifest::from_toml(&std::fs::read_to_string(&manifest_path)?)
            .with_context(|| manifest_path.display().to_string())?;
        let crate_name = if dir.join("Cargo.toml").is_file() {
            let v: toml::Value = toml::from_str(&std::fs::read_to_string(dir.join("Cargo.toml"))?)?;
            v.get("package").and_then(|p| p.get("name")).and_then(|n| n.as_str()).map(str::to_string)
        } else {
            None
        };
        let has_ui = dir.join("ui").join("package.json").is_file();
        let own_workspace =
            std::fs::read_to_string(dir.join("Cargo.toml")).is_ok_and(|t| t.contains("[workspace]"));
        Ok(Plugin {
            cargo_root: crate_name.as_ref().map(|_| {
                if own_workspace {
                    dir.clone()
                } else {
                    ancestor_with(&dir, "Cargo.toml", "[workspace]").unwrap_or_else(|| dir.clone())
                }
            }),
            npm_root: if has_ui {
                ancestor_with(&dir.join("ui"), "package.json", "\"workspaces\"")
            } else {
                None
            },
            has_ui,
            id: manifest.id,
            version: manifest.version,
            crate_name,
            dir,
        })
    }
}

/// Distinct Cargo workspaces of the plugins.
pub fn cargo_roots(plugins: &[Plugin]) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = plugins.iter().filter_map(|p| p.cargo_root.clone()).collect();
    v.sort();
    v.dedup();
    v
}

/// Distinct npm roots of the UIs of the plugins.
pub fn npm_roots(plugins: &[Plugin]) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = plugins.iter().filter(|p| p.has_ui).map(|p| ui_workspace(p).0).collect();
    v.sort();
    v.dedup();
    v
}

pub fn wasm_path(p: &Plugin, release: bool) -> Option<PathBuf> {
    let name = p.crate_name.as_ref()?.replace('-', "_");
    let ws = p.cargo_root.clone().unwrap_or_else(|| p.dir.clone());
    Some(
        ws.join("target")
            .join("wasm32-unknown-unknown")
            .join(if release { "release" } else { "debug" })
            .join(format!("{name}.wasm")),
    )
}

/// Builds the WASM logic, one `cargo build` per plugin workspace. Installs the `wasm32` target if missing.
pub fn build_wasm(plugins: &[Plugin], release: bool) -> Result<()> {
    let mut by_ws: BTreeMap<PathBuf, Vec<&String>> = BTreeMap::new();
    for p in plugins {
        if let (Some(c), Some(ws)) = (&p.crate_name, &p.cargo_root) {
            by_ws.entry(ws.clone()).or_default().push(c);
        }
    }
    if by_ws.is_empty() {
        return Ok(());
    }
    toolchain::ensure_wasm_target()?;
    for (ws, crates) in by_ws {
        let mut cmd = Command::new("cargo");
        // the target of the plugin workspace is its own, whatever the caller exports
        cmd.current_dir(&ws).env_remove("CARGO_TARGET_DIR").args([
            "build",
            "--target",
            "wasm32-unknown-unknown",
        ]);
        if release {
            cmd.arg("--release");
        }
        for c in crates {
            cmd.args(["-p", c]);
        }
        run(&mut cmd)?;
    }
    Ok(())
}

/// `npm install` in the given root if node_modules is missing.
pub fn ensure_npm_in(dir: &Path) -> Result<()> {
    if !dir.join("node_modules").is_dir() {
        run(npm().current_dir(dir).args(["install", "--no-audit", "--no-fund"]))?;
    }
    Ok(())
}

/// (npm root, workspace name) of the UI of a plugin.
pub fn ui_workspace(p: &Plugin) -> (PathBuf, String) {
    let npm_root = p.npm_root.clone().unwrap_or_else(|| p.dir.join("ui"));
    let ws = p
        .dir
        .join("ui")
        .strip_prefix(&npm_root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    (npm_root, ws)
}

/// npm command for the UI of a plugin (`npm run <script> -w <ui>` in its npm root).
pub fn npm_ui(p: &Plugin, script: &str) -> Command {
    let (dir, ws) = ui_workspace(p);
    let mut c = npm();
    c.current_dir(&dir).args(["run", script]);
    if !ws.is_empty() {
        c.args(["-w", &ws]);
    }
    c
}

pub fn build_ui(plugins: &[Plugin]) -> Result<()> {
    for p in plugins.iter().filter(|p| p.has_ui) {
        ensure_npm_in(&ui_workspace(p).0)?;
        run(&mut npm_ui(p, "build"))?;
    }
    Ok(())
}

/// Does the `package.json` of the UI define this npm script?
pub fn ui_has_script(p: &Plugin, script: &str) -> bool {
    std::fs::read_to_string(p.dir.join("ui").join("package.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .is_some_and(|v| v.get("scripts").and_then(|s| s.get(script)).is_some())
}
