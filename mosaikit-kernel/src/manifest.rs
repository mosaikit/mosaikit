//! Manifest del plugin (analogo a plugin.json di GeoLibre): id, versione,
//! permessi e "contribution" — l'unica cosa che il kernel deve capire:
//! un bottone (icona+label) e una risorsa CRUD generica.

use crate::json::Json;
use crate::model::{Contribution, Field, FieldKind, ResourceDescriptor};

#[derive(Debug, Clone)]
pub struct Manifest {
    pub ui: bool,
    pub id: String,
    pub name: String,
    pub version: String,
    pub min_kernel: String,
    pub permissions: Vec<String>,
    pub contribution: Contribution,
}

pub const KERNEL_VERSION: &str = "0.1.0";

impl Manifest {
    pub fn from_json(j: &Json) -> Result<Self, String> {
        let ui = j.get("ui").and_then(Json::as_bool).unwrap_or(false);
        let id = j.get("id").and_then(Json::as_str).ok_or("manifest: manca id")?.to_string();
        if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') {
            return Err("manifest: id con caratteri non validi".into());
        }
        let name = j.get("name").and_then(Json::as_str).unwrap_or(&id).to_string();
        let version = j.get("version").and_then(Json::as_str).ok_or("manifest: manca version")?.to_string();
        let min_kernel = j.get("min_kernel").and_then(Json::as_str).unwrap_or("0.1.0").to_string();
        check_min_kernel(&min_kernel)?;

        let permissions = j.get("permissions")
            .and_then(Json::as_arr)
            .map(|a| a.iter().filter_map(Json::as_str).map(str::to_string).collect())
            .unwrap_or_default();

        let contribution = Contribution::from_json(j.get("contribution").ok_or("manifest: manca contribution")?)?;
        Ok(Manifest { ui, id, name, version, min_kernel, permissions, contribution })
    }

    pub fn to_json(&self) -> Json {
        Json::Obj(vec![
            ("ui".into(), Json::Bool(self.ui)),
            ("id".into(), Json::Str(self.id.clone())),
            ("name".into(), Json::Str(self.name.clone())),
            ("version".into(), Json::Str(self.version.clone())),
            ("min_kernel".into(), Json::Str(self.min_kernel.clone())),
            ("permissions".into(), Json::Arr(self.permissions.iter().map(|p| Json::Str(p.clone())).collect())),
            ("contribution".into(), self.contribution.to_json()),
        ])
    }
}

fn check_min_kernel(min: &str) -> Result<(), String> {
    fn parse(v: &str) -> Option<(u64, u64, u64)> {
        let mut it = v.split('.');
        Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?))
    }
    let (a, b, c) = parse(KERNEL_VERSION).unwrap();
    let (x, y, z) = parse(min).ok_or_else(|| format!("min_kernel non valido: {min}"))?;
    if (x, y, z) > (a, b, c) {
        return Err(format!("plugin richiede kernel >= {min}, kernel attuale {KERNEL_VERSION}"));
    }
    Ok(())
}

/// Parsing condiviso di ResourceDescriptor (usato anche dal runtime WASM).
pub fn resource_from_json(j: &Json) -> Result<ResourceDescriptor, String> {
    let name = j.get("name").and_then(Json::as_str).ok_or("resource: manca name")?.to_string();
    let mut fields = Vec::new();
    for fj in j.get("fields").and_then(Json::as_arr).ok_or("resource: manca fields")? {
        let key = fj.get("key").and_then(Json::as_str).ok_or("field: manca key")?.to_string();
        let label = fj.get("label").and_then(Json::as_str).unwrap_or(&key).to_string();
        let kind = match fj.get("kind").and_then(Json::as_str).unwrap_or("text") {
            "text" => FieldKind::Text,
            "number" => FieldKind::Number,
            "bool" => FieldKind::Bool,
            "date" => FieldKind::Date,
            "choice" => FieldKind::Choice,
            other => return Err(format!("field {key}: kind sconosciuto '{other}'")),
        };
        let required = fj.get("required").and_then(Json::as_bool).unwrap_or(false);
        let multiline = fj.get("multiline").and_then(Json::as_bool).unwrap_or(false);
        let options = fj.get("options").and_then(Json::as_arr)
            .map(|a| a.iter().filter_map(Json::as_str).map(str::to_string).collect())
            .unwrap_or_default();
        fields.push(Field { key, label, kind, required, multiline, options });
    }
    Ok(ResourceDescriptor { name, fields })
}

impl Contribution {
    pub fn from_json(j: &Json) -> Result<Self, String> {
        let icon = j.get("icon").and_then(Json::as_str).ok_or("contribution: manca icon")?.to_string();
        let label = j.get("label").and_then(Json::as_str).unwrap_or("Plugin").to_string();
        let resource = resource_from_json(j.get("resource").ok_or("contribution: manca resource")?)?;
        let kind = j.get("kind").and_then(Json::as_str).unwrap_or("").to_string();
        Ok(Contribution { icon, label, resource, kind })
    }
    pub fn to_json(&self) -> Json {
        Json::Obj(vec![
            ("icon".into(), Json::Str(self.icon.clone())),
            ("label".into(), Json::Str(self.label.clone())),
            ("kind".into(), Json::Str(self.kind.clone())),
            ("resource".into(), Json::Obj(vec![
                ("name".into(), Json::Str(self.resource.name.clone())),
                ("fields".into(), Json::Arr(self.resource.fields.iter().map(|f| Json::Obj(vec![
                    ("key".into(), Json::Str(f.key.clone())),
                    ("label".into(), Json::Str(f.label.clone())),
                    ("kind".into(), Json::Str(match f.kind {
                        FieldKind::Text => "text", FieldKind::Number => "number",
                        FieldKind::Bool => "bool", FieldKind::Date => "date", FieldKind::Choice => "choice",
                    }.into())),
                    ("required".into(), Json::Bool(f.required)),
                    ("multiline".into(), Json::Bool(f.multiline)),
                    ("options".into(), Json::Arr(f.options.iter().map(|o| Json::Str(o.clone())).collect())),
                ])).collect())),
            ])),
        ])
    }
}
