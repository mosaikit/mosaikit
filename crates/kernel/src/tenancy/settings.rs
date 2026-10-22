//! Policy del tenant (Tenant Manager), preferenze dell'utente nel tenant, tema (della piattaforma e
//! del tenant) e barra in alto della shell (Administrator, per tutta la piattaforma).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::require_admin;
use crate::{events, Caller, Error, Kernel, Result, SessionUser, TenantSettings};

pub async fn set_settings(k: &Kernel, c: &Caller, s: &TenantSettings) -> Result<()> {
    c.require_manager()?;
    if s.public_link_max_days > 3650 {
        return Err(Error::bad("durata massima dei link: al massimo 3650 giorni"));
    }
    // le policy si fondono con il resto delle impostazioni (il tema, per esempio)
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
        return Err(Error::bad("preferenze non valide"));
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

/// Elementi della barra in alto della shell, decisi dall'Administrator e uguali per tutti i tenant.
/// Stanno nelle impostazioni del tenant di sistema, sotto `band`; un elemento assente vale acceso.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShellBand {
    /// logo e nome dell'applicazione (spento: il pulsante della sidebar ne prende il posto)
    #[serde(default = "on")]
    pub logo: bool,
    /// casella di ricerca e Ctrl K
    #[serde(default = "on")]
    pub search: bool,
    /// menu della lingua
    #[serde(default = "on")]
    pub lang: bool,
    /// menu dell'aiuto (tour, guida, novita')
    #[serde(default = "on")]
    pub help: bool,
    /// menu della tonalita' (chiaro, scuro, automatico)
    #[serde(default = "on")]
    pub mode: bool,
}

fn on() -> bool {
    true
}

impl Default for ShellBand {
    fn default() -> ShellBand {
        serde_json::from_str("{}").expect("barra di default")
    }
}

async fn system_settings(k: &Kernel) -> Result<Value> {
    let v: Option<Value> = mosaikit_db::query_scalar("select settings from core.tenants where is_system")
        .fetch_optional(&k.db)
        .await?;
    Ok(v.filter(Value::is_object).unwrap_or_else(|| json!({})))
}

/// La barra in alto della piattaforma (la legge chiunque abbia una sessione).
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

/// Il tema predefinito quando nessuno ne ha scelto uno.
pub const DEFAULT_THEME: &str = "mosaikit";

/// Il tema: quello della piattaforma (Administrator) e, per un tenant, quello che il Tenant Manager ha
/// scelto al suo posto. Il modo (chiaro, scuro) resta una scelta di ciascuno.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ThemeChoice {
    pub platform: String,
    /// il tema del tenant; assente: eredita quello della piattaforma
    pub tenant: Option<String>,
    /// quello in uso
    pub preset: String,
}

fn theme_in(s: &Value) -> Option<String> {
    s.get("theme").and_then(Value::as_str).map(str::to_owned)
}

fn check_theme(preset: &str) -> Result<()> {
    let ok = !preset.is_empty()
        && preset.len() <= 32
        && preset.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(Error::bad("tema non valido"))
    }
}

/// Il tema della piattaforma, per l'accesso e per le pagine dell'Administrator.
pub async fn platform_theme(k: &Kernel) -> Result<String> {
    Ok(theme_in(&system_settings(k).await?).unwrap_or_else(|| DEFAULT_THEME.into()))
}

/// Il tema di un tenant, con quello della piattaforma da cui eredita.
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

/// Il Tenant Manager sceglie il tema del tenant; `None` torna a quello della piattaforma.
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
