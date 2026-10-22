//! Keys of outside services at three levels (mockup `system/keys`, `config/keys`, `account/keys`).
//!
//! Whoever has a key of their own uses it; otherwise the one of the tenant, if the Tenant Manager
//! shares it (a key not shared serves only the Tenant Managers); otherwise the one of the platform, if
//! the Administrator shares it. Keys are encrypted ([`crate::secret`]) and never go back to the browser:
//! after saving only the last four characters show (the address of a self-hosted model shows whole).

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::require_admin;
use crate::{events, Caller, Error, Kernel, Result, SessionUser};

/// A service: id, group, the value is an address (shown) instead of a secret.
pub struct Service {
    pub id: &'static str,
    pub group: &'static str,
    pub address: bool,
}

pub const SERVICES: &[Service] = &[
    Service { id: "ai-hosted", group: "ai", address: false },
    Service { id: "ai-second", group: "ai", address: false },
    Service { id: "ai-local", group: "ai", address: true },
    Service { id: "sms", group: "msg", address: false },
    Service { id: "push", group: "msg", address: false },
    Service { id: "translate", group: "doc", address: false },
    Service { id: "ocr", group: "doc", address: false },
];

fn service(id: &str) -> Result<&'static Service> {
    SERVICES.iter().find(|s| s.id == id).ok_or_else(|| Error::not_found(format!("unknown service: {id}")))
}

/// Where a key belongs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Platform,
    Tenant(Uuid),
    User(Uuid),
}

impl Level {
    /// Associated data of the encryption: a value cannot be moved to another place.
    fn aad(self, service: &str) -> String {
        match self {
            Level::Platform => format!("platform::{service}"),
            Level::Tenant(t) => format!("tenant:{t}:{service}"),
            Level::User(u) => format!("user:{u}:{service}"),
        }
    }
    fn filter(self) -> (&'static str, Option<Uuid>, Option<Uuid>) {
        match self {
            Level::Platform => ("platform", None, None),
            Level::Tenant(t) => ("tenant", Some(t), None),
            Level::User(u) => ("user", None, Some(u)),
        }
    }
}

/// A key as a page shows it.
#[derive(Debug, Clone, Serialize)]
pub struct KeyInfo {
    pub service: &'static str,
    pub group: &'static str,
    /// the value is an address, shown whole
    pub address: bool,
    /// there is a key at this level
    pub set: bool,
    /// last four characters (or the address)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    pub shared: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
    /// the key in use at this level: "own", "tenant", "platform" or "none"
    pub in_use: &'static str,
}

struct Row {
    service: String,
    hint: String,
    shared: bool,
    updated_at: chrono::DateTime<chrono::Utc>,
}

async fn rows(k: &Kernel, level: Level) -> Result<Vec<Row>> {
    let (scope, tenant, user) = level.filter();
    let rs = mosaikit_db::query(
        "select service, hint, shared, updated_at from core.service_keys
         where scope = $1 and tenant_id is not distinct from $2 and user_id is not distinct from $3",
    )
    .bind(scope)
    .bind(tenant)
    .bind(user)
    .fetch_all(&k.db)
    .await?;
    Ok(rs
        .iter()
        .map(|r| Row { service: r.get(0), hint: r.get(1), shared: r.get(2), updated_at: r.get(3) })
        .collect())
}

fn info(s: &'static Service, own: Option<&Row>, in_use: &'static str) -> KeyInfo {
    KeyInfo {
        service: s.id,
        group: s.group,
        address: s.address,
        set: own.is_some(),
        hint: own.map(|r| r.hint.clone()),
        shared: own.is_some_and(|r| r.shared),
        updated_at: own.map(|r| r.updated_at),
        in_use,
    }
}

/// The keys of the platform (Administrator).
pub async fn platform_keys(k: &Kernel, admin: &SessionUser) -> Result<Vec<KeyInfo>> {
    require_admin(admin)?;
    let own = rows(k, Level::Platform).await?;
    Ok(SERVICES
        .iter()
        .map(|s| {
            let r = own.iter().find(|r| r.service == s.id);
            info(s, r, if r.is_some() { "own" } else { "none" })
        })
        .collect())
}

/// The keys of the tenant (Tenant Manager), with the one in use for each service.
pub async fn tenant_keys(k: &Kernel, c: &Caller) -> Result<Vec<KeyInfo>> {
    c.require_manager()?;
    let own = rows(k, Level::Tenant(c.tenant.tenant_id)).await?;
    let platform = rows(k, Level::Platform).await?;
    Ok(SERVICES
        .iter()
        .map(|s| {
            let r = own.iter().find(|r| r.service == s.id);
            let p = platform.iter().any(|r| r.service == s.id && r.shared);
            info(
                s,
                r,
                if r.is_some() {
                    "own"
                } else if p {
                    "platform"
                } else {
                    "none"
                },
            )
        })
        .collect())
}

/// The keys of the person, with the one in use in the tenant where they are working.
pub async fn my_keys(k: &Kernel, c: &Caller) -> Result<Vec<KeyInfo>> {
    let own = rows(k, Level::User(c.user.user_id)).await?;
    let tenant = rows(k, Level::Tenant(c.tenant.tenant_id)).await?;
    let platform = rows(k, Level::Platform).await?;
    let manager = c.is_manager();
    Ok(SERVICES
        .iter()
        .map(|s| {
            let r = own.iter().find(|r| r.service == s.id);
            let t = tenant.iter().any(|r| r.service == s.id && (r.shared || manager));
            let p = platform.iter().any(|r| r.service == s.id && r.shared);
            let in_use = if r.is_some() {
                "own"
            } else if t {
                "tenant"
            } else if p {
                "platform"
            } else {
                "none"
            };
            info(s, r, in_use)
        })
        .collect())
}

/// Saves a key (`value`) and/or whether it is shared (`shared`, not for personal keys).
pub async fn set_key(
    k: &Kernel,
    by: Uuid,
    level: Level,
    service_id: &str,
    value: Option<&str>,
    shared: Option<bool>,
) -> Result<()> {
    let s = service(service_id)?;
    let (scope, tenant, user) = level.filter();
    if matches!(level, Level::User(_)) && shared.is_some() {
        return Err(Error::bad("a personal key is never shared"));
    }
    match value.map(str::trim) {
        Some(v) => {
            if v.is_empty() || v.len() > 4096 || v.chars().any(char::is_control) {
                return Err(Error::bad("invalid key").with_code("key_invalid"));
            }
            if s.address && !(v.starts_with("http://") || v.starts_with("https://")) {
                return Err(Error::bad("an address like http://server:11434").with_code("key_invalid"));
            }
            let hint = if s.address {
                v.to_string()
            } else {
                v.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect()
            };
            let sealed = k.secrets.seal(level.aad(service_id).as_bytes(), v.as_bytes());
            let updated = mosaikit_db::query(
                "update core.service_keys set secret = $5, hint = $6, shared = coalesce($7, shared),
                        updated_by = $8, updated_at = now()
                 where scope = $1 and tenant_id is not distinct from $2 and user_id is not distinct from $3
                   and service = $4",
            )
            .bind(scope)
            .bind(tenant)
            .bind(user)
            .bind(service_id)
            .bind(&sealed)
            .bind(&hint)
            .bind(shared)
            .bind(by)
            .execute(&k.db)
            .await?
            .rows_affected();
            if updated == 0 {
                mosaikit_db::query(
                    "insert into core.service_keys (scope, tenant_id, user_id, service, secret, hint, shared, updated_by)
                     values ($1, $2, $3, $4, $5, $6, $7, $8)",
                )
                .bind(scope)
                .bind(tenant)
                .bind(user)
                .bind(service_id)
                .bind(&sealed)
                .bind(&hint)
                .bind(shared.unwrap_or(false))
                .bind(by)
                .execute(&k.db)
                .await?;
            }
        }
        None => {
            let Some(shared) = shared else { return Ok(()) };
            let n = mosaikit_db::query(
                "update core.service_keys set shared = $5, updated_by = $6, updated_at = now()
                 where scope = $1 and tenant_id is not distinct from $2 and user_id is not distinct from $3
                   and service = $4",
            )
            .bind(scope)
            .bind(tenant)
            .bind(user)
            .bind(service_id)
            .bind(shared)
            .bind(by)
            .execute(&k.db)
            .await?
            .rows_affected();
            if n == 0 {
                return Err(Error::not_found("no key to share"));
            }
        }
    }
    // the value never goes to the log
    events::record(
        k,
        tenant,
        Some(by),
        None,
        None,
        "service.key",
        json!({ "scope": scope, "service": service_id }),
    )
    .await;
    Ok(())
}

pub async fn remove_key(k: &Kernel, by: Uuid, level: Level, service_id: &str) -> Result<()> {
    service(service_id)?;
    let (scope, tenant, user) = level.filter();
    mosaikit_db::query(
        "delete from core.service_keys
         where scope = $1 and tenant_id is not distinct from $2 and user_id is not distinct from $3 and service = $4",
    )
    .bind(scope)
    .bind(tenant)
    .bind(user)
    .bind(service_id)
    .execute(&k.db)
    .await?;
    events::record(
        k,
        tenant,
        Some(by),
        None,
        None,
        "service.key.removed",
        json!({ "scope": scope, "service": service_id }),
    )
    .await;
    Ok(())
}

async fn read(k: &Kernel, level: Level, service_id: &str, only_shared: bool) -> Result<Option<String>> {
    let (scope, tenant, user) = level.filter();
    let row = mosaikit_db::query(
        "select secret, shared from core.service_keys
         where scope = $1 and tenant_id is not distinct from $2 and user_id is not distinct from $3 and service = $4",
    )
    .bind(scope)
    .bind(tenant)
    .bind(user)
    .bind(service_id)
    .fetch_optional(&k.db)
    .await?;
    let Some(r) = row else { return Ok(None) };
    if only_shared && !r.get::<bool, _>(1) {
        return Ok(None);
    }
    let sealed: Vec<u8> = r.get(0);
    let plain = k.secrets.open(level.aad(service_id).as_bytes(), &sealed)?;
    Ok(Some(String::from_utf8(plain).map_err(|e| Error::internal(e.to_string()))?))
}

/// The key in use for a person in a tenant (for the services of the kernel and of the plugins; never
/// sent to the browser).
pub async fn key_in_use(k: &Kernel, c: &Caller, service_id: &str) -> Result<Option<String>> {
    service(service_id)?;
    if let Some(v) = read(k, Level::User(c.user.user_id), service_id, false).await? {
        return Ok(Some(v));
    }
    if let Some(v) = read(k, Level::Tenant(c.tenant.tenant_id), service_id, !c.is_manager()).await? {
        return Ok(Some(v));
    }
    read(k, Level::Platform, service_id, true).await
}
