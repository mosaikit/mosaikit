//! Contenuti serviti in iframe dall'origine untrusted: siti da zip (permesso
//! `content`) e file (permesso `files`), tramite ticket legati alla sessione.

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::blobs::SiteInfo;
use crate::util::{random_token, sha256};
use crate::{events, Caller, Error, Kernel, Result};

const TICKET_HOURS: i32 = 8;

/// Carica uno zip come contenuto della risorsa `rid` (scrittura richiesta).
pub async fn upload_site(k: &Kernel, c: &Caller, plugin_id: &str, rid: Uuid, zip: &[u8]) -> Result<SiteInfo> {
    let p = k.plugins.active(plugin_id)?;
    if !p.manifest.permissions.content {
        return Err(Error::forbidden("il plugin non dichiara il permesso content"));
    }
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let lvl: i32 =
        mosaikit_db::query_scalar("select core.level_of($1)").bind(rid).fetch_one(&mut *tx).await?;
    if lvl == 0 {
        return Err(Error::not_found("risorsa non trovata"));
    }
    if lvl < 2 {
        return Err(Error::forbidden("serve il permesso di scrittura"));
    }
    let info = k.blobs.extract_site(c.tenant.tenant_id, rid, zip)?;
    tx.update_resource(rid, None, Some(&json!({ "content": info })), Some(info.size as i64)).await?;
    tx.commit().await?;
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

/// URL temporaneo (legato alla sessione) per mostrare un contenuto in iframe o scaricarlo.
pub async fn ticket(k: &Kernel, c: &Caller, plugin_id: &str, rid: Uuid, download: bool) -> Result<TicketUrl> {
    let p = k.plugins.active(plugin_id)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let row = mosaikit_db::query("select kind, title, meta from core.visible_resources where id = $1")
        .bind(rid)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| Error::not_found("risorsa non trovata"))?;
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

/// Cosa serve un ticket valido.
#[derive(Debug, Clone)]
pub struct Target {
    pub tenant: Uuid,
    pub resource: Uuid,
    pub kind: String,
    pub title: String,
    pub download: bool,
}

/// Verifica un ticket: non scaduto, sessione ancora valida, permesso di lettura ancora presente.
pub async fn resolve_ticket(k: &Kernel, token: &str) -> Result<Target> {
    let row = mosaikit_db::query(
        "select t.resource_id, t.user_id, t.tenant_id, t.download from core.tickets t
         join core.sessions s on s.token_hash = t.session_hash and s.expires_at > now()
         where t.token_hash = $1 and t.expires_at > now()",
    )
    .bind(sha256(token.as_bytes()))
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::forbidden("ticket non valido o scaduto: riapri il contenuto"))?;
    let rid: Uuid = row.get(0);
    let user: Uuid = row.get(1);
    let tenant: Uuid = row.get(2);
    let mut tx = k.db.begin(&mosaikit_db::Ctx::user(user, tenant)).await?;
    let r = mosaikit_db::query("select kind, title, core.level_of(id) from core.resources where id = $1")
        .bind(rid)
        .fetch_optional(&mut *tx)
        .await?;
    tx.commit().await?;
    let r = r.ok_or_else(|| Error::not_found("risorsa non trovata"))?;
    if r.get::<i32, _>(2) < 1 {
        return Err(Error::forbidden("accesso revocato"));
    }
    Ok(Target { tenant, resource: rid, kind: r.get(0), title: r.get(1), download: row.get(3) })
}
