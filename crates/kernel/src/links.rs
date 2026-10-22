//! Public links: read only, expiry, optional password, token stored as a hash.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::acl::{require_level, Level};
use crate::identity::{hash_password, verify_password};
use crate::util::{random_token, sha256};
use crate::{events, Caller, Error, Kernel, Result, TenantSettings};

#[derive(Debug, Clone, Serialize)]
pub struct LinkInfo {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub has_password: bool,
    pub view_count: i64,
    pub created_by: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreatedLink {
    #[serde(flatten)]
    pub info: LinkInfo,
    /// shown only at creation: the server keeps only the hash of the token
    pub url: String,
}

pub async fn create(
    k: &Kernel,
    c: &Caller,
    rid: Uuid,
    days: Option<u32>,
    password: Option<&str>,
) -> Result<CreatedLink> {
    let m = require_level(k, c, rid, Level::Manage).await?;
    crate::access::require(k, c, &m.plugin_id, crate::access::SHARE).await?;
    let s = &c.tenant.settings;
    if !s.public_links_enabled {
        return Err(Error::forbidden("public links are turned off for this tenant"));
    }
    // 0 or absent = the maximum lifetime of the tenant (or no expiry if the tenant does not limit it)
    let max = s.public_link_max_days;
    let days = match days {
        Some(0) | None => (max > 0).then_some(max),
        Some(d) if max > 0 && d > max => {
            return Err(Error::bad(format!("maximum lifetime allowed: {max} days")));
        }
        Some(d) => Some(d),
    };
    let pw_hash = match password.map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) if p.chars().count() < 6 => {
            return Err(Error::bad("password of the link: at least 6 characters"))
        }
        Some(p) => Some(hash_password(k, p).await?),
        None => None,
    };
    let token = random_token(24);
    let row = mosaikit_db::query(
        "insert into core.public_links (resource_id, token_hash, expires_at, password_hash, created_by)
         values ($1, $2, case when $3::int is null then null else now() + make_interval(days => $3) end, $4, $5)
         returning id, created_at, expires_at",
    )
    .bind(rid)
    .bind(sha256(token.as_bytes()))
    .bind(days.map(|d| d as i32))
    .bind(&pw_hash)
    .bind(c.user.user_id)
    .fetch_one(&k.db)
    .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&m.plugin_id),
        Some(rid),
        "link.create",
        json!({ "days": days, "password": pw_hash.is_some() }),
    )
    .await;
    crate::notify::link_created(k, c, rid, m.owner_id, &m.title).await;
    Ok(CreatedLink {
        url: format!("{}/p/{token}/", k.cfg.public_url),
        info: LinkInfo {
            id: row.get(0),
            created_at: row.get(1),
            expires_at: row.get(2),
            has_password: pw_hash.is_some(),
            view_count: 0,
            created_by: Some(c.user.username.clone()),
            active: true,
        },
    })
}

pub async fn list(k: &Kernel, c: &Caller, rid: Uuid) -> Result<Vec<LinkInfo>> {
    require_level(k, c, rid, Level::Manage).await?;
    let rows = mosaikit_db::query(
        "select l.id, l.created_at, l.expires_at, l.password_hash is not null, l.view_count, u.username,
                l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
         from core.public_links l left join core.users u on u.id = l.created_by
         where l.resource_id = $1 and l.revoked_at is null order by l.created_at desc",
    )
    .bind(rid)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| LinkInfo {
            id: r.get(0),
            created_at: r.get(1),
            expires_at: r.get(2),
            has_password: r.get(3),
            view_count: r.get(4),
            created_by: r.get(5),
            active: r.get(6),
        })
        .collect())
}

pub async fn revoke(k: &Kernel, c: &Caller, link: Uuid) -> Result<()> {
    let rid: Uuid = mosaikit_db::query_scalar("select resource_id from core.public_links where id = $1")
        .bind(link)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(|| Error::not_found("link not found"))?;
    let m = require_level(k, c, rid, Level::Manage).await?;
    mosaikit_db::query("update core.public_links set revoked_at = now() where id = $1")
        .bind(link)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&m.plugin_id),
        Some(rid),
        "link.revoke",
        json!({}),
    )
    .await;
    Ok(())
}

/// Resolved public link.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub link_id: Uuid,
    pub resource: Uuid,
    pub tenant: Uuid,
    pub plugin_id: String,
    pub kind: String,
    pub title: String,
    pub meta: serde_json::Value,
    pub password_hash: Option<String>,
}

impl Resolved {
    pub fn ctx(&self) -> mosaikit_db::Ctx {
        mosaikit_db::Ctx { tenant: Some(self.tenant), link: Some(self.resource), ..Default::default() }
    }
}

pub async fn resolve(k: &Kernel, token: &str) -> Result<Resolved> {
    let not_found = || Error::not_found("invalid, expired or revoked link");
    if token.len() != 48 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(not_found());
    }
    let row = mosaikit_db::query(
        "select l.id, r.id, r.tenant_id, r.plugin_id, r.kind, r.title, r.meta, l.password_hash, t.settings
         from core.public_links l
         join core.resources r on r.id = l.resource_id
         join core.tenants t on t.id = r.tenant_id and t.status = 'active'
         join core.plugins p on p.id = r.plugin_id and p.status = 'active'
         where l.token_hash = $1 and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())",
    )
    .bind(sha256(token.as_bytes()))
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(not_found)?;
    let settings: TenantSettings = serde_json::from_value(row.get(8)).unwrap_or_default();
    if !settings.public_links_enabled {
        return Err(not_found());
    }
    Ok(Resolved {
        link_id: row.get(0),
        resource: row.get(1),
        tenant: row.get(2),
        plugin_id: row.get(3),
        kind: row.get(4),
        title: row.get(5),
        meta: row.get(6),
        password_hash: row.get(7),
    })
}

pub async fn check_password(k: &Kernel, r: &Resolved, password: &str) -> Result<bool> {
    match &r.password_hash {
        None => Ok(true),
        Some(h) => verify_password(k, Some(h.clone()), password).await,
    }
}

/// Value of the cookie that remembers the unlocking of a password-protected link.
pub fn unlock_cookie_value(k: &Kernel, r: &Resolved) -> String {
    let mut data = k.cookie_secret.clone();
    data.extend_from_slice(format!(":{}:{}", r.link_id, r.password_hash.as_deref().unwrap_or("")).as_bytes());
    hex::encode(sha256(&data))
}

pub async fn count_view(k: &Kernel, r: &Resolved) {
    let _ = mosaikit_db::query("update core.public_links set view_count = view_count + 1 where id = $1")
        .bind(r.link_id)
        .execute(&k.db)
        .await;
    events::record(k, Some(r.tenant), None, Some(&r.plugin_id), Some(r.resource), "link.view", json!({}))
        .await;
}

/// Children visible through a link (publicly shared folders).
pub async fn children(k: &Kernel, r: &Resolved, parent: Uuid) -> Result<Vec<(Uuid, String, String, i64)>> {
    let mut tx = k.db.begin_plugin(&r.plugin_id, &r.ctx()).await?;
    let rows = mosaikit_db::query(
        "select id, kind, title, size_bytes from core.visible_resources where parent_id = $1 order by kind desc, lower(title)",
    )
    .bind(parent)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows.iter().map(|r| (r.get(0), r.get(1), r.get(2), r.get(3))).collect())
}

/// Level of the link on a resource (1 if it is the resource of the link or one of its descendants).
pub async fn covers(k: &Kernel, r: &Resolved, rid: Uuid) -> Result<bool> {
    let mut tx = k.db.begin(&r.ctx()).await?;
    let lvl: i32 =
        mosaikit_db::query_scalar("select core.level_of($1)").bind(rid).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(lvl >= 1)
}
