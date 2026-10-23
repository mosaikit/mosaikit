//! Monitoring of the platform (Administrator): state of the services, capacity, errors, load of the
//! tenants, alerts (docs/architecture.md, "Operations").

use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration as StdDuration, Instant};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::metrics;
use crate::notify::{self, NoteKind};
use crate::tenancy::{levels, require_admin};
use crate::{events, Kernel, Result, SessionUser};

/// A service and its state: "ok", "degraded", "down" or "off" (not in use).
#[derive(Debug, Clone, Serialize)]
pub struct Service {
    pub key: String,
    pub name: String,
    pub state: &'static str,
    pub version: String,
    /// time of the check, in milliseconds
    pub ms: Option<f64>,
    pub detail: String,
    /// more about the service for the side panel of Monitoring: (label, value), labels in English (the
    /// shell translates them)
    pub facts: Vec<[String; 2]>,
}

fn service(
    key: &str,
    name: &str,
    state: &'static str,
    version: &str,
    ms: Option<f64>,
    detail: String,
) -> Service {
    Service { key: key.into(), name: name.into(), state, version: version.into(), ms, detail, facts: Vec::new() }
}

/// Reachability of the identity providers of the tenants, checked at most every 5 minutes.
const OIDC_CACHE: StdDuration = StdDuration::from_secs(300);

async fn providers(k: &Kernel) -> Result<Vec<Service>> {
    if let Some((at, list)) = k.ops.providers.lock().expect("providers").clone() {
        if at.elapsed() < OIDC_CACHE {
            return Ok(list);
        }
    }
    let rows = mosaikit_db::query(
        "select t.name, o.issuer from core.tenant_oidc o join core.tenants t on t.id = o.tenant_id
         where o.enabled and t.status = 'active' order by t.name",
    )
    .fetch_all(&k.db)
    .await?;
    let mut out = Vec::new();
    for r in rows {
        let (tenant, issuer): (String, String) = (r.get(0), r.get(1));
        let url = format!("{}/.well-known/openid-configuration", issuer.trim_end_matches('/'));
        let t = Instant::now();
        let res = tokio::time::timeout(StdDuration::from_secs(3), k.http.get(&url).send()).await;
        let ms = Some(t.elapsed().as_secs_f64() * 1000.0);
        let (state, detail) = match res {
            Ok(Ok(r)) if r.status().is_success() => ("ok", issuer.clone()),
            Ok(Ok(r)) => ("down", format!("{issuer}: HTTP {}", r.status().as_u16())),
            Ok(Err(e)) => ("down", format!("{issuer}: {e}")),
            Err(_) => ("down", format!("{issuer}: no answer in 3 s")),
        };
        out.push(service(
            &format!("oidc:{tenant}"),
            &format!("Identity provider of {tenant}"),
            state,
            "",
            ms,
            detail,
        ));
    }
    *k.ops.providers.lock().expect("providers") = Some((Instant::now(), out.clone()));
    Ok(out)
}

/// Reachability of the mail server, checked at most every minute.
const MAIL_CACHE: StdDuration = StdDuration::from_secs(60);

async fn mail_service(k: &Kernel) -> Result<Service> {
    if let Some((at, s)) = k.ops.mail_probe.lock().expect("mail_probe").clone() {
        if at.elapsed() < MAIL_CACHE {
            return Ok(s);
        }
    }
    let (pending, failed) = metrics::mail_queue(k).await?;
    let probe = crate::mail::probe(k).await?;
    let last = k.ops.mail_last.lock().expect("mail_last").clone();
    let mut facts = vec![
        ["Waiting in the queue".to_string(), pending.to_string()],
        ["Failed in 24 hours".to_string(), failed.to_string()],
    ];
    if let Some((at, err, detail)) = &last {
        facts.push(["Last delivery".to_string(), at.format("%Y-%m-%d %H:%M:%S UTC").to_string()]);
        facts.push(["Outcome".to_string(), if err.is_some() { detail.clone() } else { "delivered".to_string() }]);
    }
    let (state, ms, detail) = match &probe {
        None => ("off", None, "no mail server".to_string()),
        Some(Err(e)) => ("down", None, e.message.trim_start_matches("mail server: ").to_string()),
        Some(Ok(ms)) => {
            let recent_error = last.as_ref().is_some_and(|(at, err, _)| {
                err.is_some() && Utc::now() - *at < Duration::hours(1)
            });
            (
                if failed > 0 || recent_error { "degraded" } else { "ok" },
                Some(*ms),
                format!("{pending} waiting, {failed} failed in 24 hours"),
            )
        }
    };
    let mut s = service("mail", "Emails", state, "SMTP", ms, detail);
    s.facts = facts;
    *k.ops.mail_probe.lock().expect("mail_probe") = Some((Instant::now(), s.clone()));
    Ok(s)
}

/// The services of the platform and their state.
pub async fn services(k: &Kernel) -> Result<Vec<Service>> {
    let mut out = Vec::new();
    // database
    let version: String = if k.db.is_sqlite() {
        mosaikit_db::query_scalar("select 1")
            .sqlite("select 'SQLite ' || sqlite_version()")
            .fetch_one(&k.db)
            .await?
    } else {
        let v: String =
            mosaikit_db::query_scalar("select current_setting('server_version')").fetch_one(&k.db).await?;
        format!("PostgreSQL {v}")
    };
    match metrics::db_ping(k).await {
        Ok(ms) => out.push(service(
            "database",
            "Database",
            if ms > 500.0 { "degraded" } else { "ok" },
            &version,
            Some(ms),
            String::new(),
        )),
        Err(e) => out.push(service("database", "Database", "down", &version, None, e.to_string())),
    }
    // storage of the contents
    let t = Instant::now();
    let probe = k.blobs.root().join(format!(".probe-{}", crate::util::random_token(4)));
    let res = std::fs::create_dir_all(k.blobs.root())
        .and_then(|_| std::fs::write(&probe, b"ok"))
        .and_then(|_| std::fs::read(&probe))
        .and_then(|_| std::fs::remove_file(&probe));
    let ms = Some(t.elapsed().as_secs_f64() * 1000.0);
    out.push(match res {
        Ok(()) => service(
            "storage",
            "Storage of the contents",
            "ok",
            "file system",
            ms,
            k.blobs.root().display().to_string(),
        ),
        Err(e) => service("storage", "Storage of the contents", "down", "file system", ms, e.to_string()),
    });
    // emails: the queue, the last delivery and whether the server accepts a connection now
    out.push(mail_service(k).await?);
    // background work
    let ticks = k.ops.ticks();
    let state = if k.cfg.no_background {
        "off"
    } else {
        let late = ["mail", "ops"]
            .iter()
            .any(|j| ticks.get(*j).is_none_or(|t| Utc::now() - *t > Duration::minutes(3)));
        if late && k.ops.started.elapsed() > StdDuration::from_secs(180) {
            "down"
        } else {
            "ok"
        }
    };
    let last =
        ticks.values().max().map(|t| format!("last run {}", t.format("%H:%M:%S UTC"))).unwrap_or_default();
    out.push(service("jobs", "Background work", state, "", None, last));
    // plugins
    let list = k.plugins.list();
    let active = list.iter().filter(|p| p.is_active()).count();
    let blocked = list.iter().filter(|p| p.status == crate::plugins::Status::Blocked).count();
    out.push(service(
        "plugins",
        "Plugin runtime",
        if blocked > 0 { "degraded" } else { "ok" },
        "WebAssembly",
        None,
        format!(
            "{active} active of {}{}",
            list.len(),
            if blocked > 0 { format!(", {blocked} blocked") } else { String::new() }
        ),
    ));
    // search index: the items still waiting for their searchable text (the background work indexes them a
    // batch at a time)
    let waiting: i64 = mosaikit_db::query_scalar("select count(*) from core.resources where search_text is null")
        .fetch_one(&k.db)
        .await?;
    let mut search = service(
        "search",
        "Search index",
        if waiting > 5000 { "degraded" } else { "ok" },
        if k.db.is_sqlite() { "SQLite" } else { "PostgreSQL full text" },
        None,
        if waiting == 0 { "every item indexed".to_string() } else { format!("{waiting} items waiting") },
    );
    search.facts = vec![["Items waiting".to_string(), waiting.to_string()]];
    out.push(search);
    // backups
    let last: Option<(String, DateTime<Utc>)> = mosaikit_db::query(
        "select status, started_at from core.backups where status <> 'running' order by started_at desc limit 1",
    )
    .fetch_optional(&k.db)
    .await?
    .map(|r| (r.get(0), r.get(1)));
    let cfg = super::backup::config(k).await?;
    out.push(match last {
        Some((s, at)) if s == "failed" => service(
            "backup",
            "Backups",
            "degraded",
            "",
            None,
            format!("last one failed, {}", at.format("%Y-%m-%d %H:%M")),
        ),
        Some((_, at)) => {
            service("backup", "Backups", "ok", "", None, format!("last one {}", at.format("%Y-%m-%d %H:%M")))
        }
        None if cfg.enabled => service("backup", "Backups", "degraded", "", None, "no backup yet".into()),
        None => service("backup", "Backups", "off", "", None, "scheduled backups are off".into()),
    });
    out.extend(providers(k).await?);
    Ok(out)
}

/// Space and memory.
#[derive(Debug, Clone, Serialize, Default)]
pub struct Capacity {
    pub disk_total: u64,
    pub disk_free: u64,
    pub database_bytes: i64,
    pub contents_bytes: u64,
    pub backups_bytes: u64,
    pub memory_total: u64,
    pub memory_available: u64,
    pub process_memory: u64,
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let mut stack = vec![dir.to_path_buf()];
    let mut seen = 0usize;
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            seen += 1;
            if seen > 500_000 {
                return total;
            }
            match e.metadata() {
                Ok(m) if m.is_dir() => stack.push(e.path()),
                Ok(m) => total += m.len(),
                Err(_) => {}
            }
        }
    }
    total
}

pub async fn capacity(k: &Kernel) -> Result<Capacity> {
    let mut c = Capacity::default();
    let data = std::fs::canonicalize(&k.cfg.data_dir).unwrap_or_else(|_| k.cfg.data_dir.clone());
    // Windows: `\\?\C:\...` from canonicalize, `C:\` as the mount point
    let data = std::path::PathBuf::from(data.to_string_lossy().trim_start_matches(r"\\?\").to_string());
    let disks = sysinfo::Disks::new_with_refreshed_list();
    if let Some(d) = disks
        .list()
        .iter()
        .filter(|d| data.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
    {
        c.disk_total = d.total_space();
        c.disk_free = d.available_space();
    }
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    c.memory_total = sys.total_memory();
    c.memory_available = sys.available_memory();
    if let Ok(pid) = sysinfo::get_current_pid() {
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
        c.process_memory = sys.process(pid).map(|p| p.memory()).unwrap_or(0);
    }
    c.database_bytes = if k.db.is_sqlite() {
        let f = k.cfg.sqlite_file();
        let wal = f.with_extension("db-wal");
        (std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0)
            + std::fs::metadata(wal).map(|m| m.len()).unwrap_or(0)) as i64
    } else {
        mosaikit_db::query_scalar("select pg_database_size(current_database())").fetch_one(&k.db).await?
    };
    let blobs = k.blobs.root().to_path_buf();
    let backups = super::backup::dir(k);
    let (cb, bb) =
        tokio::task::spawn_blocking(move || (dir_size(&blobs), dir_size(&backups))).await.unwrap_or((0, 0));
    c.contents_bytes = cb;
    c.backups_bytes = bb;
    Ok(c)
}

/// Load of a tenant and what it holds.
#[derive(Debug, Clone, Serialize)]
pub struct TenantLoad {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub status: String,
    pub archived: bool,
    pub requests_24h: i64,
    pub requests_1h: i64,
    pub people: i64,
    pub items: i64,
    pub bytes: i64,
    /// the quota nearest to its limit (none without limits)
    pub nearest_quota: Option<crate::quotas::QuotaRow>,
}

pub async fn tenants(k: &Kernel) -> Result<Vec<TenantLoad>> {
    let now = Utc::now();
    let day = metrics::requests_by_tenant(k, now - Duration::days(1)).await?;
    let hour = metrics::requests_by_tenant(k, now - Duration::hours(1)).await?;
    // the figures of every tenant grouped once, not three subqueries per tenant
    let rows = mosaikit_db::query(
        "with r as (select tenant_id, count(*) as n, coalesce(sum(size_bytes), 0) as bytes
                    from core.resources group by tenant_id),
              m as (select tenant_id, count(*) as n from core.memberships group by tenant_id)
         select t.id, t.slug, t.name, t.status, t.archived_at is not null, coalesce(m.n, 0)::bigint,
                coalesce(r.n, 0)::bigint, coalesce(r.bytes, 0)::bigint
         from core.tenants t left join r on r.tenant_id = t.id left join m on m.tenant_id = t.id
         where not t.is_system order by t.name",
    )
    .fetch_all(&k.db)
    .await?;
    let mut out: Vec<TenantLoad> = rows
        .iter()
        .map(|r| {
            let slug: String = r.get(1);
            TenantLoad {
                id: r.get(0),
                requests_24h: day.get(&slug).copied().unwrap_or(0),
                requests_1h: hour.get(&slug).copied().unwrap_or(0),
                slug,
                name: r.get(2),
                status: r.get(3),
                archived: r.get(4),
                people: r.get(5),
                items: r.get(6),
                bytes: r.get(7),
                nearest_quota: None,
            }
        })
        .collect();
    let mut nearest = crate::quotas::nearest_of_all(k).await?;
    for t in &mut out {
        t.nearest_quota = nearest.remove(&t.id);
    }
    out.sort_by(|a, b| b.requests_24h.cmp(&a.requests_24h).then(a.name.cmp(&b.name)));
    Ok(out)
}

/// A refused operation of the last days (Errors page): from the Log.
#[derive(Debug, Clone, Serialize)]
pub struct Failure {
    pub ts: DateTime<Utc>,
    pub action: String,
    pub tenant: Option<String>,
    pub user: Option<String>,
    pub ip: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Errors {
    pub points: Vec<metrics::Point>,
    pub requests: i64,
    pub errors: i64,
    pub failures_24h: i64,
    pub latest: Vec<Failure>,
}

pub async fn errors(k: &Kernel, period: &str) -> Result<Errors> {
    let points = metrics::series(k, period).await?;
    let since = Utc::now() - Duration::days(1);
    let failures_24h: i64 =
        mosaikit_db::query_scalar("select count(*) from core.events where not ok and ts > $1")
            .bind(since)
            .fetch_one(&k.db)
            .await?;
    let rows = mosaikit_db::query(
        "select e.ts, e.action, t.name, coalesce(nullif(u.display_name, ''), u.username), e.ip
         from core.events e left join core.tenants t on t.id = e.tenant_id left join core.users u on u.id = e.user_id
         where not e.ok order by e.ts desc limit 20",
    )
    .fetch_all(&k.db)
    .await?;
    Ok(Errors {
        requests: points.iter().map(|p| p.requests).sum(),
        errors: points.iter().map(|p| p.errors).sum(),
        points,
        failures_24h,
        latest: rows
            .iter()
            .map(|r| Failure {
                ts: r.get(0),
                action: r.get(1),
                tenant: r.get(2),
                user: r.get(3),
                ip: r.get(4),
            })
            .collect(),
    })
}

// ------------------------------------------------------------------ alerts

/// Conditions that alert and who receives them (System settings, `alerts`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AlertConfig {
    /// free disk under this percentage
    #[serde(default = "d_disk")]
    pub disk_free_pct: u8,
    /// server errors over this percentage of the requests of the last 15 minutes (at least 20 requests)
    #[serde(default = "d_errors")]
    pub error_rate_pct: u8,
    /// emails failed in the last hour, at least
    #[serde(default = "d_mail")]
    pub mail_failed: u32,
    #[serde(default = "yes")]
    pub backup_failed: bool,
    #[serde(default = "yes")]
    pub service_down: bool,
    /// Administrators who receive the alerts; empty: all of them
    #[serde(default)]
    pub recipients: Vec<Uuid>,
}

fn d_disk() -> u8 {
    10
}
fn d_errors() -> u8 {
    5
}
fn d_mail() -> u32 {
    3
}
fn yes() -> bool {
    true
}

impl Default for AlertConfig {
    fn default() -> AlertConfig {
        serde_json::from_str("{}").expect("alerts")
    }
}

pub async fn alert_config(k: &Kernel) -> Result<AlertConfig> {
    let s = levels::system_settings(k).await?;
    Ok(s.get("alerts").cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default())
}

pub async fn set_alert_config(k: &Kernel, admin: &SessionUser, c: &AlertConfig) -> Result<AlertConfig> {
    require_admin(admin)?;
    let mut c = c.clone();
    c.disk_free_pct = c.disk_free_pct.clamp(1, 90);
    c.error_rate_pct = c.error_rate_pct.clamp(1, 100);
    c.mail_failed = c.mail_failed.max(1);
    let mut s = levels::system_settings(k).await?;
    s["alerts"] = serde_json::to_value(&c)?;
    levels::write_system(k, &s).await?;
    events::record(k, None, Some(admin.user_id), None, None, "alerts.settings", serde_json::to_value(&c)?)
        .await;
    Ok(c)
}

/// An alert and its state.
#[derive(Debug, Clone, Serialize)]
pub struct AlertState {
    pub key: String,
    pub active: bool,
    pub since: Option<DateTime<Utc>>,
    pub detail: String,
    pub notified_at: Option<DateTime<Utc>>,
}

pub async fn alert_states(k: &Kernel) -> Result<Vec<AlertState>> {
    let rows =
        mosaikit_db::query("select key, active, since, detail, notified_at from core.alerts order by key")
            .fetch_all(&k.db)
            .await?;
    Ok(rows
        .iter()
        .map(|r| AlertState {
            key: r.get(0),
            active: r.get(1),
            since: r.get(2),
            detail: r.get(3),
            notified_at: r.get(4),
        })
        .collect())
}

/// The conditions now: key → description when it holds.
async fn conditions(k: &Kernel, c: &AlertConfig) -> Result<HashMap<String, Option<String>>> {
    let mut out: HashMap<String, Option<String>> = HashMap::new();
    let cap = capacity(k).await?;
    let disk = (cap.disk_total > 0).then(|| cap.disk_free as f64 * 100.0 / cap.disk_total as f64);
    out.insert(
        "disk".into(),
        disk.filter(|p| *p < c.disk_free_pct as f64).map(|p| format!("{p:.1}% of the disk free")),
    );
    let since = Utc::now() - Duration::minutes(15);
    let r = mosaikit_db::query("select coalesce(sum(requests), 0)::bigint, coalesce(sum(errors), 0)::bigint from core.metrics where ts >= $1")
        .bind(since)
        .fetch_one(&k.db)
        .await?;
    let (req, err): (i64, i64) = (r.get(0), r.get(1));
    let rate = if req >= 20 { err as f64 * 100.0 / req as f64 } else { 0.0 };
    out.insert(
        "errors".into(),
        (rate > c.error_rate_pct as f64).then(|| format!("{rate:.1}% of the requests failed in 15 minutes")),
    );
    let failed: i64 = mosaikit_db::query_scalar(
        "select count(*) from core.mail_outbox where status = 'failed' and created_at > $1",
    )
    .bind(Utc::now() - Duration::hours(1))
    .fetch_one(&k.db)
    .await?;
    out.insert(
        "mail".into(),
        (failed >= c.mail_failed as i64).then(|| format!("{failed} emails failed in the last hour")),
    );
    let last: Option<(String, String)> = mosaikit_db::query(
        "select status, error from core.backups where status <> 'running' order by started_at desc limit 1",
    )
    .fetch_optional(&k.db)
    .await?
    .map(|r| (r.get(0), r.get(1)));
    out.insert(
        "backup".into(),
        last.filter(|(s, _)| c.backup_failed && s == "failed")
            .map(|(_, e)| format!("the last backup failed: {e}")),
    );
    let down: Vec<String> = if c.service_down {
        services(k).await?.into_iter().filter(|s| s.state == "down").map(|s| s.name).collect()
    } else {
        Vec::new()
    };
    out.insert("service".into(), (!down.is_empty()).then(|| format!("not answering: {}", down.join(", "))));
    Ok(out)
}

/// Checks the conditions and notifies the recipients once per crossing (background work, every minute).
pub async fn check_alerts(k: &Kernel) -> Result<()> {
    let c = alert_config(k).await?;
    let now = Utc::now();
    let states: HashMap<String, bool> =
        alert_states(k).await?.into_iter().map(|s| (s.key, s.active)).collect();
    for (key, holds) in conditions(k, &c).await? {
        let was = states.get(&key).copied().unwrap_or(false);
        match (&holds, was) {
            (Some(detail), false) => {
                mosaikit_db::query(
                    "insert into core.alerts (key, active, since, detail, notified_at) values ($1, true, $2, $3, $2)
                     on conflict (key) do update set active = true, since = $2, detail = $3, notified_at = $2",
                )
                .bind(&key)
                .bind(now)
                .bind(detail)
                .execute(&k.db)
                .await?;
                events::record_failure(
                    k,
                    None,
                    None,
                    "alert.raised",
                    json!({ "alert": key, "detail": detail }),
                )
                .await;
                let to = if c.recipients.is_empty() {
                    crate::tenancy::lifecycle::administrators(k).await?
                } else {
                    c.recipients.clone()
                };
                for user in to {
                    notify::emit(
                        k,
                        notify::New {
                            user,
                            tenant: None,
                            kind: NoteKind::System,
                            title: format!("Alert: {detail}"),
                            body: "See Monitoring for the state of the platform.".into(),
                            link: "#/admin/monitoring/alerts".into(),
                            source: "kernel".into(),
                            resource: None,
                            data: json!({ "code": "alert.raised", "alert": key, "detail": detail }),
                        },
                    )
                    .await;
                }
            }
            (Some(detail), true) => {
                mosaikit_db::query("update core.alerts set detail = $2 where key = $1")
                    .bind(&key)
                    .bind(detail)
                    .execute(&k.db)
                    .await?;
            }
            (None, true) => {
                mosaikit_db::query("update core.alerts set active = false where key = $1")
                    .bind(&key)
                    .execute(&k.db)
                    .await?;
                events::record(k, None, None, None, None, "alert.cleared", json!({ "alert": key })).await;
            }
            (None, false) => {}
        }
    }
    Ok(())
}
