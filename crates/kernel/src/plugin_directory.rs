//! Directory search for plugins (`[permissions] directory`): the people and groups of the tenant, so a
//! plugin can offer a picker of its own (an assignee, a reviewer, a recipient).
//!
//! The plugin SQL cannot read `core.users` (the guard does not open it) and `ctx.groups` lists only the
//! groups of the caller, so this is a host operation of the kernel with a query of its own. The design
//! is closed on every side:
//!
//! * the plugin must declare `directory` in its manifest (the Administrator sees it at install time);
//! * only a caller who may manage the plugin in the tenant (a Tenant Manager) or holds its `share`
//!   permission (the right to see people in the share dialog) may use it, whatever the plugin says;
//! * the tenant is the one of the authenticated caller, never an argument;
//! * the answer has no email and nothing else personal: `{id, username, name}` of the active members,
//!   `{id, name}` of the groups; at most [`MAX_LIMIT`] rows, in a fixed order;
//! * refused in a public link (no caller) and in a call on behalf of a run ticket (nobody is at the
//!   keyboard to pick someone);
//! * rate limited per person and per tenant; the audit log gets one `directory.search` event per person
//!   and plugin per minute, with neither the text searched nor the rows found.

use serde_json::{json, Value};

use crate::{events, Caller, Error, Kernel, Kind, Result};

/// Longest `q`, in characters.
pub const MAX_Q: usize = 64;
/// Rows returned when `limit` is not given.
pub const DEFAULT_LIMIT: i64 = 20;
/// Most rows a call may ask for; more is capped to this.
pub const MAX_LIMIT: i64 = 50;
/// The same for the people who hold a permission of the plugin (a list of reviewers is read whole).
pub const MAX_LIMIT_HOLDERS: i64 = 200;
/// Searches per minute: one person, and the whole tenant.
pub const PER_USER: u32 = 30;
pub const PER_TENANT: u32 = 300;
const WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

/// What `directory.search` asked for, once checked.
struct Query {
    users: bool,
    like: String,
    limit: i64,
    /// only the people who hold this permission of the plugin (`q` may then be empty)
    permission: Option<String>,
    /// `q` in lower case, for the filter by permission
    needle: String,
}

fn parse(req: &Value) -> Result<Query> {
    let bad = |m: &str| Error::bad(m.to_string());
    let users = match req.get("kind").and_then(Value::as_str) {
        Some("user") => true,
        Some("group") => false,
        _ => return Err(bad("kind must be \"user\" or \"group\"")),
    };
    let permission = match req.get("permission") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if users && !s.is_empty() && s.len() <= 64 => Some(s.clone()),
        _ => return Err(bad("permission is a key of the plugin, and only for kind \"user\"")),
    };
    let q = match (req.get("q"), &permission) {
        (None | Some(Value::Null), Some(_)) => "",
        (q, _) => q.and_then(Value::as_str).ok_or_else(|| bad("q is required"))?.trim(),
    };
    let len = q.chars().count();
    if len == 0 && permission.is_none() {
        return Err(bad("q must not be empty"));
    }
    if len > MAX_Q {
        return Err(bad(&format!("q is at most {MAX_Q} characters")));
    }
    if q.chars().any(char::is_control) {
        return Err(bad("q has control characters"));
    }
    let limit = match req.get("limit") {
        None | Some(Value::Null) => DEFAULT_LIMIT,
        Some(v) => match v.as_i64() {
            Some(n) if n >= 1 => n.min(if permission.is_some() { MAX_LIMIT_HOLDERS } else { MAX_LIMIT }),
            _ => return Err(bad("limit must be a positive integer")),
        },
    };
    let limit = match (req.get("limit"), &permission) {
        (None | Some(Value::Null), Some(_)) => MAX_LIMIT_HOLDERS,
        _ => limit,
    };
    Ok(Query {
        users,
        like: format!("%{}%", crate::util::like_escape(q)),
        limit,
        permission,
        needle: q.to_lowercase(),
    })
}

/// `directory.search`: `{ kind: "user" | "group", q, limit? }` for the caller `c` in the plugin `plugin`.
/// Users come as `[{id, username, name}]`, groups as `[{id, name}]`.
pub async fn search(k: &Kernel, c: &Caller, plugin: &str, req: &Value) -> Result<Value> {
    run(k, c, plugin, req, false).await
}

/// The same for the logic of a plugin, while the transaction of its command is open: the audit event is
/// written by a task of its own, which waits for the transaction to end (on SQLite a second writer cannot
/// go in before that).
pub(crate) async fn search_from_logic(k: &Kernel, c: &Caller, plugin: &str, req: &Value) -> Result<Value> {
    run(k, c, plugin, req, true).await
}

async fn run(k: &Kernel, c: &Caller, plugin: &str, req: &Value, detach_audit: bool) -> Result<Value> {
    if c.run.is_some() {
        return Err(Error::forbidden("the directory is not available in a call on behalf of a run")
            .with_code("permission_denied"));
    }
    // the plugin must be on in the tenant and the caller must use it
    let (p, perms) = crate::access::plugin_for(k, c, plugin).await?;
    if !p.manifest.permissions.directory {
        return Err(Error::forbidden("the plugin does not declare `directory` in [permissions]")
            .with_code("permission_denied"));
    }
    if !c.is_manager() && !perms.contains(crate::access::SHARE) {
        return Err(Error::forbidden("searching the directory needs the right to share in this plugin")
            .with_code("permission_denied"));
    }
    let q = parse(req)?;
    if !k.limiter.hit(&format!("dirsearch:user:{}", c.user.user_id), PER_USER, WINDOW)
        || !k.limiter.hit(&format!("dirsearch:tenant:{}", c.tenant.tenant_id), PER_TENANT, WINDOW)
    {
        return Err(Error::new(Kind::TooMany, "too many searches: try again in a minute")
            .with_code("directory_rate_limited"));
    }
    let tenant = c.tenant.tenant_id;
    let rows = if let Some(key) = &q.permission {
        // the people who hold the permission, filtered by `q` (empty: all of them), in name order
        let needle = q.needle.as_str();
        crate::access::holders(k, tenant, plugin, key)
            .await?
            .into_iter()
            .filter(|(_, u, n)| {
                needle.is_empty() || u.to_lowercase().contains(&needle) || n.to_lowercase().contains(&needle)
            })
            .take(q.limit as usize)
            .map(|(id, u, n)| json!({ "id": id.to_string(), "username": u, "name": n }))
            .collect::<Vec<_>>()
    } else if q.users {
        // the limit is a validated integer, written into the text: it cannot carry anything else
        let sql = format!(
            "select u.id, u.username, coalesce(nullif(u.display_name, ''), u.username)
             from core.memberships m join core.users u on u.id = m.user_id
             where m.tenant_id = $1 and m.status = 'active' and u.status = 'active'
               and (u.username ilike $2 escape '\\' or u.display_name ilike $2 escape '\\')
             order by lower(coalesce(nullif(u.display_name, ''), u.username)), u.username, u.id
             limit {}",
            q.limit
        );
        let rows = mosaikit_db::query(&sql).bind(tenant).bind(q.like).fetch_all(&k.db).await?;
        rows.iter()
            .map(|r| {
                json!({
                    "id": r.get::<uuid::Uuid, _>(0).to_string(),
                    "username": r.get::<String, _>(1),
                    "name": r.get::<String, _>(2),
                })
            })
            .collect::<Vec<_>>()
    } else {
        let sql = format!(
            "select g.id, g.name from core.groups g
             where g.tenant_id = $1 and g.name ilike $2 escape '\\'
             order by lower(g.name), g.name, g.id
             limit {}",
            q.limit
        );
        let rows = mosaikit_db::query(&sql).bind(tenant).bind(q.like).fetch_all(&k.db).await?;
        rows.iter()
            .map(|r| json!({ "id": r.get::<uuid::Uuid, _>(0).to_string(), "name": r.get::<String, _>(1) }))
            .collect::<Vec<_>>()
    };
    // one event per person and plugin per minute: a picker that searches on every key does not flood the log
    if k.limiter.hit(&format!("dirsearch:audit:{}:{}", c.user.user_id, p.id), 1, WINDOW) {
        let detail = json!({ "kind": if q.users { "user" } else { "group" } });
        let (user, plugin) = (c.user.user_id, p.id.clone());
        match k.arc().filter(|_| detach_audit) {
            Some(k) => {
                tokio::spawn(async move {
                    events::record(
                        &k,
                        Some(tenant),
                        Some(user),
                        Some(&plugin),
                        None,
                        "directory.search",
                        detail,
                    )
                    .await
                });
            }
            None => {
                events::record(k, Some(tenant), Some(user), Some(&plugin), None, "directory.search", detail)
                    .await
            }
        }
    }
    Ok(Value::Array(rows))
}
