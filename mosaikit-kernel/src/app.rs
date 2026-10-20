//! MosaikitApp: composizione kernel. Domain-agnostic: sa solo di plugin che
//! dichiarano contribution (icona + risorsa CRUD).

use std::collections::BTreeMap;
use crate::auth::{Action, Auth, AuthError};
use crate::crud::ResourceStore;
use crate::engine::{Hook, PluginArtifact, PluginEngine};
use crate::manifest::Manifest;
use crate::model::{ContentArea, Contribution, CrudView, IconButton, Row};
use crate::package;
use crate::registry::Registry;

pub struct MosaikitApp<E: PluginEngine> {
    pub auth: Auth,
    pub registry: Registry,
    pub engine: E,
    pub icon_bar: Vec<IconButton>,
    pub content: ContentArea,
    pub stores: std::collections::HashMap<String, ResourceStore>,
    active: Vec<String>, // plugin id attivi, in ordine di attivazione
}

impl<E: PluginEngine> MosaikitApp<E> {
    pub fn new(auth: Auth, registry: Registry, engine: E) -> Self {
        MosaikitApp {
            auth, registry, engine,
            icon_bar: Vec::new(),
            content: ContentArea::Empty { message: "Seleziona un'icona dalla IconBar".into() },
            stores: std::collections::HashMap::new(),
            active: Vec::new(),
        }
    }

    // ---- autenticazione -------------------------------------------------

    pub fn login(&mut self, u: &str, p: &str) -> Result<String, AuthError> {
        Ok(self.auth.login(u, p)?.token)
    }
    pub fn logout(&mut self, token: &str) {
        self.auth.logout(token);
        self.content = ContentArea::Empty { message: "Seleziona un'icona dalla IconBar".into() };
    }
    pub fn username(&self, token: &str) -> Option<String> {
        self.auth.session_public(token).map(|s| s.username.clone())
    }

    // ---- installazione (Admin) ------------------------------------------

    pub fn install_plugin(&mut self, token: &str, bytes: &[u8]) -> Result<Manifest, String> {
        self.auth.require(token, Action::InstallPlugin).map_err(|e| e.to_string())?;
        let pkg = package::parse(bytes)?;
        self.engine.inspect(&pkg.wasm).map_err(|e| format!("ABI non valida: {e}"))?;
        self.registry.install(&pkg.manifest, &pkg.wasm, &pkg.ui)?;
        Ok(pkg.manifest)
    }

    pub fn uninstall_plugin(&mut self, token: &str, id: &str) -> Result<(), String> {
        self.auth.require(token, Action::UninstallPlugin).map_err(|e| e.to_string())?;
        if self.is_active(id) { self.deactivate_plugin(token, id)?; }
        self.registry.uninstall(id)
    }

    // ---- attivazione / disattivazione ------------------------------------

    pub fn is_active(&self, id: &str) -> bool { self.active.iter().any(|a| a == id) }
    pub fn active_plugins(&self) -> &[String] { &self.active }

    pub fn activate_plugin(&mut self, token: &str, id: &str) -> Result<(), String> {
        self.auth.require(token, Action::ActivatePlugin).map_err(|e| e.to_string())?;
        if self.is_active(id) { return Err("plugin gia' attivo".into()); }
        let manifest = self.registry.load_manifest(id)?;
        let wasm = self.registry.load_wasm(id)?;
        let exports = self.engine.inspect(&wasm)?;
        let artifact = PluginArtifact { manifest, wasm, exports };
        let contribution: Contribution = self.engine.contribute(&artifact)?;
        self.engine.activate(id)?;
        let view_id = contribution.resource.name.clone();
        let data_dir = self.registry.data_dir.clone();
        self.stores.entry(view_id.clone())
            .or_insert_with(|| ResourceStore::with_backend(
                contribution.resource.clone(),
                crate::store::open_default(&data_dir, &view_id),
            ));
        self.icon_bar.push(IconButton {
            plugin_id: artifact.manifest.id.clone(),
            icon: contribution.icon.clone(),
            label: contribution.label.clone(),
            view_id,
        });
        self.active.push(artifact.manifest.id.clone());
        Ok(())
    }

    pub fn deactivate_plugin(&mut self, token: &str, id: &str) -> Result<(), String> {
        self.auth.require(token, Action::DeactivatePlugin).map_err(|e| e.to_string())?;
        if !self.is_active(id) { return Err("plugin non attivo".into()); }
        self.engine.deactivate(id)?;
        self.icon_bar.retain(|b| b.plugin_id != id);
        self.active.retain(|a| a != id);
        if let ContentArea::Crud(v) = &self.content {
            if !self.icon_bar.iter().any(|b| b.view_id == v.resource.name) {
                self.content = ContentArea::Empty { message: "Plugin disattivato".into() };
            }
        }
        Ok(())
    }

    // ---- content area -----------------------------------------------------

    pub fn open_view(&mut self, token: &str, view_id: &str) -> Result<(), String> {
        self.auth.require(token, Action::CrudRead).map_err(|e| e.to_string())?;
        let plugin_id = self.icon_bar.iter().find(|b| b.view_id == view_id)
            .map(|b| b.plugin_id.clone())
            .ok_or_else(|| format!("vista non disponibile: {view_id}"))?;
        let manifest = self.registry.load_manifest(&plugin_id)?;
        let mut view = CrudView::new(manifest.contribution.resource.clone());
        view.rows = self.stores[view_id].list("");
        self.content = ContentArea::Crud(view);
        Ok(())
    }

    fn with_crud_view<T>(&mut self, f: impl FnOnce(&mut CrudView) -> Result<T, String>) -> Result<T, String> {
        match &mut self.content {
            ContentArea::Crud(v) => f(v),
            _ => Err("nessuna vista CRUD attiva".into()),
        }
    }

    pub fn set_filter(&mut self, filter: String) -> Result<(), String> {
        let view_id = self.current_view_id()?;
        self.with_crud_view(|v| { v.filter = filter; Ok(()) })?;
        self.refresh_rows(&view_id)
    }

    fn current_view_id(&self) -> Result<String, String> {
        match &self.content {
            ContentArea::Crud(v) => Ok(v.resource.name.clone()),
            _ => Err("nessuna vista CRUD attiva".into()),
        }
    }

    fn refresh_rows(&mut self, view_id: &str) -> Result<(), String> {
        let filter = self.with_crud_view(|v: &mut CrudView| Ok(v.filter.clone()))?;
        let rows = self.stores[view_id].list(&filter);
        self.with_crud_view(|v| { v.rows = rows; Ok(()) })
    }

    // ---- CRUD (con hook verso il plugin, se attivo) ------------------------

    pub fn crud_create(&mut self, token: &str, raw: &BTreeMap<String, String>) -> Result<Row, String> {
        self.auth.require(token, Action::CrudWrite).map_err(|e| e.to_string())?;
        let view_id = self.current_view_id()?;
        let plugin_id = self.icon_bar.iter().find(|b| b.view_id == view_id).map(|b| b.plugin_id.clone());
        let mut row = self.stores.get_mut(&view_id).ok_or("store mancante")?.create(raw)?;
        if let Some(pid) = plugin_id {
            if let Ok(modified) = self.engine.hook(&pid, Hook::OnCreate, row.to_json()) {
                if let Some(m) = Row::from_json(&modified) { row = m; }
            }
        }
        self.refresh_rows(&view_id)?;
        self.with_crud_view(|v| { v.status = format!("Creato #{}", row.id); Ok(()) })?;
        Ok(row)
    }

    pub fn crud_update(&mut self, token: &str, id: u64, raw: &BTreeMap<String, String>) -> Result<Row, String> {
        self.auth.require(token, Action::CrudWrite).map_err(|e| e.to_string())?;
        let view_id = self.current_view_id()?;
        let plugin_id = self.icon_bar.iter().find(|b| b.view_id == view_id).map(|b| b.plugin_id.clone());
        let mut row = self.stores.get_mut(&view_id).ok_or("store mancante")?.update(id, raw)?;
        if let Some(pid) = plugin_id {
            if let Ok(modified) = self.engine.hook(&pid, Hook::OnUpdate, row.to_json()) {
                if let Some(m) = Row::from_json(&modified) { row = m; }
            }
        }
        self.refresh_rows(&view_id)?;
        Ok(row)
    }

    pub fn crud_delete(&mut self, token: &str, id: u64) -> Result<(), String> {
        self.auth.require(token, Action::CrudWrite).map_err(|e| e.to_string())?;
        let view_id = self.current_view_id()?;
        let plugin_id = self.icon_bar.iter().find(|b| b.view_id == view_id).map(|b| b.plugin_id.clone());
        let row = self.stores.get_mut(&view_id).ok_or("store mancante")?.delete(id)?;
        if let Some(pid) = plugin_id {
            let _ = self.engine.hook(&pid, Hook::OnDelete, row.to_json());
        }
        self.refresh_rows(&view_id)?;
        self.with_crud_view(|v| { v.status = format!("Eliminato #{id}"); Ok(()) })
    }

    pub fn crud_select(&mut self, id: u64) -> Result<(), String> {
        self.with_crud_view(|v| { v.select(id); Ok(()) })
    }

    pub fn crud_new(&mut self) -> Result<(), String> {
        self.with_crud_view(|v| { v.clear_draft(); Ok(()) })
    }

    /// Invia un comando generico a un plugin attivo (export opzionale msk_action).
    pub fn plugin_action(&mut self, token: &str, plugin_id: &str, req_json: &str) -> Result<crate::json::Json, String> {
        self.auth.require(token, Action::CrudRead).map_err(|e| e.to_string())?;
        if !self.is_active(plugin_id) { return Err(format!("plugin non attivo: {plugin_id}")); }
        let req = crate::json::Json::parse(req_json)?;
        self.engine.action(plugin_id, req)
    }

    pub fn crud_set_draft(&mut self, key: &str, value: String) -> Result<(), String> {
        self.with_crud_view(|v| { v.draft.insert(key.to_string(), value); Ok(()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::HeadlessEngine;
    use crate::validate::minimal_guest_module;
    use crate::package;

    const NOTES_JSON: &str = r#"{"id":"com.mosaikit.notes","name":"Note","version":"0.1.0","min_kernel":"0.1.0","permissions":["crud.hooks"],"contribution":{"icon":"📝","label":"Note","resource":{"name":"notes","fields":[{"key":"title","label":"Titolo","kind":"text","required":true,"multiline":false,"options":[]}]}}}"#;

    fn mkapp(dir: &str) -> (MosaikitApp<HeadlessEngine>, String) {
        let mut app = MosaikitApp::new(Auth::seeded(), Registry::new(dir), HeadlessEngine);
        let tok = app.login("admin", "mosaikit2026!").unwrap();
        (app, tok)
    }

    #[test]
    fn flusso_completo() {
        let dir = std::env::temp_dir().join("msk-test-flusso");
        let _ = std::fs::remove_dir_all(&dir);
        let (mut app, tok) = mkapp(dir.to_str().unwrap());

        // install (richiede Admin)
        let pkg = package::pack(NOTES_JSON, &minimal_guest_module());
        let m = app.install_plugin(&tok, &pkg).unwrap();
        assert_eq!(m.id, "com.mosaikit.notes");

        // User non-Admin NON puo' installare
        let utok = app.login("user", "demo1234").unwrap();
        assert!(app.install_plugin(&utok, &pkg).is_err());

        // activate -> icona su IconBar
        app.activate_plugin(&tok, "com.mosaikit.notes").unwrap();
        assert_eq!(app.icon_bar.len(), 1);
        assert_eq!(app.icon_bar[0].icon, "\u{1f4dd}");

        // open view + CRUD
        app.open_view(&tok, "notes").unwrap();
        let mut draft = std::collections::BTreeMap::new();
        draft.insert("title".to_string(), "Prima nota".to_string());
        let row = app.crud_create(&tok, &draft).unwrap();
        assert_eq!(row.id, 1);

        let mut draft2 = std::collections::BTreeMap::new();
        draft2.insert("title".to_string(), "Modificata".to_string());
        app.crud_update(&tok, 1, &draft2).unwrap();

        // required field enforcement
        let mut bad = std::collections::BTreeMap::new();
        bad.insert("title".to_string(), "   ".to_string());
        assert!(app.crud_create(&tok, &bad).is_err());

        app.crud_delete(&tok, 1).unwrap();

        // deactivate -> icona rimossa
        app.deactivate_plugin(&tok, "com.mosaikit.notes").unwrap();
        assert!(app.icon_bar.is_empty());
    }

    #[test]
    fn guest_senza_export_richiesti_non_si_installa() {
        let dir = std::env::temp_dir().join("msk-test-badwasm");
        let _ = std::fs::remove_dir_all(&dir);
        let (mut app, tok) = mkapp(dir.to_str().unwrap());
        let bad_wasm = vec![0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]; // solo header, nessun export
        let pkg = package::pack(NOTES_JSON, &bad_wasm);
        assert!(app.install_plugin(&tok, &pkg).is_err());
    }
}
