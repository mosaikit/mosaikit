//! Permissions on resources: metadata, grants, ownership. Metadata listing for managers.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{events, Caller, Error, Kernel, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum Level {
    None = 0,
    Read = 1,
    Write = 2,
    Manage = 3,
}

impl Level {
    pub fn from_i32(n: i32) -> Level {
        match n {
            3 => Level::Manage,
            2 => Level::Write,
            1 => Level::Read,
            _ => Level::None,
        }
    }
    pub fn parse(s: &str) -> Result<Level> {
        match s {
            "read" => Ok(Level::Read),
            "write" => Ok(Level::Write),
            "manage" => Ok(Level::Manage),
            _ => Err(Error::bad(format!("invalid level: {s} (read, write, manage)"))),
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Level::Manage => "manage",
            Level::Write => "write",
            Level::Read => "read",
            Level::None => "none",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ResourceMeta {
    pub id: Uuid,
    pub plugin_id: String,
    pub kind: String,
    pub title: String,
    pub parent_id: Option<Uuid>,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub size_bytes: i64,
    pub meta: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub my_level: &'static str,
    #[serde(skip)]
    pub level: Level,
    pub is_owner: bool,
}

/// Metadata of a resource visible to the caller (otherwise NotFound).
pub async fn meta(k: &Kernel, c: &Caller, rid: Uuid) -> Result<ResourceMeta> {
    let mut tx = k.db.begin(&c.ctx()).await?;
    let row = mosaikit_db::query(
        "select r.id, r.plugin_id, r.kind, r.title, r.parent_id, r.owner_id,
                coalesce(nullif(u.display_name, ''), u.username), r.size_bytes, r.meta, r.created_at, r.updated_at,
                core.level_of(r.id)
         from core.resources r join core.users u on u.id = r.owner_id where r.id = $1",
    )
    .bind(rid)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    let r = row.ok_or_else(|| Error::not_found("resource not found"))?;
    let level = Level::from_i32(r.get(11));
    if level == Level::None {
        return Err(Error::not_found("resource not found"));
    }
    let owner_id: Uuid = r.get(5);
    Ok(ResourceMeta {
        id: r.get(0),
        plugin_id: r.get(1),
        kind: r.get(2),
        title: r.get(3),
        parent_id: r.get(4),
        owner_id,
        owner_name: r.get(6),
        size_bytes: r.get(7),
        meta: r.get(8),
        created_at: r.get(9),
        updated_at: r.get(10),
        my_level: level.name(),
        level,
        is_owner: owner_id == c.user.user_id,
    })
}

pub async fn require_level(k: &Kernel, c: &Caller, rid: Uuid, need: Level) -> Result<ResourceMeta> {
    let m = meta(k, c, rid).await?;
    if m.level < need {
        return Err(Error::forbidden(match need {
            Level::Manage => "the manage permission on the resource is required",
            Level::Write => "the write permission on the resource is required",
            _ => "access denied",
        }));
    }
    Ok(m)
}

#[derive(Debug, Clone, Serialize)]
pub struct GrantInfo {
    pub principal_type: String,
    pub principal_id: Uuid,
    pub name: String,
    pub detail: String,
    pub level: &'static str,
    pub granted_at: DateTime<Utc>,
}

pub async fn grants(k: &Kernel, c: &Caller, rid: Uuid) -> Result<Vec<GrantInfo>> {
    require_level(k, c, rid, Level::Manage).await?;
    let rows = mosaikit_db::query(
        "select g.principal_type, g.principal_id,
                case when g.principal_type = 'user' then coalesce(nullif(u.display_name, ''), u.username) else gr.name end,
                case when g.principal_type = 'user' then u.username || '@' || h.slug else 'group' end,
                g.level, g.granted_at
         from core.grants g
         left join core.users u on g.principal_type = 'user' and u.id = g.principal_id
         left join core.tenants h on h.id = u.home_tenant_id
         left join core.groups gr on g.principal_type = 'group' and gr.id = g.principal_id
         where g.resource_id = $1 order by g.principal_type desc, 3",
    )
    .bind(rid)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| GrantInfo {
            principal_type: r.get(0),
            principal_id: r.get(1),
            name: r.get::<Option<String>, _>(2).unwrap_or_default(),
            detail: r.get::<Option<String>, _>(3).unwrap_or_default(),
            level: Level::from_i32(r.get::<i16, _>(4) as i32).name(),
            granted_at: r.get(5),
        })
        .collect())
}

/// Grants, changes (`Some`) or revokes (`None`) a grant. Requires the manage level.
pub async fn set_grant(
    k: &Kernel,
    c: &Caller,
    rid: Uuid,
    principal_type: &str,
    principal_id: Uuid,
    level: Option<Level>,
) -> Result<()> {
    let m = require_level(k, c, rid, Level::Manage).await?;
    if level.is_some() {
        crate::access::require(k, c, &m.plugin_id, crate::access::SHARE).await?;
    }
    let tenant = c.tenant.tenant_id;
    match principal_type {
        "user" => {
            if principal_id == m.owner_id {
                return Err(Error::bad("the owner already has every permission"));
            }
            let member: bool = mosaikit_db::query_scalar("select core.is_member($1, $2)")
                .bind(principal_id)
                .bind(tenant)
                .fetch_one(&k.db)
                .await?;
            if !member && level.is_some() {
                return Err(Error::bad(
                    "sharing is only with members of the tenant (outsiders must be invited)",
                ));
            }
        }
        "group" => {
            let ok: bool = mosaikit_db::query_scalar(
                "select exists (select 1 from core.groups where id = $1 and tenant_id = $2)",
            )
            .bind(principal_id)
            .bind(tenant)
            .fetch_one(&k.db)
            .await?;
            if !ok {
                return Err(Error::bad("group not found in the tenant"));
            }
        }
        _ => return Err(Error::bad("principal_type: user o group")),
    }
    match level {
        Some(l) if l > Level::None => {
            let new: bool = mosaikit_db::query_scalar(
                "select not exists (select 1 from core.grants
                                    where resource_id = $1 and principal_type = $2 and principal_id = $3)",
            )
            .bind(rid)
            .bind(principal_type)
            .bind(principal_id)
            .fetch_one(&k.db)
            .await?;
            mosaikit_db::query(
                "insert into core.grants (resource_id, principal_type, principal_id, level, granted_by)
                 values ($1, $2, $3, $4, $5)
                 on conflict (resource_id, principal_type, principal_id)
                 do update set level = excluded.level, granted_by = excluded.granted_by, granted_at = now()",
            )
            .bind(rid)
            .bind(principal_type)
            .bind(principal_id)
            .bind(l as i16)
            .bind(c.user.user_id)
            .execute(&k.db)
            .await?;
            if new {
                crate::notify::shared(k, c, rid, &m.plugin_id, &m.title, principal_type, principal_id).await;
            }
        }
        _ => {
            mosaikit_db::query("delete from core.grants where resource_id = $1 and principal_type = $2 and principal_id = $3")
                .bind(rid)
                .bind(principal_type)
                .bind(principal_id)
                .execute(&k.db)
                .await?;
        }
    }
    events::record(
        k,
        Some(tenant),
        Some(c.user.user_id),
        Some(&m.plugin_id),
        Some(rid),
        if level.is_some() { "share" } else { "unshare" },
        json!({ "principal_type": principal_type, "principal_id": principal_id, "level": level.map(Level::name) }),
    )
    .await;
    Ok(())
}

/// Transfers the ownership of a resource: the owner or the manager of the tenant may do it.
pub async fn transfer_owner(k: &Kernel, c: &Caller, rid: Uuid, new_owner: Uuid) -> Result<()> {
    let row =
        mosaikit_db::query(
            "select owner_id, plugin_id from core.resources where id = $1 and tenant_id = $2 and not core.in_trash(id)",
        )
            .bind(rid)
            .bind(c.tenant.tenant_id)
            .fetch_optional(&k.db)
            .await?
            .ok_or_else(|| Error::not_found("resource not found"))?;
    let owner: Uuid = row.get(0);
    let plugin: String = row.get(1);
    if owner != c.user.user_id && !c.is_manager() {
        return Err(Error::forbidden("only the owner or the manager may transfer the ownership"));
    }
    let member: bool = mosaikit_db::query_scalar("select core.is_member($1, $2)")
        .bind(new_owner)
        .bind(c.tenant.tenant_id)
        .fetch_one(&k.db)
        .await?;
    if !member {
        return Err(Error::bad("the new owner is not an active member of the tenant"));
    }
    let mut tx = k.db.begin_app().await?;
    mosaikit_db::query("update core.resources set owner_id = $2, updated_at = now() where id = $1")
        .bind(rid)
        .bind(new_owner)
        .execute(&mut *tx)
        .await?;
    mosaikit_db::query(
        "delete from core.grants where resource_id = $1 and principal_type = 'user' and principal_id = $2",
    )
    .bind(rid)
    .bind(new_owner)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&plugin),
        Some(rid),
        "owner.transfer",
        json!({ "from": owner, "to": new_owner }),
    )
    .await;
    Ok(())
}

/// Metadata (never the content) of the resources of a tenant, for manager and administrator.
#[derive(Debug, Clone, Serialize)]
pub struct ResourceRow {
    pub id: Uuid,
    pub plugin_id: String,
    pub kind: String,
    /// empty if the policy `managers_see_titles` is off
    pub title: String,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub owner_active: bool,
    pub size_bytes: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub shares: i64,
    pub public_links: i64,
}

#[derive(Debug, Default, Clone, serde::Deserialize)]
pub struct ResourceFilter {
    pub owner: Option<Uuid>,
    pub plugin: Option<String>,
    pub q: Option<String>,
}

pub async fn tenant_resources(
    k: &Kernel,
    tenant: Uuid,
    see_titles: bool,
    f: &ResourceFilter,
) -> Result<Vec<ResourceRow>> {
    let like =
        f.q.as_deref()
            .filter(|q| !q.trim().is_empty() && see_titles)
            .map(|q| format!("%{}%", crate::util::like_escape(q.trim())));
    // PostgreSQL: the trash of the tenant as one set, not core.in_trash() for every item
    let sql = "select r.id, r.plugin_id, r.kind, case when $2 then r.title else '' end, r.owner_id,
                coalesce(nullif(u.display_name, ''), u.username), u.status = 'active'
                    and exists (select 1 from core.memberships m where m.tenant_id = r.tenant_id and m.user_id = u.id),
                r.size_bytes, r.created_at, r.updated_at,
                (select count(*) from core.grants g where g.resource_id = r.id),
                (select count(*) from core.public_links l where l.resource_id = r.id and l.revoked_at is null
                    and (l.expires_at is null or l.expires_at > now()))
         from core.resources r join core.users u on u.id = r.owner_id
         where r.tenant_id = $1 and not core.in_trash(r.id)
           and ($3::uuid is null or r.owner_id = $3) and ($4::text is null or r.plugin_id = $4)
           and ($5::text is null or r.title ilike $5 escape '\\')
         order by r.updated_at desc limit 1000";
    let rows = mosaikit_db::query(if k.db.is_sqlite() {
        sql.to_string()
    } else {
        sql.replace(
            "not core.in_trash(r.id)",
            "not exists (select 1 from core.trashed($1) x where x.id = r.id)",
        )
    })
    .bind(tenant)
    .bind(see_titles)
    .bind(f.owner)
    .bind(f.plugin.as_deref())
    .bind(like)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| ResourceRow {
            id: r.get(0),
            plugin_id: r.get(1),
            kind: r.get(2),
            title: r.get(3),
            owner_id: r.get(4),
            owner_name: r.get(5),
            owner_active: r.get(6),
            size_bytes: r.get(7),
            created_at: r.get(8),
            updated_at: r.get(9),
            shares: r.get(10),
            public_links: r.get(11),
        })
        .collect())
}

pub async fn manager_resources(k: &Kernel, c: &Caller, f: &ResourceFilter) -> Result<Vec<ResourceRow>> {
    c.require_manager()?;
    tenant_resources(k, c.tenant.tenant_id, c.tenant.settings.managers_see_titles, f).await
}

/// Filters of a page of the items of the tenant (Shares, all items): `show` items, shared or public.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct ResourcePageFilter {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub owner: Option<Uuid>,
    #[serde(default)]
    pub plugin: Option<String>,
    /// items (every one), shared (with people, groups or links), public (with a public link)
    #[serde(default)]
    pub show: Option<String>,
    /// only the ids of every match (for "select all"), up to 10,000
    #[serde(default)]
    pub ids: bool,
}

impl ResourcePageFilter {
    pub fn page(&self) -> crate::paging::PageQuery {
        crate::paging::PageQuery { limit: self.limit, cursor: self.cursor.clone(), q: self.q.clone() }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ResourcePage {
    #[serde(flatten)]
    pub page: crate::paging::Page<ResourceRow>,
    /// counts of the pills, with the owner, plugin and words filters
    pub counts: ResourceCounts,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResourceCounts {
    pub items: i64,
    pub shared: i64,
    pub public: i64,
}

/// A page of the items of the tenant (Tenant Manager), the latest changed first, filtered on the server.
pub async fn manager_resources_page(k: &Kernel, c: &Caller, f: &ResourcePageFilter) -> Result<ResourcePage> {
    c.require_manager()?;
    let tenant = c.tenant.tenant_id;
    let see_titles = c.tenant.settings.managers_see_titles;
    let like = f.page().like().filter(|_| see_titles);
    let trash = if k.db.is_sqlite() {
        "not core.in_trash(r.id)"
    } else {
        "not exists (select 1 from core.trashed($1) x where x.id = r.id)"
    };
    let has_link =
        "exists (select 1 from core.public_links l where l.resource_id = r.id and l.revoked_at is null
                     and (l.expires_at is null or l.expires_at > now()))";
    let has_share = "exists (select 1 from core.grants g where g.resource_id = r.id)";
    let base = format!(
        "r.tenant_id = $1 and {trash}
         and ($3::uuid is null or r.owner_id = $3) and ($4::text is null or r.plugin_id = $4)
         and ($5::text is null or r.title ilike $5 escape '\\')"
    );
    let show = match f.show.as_deref() {
        Some("shared") => format!("({has_share} or {has_link})"),
        Some("public") => has_link.to_string(),
        _ => "true".to_string(),
    };
    let bind = |q: mosaikit_db::Query| {
        q.bind(tenant).bind(see_titles).bind(f.owner).bind(f.plugin.as_deref()).bind(like.clone())
    };
    let counts = bind(mosaikit_db::query(format!(
        "select count(*), coalesce(sum(case when {has_share} or {has_link} then 1 else 0 end), 0),
                coalesce(sum(case when {has_link} then 1 else 0 end), 0)
         from core.resources r where $2::bool is not null and {base}"
    )))
    .fetch_one(&k.db)
    .await?;
    let counts = ResourceCounts { items: counts.get(0), shared: counts.get(1), public: counts.get(2) };
    let total = match f.show.as_deref() {
        Some("shared") => counts.shared,
        Some("public") => counts.public,
        _ => counts.items,
    };
    let ids = if f.ids {
        Some(
            bind(mosaikit_db::query(format!(
                "select r.id from core.resources r where $2::bool is not null and {base} and {show}
                 order by r.updated_at desc, r.id desc limit 10000"
            )))
            .fetch_all(&k.db)
            .await?
            .iter()
            .map(|r| r.get::<Uuid, _>(0))
            .collect(),
        )
    } else {
        None
    };
    let limit = f.page().limit();
    let after = f.page().after()?;
    let cursor = if after.is_some() { "and (r.updated_at, r.id) < ($6::timestamptz, $7::uuid)" } else { "" };
    let mut q = bind(mosaikit_db::query(format!(
        "select r.id, r.plugin_id, r.kind, case when $2 then r.title else '' end, r.owner_id,
                coalesce(nullif(u.display_name, ''), u.username), u.status = 'active'
                    and exists (select 1 from core.memberships m where m.tenant_id = r.tenant_id and m.user_id = u.id),
                r.size_bytes, r.created_at, r.updated_at,
                (select count(*) from core.grants g where g.resource_id = r.id),
                (select count(*) from core.public_links l where l.resource_id = r.id and l.revoked_at is null
                    and (l.expires_at is null or l.expires_at > now())),
                r.updated_at::text
         from core.resources r join core.users u on u.id = r.owner_id
         where {base} and {show} {cursor}
         order by r.updated_at desc, r.id desc limit {}",
        limit + 1
    )));
    if let Some((text, id)) = &after {
        q = q.bind(text.clone()).bind(*id);
    }
    let rows = q.fetch_all(&k.db).await?;
    let items: Vec<(ResourceRow, String)> = rows
        .iter()
        .map(|r| {
            (
                ResourceRow {
                    id: r.get(0),
                    plugin_id: r.get(1),
                    kind: r.get(2),
                    title: r.get(3),
                    owner_id: r.get(4),
                    owner_name: r.get(5),
                    owner_active: r.get(6),
                    size_bytes: r.get(7),
                    created_at: r.get(8),
                    updated_at: r.get(9),
                    shares: r.get(10),
                    public_links: r.get(11),
                },
                r.get(12),
            )
        })
        .collect();
    let p = crate::paging::page(items, limit, total, |(row, key)| (key.clone(), row.id));
    Ok(ResourcePage {
        page: crate::paging::Page {
            items: p.items.into_iter().map(|(x, _)| x).collect(),
            total: p.total,
            next: p.next,
        },
        counts,
        ids,
    })
}

/// Reassigns all the resources of a user in the tenant (e.g. a user who left without reassignment).
pub async fn reassign_all(k: &Kernel, c: &Caller, from: Uuid, to: Uuid) -> Result<i64> {
    c.require_manager()?;
    let member: bool = mosaikit_db::query_scalar("select core.is_member($1, $2)")
        .bind(to)
        .bind(c.tenant.tenant_id)
        .fetch_one(&k.db)
        .await?;
    if !member || from == to {
        return Err(Error::bad("the new owner must be another active member of the tenant"));
    }
    let n = mosaikit_db::query(
        "update core.resources set owner_id = $3, updated_at = now() where tenant_id = $1 and owner_id = $2",
    )
    .bind(c.tenant.tenant_id)
    .bind(from)
    .bind(to)
    .execute(&k.db)
    .await?
    .rows_affected() as i64;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "owner.reassign",
        json!({ "from": from, "to": to, "count": n }),
    )
    .await;
    Ok(n)
}

/// What a revocation removed.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct Revoked {
    pub shares: i64,
    pub links: i64,
}

/// Removes every share and revokes every public link of an item: whoever manages it, or the Tenant
/// Manager for any item of the tenant (the Shares page). The owner keeps it, nothing is deleted.
pub async fn revoke_all(k: &Kernel, c: &Caller, rid: Uuid) -> Result<Revoked> {
    let row = mosaikit_db::query(
        "select plugin_id, core.level_for($2, tenant_id, id, ancestors) from core.resources
         where id = $1 and tenant_id = $3 and not core.in_trash(id)",
    )
    .bind(rid)
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("resource not found"))?;
    let plugin: String = row.get(0);
    let level: i32 = row.get(1);
    if level < Level::Manage as i32 && !c.is_manager() {
        return Err(Error::not_found("resource not found"));
    }
    let mut tx = k.db.begin_app().await?;
    let shares = mosaikit_db::query("delete from core.grants where resource_id = $1")
        .bind(rid)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64;
    let links = mosaikit_db::query(
        "update core.public_links set revoked_at = now() where resource_id = $1 and revoked_at is null",
    )
    .bind(rid)
    .execute(&mut *tx)
    .await?
    .rows_affected() as i64;
    tx.commit().await?;
    let r = Revoked { shares, links };
    if shares + links > 0 {
        events::record(
            k,
            Some(c.tenant.tenant_id),
            Some(c.user.user_id),
            Some(&plugin),
            Some(rid),
            "share.revoke_all",
            json!({ "shares": shares, "links": links }),
        )
        .await;
    }
    Ok(r)
}

/// An item the caller shared: with whom and with how many links.
#[derive(Debug, Clone, Serialize)]
pub struct SharedByMe {
    pub id: Uuid,
    pub plugin_id: String,
    pub kind: String,
    pub title: String,
    /// people and groups, the first ones by name
    pub with: Vec<String>,
    pub shares: i64,
    pub public_links: i64,
    pub updated_at: DateTime<Utc>,
}

/// The items of the caller shared with people, groups or a public link (Home › Shared by me).
pub async fn shared_by_me(k: &Kernel, c: &Caller) -> Result<Vec<SharedByMe>> {
    let rows = mosaikit_db::query(
        "select r.id, r.plugin_id, r.kind, r.title, r.updated_at,
                (select count(*) from core.grants g where g.resource_id = r.id),
                (select count(*) from core.public_links l where l.resource_id = r.id and l.revoked_at is null
                    and (l.expires_at is null or l.expires_at > now()))
         from core.resources r
         where r.tenant_id = $1 and r.owner_id = $2 and not core.in_trash(r.id)
           and (exists (select 1 from core.grants g where g.resource_id = r.id)
                or exists (select 1 from core.public_links l where l.resource_id = r.id and l.revoked_at is null
                    and (l.expires_at is null or l.expires_at > now())))
         order by r.updated_at desc limit 200",
    )
    .bind(c.tenant.tenant_id)
    .bind(c.user.user_id)
    .fetch_all(&k.db)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let id: Uuid = r.get(0);
        let names: Vec<String> = mosaikit_db::query_scalar(
            "select coalesce(case when g.principal_type = 'user' then coalesce(nullif(u.display_name, ''), u.username)
                                  else gr.name end, '')
             from core.grants g
             left join core.users u on g.principal_type = 'user' and u.id = g.principal_id
             left join core.groups gr on g.principal_type = 'group' and gr.id = g.principal_id
             where g.resource_id = $1 order by g.granted_at limit 3",
        )
        .bind(id)
        .fetch_all(&k.db)
        .await?;
        out.push(SharedByMe {
            id,
            plugin_id: r.get(1),
            kind: r.get(2),
            title: r.get(3),
            updated_at: r.get(4),
            with: names,
            shares: r.get(5),
            public_links: r.get(6),
        });
    }
    Ok(out)
}
