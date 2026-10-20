//! PluginEngine: il confine tra kernel e runtime dei plugin.
//! - HeadlessEngine (std-only): per test e demo CLI; contribuisce dal manifest,
//!   hook pass-through. I plugin WASM reali richiedono mosaikit-runtime.
//! - WasmtimeEngine (crate mosaikit-runtime): istanziazione sandboxata.

use crate::json::Json;
use crate::manifest::Manifest;
use crate::model::Contribution;
use crate::validate;

pub enum Hook { OnCreate, OnUpdate, OnDelete }

pub struct PluginArtifact {
    pub manifest: Manifest,
    pub wasm: Vec<u8>,
    pub exports: Vec<String>,
}

pub trait PluginEngine {
    /// Verifica l'ABI del WASM (export richiesti) senza eseguirlo.
    fn inspect(&mut self, wasm: &[u8]) -> Result<Vec<String>, String> {
        validate::validate_guest(wasm)
    }
    /// Ottiene la contribution: cosa il plugin aggiunge a iconbar/content.
    fn contribute(&mut self, artifact: &PluginArtifact) -> Result<Contribution, String>;
    fn activate(&mut self, plugin_id: &str) -> Result<(), String>;
    fn deactivate(&mut self, plugin_id: &str) -> Result<(), String>;
    /// Chiama un hook del guest su un record; il guest puo' modificare il record
    /// restituendo un nuovo JSON, oppure 0 per pass-through.
    fn hook(&mut self, plugin_id: &str, hook: Hook, record: Json) -> Result<Json, String>;

    /// Azione generica verso il plugin (export opzionale `msk_action`).
    /// Il kernel NON ne interpreta il payload: resta domain-agnostic.
    /// Default: l'engine headless non esegue WASM, quindi rifiuta.
    fn action(&mut self, _plugin_id: &str, _req: Json) -> Result<Json, String> {
        Err("engine senza runtime WASM: azione non eseguita (usare ziputil host o attivare il runtime)".into())
    }
}

/// Engine std-only: non esegue WASM, usa il manifest come contribution.
pub struct HeadlessEngine;

impl PluginEngine for HeadlessEngine {
    fn contribute(&mut self, artifact: &PluginArtifact) -> Result<Contribution, String> {
        Ok(artifact.manifest.contribution.clone())
    }
    fn activate(&mut self, _id: &str) -> Result<(), String> { Ok(()) }
    fn deactivate(&mut self, _id: &str) -> Result<(), String> { Ok(()) }
    fn hook(&mut self, _id: &str, _h: Hook, record: Json) -> Result<Json, String> { Ok(record) }
}
