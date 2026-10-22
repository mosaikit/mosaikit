//! Requests of access to items: a member who cannot see an item (or only read it) asks to see or edit
//! it; the owner of the item, or a Tenant Manager, approves (a grant to the person), refuses, or (the
//! manager) forwards the decision to the owner. The people involved are notified.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::acl::Level;
use crate::notify::{self, NoteKind};
use crate::{events, Caller, Error, Kernel, Result};

#[derive(Debug, Clone, Serialize)]
pub struct AccessRequest {
    pub id: Uuid,
    pub resource_id: Uuid,
    /// empty when the Tenant Manager does not see the titles of the items of others
    pub title: String,
    pub plugin_id: String,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub requester_id: Uuid,
    pub requester_name: String,
    pub requester_username: String,
    /// read or write
    pub level: &'static str,
    pub message: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    /// the caller is the owner of the item (otherwise a manager)
    pub mine: bool,
}

const REQUEST_SQL: &str = "
    select a.id, a.resource_id, r.title, r.plugin_id, r.owner_id, coalesce(nullif(o.display_name, ''), o.username),
           a.requester_id, coalesce(nullif(q.display_name, ''), q.username), q.username || '@' || h.slug,
           a.level, a.message, a.status, a.created_at
    from core.access_requests a
    join core.resources r on r.id = a.resource_id
    join core.users o on o.id = r.owner_id
    join core.users q on q.id = a.requester_id
    join core.tenants h on h.id = q.home_tenant_id";

fn request(c: &Caller, r: &mosaikit_db::Row) -> AccessRequest {
    let owner: Uuid = r.get(4);
    let mine = owner == c.user.user_id;
    let title: String = r.get(2);
    AccessRequest {
        id: r.get(0),
        resource_id: r.get(1),
        title: if mine || c.tenant.settings.managers_see_titles { title } else { String::new() },
        plugin_id: r.get(3),
        owner_id: owner,
        owner_name: r.get(5),
        requester_id: r.get(6),
        requester_name: r.get(7),
        requester_username: r.get(8),
        level: Level::from_i32(r.get::<i16, _>(9) as i32).name(),
        message: r.get(10),
        status: r.get(11),
        created_at: r.get(12),
        mine,
    }
}

/// Asks to see (`read`) or edit (`write`) an item of the tenant.
pub async fn request_access(
    k: &Kernel,
    c: &Caller,
    rid: Uuid,
    level: Level,
    message: &str,
) -> Result<AccessRequest> {
    if !matches!(level, Level::Read | Level::Write) {
        return Err(Error::bad("one asks to see or to edit an item"));
    }
    let message = message.trim();
    if message.chars().count() > 500 {
        return Err(Error::bad("the message is too long (500 characters at most)"));
    }
    let row = mosaikit_db::query(
        "select r.owner_id, r.title, r.plugin_id, core.level_for($2, r.tenant_id, r.id, r.ancestors)
         from core.resources r where r.id = $1 and r.tenant_id = $3",
    )
    .bind(rid)
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("item not found"))?;
    let owner: Uuid = row.get(0);
    let title: String = row.get(1);
    let plugin: String = row.get(2);
    if row.get::<i32, _>(3) >= level as i32 {
        return Err(Error::bad("you already have this access to the item").with_code("access_already"));
    }
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.access_requests (tenant_id, resource_id, requester_id, level, message)
         values ($1, $2, $3, $4, $5) returning id",
    )
    .bind(c.tenant.tenant_id)
    .bind(rid)
    .bind(c.user.user_id)
    .bind(level as i16)
    .bind(message)
    .fetch_one(&k.db)
    .await
    .map_err(|e| match Error::from(e) {
        err if err.kind == crate::Kind::Conflict => {
            Error::conflict("you already asked for this item: wait for the answer")
                .with_code("access_pending")
        }
        err => err,
    })?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&plugin),
        Some(rid),
        "access.request",
        json!({ "level": level.name() }),
    )
    .await;
    let who = name_of(&c.user.display_name, &c.user.username);
    let item = if title.trim().is_empty() { "an item".to_string() } else { format!("«{title}»") };
    notify::emit(
        k,
        notify::New {
            user: owner,
            tenant: Some(c.tenant.tenant_id),
            kind: NoteKind::Share,
            title: format!("{who} asks to {} {item}", if level == Level::Write { "edit" } else { "see" }),
            body: if message.is_empty() {
                "Approve or refuse in Access requests.".into()
            } else {
                message.to_string()
            },
            link: format!("#/t/{}/requests", c.tenant.slug),
            source: "kernel".into(),
            resource: Some(rid),
            data: json!({ "code": "access.requested", "by": who, "item": title, "level": level.name() }),
        },
    )
    .await;
    one(k, c, id).await
}

async fn one(k: &Kernel, c: &Caller, id: Uuid) -> Result<AccessRequest> {
    let row = mosaikit_db::query(format!("{REQUEST_SQL} where a.id = $1 and a.tenant_id = $2"))
        .bind(id)
        .bind(c.tenant.tenant_id)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(|| Error::not_found("request not found"))?;
    Ok(request(c, &row))
}

/// The open requests the caller decides: all the ones of the tenant for a manager, the ones on the
/// items of the caller otherwise.
pub async fn requests(k: &Kernel, c: &Caller) -> Result<Vec<AccessRequest>> {
    let rows = mosaikit_db::query(format!(
        "{REQUEST_SQL} where a.tenant_id = $1 and a.status in ('pending', 'forwarded')
           and ($3 or r.owner_id = $2) order by a.created_at desc"
    ))
    .bind(c.tenant.tenant_id)
    .bind(c.user.user_id)
    .bind(c.is_manager())
    .fetch_all(&k.db)
    .await?;
    Ok(rows.iter().map(|r| request(c, r)).collect())
}

fn name_of(display: &str, username: &str) -> String {
    if display.trim().is_empty() {
        username.to_string()
    } else {
        display.trim().to_string()
    }
}

/// `approve`, `refuse` or `forward` (managers: the owner decides). Approving gives the person the
/// access asked for (a grant on the item); the requester is told the answer.
pub async fn decide_request(k: &Kernel, c: &Caller, id: Uuid, action: &str) -> Result<AccessRequest> {
    let r = one(k, c, id).await?;
    if !matches!(r.status.as_str(), "pending" | "forwarded") {
        return Err(Error::conflict("the request is already decided"));
    }
    if !r.mine && !c.is_manager() {
        return Err(Error::forbidden("the owner of the item or a Tenant Manager decides"));
    }
    let level = if r.level == "write" { Level::Write } else { Level::Read };
    match action {
        "forward" => {
            c.require_manager()?;
            if r.status == "forwarded" {
                return Err(Error::conflict("already forwarded to the owner"));
            }
            set_status(k, id, "forwarded", None).await?;
            let by = name_of(&c.user.display_name, &c.user.username);
            notify::emit(
                k,
                notify::New {
                    user: r.owner_id,
                    tenant: Some(c.tenant.tenant_id),
                    kind: NoteKind::Share,
                    title: format!("{by} leaves to you the request of {}", r.requester_name),
                    body: "Approve or refuse in Access requests.".into(),
                    link: format!("#/t/{}/requests", c.tenant.slug),
                    source: "kernel".into(),
                    resource: Some(r.resource_id),
                    data: json!({ "code": "access.forwarded", "by": by, "who": r.requester_name }),
                },
            )
            .await;
        }
        "approve" => {
            // a grant to the person, at least the level asked (never lowered)
            let current: Option<i16> = mosaikit_db::query_scalar(
                "select level from core.grants where resource_id = $1 and principal_type = 'user' and principal_id = $2",
            )
            .bind(r.resource_id)
            .bind(r.requester_id)
            .fetch_optional(&k.db)
            .await?;
            let give = current.unwrap_or(0).max(level as i16);
            mosaikit_db::query(
                "insert into core.grants (resource_id, principal_type, principal_id, level, granted_by)
                 values ($1, 'user', $2, $3, $4)
                 on conflict (resource_id, principal_type, principal_id)
                 do update set level = excluded.level, granted_by = excluded.granted_by, granted_at = now()",
            )
            .bind(r.resource_id)
            .bind(r.requester_id)
            .bind(give)
            .bind(c.user.user_id)
            .execute(&k.db)
            .await?;
            set_status(k, id, "approved", Some(c.user.user_id)).await?;
            tell_requester(k, c, &r, true).await;
        }
        "refuse" => {
            set_status(k, id, "refused", Some(c.user.user_id)).await?;
            tell_requester(k, c, &r, false).await;
        }
        _ => return Err(Error::bad("action: approve, refuse or forward")),
    }
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&r.plugin_id),
        Some(r.resource_id),
        &format!("access.{action}"),
        json!({ "requester": r.requester_id, "level": r.level }),
    )
    .await;
    one(k, c, id).await
}

async fn set_status(k: &Kernel, id: Uuid, status: &str, by: Option<Uuid>) -> Result<()> {
    mosaikit_db::query(
        "update core.access_requests set status = $2, decided_by = coalesce($3, decided_by),
                decided_at = case when $3::uuid is null then decided_at else now() end
         where id = $1",
    )
    .bind(id)
    .bind(status)
    .bind(by)
    .execute(&k.db)
    .await?;
    Ok(())
}

async fn tell_requester(k: &Kernel, c: &Caller, r: &AccessRequest, approved: bool) {
    let by = name_of(&c.user.display_name, &c.user.username);
    // the title of the item, also when the manager does not see it: the requester asked for it
    let title: String = mosaikit_db::query_scalar("select title from core.resources where id = $1")
        .bind(r.resource_id)
        .fetch_optional(&k.db)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let item = if title.trim().is_empty() { "the item".to_string() } else { format!("«{title}»") };
    notify::emit(
        k,
        notify::New {
            user: r.requester_id,
            tenant: Some(c.tenant.tenant_id),
            kind: NoteKind::Share,
            title: if approved {
                format!("{by} gave you access to {item}")
            } else {
                format!("{by} refused your request for {item}")
            },
            body: String::new(),
            link: if approved { format!("#/t/{}/item/{}", c.tenant.slug, r.resource_id) } else { String::new() },
            source: "kernel".into(),
            resource: Some(r.resource_id),
            data: json!({ "code": if approved { "access.approved" } else { "access.refused" }, "by": by, "item": title }),
        },
    )
    .await;
}
