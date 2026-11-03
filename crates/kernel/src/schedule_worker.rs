//! The worker of the schedules: it fires the jobs of `core.schedules` when they are due (docs/architecture.md,
//! "Schedules"). The registry (who may create, pause, take over...) is `schedules.rs`.
//!
//! Every 30 seconds (`tick`):
//! 1. **poll** the runs in flight: a run past its deadline is `timed_out`; a run the service accepted is
//!    asked for its result (`GET <service>/runs/{id}`); a run that has ended releases the schedule;
//! 2. **claim** the schedules that are due, in one statement that is safe with several kernels on the same
//!    PostgreSQL (`for update skip locked`; SQLite has one process, and the same statement is run
//!    as it is: its writes are serialized) and puts a **lease** on them (`claimed_until`), so a schedule is
//!    never run twice at once, and a worker that dies leaves nothing stuck for more than the lease;
//! 3. for each claimed schedule: compute the next fire time first (a run that is missed is skipped, see below),
//!    check the **gate** (the author's rights NOW), mint a run ticket, record the run and **push** it to the
//!    service of the plugin.
//!
//! The gate: the author must still be an active member of an active tenant and may still use the plugin,
//! the plugin must be on for the tenant and still declare the schedule and its run command, and each stored
//! resource must still be visible to the author. If not, nothing is minted or sent: the schedule is paused
//! (`author_inactive`, `plugin_off` or `command_removed`), the Tenant Managers are told when it is the
//! author, and the audit log gets `schedule.skipped`. The ticket then carries only the run command of the
//! plugin (nothing else is granted by a schedule) and every call is rechecked by `run_tickets::call`.
//!
//! The push: `POST <target>` with the shared key of the declared service as `Authorization: Bearer`, through
//! `webfetch::request` (origin allowlist of the plugin, SSRF guard). The body carries the tenant, the author,
//! the schedule, the ticket and the arguments. The service answers `202` at once with `{ "run_id": "..." }`
//! (the run is asynchronous); the kernel stores that id on the run record and reads the result later from
//! `<target without /run>/runs/{id}`. A run that is not over by its deadline (`max_runtime_minutes` of
//! the declaration: default 15, at most 60) is `timed_out` and its ticket revoked.
//!
//! Failures: a failed push, a failed or timed out run counts. After a failure the next run is brought forward
//! to a retry (5 minutes, doubling each time, at most 60) if that is sooner than the next fire time; after
//! 5 failures in a row the schedule is paused (`failures`) and the author told. A success resets the count.
//!
//! Missed runs: a schedule that is more than `GRACE` late (the kernel was down) is **skipped** and put on its
//! next fire time; with `catch_up_once` it runs once, however many runs were missed.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::cron::Cron;
use crate::run_tickets::MintRequest;
use crate::schedules::{run_info, zone_of, RunInfo, RUN_COLUMNS};
use crate::{acl, events, Error, Kernel, Kind, Result};

/// How often the worker looks.
pub const TICK: Duration = Duration::from_secs(30);
/// Schedules claimed per tick.
const CLAIM_BATCH: i64 = 20;
/// Dispatches and polls at once.
const CONCURRENT: usize = 8;
/// Runs in flight read per tick.
const POLL_BATCH: i64 = 50;
/// Lease while a run is being started; once the service has accepted it the lease lasts as long as the run.
const DISPATCH_LEASE_MINUTES: i64 = 5;
/// How late a schedule may be and still run (the kernel was busy or briefly down).
pub const GRACE: chrono::Duration = chrono::Duration::minutes(3);
/// Consecutive failures that pause a schedule.
pub const MAX_FAILURES: i32 = 5;
/// The ceiling of a run, whatever the manifest says (the ticket cannot live longer: `run_tickets::MAX_TTL_MINUTES`).
pub const MAX_RUNTIME_MINUTES: u32 = 60;
/// Runs started per tenant per minute (timetable and run-now together).
const RUNS_PER_MINUTE: u32 = 30;
const WINDOW: Duration = Duration::from_secs(60);
/// Answer of the service we read (a run id or a status).
const MAX_REPLY: usize = 64 * 1024;
const MAX_ERROR: usize = 200;

/// A schedule claimed for a run.
#[derive(Debug, Clone)]
pub struct Claimed {
    pub id: Uuid,
    pub tenant: Uuid,
    pub user: Uuid,
    pub plugin: String,
    pub name: String,
    pub cron: String,
    pub time_zone: String,
    pub args: Value,
    pub resources: Option<Vec<Uuid>>,
    /// the fire time that made it due
    pub due: DateTime<Utc>,
    pub catch_up_once: bool,
}

const CLAIM_COLUMNS: &str =
    "id, tenant_id, user_id, plugin_id, name, cron, time_zone, args, resources, next_run_at, catch_up_once";

fn claimed(r: &mosaikit_db::Row) -> Claimed {
    let resources: Option<Value> = r.get(8);
    Claimed {
        id: r.get(0),
        tenant: r.get(1),
        user: r.get(2),
        plugin: r.get(3),
        name: r.get(4),
        cron: r.get(5),
        time_zone: r.get(6),
        args: r.get(7),
        resources: resources.filter(|v| !v.is_null()).and_then(|v| serde_json::from_value(v).ok()),
        due: r.get(9),
        catch_up_once: r.get(10),
    }
}

/// Claims up to `limit` schedules that are due and not leased, and leases them. Safe to call from several
/// workers at once: a schedule is returned to one of them only.
pub async fn claim(k: &Kernel, limit: i64) -> Result<Vec<Claimed>> {
    let rows = mosaikit_db::query(format!(
        "update core.schedules set claimed_until = now() + make_interval(mins => $1)
         where id in (select id from core.schedules
                      where status = 'active' and next_run_at <= now()
                        and (claimed_until is null or claimed_until < now())
                      order by next_run_at limit $2 for update skip locked)
         returning {CLAIM_COLUMNS}"
    ))
    .bind(DISPATCH_LEASE_MINUTES as i32)
    .bind(limit)
    .fetch_all(&k.db)
    .await?;
    Ok(rows.iter().map(claimed).collect())
}

/// One pass of the worker. Returns how many schedules were claimed.
pub async fn tick(k: &Arc<Kernel>) -> Result<usize> {
    if let Err(e) = poll_runs(k).await {
        tracing::warn!("schedules, runs in flight: {e}");
    }
    let rows = claim(k, CLAIM_BATCH).await?;
    let n = rows.len();
    let sem = Arc::new(tokio::sync::Semaphore::new(CONCURRENT));
    let mut set = tokio::task::JoinSet::new();
    for s in rows {
        let (k, sem) = (k.clone(), sem.clone());
        set.spawn(async move {
            let _permit = sem.acquire_owned().await;
            if let Err(e) = dispatch(&k, &s, false).await {
                tracing::warn!("schedule {} not started: {e}", s.id);
            }
        });
    }
    while set.join_next().await.is_some() {}
    Ok(n)
}

/// Starts the worker (every 30 seconds). Stops with the kernel.
pub(crate) fn spawn_worker(k: &Arc<Kernel>) {
    let weak = Arc::downgrade(k);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(TICK).await;
            let Some(k) = weak.upgrade() else { break };
            k.ops.tick("schedules");
            if let Err(e) = tick(&k).await {
                tracing::warn!("schedules: {e}");
            }
        }
    });
}

/// What became of a dispatch.
#[derive(Debug)]
pub enum Outcome {
    /// a run was recorded (the service may still have refused it: see its status)
    Started(RunInfo),
    /// too late and no catch-up: skipped, on its next fire time
    Missed,
    /// the gate said no: the schedule is paused for this reason
    Skipped(&'static str),
    RateLimited,
}

enum Gate {
    Go(Box<Go>),
    Stop(&'static str),
}

struct Go {
    plugin: Arc<crate::plugins::LoadedPlugin>,
    caller: crate::Caller,
    decl: mosaikit_mskp::ScheduleDecl,
}

/// The rights of the author NOW (see the module header). `Stop` carries the `paused_reason`.
async fn gate(k: &Kernel, s: &Claimed) -> Result<Gate> {
    let caller = match crate::run_tickets::caller_for(k, s.user, s.tenant).await {
        Ok(c) => c,
        Err(e) if e.kind == Kind::Internal => return Err(e),
        Err(_) => return Ok(Gate::Stop("author_inactive")),
    };
    let Ok(plugin) = k.plugins.active(&s.plugin) else { return Ok(Gate::Stop("plugin_off")) };
    if !crate::plugins::tenants::is_on(k, s.tenant, &s.plugin).await? {
        return Ok(Gate::Stop("plugin_off"));
    }
    let Some(decl) = plugin.manifest.schedules.iter().find(|d| d.name == s.name).cloned() else {
        return Ok(Gate::Stop("command_removed"));
    };
    if !plugin.manifest.permissions.run_commands.contains(&decl.command) {
        return Ok(Gate::Stop("command_removed"));
    }
    match crate::access::require(k, &caller, &s.plugin, crate::access::USE).await {
        Ok(_) => {}
        Err(e) if e.kind == Kind::Internal => return Err(e),
        Err(_) => return Ok(Gate::Stop("author_inactive")),
    }
    for rid in s.resources.iter().flatten() {
        match acl::meta(k, &caller, *rid).await {
            Ok(m) if m.plugin_id == plugin.id => {}
            Err(e) if e.kind == Kind::Internal => return Err(e),
            _ => return Ok(Gate::Stop("author_inactive")),
        }
    }
    Ok(Gate::Go(Box::new(Go { plugin, caller, decl })))
}

/// Pauses for a reason of the gate. A person who lost their rights has all their schedules of the tenant
/// paused and the Tenant Managers are told.
async fn stop(k: &Kernel, s: &Claimed, reason: &'static str) -> Result<()> {
    if reason == "author_inactive" {
        let paused = crate::schedules::pause_for_user(&k.db, Some(s.tenant), s.user, reason).await?;
        crate::schedules::notify_paused(k, s.user, &paused, "the author can no longer run the job").await;
    } else {
        mosaikit_db::query(
            "update core.schedules set status = 'paused', paused_reason = $2, claimed_until = null
             where id = $1 and status = 'active'",
        )
        .bind(s.id)
        .bind(reason)
        .execute(&k.db)
        .await?;
    }
    mosaikit_db::query("update core.schedules set last_status = 'skipped' where id = $1")
        .bind(s.id)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(s.tenant),
        None,
        Some(&s.plugin),
        None,
        "schedule.skipped",
        json!({ "schedule": s.id, "name": s.name, "author": s.user, "reason": reason, "by": "scheduler" }),
    )
    .await;
    events::record(
        k,
        Some(s.tenant),
        None,
        Some(&s.plugin),
        None,
        "schedule.paused",
        json!({ "schedule": s.id, "name": s.name, "reason": reason, "by": "scheduler" }),
    )
    .await;
    Ok(())
}

fn short(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(MAX_ERROR).collect()
}

/// Runs one claimed schedule: next fire time, missed check, gate, ticket, record, push. `manual` is a
/// run-now: no missed check and the timetable is left as it is.
pub(crate) async fn dispatch(k: &Kernel, s: &Claimed, manual: bool) -> Result<Outcome> {
    let now = Utc::now();
    if !manual {
        // the next fire time first: a run that does not happen is never replayed
        let tz: Tz = zone_of(Some(&s.time_zone))?;
        let next = Cron::parse(&s.cron).ok().and_then(|c| c.next_after_in(now, tz));
        mosaikit_db::query("update core.schedules set next_run_at = $2 where id = $1")
            .bind(s.id)
            .bind(next)
            .execute(&k.db)
            .await?;
        if now - s.due > GRACE && !s.catch_up_once {
            mosaikit_db::query(
                "update core.schedules set last_status = 'missed', claimed_until = null where id = $1",
            )
            .bind(s.id)
            .execute(&k.db)
            .await?;
            events::record(
                k,
                Some(s.tenant),
                None,
                Some(&s.plugin),
                None,
                "schedule.missed",
                json!({ "schedule": s.id, "name": s.name, "due": s.due, "by": "scheduler" }),
            )
            .await;
            return Ok(Outcome::Missed);
        }
    }
    let go = match gate(k, s).await? {
        Gate::Go(g) => g,
        Gate::Stop(reason) => {
            stop(k, s, reason).await?;
            return Ok(Outcome::Skipped(reason));
        }
    };
    if !k.limiter.hit(&format!("schedrun:{}", s.tenant), RUNS_PER_MINUTE, WINDOW) {
        // later: the timetable retries in a minute, run-now is refused by the caller
        mosaikit_db::query(
            "update core.schedules set last_status = 'rate_limited', claimed_until = null,
                    next_run_at = case when $3 then next_run_at else $2 end
             where id = $1",
        )
        .bind(s.id)
        .bind(now + chrono::Duration::minutes(1))
        .bind(manual)
        .execute(&k.db)
        .await?;
        return Ok(Outcome::RateLimited);
    }
    let Go { plugin, caller, decl } = *go;
    let run_id = Uuid::new_v4();
    let run_ref = format!("schedule:{}:{run_id}", s.name);
    let ttl = decl.max_runtime().clamp(1, MAX_RUNTIME_MINUTES);
    let minted = crate::run_tickets::mint(
        k,
        &caller,
        &MintRequest {
            plugin: s.plugin.clone(),
            // nothing but the run command of the declaration
            commands: vec![decl.command.clone()],
            run_ref: run_ref.clone(),
            ttl_minutes: Some(ttl),
            uses: Some(crate::run_tickets::MAX_USES),
            resources: s.resources.clone(),
            schedule: Some(s.id),
        },
    )
    .await;
    let minted = match minted {
        Ok(m) => m,
        Err(e) => {
            settle(k, s.id, false, "failed").await?;
            audit_failed(k, s, None, &short(&e.message)).await;
            pause_if_failing(k, s.tenant, s.id, &s.plugin, &s.name, s.user).await?;
            return Ok(Outcome::Started(
                refused_run(k, s, run_id, &run_ref, manual, &short(&e.message)).await?,
            ));
        }
    };
    let deadline = now + chrono::Duration::minutes(i64::from(ttl));
    mosaikit_db::query(
        "insert into core.schedule_runs (id, schedule_id, tenant_id, ticket_id, run_ref, started_by, deadline_at)
         values ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(run_id)
    .bind(s.id)
    .bind(s.tenant)
    .bind(minted.id)
    .bind(&run_ref)
    .bind(if manual { "manual" } else { "timetable" })
    .bind(deadline)
    .execute(&k.db)
    .await?;
    // the lease lasts as long as the run: no second run of the schedule meanwhile
    mosaikit_db::query(
        "update core.schedules set last_run_at = $2, last_status = 'running', claimed_until = $3 where id = $1",
    )
    .bind(s.id)
    .bind(now)
    .bind(deadline + chrono::Duration::minutes(1))
    .execute(&k.db)
    .await?;
    events::record(
        k,
        Some(s.tenant),
        Some(s.user),
        Some(&s.plugin),
        None,
        "schedule.run",
        json!({ "schedule": s.id, "name": s.name, "run": run_id, "run_ref": run_ref, "ticket": minted.id,
                "by": if manual { "manual" } else { "scheduler" } }),
    )
    .await;
    let body = json!({
        "tenant": s.tenant,
        "user": s.user,
        "schedule": s.id,
        "schedule_name": s.name,
        "run": run_id,
        "run_ref": run_ref,
        "plugin": s.plugin,
        "command": decl.command,
        "args": s.args,
        "ticket": minted.token,
        "ticket_path": format!("/api/run/{}", minted.token),
        "expires_at": minted.expires_at,
    });
    match push(k, &plugin, &decl, s.tenant, body).await {
        Ok(service_run) => {
            mosaikit_db::query("update core.schedule_runs set service_run_id = $2 where id = $1")
                .bind(run_id)
                .bind(service_run)
                .execute(&k.db)
                .await?;
        }
        Err(msg) => {
            let row = RunRow { id: run_id, schedule: s.id, tenant: s.tenant, ticket: Some(minted.id) };
            finish_run(k, &row, &s.plugin, &s.name, s.user, Finish::Failed(msg)).await?;
        }
    }
    let r = mosaikit_db::query(format!("select {RUN_COLUMNS} from core.schedule_runs where id = $1"))
        .bind(run_id)
        .fetch_one(&k.db)
        .await?;
    Ok(Outcome::Started(run_info(&r)))
}

/// A run that never started (the ticket could not be minted): recorded as failed so it shows in the history.
async fn refused_run(
    k: &Kernel,
    s: &Claimed,
    id: Uuid,
    run_ref: &str,
    manual: bool,
    why: &str,
) -> Result<RunInfo> {
    mosaikit_db::query(
        "insert into core.schedule_runs (id, schedule_id, tenant_id, run_ref, started_by, status, error,
                                         deadline_at, finished_at)
         values ($1, $2, $3, $4, $5, 'failed', $6, now(), now())",
    )
    .bind(id)
    .bind(s.id)
    .bind(s.tenant)
    .bind(run_ref)
    .bind(if manual { "manual" } else { "timetable" })
    .bind(why)
    .execute(&k.db)
    .await?;
    let r = mosaikit_db::query(format!("select {RUN_COLUMNS} from core.schedule_runs where id = $1"))
        .bind(id)
        .fetch_one(&k.db)
        .await?;
    Ok(run_info(&r))
}

/// The runs of the schedule while it is leased for a push or a poll: what the declaration says about the service.
fn exempt_for(
    k: &Kernel,
    plugin: &crate::plugins::LoadedPlugin,
    decl: &mosaikit_mskp::ScheduleDecl,
    url: &str,
) -> std::result::Result<Vec<String>, String> {
    let origin = crate::config::origin_of(url);
    if !plugin.manifest.permissions.network.contains(&origin) {
        return Err("the service is not in the network permissions of the plugin".into());
    }
    let _ = decl;
    Ok(crate::webfetch::private_exemptions(k, &plugin.manifest.permissions.network))
}

async fn auth_headers(
    k: &Kernel,
    decl: &mosaikit_mskp::ScheduleDecl,
    tenant: Uuid,
) -> std::result::Result<Vec<(String, String)>, String> {
    let mut headers = Vec::new();
    if let Some(service) = &decl.service_key {
        match crate::tenancy::keys::key_for_public(k, tenant, service).await {
            Ok(Some(key)) => headers.push(("authorization".to_string(), format!("Bearer {key}"))),
            Ok(None) => return Err(format!("no key of the service {service} is set")),
            Err(_) => return Err("the key of the service cannot be read".into()),
        }
    }
    Ok(headers)
}

/// `POST <target>`; the service accepts with 2xx (202 expected) and may give the id of its run.
async fn push(
    k: &Kernel,
    plugin: &crate::plugins::LoadedPlugin,
    decl: &mosaikit_mskp::ScheduleDecl,
    tenant: Uuid,
    body: Value,
) -> std::result::Result<Option<String>, String> {
    let exempt = exempt_for(k, plugin, decl, &decl.target)?;
    let headers = auth_headers(k, decl, tenant).await?;
    let r = crate::webfetch::request(
        k,
        reqwest::Method::POST,
        &decl.target,
        &headers,
        Some(body.to_string()),
        MAX_REPLY,
        &exempt,
    )
    .await
    .map_err(|e| short(&e.message))?;
    if !(200..300).contains(&r.status) {
        // only the status: the text of the service may echo what it was sent
        return Err(format!("the service answered {}", r.status));
    }
    let reply: Value = serde_json::from_slice(&r.body).unwrap_or(Value::Null);
    let id = ["run_id", "id"].iter().find_map(|k| match reply.get(k) {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    });
    match id {
        Some(id) if !valid_run_id(&id) => Err("the service gave an invalid run id".into()),
        other => Ok(other),
    }
}

fn valid_run_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Where the result of a run is read: `<target without a final /run>/runs/{id}`, so `/schedules/run` gives
/// `/schedules/runs/{id}`; any other path gets `/runs/{id}` appended.
pub fn status_url(target: &str, id: &str) -> String {
    let t = target.split(['?', '#']).next().unwrap_or(target).trim_end_matches('/');
    match t.strip_suffix("/run") {
        Some(base) => format!("{base}/runs/{id}"),
        None => format!("{t}/runs/{id}"),
    }
}

/// How a run ended.
#[derive(Debug)]
pub(crate) enum Finish {
    Succeeded,
    Failed(String),
    TimedOut(u32),
}

pub(crate) struct RunRow {
    pub id: Uuid,
    pub schedule: Uuid,
    pub tenant: Uuid,
    pub ticket: Option<Uuid>,
}

/// Ends a run in flight: the record, the ticket, and the schedule (count, retry, pause). Only once: a run
/// that is not `running` any more is left as it is.
pub(crate) async fn finish_run(
    k: &Kernel,
    run: &RunRow,
    plugin: &str,
    name: &str,
    author: Uuid,
    how: Finish,
) -> Result<()> {
    let (status, error) = match &how {
        Finish::Succeeded => ("succeeded", None),
        Finish::Failed(m) => ("failed", Some(short(m))),
        Finish::TimedOut(mins) => ("timed_out", Some(format!("the run took longer than {mins} minutes"))),
    };
    let done = mosaikit_db::query(
        "update core.schedule_runs set status = $2, error = $3, finished_at = now()
         where id = $1 and status = 'running'",
    )
    .bind(run.id)
    .bind(status)
    .bind(error.as_deref())
    .execute(&k.db)
    .await?;
    if done.rows_affected() == 0 {
        return Ok(());
    }
    if let Some(t) = run.ticket {
        crate::run_tickets::revoke_row(k, t).await?;
    }
    let ok = matches!(how, Finish::Succeeded);
    settle(k, run.schedule, ok, status).await?;
    if !ok {
        events::record(
            k,
            Some(run.tenant),
            Some(author),
            Some(plugin),
            None,
            "schedule.failed",
            json!({ "schedule": run.schedule, "name": name, "run": run.id, "status": status, "by": "scheduler" }),
        )
        .await;
        pause_if_failing(k, run.tenant, run.schedule, plugin, name, author).await?;
    }
    Ok(())
}

async fn audit_failed(k: &Kernel, s: &Claimed, run: Option<Uuid>, _why: &str) {
    events::record(
        k,
        Some(s.tenant),
        Some(s.user),
        Some(&s.plugin),
        None,
        "schedule.failed",
        json!({ "schedule": s.id, "name": s.name, "run": run, "status": "failed", "by": "scheduler" }),
    )
    .await;
}

/// Retry delay after the `n`-th failure in a row: 5, 10, 20, 40, 60 minutes.
pub fn retry_delay_minutes(n: i32) -> i64 {
    (5i64 << (n.clamp(1, 6) - 1)).min(60)
}

/// Updates the schedule after a run: the count of failures, the last status, the lease and the next run.
/// After a failure the next run is the retry if that is sooner than the timetable.
async fn settle(k: &Kernel, id: Uuid, ok: bool, status: &str) -> Result<()> {
    let Some(row) = mosaikit_db::query(
        "select cron, time_zone, next_run_at, consecutive_failures from core.schedules where id = $1",
    )
    .bind(id)
    .fetch_optional(&k.db)
    .await?
    else {
        return Ok(());
    };
    let (cron, zone): (String, String) = (row.get(0), row.get(1));
    let (next, failures): (Option<DateTime<Utc>>, i32) = (row.get(2), row.get(3));
    let now = Utc::now();
    let tz = zone_of(Some(&zone))?;
    // runs that fell due while this one was running are skipped
    let base = match next {
        Some(n) if n > now => Some(n),
        _ => Cron::parse(&cron).ok().and_then(|c| c.next_after_in(now, tz)),
    };
    let failures = if ok { 0 } else { failures + 1 };
    let next = if ok {
        base
    } else {
        let retry = now + chrono::Duration::minutes(retry_delay_minutes(failures));
        Some(base.map_or(retry, |b| b.min(retry)))
    };
    mosaikit_db::query(
        "update core.schedules set consecutive_failures = $2, last_status = $3, claimed_until = null,
                next_run_at = $4
         where id = $1",
    )
    .bind(id)
    .bind(failures)
    .bind(status)
    .bind(next)
    .execute(&k.db)
    .await?;
    Ok(())
}

/// Pauses a schedule that failed `MAX_FAILURES` times in a row and tells its author.
async fn pause_if_failing(
    k: &Kernel,
    tenant: Uuid,
    id: Uuid,
    plugin: &str,
    name: &str,
    author: Uuid,
) -> Result<()> {
    let done = mosaikit_db::query(
        "update core.schedules set status = 'paused', paused_reason = 'failures', claimed_until = null
         where id = $1 and status = 'active' and consecutive_failures >= $2",
    )
    .bind(id)
    .bind(MAX_FAILURES)
    .execute(&k.db)
    .await?;
    if done.rows_affected() == 0 {
        return Ok(());
    }
    events::record(
        k,
        Some(tenant),
        None,
        Some(plugin),
        None,
        "schedule.paused",
        json!({ "schedule": id, "name": name, "reason": "failures", "failures": MAX_FAILURES, "by": "scheduler" }),
    )
    .await;
    crate::notify::emit(
        k,
        crate::notify::New {
            user: author,
            tenant: Some(tenant),
            kind: crate::notify::NoteKind::System,
            title: "Schedule paused".into(),
            body: format!("The schedule '{name}' failed {MAX_FAILURES} times in a row and was paused."),
            link: String::new(),
            source: "kernel".into(),
            resource: None,
            data: json!({ "code": "schedule_paused_failures", "schedule": id, "name": name }),
        },
    )
    .await;
    Ok(())
}

/// A run in flight, with what is needed to ask the service about it.
struct Open {
    run: RunRow,
    service_run_id: Option<String>,
    deadline: DateTime<Utc>,
    plugin: String,
    name: String,
    author: Uuid,
}

/// Looks at the runs in flight: timed out, over (the service says so), or still running.
pub async fn poll_runs(k: &Arc<Kernel>) -> Result<()> {
    let rows = mosaikit_db::query(
        "select r.id, r.schedule_id, r.tenant_id, r.ticket_id, r.service_run_id, r.deadline_at,
                s.plugin_id, s.name, s.user_id
         from core.schedule_runs r join core.schedules s on s.id = r.schedule_id
         where r.status = 'running' order by r.started_at limit $1",
    )
    .bind(POLL_BATCH)
    .fetch_all(&k.db)
    .await?;
    let sem = Arc::new(tokio::sync::Semaphore::new(CONCURRENT));
    let mut set = tokio::task::JoinSet::new();
    for r in rows {
        let open = Open {
            run: RunRow { id: r.get(0), schedule: r.get(1), tenant: r.get(2), ticket: r.get(3) },
            service_run_id: r.get(4),
            deadline: r.get(5),
            plugin: r.get(6),
            name: r.get(7),
            author: r.get(8),
        };
        let (k, sem) = (k.clone(), sem.clone());
        set.spawn(async move {
            let _permit = sem.acquire_owned().await;
            if let Err(e) = poll_one(&k, open).await {
                tracing::warn!("schedule run: {e}");
            }
        });
    }
    while set.join_next().await.is_some() {}
    Ok(())
}

async fn poll_one(k: &Kernel, o: Open) -> Result<()> {
    if o.deadline < Utc::now() {
        let mins = timeout_minutes(k, &o).await;
        return finish_run(k, &o.run, &o.plugin, &o.name, o.author, Finish::TimedOut(mins)).await;
    }
    let Some(id) = &o.service_run_id else {
        // the service gave no id: the run is over when it has ended its ticket
        let ended: Option<bool> =
            mosaikit_db::query_scalar("select revoked_at is not null from core.run_tickets where id = $1")
                .bind(o.run.ticket)
                .fetch_optional(&k.db)
                .await?;
        if ended.unwrap_or(true) {
            return finish_run(k, &o.run, &o.plugin, &o.name, o.author, Finish::Succeeded).await;
        }
        return Ok(());
    };
    let Ok(plugin) = k.plugins.active(&o.plugin) else {
        return finish_run(
            k,
            &o.run,
            &o.plugin,
            &o.name,
            o.author,
            Finish::Failed("the plugin is not active".into()),
        )
        .await;
    };
    let Some(decl) = plugin.manifest.schedules.iter().find(|d| d.name == o.name) else {
        return finish_run(
            k,
            &o.run,
            &o.plugin,
            &o.name,
            o.author,
            Finish::Failed("the plugin no longer declares this schedule".into()),
        )
        .await;
    };
    let url = status_url(&decl.target, id);
    let Ok(exempt) = exempt_for(k, &plugin, decl, &url) else { return Ok(()) };
    let Ok(headers) = auth_headers(k, decl, o.run.tenant).await else { return Ok(()) };
    let Ok(r) =
        crate::webfetch::request(k, reqwest::Method::GET, &url, &headers, None, MAX_REPLY, &exempt).await
    else {
        // unreachable now: ask again next time; the deadline bounds it
        return Ok(());
    };
    let how = match r.status {
        200 => {
            let v: Value = serde_json::from_slice(&r.body).unwrap_or(Value::Null);
            match v.get("status").and_then(Value::as_str).unwrap_or("") {
                "succeeded" | "success" | "completed" | "done" | "ok" => Finish::Succeeded,
                "failed" | "error" | "cancelled" | "canceled" => Finish::Failed(
                    v.get("error").and_then(Value::as_str).unwrap_or("the run failed").to_string(),
                ),
                _ => return Ok(()),
            }
        }
        404 => Finish::Failed("the service does not know this run".into()),
        _ => return Ok(()),
    };
    finish_run(k, &o.run, &o.plugin, &o.name, o.author, how).await
}

/// The longest run of the declaration, for the message of a timeout.
async fn timeout_minutes(k: &Kernel, o: &Open) -> u32 {
    k.plugins
        .get(&o.plugin)
        .and_then(|p| p.manifest.schedules.iter().find(|d| d.name == o.name).map(|d| d.max_runtime()))
        .unwrap_or(crate::run_tickets::DEFAULT_TTL_MINUTES)
        .clamp(1, MAX_RUNTIME_MINUTES)
}

/// Runs a schedule of the tenant now (see `schedules::run_now`).
pub(crate) async fn run_now(k: &Kernel, tenant: Uuid, id: Uuid) -> Result<RunInfo> {
    let rows = mosaikit_db::query(format!(
        "update core.schedules set claimed_until = now() + make_interval(mins => $3)
         where id = $1 and tenant_id = $2 and status = 'active' and (claimed_until is null or claimed_until < now())
         returning {CLAIM_COLUMNS}"
    ))
    .bind(id)
    .bind(tenant)
    .bind(DISPATCH_LEASE_MINUTES as i32)
    .fetch_all(&k.db)
    .await?;
    let Some(row) = rows.first() else {
        let status: Option<String> =
            mosaikit_db::query_scalar("select status from core.schedules where id = $1 and tenant_id = $2")
                .bind(id)
                .bind(tenant)
                .fetch_optional(&k.db)
                .await?;
        return Err(match status.as_deref() {
            None => Error::not_found("schedule not found"),
            Some("paused") => Error::new(Kind::Conflict, "the schedule is paused: resume it first")
                .with_code("schedule_paused"),
            Some(_) => Error::new(Kind::Conflict, "a run of this schedule is already in flight")
                .with_code("already_running"),
        });
    };
    let s = claimed(row);
    match dispatch(k, &s, true).await? {
        Outcome::Started(info) => Ok(info),
        Outcome::RateLimited => {
            Err(Error::new(Kind::TooMany, "too many runs: try again in a minute")
                .with_code("run_rate_limited"))
        }
        Outcome::Skipped(reason) => Err(Error::forbidden(
            "the author can no longer run this job: the schedule was paused",
        )
        .with_code(match reason {
            "plugin_off" => "plugin_off",
            "command_removed" => "command_removed",
            _ => "author_inactive",
        })),
        Outcome::Missed => Err(Error::internal("a manual run cannot be missed")),
    }
}
