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
    /// `app` (pages of its own, in the sidebar), `service` (works behind the scenes) or `extension`
    /// (extends another plugin). Absent: `extension` with `[extends]`, `app` with `[ui]`, else `service`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<PluginKind>,
    /// Name of the icon in the set of the shell (Lucide, e.g. `notebook-pen`); the shell shows a
    /// default icon for names it does not know. `contribution.icon` stays for older hosts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
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
    /// The plugin an extension extends (`kind = "extension"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<Extends>,
    /// What an extension adds to the plugin it extends: fields and actions on its resources.
    #[serde(default, skip_serializing_if = "ExtensionDecl::is_empty")]
    pub extension: ExtensionDecl,
    /// Settings of the plugin at platform level, chosen by the Administrator (`[[config]]`); the
    /// logic reads them in `ctx.config`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub config: Vec<ConfigDecl>,
    /// Texts in other languages (`[i18n.it]`, ...); the texts above are the English ones.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub i18n: BTreeMap<String, Translation>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginKind {
    App,
    Service,
    Extension,
}

impl PluginKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PluginKind::App => "app",
            PluginKind::Service => "service",
            PluginKind::Extension => "extension",
        }
    }
}

/// `[extends]`: the plugin an extension extends, from a minimum version.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Extends {
    pub plugin: String,
    #[serde(default = "zero_version")]
    pub min_version: String,
}

fn zero_version() -> String {
    "0.0.0".into()
}

/// What an extension adds to the resources of the plugin it extends. The kernel keeps the values
/// of the fields (one set per item and extension) and checks them with the permissions of the item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct ExtensionDecl {
    #[serde(default)]
    pub fields: Vec<ExtFieldDecl>,
    #[serde(default)]
    pub actions: Vec<ExtActionDecl>,
}

impl ExtensionDecl {
    pub fn is_empty(&self) -> bool {
        self.fields.is_empty() && self.actions.is_empty()
    }

    /// The fields of the extension on a resource of the extended plugin.
    pub fn fields_of(&self, resource: &str) -> Vec<FieldDecl> {
        self.fields.iter().filter(|f| f.resource == resource).map(ExtFieldDecl::field).collect()
    }
}

/// A field an extension adds to a resource (`[[extension.fields]]`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExtFieldDecl {
    /// resource of the extended plugin
    pub resource: String,
    pub key: String,
    #[serde(default)]
    pub label: String,
    pub kind: FieldKind,
    #[serde(default)]
    pub multiline: bool,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub option_labels: BTreeMap<String, String>,
}

impl ExtFieldDecl {
    pub fn field(&self) -> FieldDecl {
        FieldDecl {
            key: self.key.clone(),
            label: self.label.clone(),
            kind: self.kind,
            required: false,
            multiline: self.multiline,
            options: self.options.clone(),
            hidden: false,
            option_labels: self.option_labels.clone(),
        }
    }
}

/// An action an extension adds to the items of a resource (`[[extension.actions]]`): it sets some
/// of its fields (`set`, where `$user` is the name of the person and `$today` the date) or runs a
/// command of its logic (`command`), which answers `{ "set": { ... } }`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExtActionDecl {
    pub resource: String,
    pub key: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub set: BTreeMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

/// A setting of the plugin (`[[config]]`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ConfigDecl {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    pub kind: ConfigKind,
    /// value when the Administrator has not chosen one (not for `secret`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    /// values of a `choice`
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConfigKind {
    Text,
    Number,
    Bool,
    Choice,
    /// encrypted, never shown again after saving
    Secret,
}

impl ConfigDecl {
    /// The value checked against the kind (`None`: not valid).
    pub fn check(&self, v: &serde_json::Value) -> Option<serde_json::Value> {
        use serde_json::Value;
        match (self.kind, v) {
            (_, Value::Null) => Some(Value::Null),
            (ConfigKind::Text | ConfigKind::Secret, Value::String(s)) if s.len() <= 4000 => Some(v.clone()),
            (ConfigKind::Number, Value::Number(_)) => Some(v.clone()),
            (ConfigKind::Number, Value::String(s)) => {
                s.trim().parse::<f64>().ok().filter(|x| x.is_finite()).map(|x| serde_json::json!(x))
            }
            (ConfigKind::Bool, Value::Bool(_)) => Some(v.clone()),
            (ConfigKind::Choice, Value::String(s)) if self.options.contains(s) => Some(v.clone()),
            _ => None,
        }
    }
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
    /// labels of the fields and actions of an extension, by key
    #[serde(default)]
    pub extension: ExtensionTranslation,
    /// by key of the setting
    #[serde(default)]
    pub config: BTreeMap<String, PermissionTranslation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct ExtensionTranslation {
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    #[serde(default)]
    pub actions: BTreeMap<String, String>,
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

    /// The kind declared, or the one that follows from `[extends]` and `[ui]`.
    pub fn effective_kind(&self) -> PluginKind {
        self.kind.unwrap_or(if self.extends.is_some() {
            PluginKind::Extension
        } else if self.ui.is_some() {
            PluginKind::App
        } else {
            PluginKind::Service
        })
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
        self.validate_kind().map_err(Error::Manifest)?;
        self.validate_config().map_err(Error::Manifest)?;
        for (lang, tr) in &self.i18n {
            self.validate_translation(lang, tr).map_err(|m| Error::Manifest(format!("i18n.{lang}: {m}")))?;
        }
        Ok(())
    }

    fn validate_kind(&self) -> std::result::Result<(), String> {
        if let Some(icon) = &self.icon {
            let ok = !icon.is_empty()
                && icon.len() <= 48
                && icon.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            if !ok {
                return Err(format!("icon '{icon}': the name of an icon (lower case, digits and -)"));
            }
        }
        let extension = self.effective_kind() == PluginKind::Extension;
        match (&self.extends, extension) {
            (Some(_), false) => return Err("[extends] is only for kind = \"extension\"".into()),
            (None, true) => return Err("an extension needs [extends] with the plugin it extends".into()),
            (Some(e), true) => {
                if !is_plugin_id(&e.plugin) || e.plugin == self.id {
                    return Err(format!("extends.plugin: invalid id '{}'", e.plugin));
                }
                if Version::parse(&e.min_version).is_none() {
                    return Err(format!("extends.min_version '{}' is not MAJOR.MINOR.PATCH", e.min_version));
                }
            }
            (None, false) => {}
        }
        if !extension && !self.extension.is_empty() {
            return Err("[extension] is only for kind = \"extension\"".into());
        }
        let mut keys = std::collections::HashSet::new();
        for f in &self.extension.fields {
            if !is_identifier(&f.resource)
                || !is_identifier(&f.key)
                || RESERVED_FIELDS.contains(&f.key.as_str())
            {
                return Err(format!("extension field '{}.{}' invalid or reserved", f.resource, f.key));
            }
            if !keys.insert(f.key.as_str()) {
                return Err(format!("duplicate extension field '{}'", f.key));
            }
            if f.kind == FieldKind::Choice && f.options.is_empty() {
                return Err(format!("the choice field '{}' has no options", f.key));
            }
            if f.option_labels.keys().any(|v| !f.options.contains(v)) {
                return Err(format!("option_labels of '{}' name a value that is not an option", f.key));
            }
        }
        let mut actions = std::collections::HashSet::new();
        for a in &self.extension.actions {
            if !is_identifier(&a.resource) || !is_identifier(&a.key) {
                return Err(format!("extension action '{}.{}' invalid", a.resource, a.key));
            }
            if !actions.insert(a.key.as_str()) {
                return Err(format!("duplicate extension action '{}'", a.key));
            }
            if a.label.trim().is_empty() {
                return Err(format!("the extension action '{}' has no label", a.key));
            }
            match (&a.command, a.set.is_empty()) {
                (Some(_), false) | (None, true) => {
                    return Err(format!("the extension action '{}' needs either set or command", a.key))
                }
                (Some(c), true) => {
                    let ok = !c.is_empty()
                        && c.len() <= 64
                        && c.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b));
                    if !ok {
                        return Err(format!("the extension action '{}': invalid command '{c}'", a.key));
                    }
                }
                (None, false) => {
                    for (k, v) in &a.set {
                        let Some(f) =
                            self.extension.fields.iter().find(|f| &f.key == k && f.resource == a.resource)
                        else {
                            return Err(format!(
                                "the extension action '{}' sets '{k}', not a field of {}",
                                a.key, a.resource
                            ));
                        };
                        let ok = match v {
                            serde_json::Value::String(_) | serde_json::Value::Null => true,
                            serde_json::Value::Bool(_) => f.kind == FieldKind::Bool,
                            serde_json::Value::Number(_) => f.kind == FieldKind::Number,
                            _ => false,
                        };
                        if !ok {
                            return Err(format!(
                                "the extension action '{}': value of '{k}' of the wrong type",
                                a.key
                            ));
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn validate_config(&self) -> std::result::Result<(), String> {
        let mut keys = std::collections::HashSet::new();
        for c in &self.config {
            if !is_identifier(&c.key) || !keys.insert(c.key.as_str()) {
                return Err(format!("config '{}' invalid or duplicate", c.key));
            }
            if c.label.trim().is_empty() {
                return Err(format!("the config '{}' has no label", c.key));
            }
            if c.kind == ConfigKind::Choice && c.options.is_empty() {
                return Err(format!("the choice config '{}' has no options", c.key));
            }
            if let Some(d) = &c.default {
                if c.kind == ConfigKind::Secret || c.check(d).is_none() {
                    return Err(format!("the default of the config '{}' does not fit its kind", c.key));
                }
            }
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
        for (key, label) in &tr.extension.fields {
            if !self.extension.fields.iter().any(|f| &f.key == key) {
                return Err(format!("extension field '{key}' is not declared"));
            }
            all.push(label);
        }
        for (key, label) in &tr.extension.actions {
            if !self.extension.actions.iter().any(|a| &a.key == key) {
                return Err(format!("extension action '{key}' is not declared"));
            }
            all.push(label);
        }
        for (key, ct) in &tr.config {
            if !self.config.iter().any(|c| &c.key == key) {
                return Err(format!("config '{key}' is not declared"));
            }
            all.extend(ct.label.iter());
            all.extend(ct.description.iter());
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
        for f in &mut m.extension.fields {
            if let Some(label) = tr.extension.fields.get(&f.key) {
                f.label = label.clone();
            }
        }
        for a in &mut m.extension.actions {
            if let Some(label) = tr.extension.actions.get(&a.key) {
                a.label = label.clone();
            }
        }
        for c in &mut m.config {
            let Some(ct) = tr.config.get(&c.key) else {
                continue;
            };
            set(&mut c.label, &ct.label);
            set(&mut c.description, &ct.description);
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

    const REVIEW: &str = r#"
        id = "com.mosaikit.note-review"
        name = "Note review"
        version = "0.1.0"
        icon = "badge-check"
        [contribution]
        icon = "✔"
        label = "Note review"
        [extends]
        plugin = "com.mosaikit.notes"
        min_version = "0.4.0"
        [[extension.fields]]
        resource = "notes"
        key = "reviewed"
        label = "Reviewed"
        kind = "bool"
        [[extension.fields]]
        resource = "notes"
        key = "reviewer"
        label = "Reviewed by"
        kind = "text"
        [[extension.actions]]
        resource = "notes"
        key = "mark_reviewed"
        label = "Mark as reviewed"
        set = { reviewed = true, reviewer = "$user" }
        [[config]]
        key = "endpoint"
        label = "Address"
        kind = "text"
        default = "https://example.com"
        [[config]]
        key = "token"
        label = "Token"
        kind = "secret"
        [i18n.it]
        name = "Revisione delle note"
        extension = { fields = { reviewed = "Revisionata" }, actions = { mark_reviewed = "Segna come revisionata" } }
        config = { token = { label = "Chiave" } }
    "#;

    #[test]
    fn kinds_and_extensions() {
        let notes = Manifest::from_toml(NOTES).unwrap();
        assert_eq!(notes.effective_kind(), PluginKind::Service, "no [ui]: a service");
        let app = Manifest::from_toml(&format!("kind = \"app\"\n{NOTES}")).unwrap();
        assert_eq!(app.effective_kind(), PluginKind::App);
        let r = Manifest::from_toml(REVIEW).unwrap();
        assert_eq!(r.effective_kind(), PluginKind::Extension, "[extends] makes it an extension");
        assert_eq!(r.icon.as_deref(), Some("badge-check"));
        assert_eq!(r.extension.fields_of("notes").len(), 2);
        assert!(r.extension.fields_of("other").is_empty());
        let it = r.localized("it");
        assert_eq!(it.extension.fields[0].label, "Revisionata");
        assert_eq!(it.extension.fields[1].label, "Reviewed by");
        assert_eq!(it.extension.actions[0].label, "Segna come revisionata");
        assert_eq!(it.config[1].label, "Chiave");
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(serde_json::from_str::<Manifest>(&json).unwrap(), r);
        let plain = serde_json::to_string(&notes).unwrap();
        assert!(
            !plain.contains("\"extension\"") && !plain.contains("\"extends\""),
            "nothing new when absent"
        );
        for bad in [
            REVIEW.replace("icon = \"badge-check\"", "icon = \"Badge Check\""),
            REVIEW.replace("plugin = \"com.mosaikit.notes\"", "plugin = \"com.mosaikit.note-review\""),
            REVIEW.replace("min_version = \"0.4.0\"", "min_version = \"4\""),
            REVIEW.replace(
                "[extends]\n        plugin = \"com.mosaikit.notes\"\n        min_version = \"0.4.0\"",
                "",
            ),
            REVIEW.replace("set = { reviewed = true, reviewer = \"$user\" }", "set = { missing = true }"),
            REVIEW.replace("set = { reviewed = true, reviewer = \"$user\" }", "set = { reviewed = 3 }"),
            REVIEW.replace(
                "set = { reviewed = true, reviewer = \"$user\" }",
                "set = { reviewed = true }\n        command = \"x\"",
            ),
            REVIEW.replace("key = \"reviewer\"", "key = \"reviewed\""),
            REVIEW.replace("key = \"reviewer\"", "key = \"owner\""),
            REVIEW.replace("kind = \"secret\"", "kind = \"secret\"\n        default = \"x\""),
            REVIEW.replace("default = \"https://example.com\"", "default = 3"),
            REVIEW.replace("actions = { mark_reviewed", "actions = { other"),
            format!("kind = \"app\"\n{REVIEW}"),
        ] {
            assert!(Manifest::from_toml(&bad).is_err(), "{bad}");
        }
        // [extension] without being an extension
        let stray =
            format!("{NOTES}\n[[extension.fields]]\nresource = \"notes\"\nkey = \"x\"\nkind = \"text\"\n");
        assert!(Manifest::from_toml(&stray).is_err());
    }

    #[test]
    fn config_values() {
        let r = Manifest::from_toml(REVIEW).unwrap();
        let text = &r.config[0];
        assert_eq!(text.check(&serde_json::json!("x")), Some(serde_json::json!("x")));
        assert_eq!(text.check(&serde_json::json!(3)), None);
        let num = ConfigDecl { kind: ConfigKind::Number, ..text.clone() };
        assert_eq!(num.check(&serde_json::json!("2.5")), Some(serde_json::json!(2.5)));
        let choice = ConfigDecl { kind: ConfigKind::Choice, options: vec!["a".into()], ..text.clone() };
        assert_eq!(choice.check(&serde_json::json!("b")), None);
    }

    #[test]
    fn plugin_id() {
        assert!(is_plugin_id("com.mosaikit.static-site"));
        assert!(!is_plugin_id("Com.X"));
        assert!(!is_plugin_id("single"));
        assert!(!is_plugin_id("a..b"));
    }
}
