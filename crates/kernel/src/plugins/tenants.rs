//! Plugins in the tenants (docs/architecture.md, "Plugins in the tenants").
//!
//! A plugin installed and on in the platform reaches the people of a tenant when:
//! - the Administrator made it **available** to the tenant (`core.tenant_plugins.available`, or the
//!   default of the plugin, `core.plugins.available_default`, true unless changed);
//! - the Tenant Manager turned it **on** in the tenant (`enabled`, true unless turned off);
//! - for an extension, the plugin it extends is on in the tenant too, with at least the version the
//!   extension needs. Turning a plugin off turns off its extensions with it.
//!
//! Every operation of a plugin goes through [`crate::access::require`], which checks this first.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use mosaikit_mskp::Version;
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::LoadedPlugin;
use crate::notify::{self, NoteKind};
use crate::{events, Caller, Error, Kernel, Result, SessionUser};

/// Choice of the Administrator and of the Tenant Manager for one plugin in one tenant.
#[derive(Debug, Clone, Copy)]
struct Row {
    available: Option<bool>,
    enabled: bool,
}

async fn rows_of(k: &Kernel, tenant: Uuid) -> Result<HashMap<String, Row>> {
    let rows = mosaikit_db::query(
        "select plugin_id, available, enabled from core.tenant_plugins where tenant_id = $1",
    )
    .bind(tenant)
    .fetch_all(&k.db)
    .await?;
    Ok(rows.iter().map(|r| (r.get::<String, _>(0), Row { available: r.get(1), enabled: r.get(2) })).collect())
}

async fn defaults(k: &Kernel) -> Result<HashMap<String, bool>> {
    let rows = mosaikit_db::query("select id, available_default from core.plugins").fetch_all(&k.db).await?;
    Ok(rows.iter().map(|r| (r.get::<String, _>(0), r.get::<bool, _>(1))).collect())
}

/// Why a plugin is not on in a tenant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Off {
    /// turned off in the whole platform, or blocked
    Platform,
    /// not available to the tenant
    Unavailable,
    /// turned off by the Tenant Manager
    TurnedOff,
    /// the plugin it extends is missing, off or too old
    Base,
}

/// State of every installed plugin in a tenant: `None` = on, otherwise why not.
async fn states(k: &Kernel, tenant: Uuid) -> Result<HashMap<String, (bool, bool, Option<Off>)>> {
    let rows = rows_of(k, tenant).await?;
    let defaults = defaults(k).await?;
    let plugins = k.plugins.list();
    let own = |p: &LoadedPlugin| -> (bool, bool, Option<Off>) {
        let row = rows.get(&p.id);
        let available = row.and_then(|r| r.available).unwrap_or(*defaults.get(&p.id).unwrap_or(&true));
        let enabled = row.map(|r| r.enabled).unwrap_or(true);
        let off = if !p.is_active() {
            Some(Off::Platform)
        } else if !available {
            Some(Off::Unavailable)
        } else if !enabled {
            Some(Off::TurnedOff)
        } else {
            None
        };
        (available, enabled, off)
    };
    let mut out: HashMap<String, (bool, bool, Option<Off>)> =
        plugins.iter().map(|p| (p.id.clone(), own(p))).collect();
    // extensions: on only with the plugin they extend (one level: an extension does not extend another)
    for p in &plugins {
        let Some(e) = &p.manifest.extends else { continue };
        let base_ok = plugins.iter().find(|b| b.id == e.plugin).is_some_and(|b| {
            out.get(&b.id).is_some_and(|s| s.2.is_none())
                && Version::parse(&b.manifest.version) >= Version::parse(&e.min_version)
        });
        if let Some(s) = out.get_mut(&p.id) {
            if s.2.is_none() && !base_ok {
                s.2 = Some(Off::Base);
            }
        }
    }
    Ok(out)
}

/// The plugins on in a tenant.
pub async fn on_in(k: &Kernel, tenant: Uuid) -> Result<HashSet<String>> {
    Ok(states(k, tenant).await?.into_iter().filter(|(_, s)| s.2.is_none()).map(|(id, _)| id).collect())
}

/// The plugin is on in the tenant.
pub async fn is_on(k: &Kernel, tenant: Uuid, plugin: &str) -> Result<bool> {
    Ok(states(k, tenant).await?.get(plugin).is_some_and(|s| s.2.is_none()))
}

/// The error of a plugin that is installed but not on in the tenant.
pub fn off_error(p: &LoadedPlugin) -> Error {
    Error::not_found(format!("{} is not turned on in this tenant", p.manifest.contribution.label))
        .with_code("plugin_off")
}

// ------------------------------------------------------------------ Tenant Manager

/// A plugin available to a tenant, as its Tenant Manager sees it.
#[derive(Debug, Clone, Serialize)]
pub struct TenantPlugin {
    pub id: String,
    pub label: String,
    pub description: String,
    pub version: String,
    pub kind: &'static str,
    pub icon: Option<String>,
    pub has_ui: bool,
    /// available to the tenant (the Administrator)
    pub available: bool,
    /// turned on by the Tenant Manager
    pub enabled: bool,
    /// actually on (`enabled` and, for an extension, its plugin on)
    pub on: bool,
    pub off: Option<Off>,
    /// for an extension: the plugin it extends, and its name (also when it is not available)
    pub extends: Option<String>,
    pub extends_label: Option<String>,
    /// the extensions of this plugin available to the tenant
    pub extensions: Vec<String>,
}

fn kind_of(p: &LoadedPlugin) -> &'static str {
    p.manifest.effective_kind().as_str()
}

/// The plugins available to the tenant (the others are not shown to its Tenant Manager).
pub async fn tenant_plugins(k: &Kernel, c: &Caller, lang: &str) -> Result<Vec<TenantPlugin>> {
    c.require_manager()?;
    list(k, c.tenant.tenant_id, lang, true).await
}

/// Every plugin installed and on in the platform with its state in a tenant (the Administrator, in
/// the page of the tenant).
pub async fn of_tenant(
    k: &Kernel,
    admin: &SessionUser,
    tenant: Uuid,
    lang: &str,
) -> Result<Vec<TenantPlugin>> {
    crate::tenancy::require_admin(admin)?;
    list(k, tenant, lang, false).await
}

async fn list(k: &Kernel, tenant: Uuid, lang: &str, only_available: bool) -> Result<Vec<TenantPlugin>> {
    let st = states(k, tenant).await?;
    let plugins = k.plugins.list();
    // a layout belongs to the platform (System › Identity and appearance › Layout), not to the tenants
    let visible = |p: &LoadedPlugin| {
        p.manifest.effective_kind() != mosaikit_mskp::PluginKind::Layout
            && st.get(&p.id).is_some_and(|s| p.is_active() && (s.0 || !only_available))
    };
    Ok(plugins
        .iter()
        .filter(|p| visible(p))
        .map(|p| {
            let m = p.manifest.localized(lang);
            let s = st[&p.id];
            TenantPlugin {
                id: p.id.clone(),
                label: m.contribution.label.clone(),
                description: m.description.clone(),
                version: m.version.clone(),
                kind: kind_of(p),
                icon: m.icon.clone(),
                has_ui: p.ui_dir.is_some() && m.ui.is_some(),
                available: s.0,
                enabled: s.1,
                on: s.2.is_none(),
                off: s.2,
                extends: m.extends.as_ref().map(|e| e.plugin.clone()),
                extends_label: m.extends.as_ref().map(|e| {
                    k.plugins
                        .get(&e.plugin)
                        .map(|b| b.manifest.localized(lang).contribution.label)
                        .unwrap_or_else(|| e.plugin.clone())
                }),
                extensions: plugins
                    .iter()
                    .filter(|x| visible(x) && x.manifest.extends.as_ref().is_some_and(|e| e.plugin == p.id))
                    .map(|x| x.id.clone())
                    .collect(),
            }
        })
        .collect())
}

/// The Tenant Manager turns a plugin available to the tenant on or off. An extension can be turned on
/// only when the plugin it extends is on.
pub async fn set_enabled(k: &Kernel, c: &Caller, plugin: &str, on: bool) -> Result<()> {
    c.require_manager()?;
    let p = k
        .plugins
        .get(plugin)
        .filter(|p| p.is_active())
        .ok_or_else(|| Error::not_found("plugin not installed"))?;
    let st = states(k, c.tenant.tenant_id).await?;
    let (available, _, _) =
        st.get(plugin).copied().ok_or_else(|| Error::not_found("plugin not installed"))?;
    if !available {
        return Err(Error::forbidden("the Administrator has not made this plugin available to the tenant")
            .with_code("plugin_unavailable"));
    }
    if on {
        if let Some(e) = &p.manifest.extends {
            let base_on = st.get(&e.plugin).is_some_and(|s| s.2.is_none());
            if !base_on {
                let base = k.plugins.get(&e.plugin).map(|b| b.manifest.contribution.label.clone());
                return Err(Error::conflict(format!(
                    "turn on {} first: {} extends it",
                    base.unwrap_or_else(|| e.plugin.clone()),
                    p.manifest.contribution.label
                ))
                .with_code("base_off"));
            }
        }
    }
    mosaikit_db::query(
        "insert into core.tenant_plugins (tenant_id, plugin_id, enabled, updated_by) values ($1, $2, $3, $4)
         on conflict (tenant_id, plugin_id) do update set enabled = excluded.enabled,
             updated_at = now(), updated_by = excluded.updated_by",
    )
    .bind(c.tenant.tenant_id)
    .bind(plugin)
    .bind(on)
    .bind(c.user.user_id)
    .execute(&k.db)
    .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(plugin),
        None,
        if on { "plugin.tenant_on" } else { "plugin.tenant_off" },
        json!({}),
    )
    .await;
    Ok(())
}

// ------------------------------------------------------------------ Administrator

/// A tenant in the Tenants tab of a plugin.
#[derive(Debug, Clone, Serialize)]
pub struct PluginTenant {
    pub tenant_id: Uuid,
    pub slug: String,
    pub name: String,
    pub status: String,
    pub available: bool,
    /// the choice of the Administrator for this tenant (`None`: the default of the plugin)
    pub own_choice: Option<bool>,
    pub enabled: bool,
    pub on: bool,
}

/// Every tenant with the state of the plugin in it.
pub async fn plugin_tenants(
    k: &Kernel,
    admin: &SessionUser,
    plugin: &str,
) -> Result<(bool, Vec<PluginTenant>)> {
    crate::tenancy::require_admin(admin)?;
    k.plugins.get(plugin).ok_or_else(|| Error::not_found("plugin not installed"))?;
    let default = defaults(k).await?.get(plugin).copied().unwrap_or(true);
    let rows = mosaikit_db::query(
        "select t.id, t.slug, t.name, t.status, tp.available
         from core.tenants t left join core.tenant_plugins tp on tp.tenant_id = t.id and tp.plugin_id = $1
         where not t.is_system order by t.name",
    )
    .bind(plugin)
    .fetch_all(&k.db)
    .await?;
    let mut out = Vec::new();
    for r in rows {
        let tenant: Uuid = r.get(0);
        let st = states(k, tenant).await?;
        let s = st.get(plugin).copied().unwrap_or((default, true, Some(Off::Platform)));
        out.push(PluginTenant {
            tenant_id: tenant,
            slug: r.get(1),
            name: r.get(2),
            status: r.get(3),
            available: s.0,
            own_choice: r.get(4),
            enabled: s.1,
            on: s.2.is_none(),
        });
    }
    Ok((default, out))
}

async fn managers_of(k: &Kernel, tenant: Uuid) -> Result<Vec<Uuid>> {
    let rows = mosaikit_db::query(
        "select m.user_id from core.memberships m join core.users u on u.id = m.user_id
         where m.tenant_id = $1 and m.role = 'tenant_manager' and m.status = 'active' and u.status = 'active'",
    )
    .bind(tenant)
    .fetch_all(&k.db)
    .await?;
    Ok(rows.iter().map(|r| r.get(0)).collect())
}

/// Tells the Tenant Managers of a tenant that a plugin became available or unavailable.
async fn tell_managers(k: &Kernel, tenant: Uuid, p: &Arc<LoadedPlugin>, available: bool) {
    let slug: Option<String> = mosaikit_db::query_scalar("select slug from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await
        .ok()
        .flatten();
    let label = p.manifest.contribution.label.clone();
    let (title, code) = if available {
        (format!("{label} is available to the tenant"), "plugin.available")
    } else {
        (format!("{label} is no longer available to the tenant"), "plugin.unavailable")
    };
    let body = if available {
        "Turn it on in Plugins to give it to the people of the tenant.".to_string()
    } else {
        "The Administrator took it back: the people of the tenant no longer see it.".to_string()
    };
    let link = slug.map(|s| format!("#/t/{s}/plugins")).unwrap_or_default();
    for user in managers_of(k, tenant).await.unwrap_or_default() {
        notify::emit(
            k,
            notify::New {
                user,
                tenant: Some(tenant),
                kind: NoteKind::System,
                title: title.clone(),
                body: body.clone(),
                link: link.clone(),
                source: "kernel".into(),
                resource: None,
                data: json!({ "code": code, "plugin": label }),
            },
        )
        .await;
    }
}

/// The Administrator makes a plugin available (or not) to a tenant; `None` goes back to the default.
pub async fn set_available(
    k: &Kernel,
    admin: &SessionUser,
    plugin: &str,
    tenant: Uuid,
    available: Option<bool>,
) -> Result<()> {
    crate::tenancy::require_admin(admin)?;
    let p = k.plugins.get(plugin).ok_or_else(|| Error::not_found("plugin not installed"))?;
    let before = states(k, tenant).await?.get(plugin).map(|s| s.0);
    mosaikit_db::query(
        "insert into core.tenant_plugins (tenant_id, plugin_id, available, updated_by) values ($1, $2, $3, $4)
         on conflict (tenant_id, plugin_id) do update set available = excluded.available,
             updated_at = now(), updated_by = excluded.updated_by",
    )
    .bind(tenant)
    .bind(plugin)
    .bind(available)
    .bind(admin.user_id)
    .execute(&k.db)
    .await?;
    let after = states(k, tenant).await?.get(plugin).map(|s| s.0);
    events::record(
        k,
        Some(tenant),
        Some(admin.user_id),
        Some(plugin),
        None,
        "plugin.availability",
        json!({ "available": available }),
    )
    .await;
    if let (Some(b), Some(a)) = (before, after) {
        if a != b && p.is_active() {
            tell_managers(k, tenant, &p, a).await;
        }
    }
    Ok(())
}

/// The default availability of a plugin to the tenants without a choice of their own.
pub async fn set_available_default(
    k: &Kernel,
    admin: &SessionUser,
    plugin: &str,
    available: bool,
) -> Result<()> {
    crate::tenancy::require_admin(admin)?;
    let p = k.plugins.get(plugin).ok_or_else(|| Error::not_found("plugin not installed"))?;
    let tenants: Vec<Uuid> = mosaikit_db::query("select id from core.tenants where not is_system")
        .fetch_all(&k.db)
        .await?
        .iter()
        .map(|r| r.get(0))
        .collect();
    let mut before = HashMap::new();
    for t in &tenants {
        before.insert(*t, states(k, *t).await?.get(plugin).map(|s| s.0));
    }
    mosaikit_db::query("update core.plugins set available_default = $2 where id = $1")
        .bind(plugin)
        .bind(available)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        Some(plugin),
        None,
        "plugin.availability_default",
        json!({ "available": available }),
    )
    .await;
    if p.is_active() {
        for t in tenants {
            let after = states(k, t).await?.get(plugin).map(|s| s.0);
            if after.is_some() && after != before[&t] {
                tell_managers(k, t, &p, available).await;
            }
        }
    }
    Ok(())
}
