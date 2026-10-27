//! The Log: the events of a tenant for its Tenant Manager, of the whole platform for the Administrator
//! (with the tenant of each), with the same filters, paging and CSV export.
//!
//! A Tenant Manager sees only the events of the tenant: never those of other tenants, not even of their
//! guests. The titles of the items follow the policy `managers_see_titles` of the tenant (the
//! Administrator sees them under the same policy of each tenant). Events older than
//! `log.retention_days` (365 by default) are purged by the background work.

use std::fmt::Write as _;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::tenancy::{levels, require_admin};
use crate::{Caller, Kernel, Result, SessionUser, TenantSettings};

/// Days of events kept when the platform says nothing.
pub const DEFAULT_RETENTION_DAYS: i64 = 365;

const PAGE: i64 = 50;
const CSV_MAX: i64 = 10_000;

/// Filters of the Log (query string of the API).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct LogFilter {
    /// tenant (Administrator only; the Tenant Manager has theirs)
    pub tenant: Option<Uuid>,
    /// who did it
    pub user: Option<Uuid>,
    /// the app of the event
    pub plugin: Option<String>,
    /// the item of the event
    pub resource: Option<Uuid>,
    /// the group of the event (the activity of a group)
    pub group: Option<Uuid>,
    /// kind of event: sign_in, items, sharing, people, plugins, settings
    pub what: Option<String>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    /// only the refused operations
    #[serde(default)]
    pub failed: bool,
    /// search in the action, the person, the title and the details
    pub q: Option<String>,
    /// paging: the events before this id
    pub before: Option<i64>,
    /// CSV of a selection: ids separated by commas
    pub ids: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
    pub id: i64,
    pub ts: DateTime<Utc>,
    pub tenant_id: Option<Uuid>,
    pub tenant_slug: Option<String>,
    pub tenant_name: Option<String>,
    pub user_id: Option<Uuid>,
    pub username: Option<String>,
    pub user_name: Option<String>,
    pub plugin_id: Option<String>,
    pub resource_id: Option<Uuid>,
    /// empty when the item is gone or its title is hidden by the policy of the tenant
    pub resource_title: Option<String>,
    pub action: String,
    pub detail: Value,
    pub ok: bool,
    pub ip: Option<String>,
    pub agent: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogPage {
    pub events: Vec<LogEvent>,
    /// cursor of the next page (`before`), when there is one
    pub next: Option<i64>,
}

/// Whose log: a tenant (its manager) or the platform (an Administrator).
#[derive(Clone, Copy)]
pub enum Scope<'a> {
    Tenant(&'a Caller),
    Platform(&'a SessionUser),
}

/// Condition of a kind of event (whitelisted SQL, never built from the request).
fn what_sql(what: Option<&str>) -> &'static str {
    match what {
        Some("sign_in") => {
            "(e.action like 'login%' or e.action like 'logout%' or e.action like 'admin.totp%'
              or e.action = 'admin.recovery_code')"
        }
        Some("items") => {
            "(e.action like 'resource.%' or e.action like 'file.%' or e.action like 'content.%'
              or e.action like 'owner.%' or e.action like 'trash.%')"
        }
        Some("sharing") => {
            "(e.action in ('share', 'unshare', 'share.revoke_all') or e.action like 'link.%' or e.action like 'access.%')"
        }
        Some("people") => {
            "(e.action like 'member.%' or e.action like 'person.%' or e.action like 'invitation.%'
              or e.action like 'profile.%' or e.action like 'group.%' or e.action like 'user.%'
              or e.action = 'plugin.grant' or e.action in ('admin.create', 'admin.disable', 'admin.enable',
              'admin.password_reset'))"
        }
        Some("plugins") => "(e.action like 'plugin.%' and e.action <> 'plugin.grant')",
        Some("settings") => {
            "(e.action like 'tenant.%' or e.action like 'platform.%' or e.action like 'service.key%'
              or e.action like 'identity.%')"
        }
        _ => "true",
    }
}

/// The condition of a filter in use, or the one that says it is not (`$n is null`).
fn opt(on: bool, used: &'static str, unused: &'static str) -> &'static str {
    if on {
        used
    } else {
        unused
    }
}

fn see_titles(settings: &Value) -> bool {
    serde_json::from_value::<TenantSettings>(settings.clone()).map(|s| s.managers_see_titles).unwrap_or(true)
}

async fn fetch(k: &Kernel, scope: Scope<'_>, f: &LogFilter, limit: i64) -> Result<Vec<LogEvent>> {
    let tenant = match scope {
        Scope::Tenant(c) => {
            c.require_manager()?;
            Some(c.tenant.tenant_id)
        }
        Scope::Platform(u) => {
            require_admin(u)?;
            f.tenant
        }
    };
    // control characters out of the words: the trigram index joins the fields with chr(1)
    let like =
        f.q.as_deref()
            .map(|q| q.chars().filter(|c| !c.is_control()).collect::<String>())
            .map(|q| q.trim().to_string())
            .filter(|q| !q.is_empty())
            .map(|q| format!("%{}%", crate::util::like_escape(&q)));
    // PostgreSQL: one expression per table, the same as the trigram indexes of migration 0016 (with
    // pg_trgm an index answers it; without, the same rows as the condition per field); SQLite: per field
    let search_sql = if k.db.is_sqlite() {
        "(e.action ilike $9 escape '\\' or u.username ilike $9 escape '\\'
          or u.display_name ilike $9 escape '\\' or e.detail::text ilike $9 escape '\\'
          or e.ip ilike $9 escape '\\')"
    } else {
        "((e.action || chr(1) || coalesce(e.detail::text, '') || chr(1) || coalesce(e.ip, '')) ilike $9 escape '\\'
          or e.user_id in (select su.id from core.users su
                           where (su.username || chr(1) || coalesce(su.display_name, '')) ilike $9 escape '\\'))"
    };
    let sql = format!(
        "select e.id, e.ts, e.tenant_id, t.slug, t.name, t.settings, e.user_id, u.username,
                coalesce(nullif(u.display_name, ''), u.username), e.plugin_id, e.resource_id, r.title,
                e.action, e.detail, e.ok, e.ip, e.agent
         from core.events e
         left join core.tenants t on t.id = e.tenant_id
         left join core.users u on u.id = e.user_id
         left join core.resources r on r.id = e.resource_id
         where {tenant} and {user} and {plugin} and {resource} and {group} and {from} and {to} and {failed}
           and {search} and {before} and {what}
         order by e.id desc limit $11",
        // only the filters in use become conditions (an unused one is `$n is null`, true): with
        // `($n is null or column = $n)` the plan prepared once cannot use the indexes of the column
        tenant = opt(tenant.is_some(), "e.tenant_id = $1", "$1::uuid is null"),
        user = opt(f.user.is_some(), "e.user_id = $2", "$2::uuid is null"),
        plugin = opt(f.plugin.is_some(), "e.plugin_id = $3", "$3::text is null"),
        resource = opt(f.resource.is_some(), "e.resource_id = $4", "$4::uuid is null"),
        group = opt(f.group.is_some(), "e.detail->>'group' = $5", "$5::text is null"),
        from = opt(f.from.is_some(), "e.ts >= $6", "$6::timestamptz is null"),
        to = opt(f.to.is_some(), "e.ts < $7", "$7::timestamptz is null"),
        failed = opt(f.failed, "(not e.ok and $8)", "not $8"),
        search = if like.is_some() { search_sql } else { "$9::text is null" },
        before = opt(f.before.is_some(), "e.id < $10", "$10::bigint is null"),
        what = what_sql(f.what.as_deref()),
    );
    let rows = mosaikit_db::query(sql)
        .bind(tenant)
        .bind(f.user)
        .bind(f.plugin.as_deref())
        .bind(f.resource)
        .bind(f.group.map(|g| g.to_string()))
        .bind(f.from)
        .bind(f.to)
        .bind(f.failed)
        .bind(like)
        .bind(f.before)
        .bind(limit)
        .fetch_all(&k.db)
        .await?;
    let manager_titles = match scope {
        Scope::Tenant(c) => Some(c.tenant.settings.managers_see_titles),
        Scope::Platform(_) => None,
    };
    // the person an event is about (`detail.user`: suspended, made active again, role changed…) by name,
    // so that «On what» is never empty; one query per person of the page
    let mut names: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for r in &rows {
        let detail: Value = r.get(13);
        let Some(id) = detail.get("user").and_then(Value::as_str).filter(|_| detail.get("name").is_none())
        else {
            continue;
        };
        if names.contains_key(id) {
            continue;
        }
        let Ok(uid) = id.parse::<uuid::Uuid>() else { continue };
        let name: Option<String> = mosaikit_db::query_scalar(
            "select coalesce(nullif(display_name, ''), username) from core.users where id = $1",
        )
        .bind(uid)
        .fetch_optional(&k.db)
        .await?;
        if let Some(n) = name {
            names.insert(id.to_string(), n);
        }
    }
    Ok(rows
        .iter()
        .map(|r| {
            let settings: Option<Value> = r.get(5);
            let titles = manager_titles.unwrap_or_else(|| settings.as_ref().is_none_or(see_titles));
            let mut detail: Value = r.get(13);
            let about = detail.get("user").and_then(Value::as_str).and_then(|u| names.get(u)).cloned();
            if let (Some(n), Some(o)) = (about, detail.as_object_mut()) {
                o.insert("name".into(), Value::String(n));
            }
            if !titles {
                // the title kept by the events of deleted items follows the same policy
                if let Some(o) = detail.as_object_mut() {
                    o.remove("title");
                }
            }
            LogEvent {
                id: r.get(0),
                ts: r.get(1),
                tenant_id: r.get(2),
                tenant_slug: r.get(3),
                tenant_name: r.get(4),
                user_id: r.get(6),
                username: r.get(7),
                user_name: r.get(8),
                plugin_id: r.get(9),
                resource_id: r.get(10),
                resource_title: if titles { r.get(11) } else { None },
                action: r.get(12),
                detail,
                ok: r.get(14),
                ip: r.get(15),
                agent: r.get(16),
            }
        })
        .collect())
}

/// A page of events, the latest first.
pub async fn page(k: &Kernel, scope: Scope<'_>, f: &LogFilter) -> Result<LogPage> {
    let mut events = fetch(k, scope, f, PAGE + 1).await?;
    let next = if events.len() as i64 > PAGE {
        events.truncate(PAGE as usize);
        events.last().map(|e| e.id)
    } else {
        None
    };
    Ok(LogPage { events, next })
}

fn csv_cell(s: &str) -> String {
    // a leading = + - @ (or tab, carriage return) would be a formula in a spreadsheet
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) { format!("'{s}") } else { s.to_string() };
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

/// The events of the filters (or of the selection `ids`) as CSV, at most 10 000.
pub async fn csv(k: &Kernel, scope: Scope<'_>, f: &LogFilter) -> Result<String> {
    let only: Option<Vec<i64>> =
        f.ids.as_deref().map(|ids| ids.split(',').filter_map(|i| i.trim().parse().ok()).collect());
    let events = fetch(k, scope, &LogFilter { before: None, ..f.clone() }, CSV_MAX).await?;
    let platform = matches!(scope, Scope::Platform(_));
    let mut out = String::from("\u{feff}");
    out.push_str(if platform {
        "time,tenant,person,username,action,app,item,item title,result,address,details\r\n"
    } else {
        "time,person,username,action,app,item,item title,result,address,details\r\n"
    });
    for e in events.iter().filter(|e| only.as_ref().is_none_or(|o| o.contains(&e.id))) {
        let mut cells = vec![e.ts.to_rfc3339()];
        if platform {
            cells.push(e.tenant_slug.clone().unwrap_or_default());
        }
        cells.extend([
            e.user_name.clone().unwrap_or_default(),
            e.username.clone().unwrap_or_default(),
            e.action.clone(),
            e.plugin_id.clone().unwrap_or_default(),
            e.resource_id.map(|r| r.to_string()).unwrap_or_default(),
            e.resource_title.clone().unwrap_or_default(),
            if e.ok { "ok".into() } else { "failed".into() },
            e.ip.clone().unwrap_or_default(),
            if e.detail.as_object().is_some_and(|o| o.is_empty()) {
                String::new()
            } else {
                e.detail.to_string()
            },
        ]);
        let line: Vec<String> = cells.iter().map(|c| csv_cell(c)).collect();
        let _ = write!(out, "{}\r\n", line.join(","));
    }
    Ok(out)
}

/// Deletes the events older than the retention of the platform (background work).
pub async fn purge(k: &Kernel) -> Result<u64> {
    let settings = levels::effective(k, None).await?;
    let days =
        settings.get("log.retention_days").and_then(Value::as_i64).unwrap_or(DEFAULT_RETENTION_DAYS).max(1);
    let cutoff = Utc::now() - Duration::days(days);
    Ok(mosaikit_db::query("delete from core.events where ts < $1")
        .bind(cutoff)
        .execute(&k.db)
        .await?
        .rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_cells_are_quoted_and_never_formulas() {
        assert_eq!(csv_cell("plain"), "plain");
        assert_eq!(csv_cell("a,b"), "\"a,b\"");
        assert_eq!(csv_cell("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_cell("=SUM(A1)"), "'=SUM(A1)");
        assert_eq!(csv_cell("-1,2"), "\"'-1,2\"");
    }

    #[test]
    fn kinds_of_events_are_fixed_sql() {
        assert_eq!(what_sql(None), "true");
        assert_eq!(what_sql(Some("'; drop table x")), "true");
        assert!(what_sql(Some("sign_in")).contains("login"));
    }
}
