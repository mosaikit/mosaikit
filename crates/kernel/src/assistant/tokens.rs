//! Personal access tokens of the MCP server: one person, one tenant, read-only unless the person turns writes on.
//! Only the hash of the token is kept; the token is shown once.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::util::{random_token, sha256};
use crate::{events, Caller, Error, Kernel, Kind, Result};

pub const PREFIX: &str = "mska_";
pub const MAX_ACTIVE: i64 = 20;
pub const MAX_DAYS: u32 = 365;

#[derive(Debug, Serialize)]
pub struct TokenInfo {
    pub id: Uuid,
    pub name: String,
    pub allow_write: bool,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct Created {
    #[serde(flatten)]
    pub info: TokenInfo,
    /// shown once
    pub token: String,
}

fn info(r: &mosaikit_db::Row) -> TokenInfo {
    TokenInfo {
        id: r.get(0),
        name: r.get(1),
        allow_write: r.get(2),
        expires_at: r.get(3),
        last_used_at: r.get(4),
        created_at: r.get(5),
    }
}

const COLUMNS: &str = "id, name, allow_write, expires_at, last_used_at, created_at";

pub async fn list(k: &Kernel, c: &Caller) -> Result<Vec<TokenInfo>> {
    let rows = mosaikit_db::query(format!(
        "select {COLUMNS} from core.api_tokens
         where user_id = $1 and tenant_id = $2 and revoked_at is null
           and (expires_at is null or expires_at > now() or refresh_expires_at > now())
         order by created_at desc"
    ))
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .fetch_all(&k.db)
    .await?;
    Ok(rows.iter().map(info).collect())
}

pub async fn create(
    k: &Kernel,
    c: &Caller,
    name: &str,
    allow_write: bool,
    days: Option<u32>,
) -> Result<Created> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(Error::bad("name: 1 to 80 characters"));
    }
    if days.is_some_and(|d| d == 0 || d > MAX_DAYS) {
        return Err(Error::bad(format!("days: 1 to {MAX_DAYS}")));
    }
    let alive = list(k, c).await?.len() as i64;
    if alive >= MAX_ACTIVE {
        return Err(
            Error::new(Kind::TooMany, "too many tokens: revoke some").with_code("assistant_too_many_tokens")
        );
    }
    let token = format!("{PREFIX}{}", random_token(24));
    let id = Uuid::new_v4();
    let row = mosaikit_db::query(format!(
        "insert into core.api_tokens (id, token_hash, user_id, tenant_id, name, allow_write, expires_at)
         values ($1, $2, $3, $4, $5, $6, case when $7::int is null then null else now() + make_interval(days => $7::int) end)
         returning {COLUMNS}"
    ))
    .bind(id)
    .bind(sha256(token.as_bytes()))
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .bind(name)
    .bind(allow_write)
    .bind(days.map(|d| d as i32))
    .fetch_one(&k.db)
    .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "assistant.token_create",
        json!({ "token": id, "name": name, "allow_write": allow_write, "days": days }),
    )
    .await;
    Ok(Created { info: info(&row), token })
}

pub async fn revoke(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    let n = mosaikit_db::query(
        "update core.api_tokens set revoked_at = now()
         where id = $1 and user_id = $2 and tenant_id = $3 and revoked_at is null",
    )
    .bind(id)
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .execute(&k.db)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(Error::not_found("token not found"));
    }
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "assistant.token_revoke",
        json!({ "token": id }),
    )
    .await;
    Ok(())
}

/// A token from a request: the person it belongs to as a caller of its tenant (no Administrator powers), and whether
/// it may write. The same answer for an unknown, revoked or expired token.
pub async fn authenticate(k: &Kernel, token: &str) -> Result<(Caller, bool, Uuid)> {
    let bad = || Error::unauthorized("invalid token").with_code("assistant_bad_token");
    if !token.starts_with(PREFIX) || token.len() > 200 {
        return Err(bad());
    }
    let row = mosaikit_db::query(
        "select id, user_id, tenant_id, allow_write from core.api_tokens
         where token_hash = $1 and revoked_at is null and (expires_at is null or expires_at > now())",
    )
    .bind(sha256(token.as_bytes()))
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(bad)?;
    let (id, user, tenant, write): (Uuid, Uuid, Uuid, bool) =
        (row.get(0), row.get(1), row.get(2), row.get(3));
    if !k.limiter.hit(&format!("mcp:{id}"), 600, std::time::Duration::from_secs(60)) {
        return Err(Error::new(Kind::TooMany, "too many requests: try again in a minute")
            .with_code("assistant_rate_limited"));
    }
    let c = crate::run_tickets::caller_for(k, user, tenant).await.map_err(|_| bad())?;
    let _ = mosaikit_db::query("update core.api_tokens set last_used_at = now() where id = $1")
        .bind(id)
        .execute(&k.db)
        .await;
    Ok((c, write, id))
}
