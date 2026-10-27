//! Permissions of the people in the plugins (docs/architecture.md, "People and permissions").
//!
//! Every plugin has the standard permissions of the kernel, which the kernel enforces itself:
//! `use` (open the app and call it at all), `create`, `delete` and `share` (share items and create
//! public links); a plugin may declare more (`[[user_permissions]]`), which it enforces itself from
//! `ctx.perms` (logic) and from the context of the bridge (UI).
//!
//! What a person may do in a plugin of a tenant:
//! - a Tenant Manager: everything;
//! - otherwise their **permission profile** (the one of the membership, or the default profile of the
//!   tenant): for each plugin the keys it lists, or the defaults of the plugin when it does not list it;
//! - plus the **grants** of the plugin to the person and to their groups (they only add).
//!
//! Permissions never widen what a person sees: the access to the items stays the one of the ACL.
//!
//! Only the plugins **on in the tenant** count (available to it and turned on, see
//! [`crate::plugins::tenants`]): the others have no permissions at all.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::plugins::LoadedPlugin;
use crate::{events, Caller, Error, Kernel, Result, Role};

pub const USE: &str = "use";
pub const CREATE: &str = "create";
pub const DELETE: &str = "delete";
pub const SHARE: &str = "share";

/// A permission of a plugin, standard or declared by the manifest.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct PermDecl {
    pub key: String,
    pub label: String,
    pub description: String,
    /// given by the profiles that do not say otherwise
    pub default: bool,
    /// enforced by the kernel (otherwise by the plugin)
    pub standard: bool,
}

fn standard() -> Vec<PermDecl> {
    [
        (USE, "Use the app", "Sees the app in the sidebar and opens it"),
        (CREATE, "Create items", "Creates items of their own"),
        (DELETE, "Delete items", "Deletes the items they manage"),
        (SHARE, "Share items", "Shares the items they manage and creates public links"),
    ]
    .into_iter()
    .map(|(key, label, description)| PermDecl {
        key: key.into(),
        label: label.into(),
        description: description.into(),
        default: true,
        standard: true,
    })
    .collect()
}

/// The permissions of a plugin: the standard ones, then the ones of the manifest in `lang`. «Use» says
/// what using means for the kind of plugin (an extension or a service has no app of its own).
pub fn declared(p: &LoadedPlugin, lang: &str) -> Vec<PermDecl> {
    let m = p.manifest.localized(lang);
    let kind = p.manifest.effective_kind();
    standard()
        .into_iter()
        .map(|mut d| {
            if d.key == USE {
                match kind {
                    mosaikit_mskp::PluginKind::Extension => {
                        d.label = "Use the extension".into();
                        d.description = "Sees and uses what the extension adds to the items".into();
                    }
                    mosaikit_mskp::PluginKind::Service => {
                        d.label = "Use the service".into();
                        d.description = "Gets what the service does for the people of the tenant".into();
                    }
                    _ => {}
                }
            }
            d
        })
        .chain(m.user_permissions.iter().map(|u| PermDecl {
            key: u.key.clone(),
            label: u.label.clone(),
            description: u.description.clone(),
            default: u.default,
            standard: false,
        }))
        .collect()
}

fn all_keys(p: &LoadedPlugin) -> BTreeSet<String> {
    declared(p, "en").into_iter().map(|d| d.key).collect()
}

fn default_keys(p: &LoadedPlugin) -> BTreeSet<String> {
    declared(p, "en").into_iter().filter(|d| d.default).map(|d| d.key).collect()
}

fn keys_of(v: Option<&Value>) -> Option<BTreeSet<String>> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
}

/// The permissions a profile gives in a plugin (`perms` of the profile: plugin id -> keys).
fn profile_keys(p: &LoadedPlugin, perms: Option<&Value>) -> BTreeSet<String> {
    let all = all_keys(p);
    match keys_of(perms.and_then(|v| v.get(&p.id))) {
        Some(keys) => keys.intersection(&all).cloned().collect(),
        None => default_keys(p),
    }
}

/// The profile of a member: their own, or the default one of the tenant (`None` if the tenant has none).
async fn member_profile(k: &Kernel, tenant: Uuid, user: Uuid) -> Result<Option<(Uuid, String, Value)>> {
    let row = mosaikit_db::query(
        "select p.id, p.name, p.perms from core.permission_profiles p
         where p.tenant_id = $1
           and p.id = coalesce((select m.profile_id from core.memberships m where m.tenant_id = $1 and m.user_id = $2),
                               (select d.id from core.permission_profiles d where d.tenant_id = $1 and d.is_default))",
    )
    .bind(tenant)
    .bind(user)
    .fetch_optional(&k.db)
    .await?;
    Ok(row.map(|r| (r.get(0), r.get(1), r.get(2))))
}

/// A grant of plugin permissions that reaches a person: to them, or to one of their groups.
struct Reach {
    plugin: String,
    group: Option<String>,
    perms: BTreeSet<String>,
}

async fn reaching(k: &Kernel, tenant: Uuid, user: Uuid) -> Result<Vec<Reach>> {
    let rows = mosaikit_db::query(
        "select pg.plugin_id, g.name, pg.perms from core.plugin_grants pg
         left join core.groups g on pg.principal_type = 'group' and g.id = pg.principal_id
         where pg.tenant_id = $1
           and ((pg.principal_type = 'user' and pg.principal_id = $2)
             or (pg.principal_type = 'group' and pg.principal_id in (
                   select gm.group_id from core.group_members gm join core.groups gr on gr.id = gm.group_id
                   where gm.user_id = $2 and gr.tenant_id = $1)))",
    )
    .bind(tenant)
    .bind(user)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Reach {
            plugin: r.get(0),
            group: r.get(1),
            perms: keys_of(Some(&r.get::<Value, _>(2))).unwrap_or_default(),
        })
        .collect())
}

/// What a person may do in every plugin on in a tenant: plugin id -> keys.
pub async fn effective_all(
    k: &Kernel,
    tenant: Uuid,
    user: Uuid,
    role: Role,
) -> Result<HashMap<String, BTreeSet<String>>> {
    let on = crate::plugins::tenants::on_in(k, tenant).await?;
    let plugins: Vec<Arc<LoadedPlugin>> =
        k.plugins.list().into_iter().filter(|p| p.is_active() && on.contains(&p.id)).collect();
    if role == Role::TenantManager {
        return Ok(plugins.iter().map(|p| (p.id.clone(), all_keys(p))).collect());
    }
    let profile = member_profile(k, tenant, user).await?;
    let grants = reaching(k, tenant, user).await?;
    Ok(plugins
        .iter()
        .map(|p| {
            let mut keys = profile_keys(p, profile.as_ref().map(|x| &x.2));
            let all = all_keys(p);
            for g in grants.iter().filter(|g| g.plugin == p.id) {
                keys.extend(g.perms.intersection(&all).cloned());
            }
            (p.id.clone(), keys)
        })
        .collect())
}

/// What the caller may do in a plugin.
pub async fn effective(k: &Kernel, c: &Caller, plugin: &str) -> Result<BTreeSet<String>> {
    Ok(effective_all(k, c.tenant.tenant_id, c.user.user_id, c.tenant.role)
        .await?
        .remove(plugin)
        .unwrap_or_default())
}

/// The active plugin, if the caller has `use` and `perm` in it; with every permission of the caller.
pub async fn require(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    perm: &str,
) -> Result<(Arc<LoadedPlugin>, BTreeSet<String>)> {
    let p = k.plugins.active(plugin)?;
    if !crate::plugins::tenants::is_on(k, c.tenant.tenant_id, plugin).await? {
        return Err(crate::plugins::tenants::off_error(&p));
    }
    let keys = effective(k, c, plugin).await?;
    for need in [USE, perm] {
        if !keys.contains(need) {
            let label = declared(&p, "en")
                .into_iter()
                .find(|d| d.key == need)
                .map(|d| d.label)
                .unwrap_or_else(|| need.to_string());
            return Err(Error::forbidden(format!(
                "your permission profile does not allow «{label}» in {}",
                p.manifest.contribution.label
            ))
            .with_code("missing_permission"));
        }
    }
    Ok((p, keys))
}

/// The plugin with the `use` permission of the caller (every operation of a plugin goes through here).
pub async fn plugin_for(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
) -> Result<(Arc<LoadedPlugin>, BTreeSet<String>)> {
    require(k, c, plugin, USE).await
}

// ------------------------------------------------------------------ explanation

/// One permission of a person with where it comes from.
#[derive(Debug, Clone, Serialize)]
pub struct PermSource {
    pub key: String,
    pub label: String,
    pub standard: bool,
    pub granted: bool,
    /// `manager`, `profile`, `group`, `personal`
    pub sources: Vec<Source>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Source {
    pub kind: &'static str,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginPerms {
    pub plugin_id: String,
    pub label: String,
    pub icon: String,
    pub perms: Vec<PermSource>,
}

/// The permissions of a member in every active plugin, each with its sources (read-only summary).
pub async fn explain(k: &Kernel, tenant: Uuid, user: Uuid, lang: &str) -> Result<Vec<PluginPerms>> {
    let role: Option<String> =
        mosaikit_db::query_scalar("select role from core.memberships where tenant_id = $1 and user_id = $2")
            .bind(tenant)
            .bind(user)
            .fetch_optional(&k.db)
            .await?;
    let role = Role::parse(&role.ok_or_else(|| Error::not_found("member not found"))?)?;
    let profile = member_profile(k, tenant, user).await?;
    let grants = reaching(k, tenant, user).await?;
    let mut out = Vec::new();
    for p in k.plugins.list().into_iter().filter(|p| p.is_active()) {
        let from_profile = profile_keys(&p, profile.as_ref().map(|x| &x.2));
        let perms = declared(&p, lang)
            .into_iter()
            .map(|d| {
                let mut sources = Vec::new();
                if role == Role::TenantManager {
                    sources.push(Source { kind: "manager", name: String::new() });
                }
                if from_profile.contains(&d.key) {
                    sources.push(Source {
                        kind: "profile",
                        name: profile.as_ref().map(|x| x.1.clone()).unwrap_or_else(|| "default".into()),
                    });
                }
                for g in grants.iter().filter(|g| g.plugin == p.id && g.perms.contains(&d.key)) {
                    sources.push(match &g.group {
                        Some(name) => Source { kind: "group", name: name.clone() },
                        None => Source { kind: "personal", name: String::new() },
                    });
                }
                PermSource {
                    granted: !sources.is_empty(),
                    key: d.key,
                    label: d.label,
                    standard: d.standard,
                    sources,
                }
            })
            .collect();
        let m = p.manifest.localized(lang);
        out.push(PluginPerms {
            plugin_id: p.id.clone(),
            label: m.contribution.label.clone(),
            icon: m.contribution.icon.clone(),
            perms,
        });
    }
    Ok(out)
}

// ------------------------------------------------------------------ profiles

#[derive(Debug, Clone, Serialize)]
pub struct ProfileInfo {
    pub id: Uuid,
    pub name: String,
    pub description: String,
    pub is_default: bool,
    /// plugin id -> keys, for every active plugin (the defaults where the profile says nothing)
    pub perms: BTreeMap<String, Vec<String>>,
    /// members with this profile (the default profile counts the members without one too)
    pub members: i64,
    pub created_at: DateTime<Utc>,
}

fn profile_info(k: &Kernel, r: &mosaikit_db::Row) -> ProfileInfo {
    let stored: Value = r.get(4);
    let perms = k
        .plugins
        .list()
        .into_iter()
        .filter(|p| p.is_active())
        .map(|p| (p.id.clone(), profile_keys(&p, Some(&stored)).into_iter().collect()))
        .collect();
    ProfileInfo {
        id: r.get(0),
        name: r.get(1),
        description: r.get(2),
        is_default: r.get(3),
        perms,
        members: r.get(5),
        created_at: r.get(6),
    }
}

const PROFILE_SQL: &str = "
    select p.id, p.name, p.description, p.is_default, p.perms,
           (select count(*) from core.memberships m where m.tenant_id = p.tenant_id
              and (m.profile_id = p.id or (m.profile_id is null and p.is_default) )),
           p.created_at
    from core.permission_profiles p";

pub async fn profiles(k: &Kernel, c: &Caller) -> Result<Vec<ProfileInfo>> {
    c.require_manager()?;
    profiles_of(k, c.tenant.tenant_id).await
}

/// The profiles of a tenant, for the Administrator (role and profile of a person in each tenant).
pub async fn tenant_profiles(
    k: &Kernel,
    admin: &crate::SessionUser,
    tenant: Uuid,
) -> Result<Vec<ProfileInfo>> {
    crate::tenancy::require_admin(admin)?;
    profiles_of(k, tenant).await
}

pub(crate) async fn profiles_of(k: &Kernel, tenant: Uuid) -> Result<Vec<ProfileInfo>> {
    let rows = mosaikit_db::query(format!(
        "{PROFILE_SQL} where p.tenant_id = $1 order by p.is_default desc, p.name"
    ))
    .bind(tenant)
    .fetch_all(&k.db)
    .await?;
    Ok(rows.iter().map(|r| profile_info(k, r)).collect())
}

async fn profile_of(k: &Kernel, tenant: Uuid, id: Uuid) -> Result<ProfileInfo> {
    let row = mosaikit_db::query(format!("{PROFILE_SQL} where p.tenant_id = $1 and p.id = $2"))
        .bind(tenant)
        .bind(id)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(|| Error::not_found("profile not found"))?;
    Ok(profile_info(k, &row))
}

/// A profile of the tenant exists (for memberships and invitations).
pub(crate) async fn check_profile(k: &Kernel, tenant: Uuid, id: Option<Uuid>) -> Result<()> {
    if let Some(id) = id {
        profile_of(k, tenant, id).await?;
    }
    Ok(())
}

fn check_name(name: &str) -> Result<String> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 80 {
        return Err(Error::bad("the name of the profile: 1-80 characters"));
    }
    Ok(n.to_string())
}

/// A new profile, empty (the defaults of every plugin) or a copy of `copy_of`.
pub async fn create_profile(
    k: &Kernel,
    c: &Caller,
    name: &str,
    description: &str,
    copy_of: Option<Uuid>,
) -> Result<ProfileInfo> {
    c.require_manager()?;
    let name = check_name(name)?;
    let perms: Value = match copy_of {
        Some(src) => mosaikit_db::query_scalar(
            "select perms from core.permission_profiles where tenant_id = $1 and id = $2",
        )
        .bind(c.tenant.tenant_id)
        .bind(src)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(|| Error::not_found("profile to copy not found"))?,
        None => json!({}),
    };
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.permission_profiles (tenant_id, name, description, perms) values ($1, $2, $3, $4) returning id",
    )
    .bind(c.tenant.tenant_id)
    .bind(&name)
    .bind(description.trim())
    .bind(perms)
    .fetch_one(&k.db)
    .await
    .map_err(|e| match Error::from(e) {
        err if err.kind == crate::Kind::Conflict => Error::conflict(format!("a profile «{name}» already exists")),
        err => err,
    })?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "profile.create",
        json!({ "name": name }),
    )
    .await;
    profile_of(k, c.tenant.tenant_id, id).await
}

/// Changes name, description, the default profile of the tenant and the permissions in plugins.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ProfileChange {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// becomes the default profile of the tenant
    #[serde(default)]
    pub make_default: bool,
    /// plugin id -> keys (replaces what the profile gives in those plugins)
    #[serde(default)]
    pub plugins: BTreeMap<String, Vec<String>>,
}

pub async fn update_profile(k: &Kernel, c: &Caller, id: Uuid, ch: &ProfileChange) -> Result<ProfileInfo> {
    c.require_manager()?;
    let tenant = c.tenant.tenant_id;
    profile_of(k, tenant, id).await?;
    let mut tx = k.db.begin_app().await?;
    if let Some(n) = &ch.name {
        let n = check_name(n)?;
        mosaikit_db::query("update core.permission_profiles set name = $3 where tenant_id = $1 and id = $2")
            .bind(tenant)
            .bind(id)
            .bind(&n)
            .execute(&mut *tx)
            .await
            .map_err(|e| match Error::from(e) {
                err if err.kind == crate::Kind::Conflict => {
                    Error::conflict(format!("a profile «{n}» already exists"))
                }
                err => err,
            })?;
    }
    if let Some(d) = &ch.description {
        mosaikit_db::query(
            "update core.permission_profiles set description = $3 where tenant_id = $1 and id = $2",
        )
        .bind(tenant)
        .bind(id)
        .bind(d.trim())
        .execute(&mut *tx)
        .await?;
    }
    if ch.make_default {
        mosaikit_db::query(
            "update core.permission_profiles set is_default = false where tenant_id = $1 and is_default",
        )
        .bind(tenant)
        .execute(&mut *tx)
        .await?;
        mosaikit_db::query(
            "update core.permission_profiles set is_default = true where tenant_id = $1 and id = $2",
        )
        .bind(tenant)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    }
    if !ch.plugins.is_empty() {
        let mut stored: Value = mosaikit_db::query_scalar(
            "select perms from core.permission_profiles where tenant_id = $1 and id = $2",
        )
        .bind(tenant)
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if !stored.is_object() {
            stored = json!({});
        }
        for (plugin, keys) in &ch.plugins {
            let p = k.plugins.active(plugin)?;
            stored[plugin] = json!(valid_keys(&p, keys)?);
        }
        mosaikit_db::query("update core.permission_profiles set perms = $3 where tenant_id = $1 and id = $2")
            .bind(tenant)
            .bind(id)
            .bind(stored)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    events::record(
        k,
        Some(tenant),
        Some(c.user.user_id),
        None,
        None,
        "profile.update",
        json!({ "profile": id, "plugins": ch.plugins, "default": ch.make_default }),
    )
    .await;
    profile_of(k, tenant, id).await
}

fn valid_keys(p: &LoadedPlugin, keys: &[String]) -> Result<Vec<String>> {
    let all = all_keys(p);
    let set: BTreeSet<String> = keys.iter().cloned().collect();
    if let Some(bad) = set.iter().find(|k| !all.contains(*k)) {
        return Err(Error::bad(format!("the plugin {} has no permission '{bad}'", p.id)));
    }
    Ok(set.into_iter().collect())
}

/// Deletes a profile that is not the default one: its members get the default profile.
pub async fn delete_profile(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    c.require_manager()?;
    let p = profile_of(k, c.tenant.tenant_id, id).await?;
    if p.is_default {
        return Err(Error::bad("the default profile cannot be deleted: make another one the default first"));
    }
    mosaikit_db::query("delete from core.permission_profiles where tenant_id = $1 and id = $2")
        .bind(c.tenant.tenant_id)
        .bind(id)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "profile.delete",
        json!({ "name": p.name }),
    )
    .await;
    Ok(())
}

/// The profile of a member (`None`: the default profile of the tenant).
pub async fn set_member_profile(k: &Kernel, c: &Caller, user: Uuid, profile: Option<Uuid>) -> Result<()> {
    c.require_manager()?;
    set_member_profile_in(k, c.tenant.tenant_id, c.user.user_id, user, profile).await
}

pub(crate) async fn set_member_profile_in(
    k: &Kernel,
    tenant: Uuid,
    actor: Uuid,
    user: Uuid,
    profile: Option<Uuid>,
) -> Result<()> {
    check_profile(k, tenant, profile).await?;
    let n = mosaikit_db::query(
        "update core.memberships set profile_id = $3 where tenant_id = $1 and user_id = $2",
    )
    .bind(tenant)
    .bind(user)
    .bind(profile)
    .execute(&k.db)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(Error::not_found("member not found"));
    }
    events::record(
        k,
        Some(tenant),
        Some(actor),
        None,
        None,
        "member.profile",
        json!({ "user": user, "profile": profile }),
    )
    .await;
    Ok(())
}

/// The default profile of a new tenant.
pub(crate) async fn create_default_profile(tx: &mut mosaikit_db::Tx, tenant: Uuid) -> Result<()> {
    mosaikit_db::query(
        "insert into core.permission_profiles (tenant_id, name, description, is_default)
         values ($1, 'Standard', 'The permissions every plugin gives by default.', true)",
    )
    .bind(tenant)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------ permissions of a plugin

#[derive(Debug, Clone, Serialize)]
pub struct GrantRow {
    pub principal_type: String,
    pub principal_id: Uuid,
    pub name: String,
    pub detail: String,
    pub perms: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginAccess {
    pub plugin_id: String,
    pub label: String,
    pub icon: String,
    pub permissions: Vec<PermDecl>,
    pub profiles: Vec<ProfileInfo>,
    pub grants: Vec<GrantRow>,
}

async fn grants_of(k: &Kernel, tenant: Uuid, plugin: Option<&str>) -> Result<Vec<(String, GrantRow)>> {
    let rows = mosaikit_db::query(
        "select pg.plugin_id, pg.principal_type, pg.principal_id,
                case when pg.principal_type = 'user' then coalesce(nullif(u.display_name, ''), u.username) else g.name end,
                case when pg.principal_type = 'user' then u.username || '@' || h.slug
                     else (select count(*) from core.group_members gm where gm.group_id = g.id) || '' end,
                pg.perms
         from core.plugin_grants pg
         left join core.users u on pg.principal_type = 'user' and u.id = pg.principal_id
         left join core.tenants h on h.id = u.home_tenant_id
         left join core.groups g on pg.principal_type = 'group' and g.id = pg.principal_id
         where pg.tenant_id = $1 and ($2::text is null or pg.plugin_id = $2)
         order by pg.principal_type, 4",
    )
    .bind(tenant)
    .bind(plugin)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            (
                r.get::<String, _>(0),
                GrantRow {
                    principal_type: r.get(1),
                    principal_id: r.get(2),
                    name: r.get::<Option<String>, _>(3).unwrap_or_default(),
                    detail: r.get::<Option<String>, _>(4).unwrap_or_default(),
                    perms: keys_of(Some(&r.get::<Value, _>(5))).unwrap_or_default().into_iter().collect(),
                },
            )
        })
        .collect())
}

/// The permissions of an active plugin, with the texts in the language of the caller.
#[derive(Debug, Clone, Serialize)]
pub struct PluginPermissions {
    pub plugin_id: String,
    pub label: String,
    pub permissions: Vec<PermDecl>,
}

/// Every active plugin with its permissions (for the permission profiles: names and texts, no identifiers).
pub fn permission_catalog(k: &Kernel, c: &Caller, lang: &str) -> Result<Vec<PluginPermissions>> {
    c.require_manager()?;
    let mut v: Vec<PluginPermissions> = k
        .plugins
        .list()
        .into_iter()
        .filter(|p| p.is_active())
        .map(|p| PluginPermissions {
            plugin_id: p.id.clone(),
            label: p.manifest.localized(lang).contribution.label,
            permissions: declared(&p, lang),
        })
        .collect();
    v.sort_by_key(|a| a.label.to_lowercase());
    Ok(v)
}

/// Who may do what in a plugin: its permissions, the profiles, the grants to groups and people.
pub async fn plugin_access(k: &Kernel, c: &Caller, plugin: &str, lang: &str) -> Result<PluginAccess> {
    c.require_manager()?;
    let p = k.plugins.active(plugin)?;
    let m = p.manifest.localized(lang);
    Ok(PluginAccess {
        plugin_id: p.id.clone(),
        label: m.contribution.label.clone(),
        icon: m.contribution.icon.clone(),
        permissions: declared(&p, lang),
        profiles: profiles_of(k, c.tenant.tenant_id).await?,
        grants: grants_of(k, c.tenant.tenant_id, Some(plugin)).await?.into_iter().map(|(_, g)| g).collect(),
    })
}

/// The grants of plugin permissions to a group or a person (for their summaries).
pub async fn grants_to(
    k: &Kernel,
    tenant: Uuid,
    principal_type: &str,
    principal_id: Uuid,
) -> Result<Vec<(String, Vec<String>)>> {
    Ok(grants_of(k, tenant, None)
        .await?
        .into_iter()
        .filter(|(_, g)| g.principal_type == principal_type && g.principal_id == principal_id)
        .map(|(plugin, g)| (plugin, g.perms))
        .collect())
}

/// Gives (`perms` not empty) or takes back permissions of a plugin to a group or a person of the
/// tenant, on top of their profile.
pub async fn set_plugin_grant(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    principal_type: &str,
    principal_id: Uuid,
    perms: &[String],
) -> Result<()> {
    c.require_manager()?;
    let tenant = c.tenant.tenant_id;
    let p = k.plugins.active(plugin)?;
    let ok: bool = match principal_type {
        "user" => mosaikit_db::query_scalar(
            "select exists (select 1 from core.memberships where tenant_id = $1 and user_id = $2)",
        ),
        "group" => mosaikit_db::query_scalar(
            "select exists (select 1 from core.groups where tenant_id = $1 and id = $2)",
        ),
        _ => return Err(Error::bad("principal_type: user or group")),
    }
    .bind(tenant)
    .bind(principal_id)
    .fetch_one(&k.db)
    .await?;
    if !ok {
        return Err(Error::bad("member or group not found in the tenant"));
    }
    let keys = valid_keys(&p, perms)?;
    if keys.is_empty() {
        mosaikit_db::query(
            "delete from core.plugin_grants where tenant_id = $1 and plugin_id = $2 and principal_type = $3 and principal_id = $4",
        )
        .bind(tenant)
        .bind(plugin)
        .bind(principal_type)
        .bind(principal_id)
        .execute(&k.db)
        .await?;
    } else {
        mosaikit_db::query(
            "insert into core.plugin_grants (tenant_id, plugin_id, principal_type, principal_id, perms, updated_at)
             values ($1, $2, $3, $4, $5, now())
             on conflict (tenant_id, plugin_id, principal_type, principal_id)
             do update set perms = excluded.perms, updated_at = now()",
        )
        .bind(tenant)
        .bind(plugin)
        .bind(principal_type)
        .bind(principal_id)
        .bind(json!(keys))
        .execute(&k.db)
        .await?;
    }
    events::record(
        k,
        Some(tenant),
        Some(c.user.user_id),
        Some(plugin),
        None,
        "plugin.grant",
        json!({ "principal_type": principal_type, "principal_id": principal_id, "perms": keys }),
    )
    .await;
    Ok(())
}
