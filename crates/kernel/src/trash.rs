//! Trash: what is deleted stays here for `trash.retention_days` (30 by default) before it is purged.
//!
//! Deleting a resource (CRUD, files, the logic of a plugin) only marks it (`deleted_at`): the resource and
//! everything under it get level 0 for everybody, in the core and in the tables of the plugins, so they
//! disappear from every list, search and public link. Restoring clears the mark: grants, public links and
//! the rows of the plugin come back as they were. Purging deletes the rows for good (the tables of the
//! plugins follow through their foreign keys) and the contents on disk.
//!
//! Who sees an item of the trash: whoever owns it or deleted it; the Tenant Manager sees the whole trash of
//! the tenant (titles only if the policy `managers_see_titles` allows it). The same people restore it or
//! delete it for good.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::tenancy::levels;
use crate::{events, Caller, Error, Kernel, Result};

/// Days in the trash when the platform says nothing.
pub const DEFAULT_RETENTION_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct TrashItem {
    pub id: Uuid,
    pub plugin_id: String,
    pub kind: String,
    /// empty when the policy of the tenant hides the titles from the manager
    pub title: String,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub deleted_at: DateTime<Utc>,
    pub deleted_by: Option<Uuid>,
    pub deleted_by_name: Option<String>,
    /// the item and what it contains
    pub size_bytes: i64,
    /// when the purge deletes it for good
    pub purge_at: DateTime<Utc>,
    /// it lies inside another item of the trash: it comes back with that one
    pub inside_deleted: bool,
}

/// Days an item stays in the trash (setting of the platform).
pub async fn retention_days(k: &Kernel) -> i64 {
    match levels::effective(k, None).await {
        Ok(s) => {
            s.get("trash.retention_days").and_then(Value::as_i64).unwrap_or(DEFAULT_RETENTION_DAYS).max(1)
        }
        Err(_) => DEFAULT_RETENTION_DAYS,
    }
}

/// The trash of the caller: their items and the ones they deleted; all the tenant for the manager.
pub async fn list(k: &Kernel, c: &Caller, plugin: Option<&str>, q: Option<&str>) -> Result<Vec<TrashItem>> {
    let manager = c.is_manager();
    let see_titles = !manager || c.tenant.settings.managers_see_titles;
    let days = retention_days(k).await;
    let rows = mosaikit_db::query(
        "select r.id, r.plugin_id, r.kind, r.title, r.owner_id, coalesce(nullif(u.display_name, ''), u.username),
                r.deleted_at, r.deleted_by, coalesce(nullif(d.display_name, ''), d.username),
                (r.size_bytes + coalesce((select sum(x.size_bytes) from core.resources x
                                          where r.id = any(x.ancestors)), 0))::bigint,
                exists (select 1 from core.resources a where a.id = any(r.ancestors) and a.deleted_at is not null)
         from core.resources r join core.users u on u.id = r.owner_id
         left join core.users d on d.id = r.deleted_by
         where r.tenant_id = $1 and r.deleted_at is not null
           and ($2 or r.owner_id = $3 or r.deleted_by = $3)
           and ($4::text is null or r.plugin_id = $4)
         order by r.deleted_at desc limit 2000",
    )
    .bind(c.tenant.tenant_id)
    .bind(manager)
    .bind(c.user.user_id)
    .bind(plugin)
    .fetch_all(&k.db)
    .await?;
    let needle = q.map(|q| q.trim().to_lowercase()).filter(|q| !q.is_empty());
    Ok(rows
        .iter()
        .map(|r| {
            let owner_id: Uuid = r.get(4);
            let deleted_by: Option<Uuid> = r.get(7);
            let mine = owner_id == c.user.user_id || deleted_by == Some(c.user.user_id);
            let deleted_at: DateTime<Utc> = r.get(6);
            TrashItem {
                id: r.get(0),
                plugin_id: r.get(1),
                kind: r.get(2),
                title: if see_titles || mine { r.get(3) } else { String::new() },
                owner_id,
                owner_name: r.get(5),
                deleted_at,
                deleted_by,
                deleted_by_name: r.get(8),
                size_bytes: r.get(9),
                purge_at: deleted_at + Duration::days(days),
                inside_deleted: r.get(10),
            }
        })
        .filter(|i| needle.as_deref().is_none_or(|n| i.title.to_lowercase().contains(n)))
        .collect())
}

struct Entry {
    plugin_id: String,
    title: String,
    owner_id: Uuid,
    deleted_by: Option<Uuid>,
    inside_deleted: bool,
}

/// An item of the trash of the tenant that the caller may restore or delete for good.
async fn entry(k: &Kernel, c: &Caller, id: Uuid) -> Result<Entry> {
    let r = mosaikit_db::query(
        "select r.plugin_id, r.owner_id, r.deleted_by,
                exists (select 1 from core.resources a where a.id = any(r.ancestors) and a.deleted_at is not null),
                r.title
         from core.resources r where r.id = $1 and r.tenant_id = $2 and r.deleted_at is not null",
    )
    .bind(id)
    .bind(c.tenant.tenant_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("item not found in the trash").with_code("trash_not_found"))?;
    let e = Entry {
        plugin_id: r.get(0),
        owner_id: r.get(1),
        deleted_by: r.get(2),
        inside_deleted: r.get(3),
        title: r.get(4),
    };
    if !c.is_manager() && e.owner_id != c.user.user_id && e.deleted_by != Some(c.user.user_id) {
        return Err(Error::not_found("item not found in the trash").with_code("trash_not_found"));
    }
    Ok(e)
}

/// Brings an item back where it was, with its shares and links.
pub async fn restore(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    let e = entry(k, c, id).await?;
    if e.inside_deleted {
        return Err(Error::bad("the item is inside another item of the trash: restore that one first")
            .with_code("trash_parent_deleted"));
    }
    if k.plugins.get(&e.plugin_id).is_none() {
        return Err(
            Error::bad("the app of the item is not installed any more").with_code("trash_plugin_missing")
        );
    }
    mosaikit_db::query("update core.resources set deleted_at = null, deleted_by = null where id = $1")
        .bind(id)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&e.plugin_id),
        Some(id),
        "resource.restore",
        json!({ "owner": e.owner_id, "title": e.title }),
    )
    .await;
    Ok(())
}

/// Deletes for good an item and what it contains (rows, grants, links, contents on disk).
async fn purge_ids(k: &Kernel, tenant: Uuid, id: Uuid) -> Result<()> {
    let ids: Vec<Uuid> =
        mosaikit_db::query_scalar("select id from core.resources where id = $1 or $1 = any(ancestors)")
            .bind(id)
            .fetch_all(&k.db)
            .await?;
    mosaikit_db::query("delete from core.resources where id = $1").bind(id).execute(&k.db).await?;
    for g in ids {
        k.blobs.remove(tenant, g);
    }
    Ok(())
}

/// Deletes an item of the trash for good.
pub async fn purge(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    let e = entry(k, c, id).await?;
    purge_ids(k, c.tenant.tenant_id, id).await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&e.plugin_id),
        Some(id),
        "resource.purge",
        json!({ "owner": e.owner_id, "title": e.title }),
    )
    .await;
    Ok(())
}

/// Empties the trash of the caller: their items and the ones they deleted (also for the manager, who
/// deletes the items of the others one by one).
pub async fn empty(k: &Kernel, c: &Caller) -> Result<i64> {
    let ids: Vec<Uuid> = mosaikit_db::query_scalar(
        "select r.id from core.resources r
         where r.tenant_id = $1 and r.deleted_at is not null and (r.owner_id = $2 or r.deleted_by = $2)
           and not exists (select 1 from core.resources a where a.id = any(r.ancestors) and a.deleted_at is not null)",
    )
    .bind(c.tenant.tenant_id)
    .bind(c.user.user_id)
    .fetch_all(&k.db)
    .await?;
    for id in &ids {
        purge_ids(k, c.tenant.tenant_id, *id).await?;
    }
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "trash.empty",
        json!({ "count": ids.len() }),
    )
    .await;
    Ok(ids.len() as i64)
}

/// Purges what has been in the trash longer than the retention of the platform (background work).
pub async fn purge_expired(k: &Kernel) -> Result<u64> {
    let cutoff = Utc::now() - Duration::days(retention_days(k).await);
    let rows = mosaikit_db::query(
        "select r.id, r.tenant_id from core.resources r
         where r.deleted_at is not null and r.deleted_at < $1
           and not exists (select 1 from core.resources a where a.id = any(r.ancestors) and a.deleted_at is not null)",
    )
    .bind(cutoff)
    .fetch_all(&k.db)
    .await?;
    let mut n = 0;
    for r in &rows {
        purge_ids(k, r.get(1), r.get(0)).await?;
        n += 1;
    }
    Ok(n)
}
