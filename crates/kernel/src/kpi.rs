//! KPIs: of the kernel (always available) and of the plugins (views `kpi_*`).
//! They are aggregates: whoever looks at them never sees the content of the resources.

use std::collections::HashMap;

use mosaikit_db::qi;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::tenancy::{list_tenants, require_admin, TenantInfo};
use crate::{Caller, Kernel, Result, SessionUser};

#[derive(Debug, Clone, Serialize)]
pub struct ResourceStat {
    pub plugin_id: String,
    pub plugin: String,
    pub kind: String,
    /// items and bytes, the ones in the trash included: they count toward the quotas until purged
    pub count: i64,
    pub bytes: i64,
    /// of which in the trash
    pub trash_count: i64,
    pub trash_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DayStat {
    pub day: String,
    pub events: i64,
    pub users: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CoreKpi {
    pub members: i64,
    pub guests: i64,
    pub groups: i64,
    pub resources: Vec<ResourceStat>,
    pub shares: i64,
    pub public_links: i64,
    pub link_views: i64,
    pub active_users_30d: i64,
    pub activity: Vec<DayStat>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginKpi {
    pub plugin_id: String,
    pub plugin: String,
    pub view: String,
    pub label: String,
    /// labels of the columns (missing: the name of the column)
    pub columns: std::collections::BTreeMap<String, String>,
    pub rows: Vec<Value>,
}

/// The texts of the KPIs of the plugins (name of the plugin, label, columns) in `lang`.
pub fn localize(k: &Kernel, kpis: &mut [PluginKpi], lang: &str) {
    for kpi in kpis {
        let Some(p) = k.plugins.get(&kpi.plugin_id) else {
            continue;
        };
        let m = p.manifest.localized(lang);
        kpi.plugin = m.contribution.label.clone();
        if let Some(d) = m.kpi.iter().find(|d| d.view == kpi.view) {
            kpi.label = d.label.clone();
            kpi.columns = d.columns.clone();
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TenantKpi {
    pub tenant: String,
    pub core: CoreKpi,
    pub plugins: Vec<PluginKpi>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TenantSummary {
    #[serde(flatten)]
    pub info: TenantInfo,
    pub active_users_30d: i64,
    pub shares: i64,
    pub public_links: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GlobalKpi {
    pub tenants: Vec<TenantSummary>,
    pub resources: Vec<ResourceStat>,
    pub plugins: Vec<PluginKpi>,
}

fn plugin_label(k: &Kernel, id: &str) -> String {
    k.plugins.get(id).map(|p| p.manifest.contribution.label.clone()).unwrap_or_else(|| id.to_string())
}

async fn resource_stats(k: &Kernel, tenant: Option<Uuid>) -> Result<Vec<ResourceStat>> {
    // PostgreSQL: the items in the trash as one set (core.trashed), not core.in_trash() twice per item;
    // and the tenant as the only condition, so that the plan reads one tenant through its index
    let filter = if tenant.is_some() { "r.tenant_id = $1" } else { "$1::uuid is null" };
    let sql = format!(
        "select r.plugin_id, r.kind, count(*), coalesce(sum(r.size_bytes), 0)::bigint,
                count(x.id), coalesce(sum(case when x.id is not null then r.size_bytes else 0 end), 0)::bigint
         from core.resources r left join core.trashed($1) x on x.id = r.id
         where {filter}
         group by r.plugin_id, r.kind order by 3 desc"
    );
    // SQLite: the same, with the trash as a set too (deleted items and the contents of deleted folders)
    let rows = mosaikit_db::query(sql)
        .sqlite(
            "with roots as (select id from core_resources where deleted_at is not null and (?1 is null or tenant_id = ?1)),
             tr as (select id from roots
                    union select x.id from core_resources x, json_each(x.ancestors) a where a.value in (select id from roots))
             select r.plugin_id, r.kind, count(*), coalesce(sum(r.size_bytes), 0),
                    count(tr.id), coalesce(sum(case when tr.id is not null then r.size_bytes else 0 end), 0)
             from core_resources r left join tr on tr.id = r.id
             where (?1 is null or r.tenant_id = ?1)
             group by r.plugin_id, r.kind order by 3 desc",
        )
        .bind(tenant)
        .fetch_all(&k.db)
        .await?;
    Ok(rows
        .iter()
        .map(|r| {
            let id: String = r.get(0);
            ResourceStat {
                plugin: plugin_label(k, &id),
                plugin_id: id,
                kind: r.get(1),
                count: r.get(2),
                bytes: r.get(3),
                trash_count: r.get(4),
                trash_bytes: r.get(5),
            }
        })
        .collect())
}

pub(crate) async fn core(k: &Kernel, tenant: Uuid) -> Result<CoreKpi> {
    let r = mosaikit_db::query(
        "select
           (select count(*) from core.memberships m join core.users u on u.id = m.user_id where m.tenant_id = $1 and u.home_tenant_id = $1),
           (select count(*) from core.memberships m join core.users u on u.id = m.user_id where m.tenant_id = $1 and u.home_tenant_id <> $1),
           (select count(*) from core.groups where tenant_id = $1),
           (select count(*) from core.grants g join core.resources r on r.id = g.resource_id where r.tenant_id = $1 and not core.in_trash(r.id)),
           (select count(*) from core.public_links l join core.resources r on r.id = l.resource_id
              where r.tenant_id = $1 and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
                and not core.in_trash(r.id)),
           (select coalesce(sum(l.view_count), 0)::bigint from core.public_links l join core.resources r on r.id = l.resource_id where r.tenant_id = $1),
           (select count(distinct user_id) from core.events where tenant_id = $1 and ts > now() - interval '30 days' and user_id is not null)",
    )
    .bind(tenant)
    .fetch_one(&k.db)
    .await?;
    let days = mosaikit_db::query(
        "select to_char(d::date, 'YYYY-MM-DD'), count(e.id), count(distinct e.user_id)
         from generate_series(current_date - 29, current_date, interval '1 day') d
         left join core.events e on e.tenant_id = $1 and e.ts >= d and e.ts < d + interval '1 day'
         group by d order by d",
    )
    .sqlite(
        "with recursive d(day) as (
           select date('now', '-29 days') union all select date(day, '+1 day') from d where day < date('now'))
         select d.day, count(e.id), count(distinct e.user_id)
         from d left join core_events e on e.tenant_id = ?1 and e.ts >= d.day and e.ts < date(d.day, '+1 day')
         group by d.day order by d.day",
    )
    .bind(tenant)
    .fetch_all(&k.db)
    .await?;
    Ok(CoreKpi {
        members: r.get(0),
        guests: r.get(1),
        groups: r.get(2),
        shares: r.get(3),
        public_links: r.get(4),
        link_views: r.get(5),
        active_users_30d: r.get(6),
        resources: resource_stats(k, Some(tenant)).await?,
        activity: days.iter().map(|d| DayStat { day: d.get(0), events: d.get(1), users: d.get(2) }).collect(),
    })
}

/// KPI views of the active plugins; with `tenant` filtered, otherwise with the slug of the tenant.
async fn plugin_kpis(k: &Kernel, tenant: Option<Uuid>) -> Result<Vec<PluginKpi>> {
    let mut out = Vec::new();
    for p in k.plugins.list().iter().filter(|p| p.is_active()) {
        for decl in &p.manifest.kpi {
            // two statements, not `$1 is null or tenant_id = $1`: with the condition alone the planner
            // pushes it into the view (one tenant read through the index on tenant_id) instead of
            // aggregating the whole table of the plugin for every tenant
            let filter = if tenant.is_some() { "v.tenant_id = $1" } else { "$1::uuid is null" };
            let sql = format!(
                "select coalesce(json_agg(x), '[]'::json) from (
                   select t.slug as tenant, v.* from {}.{} v join core.tenants t on t.id = v.tenant_id
                   where {filter} order by t.slug) x",
                qi(&p.schema()),
                qi(&decl.view)
            );
            let rows = if k.db.is_sqlite() {
                // SQLite: no json_agg of whole rows, the JSON is built here
                let sql = format!(
                    "select t.slug as tenant, v.* from {}.{} v join core.tenants t on t.id = v.tenant_id
                     where $1::uuid is null or v.tenant_id = $1 order by t.slug",
                    qi(&p.schema()),
                    qi(&decl.view)
                );
                mosaikit_db::query(sql)
                    .bind(tenant)
                    .fetch_all(&k.db)
                    .await
                    .map(|rows| Value::Array(rows.iter().map(mosaikit_db::Row::to_json).collect()))
            } else {
                mosaikit_db::query_scalar::<Value>(&sql).bind(tenant).fetch_one(&k.db).await
            };
            match rows {
                Ok(Value::Array(rows)) => {
                    let rows = rows
                        .into_iter()
                        .map(|mut r| {
                            if let Some(o) = r.as_object_mut() {
                                o.remove("tenant_id");
                                if tenant.is_some() {
                                    o.remove("tenant");
                                }
                            }
                            r
                        })
                        .collect();
                    out.push(PluginKpi {
                        plugin_id: p.id.clone(),
                        plugin: p.manifest.contribution.label.clone(),
                        view: decl.view.clone(),
                        label: decl.label.clone(),
                        columns: decl.columns.clone(),
                        rows,
                    });
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("KPI {}.{}: {e}", p.id, decl.view),
            }
        }
    }
    Ok(out)
}

/// KPIs of the active tenant (manager).
pub async fn tenant(k: &Kernel, c: &Caller) -> Result<TenantKpi> {
    c.require_manager()?;
    Ok(TenantKpi {
        tenant: c.tenant.slug.clone(),
        core: core(k, c.tenant.tenant_id).await?,
        plugins: plugin_kpis(k, Some(c.tenant.tenant_id)).await?,
    })
}

/// KPIs of every tenant (system administrator).
pub async fn global(k: &Kernel, admin: &SessionUser) -> Result<GlobalKpi> {
    require_admin(admin)?;
    let mut tenants = Vec::new();
    // PostgreSQL: the figures of every tenant in one query (one pass on the events, the shares and the
    // links), not three queries per tenant
    let mut by_tenant: HashMap<Uuid, (i64, i64, i64)> = HashMap::new();
    if !k.db.is_sqlite() {
        for r in mosaikit_db::query(
            "with tr as materialized (select id from core.trashed(null)),
             ev as (select tenant_id, count(distinct user_id) as n from core.events
                    where ts > now() - interval '30 days' and user_id is not null group by tenant_id),
             sh as (select r.tenant_id, count(*) as n from core.grants g join core.resources r on r.id = g.resource_id
                    where not exists (select 1 from tr where tr.id = r.id) group by r.tenant_id),
             li as (select r.tenant_id, count(*) as n from core.public_links l join core.resources r on r.id = l.resource_id
                    where l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
                      and not exists (select 1 from tr where tr.id = r.id) group by r.tenant_id)
             select t.id, coalesce(ev.n, 0), coalesce(sh.n, 0), coalesce(li.n, 0)
             from core.tenants t
             left join ev on ev.tenant_id = t.id left join sh on sh.tenant_id = t.id left join li on li.tenant_id = t.id",
        )
        .fetch_all(&k.db)
        .await?
        {
            by_tenant.insert(r.get(0), (r.get(1), r.get(2), r.get(3)));
        }
    }
    for t in list_tenants(k, admin).await? {
        if let Some(&(active, shares, links)) = by_tenant.get(&t.id) {
            tenants.push(TenantSummary { info: t, active_users_30d: active, shares, public_links: links });
            continue;
        }
        let r = mosaikit_db::query(
            "select
               (select count(distinct user_id) from core.events where tenant_id = $1 and ts > now() - interval '30 days' and user_id is not null),
               (select count(*) from core.grants g join core.resources r on r.id = g.resource_id where r.tenant_id = $1 and not core.in_trash(r.id)),
               (select count(*) from core.public_links l join core.resources r on r.id = l.resource_id
                  where r.tenant_id = $1 and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
                    and not core.in_trash(r.id))",
        )
        .bind(t.id)
        .fetch_one(&k.db)
        .await?;
        tenants.push(TenantSummary {
            info: t,
            active_users_30d: r.get(0),
            shares: r.get(1),
            public_links: r.get(2),
        });
    }
    Ok(GlobalKpi { tenants, resources: resource_stats(k, None).await?, plugins: plugin_kpis(k, None).await? })
}
