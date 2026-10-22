//! Overview: the start page after sign-in, with data that depend on the role.
//! - User: their own resources, shares made and received, public links, recent activity;
//! - Tenant Manager: in addition the aggregates of the tenant;
//! - Administrator (account of the system tenant, without a workspace): the aggregates
//!   of the whole system, with [`system_overview`].
//!
//! As for the KPIs, only counts and titles of the resources accessible to the user are visible.

use chrono::{DateTime, Utc};
use serde::Serialize;
use uuid::Uuid;

use crate::kpi::{self, CoreKpi, ResourceStat};
use crate::tenancy::require_admin;
use crate::{Caller, Kernel, Result, Role, SessionUser};

#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    pub role: Role,
    pub me: Personal,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<CoreKpi>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Personal {
    /// resources owned by the user in the tenant, per plugin and kind
    pub resources: Vec<ResourceStat>,
    pub shared_by_me: i64,
    pub shared_with_me: i64,
    pub public_links: i64,
    pub link_views: i64,
    pub recent_shares: Vec<SharedItem>,
    pub activity: Vec<Activity>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SharedItem {
    pub resource_id: Uuid,
    pub plugin_id: String,
    pub plugin: String,
    pub title: String,
    pub owner: String,
    pub level: &'static str,
    pub granted_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Activity {
    pub ts: DateTime<Utc>,
    pub action: String,
    pub plugin_id: Option<String>,
    pub plugin: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SystemOverview {
    pub tenants: i64,
    pub active_tenants: i64,
    pub users: i64,
    pub administrators: i64,
    pub resources: i64,
    pub bytes: i64,
    pub plugins_installed: i64,
    pub plugins_active: i64,
    pub active_users_30d: i64,
}

fn level_name(l: i16) -> &'static str {
    match l {
        3 => "manage",
        2 => "write",
        _ => "read",
    }
}

fn label(k: &Kernel, id: &str) -> String {
    k.plugins.get(id).map(|p| p.manifest.contribution.label.clone()).unwrap_or_else(|| id.to_string())
}

async fn personal(k: &Kernel, c: &Caller) -> Result<Personal> {
    let (me, t) = (c.user.user_id, c.tenant.tenant_id);
    let rows = mosaikit_db::query(
        "select plugin_id, kind, count(*), coalesce(sum(size_bytes), 0)::bigint from core.resources
         where tenant_id = $1 and owner_id = $2 group by plugin_id, kind order by 3 desc",
    )
    .bind(t)
    .bind(me)
    .fetch_all(&k.db)
    .await?;
    let resources = rows
        .iter()
        .map(|r| {
            let id: String = r.get(0);
            ResourceStat {
                plugin: label(k, &id),
                plugin_id: id,
                kind: r.get(1),
                count: r.get(2),
                bytes: r.get(3),
            }
        })
        .collect();
    // grants given directly to the user or to their groups of the tenant
    const TO_ME: &str = "((g.principal_type = 'user' and g.principal_id = $2)
          or (g.principal_type = 'group' and g.principal_id in (
                select gm.group_id from core.group_members gm join core.groups gr on gr.id = gm.group_id
                where gm.user_id = $2 and gr.tenant_id = $1)))";
    let n = mosaikit_db::query(format!(
        "select
           (select count(*) from core.grants g join core.resources r on r.id = g.resource_id
              where r.tenant_id = $1 and r.owner_id = $2),
           (select count(distinct r.id) from core.grants g join core.resources r on r.id = g.resource_id
              where r.tenant_id = $1 and r.owner_id <> $2 and {TO_ME}),
           (select count(*) from core.public_links l join core.resources r on r.id = l.resource_id
              where r.tenant_id = $1 and r.owner_id = $2 and l.revoked_at is null
                and (l.expires_at is null or l.expires_at > now())),
           (select coalesce(sum(l.view_count), 0)::bigint from core.public_links l
              join core.resources r on r.id = l.resource_id where r.tenant_id = $1 and r.owner_id = $2)"
    ))
    .bind(t)
    .bind(me)
    .fetch_one(&k.db)
    .await?;
    let shares = mosaikit_db::query(format!(
        "select r.id, r.plugin_id, r.title, coalesce(nullif(u.display_name, ''), u.username), max(g.level), max(g.granted_at)
         from core.grants g join core.resources r on r.id = g.resource_id join core.users u on u.id = r.owner_id
         where r.tenant_id = $1 and r.owner_id <> $2 and {TO_ME}
         group by r.id, r.plugin_id, r.title, u.display_name, u.username
         order by max(g.granted_at) desc limit 6"
    ))
    .bind(t)
    .bind(me)
    .fetch_all(&k.db)
    .await?;
    let recent_shares = shares
        .iter()
        .map(|r| {
            let pid: String = r.get(1);
            SharedItem {
                resource_id: r.get(0),
                plugin: label(k, &pid),
                plugin_id: pid,
                title: r.get(2),
                owner: r.get(3),
                level: level_name(r.get(4)),
                granted_at: r.get(5),
            }
        })
        .collect();
    // titles only of the resources still owned or accessible (the others stay anonymous)
    let events = mosaikit_db::query(
        "select e.ts, e.action, e.plugin_id,
                case when r.owner_id = $2 or core.level_for($2, r.tenant_id, r.id, r.ancestors) > 0 then r.title end
         from core.events e left join core.resources r on r.id = e.resource_id
         where e.tenant_id = $1 and e.user_id = $2 order by e.ts desc limit 8",
    )
    .bind(t)
    .bind(me)
    .fetch_all(&k.db)
    .await?;
    let activity = events
        .iter()
        .map(|r| {
            let pid: Option<String> = r.get(2);
            Activity {
                ts: r.get(0),
                action: r.get(1),
                plugin: pid.as_deref().map(|p| label(k, p)),
                plugin_id: pid,
                title: r.get(3),
            }
        })
        .collect();
    Ok(Personal {
        resources,
        shared_by_me: n.get(0),
        shared_with_me: n.get(1),
        public_links: n.get(2),
        link_views: n.get(3),
        recent_shares,
        activity,
    })
}

/// Overview of the Administrator: aggregates of the whole system (system tenant excluded).
pub async fn system_overview(k: &Kernel, admin: &SessionUser) -> Result<SystemOverview> {
    require_admin(admin)?;
    let r = mosaikit_db::query(
        "select
           (select count(*) from core.tenants where not is_system),
           (select count(*) from core.tenants where status = 'active' and not is_system),
           (select count(*) from core.users u join core.tenants t on t.id = u.home_tenant_id
             where u.status = 'active' and not t.is_system),
           (select count(*) from core.users where is_system_admin and status = 'active'),
           (select count(*) from core.resources),
           (select coalesce(sum(size_bytes), 0)::bigint from core.resources),
           (select count(*) from core.plugins),
           (select count(*) from core.plugins where status = 'active'),
           (select count(distinct user_id) from core.events where ts > now() - interval '30 days' and user_id is not null)",
    )
    .fetch_one(&k.db)
    .await?;
    Ok(SystemOverview {
        tenants: r.get(0),
        active_tenants: r.get(1),
        users: r.get(2),
        administrators: r.get(3),
        resources: r.get(4),
        bytes: r.get(5),
        plugins_installed: r.get(6),
        plugins_active: r.get(7),
        active_users_30d: r.get(8),
    })
}

/// Overview of the user in the active tenant, according to their role.
pub async fn overview(k: &Kernel, c: &Caller) -> Result<Overview> {
    let manager = c.is_manager();
    Ok(Overview {
        role: c.tenant.role,
        me: personal(k, c).await?,
        tenant: if manager { Some(kpi::core(k, c.tenant.tenant_id).await?) } else { None },
    })
}
