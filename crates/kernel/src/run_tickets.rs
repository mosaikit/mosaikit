//! Run tickets: a plugin called on behalf of a process that outlives the session that started it.
//!
//! A service of a distribution runs a process in the background (a graph of nodes, a report) and a
//! node is a command of a plugin. The service has no session, so the person who starts the run mints
//! a ticket with their session (`mint`): a bearer secret for one plugin, a list of its commands, and
//! optionally a list of resources, with a short life and a number of uses. The service redeems it on
//! every call (`call`).
//!
//! What stops a leaked ticket from being the person's whole account:
//! - only commands the plugin declares in `permissions.run_commands`, only the ones named at mint,
//!   only the plugin named at mint (and its **targets**: other plugins the first one declares in
//!   `permissions.run_targets`, each with the commands it declares itself); the manifests are read again
//!   on every call;
//! - the rights of the person are evaluated at **call** time (user, tenant, membership, plugin on,
//!   permission to use it), never taken from the mint;
//! - with `resources` the database caps the level of the person to those resources and their
//!   descendants (`Ctx::scope`, see migration 0021): the logic cannot read more, whatever its
//!   arguments say;
//! - no `plugin.call` from such a call, no minting, a short lifetime, a number of uses, a size limit and
//!   a rate limit;
//! - the token is never stored (a hash is) and never logged.
//!
//! What the kernel cannot stop: the logic of the plugin returning to the service data it legitimately
//! read. The plugin author carries that part (docs/devkit/security.md).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::util::{random_token, sha256};
use crate::{events, Caller, Error, Kernel, Kind, Result, RunCall, SessionUser};

/// Lifetime of a ticket in minutes: the default and the ceiling.
pub const DEFAULT_TTL_MINUTES: u32 = 15;
pub const MAX_TTL_MINUTES: u32 = 60;
/// Calls a ticket allows: the default and the ceiling.
pub const DEFAULT_USES: u32 = 100;
pub const MAX_USES: u32 = 1000;
/// Most resources a ticket may name.
pub const MAX_RESOURCES: usize = 64;
/// Longest `run_ref` (the service's own id of the run, kept in the audit log).
pub const MAX_RUN_REF: usize = 128;
/// Largest arguments of a call, serialized.
pub const MAX_ARG_BYTES: usize = 256 * 1024;
/// Tickets a person may have alive at once in a tenant.
pub const MAX_ACTIVE: i64 = 100;
/// Tickets a person may mint per minute, calls per ticket per minute, calls per tenant per minute.
const MINTS_PER_MINUTE: u32 = 30;
const CALLS_PER_TICKET: u32 = 120;
const CALLS_PER_TENANT: u32 = 1200;
const WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Debug, Clone, Deserialize)]
pub struct MintRequest {
    pub plugin: String,
    pub commands: Vec<String>,
    /// the service's own name for the run (shown in the Log)
    pub run_ref: String,
    /// lifetime in minutes (default 15, at most 60)
    #[serde(default)]
    pub ttl_minutes: Option<u32>,
    /// calls allowed (default 100, at most 1000)
    #[serde(default)]
    pub uses: Option<u32>,
    /// resources the ticket is limited to; none: the rights of the person
    #[serde(default)]
    pub resources: Option<Vec<Uuid>>,
    /// other plugins the run may call (each in `permissions.run_targets` of `plugin`)
    #[serde(default)]
    pub targets: Vec<Target>,
    /// the schedule that mints the ticket (set by the schedules worker, never by a request)
    #[serde(skip)]
    pub schedule: Option<Uuid>,
}

/// A plugin besides the first one that a ticket may call, with its own commands and resource scope.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Target {
    pub plugin: String,
    /// commands of that plugin's `permissions.run_commands`
    pub commands: Vec<String>,
    /// resources of that plugin the entry is limited to; none: the rights of the person in that plugin
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources: Option<Vec<Uuid>>,
}

/// Most targets of a ticket, and most `runs.mint` of one command.
pub const MAX_TARGETS: usize = 8;
pub(crate) const MAX_MINTS_PER_COMMAND: usize = 8;

#[derive(Debug, Clone, Serialize)]
pub struct Minted {
    pub id: Uuid,
    /// shown only now: the server keeps only the hash
    pub token: String,
    pub expires_at: DateTime<Utc>,
    pub uses: u32,
}

fn invalid() -> Error {
    Error::new(Kind::Unauthorized, "invalid, expired or revoked run ticket").with_code("run_ticket_invalid")
}

/// A ticket that passed every check and is not written yet (see [`insert`]).
#[derive(Debug, Clone)]
pub(crate) struct Prepared {
    id: Uuid,
    token: String,
    user: Uuid,
    tenant: Uuid,
    plugin: String,
    run_ref: String,
    commands: Vec<String>,
    resources: Option<Vec<Uuid>>,
    targets: Vec<Target>,
    uses: u32,
    ttl: u32,
    schedule: Option<Uuid>,
    by: &'static str,
}

impl Prepared {
    /// What the logic is given at once: the ticket is written after its command commits.
    pub(crate) fn answer(&self) -> Value {
        let expires_at = Utc::now() + chrono::Duration::minutes(i64::from(self.ttl));
        json!({ "id": self.id, "token": self.token, "expires_at": expires_at, "uses": self.uses })
    }
}

fn denied(msg: impl Into<String>, code: &'static str) -> Error {
    Error::forbidden(msg).with_code(code)
}

/// The commands asked for, each one in `declared`, without repeats.
fn check_commands(asked: &[String], declared: &[String], who: &str) -> Result<Vec<String>> {
    if asked.is_empty() || asked.len() > mosaikit_mskp::MAX_RUN_COMMANDS {
        return Err(Error::bad("name the commands the ticket may call (at most 32)"));
    }
    let mut commands: Vec<String> = Vec::new();
    for name in asked {
        if !declared.contains(name) {
            return Err(denied(
                format!("{who} does not declare '{name}' as a run command"),
                "command_not_declared",
            ));
        }
        if !commands.contains(name) {
            commands.push(name.clone());
        }
    }
    Ok(commands)
}

/// The plugin of a resource that `c` sees now. A read transaction: a mint from the logic of a command runs while the
/// transaction of that command holds the only writer of SQLite, so it must not open another one that writes.
async fn visible_plugin_of(k: &Kernel, c: &Caller, rid: Uuid) -> Result<String> {
    let mut tx = k.db.begin_read(&c.ctx()).await?;
    let row =
        mosaikit_db::query("select r.plugin_id, core.level_of(r.id) from core.resources r where r.id = $1")
            .bind(rid)
            .fetch_optional(&mut *tx)
            .await?;
    tx.commit().await?;
    match row {
        Some(r) if r.get::<i32, _>(1) > 0 => Ok(r.get(0)),
        _ => Err(Error::not_found("resource not found")),
    }
}

/// The resources of an entry: each one visible to `c` now and belonging to `plugin_id`.
async fn check_resources(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    list: &Option<Vec<Uuid>>,
) -> Result<Option<Vec<Uuid>>> {
    let Some(list) = list else { return Ok(None) };
    if list.is_empty() || list.len() > MAX_RESOURCES {
        return Err(Error::bad(format!("resources: 1 to {MAX_RESOURCES}")));
    }
    let mut ids: Vec<Uuid> = Vec::new();
    for id in list {
        // the starter must see each one now, and it must belong to this plugin
        if visible_plugin_of(k, c, *id).await? != plugin_id {
            return Err(Error::bad("a resource of the ticket belongs to another plugin"));
        }
        if !ids.contains(id) {
            ids.push(*id);
        }
    }
    Ok(Some(ids))
}

/// Mints a ticket for `c` (a person with a session: a call on behalf of a run cannot mint).
pub async fn mint(k: &Kernel, c: &Caller, req: &MintRequest) -> Result<Minted> {
    let p = prepare(k, c, req, "rest").await?;
    insert(k, &p).await
}

/// Every check of a mint, with no write: the same for the REST route, a schedule and the logic of the
/// plugin that starts the run (`by` is only for the audit event).
pub(crate) async fn prepare(k: &Kernel, c: &Caller, req: &MintRequest, by: &'static str) -> Result<Prepared> {
    if c.run.is_some() {
        return Err(Error::forbidden("a run ticket cannot mint a run ticket"));
    }
    let (p, _) = crate::access::require(k, c, &req.plugin, crate::access::USE).await?;
    let declared = &p.manifest.permissions.run_commands;
    if declared.is_empty() {
        return Err(Error::bad("this plugin does not declare run commands").with_code("no_run_commands"));
    }
    let commands = check_commands(&req.commands, declared, "the plugin")?;
    let run_ref = req.run_ref.trim();
    if run_ref.is_empty() || run_ref.chars().count() > MAX_RUN_REF || run_ref.chars().any(char::is_control) {
        return Err(Error::bad(format!("run_ref: 1 to {MAX_RUN_REF} characters, no control characters")));
    }
    let ttl = req.ttl_minutes.unwrap_or(DEFAULT_TTL_MINUTES);
    if ttl == 0 || ttl > MAX_TTL_MINUTES {
        return Err(Error::bad(format!("ttl_minutes: 1 to {MAX_TTL_MINUTES}")));
    }
    let uses = req.uses.unwrap_or(DEFAULT_USES);
    if uses == 0 || uses > MAX_USES {
        return Err(Error::bad(format!("uses: 1 to {MAX_USES}")));
    }
    let resources = check_resources(k, c, &p.id, &req.resources).await?;
    if req.targets.len() > MAX_TARGETS {
        return Err(Error::bad(format!("targets: at most {MAX_TARGETS}")));
    }
    let mut targets: Vec<Target> = Vec::new();
    for t in &req.targets {
        if t.plugin == p.id || targets.iter().any(|x| x.plugin == t.plugin) {
            return Err(Error::bad("targets: a plugin is named once, and not the plugin of the ticket"));
        }
        // only what the plugin of the ticket declares: neither the request nor the target can widen it
        if !p.manifest.permissions.run_targets.contains(&t.plugin) {
            return Err(denied(
                format!("the plugin does not declare '{}' in run_targets", t.plugin),
                "target_not_declared",
            ));
        }
        let unavailable =
            || denied(format!("'{}' is not available in this tenant", t.plugin), "target_not_available");
        let tp = k.plugins.active(&t.plugin).map_err(|_| unavailable())?;
        if !crate::plugins::tenants::is_on(k, c.tenant.tenant_id, &t.plugin).await? {
            return Err(unavailable());
        }
        // the person must use it now
        crate::access::require(k, c, &t.plugin, crate::access::USE).await?;
        let commands = check_commands(&t.commands, &tp.manifest.permissions.run_commands, &t.plugin)?;
        let resources = check_resources(k, c, &tp.id, &t.resources).await?;
        targets.push(Target { plugin: tp.id.clone(), commands, resources });
    }
    if !k.limiter.hit(&format!("runmint:{}", c.user.user_id), MINTS_PER_MINUTE, WINDOW) {
        return Err(Error::new(Kind::TooMany, "too many run tickets: try again in a minute")
            .with_code("run_rate_limited"));
    }
    let alive: i64 = mosaikit_db::query_scalar(
        "select count(*) from core.run_tickets
         where user_id = $1 and tenant_id = $2 and revoked_at is null and uses_left > 0 and expires_at > now()",
    )
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .fetch_one(&k.db)
    .await?;
    if alive >= MAX_ACTIVE {
        return Err(Error::new(Kind::TooMany, "too many live run tickets: revoke or wait for some")
            .with_code("run_too_many"));
    }
    Ok(Prepared {
        id: Uuid::new_v4(),
        token: random_token(24),
        user: c.user.user_id,
        tenant: c.tenant.tenant_id,
        plugin: p.id.clone(),
        run_ref: run_ref.to_string(),
        commands,
        resources,
        targets,
        uses,
        ttl,
        schedule: req.schedule,
        by,
    })
}

/// Writes a prepared ticket and records the event.
pub(crate) async fn insert(k: &Kernel, t: &Prepared) -> Result<Minted> {
    // tickets that are over are not kept
    let _ = mosaikit_db::query("delete from core.run_tickets where expires_at < now()").execute(&k.db).await;
    let row = mosaikit_db::query(
        "insert into core.run_tickets
            (id, token_hash, user_id, tenant_id, plugin_id, run_ref, commands, resources, uses_left, expires_at, schedule_id, targets)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(mins => $10), $11, $12)
         returning expires_at",
    )
    .bind(t.id)
    .bind(sha256(t.token.as_bytes()))
    .bind(t.user)
    .bind(t.tenant)
    .bind(&t.plugin)
    .bind(&t.run_ref)
    .bind(json!(t.commands))
    .bind(t.resources.as_ref().map(|r| json!(r)))
    .bind(t.uses as i32)
    .bind(t.ttl as i32)
    .bind(t.schedule)
    .bind((!t.targets.is_empty()).then(|| json!(t.targets)))
    .fetch_one(&k.db)
    .await?;
    let expires_at: DateTime<Utc> = row.get(0);
    let targets: Vec<Value> = t
        .targets
        .iter()
        .map(|x| json!({ "plugin": x.plugin, "commands": x.commands, "resources": x.resources.as_ref().map(Vec::len) }))
        .collect();
    events::record(
        k,
        Some(t.tenant),
        Some(t.user),
        Some(&t.plugin),
        None,
        "run_ticket.mint",
        json!({
            "ticket": t.id, "run_ref": t.run_ref, "commands": t.commands, "uses": t.uses, "schedule": t.schedule,
            "expires_at": expires_at, "resources": t.resources.as_ref().map(Vec::len), "by": t.by,
            "targets": targets,
        }),
    )
    .await;
    Ok(Minted { id: t.id, token: t.token.clone(), expires_at, uses: t.uses })
}

/// `runs.mint` of the logic of `plugin` for the person `c`: `{ commands, run_ref, ttl_minutes?, uses?,
/// resources?, targets? }`. The plugin is the one that runs, never a field of the request. Nested calls
/// and calls on behalf of a run are refused by the host before this. The ticket is checked now; it is
/// written once the command has committed (see [`insert`]).
pub(crate) async fn prepare_from_logic(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    req: &Value,
) -> Result<Prepared> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Ask {
        commands: Vec<String>,
        run_ref: String,
        #[serde(default)]
        ttl_minutes: Option<u32>,
        #[serde(default)]
        uses: Option<u32>,
        #[serde(default)]
        resources: Option<Vec<Uuid>>,
        #[serde(default)]
        targets: Vec<Target>,
    }
    let a: Ask = serde_json::from_value(req.clone())
        .map_err(|e| Error::bad(format!("invalid runs.mint request: {e}")).with_code("invalid_argument"))?;
    let r = MintRequest {
        plugin: plugin.to_string(),
        commands: a.commands,
        run_ref: a.run_ref,
        ttl_minutes: a.ttl_minutes,
        uses: a.uses,
        resources: a.resources,
        targets: a.targets,
        schedule: None,
    };
    prepare(k, c, &r, "plugin").await
}

/// Revokes a ticket of the tenant: the person who minted it, or a Tenant Manager.
pub async fn revoke(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    let row = mosaikit_db::query(
        "select user_id, plugin_id, run_ref from core.run_tickets where id = $1 and tenant_id = $2",
    )
    .bind(id)
    .bind(c.tenant.tenant_id)
    .fetch_optional(&k.db)
    .await?;
    let not_found = || Error::not_found("run ticket not found");
    let row = row.ok_or_else(not_found)?;
    let (owner, plugin, run_ref): (Uuid, String, String) = (row.get(0), row.get(1), row.get(2));
    if owner != c.user.user_id && !c.is_manager() {
        return Err(not_found());
    }
    revoke_row(k, id).await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&plugin),
        None,
        "run_ticket.revoke",
        json!({ "ticket": id, "run_ref": run_ref }),
    )
    .await;
    Ok(())
}

pub(crate) async fn revoke_row(k: &Kernel, id: Uuid) -> Result<()> {
    mosaikit_db::query("update core.run_tickets set revoked_at = now() where id = $1 and revoked_at is null")
        .bind(id)
        .execute(&k.db)
        .await?;
    Ok(())
}

/// A ticket as read from the table.
struct Row {
    id: Uuid,
    user: Uuid,
    tenant: Uuid,
    plugin: String,
    run_ref: String,
    commands: Vec<String>,
    resources: Option<Vec<Uuid>>,
    targets: Vec<Target>,
    /// the schedule that minted it and its name
    schedule: Option<(Uuid, String)>,
}

async fn lookup(k: &Kernel, token: &str) -> Result<Row> {
    if token.len() != 48 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid());
    }
    let row = mosaikit_db::query(
        "select t.id, t.user_id, t.tenant_id, t.plugin_id, t.run_ref, t.commands, t.resources, t.schedule_id, s.name, t.targets
         from core.run_tickets t left join core.schedules s on s.id = t.schedule_id
         where t.token_hash = $1 and t.revoked_at is null and t.uses_left > 0 and t.expires_at > now()",
    )
    .bind(sha256(token.as_bytes()))
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(invalid)?;
    let commands: Value = row.get(5);
    let resources: Option<Value> = row.get(6);
    let strings = |v: &Value| -> Vec<String> {
        v.as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    Ok(Row {
        id: row.get(0),
        user: row.get(1),
        tenant: row.get(2),
        plugin: row.get(3),
        run_ref: row.get(4),
        commands: strings(&commands),
        resources: resources
            .filter(|v| !v.is_null())
            .map(|v| strings(&v).iter().filter_map(|s| s.parse().ok()).collect()),
        targets: row
            .get::<Option<Value>, _>(9)
            .filter(|v| !v.is_null())
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        schedule: row.get::<Option<Uuid>, _>(7).zip(row.get::<Option<String>, _>(8)),
    })
}

/// The person of the ticket as a caller of their tenant, with what the database knows now: an account
/// that is suspended, removed from the tenant or in a tenant that is off no longer gets a call.
async fn caller_of(k: &Kernel, t: &Row, resources: Option<Vec<Uuid>>) -> Result<Caller> {
    let mut c = caller_for(k, t.user, t.tenant).await?;
    c.run = Some(RunCall {
        ticket: t.id,
        run_ref: t.run_ref.clone(),
        resources,
        scheduled_by: t.schedule.as_ref().map(|(id, _)| *id),
        schedule_name: t.schedule.as_ref().map(|(_, n)| n.clone()),
    });
    Ok(c)
}

/// A person as a caller of one of their tenants, with what the database knows now (no Administrator's
/// powers): `run_ticket_invalid` when the account or the tenant is suspended or the membership is gone.
pub(crate) async fn caller_for(k: &Kernel, user_id: Uuid, tenant: Uuid) -> Result<Caller> {
    let user = mosaikit_db::query(
        "select u.username, u.display_name, u.home_tenant_id, h.slug
         from core.users u join core.tenants h on h.id = u.home_tenant_id
         where u.id = $1 and u.status = 'active' and h.status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(invalid)?;
    let slug: String = mosaikit_db::query_scalar("select slug from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(invalid)?;
    let session = SessionUser {
        user_id,
        username: user.get(0),
        display_name: user.get(1),
        home_tenant_id: user.get(2),
        home_tenant_slug: user.get(3),
        // a ticket never carries the Administrator's powers
        is_system_admin: false,
        csrf: String::new(),
        token_hash: Vec::new(),
    };
    crate::tenancy::caller(k, &session, &slug).await.map_err(|_| invalid())
}

/// Calls `command` of `plugin` on behalf of the ticket `token` (`POST /api/run/{token}/call/...`).
/// Every check is made again on every call.
pub async fn call(k: &Kernel, token: &str, plugin: &str, command: &str, args: Value) -> Result<Value> {
    // the ticket of an embedded page in a public link view belongs to the link, not to a person
    if token.starts_with(crate::embeds::PUBLIC_PREFIX) {
        return crate::embeds::call_public(k, token, plugin, command, args).await;
    }
    let t = lookup(k, token).await?;
    // the entry of the ticket for the plugin called: its own plugin or one of its targets
    let (allowed, scope): (&[String], &Option<Vec<Uuid>>) = if t.plugin == plugin {
        (&t.commands, &t.resources)
    } else if let Some(x) = t.targets.iter().find(|x| x.plugin == plugin) {
        (&x.commands, &x.resources)
    } else {
        return Err(Error::forbidden("this ticket is for another plugin").with_code("run_wrong_plugin"));
    };
    if !allowed.iter().any(|c| c == command) {
        return Err(
            Error::forbidden("this ticket does not allow this command").with_code("run_wrong_command")
        );
    }
    if t.plugin != plugin {
        // an update of the first plugin may have taken the target out of its declaration
        let declared = k
            .plugins
            .active(&t.plugin)
            .map(|p| p.manifest.permissions.run_targets.iter().any(|x| x == plugin))
            .unwrap_or(false);
        if !declared {
            return Err(denied(
                "the plugin of the ticket no longer declares this target",
                "target_not_declared",
            ));
        }
    }
    // the plugin as it is now: an update may have taken the command out of its declaration
    let p = k.plugins.active(plugin)?;
    if !p.manifest.permissions.run_commands.iter().any(|c| c == command) {
        return Err(Error::forbidden("the plugin does not declare this command for runs")
            .with_code("command_not_declared"));
    }
    if serde_json::to_vec(&args)?.len() > MAX_ARG_BYTES {
        return Err(Error::bad("the arguments are too large").with_code("args_too_large"));
    }
    let c = caller_of(k, &t, scope.clone()).await?;
    if !crate::plugins::tenants::is_on(k, t.tenant, plugin).await? {
        return Err(invalid());
    }
    if !k.limiter.hit(&format!("runcall:ticket:{}", t.id), CALLS_PER_TICKET, WINDOW)
        || !k.limiter.hit(&format!("runcall:tenant:{}", t.tenant), CALLS_PER_TENANT, WINDOW)
    {
        return Err(Error::new(Kind::TooMany, "too many requests: try again in a minute")
            .with_code("run_rate_limited"));
    }
    // the use is spent before the call, atomically: two calls cannot both take the last one
    let spent = mosaikit_db::query(
        "update core.run_tickets set uses_left = uses_left - 1
         where id = $1 and revoked_at is null and uses_left > 0 and expires_at > now()",
    )
    .bind(t.id)
    .execute(&k.db)
    .await?
    .rows_affected();
    if spent != 1 {
        return Err(invalid());
    }
    // the rights of the person are checked here (permission to use the plugin, the groups, the ACL
    // in the database), then the command runs as them, limited to the resources of the ticket
    let out = crate::crud::call_depth(k, &c, plugin, command, args, 0).await;
    events::record(
        k,
        Some(t.tenant),
        Some(t.user),
        Some(plugin),
        None,
        "run_ticket.call",
        json!({ "ticket": t.id, "run_ref": t.run_ref, "command": command, "ok": out.is_ok(),
                "target": (t.plugin != plugin).then_some(&t.plugin) }),
    )
    .await;
    out
}

/// The service says the run is over (`DELETE /api/run/{token}`): the ticket stops working.
pub async fn finish(k: &Kernel, token: &str) -> Result<()> {
    let t = lookup(k, token).await?;
    revoke_row(k, t.id).await?;
    events::record(
        k,
        Some(t.tenant),
        Some(t.user),
        Some(&t.plugin),
        None,
        "run_ticket.revoke",
        json!({ "ticket": t.id, "run_ref": t.run_ref, "by": "run" }),
    )
    .await;
    Ok(())
}
