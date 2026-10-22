//! Quotas of the tenants (docs/refactoring-ui.md §6, docs/architecture.md "Quotas and usage").
//!
//! Three quotas exist, the ones the kernel can measure exactly: **storage** (bytes of the items: files
//! and contents), **people** (active memberships, guests included) and **items** (resources of every
//! plugin). There are no quotas per person.
//!
//! - The Administrator sets the quotas of new tenants and the capacity of the platform (System ›
//!   Quotas, in the settings of the system tenant under `quota`), and, on the page of a tenant, quotas
//!   of its own (in the settings of the tenant under `quota`; a quota not listed there is inherited).
//!   Nobody else changes them: for the tenant they are "managed by the platform".
//! - The usage is measured from the data itself with aggregate queries (never with counters that can
//!   drift): an item in the trash still counts until it is deleted for good.
//! - At the limit nothing is deleted: what adds storage, people or items is refused with the code
//!   `quota_exceeded`. The check reads the usage before the change: two additions at the same moment
//!   may go slightly beyond the limit (a soft limit, never a loss of data).
//! - Alerts at 80 %, at 100 % and on the forecast (the limit reached within 30 days at the pace of the
//!   last 30 days) go to the recipients the Tenant Manager chose, once per crossing: a threshold warns
//!   again only after the usage went back below it. They are notifications of the kind `system`.
//! - The usage at the end of each day is kept for the trend (`core.quota_usage`, 400 days).

use std::collections::BTreeMap;

use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::notify::{self, NoteKind};
use crate::tenancy::require_admin;
use crate::{events, Caller, Error, Kernel, Result, SessionUser};

/// A quota.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    /// bytes of the items (files, contents)
    Storage,
    /// active memberships of the tenant
    People,
    /// items of every plugin
    Items,
}

pub const METRICS: &[Metric] = &[Metric::Storage, Metric::People, Metric::Items];

impl Metric {
    pub fn as_str(self) -> &'static str {
        match self {
            Metric::Storage => "storage",
            Metric::People => "people",
            Metric::Items => "items",
        }
    }

    fn parse(s: &str) -> Result<Metric> {
        METRICS
            .iter()
            .copied()
            .find(|m| m.as_str() == s)
            .ok_or_else(|| Error::bad(format!("unknown quota: {s}")).with_code("quota_unknown"))
    }
}

/// A limit for each quota; `None`: no limit.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Limits {
    #[serde(default)]
    pub storage: Option<i64>,
    #[serde(default)]
    pub people: Option<i64>,
    #[serde(default)]
    pub items: Option<i64>,
}

impl Limits {
    pub fn get(&self, m: Metric) -> Option<i64> {
        match m {
            Metric::Storage => self.storage,
            Metric::People => self.people,
            Metric::Items => self.items,
        }
    }

    fn set(&mut self, m: Metric, v: Option<i64>) {
        match m {
            Metric::Storage => self.storage = v,
            Metric::People => self.people = v,
            Metric::Items => self.items = v,
        }
    }

    fn check(&self) -> Result<()> {
        if METRICS.iter().any(|m| self.get(*m).is_some_and(|v| v < 0)) {
            return Err(Error::bad("a quota cannot be negative").with_code("quota_invalid"));
        }
        Ok(())
    }
}

/// What a tenant uses.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Usage {
    pub storage: i64,
    pub people: i64,
    pub items: i64,
}

impl Usage {
    pub fn get(&self, m: Metric) -> i64 {
        match m {
            Metric::Storage => self.storage,
            Metric::People => self.people,
            Metric::Items => self.items,
        }
    }
}

// ------------------------------------------------------------------ stored values

/// Quotas of the platform: what a new tenant takes and how much the platform has in all.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlatformLimits {
    #[serde(default)]
    pub defaults: Limits,
    #[serde(default)]
    pub capacity: Limits,
}

async fn settings_of(k: &Kernel, tenant: Option<Uuid>) -> Result<Value> {
    let v: Option<Value> = match tenant {
        Some(t) => {
            mosaikit_db::query_scalar("select settings from core.tenants where id = $1 and not is_system")
                .bind(t)
                .fetch_optional(&k.db)
                .await?
        }
        None => {
            mosaikit_db::query_scalar("select settings from core.tenants where is_system")
                .fetch_optional(&k.db)
                .await?
        }
    };
    Ok(v.filter(Value::is_object).unwrap_or_else(|| json!({})))
}

async fn write_settings(k: &Kernel, tenant: Option<Uuid>, s: &Value) -> Result<()> {
    match tenant {
        Some(t) => {
            mosaikit_db::query("update core.tenants set settings = $2 where id = $1")
                .bind(t)
                .bind(s)
                .execute(&k.db)
                .await?
        }
        None => {
            mosaikit_db::query("update core.tenants set settings = $1 where is_system")
                .bind(s)
                .execute(&k.db)
                .await?
        }
    };
    Ok(())
}

fn platform_of(s: &Value) -> PlatformLimits {
    s.get("quota").cloned().and_then(|q| serde_json::from_value(q).ok()).unwrap_or_default()
}

/// The quotas a tenant has of its own: metric -> limit (`None`: no limit); a metric not listed is
/// inherited from the platform.
fn own_of(s: &Value) -> BTreeMap<Metric, Option<i64>> {
    let mut out = BTreeMap::new();
    if let Some(q) = s.get("quota").and_then(Value::as_object) {
        for (key, v) in q {
            if let (Ok(m), Some(o)) = (Metric::parse(key), v.as_object()) {
                out.insert(m, o.get("limit").and_then(Value::as_i64));
            }
        }
    }
    out
}

fn effective_of(platform: &PlatformLimits, own: &BTreeMap<Metric, Option<i64>>) -> Limits {
    let mut l = platform.defaults;
    for (m, v) in own {
        l.set(*m, *v);
    }
    l
}

/// The quotas in use for a tenant.
pub async fn limits(k: &Kernel, tenant: Uuid) -> Result<Limits> {
    let platform = platform_of(&settings_of(k, None).await?);
    Ok(effective_of(&platform, &own_of(&settings_of(k, Some(tenant)).await?)))
}

/// What a tenant uses now (an item in the trash still counts).
pub async fn usage(k: &Kernel, tenant: Uuid) -> Result<Usage> {
    let r = mosaikit_db::query(
        "select
           (select coalesce(sum(size_bytes), 0)::bigint from core.resources where tenant_id = $1),
           (select count(*) from core.memberships where tenant_id = $1 and status = 'active'),
           (select count(*) from core.resources where tenant_id = $1)",
    )
    .bind(tenant)
    .fetch_one(&k.db)
    .await?;
    Ok(Usage { storage: r.get(0), people: r.get(1), items: r.get(2) })
}

// ------------------------------------------------------------------ the check

/// What a change adds to the usage of a tenant (negative or zero: nothing to check).
#[derive(Debug, Clone, Copy, Default)]
pub struct Add {
    pub storage: i64,
    pub people: i64,
    pub items: i64,
}

impl Add {
    pub fn items(n: i64) -> Add {
        Add { items: n, ..Add::default() }
    }
    pub fn people(n: i64) -> Add {
        Add { people: n, ..Add::default() }
    }
    pub fn storage(bytes: i64) -> Add {
        Add { storage: bytes, ..Add::default() }
    }

    fn get(&self, m: Metric) -> i64 {
        match m {
            Metric::Storage => self.storage,
            Metric::People => self.people,
            Metric::Items => self.items,
        }
    }
}

fn exceeded(m: Metric, used: i64, limit: i64) -> Error {
    let what = match m {
        Metric::Storage => "storage",
        Metric::People => "people",
        Metric::Items => "items",
    };
    Error::conflict(format!(
        "the {what} quota of the tenant is used up ({used} of {limit}): nothing can be added"
    ))
    .with_code("quota_exceeded")
}

/// Refuses a change that would take the tenant beyond one of its quotas. Existing data is never
/// touched: only additions stop.
pub async fn check(k: &Kernel, tenant: Uuid, add: Add) -> Result<()> {
    if METRICS.iter().all(|m| add.get(*m) <= 0) {
        return Ok(());
    }
    let l = limits(k, tenant).await?;
    if METRICS.iter().all(|m| add.get(*m) <= 0 || l.get(*m).is_none()) {
        return Ok(());
    }
    let u = usage(k, tenant).await?;
    for m in METRICS {
        if let Some(limit) = l.get(*m) {
            let more = add.get(*m);
            if more > 0 && u.get(*m) + more > limit {
                return Err(exceeded(*m, u.get(*m), limit));
            }
        }
    }
    Ok(())
}

/// After a change that added something: the alerts are checked in the background (with background
/// work turned off, as in the tests, `evaluate` is called by hand).
pub fn touched(k: &Kernel, tenant: Uuid) {
    if k.cfg.no_background {
        return;
    }
    if let Some(k) = k.arc() {
        tokio::spawn(async move {
            if let Err(e) = evaluate(&k, tenant).await {
                tracing::warn!("alerts of the quotas: {e}");
            }
        });
    }
}

// ------------------------------------------------------------------ platform (Administrator)

/// One quota as System › Quotas shows it.
#[derive(Debug, Clone, Serialize)]
pub struct PlatformRow {
    pub metric: Metric,
    /// what a new tenant takes (`None`: no limit)
    pub default: Option<i64>,
    /// how much the platform has in all (`None`: not set)
    pub capacity: Option<i64>,
    /// the sum of the quotas of the tenants that are not suspended
    pub given: i64,
    /// tenants without a limit for this quota
    pub unlimited: i64,
    /// the sum of what the tenants use
    pub used: i64,
    /// more is given than the platform has (or tenants without a limit, with a capacity set)
    pub over: bool,
}

/// A tenant in the summary of System › Quotas.
#[derive(Debug, Clone, Serialize)]
pub struct TenantSummary {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub status: String,
    pub limits: Limits,
    /// quotas the tenant has of its own
    pub own: Vec<Metric>,
    pub usage: Usage,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlatformQuotas {
    pub rows: Vec<PlatformRow>,
    pub tenants: Vec<TenantSummary>,
}

async fn tenants(k: &Kernel, platform: &PlatformLimits) -> Result<Vec<TenantSummary>> {
    let rows = mosaikit_db::query(
        "select t.id, t.slug, t.name, t.status, t.settings,
           (select coalesce(sum(size_bytes), 0)::bigint from core.resources r where r.tenant_id = t.id),
           (select count(*) from core.memberships m where m.tenant_id = t.id and m.status = 'active'),
           (select count(*) from core.resources r where r.tenant_id = t.id)
         from core.tenants t where not t.is_system order by lower(t.name)",
    )
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            let s: Option<Value> = r.get(4);
            let own = own_of(&s.unwrap_or_else(|| json!({})));
            TenantSummary {
                id: r.get(0),
                slug: r.get(1),
                name: r.get(2),
                status: r.get(3),
                limits: effective_of(platform, &own),
                own: own.keys().copied().collect(),
                usage: Usage { storage: r.get(5), people: r.get(6), items: r.get(7) },
            }
        })
        .collect())
}

/// System › Quotas: quotas of new tenants, capacity, what is given to and used by the tenants.
pub async fn platform(k: &Kernel, admin: &SessionUser) -> Result<PlatformQuotas> {
    require_admin(admin)?;
    let p = platform_of(&settings_of(k, None).await?);
    let tenants = tenants(k, &p).await?;
    let rows = METRICS
        .iter()
        .map(|&m| {
            let live = tenants.iter().filter(|t| t.status != "suspended");
            let given = live.clone().filter_map(|t| t.limits.get(m)).sum();
            let unlimited = live.clone().filter(|t| t.limits.get(m).is_none()).count() as i64;
            let capacity = p.capacity.get(m);
            PlatformRow {
                metric: m,
                default: p.defaults.get(m),
                capacity,
                given,
                unlimited,
                used: tenants.iter().map(|t| t.usage.get(m)).sum(),
                over: capacity.is_some_and(|c| given > c || unlimited > 0),
            }
        })
        .collect();
    Ok(PlatformQuotas { rows, tenants })
}

/// Changes the quotas of new tenants and the capacity (`None`: no limit, not set).
pub async fn set_platform(k: &Kernel, admin: &SessionUser, limits: PlatformLimits) -> Result<PlatformQuotas> {
    require_admin(admin)?;
    limits.defaults.check()?;
    limits.capacity.check()?;
    let mut s = settings_of(k, None).await?;
    s["quota"] = serde_json::to_value(limits)?;
    write_settings(k, None, &s).await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        "platform.quotas",
        serde_json::to_value(limits)?,
    )
    .await;
    let out = platform(k, admin).await?;
    for t in &out.tenants {
        touched(k, t.id);
    }
    Ok(out)
}

// ------------------------------------------------------------------ a tenant

/// One quota of a tenant: of the platform or of the tenant, with its usage.
#[derive(Debug, Clone, Serialize)]
pub struct QuotaRow {
    pub metric: Metric,
    /// the quota of the platform for new tenants (`None`: no limit)
    pub platform: Option<i64>,
    /// the tenant has a quota of its own (set by the Administrator)
    pub customized: bool,
    /// the quota in use (`None`: no limit)
    pub limit: Option<i64>,
    pub used: i64,
    /// used / limit in percent (`None` without a limit)
    pub percent: Option<i64>,
    /// days until the limit at the pace of the last 30 days (`None`: not growing, or no limit)
    pub forecast_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TenantQuotas {
    pub tenant_id: Uuid,
    pub rows: Vec<QuotaRow>,
}

fn percent(used: i64, limit: Option<i64>) -> Option<i64> {
    limit.map(|l| {
        if l <= 0 {
            if used > 0 {
                100
            } else {
                0
            }
        } else {
            used.saturating_mul(100) / l
        }
    })
}

/// The quotas of a tenant with their usage (Administrator on the tenant page, Tenant Manager in Usage).
pub async fn tenant(k: &Kernel, tenant: Uuid) -> Result<TenantQuotas> {
    let platform = platform_of(&settings_of(k, None).await?);
    let own = own_of(&settings_of(k, Some(tenant)).await?);
    let l = effective_of(&platform, &own);
    let u = usage(k, tenant).await?;
    let history = history(k, tenant, 31).await?;
    let rows = METRICS
        .iter()
        .map(|&m| {
            let limit = l.get(m);
            QuotaRow {
                metric: m,
                platform: platform.defaults.get(m),
                customized: own.contains_key(&m),
                limit,
                used: u.get(m),
                percent: percent(u.get(m), limit),
                forecast_days: limit.and_then(|lim| forecast(&history, m, u.get(m), lim)),
            }
        })
        .collect();
    Ok(TenantQuotas { tenant_id: tenant, rows })
}

/// A change of the quotas of a tenant: `customized: false` goes back to the quota of the platform.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct OwnQuota {
    pub customized: bool,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// The Administrator gives a tenant quotas of its own, or takes them back.
pub async fn set_tenant(
    k: &Kernel,
    admin: &SessionUser,
    tenant: Uuid,
    changes: &BTreeMap<String, OwnQuota>,
) -> Result<TenantQuotas> {
    require_admin(admin)?;
    let mut s = settings_of(k, Some(tenant)).await?;
    if !mosaikit_db::query_scalar::<bool>(
        "select exists(select 1 from core.tenants where id = $1 and not is_system)",
    )
    .bind(tenant)
    .fetch_one(&k.db)
    .await?
    {
        return Err(Error::not_found("tenant not found"));
    }
    if !s.get("quota").is_some_and(Value::is_object) {
        s["quota"] = json!({});
    }
    for (key, c) in changes {
        let m = Metric::parse(key)?;
        if c.limit.is_some_and(|v| v < 0) {
            return Err(Error::bad("a quota cannot be negative").with_code("quota_invalid"));
        }
        let q = s["quota"].as_object_mut().expect("object");
        if c.customized {
            q.insert(m.as_str().into(), json!({ "limit": c.limit }));
        } else {
            q.remove(m.as_str());
        }
    }
    write_settings(k, Some(tenant), &s).await?;
    events::record(
        k,
        Some(tenant),
        Some(admin.user_id),
        None,
        None,
        "tenant.quotas",
        json!({ "quotas": s["quota"] }),
    )
    .await;
    touched(k, tenant);
    self::tenant(k, tenant).await
}

// ------------------------------------------------------------------ trend and forecast

/// One day of the trend.
#[derive(Debug, Clone, Serialize)]
pub struct Day {
    pub day: String,
    pub storage: i64,
    pub people: i64,
    pub items: i64,
}

async fn history(k: &Kernel, tenant: Uuid, days: i64) -> Result<Vec<Day>> {
    let from = (Utc::now().date_naive() - chrono::Duration::days(days.clamp(1, 400))).to_string();
    let rows = mosaikit_db::query(
        "select day, storage, people, items from core.quota_usage where tenant_id = $1 and day >= $2 order by day",
    )
    .bind(tenant)
    .bind(from)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Day { day: r.get(0), storage: r.get(1), people: r.get(2), items: r.get(3) })
        .collect())
}

/// Days until `limit` at the pace of the days in `history` (and the usage of now); `None` if the
/// usage is not growing or there is not at least one day of history.
pub fn forecast(history: &[Day], m: Metric, now: i64, limit: i64) -> Option<i64> {
    let first = history.first()?;
    let start = NaiveDate::parse_from_str(&first.day, "%Y-%m-%d").ok()?;
    let days = (Utc::now().date_naive() - start).num_days();
    if days < 1 {
        return None;
    }
    let from = match m {
        Metric::Storage => first.storage,
        Metric::People => first.people,
        Metric::Items => first.items,
    };
    let growth = (now - from) as f64 / days as f64;
    if growth <= 0.0 {
        return None;
    }
    if now >= limit {
        return Some(0);
    }
    Some(((limit - now) as f64 / growth).ceil() as i64)
}

/// The usage of the last `days` days, today included (Tenant Manager, Usage › Trend).
pub async fn trend(k: &Kernel, c: &Caller, days: i64) -> Result<Vec<Day>> {
    c.require_manager()?;
    let t = c.tenant.tenant_id;
    snapshot(k, t, &usage(k, t).await?).await?;
    history(k, t, days).await
}

/// Keeps the usage of today (the last value of the day stays).
async fn snapshot(k: &Kernel, tenant: Uuid, u: &Usage) -> Result<()> {
    mosaikit_db::query(
        "insert into core.quota_usage (tenant_id, day, storage, people, items) values ($1, $2, $3, $4, $5)
         on conflict (tenant_id, day) do update set storage = excluded.storage, people = excluded.people,
           items = excluded.items",
    )
    .bind(tenant)
    .bind(Utc::now().date_naive().to_string())
    .bind(u.storage)
    .bind(u.people)
    .bind(u.items)
    .execute(&k.db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------ who uses the most

#[derive(Debug, Clone, Serialize)]
pub struct Consumer {
    pub id: String,
    pub name: String,
    pub items: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Consumers {
    pub people: Vec<Consumer>,
    /// items of the members of each group (a person in two groups counts in both)
    pub groups: Vec<Consumer>,
    pub plugins: Vec<Consumer>,
}

/// Who uses the most storage and items in the tenant (Tenant Manager, Usage › Who uses the most).
pub async fn consumers(k: &Kernel, c: &Caller) -> Result<Consumers> {
    c.require_manager()?;
    let t = c.tenant.tenant_id;
    let row =
        |r: &mosaikit_db::Row| Consumer { id: r.get(0), name: r.get(1), items: r.get(2), bytes: r.get(3) };
    let people = mosaikit_db::query(
        "select u.id::text, coalesce(nullif(u.display_name, ''), u.username), count(r.id), coalesce(sum(r.size_bytes), 0)::bigint
         from core.resources r join core.users u on u.id = r.owner_id where r.tenant_id = $1
         group by u.id, u.display_name, u.username order by 4 desc, 3 desc limit 20",
    )
    .bind(t)
    .fetch_all(&k.db)
    .await?
    .iter()
    .map(row)
    .collect();
    let groups = mosaikit_db::query(
        "select g.id::text, g.name, count(r.id), coalesce(sum(r.size_bytes), 0)::bigint
         from core.groups g join core.group_members gm on gm.group_id = g.id
           join core.resources r on r.owner_id = gm.user_id and r.tenant_id = g.tenant_id
         where g.tenant_id = $1 group by g.id, g.name order by 4 desc, 3 desc limit 20",
    )
    .bind(t)
    .fetch_all(&k.db)
    .await?
    .iter()
    .map(row)
    .collect();
    let plugins = mosaikit_db::query(
        "select plugin_id, plugin_id, count(*), coalesce(sum(size_bytes), 0)::bigint from core.resources
         where tenant_id = $1 group by plugin_id order by 4 desc, 3 desc",
    )
    .bind(t)
    .fetch_all(&k.db)
    .await?
    .iter()
    .map(|r| {
        let mut x = row(r);
        x.name = k.plugins.get(&x.id).map(|p| p.manifest.contribution.label.clone()).unwrap_or(x.name);
        x
    })
    .collect();
    Ok(Consumers { people, groups, plugins })
}

// ------------------------------------------------------------------ one's own usage

#[derive(Debug, Clone, Serialize)]
pub struct MyUsage {
    /// what the person owns in the tenant
    pub storage: i64,
    pub items: i64,
    /// the quotas of the tenant: what is used and what is left
    pub tenant: Vec<QuotaRow>,
}

/// Account › Usage: one's own usage and what is left in the tenant (every member).
pub async fn mine(k: &Kernel, c: &Caller) -> Result<MyUsage> {
    let r = mosaikit_db::query(
        "select coalesce(sum(size_bytes), 0)::bigint, count(*) from core.resources where tenant_id = $1 and owner_id = $2",
    )
    .bind(c.tenant.tenant_id)
    .bind(c.user.user_id)
    .fetch_one(&k.db)
    .await?;
    let tenant = tenant(k, c.tenant.tenant_id).await?.rows;
    Ok(MyUsage { storage: r.get(0), items: r.get(1), tenant })
}

/// The quotas at 80 % or more, for the alert in the sidebar (every member).
pub async fn near(k: &Kernel, c: &Caller) -> Result<Vec<QuotaRow>> {
    let l = limits(k, c.tenant.tenant_id).await?;
    if METRICS.iter().all(|m| l.get(*m).is_none()) {
        return Ok(Vec::new());
    }
    Ok(tenant(k, c.tenant.tenant_id)
        .await?
        .rows
        .into_iter()
        .filter(|r| r.percent.is_some_and(|p| p >= 80))
        .collect())
}

// ------------------------------------------------------------------ alerts

/// When and to whom the alerts of the quotas go (Tenant Manager, Usage › Alerts).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Alerts {
    #[serde(default = "yes")]
    pub at_80: bool,
    #[serde(default = "yes")]
    pub at_100: bool,
    #[serde(default = "yes")]
    pub forecast: bool,
    /// the Tenant Managers of the tenant
    #[serde(default = "yes")]
    pub managers: bool,
    /// other people of the tenant
    #[serde(default)]
    pub people: Vec<Uuid>,
    /// the members of these groups
    #[serde(default)]
    pub groups: Vec<Uuid>,
}

fn yes() -> bool {
    true
}

impl Default for Alerts {
    fn default() -> Alerts {
        serde_json::from_value(json!({})).expect("default alerts")
    }
}

fn alerts_of(s: &Value) -> Alerts {
    s.get("quota_alerts").cloned().and_then(|a| serde_json::from_value(a).ok()).unwrap_or_default()
}

pub async fn alerts(k: &Kernel, c: &Caller) -> Result<Alerts> {
    c.require_manager()?;
    Ok(alerts_of(&settings_of(k, Some(c.tenant.tenant_id)).await?))
}

pub async fn set_alerts(k: &Kernel, c: &Caller, a: Alerts) -> Result<Alerts> {
    c.require_manager()?;
    let t = c.tenant.tenant_id;
    if a.people.len() > 50 || a.groups.len() > 50 {
        return Err(Error::bad("at most 50 people and 50 groups"));
    }
    // only people and groups of the tenant
    for p in &a.people {
        let member: bool = mosaikit_db::query_scalar(
            "select exists(select 1 from core.memberships where tenant_id = $1 and user_id = $2)",
        )
        .bind(t)
        .bind(p)
        .fetch_one(&k.db)
        .await?;
        if !member {
            return Err(Error::bad("a person who is not in the tenant"));
        }
    }
    for g in &a.groups {
        let ours: bool = mosaikit_db::query_scalar(
            "select exists(select 1 from core.groups where tenant_id = $1 and id = $2)",
        )
        .bind(t)
        .bind(g)
        .fetch_one(&k.db)
        .await?;
        if !ours {
            return Err(Error::bad("a group that is not of the tenant"));
        }
    }
    let mut s = settings_of(k, Some(t)).await?;
    s["quota_alerts"] = serde_json::to_value(&a)?;
    write_settings(k, Some(t), &s).await?;
    events::record(
        k,
        Some(t),
        Some(c.user.user_id),
        None,
        None,
        "tenant.quota_alerts",
        serde_json::to_value(&a)?,
    )
    .await;
    Ok(a)
}

async fn recipients(k: &Kernel, tenant: Uuid, a: &Alerts) -> Result<Vec<Uuid>> {
    let mut out: Vec<Uuid> = Vec::new();
    if a.managers {
        out.extend(
            mosaikit_db::query_scalar::<Uuid>(
                "select user_id from core.memberships where tenant_id = $1 and role = 'tenant_manager' and status = 'active'",
            )
            .bind(tenant)
            .fetch_all(&k.db)
            .await?,
        );
    }
    for p in &a.people {
        let active: bool = mosaikit_db::query_scalar(
            "select exists(select 1 from core.memberships where tenant_id = $1 and user_id = $2 and status = 'active')",
        )
        .bind(tenant)
        .bind(p)
        .fetch_one(&k.db)
        .await?;
        if active {
            out.push(*p);
        }
    }
    for g in &a.groups {
        out.extend(
            mosaikit_db::query_scalar::<Uuid>(
                "select gm.user_id from core.group_members gm join core.groups gr on gr.id = gm.group_id
                 join core.memberships m on m.user_id = gm.user_id and m.tenant_id = gr.tenant_id
                 where gr.id = $1 and gr.tenant_id = $2 and m.status = 'active'",
            )
            .bind(g)
            .bind(tenant)
            .fetch_all(&k.db)
            .await?,
        );
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// A level an alert is about.
fn levels(a: &Alerts) -> Vec<&'static str> {
    let mut l = Vec::new();
    if a.at_80 {
        l.push("80");
    }
    if a.at_100 {
        l.push("100");
    }
    if a.forecast {
        l.push("forecast");
    }
    l
}

/// Checks the quotas of a tenant: keeps the usage of today, sends the alerts of the thresholds just
/// crossed and re-arms the ones the usage went back below. Returns the alerts sent (metric, level).
pub async fn evaluate(k: &Kernel, tenant: Uuid) -> Result<Vec<(Metric, &'static str)>> {
    let row = mosaikit_db::query(
        "select slug, name, settings, status from core.tenants where id = $1 and not is_system",
    )
    .bind(tenant)
    .fetch_optional(&k.db)
    .await?;
    let Some(row) = row else { return Ok(Vec::new()) };
    let (slug, name): (String, String) = (row.get(0), row.get(1));
    let s: Option<Value> = row.get(2);
    let s = s.filter(Value::is_object).unwrap_or_else(|| json!({}));
    let u = usage(k, tenant).await?;
    snapshot(k, tenant, &u).await?;
    let platform = platform_of(&settings_of(k, None).await?);
    let l = effective_of(&platform, &own_of(&s));
    let a = alerts_of(&s);
    let history = history(k, tenant, 31).await?;
    let sent: Vec<(String, String)> =
        mosaikit_db::query("select metric, level from core.quota_alerts where tenant_id = $1")
            .bind(tenant)
            .fetch_all(&k.db)
            .await?
            .iter()
            .map(|r| (r.get(0), r.get(1)))
            .collect();
    let mut out = Vec::new();
    let mut who: Option<Vec<Uuid>> = None;
    for &m in METRICS {
        let used = u.get(m);
        for level in ["80", "100", "forecast"] {
            let crossed = match (l.get(m), level) {
                (None, _) => false,
                (Some(lim), "forecast") => {
                    used < lim && forecast(&history, m, used, lim).is_some_and(|d| d <= 30)
                }
                (Some(lim), lvl) => {
                    let pct: i64 = lvl.parse().unwrap_or(100);
                    percent(used, Some(lim)).is_some_and(|p| p >= pct)
                }
            };
            let was = sent.iter().any(|(sm, sl)| sm == m.as_str() && sl == level);
            if !crossed {
                if was {
                    mosaikit_db::query(
                        "delete from core.quota_alerts where tenant_id = $1 and metric = $2 and level = $3",
                    )
                    .bind(tenant)
                    .bind(m.as_str())
                    .bind(level)
                    .execute(&k.db)
                    .await?;
                }
                continue;
            }
            if was || !levels(&a).contains(&level) {
                continue;
            }
            mosaikit_db::query(
                "insert into core.quota_alerts (tenant_id, metric, level) values ($1, $2, $3)",
            )
            .bind(tenant)
            .bind(m.as_str())
            .bind(level)
            .execute(&k.db)
            .await?;
            if who.is_none() {
                who = Some(recipients(k, tenant, &a).await?);
            }
            let lim = l.get(m).unwrap_or_default();
            let pct = percent(used, Some(lim)).unwrap_or_default();
            let days = forecast(&history, m, used, lim);
            let title = match level {
                "100" => format!("The {} quota of {name} is used up: additions stop", m.as_str()),
                "forecast" => format!(
                    "At this pace the {} quota of {name} is used up in about {} days",
                    m.as_str(),
                    days.unwrap_or(0)
                ),
                _ => format!("The {} quota of {name} is at {pct}%", m.as_str()),
            };
            for user in who.as_deref().unwrap_or_default() {
                notify::emit(
                    k,
                    notify::New {
                        user: *user,
                        tenant: Some(tenant),
                        kind: NoteKind::System,
                        title: title.clone(),
                        body: String::new(),
                        link: format!("#/t/{slug}/usage"),
                        source: "kernel".into(),
                        resource: None,
                        data: json!({
                            "code": "quota.alert", "metric": m.as_str(), "level": level, "percent": pct,
                            "days": days, "tenant": name,
                        }),
                    },
                )
                .await;
            }
            events::record(
                k,
                Some(tenant),
                None,
                None,
                None,
                "tenant.quota_alert",
                json!({ "metric": m.as_str(), "level": level, "percent": pct }),
            )
            .await;
            out.push((m, level));
        }
    }
    Ok(out)
}

/// The periodic work: every tenant checked, the usage of the day kept, old days removed.
pub async fn tick(k: &Kernel) -> Result<()> {
    let ids: Vec<Uuid> =
        mosaikit_db::query_scalar("select id from core.tenants where not is_system").fetch_all(&k.db).await?;
    for id in ids {
        if let Err(e) = evaluate(k, id).await {
            tracing::warn!("quotas of the tenant {id}: {e}");
        }
    }
    let old = (Utc::now().date_naive() - chrono::Duration::days(400)).to_string();
    mosaikit_db::query("delete from core.quota_usage where day < $1").bind(old).execute(&k.db).await?;
    Ok(())
}

/// For the tests: a day of usage in the past (the trend and the forecast need history).
pub async fn record_day(k: &Kernel, tenant: Uuid, day: NaiveDate, u: Usage) -> Result<()> {
    mosaikit_db::query(
        "insert into core.quota_usage (tenant_id, day, storage, people, items) values ($1, $2, $3, $4, $5)
         on conflict (tenant_id, day) do update set storage = excluded.storage, people = excluded.people,
           items = excluded.items",
    )
    .bind(tenant)
    .bind(day.to_string())
    .bind(u.storage)
    .bind(u.people)
    .bind(u.items)
    .execute(&k.db)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(n: i64, storage: i64) -> Day {
        Day {
            day: (Utc::now().date_naive() - chrono::Duration::days(n)).to_string(),
            storage,
            people: 0,
            items: 0,
        }
    }

    #[test]
    fn effective_quotas_inherit_unless_customized() {
        let p = PlatformLimits {
            defaults: Limits { storage: Some(100), people: Some(10), items: None },
            capacity: Limits::default(),
        };
        let own = own_of(&json!({ "quota": { "storage": { "limit": 50 }, "items": { "limit": null } } }));
        let l = effective_of(&p, &own);
        assert_eq!(l, Limits { storage: Some(50), people: Some(10), items: None });
        // customized as "no limit" is different from inherited
        let own = own_of(&json!({ "quota": { "people": { "limit": null } } }));
        assert_eq!(effective_of(&p, &own).people, None);
        assert_eq!(effective_of(&p, &BTreeMap::new()).people, Some(10));
    }

    #[test]
    fn forecast_from_the_pace() {
        // 10 a day: from 300 to 1000 takes 70 days
        let h = [day(10, 200), day(5, 250)];
        assert_eq!(forecast(&h, Metric::Storage, 300, 1000), Some(70));
        // not growing: no forecast
        assert_eq!(forecast(&[day(10, 300)], Metric::Storage, 300, 1000), None);
        // only today: no forecast
        assert_eq!(forecast(&[day(0, 100)], Metric::Storage, 300, 1000), None);
        // already at the limit
        assert_eq!(forecast(&h, Metric::Storage, 1000, 1000), Some(0));
    }

    #[test]
    fn percent_of_a_quota() {
        assert_eq!(percent(80, Some(100)), Some(80));
        assert_eq!(percent(5, None), None);
        assert_eq!(percent(0, Some(0)), Some(0));
        assert_eq!(percent(1, Some(0)), Some(100));
    }
}
