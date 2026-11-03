//! Schedules: jobs a person puts on a timetable, to be run later on their behalf (docs/architecture.md,
//! "Schedules").
//!
//! A plugin declares the kinds of job it offers in `[[schedules]]` (each one names a run command and the
//! service that is told to run it); a person registers one from the plugin's own screen with a cron
//! expression. This module is the **registry**: create, list, pause, resume and delete, with the rules of
//! who may do what and the limits. Nothing here runs a job: the worker that fires them (it recomputes the
//! rights of the author at fire time, mints a run ticket and tells the service) comes in a later step.
//!
//! Who may do what:
//! - the author creates, lists, pauses, resumes and deletes their own schedules;
//! - a Tenant Manager lists every schedule of the tenant and may pause, resume (see `resume`) and delete
//!   any of them; they never create one "as" another person and never see its arguments or resources;
//! - anybody else gets "not found" (a schedule of another person is not revealed), as for run tickets.
//!
//! The rights of the author are never stored: when a person is removed or suspended in a tenant their
//! schedules there are paused (`pause_for_user`), and the worker checks the rights again at every run.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::cron::Cron;
use crate::{acl, events, Caller, Error, Kernel, Kind, Result};

/// Most schedules a person may have in a tenant (all plugins together).
pub const MAX_PER_PERSON: i64 = 50;
/// Largest `args` of a schedule, serialized.
pub const MAX_ARG_BYTES: usize = 64 * 1024;
/// Most resources a schedule may name.
pub const MAX_RESOURCES: usize = 64;
/// Longest label.
pub const MAX_LABEL: usize = 120;
/// Schedules a person may create per minute.
const CREATES_PER_MINUTE: u32 = 10;
const WINDOW: std::time::Duration = std::time::Duration::from_secs(60);
/// How many fire times are looked at to find the smallest gap of a cron expression.
const GAP_SAMPLE: usize = 10;

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRequest {
    pub plugin: String,
    /// the `name` of a `[[schedules]]` entry of the plugin
    pub name: String,
    /// five fields, UTC
    pub cron: String,
    /// arguments of the job (a JSON object, at most 64 KiB)
    #[serde(default)]
    pub args: Option<Value>,
    /// resources the job is limited to; none: the rights of the author
    #[serde(default)]
    pub resources: Option<Vec<Uuid>>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Created {
    pub id: Uuid,
    pub next_run_at: DateTime<Utc>,
}

/// A schedule as shown. `args` and `resources` are only for the author: a manager sees that they exist.
#[derive(Debug, Clone, Serialize)]
pub struct Schedule {
    pub id: Uuid,
    pub plugin: String,
    pub name: String,
    pub label: String,
    pub author: Uuid,
    pub author_name: String,
    pub cron: String,
    pub status: String,
    pub paused_reason: Option<String>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_status: Option<String>,
    pub created_at: DateTime<Utc>,
    /// `true` when the caller is the author (the only one who may resume after an inactive author)
    pub mine: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resources: Option<Vec<Uuid>>,
}

fn not_found() -> Error {
    Error::not_found("schedule not found")
}

fn refuse(msg: impl Into<String>, code: &'static str) -> Error {
    Error::bad(msg).with_code(code)
}

/// Checks a cron expression against the interval floor and returns its next fire time.
fn plan(expr: &str, min_interval: u32, now: DateTime<Utc>) -> Result<(Cron, DateTime<Utc>)> {
    let cron = Cron::parse(expr).map_err(|e| refuse(e, "bad_cron"))?;
    let next = cron.next_after(now).ok_or_else(|| refuse("this cron expression never fires", "bad_cron"))?;
    if let Some(gap) = cron.min_gap_minutes(now, GAP_SAMPLE) {
        if gap < i64::from(min_interval) {
            return Err(refuse(
                format!("runs of this schedule must be at least {min_interval} minutes apart"),
                "interval_too_short",
            ));
        }
    }
    Ok((cron, next))
}

/// Registers a schedule for the caller (a person with a session: a run ticket cannot).
pub async fn create(k: &Kernel, c: &Caller, req: &CreateRequest) -> Result<Created> {
    if c.run.is_some() {
        return Err(Error::forbidden("a run ticket cannot register a schedule"));
    }
    let (p, _) = crate::access::require(k, c, &req.plugin, crate::access::USE).await?;
    let decl = p.manifest.schedules.iter().find(|s| s.name == req.name).ok_or_else(|| {
        refuse(
            format!("the plugin does not declare a schedule called '{}'", req.name),
            "schedule_not_declared",
        )
    })?;
    // the command may have been taken out of the run commands by an update of the plugin
    if !p.manifest.permissions.run_commands.contains(&decl.command) {
        return Err(refuse("the command of this schedule is no longer a run command", "command_removed"));
    }
    let (_, next) = plan(&req.cron, decl.min_interval(), Utc::now())?;
    let args = match &req.args {
        None | Some(Value::Null) => json!({}),
        Some(v @ Value::Object(_)) => v.clone(),
        Some(_) => return Err(refuse("args must be a JSON object", "bad_args")),
    };
    if serde_json::to_vec(&args).map(|b| b.len()).unwrap_or(usize::MAX) > MAX_ARG_BYTES {
        return Err(refuse("args are too large (64 KiB at most)", "args_too_large"));
    }
    let label = req.label.as_deref().unwrap_or("").trim();
    if label.chars().count() > MAX_LABEL || label.chars().any(char::is_control) {
        return Err(refuse(
            format!("label: at most {MAX_LABEL} characters, no control characters"),
            "bad_label",
        ));
    }
    let resources = match &req.resources {
        None => {
            if decl.resources_required {
                return Err(refuse(
                    "this schedule must name the resources it is limited to",
                    "resources_required",
                ));
            }
            None
        }
        Some(list) => {
            if list.is_empty() || list.len() > MAX_RESOURCES {
                return Err(refuse(format!("resources: 1 to {MAX_RESOURCES}"), "bad_resources"));
            }
            let mut ids: Vec<Uuid> = Vec::new();
            for id in list {
                // the author must see each one now, and it must belong to this plugin
                let m = acl::meta(k, c, *id).await?;
                if m.plugin_id != p.id {
                    return Err(refuse(
                        "a resource of the schedule belongs to another plugin",
                        "bad_resources",
                    ));
                }
                if !ids.contains(id) {
                    ids.push(*id);
                }
            }
            Some(ids)
        }
    };
    if !k.limiter.hit(&format!("schedcreate:{}", c.user.user_id), CREATES_PER_MINUTE, WINDOW) {
        return Err(Error::new(Kind::TooMany, "too many schedules created: try again in a minute")
            .with_code("schedule_rate_limited"));
    }
    let per_name = i64::from(decl.per_tenant());
    // the limits are part of the insert, so two requests at once cannot both slip under them
    let row = mosaikit_db::query(
        "insert into core.schedules (tenant_id, user_id, plugin_id, name, label, cron, args, resources, next_run_at)
         select $1, $2, $3, $4, $5, $6, $7, $8, $9
         where (select count(*) from core.schedules where tenant_id = $1 and plugin_id = $3 and name = $4) < $10
           and (select count(*) from core.schedules where tenant_id = $1 and user_id = $2) < $11
         returning id",
    )
    .bind(c.tenant.tenant_id)
    .bind(c.user.user_id)
    .bind(&p.id)
    .bind(&decl.name)
    .bind(label)
    .bind(req.cron.split_whitespace().collect::<Vec<_>>().join(" "))
    .bind(args)
    .bind(resources.as_ref().map(|r| json!(r)))
    .bind(next)
    .bind(per_name)
    .bind(MAX_PER_PERSON)
    .fetch_optional(&k.db)
    .await?;
    let Some(row) = row else {
        let mine: i64 = mosaikit_db::query_scalar(
            "select count(*) from core.schedules where tenant_id = $1 and user_id = $2",
        )
        .bind(c.tenant.tenant_id)
        .bind(c.user.user_id)
        .fetch_one(&k.db)
        .await?;
        return Err(if mine >= MAX_PER_PERSON {
            refuse(
                format!("you already have {MAX_PER_PERSON} schedules: delete some first"),
                "too_many_schedules",
            )
        } else {
            refuse(
                format!("this tenant already has {per_name} schedules '{}' of this plugin", decl.name),
                "too_many_schedules_of_kind",
            )
        });
    };
    let id: Uuid = row.get(0);
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&p.id),
        None,
        "schedule.create",
        json!({
            "schedule": id, "name": decl.name, "cron": req.cron.trim(),
            "resources": resources.as_ref().map(Vec::len),
        }),
    )
    .await;
    Ok(Created { id, next_run_at: next })
}

/// The schedules the caller may see: their own, or every one of the tenant for a Tenant Manager.
/// `plugin` narrows to one plugin.
pub async fn list(k: &Kernel, c: &Caller, plugin: Option<&str>) -> Result<Vec<Schedule>> {
    let rows = mosaikit_db::query(
        "select s.id, s.plugin_id, s.name, s.label, s.user_id, coalesce(nullif(u.display_name, ''), u.username),
                s.cron, s.status, s.paused_reason, s.next_run_at, s.last_run_at, s.last_status, s.created_at,
                s.args, s.resources
         from core.schedules s join core.users u on u.id = s.user_id
         where s.tenant_id = $1 and ($2 or s.user_id = $3) and ($4 = '' or s.plugin_id = $4)
         order by s.created_at, s.id",
    )
    .bind(c.tenant.tenant_id)
    .bind(c.is_manager())
    .bind(c.user.user_id)
    .bind(plugin.unwrap_or(""))
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| {
            let author: Uuid = r.get(4);
            let mine = author == c.user.user_id;
            let resources: Option<Value> = r.get(14);
            Schedule {
                id: r.get(0),
                plugin: r.get(1),
                name: r.get(2),
                label: r.get(3),
                author,
                author_name: r.get(5),
                cron: r.get(6),
                status: r.get(7),
                paused_reason: r.get(8),
                next_run_at: r.get(9),
                last_run_at: r.get(10),
                last_status: r.get(11),
                created_at: r.get(12),
                mine,
                args: if mine { r.get(13) } else { None },
                resources: if mine { resources.and_then(|v| serde_json::from_value(v).ok()) } else { None },
            }
        })
        .collect())
}

/// A schedule of the tenant the caller may act on (the author or a Tenant Manager; else "not found").
struct Target {
    author: Uuid,
    plugin: String,
    name: String,
    cron: String,
    status: String,
    paused_reason: Option<String>,
}

async fn target(k: &Kernel, c: &Caller, id: Uuid) -> Result<Target> {
    let row = mosaikit_db::query(
        "select user_id, plugin_id, name, cron, status, paused_reason from core.schedules
         where id = $1 and tenant_id = $2",
    )
    .bind(id)
    .bind(c.tenant.tenant_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(not_found)?;
    let t = Target {
        author: row.get(0),
        plugin: row.get(1),
        name: row.get(2),
        cron: row.get(3),
        status: row.get(4),
        paused_reason: row.get(5),
    };
    if t.author != c.user.user_id && !c.is_manager() {
        return Err(not_found());
    }
    if c.run.is_some() {
        return Err(Error::forbidden("a run ticket cannot manage schedules"));
    }
    Ok(t)
}

/// Pauses a schedule: the author, or a Tenant Manager.
pub async fn pause(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    let t = target(k, c, id).await?;
    let reason = if t.author == c.user.user_id { "author" } else { "manager" };
    let done = mosaikit_db::query(
        "update core.schedules set status = 'paused', paused_reason = $3, claimed_until = null
         where id = $1 and tenant_id = $2 and status = 'active'",
    )
    .bind(id)
    .bind(c.tenant.tenant_id)
    .bind(reason)
    .execute(&k.db)
    .await?;
    if done.rows_affected() > 0 {
        events::record(
            k,
            Some(c.tenant.tenant_id),
            Some(c.user.user_id),
            Some(&t.plugin),
            None,
            "schedule.pause",
            json!({ "schedule": id, "name": t.name, "author": t.author, "reason": reason }),
        )
        .await;
    }
    Ok(())
}

/// Resumes a paused schedule. The author's rights must exist again, so:
/// - the author resumes any of their own (the plugin must be on, they must have `use`, and the
///   schedule must still be declared by the plugin);
/// - a Tenant Manager resumes only what a manager paused or the system paused for a fault
///   (`failures`, `plugin_off`, `command_removed`): never what the author paused (their decision) nor
///   what was paused because the author was removed or suspended. The job still runs as the author and
///   is checked again at every run.
pub async fn resume(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    let t = target(k, c, id).await?;
    if t.status != "paused" {
        return Ok(());
    }
    let mine = t.author == c.user.user_id;
    if !mine && matches!(t.paused_reason.as_deref(), Some("author") | Some("author_inactive")) {
        return Err(
            Error::forbidden("only the author can resume this schedule").with_code("author_must_resume")
        );
    }
    // the author must be able to use the plugin now; the plugin must still offer the schedule
    let (p, _) = if mine {
        crate::access::require(k, c, &t.plugin, crate::access::USE).await?
    } else {
        let p = k.plugins.active(&t.plugin)?;
        if !crate::plugins::tenants::is_on(k, c.tenant.tenant_id, &t.plugin).await? {
            return Err(crate::plugins::tenants::off_error(&p));
        }
        (p, Default::default())
    };
    let decl = p
        .manifest
        .schedules
        .iter()
        .find(|s| s.name == t.name)
        .ok_or_else(|| refuse("the plugin no longer declares this schedule", "schedule_not_declared"))?;
    if !p.manifest.permissions.run_commands.contains(&decl.command) {
        return Err(refuse("the command of this schedule is no longer a run command", "command_removed"));
    }
    // the floor may have been raised by an update of the plugin
    let (_, next) = plan(&t.cron, decl.min_interval(), Utc::now())?;
    let done = mosaikit_db::query(
        "update core.schedules set status = 'active', paused_reason = null, consecutive_failures = 0,
                claimed_until = null, next_run_at = $3
         where id = $1 and tenant_id = $2 and status = 'paused'",
    )
    .bind(id)
    .bind(c.tenant.tenant_id)
    .bind(next)
    .execute(&k.db)
    .await?;
    if done.rows_affected() > 0 {
        events::record(
            k,
            Some(c.tenant.tenant_id),
            Some(c.user.user_id),
            Some(&t.plugin),
            None,
            "schedule.resume",
            json!({ "schedule": id, "name": t.name, "author": t.author, "next_run_at": next }),
        )
        .await;
    }
    Ok(())
}

/// Deletes a schedule: the author, or a Tenant Manager.
pub async fn delete(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    let t = target(k, c, id).await?;
    mosaikit_db::query("delete from core.schedules where id = $1 and tenant_id = $2")
        .bind(id)
        .bind(c.tenant.tenant_id)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&t.plugin),
        None,
        "schedule.delete",
        json!({ "schedule": id, "name": t.name, "author": t.author }),
    )
    .await;
    Ok(())
}

/// Pauses every active schedule of a person, in one tenant or (`tenant` none) in all of them, for a
/// reason of the system (`author_inactive`). Called inside the transaction that removes or suspends the
/// person, so a schedule never outlives the rights of its author by even one commit. Reactivating the
/// person does not resume anything. Returns how many were paused.
pub async fn pause_for_user<'a>(
    db: impl Into<mosaikit_db::Target<'a>>,
    tenant: Option<Uuid>,
    user: Uuid,
    reason: &str,
) -> Result<u64> {
    let done = match tenant {
        Some(t) => {
            mosaikit_db::query(
                "update core.schedules set status = 'paused', paused_reason = $3, claimed_until = null
             where user_id = $1 and tenant_id = $2 and status = 'active'",
            )
            .bind(user)
            .bind(t)
            .bind(reason)
            .execute(db)
            .await?
        }
        None => {
            mosaikit_db::query(
                "update core.schedules set status = 'paused', paused_reason = $2, claimed_until = null
             where user_id = $1 and status = 'active'",
            )
            .bind(user)
            .bind(reason)
            .execute(db)
            .await?
        }
    };
    Ok(done.rows_affected())
}
