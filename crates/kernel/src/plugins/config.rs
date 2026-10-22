//! Settings of a plugin at platform level (`[[config]]` of the manifest), chosen by the
//! Administrator. The values are in `core.plugins.config`; the secrets are encrypted with the secret
//! key of the installation in `core.secrets` (`plugin:<id>:<key>`) and never go back to the browser.
//! The logic of the plugin receives both in `ctx.config`.

use mosaikit_mskp::{ConfigDecl, ConfigKind};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::{events, Error, Kernel, Result, SessionUser};

fn secret_name(plugin: &str, key: &str) -> String {
    format!("plugin:{plugin}:{key}")
}

/// The settings of a plugin as the Administrator sees them.
#[derive(Debug, Clone, Serialize)]
pub struct ConfigView {
    pub decls: Vec<ConfigDecl>,
    /// the values that are not secrets (the default where none is chosen)
    pub values: Map<String, Value>,
    /// the secrets that have a value
    pub secrets: Vec<String>,
}

async fn stored(k: &Kernel, plugin: &str) -> Result<Map<String, Value>> {
    let v: Option<Value> = mosaikit_db::query_scalar("select config from core.plugins where id = $1")
        .bind(plugin)
        .fetch_optional(&k.db)
        .await?;
    Ok(v.and_then(|v| v.as_object().cloned()).unwrap_or_default())
}

async fn secret(k: &Kernel, plugin: &str, key: &str) -> Result<Option<String>> {
    let name = secret_name(plugin, key);
    let sealed: Option<Vec<u8>> = mosaikit_db::query_scalar("select value from core.secrets where name = $1")
        .bind(&name)
        .fetch_optional(&k.db)
        .await?;
    match sealed {
        None => Ok(None),
        Some(b) => {
            let plain = k.secrets.open(name.as_bytes(), &b)?;
            Ok(Some(String::from_utf8(plain).map_err(|_| Error::internal("secret of a plugin"))?))
        }
    }
}

fn effective(decls: &[ConfigDecl], stored: &Map<String, Value>) -> Map<String, Value> {
    decls
        .iter()
        .filter(|d| d.kind != ConfigKind::Secret)
        .map(|d| {
            let v = stored.get(&d.key).cloned().filter(|v| !v.is_null()).or_else(|| d.default.clone());
            (d.key.clone(), v.unwrap_or(Value::Null))
        })
        .collect()
}

pub async fn config(k: &Kernel, admin: &SessionUser, plugin: &str, lang: &str) -> Result<ConfigView> {
    crate::tenancy::require_admin(admin)?;
    let p = k.plugins.get(plugin).ok_or_else(|| Error::not_found("plugin not installed"))?;
    let decls = p.manifest.localized(lang).config;
    let values = effective(&decls, &stored(k, plugin).await?);
    let mut secrets = Vec::new();
    for d in decls.iter().filter(|d| d.kind == ConfigKind::Secret) {
        if secret(k, plugin, &d.key).await?.is_some() {
            secrets.push(d.key.clone());
        }
    }
    Ok(ConfigView { decls, values, secrets })
}

/// A change of the settings: the values given replace the stored ones; a secret `null` is removed.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ConfigChange {
    #[serde(default)]
    pub values: Map<String, Value>,
    #[serde(default)]
    pub secrets: Map<String, Value>,
}

pub async fn set_config(
    k: &Kernel,
    admin: &SessionUser,
    plugin: &str,
    ch: &ConfigChange,
) -> Result<ConfigView> {
    crate::tenancy::require_admin(admin)?;
    let p = k.plugins.get(plugin).ok_or_else(|| Error::not_found("plugin not installed"))?;
    let decls = &p.manifest.config;
    let decl = |key: &str, secret: bool| {
        decls
            .iter()
            .find(|d| d.key == key && (d.kind == ConfigKind::Secret) == secret)
            .ok_or_else(|| Error::bad(format!("unknown setting: {key}")))
    };
    let mut values = stored(k, plugin).await?;
    for (key, v) in &ch.values {
        let d = decl(key, false)?;
        let v = d.check(v).ok_or_else(|| Error::bad(format!("{}: value not valid", d.label)))?;
        values.insert(key.clone(), v);
    }
    for (key, v) in &ch.secrets {
        let d = decl(key, true)?;
        let name = secret_name(plugin, key);
        match v {
            Value::Null => {
                mosaikit_db::query("delete from core.secrets where name = $1")
                    .bind(&name)
                    .execute(&k.db)
                    .await?;
            }
            Value::String(s) if !s.is_empty() && s.len() <= 4000 => {
                let sealed = k.secrets.seal(name.as_bytes(), s.as_bytes());
                mosaikit_db::query(
                    "insert into core.secrets (name, value) values ($1, $2)
                     on conflict (name) do update set value = excluded.value",
                )
                .bind(&name)
                .bind(sealed)
                .execute(&k.db)
                .await?;
            }
            _ => return Err(Error::bad(format!("{}: value not valid", d.label))),
        }
    }
    mosaikit_db::query("update core.plugins set config = $2 where id = $1")
        .bind(plugin)
        .bind(Value::Object(values))
        .execute(&k.db)
        .await?;
    let keys: Vec<&String> = ch.values.keys().chain(ch.secrets.keys()).collect();
    events::record(
        k,
        None,
        Some(admin.user_id),
        Some(plugin),
        None,
        "plugin.config",
        json!({ "keys": keys }),
    )
    .await;
    config(k, admin, plugin, "en").await
}

/// What the logic of the plugin receives in `ctx.config`: values and secrets, by key.
pub async fn for_logic(k: &Kernel, plugin: &str) -> Result<Value> {
    let Some(p) = k.plugins.get(plugin) else { return Ok(json!({})) };
    if p.manifest.config.is_empty() {
        return Ok(json!({}));
    }
    let mut out = effective(&p.manifest.config, &stored(k, plugin).await?);
    for d in p.manifest.config.iter().filter(|d| d.kind == ConfigKind::Secret) {
        out.insert(d.key.clone(), secret(k, plugin, &d.key).await?.map(Value::String).unwrap_or(Value::Null));
    }
    Ok(Value::Object(out))
}

/// Removes the secrets of a plugin (uninstall).
pub(crate) async fn forget(k: &Kernel, plugin: &str) -> Result<()> {
    mosaikit_db::query("delete from core.secrets where name like $1")
        .bind(format!("plugin:{plugin}:%"))
        .execute(&k.db)
        .await?;
    Ok(())
}
