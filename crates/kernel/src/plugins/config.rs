//! Settings of a plugin at platform level (`[[config]]` of the manifest), chosen by the
//! Administrator. The values are in `core.plugins.config`; the secrets are encrypted with the secret
//! key of the installation in `core.secrets` (`plugin:<id>:<key>`) and never go back to the browser.
//! The logic of the plugin receives both in `ctx.config`.

use mosaikit_mskp::{ConfigDecl, ConfigKind, ConfigScope};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use uuid::Uuid;

use crate::{events, Caller, Error, Kernel, Result, SessionUser};

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
        .filter(|d| d.kind != ConfigKind::Secret && d.scope == ConfigScope::Platform)
        .map(|d| {
            let v = stored.get(&d.key).cloned().filter(|v| !v.is_null()).or_else(|| d.default.clone());
            (d.key.clone(), v.unwrap_or(Value::Null))
        })
        .collect()
}

pub async fn config(k: &Kernel, admin: &SessionUser, plugin: &str, lang: &str) -> Result<ConfigView> {
    crate::tenancy::require_admin(admin)?;
    let p = k.plugins.get(plugin).ok_or_else(|| Error::not_found("plugin not installed"))?;
    let mut decls = p.manifest.localized(lang).config;
    decls.retain(|d| d.scope == ConfigScope::Platform);
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
            .find(|d| {
                d.key == key && d.scope == ConfigScope::Platform && (d.kind == ConfigKind::Secret) == secret
            })
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
            Value::String(s) if !s.is_empty() && s.len() <= 4000 => put_secret(k, plugin, key, s).await?,
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

/// Stores a secret of a plugin, encrypted (the Administrator's path and the seeding of a deployment).
pub(crate) async fn put_secret(k: &Kernel, plugin: &str, key: &str, value: &str) -> Result<()> {
    let name = secret_name(plugin, key);
    let sealed = k.secrets.seal(name.as_bytes(), value.as_bytes());
    mosaikit_db::query(
        "insert into core.secrets (name, value) values ($1, $2)
         on conflict (name) do update set value = excluded.value",
    )
    .bind(&name)
    .bind(sealed)
    .execute(&k.db)
    .await?;
    Ok(())
}

pub(crate) async fn has_secret(k: &Kernel, plugin: &str, key: &str) -> Result<bool> {
    Ok(secret(k, plugin, key).await?.is_some())
}

/// The value the Administrator stored for a setting (not the manifest default).
pub(crate) async fn stored_value(k: &Kernel, plugin: &str, key: &str) -> Result<Option<Value>> {
    Ok(stored(k, plugin).await?.get(key).cloned().filter(|v| !v.is_null()))
}

pub(crate) async fn put_value(k: &Kernel, plugin: &str, key: &str, value: Value) -> Result<()> {
    let mut values = stored(k, plugin).await?;
    values.insert(key.to_string(), value);
    mosaikit_db::query("update core.plugins set config = $2 where id = $1")
        .bind(plugin)
        .bind(Value::Object(values))
        .execute(&k.db)
        .await?;
    Ok(())
}

/// What the logic of the plugin receives in `ctx.config`: values and secrets, by key.
pub async fn for_logic(k: &Kernel, plugin: &str) -> Result<Value> {
    let Some(p) = k.plugins.get(plugin) else { return Ok(json!({})) };
    if p.manifest.config.is_empty() {
        return Ok(json!({}));
    }
    let mut out = effective(&p.manifest.config, &stored(k, plugin).await?);
    for d in
        p.manifest.config.iter().filter(|d| d.kind == ConfigKind::Secret && d.scope == ConfigScope::Platform)
    {
        out.insert(d.key.clone(), secret(k, plugin, &d.key).await?.map(Value::String).unwrap_or(Value::Null));
    }
    Ok(Value::Object(out))
}

/// What the page of a public link may read of the settings of its plugin: the keys declared
/// `public = true`, never a secret (the manifest refuses that pair, and `effective` leaves secrets out
/// again, so two layers hold). The plugin is the one of the link, never one a visitor names.
pub async fn public_values(k: &Kernel, plugin: &str) -> Result<Map<String, Value>> {
    let Some(p) = k.plugins.get(plugin) else { return Ok(Map::new()) };
    let all = effective(&p.manifest.config, &stored(k, plugin).await?);
    Ok(all
        .into_iter()
        .filter(|(key, _)| {
            p.manifest.config.iter().any(|d| d.public && d.kind != ConfigKind::Secret && &d.key == key)
        })
        .collect())
}

/// What the logic receives in `ctx.config` when a visitor of a public link runs a public command:
/// the non-secret values only. A secret is reachable there only through `http.fetch` with `key`.
pub async fn for_public_logic(k: &Kernel, plugin: &str) -> Result<Value> {
    let Some(p) = k.plugins.get(plugin) else { return Ok(json!({})) };
    if p.manifest.config.is_empty() {
        return Ok(json!({}));
    }
    Ok(Value::Object(effective(&p.manifest.config, &stored(k, plugin).await?)))
}

/// Removes the secrets of a plugin (uninstall).
pub(crate) async fn forget(k: &Kernel, plugin: &str) -> Result<()> {
    mosaikit_db::query("delete from core.secrets where name like $1")
        .bind(format!("plugin:{plugin}:%"))
        .execute(&k.db)
        .await?;
    mosaikit_db::query("delete from core.plugin_settings where plugin = $1")
        .bind(plugin)
        .execute(&k.db)
        .await?;
    Ok(())
}

// ---- Settings of a tenant (`[[config]] scope = "tenant"`) ----
//
// The values are rows of `core.plugin_settings` (tenant, plugin, key); the secrets are encrypted in `core.secrets`
// under `plugin:<id>:t:<tenant>:<key>`. Keys are matched by name against the manifest: a stored key that the manifest
// no longer declares (or whose value no longer fits the kind) is ignored and the default applies.

fn tenant_secret_name(plugin: &str, tenant: Uuid, key: &str) -> String {
    format!("plugin:{plugin}:t:{tenant}:{key}")
}

async fn tenant_secret(k: &Kernel, plugin: &str, tenant: Uuid, key: &str) -> Result<Option<String>> {
    let name = tenant_secret_name(plugin, tenant, key);
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

async fn tenant_stored(k: &Kernel, plugin: &str, tenant: Uuid) -> Result<Map<String, Value>> {
    let rows = mosaikit_db::query(
        "select key, value from core.plugin_settings where tenant_id = $1 and plugin = $2",
    )
    .bind(tenant)
    .bind(plugin)
    .fetch_all(&k.db)
    .await?;
    Ok(rows.iter().map(|r| (r.get::<String, _>(0), r.get::<Value, _>(1))).collect())
}

/// The value of a tenant setting: the stored one if it still fits the kind, else the default.
fn tenant_effective(decls: &[ConfigDecl], stored: &Map<String, Value>) -> Map<String, Value> {
    decls
        .iter()
        .filter(|d| d.kind != ConfigKind::Secret)
        .map(|d| {
            let v = stored
                .get(&d.key)
                .filter(|v| !v.is_null())
                .and_then(|v| d.check(v))
                .filter(|v| !v.is_null())
                .or_else(|| d.default.clone());
            (d.key.clone(), v.unwrap_or(Value::Null))
        })
        .collect()
}

fn is_tenant(d: &ConfigDecl) -> bool {
    d.scope == ConfigScope::Tenant
}

/// Whether the caller may change the tenant setting `d` of the plugin: a Tenant Manager, or a holder of the
/// permission the setting (`edit`) or the plugin (`[ui] settings_edit`) names.
fn may_edit(
    p: &crate::plugins::LoadedPlugin,
    d: &ConfigDecl,
    c: &Caller,
    perms: &std::collections::BTreeSet<String>,
) -> bool {
    if c.tenant.role == crate::Role::TenantManager {
        return true;
    }
    let page = p.manifest.ui.as_ref().and_then(|u| u.settings_edit.as_deref());
    d.edit.as_deref().into_iter().chain(page).any(|e| perms.contains(e))
}

async fn tenant_view(k: &Kernel, c: &Caller, plugin: &str, lang: &str) -> Result<ConfigView> {
    let p = k.plugins.active(plugin)?;
    if !crate::plugins::tenants::is_on(k, c.tenant.tenant_id, plugin).await? {
        return Err(crate::plugins::tenants::off_error(&p));
    }
    let perms = crate::access::effective(k, c, plugin).await?;
    let mut decls = p.manifest.localized(lang).config;
    decls.retain(|d| is_tenant(d) && may_edit(&p, d, c, &perms));
    if decls.is_empty() {
        return Err(Error::forbidden("no settings of this tenant that you may change"));
    }
    let tenant = c.tenant.tenant_id;
    let values = tenant_effective(&decls, &tenant_stored(k, plugin, tenant).await?);
    let mut secrets = Vec::new();
    for d in decls.iter().filter(|d| d.kind == ConfigKind::Secret) {
        if tenant_secret(k, plugin, tenant, &d.key).await?.is_some() {
            secrets.push(d.key.clone());
        }
    }
    Ok(ConfigView { decls, values, secrets })
}

/// The settings of the plugin that belong to the tenant, the ones the caller may change; a secret is only said to
/// be set, never given back.
pub async fn tenant_config(k: &Kernel, c: &Caller, plugin: &str, lang: &str) -> Result<ConfigView> {
    tenant_view(k, c, plugin, lang).await
}

/// Changes tenant settings: values replace the stored ones (`null` goes back to the default), a secret `null` is
/// removed. Every key is checked before anything is written, and the Log gets the keys, never a secret.
pub async fn set_tenant_config(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    ch: &ConfigChange,
) -> Result<ConfigView> {
    let allowed = tenant_view(k, c, plugin, "en").await?;
    let decl = |key: &str, secret: bool| {
        allowed
            .decls
            .iter()
            .find(|d| d.key == key && (d.kind == ConfigKind::Secret) == secret)
            .ok_or_else(|| Error::forbidden(format!("unknown setting or not allowed to change it: {key}")))
    };
    let mut values = Vec::new();
    for (key, v) in &ch.values {
        let d = decl(key, false)?;
        let v = d.check(v).ok_or_else(|| Error::bad(format!("{}: value not valid", d.label)))?;
        values.push((key.clone(), v));
    }
    for (key, v) in &ch.secrets {
        let d = decl(key, true)?;
        if !matches!(v, Value::Null) && !matches!(v, Value::String(s) if !s.is_empty() && s.len() <= 4000) {
            return Err(Error::bad(format!("{}: value not valid", d.label)));
        }
    }
    let tenant = c.tenant.tenant_id;
    for (key, v) in values {
        if v.is_null() {
            mosaikit_db::query(
                "delete from core.plugin_settings where tenant_id = $1 and plugin = $2 and key = $3",
            )
            .bind(tenant)
            .bind(plugin)
            .bind(&key)
            .execute(&k.db)
            .await?;
        } else {
            mosaikit_db::query(
                "insert into core.plugin_settings (tenant_id, plugin, key, value, updated_by, updated_at)
                 values ($1, $2, $3, $4, $5, $6)
                 on conflict (tenant_id, plugin, key) do update
                 set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
            )
            .bind(tenant)
            .bind(plugin)
            .bind(&key)
            .bind(v)
            .bind(c.user.user_id)
            .bind(chrono::Utc::now())
            .execute(&k.db)
            .await?;
        }
    }
    for (key, v) in &ch.secrets {
        let name = tenant_secret_name(plugin, tenant, key);
        match v {
            Value::String(s) => {
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
            _ => {
                mosaikit_db::query("delete from core.secrets where name = $1")
                    .bind(&name)
                    .execute(&k.db)
                    .await?;
            }
        }
    }
    let keys: Vec<&String> = ch.values.keys().chain(ch.secrets.keys()).collect();
    events::record(
        k,
        Some(tenant),
        Some(c.user.user_id),
        Some(plugin),
        None,
        "plugin.setting",
        json!({ "keys": keys }),
    )
    .await;
    tenant_view(k, c, plugin, "en").await
}

/// What `ctx.config` of a command also holds for the tenant that runs it: its settings of the plugin (values and
/// secrets, by key), merged over the platform ones.
pub async fn tenant_for_logic(k: &Kernel, plugin: &str, tenant: Uuid) -> Result<Map<String, Value>> {
    let Some(p) = k.plugins.get(plugin) else { return Ok(Map::new()) };
    let decls: Vec<ConfigDecl> = p.manifest.config.iter().filter(|d| is_tenant(d)).cloned().collect();
    if decls.is_empty() {
        return Ok(Map::new());
    }
    let mut out = tenant_effective(&decls, &tenant_stored(k, plugin, tenant).await?);
    for d in decls.iter().filter(|d| d.kind == ConfigKind::Secret) {
        let v = tenant_secret(k, plugin, tenant, &d.key).await?.map(Value::String).unwrap_or(Value::Null);
        out.insert(d.key.clone(), v);
    }
    Ok(out)
}
