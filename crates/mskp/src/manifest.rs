//! Manifest v3 (`plugin.toml`).

use std::collections::BTreeMap;

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
    /// Permissions of the people in the plugin beyond the standard ones of the kernel (`use`,
    /// `create`, `delete`, `share`), given by the permission profiles of the tenant. The kernel
    /// sends the permissions of the caller to the logic (`ctx.perms`) and to the UI: the plugin
    /// enforces its own ones.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub user_permissions: Vec<UserPermission>,
    /// Texts in other languages (`[i18n.it]`, ...); the texts above are the English ones.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub i18n: BTreeMap<String, Translation>,
}

/// A permission of the people in the plugin (`[[user_permissions]]`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct UserPermission {
    /// identifier (`export`, `approve`...): lower case, digits and `_`
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    /// given by the profiles that do not say otherwise (the "Standard" profile, for example)
    #[serde(default = "yes")]
    pub default: bool,
}

fn yes() -> bool {
    true
}

/// The permissions the kernel gives to every plugin and enforces itself.
pub const STANDARD_PERMISSIONS: &[&str] = &["use", "create", "delete", "share"];

/// Texts of the manifest in another language. Every key is optional: what is missing stays in
/// English.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct Translation {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// `contribution.label`
    #[serde(default)]
    pub label: Option<String>,
    /// by name of the resource
    #[serde(default)]
    pub resources: BTreeMap<String, ResourceTranslation>,
    /// by name of the KPI view
    #[serde(default)]
    pub kpi: BTreeMap<String, KpiTranslation>,
    /// by key of the user permission
    #[serde(default)]
    pub permissions: BTreeMap<String, PermissionTranslation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct PermissionTranslation {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct ResourceTranslation {
    #[serde(default)]
    pub label: Option<String>,
    /// labels of the fields, by key
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    /// labels of the values of the choice fields: key of the field -> value -> label
    #[serde(default)]
    pub options: BTreeMap<String, BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct KpiTranslation {
    #[serde(default)]
    pub label: Option<String>,
    /// labels of the columns of the view
    #[serde(default)]
    pub columns: BTreeMap<String, String>,
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
    /// Labels of the values of a choice field (value -> label), shown instead of the value.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub option_labels: BTreeMap<String, String>,
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
    /// Labels of the columns of the view (default: the names of the columns).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub columns: BTreeMap<String, String>,
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
                return bad("requires.extensions needs requires.database = \"postgres\"".into());
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
        for r in &self.resources {
            for f in &r.fields {
                if f.option_labels.keys().any(|v| !f.options.contains(v)) {
                    return bad(format!(
                        "option_labels of '{}.{}' name a value that is not an option",
                        r.name, f.key
                    ));
                }
            }
        }
        let mut perms = std::collections::HashSet::new();
        for p in &self.user_permissions {
            if !is_identifier(&p.key) || STANDARD_PERMISSIONS.contains(&p.key.as_str()) {
                return bad(format!("user permission '{}' invalid or standard", p.key));
            }
            if !perms.insert(p.key.as_str()) {
                return bad(format!("duplicate user permission '{}'", p.key));
            }
            if p.label.trim().is_empty() {
                return bad(format!("the user permission '{}' has no label", p.key));
            }
        }
        for (lang, tr) in &self.i18n {
            self.validate_translation(lang, tr).map_err(|m| Error::Manifest(format!("i18n.{lang}: {m}")))?;
        }
        Ok(())
    }

    fn validate_translation(&self, lang: &str, tr: &Translation) -> std::result::Result<(), String> {
        if !is_lang(lang) || lang == "en" {
            return Err("invalid language (two or three lower-case letters, not en)".into());
        }
        let texts = [&tr.name, &tr.description, &tr.label].into_iter().flatten();
        let mut all: Vec<&String> = texts.collect();
        for (name, rt) in &tr.resources {
            let Some(r) = self.resource(name) else {
                return Err(format!("resource '{name}' does not exist"));
            };
            all.extend(rt.label.iter());
            for (key, label) in &rt.fields {
                if !r.fields.iter().any(|f| &f.key == key) {
                    return Err(format!("field '{name}.{key}' does not exist"));
                }
                all.push(label);
            }
            for (key, labels) in &rt.options {
                let Some(f) = r.fields.iter().find(|f| &f.key == key && f.kind == FieldKind::Choice) else {
                    return Err(format!("'{name}.{key}' is not a choice field"));
                };
                if let Some(v) = labels.keys().find(|v| !f.options.contains(v)) {
                    return Err(format!("'{v}' is not an option of '{name}.{key}'"));
                }
                all.extend(labels.values());
            }
        }
        for (view, kt) in &tr.kpi {
            if !self.kpi.iter().any(|k| &k.view == view) {
                return Err(format!("KPI view '{view}' is not declared"));
            }
            all.extend(kt.label.iter());
            all.extend(kt.columns.values());
        }
        for (key, pt) in &tr.permissions {
            if !self.user_permissions.iter().any(|p| &p.key == key) {
                return Err(format!("user permission '{key}' is not declared"));
            }
            all.extend(pt.label.iter());
            all.extend(pt.description.iter());
        }
        if all.iter().any(|t| t.chars().count() > 300) {
            return Err("text longer than 300 characters".into());
        }
        Ok(())
    }

    /// The manifest with the texts of `lang` (e.g. `it`, `it-IT`) where it has them; English for
    /// the rest and for the languages it does not have.
    pub fn localized(&self, lang: &str) -> Manifest {
        let mut m = self.clone();
        let base = lang.split(['-', '_']).next().unwrap_or_default().to_ascii_lowercase();
        let Some(tr) = self.i18n.get(&base) else {
            return m;
        };
        let set = |target: &mut String, v: &Option<String>| {
            if let Some(v) = v {
                *target = v.clone();
            }
        };
        set(&mut m.name, &tr.name);
        set(&mut m.description, &tr.description);
        set(&mut m.contribution.label, &tr.label);
        for r in &mut m.resources {
            let Some(rt) = tr.resources.get(&r.name) else {
                continue;
            };
            set(&mut r.label, &rt.label);
            for f in &mut r.fields {
                if let Some(label) = rt.fields.get(&f.key) {
                    f.label = label.clone();
                }
                if let Some(labels) = rt.options.get(&f.key) {
                    f.option_labels.extend(labels.iter().map(|(k, v)| (k.clone(), v.clone())));
                }
            }
        }
        for k in &mut m.kpi {
            let Some(kt) = tr.kpi.get(&k.view) else {
                continue;
            };
            set(&mut k.label, &kt.label);
            k.columns.extend(kt.columns.iter().map(|(c, v)| (c.clone(), v.clone())));
        }
        for p in &mut m.user_permissions {
            let Some(pt) = tr.permissions.get(&p.key) else {
                continue;
            };
            set(&mut p.label, &pt.label);
            set(&mut p.description, &pt.description);
        }
        m
    }
}

/// Language code of a translation: two or three lower-case letters (`it`, `fr`, `fur`).
fn is_lang(s: &str) -> bool {
    (2..=3).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_lowercase())
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
        name = "Notes"
        version = "0.3.0"
        [contribution]
        icon = "📝"
        label = "Notes"
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
    fn parse_valid() {
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

    const ITALIAN: &str = r#"
        [i18n.it]
        name = "Note"
        label = "Note"
        [i18n.it.resources.notes]
        label = "Note"
        fields = { title = "Titolo" }
        options.tag = { a = "prima" }
        [i18n.it.kpi.kpi_notes_by_tag]
        label = "Note per tag"
        columns = { n = "numero" }
    "#;

    #[test]
    fn translations() {
        let m = Manifest::from_toml(&format!("{NOTES}{ITALIAN}")).unwrap();
        let it = m.localized("it-IT");
        assert_eq!((it.name.as_str(), it.contribution.label.as_str()), ("Note", "Note"));
        assert_eq!(it.resources[0].label, "Note");
        assert_eq!(it.resources[0].fields[0].label, "Titolo");
        // what the translation does not have stays in English
        assert_eq!(it.resources[0].fields[1].label, "Tag");
        assert_eq!(it.resources[0].fields[1].option_labels.get("a").map(String::as_str), Some("prima"));
        assert_eq!(it.kpi[0].label, "Note per tag");
        assert_eq!(it.kpi[0].columns.get("n").map(String::as_str), Some("numero"));
        // English, and the languages without a translation
        assert_eq!(m.localized("en").contribution.label, "Notes");
        assert_eq!(m.localized("fr"), m);
        // the translations survive the round trip through JSON (the manifest stored by the kernel)
        let json = serde_json::to_string(&m).unwrap();
        assert_eq!(serde_json::from_str::<Manifest>(&json).unwrap(), m);
    }

    #[test]
    fn translation_errors() {
        for bad in [
            ITALIAN.replace("[i18n.it]", "[i18n.IT]"),
            ITALIAN.replace("[i18n.it]", "[i18n.en]"),
            ITALIAN.replace("title = \"Titolo\"", "missing = \"Titolo\""),
            ITALIAN.replace("a = \"prima\"", "z = \"prima\""),
            ITALIAN.replace("options.tag", "options.title"),
            ITALIAN.replace("i18n.it.kpi.kpi_notes_by_tag", "i18n.it.kpi.kpi_other"),
            ITALIAN.replace("i18n.it.resources.notes", "i18n.it.resources.other"),
            format!("{ITALIAN}\nunknown = 1"),
        ] {
            assert!(Manifest::from_toml(&format!("{NOTES}{bad}")).is_err(), "{bad}");
        }
        let labels = NOTES
            .replace(r#"options = ["a", "b"] }"#, r#"options = ["a", "b"], option_labels = { c = "C" } }"#);
        assert!(Manifest::from_toml(&labels).is_err());
    }

    #[test]
    fn user_permissions() {
        let perms = r#"
            [[user_permissions]]
            key = "export"
            label = "Export"
            description = "PDF of what they can see"
            [[user_permissions]]
            key = "approve"
            label = "Approve"
            default = false
            [i18n.it.permissions.export]
            label = "Esportare"
        "#;
        let m = Manifest::from_toml(&format!("{NOTES}{perms}")).unwrap();
        assert_eq!(m.user_permissions.len(), 2);
        assert!(m.user_permissions[0].default && !m.user_permissions[1].default);
        let it = m.localized("it");
        assert_eq!(it.user_permissions[0].label, "Esportare");
        assert_eq!(it.user_permissions[0].description, "PDF of what they can see");
        for bad in [
            perms.replace("key = \"export\"", "key = \"use\""),
            perms.replace("key = \"approve\"", "key = \"export\""),
            perms.replace("key = \"export\"", "key = \"Export!\""),
            perms.replace("permissions.export]", "permissions.other]"),
        ] {
            assert!(Manifest::from_toml(&format!("{NOTES}{bad}")).is_err(), "{bad}");
        }
    }

    #[test]
    fn plugin_id() {
        assert!(is_plugin_id("com.mosaikit.static-site"));
        assert!(!is_plugin_id("Com.X"));
        assert!(!is_plugin_id("single"));
        assert!(!is_plugin_id("a..b"));
    }
}
