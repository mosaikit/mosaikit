//! Manifest v3 (`plugin.toml`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{is_identifier, is_safe_path, Error, Result, Version, VersionReq};

/// Version of the plugin API (logic ABI, SDK, UI package) supported by the kernel: what a plugin declares
/// with `[requires] api`.
pub const API_VERSION: u32 = 1;
/// Old name of [`API_VERSION`] (the manifest key `abi`).
pub const ABI_VERSION: u32 = API_VERSION;

/// Columns the host adds to every table of a plugin.
const RESERVED_FIELDS: &[&str] = &["resource_id", "tenant_id", "id", "owner", "my_level"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    /// Deprecated: use `[requires] api`. Kept for one major version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abi: Option<u32>,
    /// Deprecated: use `[requires] mosaikit`. Kept for one major version.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_kernel: Option<String>,
    #[serde(default)]
    pub description: String,
    /// Brochure of the plugin (optional): who made it, under which licence, where to read more, a longer
    /// text (paragraphs separated by a blank line) and pictures of it (files of `media/` in the package).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    /// address of a page about the plugin (`http://` or `https://`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    /// names of image files of `media/` (png, jpg, webp or svg), at most 8, shown as a gallery
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub screenshots: Vec<String>,
    /// `app` (pages of its own, in the sidebar), `service` (works behind the scenes) or `extension`
    /// (extends another plugin). Absent: `extension` with `[extends]`, `app` with `[ui]`, else `service`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<PluginKind>,
    /// Name of the icon in the set of the shell (Lucide, e.g. `notebook-pen`); the shell shows a
    /// default icon for names it does not know. `contribution.icon` stays for older hosts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// Deprecated, optional: emoji icon and label for older hosts. Absent: the label is `name` and the icon a default.
    #[serde(default)]
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
    /// Keys of outside services the plugin uses (`[[service_keys]]`): the keys pages of the platform,
    /// of the tenants and of the people list only the services the installed plugins declare. The
    /// logic reads the key in use for the caller (own, else the tenant's, else the platform's).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub service_keys: Vec<ServiceKeyDecl>,
    /// Texts in other languages (`[i18n.it]`, ...); the texts above are the English ones.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub i18n: BTreeMap<String, Translation>,
    /// `[search]`: a command of the logic the kernel calls with `{ "q": ... }` to add results to the
    /// search of the shell (titles and searchable fields are found without it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<SearchDecl>,
    /// The pages of an app in the navigation of the shell (`[[nav]]`): entries at the top and, under
    /// an entry, its children (two levels). Each layout draws the tree in its own way; opening an
    /// entry opens the app at its `place` (`msk.at` in the UI).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nav: Vec<NavDecl>,
    /// The language a language plugin brings (`kind = "language"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<LanguageDecl>,
}

/// `[language]` of a language plugin: the code and the name of the language in that language.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LanguageDecl {
    pub code: String,
    pub name: String,
}

/// A name of an image file of `media/` (no folders): letters, digits, `-`, `_`, `.` and an image extension.
pub fn is_media_name(n: &str) -> bool {
    let lower = n.to_ascii_lowercase();
    n.len() <= 80
        && !n.starts_with('.')
        && n.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        && ["png", "jpg", "jpeg", "webp", "svg"].iter().any(|e| lower.ends_with(&format!(".{e}")))
}

/// An entry of the navigation of an app (`[[nav]]`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NavDecl {
    /// identifier, unique in the plugin
    pub id: String,
    pub label: String,
    /// name of an icon of the shell (Lucide)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// the place inside the app it opens (`msk.at`); absent: the id. An entry with children and no
    /// place is only a group.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    /// the entry it is under (an entry at the top)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    /// shown only to whoever has this permission of the plugin (standard or `user_permissions`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<String>,
}

impl NavDecl {
    /// The place it opens, if any: its own, or the id for an entry without children.
    pub fn target(&self, has_children: bool) -> Option<String> {
        self.place.clone().or_else(|| (!has_children).then(|| self.id.clone()))
    }
}

/// `[search]` of a manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SearchDecl {
    /// name of the command; it returns `{ "results": [{ "id": "<resource id>", "snippet": "..." }] }`
    pub command: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginKind {
    App,
    Service,
    Extension,
    /// how the shell arranges its slots (`layout/layout.toml`), with a style and images
    Layout,
    /// a language of the interface (`lang/host.json`, `lang/plugins/*.toml`): texts only, never code
    Language,
}

impl PluginKind {
    pub fn as_str(self) -> &'static str {
        match self {
            PluginKind::App => "app",
            PluginKind::Service => "service",
            PluginKind::Extension => "extension",
            PluginKind::Layout => "layout",
            PluginKind::Language => "language",
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tabs: Vec<ExtTabDecl>,
}

impl ExtensionDecl {
    pub fn is_empty(&self) -> bool {
        self.fields.is_empty() && self.actions.is_empty() && self.tabs.is_empty()
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
    /// kept by the kernel but not shown by `mountCrud` (e.g. data that only a tab of the extension uses)
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
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
            hidden: self.hidden,
            option_labels: self.option_labels.clone(),
            // values of an extension live in the kernel, not in the search text of the base plugin
            search: Some(false),
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

/// A tab an extension adds to the detail of the items of a resource (`[[extension.tabs]]`): a page of
/// the UI of the extension, shown by the host in a sandboxed frame inside the detail of the item.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ExtTabDecl {
    pub resource: String,
    pub key: String,
    pub label: String,
    /// name of a Lucide icon, like the `icon` of the plugin
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    /// page of the UI of the extension (relative to its `[ui]` folder); default: the entry
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
}

/// A key of an outside service the plugin uses (`[[service_keys]]`). Several plugins may declare
/// the same service (`id`): they share its keys.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ServiceKeyDecl {
    /// identifier of the service (`openai`, `sms-gateway`...): lower case, digits and `-`
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    /// the value is an address (a self-hosted model, for example), shown whole instead of masked
    #[serde(default)]
    pub address: bool,
    /// where a key may be set: the platform, the tenants, the people (default: everywhere)
    #[serde(default = "all_key_scopes")]
    pub scopes: Vec<KeyScope>,
}

/// Where a key of an outside service may be set.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum KeyScope {
    Platform,
    Tenant,
    Personal,
}

fn all_key_scopes() -> Vec<KeyScope> {
    vec![KeyScope::Platform, KeyScope::Tenant, KeyScope::Personal]
}

/// `openai`, `sms-gateway`: lower case, digits and `-`, at most 40 characters.
pub fn is_service_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !s.starts_with('-')
        && !s.ends_with('-')
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
    #[serde(default)]
    pub details: Option<String>,
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
    /// by id of the service of `[[service_keys]]`
    #[serde(default)]
    pub service_keys: BTreeMap<String, PermissionTranslation>,
    /// labels of the entries of the navigation, by id
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub nav: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct ExtensionTranslation {
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
    #[serde(default)]
    pub actions: BTreeMap<String, String>,
    #[serde(default)]
    pub tabs: BTreeMap<String, String>,
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
    /// Versions of Mosaikit the plugin works with, as a range (`">=1.2, <2"`); absent: any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mosaikit: Option<String>,
    /// Version of the plugin API the plugin was built for (an integer); absent: the current one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api: Option<u32>,
    /// "postgres" if the plugin uses PostgreSQL functions (e.g. PostGIS); empty = any
    #[serde(default)]
    pub database: Option<String>,
    /// PostgreSQL extensions that must be installed in the database (e.g. postgis)
    #[serde(default)]
    pub extensions: Vec<String>,
}

/// Why a plugin does not fit this installation (shown to the Administrator, translated by the interface).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Incompatible {
    /// the version of Mosaikit is outside the range the plugin declares
    Mosaikit { range: String, kernel: String },
    /// the plugin was built for another version of the plugin API
    Api { wanted: u32, supported: u32 },
}

impl std::fmt::Display for Incompatible {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Incompatible::Mosaikit { range, kernel } => {
                write!(f, "the plugin works with Mosaikit {range} (this is {kernel})")
            }
            Incompatible::Api { wanted, supported } => {
                write!(f, "the plugin uses plugin API {wanted} (this Mosaikit supports {supported})")
            }
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Contribution {
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
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
    /// Date field that is the due date of an item: the kernel copies it, and the Home of a person lists
    /// what is due soon (`kind = "date"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_field: Option<String>,
    /// Bool field that says an item is done: a done item is no longer due (`kind = "bool"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_field: Option<String>,
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
    /// Found by the search of the shell. Absent: yes for the visible text fields, no otherwise
    /// (`search = false` keeps a text field out, e.g. codes or private notes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<bool>,
}

impl FieldDecl {
    /// Whether the search of the shell looks into this field.
    pub fn searchable(&self) -> bool {
        self.search.unwrap_or(self.kind == FieldKind::Text && !self.hidden)
    }
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
    /// The UI may embed any web site in a frame (`frame-src https: http:`) and ask the host to look at
    /// a page (frame allowed? title, picture): `msk.web.probe`. The host fetches it, only from public
    /// addresses.
    #[serde(default)]
    pub web: bool,
    /// Plugins whose commands the logic may call (`plugin.call`), with the current
    /// user: the called plugin applies its own rules.
    #[serde(default)]
    pub calls: Vec<String>,
    /// The logic may send notifications (host operation `notify`) to the person who calls it or to the
    /// people who see one of its items.
    #[serde(default)]
    pub notify: bool,
    /// The UI may compile code at run time: its CSP gets `'unsafe-eval'` and `'wasm-unsafe-eval'` in
    /// `script-src` and `worker-src` (e.g. an engine that runs scripts or WebAssembly of its own).
    /// Sensitive: the Administrator sees it when the plugin is installed. Default: false.
    #[serde(default)]
    pub script_eval: bool,
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
        let mut m: Manifest = toml::from_str(s).map_err(|e| Error::Manifest(e.to_string()))?;
        // `[contribution]` is optional: the name labels the plugin where older hosts showed the label
        if m.contribution.label.trim().is_empty() {
            m.contribution.label = m.name.clone();
        }
        if m.contribution.icon.trim().is_empty() {
            m.contribution.icon = "🧩".into();
        }
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

    /// The range of Mosaikit versions the plugin accepts: `[requires] mosaikit`, else the deprecated
    /// `min_kernel` as a lower bound, else any.
    pub fn mosaikit_range(&self) -> VersionReq {
        if let Some(r) = self.requires.mosaikit.as_deref().and_then(VersionReq::parse) {
            return r;
        }
        match self.min_kernel.as_deref().and_then(Version::parse) {
            Some(v) => VersionReq::at_least(v),
            None => VersionReq::parse("*").expect("any"),
        }
    }

    /// The plugin API the plugin was built for: `[requires] api`, else the deprecated `abi`, else the
    /// current one.
    pub fn api(&self) -> u32 {
        self.requires.api.or(self.abi).unwrap_or(API_VERSION)
    }

    /// Checks the plugin against a version of Mosaikit and the plugin API of this build.
    pub fn check_compatible(&self, kernel: Version) -> std::result::Result<(), Incompatible> {
        if self.api() != API_VERSION {
            return Err(Incompatible::Api { wanted: self.api(), supported: API_VERSION });
        }
        let range = self.mosaikit_range();
        if !range.matches(kernel) {
            return Err(Incompatible::Mosaikit { range: range.to_string(), kernel: kernel.to_string() });
        }
        Ok(())
    }

    /// Deprecated manifest keys in use (the kernel logs them as warnings in development).
    pub fn deprecations(&self) -> Vec<String> {
        let mut v = Vec::new();
        if self.abi.is_some() {
            v.push("`abi` is deprecated: use `[requires] api`".to_string());
        }
        if self.min_kernel.is_some() {
            v.push("`min_kernel` is deprecated: use `[requires] mosaikit = \">=1.2, <2\"`".to_string());
        }
        v
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
        if let Some(m) = &self.min_kernel {
            if Version::parse(m).is_none() {
                return bad(format!("min_kernel '{m}' is not MAJOR.MINOR.PATCH"));
            }
        }
        if let Some(r) = &self.requires.mosaikit {
            if VersionReq::parse(r).is_none() {
                return bad(format!("requires.mosaikit '{r}' is not a version range (e.g. \">=1.2, <2\")"));
            }
        }
        // an API this kernel does not know is not a manifest error: the kernel refuses the plugin with its
        // own message (`check_compatible`), so the Administrator sees why in Plugins
        if self.api() == 0 {
            return bad("requires.api must be 1 or more".into());
        }
        if self.contribution.label.trim().is_empty() || self.contribution.icon.trim().is_empty() {
            return bad("contribution.icon and contribution.label required".into());
        }
        if let Err(m) = self.validate_brochure() {
            return bad(m);
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
            for (what, key, kind) in
                [("due_field", &r.due_field, FieldKind::Date), ("done_field", &r.done_field, FieldKind::Bool)]
            {
                if let Some(key) = key {
                    if !r.fields.iter().any(|f| &f.key == key && f.kind == kind) {
                        return bad(format!(
                            "{what} '{key}' must be a {} field of '{}'",
                            if kind == FieldKind::Date { "date" } else { "bool" },
                            r.name
                        ));
                    }
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
        if let Some(sd) = &self.search {
            if !is_identifier(&sd.command) {
                return bad(format!("search.command: invalid name '{}'", sd.command));
            }
        }
        self.validate_kind().map_err(Error::Manifest)?;
        self.validate_nav().map_err(Error::Manifest)?;
        self.validate_config().map_err(Error::Manifest)?;
        self.validate_service_keys().map_err(Error::Manifest)?;
        for (lang, tr) in &self.i18n {
            self.validate_translation(lang, tr).map_err(|m| Error::Manifest(format!("i18n.{lang}: {m}")))?;
        }
        Ok(())
    }

    /// `[[nav]]`: only an app has pages; ids unique, two levels, places and permissions that exist.
    fn validate_brochure(&self) -> std::result::Result<(), String> {
        let long = |v: &Option<String>, max: usize| v.as_ref().is_some_and(|s| s.chars().count() > max);
        if long(&self.author, 120) || long(&self.license, 80) || long(&self.details, 4000) {
            return Err("author (120), license (80) or details (4000 characters) too long".into());
        }
        if let Some(h) = &self.homepage {
            if !(h.starts_with("https://") || h.starts_with("http://"))
                || h.len() > 300
                || h.chars().any(char::is_whitespace)
            {
                return Err("homepage must be an http:// or https:// address".into());
            }
        }
        if self.screenshots.len() > 8 {
            return Err("at most 8 screenshots".into());
        }
        for n in &self.screenshots {
            if !is_media_name(n) {
                return Err(format!("screenshot '{n}': a file name of letters, digits, - _ . with the extension png, jpg, jpeg, webp or svg"));
            }
        }
        Ok(())
    }

    fn validate_nav(&self) -> std::result::Result<(), String> {
        if self.nav.is_empty() {
            return Ok(());
        }
        if self.effective_kind() != PluginKind::App {
            return Err("[[nav]] is only for kind = \"app\"".into());
        }
        if self.nav.len() > 40 {
            return Err("at most 40 [[nav]] entries".into());
        }
        let mut ids = std::collections::HashSet::new();
        for n in &self.nav {
            if !is_identifier(&n.id) {
                return Err(format!("nav: invalid id '{}'", n.id));
            }
            if !ids.insert(n.id.as_str()) {
                return Err(format!("nav: duplicate id '{}'", n.id));
            }
            if n.label.trim().is_empty() || n.label.chars().count() > 60 {
                return Err(format!("nav '{}': a label of 1 to 60 characters", n.id));
            }
            if let Some(icon) = &n.icon {
                if icon.is_empty()
                    || icon.len() > 48
                    || !icon.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                {
                    return Err(format!("nav '{}': icon '{icon}' is not the name of an icon", n.id));
                }
            }
            if let Some(p) = &n.place {
                if p.is_empty()
                    || p.len() > 64
                    || !p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                {
                    return Err(format!("nav '{}': place '{p}' (letters, digits, - and _)", n.id));
                }
            }
            if let Some(perm) = &n.permission {
                if !STANDARD_PERMISSIONS.contains(&perm.as_str())
                    && !self.user_permissions.iter().any(|u| &u.key == perm)
                {
                    return Err(format!("nav '{}': permission '{perm}' is not declared", n.id));
                }
            }
        }
        for n in &self.nav {
            if let Some(parent) = &n.parent {
                match self.nav.iter().find(|p| &p.id == parent) {
                    None => return Err(format!("nav '{}': parent '{parent}' does not exist", n.id)),
                    Some(p) if p.parent.is_some() => {
                        return Err(format!("nav '{}': two levels at most ('{parent}' has a parent)", n.id));
                    }
                    Some(_) => {}
                }
            }
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
        if self.effective_kind() == PluginKind::Layout
            && (!self.resources.is_empty()
                || self.ui.is_some()
                || !self.kpi.is_empty()
                || self.search.is_some())
        {
            return Err("a layout has no resources, [ui], KPIs or [search]: only layout/ files".into());
        }
        let language = self.effective_kind() == PluginKind::Language;
        match (&self.language, language) {
            (Some(_), false) => return Err("[language] is only for kind = \"language\"".into()),
            (None, true) => return Err("a language plugin needs [language] (code, name)".into()),
            (Some(l), true) => {
                crate::language::check_code(&l.code)?;
                if l.name.trim().is_empty() || l.name.chars().count() > 60 {
                    return Err("language.name: the name of the language, at most 60 characters".into());
                }
                if !self.resources.is_empty()
                    || self.ui.is_some()
                    || !self.kpi.is_empty()
                    || self.search.is_some()
                    || !self.nav.is_empty()
                    || !self.extension.is_empty()
                {
                    return Err("a language has no resources, [ui], KPIs, [search], [[nav]] or [extension]: only lang/ files".into());
                }
            }
            (None, false) => {}
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
        let mut tabs = std::collections::HashSet::new();
        for t in &self.extension.tabs {
            if !is_identifier(&t.resource) || !is_identifier(&t.key) {
                return Err(format!("extension tab '{}.{}' invalid", t.resource, t.key));
            }
            if !tabs.insert((t.resource.as_str(), t.key.as_str())) {
                return Err(format!("duplicate extension tab '{}'", t.key));
            }
            if t.label.trim().is_empty() || t.label.chars().count() > 40 {
                return Err(format!("the extension tab '{}' needs a label (at most 40 characters)", t.key));
            }
            if let Some(icon) = &t.icon {
                let ok = !icon.is_empty()
                    && icon.len() <= 48
                    && icon.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
                if !ok {
                    return Err(format!("the extension tab '{}': invalid icon '{icon}'", t.key));
                }
            }
            if self.ui.is_none() {
                return Err(format!(
                    "the extension tab '{}' needs [ui]: the tab is a page of the extension",
                    t.key
                ));
            }
            if let Some(page) = &t.page {
                if !is_safe_path(page) || !page.ends_with(".html") {
                    return Err(format!(
                        "the extension tab '{}': page '{page}' is not an .html file of the UI",
                        t.key
                    ));
                }
            }
        }
        Ok(())
    }

    fn validate_service_keys(&self) -> std::result::Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        for s in &self.service_keys {
            if !is_service_id(&s.id) || !ids.insert(s.id.as_str()) {
                return Err(format!("service key '{}' invalid or duplicate", s.id));
            }
            if s.label.trim().is_empty() {
                return Err(format!("the service key '{}' has no label", s.id));
            }
            let repeated = s.scopes.iter().enumerate().any(|(i, x)| s.scopes[..i].contains(x));
            if s.scopes.is_empty() || repeated {
                return Err(format!("the scopes of the service key '{}' are empty or repeated", s.id));
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
        for (key, label) in &tr.extension.tabs {
            if !self.extension.tabs.iter().any(|t| &t.key == key) {
                return Err(format!("extension tab '{key}' is not declared"));
            }
            all.push(label);
        }
        for (id, label) in &tr.nav {
            if !self.nav.iter().any(|n| &n.id == id) {
                return Err(format!("nav entry '{id}' is not declared"));
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
        for (id, st) in &tr.service_keys {
            if !self.service_keys.iter().any(|s| &s.id == id) {
                return Err(format!("service key '{id}' is not declared"));
            }
            all.extend(st.label.iter());
            all.extend(st.description.iter());
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
        // the texts of the manifest itself, else the ones a language plugin brings for this plugin
        let Some(tr) = self.i18n.get(&base).cloned().or_else(|| crate::language::texts_for(&base, &self.id))
        else {
            return m;
        };
        let tr = &tr;
        let set = |target: &mut String, v: &Option<String>| {
            if let Some(v) = v {
                *target = v.clone();
            }
        };
        set(&mut m.name, &tr.name);
        set(&mut m.description, &tr.description);
        if let Some(d) = &tr.details {
            m.details = Some(d.clone());
        }
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
        for t in &mut m.extension.tabs {
            if let Some(label) = tr.extension.tabs.get(&t.key) {
                t.label = label.clone();
            }
        }
        for n in &mut m.nav {
            if let Some(label) = tr.nav.get(&n.id) {
                n.label = label.clone();
            }
        }
        for c in &mut m.config {
            let Some(ct) = tr.config.get(&c.key) else {
                continue;
            };
            set(&mut c.label, &ct.label);
            set(&mut c.description, &ct.description);
        }
        for s in &mut m.service_keys {
            let Some(st) = tr.service_keys.get(&s.id) else {
                continue;
            };
            set(&mut s.label, &st.label);
            set(&mut s.description, &st.description);
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

    #[test]
    fn script_eval_defaults_to_false_and_must_be_a_bool() {
        let base = "id = \"com.x.p\"
name = \"P\"
version = \"0.1.0\"
[contribution]
icon = \"x\"
label = \"P\"
";
        assert!(!Manifest::from_toml(base).unwrap().permissions.script_eval);
        let on = format!(
            "{base}[permissions]
script_eval = true
"
        );
        assert!(Manifest::from_toml(&on).unwrap().permissions.script_eval);
        let bad = format!(
            "{base}[permissions]
script_eval = \"yes\"
"
        );
        assert!(Manifest::from_toml(&bad).is_err());
    }

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
    fn brochure_is_optional_and_checked() {
        let m = Manifest::from_toml(NOTES).unwrap();
        assert!(m.author.is_none() && m.screenshots.is_empty());
        // fields of the top level go before the first table: put them after `version`
        let top = |extra: &str| {
            Manifest::from_toml(&NOTES.replacen(
                "[contribution]",
                &format!(
                    "{extra}
[contribution]"
                ),
                1,
            ))
        };
        let ok = top("author = \"Mosaikit\"
license = \"MIT\"
homepage = \"https://example.org/notes\"
screenshots = [\"one.png\", \"two-2.webp\"]
details = \"First paragraph.\"")
        .unwrap();
        assert_eq!(ok.license.as_deref(), Some("MIT"));
        assert_eq!(ok.screenshots.len(), 2);
        assert!(top("homepage = \"ftp://example.org\"").is_err());
        assert!(top("screenshots = [\"../x.png\"]").is_err());
        assert!(top("screenshots = [\"x.exe\"]").is_err());
        assert!(top("screenshots = [\"1.png\",\"2.png\",\"3.png\",\"4.png\",\"5.png\",\"6.png\",\"7.png\",\"8.png\",\"9.png\"]").is_err());
    }

    #[test]
    fn parse_valid() {
        let m = Manifest::from_toml(NOTES).unwrap();
        assert_eq!(m.schema_name(), "plg_com_mosaikit_notes");
        assert_eq!(m.resources[0].title_key(), Some("title"));
        assert_eq!(m.api(), API_VERSION);
        assert!(m.deprecations().is_empty());
    }

    #[test]
    fn contribution_is_optional() {
        let toml = "id = \"com.example.bare\"
name = \"Bare\"
version = \"1.0.0\"
kind = \"service\"
";
        let m = Manifest::from_toml(toml).unwrap();
        assert_eq!(m.contribution.label, "Bare");
        assert!(!m.contribution.icon.is_empty());
        let m = Manifest::from_toml(&format!(
            "{toml}[contribution]
label = \"Mine\"
"
        ))
        .unwrap();
        assert_eq!(m.contribution.label, "Mine");
    }

    #[test]
    fn requires_range_and_api() {
        let with = |req: &str| Manifest::from_toml(&format!("{NOTES}\n[requires]\n{req}\n")).unwrap();
        let m = with("mosaikit = \">=1.2, <2\"\napi = 1");
        assert!(m.check_compatible(Version(1, 2, 0)).is_ok());
        assert!(m.check_compatible(Version(1, 9, 3)).is_ok());
        assert_eq!(
            m.check_compatible(Version(1, 1, 0)),
            Err(Incompatible::Mosaikit { range: ">=1.2, <2".into(), kernel: "1.1.0".into() })
        );
        assert!(m.check_compatible(Version(2, 0, 0)).is_err());
        // another API is refused by the kernel, not by the parser
        assert_eq!(
            with("api = 2").check_compatible(Version(1, 2, 0)),
            Err(Incompatible::Api { wanted: 2, supported: API_VERSION })
        );
        assert!(Manifest::from_toml(&format!("{NOTES}\n[requires]\nmosaikit = \"soon\"\n")).is_err());
        assert!(Manifest::from_toml(&format!("{NOTES}\n[requires]\napi = 0\n")).is_err());
    }

    #[test]
    fn deprecated_keys_still_work() {
        let m = Manifest::from_toml(&format!("abi = 1\nmin_kernel = \"1.3.0\"\n{NOTES}")).unwrap();
        assert_eq!(m.deprecations().len(), 2);
        assert!(m.check_compatible(Version(1, 3, 0)).is_ok());
        assert!(m.check_compatible(Version(1, 2, 9)).is_err());
        // `[requires]` wins over the old keys
        let both = format!("min_kernel = \"1.3.0\"\n{NOTES}\n[requires]\nmosaikit = \">=1.0\"\n");
        assert!(Manifest::from_toml(&both).unwrap().check_compatible(Version(1, 0, 0)).is_ok());
    }

    #[test]
    fn validation_errors() {
        let bad_id = NOTES.replace(r#"id = "com.mosaikit.notes""#, r#"id = "notes""#);
        assert!(Manifest::from_toml(&bad_id).is_err());
        let bad_version = NOTES.replace(r#"version = "0.3.0""#, r#"version = "1.0""#);
        assert!(Manifest::from_toml(&bad_version).is_err());
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
    fn extension_tabs_and_hidden_fields() {
        let tabs = r#"
            [ui]
            entry = "index.html"
            [[extension.tabs]]
            resource = "notes"
            key = "review"
            label = "Review"
            icon = "clipboard-check"
            page = "tab.html"
            [[extension.fields]]
            resource = "notes"
            key = "history"
            label = "History"
            kind = "text"
            hidden = true
        "#;
        let src = REVIEW.replace("[i18n.it]", &format!("{tabs}\n[i18n.it]")).replace(
            "actions = { mark_reviewed = \"Segna come revisionata\" } }",
            "actions = { mark_reviewed = \"Segna come revisionata\" }, tabs = { review = \"Revisione\" } }",
        );
        let m = Manifest::from_toml(&src).unwrap();
        assert_eq!(m.extension.tabs.len(), 1);
        assert_eq!(m.extension.tabs[0].page.as_deref(), Some("tab.html"));
        assert_eq!(m.localized("it").extension.tabs[0].label, "Revisione");
        let fields = m.extension.fields_of("notes");
        assert!(fields.iter().find(|f| f.key == "history").unwrap().hidden, "a hidden field stays hidden");
        assert!(!fields.iter().find(|f| f.key == "reviewed").unwrap().hidden);
        let json = serde_json::to_string(&m).unwrap();
        assert_eq!(serde_json::from_str::<Manifest>(&json).unwrap(), m);
        // an extension with only a tab is not empty
        assert!(!ExtensionDecl { tabs: m.extension.tabs.clone(), ..Default::default() }.is_empty());
        for bad in [
            src.replace("key = \"review\"", "key = \"Review!\""),
            src.replace("label = \"Review\"", "label = \"\""),
            src.replace("icon = \"clipboard-check\"", "icon = \"Clipboard\""),
            src.replace("page = \"tab.html\"", "page = \"../notes/index.html\""),
            src.replace("page = \"tab.html\"", "page = \"tab.js\""),
            src.replace("[ui]\n            entry = \"index.html\"", ""),
            src.replace("tabs = { review", "tabs = { other"),
            src.replace(
                "page = \"tab.html\"",
                "page = \"tab.html\"\n[[extension.tabs]]\nresource = \"notes\"\nkey = \"review\"\nlabel = \"Again\"",
            ),
        ] {
            assert!(Manifest::from_toml(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn service_keys() {
        let keys = r#"
            [[service_keys]]
            id = "translator"
            label = "Translation service"
            description = "Translation of the notes"
            scopes = ["platform", "tenant"]
            [[service_keys]]
            id = "local-model"
            label = "Self-hosted model"
            address = true
            [i18n.it]
            service_keys = { translator = { label = "Servizio di traduzione" } }
        "#;
        let m = Manifest::from_toml(&format!("{NOTES}{keys}")).unwrap();
        assert_eq!(m.service_keys.len(), 2);
        assert_eq!(m.service_keys[0].scopes, vec![KeyScope::Platform, KeyScope::Tenant]);
        assert_eq!(m.service_keys[1].scopes.len(), 3, "everywhere by default");
        assert!(m.service_keys[1].address);
        let it = m.localized("it");
        assert_eq!(it.service_keys[0].label, "Servizio di traduzione");
        assert_eq!(
            it.service_keys[0].description, "Translation of the notes",
            "English where not translated"
        );
        let plain = serde_json::to_string(&Manifest::from_toml(NOTES).unwrap()).unwrap();
        assert!(!plain.contains("service_keys"), "nothing new when absent");
        for bad in [
            "[[service_keys]]
id = \"Bad Id\"
label = \"x\"
",
            "[[service_keys]]
id = \"a\"
label = \" \"
",
            "[[service_keys]]
id = \"a\"
label = \"x\"
[[service_keys]]
id = \"a\"
label = \"y\"
",
            "[[service_keys]]
id = \"a\"
label = \"x\"
scopes = []
",
            "[[service_keys]]
id = \"a\"
label = \"x\"
scopes = [\"tenant\", \"tenant\"]
",
            "[[service_keys]]
id = \"a\"
label = \"x\"
[i18n.it]
service_keys = { b = { label = \"y\" } }
",
        ] {
            assert!(Manifest::from_toml(&format!("{NOTES}{bad}")).is_err(), "{bad}");
        }
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

    const NAV: &str = r#"
        [ui]
        [[nav]]
        id = "all"
        label = "All notes"
        icon = "notebook"
        [[nav]]
        id = "mine"
        label = "Mine"
        place = "mine"
        [[nav]]
        id = "tags"
        label = "By tag"
        [[nav]]
        id = "tag_a"
        label = "Tag A"
        parent = "tags"
        permission = "use"
        [i18n.it]
        [i18n.it.nav]
        all = "Tutte le note"
    "#;

    #[test]
    fn navigation_tree() {
        let m = Manifest::from_toml(&format!("{NOTES}{NAV}")).unwrap();
        assert_eq!(m.nav.len(), 4);
        let tags = m.nav.iter().find(|n| n.id == "tags").unwrap();
        assert_eq!(tags.target(true), None, "a group without a place opens nothing");
        assert_eq!(m.nav[0].target(false).as_deref(), Some("all"), "a leaf opens its id");
        assert_eq!(m.localized("it").nav[0].label, "Tutte le note");
        for bad in [
            NAV.replace("parent = \"tags\"", "parent = \"missing\""),
            NAV.replace("id = \"mine\"", "id = \"all\""),
            NAV.replace("place = \"mine\"", "place = \"a/b\""),
            NAV.replace("permission = \"use\"", "permission = \"fly\""),
            NAV.replace("icon = \"notebook\"", "icon = \"Not An Icon\""),
            NAV.replace("all = \"Tutte le note\"", "nope = \"x\""),
            NAV.replace("[ui]", ""),
            format!(
                "{NAV}[[nav]]
id = \"deep\"
label = \"Deep\"
parent = \"tag_a\"
"
            ),
        ] {
            assert!(Manifest::from_toml(&format!("{NOTES}{bad}")).is_err(), "accepted: {bad}");
        }
    }

    #[test]
    fn a_layout_has_only_layout_files() {
        let layout = r#"
            id = "com.example.layout-wide"
            name = "Wide"
            version = "1.0.0"
            kind = "layout"
            [contribution]
            icon = "L"
            label = "Wide"
        "#;
        let m = Manifest::from_toml(layout).unwrap();
        assert_eq!(m.effective_kind(), PluginKind::Layout);
        assert!(
            Manifest::from_toml(&format!(
                "{layout}[ui]
"
            ))
            .is_err(),
            "no [ui]"
        );
        assert!(Manifest::from_toml(&format!(
            "{layout}[[resources]]
name = \"x\"
fields = [{{ key = \"a\", label = \"A\", kind = \"text\" }}]
"
        ))
        .is_err());
    }
}
