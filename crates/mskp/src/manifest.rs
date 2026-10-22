//! Manifest v3 (`plugin.toml`).

use serde::{Deserialize, Serialize};

use crate::{is_identifier, is_safe_path, Error, Result, Version};

/// Version of the WASM ABI supported by the kernel.
pub const ABI_VERSION: u32 = 1;

/// Columns the host adds to every table of a plugin.
const RESERVED_FIELDS: &[&str] = &["resource_id", "tenant_id", "id", "owner", "my_level"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default = "default_abi")]
    pub abi: u32,
    #[serde(default = "default_min_kernel")]
    pub min_kernel: String,
    #[serde(default)]
    pub description: String,
    pub contribution: Contribution,
    #[serde(default)]
    pub resources: Vec<ResourceDecl>,
    #[serde(default)]
    pub ui: Option<UiDecl>,
    #[serde(default)]
    pub permissions: Permissions,
    #[serde(default)]
    pub kpi: Vec<KpiDecl>,
    #[serde(default)]
    pub requires: Requires,
}

/// Requirements of the plugin towards the installation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct Requires {
    /// "postgres" if the plugin uses PostgreSQL functions (e.g. PostGIS); empty = any
    #[serde(default)]
    pub database: Option<String>,
    /// PostgreSQL extensions that must be installed in the database (e.g. postgis)
    #[serde(default)]
    pub extensions: Vec<String>,
}

fn default_abi() -> u32 {
    ABI_VERSION
}
fn default_min_kernel() -> String {
    "1.0.0".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Contribution {
    pub icon: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ResourceDecl {
    pub name: String,
    #[serde(default)]
    pub label: String,
    /// Field used as the title of the resource (default: the first text field).
    #[serde(default)]
    pub title_field: Option<String>,
    pub fields: Vec<FieldDecl>,
}

impl ResourceDecl {
    pub fn title_key(&self) -> Option<&str> {
        self.title_field
            .as_deref()
            .or_else(|| self.fields.iter().find(|f| f.kind == FieldKind::Text).map(|f| f.key.as_str()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FieldDecl {
    pub key: String,
    #[serde(default)]
    pub label: String,
    pub kind: FieldKind,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub multiline: bool,
    #[serde(default)]
    pub options: Vec<String>,
    /// Computed field (e.g. by a hook): not shown in forms.
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FieldKind {
    Text,
    Number,
    Bool,
    Date,
    Choice,
}

impl FieldKind {
    pub fn sql_type(self) -> &'static str {
        match self {
            FieldKind::Text | FieldKind::Choice => "text",
            FieldKind::Number => "double precision",
            FieldKind::Bool => "boolean",
            FieldKind::Date => "date",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct UiDecl {
    /// Page of the UI, relative to `ui/` (default `index.html`).
    #[serde(default = "default_entry")]
    pub entry: String,
    /// Viewer for the public links, relative to `ui/`.
    #[serde(default)]
    pub public_view: Option<String>,
}

fn default_entry() -> String {
    "index.html".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct Permissions {
    /// Resources on which the plugin receives the WASM hooks.
    #[serde(default)]
    pub hooks: Vec<String>,
    /// File and folder API with content on disk.
    #[serde(default)]
    pub files: bool,
    /// Folder content uploaded from a zip (e.g. static sites).
    #[serde(default)]
    pub content: bool,
    /// Origins reachable by `http.fetch` and by the UI (`connect-src`).
    #[serde(default)]
    pub network: Vec<String>,
    /// Origins the UI may embed in an iframe.
    #[serde(default)]
    pub frame_src: Vec<String>,
    /// Plugins whose commands the logic may call (`plugin.call`), with the current
    /// user: the called plugin applies its own rules.
    #[serde(default)]
    pub calls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct KpiDecl {
    pub view: String,
    pub label: String,
}

impl Manifest {
    pub fn from_toml(s: &str) -> Result<Manifest> {
        let m: Manifest = toml::from_str(s).map_err(|e| Error::Manifest(e.to_string()))?;
        m.validate()?;
        Ok(m)
    }

    pub fn version(&self) -> Version {
        Version::parse(&self.version).unwrap_or(Version(0, 0, 0))
    }

    /// Name of the PostgreSQL schema of the plugin.
    pub fn schema_name(&self) -> String {
        schema_name(&self.id)
    }

    pub fn resource(&self, name: &str) -> Option<&ResourceDecl> {
        self.resources.iter().find(|r| r.name == name)
    }

    pub fn validate(&self) -> Result<()> {
        let bad = |m: String| Err(Error::Manifest(m));
        if !is_plugin_id(&self.id) {
            return bad(format!("invalid id '{}' (e.g. com.company.name)", self.id));
        }
        if self.name.trim().is_empty() {
            return bad("name required".into());
        }
        if Version::parse(&self.version).is_none() {
            return bad(format!("version '{}' is not MAJOR.MINOR.PATCH", self.version));
        }
        if Version::parse(&self.min_kernel).is_none() {
            return bad(format!("min_kernel '{}' is not MAJOR.MINOR.PATCH", self.min_kernel));
        }
        if self.abi != ABI_VERSION {
            return bad(format!("abi {} not supported (the kernel supports {ABI_VERSION})", self.abi));
        }
        if self.contribution.label.trim().is_empty() || self.contribution.icon.trim().is_empty() {
            return bad("contribution.icon and contribution.label required".into());
        }
        let mut names = std::collections::HashSet::new();
        for r in &self.resources {
            if !is_identifier(&r.name) || r.name.starts_with("kpi_") {
                return bad(format!("invalid resource name '{}'", r.name));
            }
            if !names.insert(r.name.as_str()) {
                return bad(format!("duplicate resource '{}'", r.name));
            }
            if r.fields.is_empty() {
                return bad(format!("the resource '{}' has no fields", r.name));
            }
            let mut keys = std::collections::HashSet::new();
            for f in &r.fields {
                if !is_identifier(&f.key) || RESERVED_FIELDS.contains(&f.key.as_str()) {
                    return bad(format!("field '{}.{}' invalid or reserved", r.name, f.key));
                }
                if !keys.insert(f.key.as_str()) {
                    return bad(format!("duplicate field '{}.{}'", r.name, f.key));
                }
                if f.kind == FieldKind::Choice && f.options.is_empty() {
                    return bad(format!("the choice field '{}.{}' has no options", r.name, f.key));
                }
            }
            if let Some(t) = &r.title_field {
                if !r.fields.iter().any(|f| &f.key == t) {
                    return bad(format!("title_field '{t}' does not exist in '{}'", r.name));
                }
            }
        }
        for h in &self.permissions.hooks {
            if self.resource(h).is_none() {
                return bad(format!("hook on a resource that does not exist '{h}'"));
            }
        }
        for o in self.permissions.network.iter().chain(&self.permissions.frame_src) {
            if !is_origin(o) {
                return bad(format!("invalid origin '{o}' (e.g. https://example.com)"));
            }
        }
        for c in &self.permissions.calls {
            if !is_plugin_id(c) || c == &self.id {
                return bad(format!("permissions.calls: invalid id '{c}'"));
            }
        }
        if let Some(db) = &self.requires.database {
            if db != "postgres" {
                return bad(format!("requires.database '{db}' invalid (only \"postgres\")"));
            }
        }
        for e in &self.requires.extensions {
            if !is_identifier(e) {
                return bad(format!("requires.extensions: invalid name '{e}'"));
            }
            if self.requires.database.is_none() {
                return bad("requires.extensions richiede requires.database = \"postgres\"".into());
            }
        }
        if let Some(ui) = &self.ui {
            if !is_safe_path(&ui.entry) || ui.public_view.as_deref().is_some_and(|p| !is_safe_path(p)) {
                return bad("invalid ui paths".into());
            }
        }
        for k in &self.kpi {
            if !k.view.starts_with("kpi_") || !is_identifier(&k.view) {
                return bad(format!("KPI view '{}' must be called kpi_*", k.view));
            }
        }
        Ok(())
    }
}

/// `com.company.name`: at least two segments, lower case, digits and `-`.
pub fn is_plugin_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    id.len() <= 64
        && parts.len() >= 2
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                && !p.starts_with('-')
        })
}

/// PostgreSQL schema of a plugin: `plg_` + sanitized id (max 63 characters).
pub fn schema_name(id: &str) -> String {
    let s: String = id.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let mut name = format!("plg_{s}");
    name.truncate(63);
    name
}

fn is_origin(o: &str) -> bool {
    let rest = o.strip_prefix("https://").or_else(|| o.strip_prefix("http://"));
    match rest {
        Some(host) => {
            !host.is_empty()
                && !host.contains('/')
                && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-:[]".contains(c))
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTES: &str = r#"
        id = "com.mosaikit.notes"
        name = "Note"
        version = "0.3.0"
        [contribution]
        icon = "📝"
        label = "Note"
        [[resources]]
        name = "notes"
        fields = [
          { key = "title", label = "Title", kind = "text", required = true },
          { key = "tag", label = "Tag", kind = "choice", options = ["a", "b"] },
        ]
        [permissions]
        hooks = ["notes"]
        frame_src = ["https://web.geolibre.app"]
        [[kpi]]
        view = "kpi_notes_by_tag"
        label = "Notes by tag"
    "#;

    #[test]
    fn parse_valido() {
        let m = Manifest::from_toml(NOTES).unwrap();
        assert_eq!(m.schema_name(), "plg_com_mosaikit_notes");
        assert_eq!(m.resources[0].title_key(), Some("title"));
        assert_eq!(m.abi, ABI_VERSION);
    }

    #[test]
    fn validation_errors() {
        let bad_id = NOTES.replace(r#"id = "com.mosaikit.notes""#, r#"id = "notes""#);
        assert!(Manifest::from_toml(&bad_id).is_err());
        let bad_version = NOTES.replace(r#"version = "0.3.0""#, r#"version = "1.0""#);
        assert!(Manifest::from_toml(&bad_version).is_err());
        let bad_abi = format!("abi = 2\n{NOTES}");
        assert!(Manifest::from_toml(&bad_abi).is_err());
        let reserved = NOTES.replace(r#"key = "tag""#, r#"key = "tenant_id""#);
        assert!(Manifest::from_toml(&reserved).is_err());
        let bad_origin = NOTES.replace("https://web.geolibre.app", "javascript:alert(1)");
        assert!(Manifest::from_toml(&bad_origin).is_err());
        let bad_kpi = NOTES.replace("kpi_notes_by_tag", "notes_by_tag");
        assert!(Manifest::from_toml(&bad_kpi).is_err());
        let unknown = format!("{NOTES}\nunknown = 1");
        assert!(Manifest::from_toml(&unknown).is_err());
    }

    #[test]
    fn plugin_id() {
        assert!(is_plugin_id("com.mosaikit.static-site"));
        assert!(!is_plugin_id("Com.X"));
        assert!(!is_plugin_id("single"));
        assert!(!is_plugin_id("a..b"));
    }
}
