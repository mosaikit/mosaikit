//! Configuration: `mosaikit.toml` + environment variables `MOSAIKIT_*`.
//!
//! One address is enough, `url` (with an optional base path, e.g.
//! `http://127.0.0.1:8080/mosaikit`). The others are derived from it:
//! - `plugin_url`: UI of the plugins, uploaded contents and public links. It must be
//!   a **different origin** from the app (security): default same base on the next port;
//! - `listen` / `plugin_listen`: listening addresses, from the port of the URLs.
//!
//! Behind a reverse proxy `plugin_url` (e.g. a second hostname) and
//! `listen`/`plugin_listen` (the internal ports) are set by hand.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::{Error, Result};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// public address of the app, with an optional base path
    #[serde(default = "d_url")]
    pub url: String,
    /// address of plugin UIs, contents and public links (default: next port)
    #[serde(default, rename = "plugin_url")]
    pub plugin_url_setting: Option<String>,
    /// listening address of the app (default: from the port of `url`)
    #[serde(default)]
    pub listen: Option<String>,
    /// listening address of plugins and contents (default: from the port of `plugin_url`)
    #[serde(default)]
    pub plugin_listen: Option<String>,
    #[serde(default = "d_data_dir")]
    pub data_dir: PathBuf,
    /// branding folder (brand.toml, logo, favicon, icon)
    #[serde(default)]
    pub brand: Option<PathBuf>,
    /// accepts unsigned packages (development only)
    #[serde(default)]
    pub allow_unsigned: bool,
    /// ed25519 public keys (base64) of the trusted publishers
    #[serde(default)]
    pub trusted_keys: Vec<String>,
    /// catalog of the plugins (registry/index.json)
    #[serde(default)]
    pub registry: Option<PathBuf>,
    /// installs and turns on at start the plugins of the catalog not installed yet
    #[serde(default)]
    pub preinstall: bool,
    #[serde(default = "d_session_hours")]
    pub session_ttl_hours: i64,
    /// key (32 bytes, base64) that encrypts the keys of outside services; default: the file
    /// `secret.key` in `data_dir`, created at the first start
    #[serde(default)]
    pub secret_key: Option<String>,
    /// at the first start also creates this work tenant with the Tenant Manager `user` (desktop)
    #[serde(default)]
    pub initial_tenant: Option<String>,
    /// password of `admin` and `user` created at the first start (default: generated); desktop
    #[serde(default)]
    pub initial_password: Option<String>,
    /// second factor (TOTP) required for Administrators
    #[serde(default = "d_admin_totp")]
    pub admin_totp: bool,
    /// desktop: opens the browser on the app at start
    #[serde(default)]
    pub open_browser: bool,
    /// trust the X-Forwarded-For header (only behind a reverse proxy)
    #[serde(default)]
    pub trust_proxy: bool,
    #[serde(default)]
    pub database: DatabaseConfig,
    #[serde(default)]
    pub dev: DevConfig,
    /// limits on the archives an Administrator imports or restores (exports of tenants, backups)
    #[serde(default)]
    pub archives: ArchiveLimits,

    /// no background work (queue of the emails, digest, retention): the tests run it by hand
    #[serde(skip)]
    pub no_background: bool,

    // ---- derived values (not in the file)
    /// URL of the app without trailing `/`
    #[serde(skip)]
    pub app_url: String,
    /// URL of plugins and contents without trailing `/`
    #[serde(skip)]
    pub plugin_url: String,
    /// URL of the public links and contents (= plugin_url; with a wildcard, the host `public.…`)
    #[serde(skip)]
    pub public_url: String,
    /// `plugin_url` has a wildcard host (`https://*.plugins.example.org`): every plugin UI has an
    /// origin of its own (`<plugin>.plugins.example.org`), contents and public links `public.…`
    #[serde(skip)]
    pub plugin_wildcard: bool,
    #[serde(skip)]
    pub bind: String,
    #[serde(skip)]
    pub untrusted_bind: String,
    /// base path of the app ("" or "/mosaikit")
    #[serde(skip)]
    pub base_path: String,
    /// base path of plugins and contents
    #[serde(skip)]
    pub plugin_base_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Sqlite,
    Postgres,
}

// Defaults written by hand: a section missing from the file uses `Default::default()`,
// which must give the same values as the `#[serde(default = ...)]` of the fields.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DatabaseConfig {
    /// "sqlite" or "postgres" (default: postgres if there is `url` or `embedded`, otherwise sqlite)
    #[serde(default)]
    pub backend: Option<String>,
    /// SQLite: database file (default `<data_dir>/mosaikit.db`)
    #[serde(default)]
    pub file: Option<PathBuf>,
    /// PostgreSQL: `postgres://user:password@host:port/database`
    #[serde(default)]
    pub url: Option<String>,
    /// PostgreSQL embedded in `<data_dir>/pg` (desktop)
    #[serde(default)]
    pub embedded: bool,
    /// PostgreSQL `bin` folder for the embedded mode (default: `pgsql/bin` next to the executable)
    #[serde(default)]
    pub pg_bin: Option<PathBuf>,
    #[serde(default)]
    pub embedded_port: Option<u16>,
    #[serde(default = "d_max_conn")]
    pub max_connections: u32,
    #[serde(skip)]
    pub kind: Option<Backend>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DevConfig {
    /// development mode: plugins read from the source folders, hot reload
    #[serde(default)]
    pub enabled: bool,
    /// folders of the plugins in development
    #[serde(default)]
    pub plugins: Vec<PathBuf>,
    /// fallback cargo `target` folder (normally the one of the plugin's workspace is used)
    #[serde(default = "d_target")]
    pub target_dir: PathBuf,
}

/// Limits on what an archive (export of a tenant, backup) may unpack when it is imported or restored:
/// the sizes declared in a zip can lie, so they are also counted while reading.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveLimits {
    /// total of the unpacked bytes, in MB (default 51200, 50 GB)
    #[serde(default = "d_archive_mb")]
    pub max_unpacked_mb: u64,
    /// number of entries (default 1,000,000)
    #[serde(default = "d_archive_entries")]
    pub max_entries: u64,
    /// one table of data (JSON) read into memory, in MB (default 1024)
    #[serde(default = "d_archive_json_mb")]
    pub max_json_mb: u64,
}

impl Default for ArchiveLimits {
    fn default() -> ArchiveLimits {
        ArchiveLimits {
            max_unpacked_mb: d_archive_mb(),
            max_entries: d_archive_entries(),
            max_json_mb: d_archive_json_mb(),
        }
    }
}

fn d_archive_mb() -> u64 {
    51_200
}
fn d_archive_entries() -> u64 {
    1_000_000
}
fn d_archive_json_mb() -> u64 {
    1024
}

impl Default for DatabaseConfig {
    fn default() -> DatabaseConfig {
        DatabaseConfig {
            backend: None,
            file: None,
            url: None,
            embedded: false,
            pg_bin: None,
            embedded_port: None,
            max_connections: d_max_conn(),
            kind: None,
        }
    }
}

impl Default for DevConfig {
    fn default() -> DevConfig {
        DevConfig { enabled: false, plugins: Vec::new(), target_dir: d_target() }
    }
}

fn d_url() -> String {
    "http://127.0.0.1:8080".into()
}
fn d_data_dir() -> PathBuf {
    "data".into()
}
fn d_session_hours() -> i64 {
    12
}
fn d_admin_totp() -> bool {
    true
}
fn d_max_conn() -> u32 {
    20
}
fn d_target() -> PathBuf {
    "target".into()
}

impl Default for Config {
    fn default() -> Config {
        let mut c: Config = toml::from_str("").expect("default config");
        c.derive().expect("derivation of the default config");
        c
    }
}

/// Parts of a URL `scheme://host[:port][/path]`.
#[derive(Debug, Clone, PartialEq)]
pub struct UrlParts {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub explicit_port: bool,
    /// "" or "/base" (without trailing `/`)
    pub path: String,
}

pub fn parse_url(url: &str) -> Result<UrlParts> {
    let bad = || Error::bad(format!("invalid URL: {url} (expected http(s)://host[:port][/path])"));
    let (scheme, rest) = url.split_once("://").ok_or_else(bad)?;
    if scheme != "http" && scheme != "https" {
        return Err(bad());
    }
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    if hostport.is_empty() || path.contains(['?', '#']) {
        return Err(bad());
    }
    let (host, port) = if let Some(h) = hostport.strip_prefix('[') {
        let (h, after) = h.split_once(']').ok_or_else(bad)?;
        (format!("[{h}]"), after.strip_prefix(':'))
    } else {
        match hostport.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), Some(p)),
            None => (hostport.to_string(), None),
        }
    };
    let default = if scheme == "https" { 443 } else { 80 };
    let (port, explicit) = match port {
        Some(p) => (p.parse::<u16>().map_err(|_| bad())?, true),
        None => (default, false),
    };
    let path = path.trim_end_matches('/').to_string();
    if !path.is_empty()
        && !path
            .split('/')
            .skip(1)
            .all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.~".contains(c)))
    {
        return Err(Error::bad(format!("invalid base path in {url}: only letters, digits, '-', '_', '.'")));
    }
    Ok(UrlParts { scheme: scheme.into(), host, port, explicit_port: explicit, path })
}

impl UrlParts {
    pub fn origin(&self) -> String {
        let default = if self.scheme == "https" { 443 } else { 80 };
        if self.port == default {
            format!("{}://{}", self.scheme, self.host)
        } else {
            format!("{}://{}:{}", self.scheme, self.host, self.port)
        }
    }
    pub fn to_url(&self) -> String {
        format!("{}{}", self.origin(), self.path)
    }
    /// Default listening: local only if the host is local, otherwise every interface.
    fn default_listen(&self) -> String {
        let local = matches!(self.host.as_str(), "127.0.0.1" | "localhost" | "[::1]")
            || self.host.ends_with(".localhost");
        if local {
            format!("127.0.0.1:{}", self.port)
        } else {
            format!("0.0.0.0:{}", self.port)
        }
    }
}

impl Config {
    /// Reads the file (if it exists), applies the environment, resolves relative paths
    /// against the folder of the file (or `base` if the file is missing) and derives the addresses.
    pub fn load(path: Option<&Path>, base: &Path) -> Result<Config> {
        let (mut cfg, dir) = match path {
            Some(p) if p.is_file() => {
                let text =
                    std::fs::read_to_string(p).map_err(|e| Error::bad(format!("{}: {e}", p.display())))?;
                let cfg: Config =
                    toml::from_str(&text).map_err(|e| Error::bad(format!("{}: {e}", p.display())))?;
                (cfg, p.parent().map(Path::to_path_buf).unwrap_or_else(|| base.to_path_buf()))
            }
            Some(p) => return Err(Error::bad(format!("configuration file not found: {}", p.display()))),
            None => (toml::from_str::<Config>("").expect("empty config"), base.to_path_buf()),
        };
        cfg.apply_env(std::env::vars());
        cfg.resolve(&dir);
        cfg.derive()?;
        Ok(cfg)
    }

    pub fn apply_env(&mut self, vars: impl Iterator<Item = (String, String)>) {
        for (k, v) in vars {
            match k.as_str() {
                "MOSAIKIT_URL" => self.url = v,
                "MOSAIKIT_PLUGIN_URL" => self.plugin_url_setting = Some(v),
                "MOSAIKIT_LISTEN" => self.listen = Some(v),
                "MOSAIKIT_PLUGIN_LISTEN" => self.plugin_listen = Some(v),
                "MOSAIKIT_DATA_DIR" => self.data_dir = v.into(),
                "MOSAIKIT_BRAND" => self.brand = Some(v.into()),
                "MOSAIKIT_DATABASE" => self.database.backend = Some(v),
                "MOSAIKIT_DATABASE_URL" | "DATABASE_URL" => self.database.url = Some(v),
                "MOSAIKIT_ALLOW_UNSIGNED" => self.allow_unsigned = truthy(&v),
                "MOSAIKIT_PREINSTALL" => self.preinstall = truthy(&v),
                "MOSAIKIT_TRUST_PROXY" => self.trust_proxy = truthy(&v),
                "MOSAIKIT_OPEN_BROWSER" => self.open_browser = truthy(&v),
                "MOSAIKIT_ADMIN_TOTP" => self.admin_totp = truthy(&v),
                "MOSAIKIT_SECRET_KEY" => self.secret_key = Some(v).filter(|s| !s.is_empty()),
                "MOSAIKIT_INITIAL_PASSWORD" => self.initial_password = Some(v).filter(|s| !s.is_empty()),
                "MOSAIKIT_INITIAL_TENANT" => self.initial_tenant = Some(v).filter(|s| !s.is_empty()),
                "MOSAIKIT_REGISTRY" => self.registry = Some(v.into()),
                "MOSAIKIT_TRUSTED_KEYS" => self
                    .trusted_keys
                    .extend(v.split(',').map(str::trim).filter(|s| !s.is_empty()).map(String::from)),
                // folders of the development plugins (separated as in PATH), used by `cargo xtask dev`
                "MOSAIKIT_DEV_PLUGINS" => {
                    self.dev.plugins.extend(std::env::split_paths(&v).filter(|p| !p.as_os_str().is_empty()))
                }
                _ => {}
            }
        }
    }

    fn resolve(&mut self, dir: &Path) {
        let abs = |p: &mut PathBuf| {
            if p.is_relative() {
                *p = dir.join(&*p);
            }
        };
        abs(&mut self.data_dir);
        for p in [&mut self.registry, &mut self.brand, &mut self.database.pg_bin, &mut self.database.file]
            .into_iter()
            .flatten()
        {
            abs(p);
        }
        abs(&mut self.dev.target_dir);
        for p in &mut self.dev.plugins {
            abs(p);
        }
    }

    /// Derives addresses, base paths and database backend; validates.
    pub fn derive(&mut self) -> Result<()> {
        let app = parse_url(self.url.trim())?;
        let plugin = match &self.plugin_url_setting {
            Some(u) => parse_url(u.trim())?,
            None => UrlParts {
                port: app.port.checked_add(1).unwrap_or(app.port),
                explicit_port: true,
                ..app.clone()
            },
        };
        if app.origin() == plugin.origin() {
            return Err(Error::bad(
                "url and plugin_url must have different origins (host or port): the plugin UIs must not see the app",
            ));
        }
        self.app_url = app.to_url();
        self.base_path = app.path.clone();
        self.plugin_url = plugin.to_url();
        self.plugin_base_path = plugin.path.clone();
        self.plugin_wildcard = plugin.host.starts_with("*.");
        let rest = plugin.host.strip_prefix("*.").unwrap_or(&plugin.host);
        if rest.contains('*') || rest.is_empty() {
            return Err(Error::bad("plugin_url: only one wildcard, as the first label of the host (https://*.plugins.example.org)"));
        }
        self.public_url = if self.plugin_wildcard {
            self.plugin_url.replacen('*', PUBLIC_LABEL, 1)
        } else {
            self.plugin_url.clone()
        };
        self.bind = self.listen.clone().unwrap_or_else(|| app.default_listen());
        self.untrusted_bind = self.plugin_listen.clone().unwrap_or_else(|| plugin.default_listen());
        if self.bind == self.untrusted_bind {
            return Err(Error::bad("listen and plugin_listen must be different addresses"));
        }
        let kind = match self.database.backend.as_deref().map(str::to_ascii_lowercase).as_deref() {
            Some("sqlite") => Backend::Sqlite,
            Some("postgres" | "postgresql") => Backend::Postgres,
            Some(other) => {
                return Err(Error::bad(format!("unknown database.backend: {other} (sqlite or postgres)")))
            }
            None if self.database.url.is_some() || self.database.embedded => Backend::Postgres,
            None => Backend::Sqlite,
        };
        if kind == Backend::Postgres && self.database.url.is_none() && !self.database.embedded {
            return Err(Error::bad(
                "PostgreSQL: set database.url (or MOSAIKIT_DATABASE_URL) or database.embedded = true",
            ));
        }
        self.database.kind = Some(kind);
        Ok(())
    }

    pub fn backend(&self) -> Backend {
        self.database.kind.unwrap_or(Backend::Sqlite)
    }

    pub fn sqlite_file(&self) -> PathBuf {
        self.database.file.clone().unwrap_or_else(|| self.data_dir.join("mosaikit.db"))
    }

    /// `Secure` cookies when the app is served over HTTPS.
    pub fn cookie_secure(&self) -> bool {
        self.app_url.starts_with("https://")
    }

    /// The origin of the plugins as a CSP source: with a wildcard `https://*.plugins.example.org`,
    /// which every plugin origin matches.
    pub fn plugin_origin(&self) -> String {
        origin_of(&self.plugin_url)
    }

    /// The address of the UI of one plugin (its own host with a wildcard `plugin_url`).
    pub fn plugin_url_for(&self, plugin: &str) -> String {
        if self.plugin_wildcard {
            self.plugin_url.replacen('*', &plugin_label(plugin), 1)
        } else {
            self.plugin_url.clone()
        }
    }

    /// The exact origin of the UI of one plugin.
    pub fn plugin_origin_for(&self, plugin: &str) -> String {
        origin_of(&self.plugin_url_for(plugin))
    }

    /// Whether a request to the address of the plugins came on the host it belongs to: the UI of a
    /// plugin only on its own host, contents and public links only on the public host. Always true
    /// without a wildcard (one origin for everything).
    pub fn untrusted_host_ok(&self, host: Option<&str>, plugin: Option<&str>) -> bool {
        if !self.plugin_wildcard {
            return true;
        }
        let want = match plugin {
            Some(p) => self.plugin_url_for(p),
            None => self.public_url.clone(),
        };
        let want = origin_of(&want);
        let want = want.split_once("://").map(|(_, h)| h).unwrap_or(&want);
        host.is_some_and(|h| h.eq_ignore_ascii_case(want))
    }

    pub fn public_origin(&self) -> String {
        origin_of(&self.public_url)
    }

    pub fn app_origin(&self) -> String {
        origin_of(&self.app_url)
    }

    /// The origins allowed to embed the plugin UIs: the one of the app and, in development, the other
    /// ways the same computer is reached (`localhost` and `127.0.0.1`) on the port of the app and on
    /// the port of the server itself (the app can be opened from Vite or from the server).
    pub fn app_origins(&self) -> Vec<String> {
        let mut list = vec![self.app_origin()];
        if self.dev.enabled {
            let mut ports = vec![self.app_origin()];
            if let Some(listen) = &self.listen {
                ports.push(format!("http://{listen}"));
            }
            for o in ports {
                let Some((scheme, rest)) = o.split_once("://") else { continue };
                let Some((host, port)) = rest.rsplit_once(':') else { continue };
                if host == "localhost" || host == "127.0.0.1" {
                    for h in ["localhost", "127.0.0.1"] {
                        let v = format!("{scheme}://{h}:{port}");
                        if !list.contains(&v) {
                            list.push(v);
                        }
                    }
                }
            }
        }
        list
    }
}

fn truthy(v: &str) -> bool {
    matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "si" | "on")
}

/// `https://host:port` of a URL.
/// The first label of the host of the public links and contents with a wildcard `plugin_url`.
pub const PUBLIC_LABEL: &str = "public";

/// The DNS label of a plugin: its id with `.` and `_` as `-`, lower case (`com.mosaikit.notes` →
/// `com-mosaikit-notes`); over 63 characters, shortened with a hash so that it stays unique.
pub fn plugin_label(id: &str) -> String {
    let label: String =
        id.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    if label.len() <= 63 {
        return label;
    }
    use sha2::Digest;
    let hash = hex::encode(&sha2::Sha256::digest(id.as_bytes())[..6]);
    format!("{}-{hash}", &label[..50])
}

pub fn origin_of(url: &str) -> String {
    let (scheme, rest) = url.split_once("://").unwrap_or(("http", url));
    let host = rest.split('/').next().unwrap_or_default();
    format!("{scheme}://{host}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(toml: &str) -> Result<Config> {
        let mut c: Config = toml::from_str(toml).map_err(|e| Error::bad(e.to_string()))?;
        c.derive()?;
        Ok(c)
    }

    #[test]
    fn a_single_url_is_enough() {
        let c = cfg(r#"url = "http://127.0.0.1:8080/mosaikit""#).unwrap();
        assert_eq!(c.app_url, "http://127.0.0.1:8080/mosaikit");
        assert_eq!(c.base_path, "/mosaikit");
        assert_eq!(c.plugin_url, "http://127.0.0.1:8081/mosaikit");
        assert_eq!(c.plugin_base_path, "/mosaikit");
        assert_eq!(c.bind, "127.0.0.1:8080");
        assert_eq!(c.untrusted_bind, "127.0.0.1:8081");
        assert_eq!(c.backend(), Backend::Sqlite);
        let d = Config::default();
        assert_eq!((d.app_url.as_str(), d.base_path.as_str()), ("http://127.0.0.1:8080", ""));
    }

    #[test]
    fn behind_a_proxy() {
        let c = cfg(r#"url = "https://gis.example.com/mosaikit"
               plugin_url = "https://plugins.example.com/mosaikit"
               listen = "0.0.0.0:8080"
               plugin_listen = "0.0.0.0:8081"
               [database]
               url = "postgres://x""#)
        .unwrap();
        assert_eq!(c.app_origin(), "https://gis.example.com");
        assert_eq!(c.plugin_origin(), "https://plugins.example.com");
        assert!(c.cookie_secure());
        assert_eq!(c.backend(), Backend::Postgres);
        // public host: by default it listens on every interface
        let c = cfg(r#"url = "http://server.lan:9000""#).unwrap();
        assert_eq!(c.bind, "0.0.0.0:9000");
    }

    #[test]
    fn errors() {
        assert!(cfg(r#"url = "ftp://x""#).is_err());
        assert!(
            cfg(r#"url = "http://a:8080"
                       plugin_url = "http://a:8080/plugins""#)
            .is_err(),
            "same origin"
        );
        assert!(cfg(r#"url = "http://a:8080/with space""#).is_err());
        assert!(cfg("[database]\nbackend = \"postgres\"").is_err(), "postgres without url");
        assert!(cfg("[database]\nbackend = \"oracle\"").is_err());
    }

    #[test]
    fn environment() {
        let mut c: Config = toml::from_str("").unwrap();
        c.apply_env(
            vec![
                ("MOSAIKIT_DATABASE_URL".to_string(), "postgres://x".to_string()),
                ("MOSAIKIT_TRUSTED_KEYS".to_string(), "a, b".to_string()),
                ("MOSAIKIT_URL".to_string(), "http://127.0.0.1:9000/app".to_string()),
            ]
            .into_iter(),
        );
        c.derive().unwrap();
        assert_eq!(c.backend(), Backend::Postgres);
        assert_eq!(c.trusted_keys, vec!["a", "b"]);
        assert_eq!(c.plugin_url, "http://127.0.0.1:9001/app");
    }

    #[test]
    fn missing_sections_with_field_defaults() {
        // regression: without [database] the pool had 0 connections
        let c: Config = toml::from_str("data_dir = \"/data\"").unwrap();
        assert_eq!(c.database.max_connections, 20);
        assert_eq!(c.dev.target_dir, PathBuf::from("target"));
    }

    #[test]
    fn the_example_file_is_valid() {
        let text = include_str!("../../../mosaikit.example.toml");
        let mut c: Config = toml::from_str(text).expect("mosaikit.example.toml");
        c.derive().unwrap();
    }

    #[test]
    fn one_origin_per_plugin_with_a_wildcard() {
        let c = cfg(r#"
            url = "https://apps.example.org"
            plugin_url = "https://*.plugins.example.org"
            listen = "0.0.0.0:8080"
            plugin_listen = "0.0.0.0:8081"
        "#)
        .unwrap();
        assert!(c.plugin_wildcard);
        assert_eq!(c.plugin_origin(), "https://*.plugins.example.org", "a CSP source every plugin matches");
        assert_eq!(c.plugin_url_for("com.mosaikit.notes"), "https://com-mosaikit-notes.plugins.example.org");
        assert_eq!(
            c.plugin_origin_for("com.example.note_review"),
            "https://com-example-note-review.plugins.example.org"
        );
        assert_eq!(c.public_url, "https://public.plugins.example.org");
        assert!(
            c.untrusted_host_ok(Some("com-mosaikit-notes.plugins.example.org"), Some("com.mosaikit.notes"))
        );
        assert!(
            !c.untrusted_host_ok(Some("com-mosaikit-tasks.plugins.example.org"), Some("com.mosaikit.notes"))
        );
        assert!(!c.untrusted_host_ok(Some("public.plugins.example.org"), Some("com.mosaikit.notes")));
        assert!(c.untrusted_host_ok(Some("PUBLIC.plugins.example.org"), None));
        assert!(!c.untrusted_host_ok(Some("com-mosaikit-notes.plugins.example.org"), None));
        assert!(!c.untrusted_host_ok(None, None));
        // in development: *.localhost resolves to the computer itself
        let d = cfg(r#"
            url = "http://127.0.0.1:5173"
            plugin_url = "http://*.localhost:47081/mosaikit"
        "#)
        .unwrap();
        assert_eq!(d.plugin_url_for("x.y"), "http://x-y.localhost:47081/mosaikit");
        assert_eq!(d.untrusted_bind, "127.0.0.1:47081");
        assert!(d.untrusted_host_ok(Some("x-y.localhost:47081"), Some("x.y")));
        // the app opened from the server itself (localhost:47080) or from Vite (127.0.0.1:5173) may embed the UIs
        let dev = cfg(r#"
            url = "http://127.0.0.1:5173"
            plugin_url = "http://127.0.0.1:47081"
            listen = "127.0.0.1:47080"
            [dev]
            enabled = true
        "#)
        .unwrap();
        let origins = dev.app_origins();
        for o in [
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:47080",
            "http://localhost:47080",
        ] {
            assert!(origins.iter().any(|x| x == o), "{o} in {origins:?}");
        }
        // in production only the origin of the app
        assert_eq!(cfg("url = \"https://a.org\"").unwrap().app_origins(), vec!["https://a.org".to_string()]);
        // without a wildcard: one origin, every host
        let one = cfg(r#"
            url = "https://apps.example.org"
            plugin_url = "https://plugins.example.org"
            listen = "0.0.0.0:8080"
            plugin_listen = "0.0.0.0:8081"
        "#)
        .unwrap();
        assert_eq!(one.plugin_url_for("a.b"), "https://plugins.example.org");
        assert!(one.untrusted_host_ok(None, Some("a.b")));
        for bad in ["https://x.*.org", "https://*.*.org", "https://*"] {
            assert!(cfg(&format!("url = \"https://a.org\"\nplugin_url = \"{bad}\"")).is_err(), "{bad}");
        }
        assert_eq!(super::plugin_label(&"a.".repeat(40)).len(), 63);
    }
}
