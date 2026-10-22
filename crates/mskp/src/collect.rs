//! Collection of the files of a plugin from its source folder.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::package::WASM_FILE;
use crate::{Error, Result};

fn read(p: &Path) -> Result<Vec<u8>> {
    std::fs::read(p).map_err(|e| Error::Package(format!("{}: {e}", p.display())))
}

fn walk(base: &Path, dir: &Path, prefix: &str, out: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
    let rd = std::fs::read_dir(dir).map_err(|e| Error::Package(format!("{}: {e}", dir.display())))?;
    let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            walk(base, &p, prefix, out)?;
        } else {
            let rel = p
                .strip_prefix(base)
                .map_err(|e| Error::Package(e.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            out.insert(format!("{prefix}{rel}"), read(&p)?);
        }
    }
    Ok(())
}

/// Files of a plugin ready for [`crate::pack`]:
/// `plugin.toml`, `migrations/*.sql`, `ui/dist/**` (as `ui/**`) and, if given, the WASM.
pub fn collect_plugin_dir(dir: &Path, wasm: Option<&Path>) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), read(&dir.join("plugin.toml"))?);
    let migrations = dir.join("migrations");
    if migrations.is_dir() {
        walk(&migrations, &migrations, "migrations/", &mut files)?;
    }
    let ui = dir.join("ui").join("dist");
    if ui.is_dir() {
        walk(&ui, &ui, "ui/", &mut files)?;
    }
    if let Some(w) = wasm {
        files.insert(WASM_FILE.to_string(), read(w)?);
    }
    Ok(files)
}
