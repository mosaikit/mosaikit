//! Policy of the tenant (Tenant Manager), preferences of the user in the tenant, theme (of the platform
//! and of the tenant) and top bar of the shell (Administrator, for the whole platform).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::require_admin;
use crate::{events, Caller, Error, Kernel, Result, SessionUser, TenantSettings};

pub async fn set_settings(k: &Kernel, c: &Caller, s: &TenantSettings) -> Result<()> {
    c.require_manager()?;
    if s.public_link_max_days > 3650 {
        return Err(Error::bad("maximum lifetime of links: at most 3650 days"));
    }
    // the policies merge with the rest of the settings (the theme, for instance)
    let mut all = settings_of(k, c.tenant.tenant_id).await?;
    if let (Some(o), Value::Object(n)) = (all.as_object_mut(), serde_json::to_value(s)?) {
        o.extend(n);
    }
    write_settings(k, c.tenant.tenant_id, all).await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "tenant.settings",
        serde_json::to_value(s)?,
    )
    .await;
    Ok(())
}

pub async fn prefs(k: &Kernel, c: &Caller) -> Result<Value> {
    let p: Option<Value> =
        mosaikit_db::query_scalar("select prefs from core.user_prefs where user_id = $1 and tenant_id = $2")
            .bind(c.user.user_id)
            .bind(c.tenant.tenant_id)
            .fetch_optional(&k.db)
            .await?;
    Ok(p.unwrap_or_else(|| json!({})))
}

pub async fn set_prefs(k: &Kernel, c: &Caller, prefs: &Value) -> Result<()> {
    if !prefs.is_object() || prefs.to_string().len() > 16 * 1024 {
        return Err(Error::bad("invalid preferences"));
    }
    mosaikit_db::query(
        "insert into core.user_prefs (user_id, tenant_id, prefs) values ($1, $2, $3)
         on conflict (user_id, tenant_id) do update set prefs = excluded.prefs",
    )
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .bind(prefs)
    .execute(&k.db)
    .await?;
    Ok(())
}

/// Items of the top bar of the shell, decided by the Administrator and the same for every tenant.
/// They live in the settings of the system tenant, under `band`; a missing item counts as on.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShellBand {
    /// logo and name of the application (off: the sidebar button takes its place)
    #[serde(default = "on")]
    pub logo: bool,
    /// search box and Ctrl K
    #[serde(default = "on")]
    pub search: bool,
    /// language menu
    #[serde(default = "on")]
    pub lang: bool,
    /// help menu (tour, guide, what's new)
    #[serde(default = "on")]
    pub help: bool,
    /// mode menu (light, dark, automatic)
    #[serde(default = "on")]
    pub mode: bool,
}

fn on() -> bool {
    true
}

impl Default for ShellBand {
    fn default() -> ShellBand {
        serde_json::from_str("{}").expect("default bar")
    }
}

async fn system_settings(k: &Kernel) -> Result<Value> {
    let v: Option<Value> = mosaikit_db::query_scalar("select settings from core.tenants where is_system")
        .fetch_optional(&k.db)
        .await?;
    Ok(v.filter(Value::is_object).unwrap_or_else(|| json!({})))
}

/// The top bar of the platform (anyone with a session reads it).
pub async fn shell_band(k: &Kernel) -> Result<ShellBand> {
    let s = system_settings(k).await?;
    Ok(s.get("band").cloned().and_then(|b| serde_json::from_value(b).ok()).unwrap_or_default())
}

pub async fn set_shell_band(k: &Kernel, admin: &SessionUser, band: &ShellBand) -> Result<()> {
    require_admin(admin)?;
    let mut s = system_settings(k).await?;
    s["band"] = serde_json::to_value(band)?;
    mosaikit_db::query("update core.tenants set settings = $1 where is_system")
        .bind(s)
        .execute(&k.db)
        .await?;
    events::record(k, None, Some(admin.user_id), None, None, "platform.band", serde_json::to_value(band)?)
        .await;
    Ok(())
}

async fn settings_of(k: &Kernel, tenant: uuid::Uuid) -> Result<Value> {
    let v: Option<Value> = mosaikit_db::query_scalar("select settings from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?;
    Ok(v.filter(Value::is_object).unwrap_or_else(|| json!({})))
}

async fn write_settings(k: &Kernel, tenant: uuid::Uuid, s: Value) -> Result<()> {
    mosaikit_db::query("update core.tenants set settings = $2 where id = $1")
        .bind(tenant)
        .bind(s)
        .execute(&k.db)
        .await?;
    Ok(())
}

/// The default theme when nobody chose one.
pub const DEFAULT_THEME: &str = "mosaikit";

/// The theme: the one of the platform (Administrator) and, for a tenant, the one the Tenant Manager
/// chose instead. The mode (light, dark) stays everyone's own choice.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ThemeChoice {
    pub platform: String,
    /// the theme of the tenant; absent: it inherits the one of the platform
    pub tenant: Option<String>,
    /// the one in use
    pub preset: String,
}

pub(super) fn theme_in(s: &Value) -> Option<String> {
    s.get("theme").and_then(Value::as_str).map(str::to_owned)
}

fn check_theme(preset: &str) -> Result<()> {
    let ok = !preset.is_empty()
        && preset.len() <= 32
        && preset.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(Error::bad("invalid theme"))
    }
}

/// The theme of the platform, for the sign-in and for the pages of the Administrator.
pub async fn platform_theme(k: &Kernel) -> Result<String> {
    Ok(theme_in(&system_settings(k).await?).unwrap_or_else(|| DEFAULT_THEME.into()))
}

/// The theme of a tenant, with the one of the platform it inherits from.
pub async fn tenant_theme(k: &Kernel, tenant: uuid::Uuid) -> Result<ThemeChoice> {
    let platform = platform_theme(k).await?;
    let own = theme_in(&settings_of(k, tenant).await?);
    Ok(ThemeChoice { preset: own.clone().unwrap_or_else(|| platform.clone()), platform, tenant: own })
}

pub async fn set_platform_theme(k: &Kernel, admin: &SessionUser, preset: &str) -> Result<()> {
    require_admin(admin)?;
    check_theme(preset)?;
    let mut s = system_settings(k).await?;
    s["theme"] = json!(preset);
    mosaikit_db::query("update core.tenants set settings = $1 where is_system")
        .bind(s)
        .execute(&k.db)
        .await?;
    events::record(k, None, Some(admin.user_id), None, None, "platform.theme", json!({ "theme": preset }))
        .await;
    Ok(())
}

/// The Tenant Manager chooses the theme of the tenant; `None` goes back to the one of the platform.
pub async fn set_tenant_theme(k: &Kernel, c: &Caller, preset: Option<&str>) -> Result<()> {
    c.require_manager()?;
    let mut s = settings_of(k, c.tenant.tenant_id).await?;
    match preset {
        Some(p) => {
            check_theme(p)?;
            s["theme"] = json!(p);
        }
        None => {
            if let Some(o) = s.as_object_mut() {
                o.remove("theme");
            }
        }
    }
    write_settings(k, c.tenant.tenant_id, s).await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "tenant.theme",
        json!({ "theme": preset }),
    )
    .await;
    Ok(())
}
