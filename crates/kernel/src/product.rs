//! What a distribution sets in `distribution.toml` beyond the brand and the seeds (dev kit, phase 11):
//!
//! ```toml
//! [product]
//! base = ">=1.0, <2"            # the versions of the base the product release works with (checked at start)
//!
//! [defaults]                    # values of the settings of the platform, in place of the built-in defaults
//! "identity.welcome" = "Welcome"
//! "security.password_min" = 12
//!
//! [locked]                      # settings that neither the Administrator nor the tenants can change
//! keys = ["identity.name", "theme"]
//!
//! [languages]                   # sugar for the settings lang.enabled and lang.default
//! enabled = ["it", "en"]
//! default = "it"
//!
//! [bootstrap]                   # first start (the environment variables of the same meaning win)
//! tenant = "work"               # slug of the first tenant (MOSAIKIT_INITIAL_TENANT)
//! tenant_name = "Work"          # its name (default: the name of the product)
//! trial_days = 30               # optional trial period of that tenant
//! admin_email = "ops@example.com"
//!
//! [database]
//! extensions = ["postgis"]      # PostgreSQL extensions that must be installed (checked at start)
//!
//! [about]                       # shown in the About dialog and in the log
//! licence = "Proprietary"
//! text = "Support: support@example.com"
//! ```
//!
//! The file is the one of `plugin_settings_file` (`MOSAIKIT_PLUGIN_SETTINGS_FILE`), the same that carries the
//! seeds. Everything is optional; a mistake (an unknown setting, a value the setting refuses, a bad range) stops
//! the start with a message that names the key.

use mosaikit_mskp::{Version, VersionReq};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::{config::Config, Error, Result};

/// Version of the base (this kernel).
pub const BASE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Default, Deserialize)]
pub struct ProductSection {
    /// range of the versions of the base the product works with
    #[serde(default)]
    pub base: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct LockedSection {
    #[serde(default)]
    pub keys: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct LanguagesSection {
    #[serde(default)]
    pub enabled: Vec<String>,
    #[serde(default)]
    pub default: Option<String>,
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct Bootstrap {
    /// slug of the first tenant
    #[serde(default)]
    pub tenant: Option<String>,
    /// name of the first tenant (default: the name of the product)
    #[serde(default)]
    pub tenant_name: Option<String>,
    /// trial period of the first tenant, in days
    #[serde(default)]
    pub trial_days: Option<u32>,
    /// address of the Administrator
    #[serde(default)]
    pub admin_email: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct DatabaseSection {
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct About {
    #[serde(default)]
    pub licence: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
}

/// The checked policy of the product, kept by the kernel.
#[derive(Debug, Default, Clone)]
pub struct ProductPolicy {
    /// range of the versions of the base the product works with, as written
    pub base: Option<String>,
    /// name and version of the product, for the About dialog and the log
    pub name: Option<String>,
    pub version: Option<String>,
    /// values of the settings of the platform in place of the built-in defaults (key -> value)
    pub defaults: Map<String, Value>,
    /// keys of the settings nobody can change
    pub locked: Vec<String>,
    pub bootstrap: Bootstrap,
    /// PostgreSQL extensions that must be installed
    pub extensions: Vec<String>,
    pub about: About,
}

impl ProductPolicy {
    /// The policy of the seed file of the configuration; none without a file. A malformed file or a wrong
    /// entry stops the start.
    pub fn load(cfg: &Config) -> Result<ProductPolicy> {
        let Some(path) = &cfg.plugin_settings_file else { return Ok(ProductPolicy::default()) };
        let f = crate::seed::SeedFile::load(path)?;
        Self::from_seed(&f, BASE_VERSION)
    }

    /// Checks the entries of a seed file against the base `base_version`.
    pub fn from_seed(f: &crate::seed::SeedFile, base_version: &str) -> Result<ProductPolicy> {
        let mut p = ProductPolicy {
            base: f.product.base.clone(),
            name: f.product.name.clone(),
            version: f.product.version.clone(),
            bootstrap: f.bootstrap.clone(),
            extensions: f.database.extensions.clone(),
            about: f.about.clone(),
            ..Default::default()
        };
        // the range of the base
        if let Some(range) = &p.base {
            let req = VersionReq::parse(range).ok_or_else(|| {
                Error::bad(format!("distribution.toml [product] base = \"{range}\": not a range of versions (e.g. \">=1.0, <2\")"))
            })?;
            let v = Version::parse_lenient(base_version)
                .ok_or_else(|| Error::bad(format!("version of the base unreadable: {base_version}")))?;
            if !req.matches(v) {
                return Err(Error::bad(format!(
                    "this product works with Mosaikit {range} and this is {base_version}: use a base inside the range, or a release of the product built for this one"
                ))
                .with_code("product_base"));
            }
        }
        // defaults, checked against the settings
        for (key, v) in &f.defaults {
            let v = serde_json::to_value(v).map_err(|e| Error::bad(format!("[defaults] {key}: {e}")))?;
            crate::tenancy::levels::check_platform_default(key, &v)
                .map_err(|e| Error::bad(format!("distribution.toml [defaults] {key}: {}", e.message)))?;
            p.defaults.insert(key.clone(), v);
        }
        if !f.languages.enabled.is_empty() && !p.defaults.contains_key("lang.enabled") {
            let v = Value::from(f.languages.enabled.clone());
            crate::tenancy::levels::check_platform_default("lang.enabled", &v)
                .map_err(|e| Error::bad(format!("distribution.toml [languages] enabled: {}", e.message)))?;
            p.defaults.insert("lang.enabled".into(), v);
        }
        if let Some(d) = &f.languages.default {
            if !p.defaults.contains_key("lang.default") {
                let v = Value::from(d.clone());
                crate::tenancy::levels::check_platform_default("lang.default", &v).map_err(|e| {
                    Error::bad(format!("distribution.toml [languages] default: {}", e.message))
                })?;
                p.defaults.insert("lang.default".into(), v);
            }
        }
        for key in &f.locked.keys {
            if !crate::tenancy::levels::is_setting(key) {
                return Err(Error::bad(format!("distribution.toml [locked] keys: unknown setting {key}")));
            }
            if !p.locked.contains(key) {
                p.locked.push(key.clone());
            }
        }
        if let Some(t) = &f.bootstrap.tenant {
            if !crate::tenancy::valid_slug(&t.trim().to_lowercase()) {
                return Err(Error::bad(format!(
                    "distribution.toml [bootstrap] tenant = \"{t}\": lower case letters, digits and '-'"
                )));
            }
        }
        if let Some(e) = &f.bootstrap.admin_email {
            if !crate::notify::valid_email(e) {
                return Err(Error::bad(format!(
                    "distribution.toml [bootstrap] admin_email = \"{e}\": not an address"
                )));
            }
        }
        for x in &f.database.extensions {
            if x.is_empty()
                || !x.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
            {
                return Err(Error::bad(format!(
                    "distribution.toml [database] extensions: \"{x}\" is not an extension name"
                )));
            }
        }
        Ok(p)
    }

    pub fn is_locked(&self, key: &str) -> bool {
        self.locked.iter().any(|k| k == key)
    }
}

/// The extensions that are missing in the database (PostgreSQL only; SQLite has none).
pub async fn missing_extensions(db: &crate::Db, postgres: bool, wanted: &[String]) -> Result<Vec<String>> {
    if wanted.is_empty() || !postgres {
        return Ok(Vec::new());
    }
    let have: Vec<String> =
        mosaikit_db::query_scalar("select extname::text from pg_extension").fetch_all(db).await?;
    Ok(wanted.iter().filter(|w| !have.iter().any(|h| h == *w)).cloned().collect())
}

/// The text of the missing-extension error: names the extensions and says how to install them.
pub fn missing_message(missing: &[String]) -> String {
    format!(
        "the product needs the PostgreSQL extension{} {} and the database does not have {}: install {} in the database server (for example `create extension {};` as a superuser, or use a database image that has {})",
        if missing.len() == 1 { "" } else { "s" },
        missing.join(", "),
        if missing.len() == 1 { "it" } else { "them" },
        if missing.len() == 1 { "it" } else { "them" },
        missing[0],
        if missing.len() == 1 { "it" } else { "them" },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seed::SeedFile;

    fn load(text: &str, base: &str) -> Result<ProductPolicy> {
        let f: SeedFile = toml::from_str(text).unwrap();
        ProductPolicy::from_seed(&f, base)
    }

    #[test]
    fn an_empty_file_is_an_empty_policy() {
        let p = load("[product]\nid = \"x\"\nname = \"X\"\nversion = \"1\"\n", "1.0.0").unwrap();
        assert!(p.defaults.is_empty() && p.locked.is_empty() && p.base.is_none());
    }

    #[test]
    fn the_range_of_the_base_is_checked() {
        assert!(load("[product]\nbase = \">=1.0, <2\"\n", "1.4.2").is_ok());
        let e = load("[product]\nbase = \">=2.0\"\n", "1.4.2").unwrap_err();
        assert!(e.message.contains(">=2.0") && e.message.contains("1.4.2"), "{}", e.message);
        assert!(load("[product]\nbase = \"banana\"\n", "1.0.0").is_err());
    }

    #[test]
    fn defaults_and_languages_are_checked_against_the_settings() {
        let p = load("[defaults]\n\"security.password_min\" = 14\n[languages]\nenabled = [\"it\", \"en\"]\ndefault = \"it\"\n", "1.0.0").unwrap();
        assert_eq!(p.defaults["security.password_min"], 14);
        assert_eq!(p.defaults["lang.default"], "it");
        assert!(load("[defaults]\n\"no.such\" = 1\n", "1.0.0").unwrap_err().message.contains("no.such"));
        assert!(load("[defaults]\n\"security.password_min\" = \"many\"\n", "1.0.0").is_err());
    }

    #[test]
    fn locked_keys_must_be_settings() {
        let p = load("[locked]\nkeys = [\"theme\", \"identity.name\"]\n", "1.0.0").unwrap();
        assert!(p.is_locked("theme") && !p.is_locked("layout"));
        assert!(load("[locked]\nkeys = [\"nope\"]\n", "1.0.0").unwrap_err().message.contains("nope"));
    }

    #[test]
    fn bootstrap_and_database_entries_are_checked() {
        assert!(load("[bootstrap]\ntenant = \"Work Place\"\n", "1.0.0").is_err());
        assert!(load("[bootstrap]\nadmin_email = \"nope\"\n", "1.0.0").is_err());
        assert!(load("[database]\nextensions = [\"post gis\"]\n", "1.0.0").is_err());
        let p = load(
            "[bootstrap]\ntenant = \"work\"\ntrial_days = 30\n[database]\nextensions = [\"postgis\"]\n",
            "1.0.0",
        )
        .unwrap();
        assert_eq!(p.bootstrap.trial_days, Some(30));
        assert_eq!(p.extensions, ["postgis"]);
    }

    #[test]
    fn the_missing_extension_message_names_it() {
        let m = missing_message(&["postgis".to_string()]);
        assert!(m.contains("postgis") && m.contains("create extension"), "{m}");
    }
}
