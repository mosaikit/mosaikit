//! Seeding of plugin settings and platform service keys by a deployment (a distribution or any
//! installation): a TOML file named by `plugin_settings_file` (env `MOSAIKIT_PLUGIN_SETTINGS_FILE`)
//! with two kinds of tables,
//!
//! ```toml
//! [[plugin_settings]]          # a `[[config]]` setting of a plugin, secrets included
//! plugin = "com.example.translate"
//! key = "api_token"
//! value = "env:TRANSLATE_TOKEN"   # or "file:/run/secrets/token", or a literal
//!
//! [[service_key_values]]       # a platform key of a `[[service_keys]]` service
//! service = "translate"
//! value = "file:/run/secrets/translate"
//! shared = true                # optional: the tenants may use it (default: false)
//! ```
//!
//! A value `env:NAME` is read from the environment, `file:PATH` from a file (relative to the folder of
//! the seed file; a final line break is dropped), anything else is the value itself. Secrets should be
//! referenced, not written: the file is often kept in a repository.
//!
//! Every entry is applied once, only if the setting or key is still unset, and never overwrites what an
//! Administrator chose (a later removal is a choice too: a marker in `core.secrets`, empty and without
//! any value, remembers that an entry was handled). Secrets are stored exactly as the Administrator's
//! path does (encrypted). Values never go to the log. Other tables of the file are ignored, so a
//! `distribution.toml` can be used as it is.

use std::path::{Path, PathBuf};

use mosaikit_mskp::ConfigKind;
use serde::Deserialize;
use serde_json::Value;

use crate::{Error, Kernel, Result};

#[derive(Debug, Default, Deserialize)]
pub struct SeedFile {
    #[serde(default)]
    pub plugin_settings: Vec<PluginSetting>,
    #[serde(default)]
    pub service_key_values: Vec<ServiceKeyValue>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginSetting {
    pub plugin: String,
    pub key: String,
    pub value: toml::Value,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceKeyValue {
    pub service: String,
    pub value: String,
    #[serde(default)]
    pub shared: bool,
}

/// What came of one entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Applied,
    /// already handled before, or already set by someone
    Kept,
    /// cannot be applied now (unknown plugin or service, value not available): a warning was logged
    Skipped,
}

impl SeedFile {
    pub fn load(path: &Path) -> Result<SeedFile> {
        let text = std::fs::read_to_string(path)
            .map_err(|e| Error::bad(format!("plugin_settings_file {}: {e}", path.display())))?;
        let f: SeedFile = toml::from_str(&text)
            .map_err(|e| Error::bad(format!("plugin_settings_file {}: {e}", path.display())))?;
        for s in &f.plugin_settings {
            if s.plugin.trim().is_empty() || s.key.trim().is_empty() || s.key.contains(':') {
                return Err(Error::bad(format!(
                    "plugin_settings_file {}: a [[plugin_settings]] entry needs a plugin id and a key",
                    path.display()
                )));
            }
        }
        for s in &f.service_key_values {
            if s.service.trim().is_empty() {
                return Err(Error::bad(format!(
                    "plugin_settings_file {}: a [[service_key_values]] entry needs a service",
                    path.display()
                )));
            }
        }
        Ok(f)
    }
}

/// The value of an entry: `env:NAME`, `file:PATH` or the text itself. `Err` names what is missing, never
/// the value.
pub fn resolve(
    raw: &str,
    dir: &Path,
    env: &dyn Fn(&str) -> Option<String>,
) -> std::result::Result<String, String> {
    if let Some(name) = raw.strip_prefix("env:") {
        return env(name.trim())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| format!("environment variable {} is not set", name.trim()));
    }
    if let Some(p) = raw.strip_prefix("file:") {
        let path: PathBuf =
            if Path::new(p.trim()).is_relative() { dir.join(p.trim()) } else { p.trim().into() };
        let text =
            std::fs::read_to_string(&path).map_err(|_| format!("file {} cannot be read", path.display()))?;
        let text = text.trim_end_matches(['\r', '\n']).to_string();
        return if text.is_empty() { Err(format!("file {} is empty", path.display())) } else { Ok(text) };
    }
    Ok(raw.to_string())
}

fn marker(plugin: &str, key: &str) -> String {
    format!("plugin:{plugin}:seeded:{key}")
}

async fn marked(k: &Kernel, name: &str) -> Result<bool> {
    let n: Option<String> = mosaikit_db::query_scalar("select name from core.secrets where name = $1")
        .bind(name)
        .fetch_optional(&k.db)
        .await?;
    Ok(n.is_some())
}

async fn mark(k: &Kernel, name: &str) -> Result<()> {
    mosaikit_db::query(
        "insert into core.secrets (name, value) values ($1, $2) on conflict (name) do nothing",
    )
    .bind(name)
    .bind(Vec::<u8>::new())
    .execute(&k.db)
    .await?;
    Ok(())
}

/// Applies the seed file of the configuration (if any). A malformed file stops the start; an entry that
/// cannot be applied is a warning.
pub async fn apply(k: &Kernel) -> Result<()> {
    let Some(path) = &k.cfg.plugin_settings_file else { return Ok(()) };
    let f = SeedFile::load(path)?;
    let dir = path.parent().map(Path::to_path_buf).unwrap_or_default();
    apply_file(k, &f, &dir, &|n| std::env::var(n).ok()).await.map(|_| ())
}

pub async fn apply_file(
    k: &Kernel,
    f: &SeedFile,
    dir: &Path,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Vec<Outcome>> {
    let mut out = Vec::new();
    for s in &f.plugin_settings {
        let r = plugin_setting(k, s, dir, env).await?;
        if r == Outcome::Applied {
            tracing::info!("seeded the setting {} of {}", s.key, s.plugin);
        }
        out.push(r);
    }
    for s in &f.service_key_values {
        let r = service_key(k, s, dir, env).await?;
        if r == Outcome::Applied {
            tracing::info!("seeded the platform key of the service {}", s.service);
        }
        out.push(r);
    }
    Ok(out)
}

async fn plugin_setting(
    k: &Kernel,
    s: &PluginSetting,
    dir: &Path,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Outcome> {
    let name = marker(&s.plugin, &s.key);
    if marked(k, &name).await? {
        return Ok(Outcome::Kept);
    }
    let Some(p) = k.plugins.get(&s.plugin) else {
        tracing::warn!("seed: plugin {} is not installed, setting {} not applied", s.plugin, s.key);
        return Ok(Outcome::Skipped);
    };
    let Some(d) = p.manifest.config.iter().find(|d| d.key == s.key) else {
        tracing::warn!("seed: plugin {} declares no setting {}", s.plugin, s.key);
        return Ok(Outcome::Skipped);
    };
    let secret = d.kind == ConfigKind::Secret;
    // strings may be references; other TOML values (numbers, booleans) are taken as they are
    let value: Value = match &s.value {
        toml::Value::String(raw) => match resolve(raw, dir, env) {
            Ok(v) if d.kind == ConfigKind::Bool && v.trim() == "true" => Value::Bool(true),
            Ok(v) if d.kind == ConfigKind::Bool && v.trim() == "false" => Value::Bool(false),
            Ok(v) => Value::String(v),
            Err(why) => {
                tracing::warn!("seed: {} of {}: {why}, not applied", s.key, s.plugin);
                return Ok(Outcome::Skipped);
            }
        },
        other => serde_json::to_value(other).map_err(|e| Error::internal(e.to_string()))?,
    };
    let Some(value) = d.check(&value).filter(|v| !v.is_null()) else {
        tracing::warn!(
            "seed: the value for {} of {} is not valid for its kind, not applied",
            s.key,
            s.plugin
        );
        return Ok(Outcome::Skipped);
    };
    let unset = if secret {
        !crate::plugins::config::has_secret(k, &s.plugin, &s.key).await?
    } else {
        crate::plugins::config::stored_value(k, &s.plugin, &s.key).await?.is_none()
    };
    if !unset {
        mark(k, &name).await?;
        return Ok(Outcome::Kept);
    }
    if secret {
        let Value::String(v) = &value else { return Ok(Outcome::Skipped) };
        crate::plugins::config::put_secret(k, &s.plugin, &s.key, v).await?;
        if !matches!(&s.value, toml::Value::String(r) if r.starts_with("env:") || r.starts_with("file:")) {
            tracing::warn!(
                "seed: the secret {} of {} is written in the file: reference it with env: or file:",
                s.key,
                s.plugin
            );
        }
    } else {
        crate::plugins::config::put_value(k, &s.plugin, &s.key, value).await?;
    }
    mark(k, &name).await?;
    Ok(Outcome::Applied)
}

async fn service_key(
    k: &Kernel,
    s: &ServiceKeyValue,
    dir: &Path,
    env: &dyn Fn(&str) -> Option<String>,
) -> Result<Outcome> {
    use crate::tenancy::keys::{self, Level};
    let name = format!("seed:service:{}", s.service);
    if marked(k, &name).await? {
        return Ok(Outcome::Kept);
    }
    if !keys::services(k, "en").iter().any(|x| x.id == s.service) {
        tracing::warn!("seed: no installed plugin uses the service {}, key not applied", s.service);
        return Ok(Outcome::Skipped);
    }
    let value = match resolve(&s.value, dir, env) {
        Ok(v) => v,
        Err(why) => {
            tracing::warn!("seed: key of the service {}: {why}, not applied", s.service);
            return Ok(Outcome::Skipped);
        }
    };
    if keys::platform_key_exists(k, &s.service).await? {
        mark(k, &name).await?;
        return Ok(Outcome::Kept);
    }
    let admin: Option<uuid::Uuid> = mosaikit_db::query_scalar(
        "select id from core.users where is_system_admin order by created_at limit 1",
    )
    .fetch_optional(&k.db)
    .await?;
    let admin = admin.ok_or_else(|| Error::internal("no Administrator to attribute the seeded key to"))?;
    match keys::set_key(k, admin, Level::Platform, &s.service, Some(&value), Some(s.shared)).await {
        Ok(()) => {
            mark(k, &name).await?;
            Ok(Outcome::Applied)
        }
        Err(e) => {
            // the message of the kernel never contains the value
            tracing::warn!("seed: key of the service {}: {}, not applied", s.service, e.message);
            Ok(Outcome::Skipped)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn references() {
        let env = |n: &str| (n == "SEED_X").then(|| "from-env".to_string());
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("t"), "from-file\r\n").unwrap();
        assert_eq!(resolve("literal", dir.path(), &env).unwrap(), "literal");
        assert_eq!(resolve("env:SEED_X", dir.path(), &env).unwrap(), "from-env");
        assert_eq!(resolve("file:t", dir.path(), &env).unwrap(), "from-file");
        assert!(resolve("env:NOPE", dir.path(), &env).unwrap_err().contains("NOPE"));
        assert!(resolve("file:missing", dir.path(), &env).is_err());
    }

    #[test]
    fn the_file_is_checked() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("s.toml");
        std::fs::write(&f, "[product]\nid='x'\n[[plugin_settings]]\nplugin='a.b'\nkey='k'\nvalue='v'\n")
            .unwrap();
        assert_eq!(SeedFile::load(&f).unwrap().plugin_settings.len(), 1);
        std::fs::write(&f, "[[plugin_settings]]\nplugin='a.b'\nkey='k'\nvalue='v'\nextra=1\n").unwrap();
        assert!(SeedFile::load(&f).is_err());
        assert!(SeedFile::load(&dir.path().join("none.toml")).is_err());
    }
}
