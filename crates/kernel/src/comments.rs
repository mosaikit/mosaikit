//! Comments on resources, native to the shell: any resource of any plugin has a thread of plain-text
//! comments that the people who see the resource read and write (docs/architecture.md, "Comments on
//! resources").
//!
//! * who sees the resource reads and writes: the right is the one `acl::meta` gives the caller, so a
//!   resource the caller may not see is "not found", whatever the plugin says;
//! * a comment is plain text of 1 to [`MAX_BODY`] characters (the page draws it as text, never as HTML) and
//!   a resource holds at most [`MAX_PER_RESOURCE`];
//! * the author deletes their own; whoever manages the resource deletes any;
//! * a comment goes with its resource (foreign key), is never part of a public link and is not copied by
//!   anything that reads the resource;
//! * a person writes at most [`PER_MINUTE`] comments a minute; the audit log gets `comment.add` and
//!   `comment.delete` with the resource and the comment, never the text.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::acl::{self, Level};
use crate::{events, Caller, Error, Kernel, Kind, Result};

/// Longest comment, in characters.
pub const MAX_BODY: usize = 2000;
/// Most comments on one resource.
pub const MAX_PER_RESOURCE: i64 = 1000;
/// Comments a person may write in a minute.
pub const PER_MINUTE: u32 = 20;
const WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Debug, Clone, Serialize)]
pub struct Comment {
    pub id: Uuid,
    pub author_id: Uuid,
    pub author_name: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    /// `true` when the caller wrote it
    pub mine: bool,
    /// `true` when the caller may delete it (the author, or a manager of the resource)
    pub can_delete: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Thread {
    pub comments: Vec<Comment>,
    pub count: i64,
}

/// The resource, if the caller sees it; else "not found". A run ticket has no part in comments.
async fn visible(k: &Kernel, c: &Caller, rid: Uuid) -> Result<acl::ResourceMeta> {
    if c.run.is_some() {
        return Err(Error::forbidden("a run ticket cannot read or write comments"));
    }
    let m = acl::meta(k, c, rid).await.map_err(|e| {
        if e.kind == Kind::Forbidden {
            Error::not_found("resource not found")
        } else {
            e
        }
    })?;
    if m.level < Level::Read {
        return Err(Error::not_found("resource not found"));
    }
    Ok(m)
}

/// The comments of a resource, oldest first.
pub async fn list(k: &Kernel, c: &Caller, rid: Uuid) -> Result<Thread> {
    let m = visible(k, c, rid).await?;
    let rows = mosaikit_db::query(
        "select m.id, m.user_id, coalesce(nullif(u.display_name, ''), u.username), m.body, m.created_at
         from core.resource_comments m join core.users u on u.id = m.user_id
         where m.tenant_id = $1 and m.resource_id = $2
         order by m.created_at, m.id",
    )
    .bind(c.tenant.tenant_id)
    .bind(rid)
    .fetch_all(&k.db)
    .await?;
    let comments: Vec<Comment> = rows
        .iter()
        .map(|r| {
            let author: Uuid = r.get(1);
            let mine = author == c.user.user_id;
            Comment {
                id: r.get(0),
                author_id: author,
                author_name: r.get(2),
                body: r.get(3),
                created_at: r.get(4),
                mine,
                can_delete: mine || m.level >= Level::Manage,
            }
        })
        .collect();
    let count = comments.len() as i64;
    Ok(Thread { comments, count })
}

/// How many comments a resource has (for the band), for a caller who sees it.
pub async fn count(k: &Kernel, c: &Caller, rid: Uuid) -> Result<i64> {
    visible(k, c, rid).await?;
    Ok(mosaikit_db::query_scalar(
        "select count(*) from core.resource_comments where tenant_id = $1 and resource_id = $2",
    )
    .bind(c.tenant.tenant_id)
    .bind(rid)
    .fetch_one(&k.db)
    .await?)
}

/// Adds a comment for the caller.
pub async fn add(k: &Kernel, c: &Caller, rid: Uuid, body: &str) -> Result<Comment> {
    let m = visible(k, c, rid).await?;
    let body = body.trim();
    let len = body.chars().count();
    if len == 0 {
        return Err(Error::bad("the comment is empty").with_code("comment_empty"));
    }
    if len > MAX_BODY {
        return Err(Error::bad(format!("a comment is at most {MAX_BODY} characters")).with_code("comment_too_long"));
    }
    // line breaks and tabs are text; the other control characters are not
    if body.chars().any(|ch| ch.is_control() && !matches!(ch, '\n' | '\t' | '\r')) {
        return Err(Error::bad("the comment has control characters").with_code("comment_invalid"));
    }
    if !k.limiter.hit(&format!("comment:{}", c.user.user_id), PER_MINUTE, WINDOW) {
        return Err(Error::new(Kind::TooMany, "too many comments: try again in a minute")
            .with_code("comment_rate_limited"));
    }
    // the limit is part of the insert, so two requests at once cannot both slip under it
    let row = mosaikit_db::query(
        "insert into core.resource_comments (tenant_id, resource_id, user_id, body)
         select $1, $2, $3, $4
         where (select count(*) from core.resource_comments where resource_id = $2) < $5
         returning id, created_at",
    )
    .bind(c.tenant.tenant_id)
    .bind(rid)
    .bind(c.user.user_id)
    .bind(body)
    .bind(MAX_PER_RESOURCE)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| {
        Error::bad(format!("this resource already has {MAX_PER_RESOURCE} comments")).with_code("too_many_comments")
    })?;
    let id: Uuid = row.get(0);
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&m.plugin_id),
        Some(rid),
        "comment.add",
        json!({ "comment": id }),
    )
    .await;
    Ok(Comment {
        id,
        author_id: c.user.user_id,
        author_name: c.user.display_name.clone(),
        body: body.to_string(),
        created_at: row.get(1),
        mine: true,
        can_delete: true,
    })
}

/// Deletes a comment: its author, or whoever manages the resource.
pub async fn delete(k: &Kernel, c: &Caller, rid: Uuid, comment: Uuid) -> Result<()> {
    let m = visible(k, c, rid).await?;
    let author: Uuid = mosaikit_db::query_scalar(
        "select user_id from core.resource_comments where id = $1 and resource_id = $2 and tenant_id = $3",
    )
    .bind(comment)
    .bind(rid)
    .bind(c.tenant.tenant_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("comment not found"))?;
    if author != c.user.user_id && m.level < Level::Manage {
        return Err(Error::forbidden("only the author or a manager of the resource can delete a comment"));
    }
    mosaikit_db::query("delete from core.resource_comments where id = $1 and resource_id = $2")
        .bind(comment)
        .bind(rid)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&m.plugin_id),
        Some(rid),
        "comment.delete",
        json!({ "comment": comment, "author": author }),
    )
    .await;
    Ok(())
}
