//! Contents served in an iframe from the untrusted origin: sites from a zip (permission
//! `content`) and files (permission `files`), through tickets bound to the session.

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::blobs::SiteInfo;
use crate::util::{random_token, sha256};
use crate::{events, Caller, Error, Kernel, Result};

const TICKET_HOURS: i32 = 8;

/// Uploads a zip as the content of resource `rid` (write required).
pub async fn upload_site(k: &Kernel, c: &Caller, plugin_id: &str, rid: Uuid, zip: &[u8]) -> Result<SiteInfo> {
    let (p, _) = crate::access::plugin_for(k, c, plugin_id).await?;
    if !p.manifest.permissions.content {
        return Err(Error::forbidden("the plugin does not declare the content permission"));
    }
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let lvl: i32 =
        mosaikit_db::query_scalar("select core.level_of($1)").bind(rid).fetch_one(&mut *tx).await?;
    if lvl == 0 {
        return Err(Error::not_found("resource not found"));
    }
    if lvl < 2 {
        return Err(Error::forbidden("the write permission is required"));
    }
    let before: i64 = mosaikit_db::query_scalar("select size_bytes from core.resources where id = $1")
        .bind(rid)
        .fetch_one(&k.db)
        .await?;
    // checked before the content on disk is replaced: on the size of the zip (the unpacked size counts
    // from then on)
    crate::quotas::check(k, c.tenant.tenant_id, crate::quotas::Add::storage(zip.len() as i64 - before))
        .await?;
    // a zip can inflate far beyond its size: the unpacked content may take at most what the storage quota
    // still leaves (the current content counts as freed)
    let room = crate::quotas::limits(k, c.tenant.tenant_id).await?.storage.map(|limit| (limit, before));
    let room = match room {
        Some((limit, before)) => {
            let used = crate::quotas::usage(k, c.tenant.tenant_id).await?.storage;
            Some((limit - used + before).max(0) as u64)
        }
        None => None,
    };
    let max = room.map_or(crate::blobs::SITE_MAX_BYTES, |r| r.min(crate::blobs::SITE_MAX_BYTES));
    let info = match k.blobs.extract_site_within(c.tenant.tenant_id, rid, zip, max) {
        Err(e)
            if e.code() == "content_too_large" && room.is_some_and(|r| r < crate::blobs::SITE_MAX_BYTES) =>
        {
            return Err(Error::conflict("the unpacked content goes beyond the storage quota of the tenant")
                .with_code("quota_exceeded"));
        }
        r => r?,
    };
    tx.update_resource(rid, None, Some(&json!({ "content": info })), Some(info.size as i64)).await?;
    tx.commit().await?;
    crate::quotas::touched(k, c.tenant.tenant_id);
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&p.id),
        Some(rid),
        "content.upload",
        json!({ "files": info.files, "size": info.size }),
    )
    .await;
    Ok(info)
}

#[derive(Debug, Clone, Serialize)]
pub struct TicketUrl {
    pub url: String,
    pub expires_in: i64,
}

/// Temporary URL (bound to the session) to show a content in an iframe or download it.
pub async fn ticket(k: &Kernel, c: &Caller, plugin_id: &str, rid: Uuid, download: bool) -> Result<TicketUrl> {
    let (p, _) = crate::access::plugin_for(k, c, plugin_id).await?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let row = mosaikit_db::query("select kind, title, meta from core.visible_resources where id = $1")
        .bind(rid)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| Error::not_found("resource not found"))?;
    tx.commit().await?;
    let kind: String = row.get(0);
    let title: String = row.get(1);
    let meta: serde_json::Value = row.get(2);
    let token = random_token(24);
    mosaikit_db::query(
        "insert into core.tickets (token_hash, resource_id, user_id, tenant_id, session_hash, download, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7))",
    )
    .bind(sha256(token.as_bytes()))
    .bind(rid)
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .bind(&c.user.token_hash)
    .bind(download)
    .bind(TICKET_HOURS)
    .execute(&k.db)
    .await?;
    let _ = mosaikit_db::query("delete from core.tickets where expires_at < now()").execute(&k.db).await;
    let tail = if kind == "file" {
        urlencode_path(&title)
    } else {
        meta.pointer("/content/entry").and_then(|v| v.as_str()).map(urlencode_path).unwrap_or_default()
    };
    Ok(TicketUrl {
        url: format!("{}/c/{token}/{tail}", k.cfg.public_url),
        expires_in: TICKET_HOURS as i64 * 3600,
    })
}

fn urlencode_path(p: &str) -> String {
    p.split('/')
        .map(|seg| {
            seg.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                        (b as char).to_string()
                    }
                    _ => format!("%{b:02X}"),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// What a valid ticket serves.
#[derive(Debug, Clone)]
pub struct Target {
    pub tenant: Uuid,
    pub resource: Uuid,
    pub kind: String,
    pub title: String,
    pub download: bool,
}

/// Checks a ticket: not expired, session still valid, read permission still there.
pub async fn resolve_ticket(k: &Kernel, token: &str) -> Result<Target> {
    let row = mosaikit_db::query(
        "select t.resource_id, t.user_id, t.tenant_id, t.download from core.tickets t
         join core.sessions s on s.token_hash = t.session_hash and s.expires_at > now()
         where t.token_hash = $1 and t.expires_at > now()",
    )
    .bind(sha256(token.as_bytes()))
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::forbidden("invalid or expired ticket: open the content again"))?;
    let rid: Uuid = row.get(0);
    let user: Uuid = row.get(1);
    let tenant: Uuid = row.get(2);
    let mut tx = k.db.begin(&mosaikit_db::Ctx::user(user, tenant)).await?;
    let r = mosaikit_db::query("select kind, title, core.level_of(id) from core.resources where id = $1")
        .bind(rid)
        .fetch_optional(&mut *tx)
        .await?;
    tx.commit().await?;
    let r = r.ok_or_else(|| Error::not_found("resource not found"))?;
    if r.get::<i32, _>(2) < 1 {
        return Err(Error::forbidden("access revoked"));
    }
    Ok(Target { tenant, resource: rid, kind: r.get(0), title: r.get(1), download: row.get(3) })
}
