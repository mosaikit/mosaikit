//! Keys of outside services at three levels (mockup `system/keys`, `config/keys`, `account/keys`).
//!
//! The services are the ones the installed plugins declare in their manifests (`[[service_keys]]`):
//! no fixed list. Several plugins may declare the same service and share its keys; the first one (in
//! the order of the plugins) gives label and kind, the scopes add up. Keys of a service no installed
//! plugin declares any more stay, shown as not used, until someone removes them.
//!
//! Whoever has a key of their own uses it; otherwise the one of the tenant, if the Tenant Manager
//! shares it (a key not shared serves only the Tenant Managers); otherwise the one of the platform, if
//! the Administrator shares it. Keys are encrypted ([`crate::secret`]) and never go back to the browser:
//! after saving only the last four characters show (the address of a self-hosted model shows whole).

use mosaikit_mskp::KeyScope;
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::require_admin;
use crate::{events, Caller, Error, Kernel, Result, SessionUser};

/// A service declared by the installed plugins, with the plugins that use it.
#[derive(Debug, Clone, Serialize)]
pub struct Service {
    pub id: String,
    pub label: String,
    pub description: String,
    /// the value is an address (shown whole) instead of a secret
    pub address: bool,
    pub scopes: Vec<KeyScope>,
    /// names of the plugins that declare it
    pub plugins: Vec<String>,
}

/// The services the installed plugins declare, with the texts in `lang`.
pub fn services(k: &Kernel, lang: &str) -> Vec<Service> {
    let mut out: Vec<Service> = Vec::new();
    let mut list = k.plugins.list();
    list.sort_by(|a, b| a.id.cmp(&b.id));
    for p in list {
        let m = p.manifest.localized(lang);
        for d in &m.service_keys {
            match out.iter_mut().find(|s| s.id == d.id) {
                Some(s) => {
                    for sc in &d.scopes {
                        if !s.scopes.contains(sc) {
                            s.scopes.push(*sc);
                        }
                    }
                    s.plugins.push(m.contribution.label.clone());
                }
                None => out.push(Service {
                    id: d.id.clone(),
                    label: d.label.clone(),
                    description: d.description.clone(),
                    address: d.address,
                    scopes: d.scopes.clone(),
                    plugins: vec![m.contribution.label.clone()],
                }),
            }
        }
    }
    out.sort_by_key(|s| s.label.to_lowercase());
    out
}

fn service(k: &Kernel, id: &str, scope: Option<KeyScope>) -> Result<Service> {
    services(k, "en")
        .into_iter()
        .find(|s| s.id == id && scope.is_none_or(|sc| s.scopes.contains(&sc)))
        .ok_or_else(|| {
            Error::not_found(format!("no installed plugin uses the service {id} here"))
                .with_code("service_unknown")
        })
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
    fn scope(self) -> KeyScope {
        match self {
            Level::Platform => KeyScope::Platform,
            Level::Tenant(_) => KeyScope::Tenant,
            Level::User(_) => KeyScope::Personal,
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
    pub service: String,
    pub label: String,
    pub description: String,
    /// the value is an address, shown whole
    pub address: bool,
    /// names of the plugins that use the service (empty: no installed plugin declares it any more)
    pub plugins: Vec<String>,
    /// an installed plugin declares the service; otherwise the key is not used and can only be removed
    pub declared: bool,
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

fn info(s: &Service, own: Option<&Row>, in_use: &'static str) -> KeyInfo {
    KeyInfo {
        service: s.id.clone(),
        label: s.label.clone(),
        description: s.description.clone(),
        address: s.address,
        plugins: s.plugins.clone(),
        declared: true,
        set: own.is_some(),
        hint: own.map(|r| r.hint.clone()),
        shared: own.is_some_and(|r| r.shared),
        updated_at: own.map(|r| r.updated_at),
        in_use,
    }
}

/// The services of a level, then the keys of services no installed plugin declares any more.
fn listing(
    k: &Kernel,
    level: Level,
    lang: &str,
    own: &[Row],
    in_use: impl Fn(&Service, Option<&Row>) -> &'static str,
) -> Vec<KeyInfo> {
    let all = services(k, lang);
    let mut out: Vec<KeyInfo> = all
        .iter()
        .filter(|s| s.scopes.contains(&level.scope()))
        .map(|s| {
            let r = own.iter().find(|r| r.service == s.id);
            info(s, r, in_use(s, r))
        })
        .collect();
    let listed: Vec<String> = out.iter().map(|i| i.service.clone()).collect();
    for r in own.iter().filter(|r| !listed.contains(&r.service)) {
        let declared = all.iter().find(|s| s.id == r.service);
        out.push(KeyInfo {
            service: r.service.clone(),
            label: declared.map_or_else(|| r.service.clone(), |s| s.label.clone()),
            description: String::new(),
            address: declared.is_some_and(|s| s.address),
            plugins: Vec::new(),
            declared: false,
            set: true,
            hint: Some(r.hint.clone()),
            shared: r.shared,
            updated_at: Some(r.updated_at),
            in_use: "none",
        });
    }
    out
}

/// The keys of the platform (Administrator).
pub async fn platform_keys(k: &Kernel, admin: &SessionUser, lang: &str) -> Result<Vec<KeyInfo>> {
    require_admin(admin)?;
    let own = rows(k, Level::Platform).await?;
    Ok(listing(k, Level::Platform, lang, &own, |_, r| if r.is_some() { "own" } else { "none" }))
}

/// The keys of the tenant (Tenant Manager), with the one in use for each service.
pub async fn tenant_keys(k: &Kernel, c: &Caller, lang: &str) -> Result<Vec<KeyInfo>> {
    c.require_manager()?;
    let level = Level::Tenant(c.tenant.tenant_id);
    let own = rows(k, level).await?;
    let platform = rows(k, Level::Platform).await?;
    Ok(listing(k, level, lang, &own, |s, r| {
        if r.is_some() {
            "own"
        } else if platform.iter().any(|p| p.service == s.id && p.shared) {
            "platform"
        } else {
            "none"
        }
    }))
}

/// The keys of the person, with the one in use in the tenant where they are working.
pub async fn my_keys(k: &Kernel, c: &Caller, lang: &str) -> Result<Vec<KeyInfo>> {
    let level = Level::User(c.user.user_id);
    let own = rows(k, level).await?;
    let tenant = rows(k, Level::Tenant(c.tenant.tenant_id)).await?;
    let platform = rows(k, Level::Platform).await?;
    let manager = c.is_manager();
    Ok(listing(k, level, lang, &own, |s, r| {
        if r.is_some() {
            "own"
        } else if tenant.iter().any(|t| t.service == s.id && (t.shared || manager)) {
            "tenant"
        } else if platform.iter().any(|p| p.service == s.id && p.shared) {
            "platform"
        } else {
            "none"
        }
    }))
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
    let s = service(k, service_id, Some(level.scope()))?;
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

/// A platform key of the service exists (the seeding of a deployment never overwrites it).
pub(crate) async fn platform_key_exists(k: &Kernel, service_id: &str) -> Result<bool> {
    let n: Option<Uuid> = mosaikit_db::query_scalar(
        "select id from core.service_keys where scope = 'platform' and service = $1",
    )
    .bind(service_id)
    .fetch_optional(&k.db)
    .await?;
    Ok(n.is_some())
}

/// Removes a key; also of a service no installed plugin declares any more.
pub async fn remove_key(k: &Kernel, by: Uuid, level: Level, service_id: &str) -> Result<()> {
    let (scope, tenant, user) = level.filter();
    let n = mosaikit_db::query(
        "delete from core.service_keys
         where scope = $1 and tenant_id is not distinct from $2 and user_id is not distinct from $3 and service = $4",
    )
    .bind(scope)
    .bind(tenant)
    .bind(user)
    .bind(service_id)
    .execute(&k.db)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(Error::not_found("no key to remove"));
    }
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
    service(k, service_id, None)?;
    if let Some(v) = read(k, Level::User(c.user.user_id), service_id, false).await? {
        return Ok(Some(v));
    }
    if let Some(v) = read(k, Level::Tenant(c.tenant.tenant_id), service_id, !c.is_manager()).await? {
        return Ok(Some(v));
    }
    read(k, Level::Platform, service_id, true).await
}
