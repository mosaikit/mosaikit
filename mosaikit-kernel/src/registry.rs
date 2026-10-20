//! Registry plugin persistente su filesystem: data_dir/plugins/<id>/plugin.json + plugin.wasm.
//! Pattern GeoLibre: manifest accanto al bundle, nessuna esecuzione in fase di indexing.

use std::fs;
use std::path::{Path, PathBuf};
use crate::json::Json;
use crate::manifest::Manifest;

pub struct Registry {
    pub data_dir: PathBuf,
}

impl Registry {
    pub fn new(data_dir: impl AsRef<Path>) -> Self {
        Registry { data_dir: data_dir.as_ref().to_path_buf() }
    }

    fn plugins_dir(&self) -> PathBuf { self.data_dir.join("plugins") }

    fn dir_for(&self, id: &str) -> PathBuf {
        let safe: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' }).collect();
        self.plugins_dir().join(safe)
    }

    pub fn install(&self, manifest: &Manifest, wasm: &[u8], ui: &[u8]) -> Result<(), String> {
        let dir = self.dir_for(&manifest.id);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join("plugin.json"), manifest.to_json().to_string()).map_err(|e| e.to_string())?;
        fs::write(dir.join("plugin.wasm"), wasm).map_err(|e| e.to_string())?;
        if !ui.is_empty() {
            fs::write(dir.join("ui.js"), ui).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn has_ui(&self, id: &str) -> bool {
        self.dir_for(id).join("ui.js").exists()
    }

    pub fn read_ui(&self, id: &str) -> Result<Vec<u8>, String> {
        fs::read(self.dir_for(id).join("ui.js")).map_err(|e| e.to_string())
    }

    pub fn uninstall(&self, id: &str) -> Result<(), String> {
        let dir = self.dir_for(id);
        if !dir.exists() { return Err(format!("plugin non installato: {id}")); }
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())
    }

    pub fn load_wasm(&self, id: &str) -> Result<Vec<u8>, String> {
        fs::read(self.dir_for(id).join("plugin.wasm")).map_err(|e| e.to_string())
    }

    pub fn load_manifest(&self, id: &str) -> Result<Manifest, String> {
        let s = fs::read_to_string(self.dir_for(id).join("plugin.json")).map_err(|e| e.to_string())?;
        Manifest::from_json(&Json::parse(&s)?)
    }

    pub fn list(&self) -> Vec<Manifest> {
        let mut out = Vec::new();
        if let Ok(entries) = fs::read_dir(self.plugins_dir()) {
            for e in entries.flatten() {
                let p = e.path().join("plugin.json");
                if let Ok(s) = fs::read_to_string(p) {
                    if let Ok(j) = Json::parse(&s) {
                        if let Ok(m) = Manifest::from_json(&j) { out.push(m); }
                    }
                }
            }
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }
}
