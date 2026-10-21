//! Configurazione: `mosaikit.toml` + variabili d'ambiente `MOSAIKIT_*`.
//!
//! Basta un solo indirizzo, `url` (con eventuale percorso base, es.
//! `http://127.0.0.1:8080/mosaikit`). Gli altri si ricavano da questo:
//! - `plugin_url`: UI dei plugin, contenuti caricati e link pubblici. Deve essere
//!   un'**origine diversa** dall'app (sicurezza): default stessa base sulla porta successiva;
//! - `listen` / `plugin_listen`: indirizzi di ascolto, dalla porta degli URL.
//!
//! Dietro un reverse proxy si impostano a mano `plugin_url` (es. un secondo
//! hostname) e `listen`/`plugin_listen` (le porte interne).

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::{Error, Result};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    /// indirizzo pubblico dell'app, con eventuale percorso base
    #[serde(default = "d_url")]
    pub url: String,
    /// indirizzo di UI dei plugin, contenuti e link pubblici (default: porta successiva)
    #[serde(default, rename = "plugin_url")]
    pub plugin_url_setting: Option<String>,
    /// indirizzo di ascolto dell'app (default: dalla porta di `url`)
    #[serde(default)]
    pub listen: Option<String>,
    /// indirizzo di ascolto di plugin e contenuti (default: dalla porta di `plugin_url`)
    #[serde(default)]
    pub plugin_listen: Option<String>,
    #[serde(default = "d_data_dir")]
    pub data_dir: PathBuf,
    /// cartella del branding (brand.toml, logo, favicon, icona)
    #[serde(default)]
    pub brand: Option<PathBuf>,
    /// accetta pacchetti non firmati (solo sviluppo)
    #[serde(default)]
    pub allow_unsigned: bool,
    /// chiavi pubbliche ed25519 (base64) degli editori fidati
    #[serde(default)]
    pub trusted_keys: Vec<String>,
    /// catalogo dei plugin (registry/index.json)
    #[serde(default)]
    pub registry: Option<PathBuf>,
    /// installa e attiva all'avvio i plugin del catalogo non ancora installati
    #[serde(default)]
    pub preinstall: bool,
    #[serde(default = "d_session_hours")]
    pub session_ttl_hours: i64,
    /// al primo avvio crea anche questo tenant di lavoro con il Tenant Manager `utente` (desktop)
    #[serde(default)]
    pub initial_tenant: Option<String>,
    /// password di `admin` e `utente` creati al primo avvio (default: generate); desktop
    #[serde(default)]
    pub initial_password: Option<String>,
    /// secondo fattore (TOTP) obbligatorio per gli Administrator
    #[serde(default = "d_admin_totp")]
    pub admin_totp: bool,
    /// desktop: apre il browser sull'app all'avvio
    #[serde(default)]
    pub open_browser: bool,
    /// fidati dell'header X-Forwarded-For (solo dietro un reverse proxy)
    #[serde(default)]
    pub trust_proxy: bool,
    #[serde(default)]
    pub database: DatabaseConfig,
    #[serde(default)]
    pub dev: DevConfig,

    // ---- valori ricavati (non nel file)
    /// URL dell'app senza `/` finale
    #[serde(skip)]
    pub app_url: String,
    /// URL di plugin e contenuti senza `/` finale
    #[serde(skip)]
    pub plugin_url: String,
    /// URL dei link pubblici (= plugin_url)
    #[serde(skip)]
    pub public_url: String,
    #[serde(skip)]
    pub bind: String,
    #[serde(skip)]
    pub untrusted_bind: String,
    /// percorso base dell'app ("" oppure "/mosaikit")
    #[serde(skip)]
    pub base_path: String,
    /// percorso base di plugin e contenuti
    #[serde(skip)]
    pub plugin_base_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Sqlite,
    Postgres,
}

// Default scritti a mano: una sezione assente nel file usa `Default::default()`,
// che deve dare gli stessi valori dei `#[serde(default = ...)]` dei campi.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DatabaseConfig {
    /// "sqlite" o "postgres" (default: postgres se c'e' `url` o `embedded`, altrimenti sqlite)
    #[serde(default)]
    pub backend: Option<String>,
    /// SQLite: file del database (default `<data_dir>/mosaikit.db`)
    #[serde(default)]
    pub file: Option<PathBuf>,
    /// PostgreSQL: `postgres://utente:password@host:porta/database`
    #[serde(default)]
    pub url: Option<String>,
    /// PostgreSQL embedded in `<data_dir>/pg` (desktop)
    #[serde(default)]
    pub embedded: bool,
    /// cartella `bin` di PostgreSQL per la modalita' embedded (default: `pgsql/bin` accanto all'eseguibile)
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
    /// modalita' sviluppo: plugin letti dalle cartelle sorgente, hot reload
    #[serde(default)]
    pub enabled: bool,
    /// cartelle dei plugin in sviluppo
    #[serde(default)]
    pub plugins: Vec<PathBuf>,
    /// cartella `target` di cargo di riserva (di norma si usa quella del workspace del plugin)
    #[serde(default = "d_target")]
    pub target_dir: PathBuf,
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
        let mut c: Config = toml::from_str("").expect("config di default");
        c.derive().expect("derivazione della config di default");
        c
    }
}

/// Parti di un URL `schema://host[:porta][/percorso]`.
#[derive(Debug, Clone, PartialEq)]
pub struct UrlParts {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub explicit_port: bool,
    /// "" oppure "/base" (senza `/` finale)
    pub path: String,
}

pub fn parse_url(url: &str) -> Result<UrlParts> {
    let bad = || Error::bad(format!("URL non valido: {url} (atteso http(s)://host[:porta][/percorso])"));
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
        return Err(Error::bad(format!(
            "percorso base non valido in {url}: solo lettere, cifre, '-', '_', '.'"
        )));
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
    /// Ascolto di default: solo locale se l'host e' locale, altrimenti tutte le interfacce.
    fn default_listen(&self) -> String {
        let local = matches!(self.host.as_str(), "127.0.0.1" | "localhost" | "[::1]");
        if local {
            format!("127.0.0.1:{}", self.port)
        } else {
            format!("0.0.0.0:{}", self.port)
        }
    }
}

impl Config {
    /// Legge il file (se esiste), applica l'ambiente, risolve i percorsi relativi
    /// rispetto alla cartella del file (o a `base` se il file manca) e ricava gli indirizzi.
    pub fn load(path: Option<&Path>, base: &Path) -> Result<Config> {
        let (mut cfg, dir) = match path {
            Some(p) if p.is_file() => {
                let text =
                    std::fs::read_to_string(p).map_err(|e| Error::bad(format!("{}: {e}", p.display())))?;
                let cfg: Config =
                    toml::from_str(&text).map_err(|e| Error::bad(format!("{}: {e}", p.display())))?;
                (cfg, p.parent().map(Path::to_path_buf).unwrap_or_else(|| base.to_path_buf()))
            }
            Some(p) => {
                return Err(Error::bad(format!("file di configurazione non trovato: {}", p.display())))
            }
            None => (toml::from_str::<Config>("").expect("config vuota"), base.to_path_buf()),
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
                "MOSAIKIT_INITIAL_PASSWORD" => self.initial_password = Some(v).filter(|s| !s.is_empty()),
                "MOSAIKIT_INITIAL_TENANT" => self.initial_tenant = Some(v).filter(|s| !s.is_empty()),
                "MOSAIKIT_REGISTRY" => self.registry = Some(v.into()),
                "MOSAIKIT_TRUSTED_KEYS" => self
                    .trusted_keys
                    .extend(v.split(',').map(str::trim).filter(|s| !s.is_empty()).map(String::from)),
                // cartelle dei plugin di sviluppo (separate come nel PATH), usate da `cargo xtask dev`
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

    /// Ricava indirizzi, percorsi base e backend del database; valida.
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
                "url e plugin_url devono avere origini diverse (host o porta): le UI dei plugin non devono vedere l'app",
            ));
        }
        self.app_url = app.to_url();
        self.base_path = app.path.clone();
        self.plugin_url = plugin.to_url();
        self.plugin_base_path = plugin.path.clone();
        self.public_url = self.plugin_url.clone();
        self.bind = self.listen.clone().unwrap_or_else(|| app.default_listen());
        self.untrusted_bind = self.plugin_listen.clone().unwrap_or_else(|| plugin.default_listen());
        if self.bind == self.untrusted_bind {
            return Err(Error::bad("listen e plugin_listen devono essere indirizzi diversi"));
        }
        let kind = match self.database.backend.as_deref().map(str::to_ascii_lowercase).as_deref() {
            Some("sqlite") => Backend::Sqlite,
            Some("postgres" | "postgresql") => Backend::Postgres,
            Some(other) => {
                return Err(Error::bad(format!("database.backend sconosciuto: {other} (sqlite o postgres)")))
            }
            None if self.database.url.is_some() || self.database.embedded => Backend::Postgres,
            None => Backend::Sqlite,
        };
        if kind == Backend::Postgres && self.database.url.is_none() && !self.database.embedded {
            return Err(Error::bad(
                "PostgreSQL: imposta database.url (o MOSAIKIT_DATABASE_URL) oppure database.embedded = true",
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

    /// Cookie `Secure` quando l'app e' servita in HTTPS.
    pub fn cookie_secure(&self) -> bool {
        self.app_url.starts_with("https://")
    }

    pub fn plugin_origin(&self) -> String {
        origin_of(&self.plugin_url)
    }

    pub fn public_origin(&self) -> String {
        origin_of(&self.public_url)
    }

    pub fn app_origin(&self) -> String {
        origin_of(&self.app_url)
    }
}

fn truthy(v: &str) -> bool {
    matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "si" | "on")
}

/// `https://host:porta` di un URL.
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
    fn un_solo_url_basta() {
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
    fn dietro_un_proxy() {
        let c = cfg(r#"url = "https://gis.esempio.it/mosaikit"
               plugin_url = "https://plugins.esempio.it/mosaikit"
               listen = "0.0.0.0:8080"
               plugin_listen = "0.0.0.0:8081"
               [database]
               url = "postgres://x""#)
        .unwrap();
        assert_eq!(c.app_origin(), "https://gis.esempio.it");
        assert_eq!(c.plugin_origin(), "https://plugins.esempio.it");
        assert!(c.cookie_secure());
        assert_eq!(c.backend(), Backend::Postgres);
        // host pubblico: di default si ascolta su tutte le interfacce
        let c = cfg(r#"url = "http://server.lan:9000""#).unwrap();
        assert_eq!(c.bind, "0.0.0.0:9000");
    }

    #[test]
    fn errori() {
        assert!(cfg(r#"url = "ftp://x""#).is_err());
        assert!(
            cfg(r#"url = "http://a:8080"
                       plugin_url = "http://a:8080/plugins""#)
            .is_err(),
            "stessa origine"
        );
        assert!(cfg(r#"url = "http://a:8080/con spazio""#).is_err());
        assert!(cfg("[database]\nbackend = \"postgres\"").is_err(), "postgres senza url");
        assert!(cfg("[database]\nbackend = \"oracle\"").is_err());
    }

    #[test]
    fn ambiente() {
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
    fn sezioni_assenti_con_i_default_dei_campi() {
        // regressione: senza [database] il pool aveva 0 connessioni
        let c: Config = toml::from_str("data_dir = \"/data\"").unwrap();
        assert_eq!(c.database.max_connections, 20);
        assert_eq!(c.dev.target_dir, PathBuf::from("target"));
    }

    #[test]
    fn il_file_di_esempio_e_valido() {
        let text = include_str!("../../../mosaikit.example.toml");
        let mut c: Config = toml::from_str(text).expect("mosaikit.example.toml");
        c.derive().unwrap();
    }
}
