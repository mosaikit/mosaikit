//! `resources.list`: the resources of another plugin that the caller sees, for a picker (a map, a
//! dashboard or a document to publish or to link). Needs `[permissions] resources_read = ["<plugin id>"]`:
//! the plugin names the plugins it may list, and the Administrator sees the list when it is installed.
//!
//! The rules are those of the plugin that owns the resources, run for the caller: the plugin must be on in
//! the tenant, the caller must have the `use` permission of it, and the rows come from the view
//! `core.visible_resources` on a read transaction of that plugin, so the access control list is the one
//! of every other screen. The answer has no storage path, no body and no content: `id`, `plugin`, `kind`,
//! `title`, `owner_name`, `my_level`, `updated_at`; at most [`MAX_LIMIT`] rows, newest first.

use serde_json::{json, Value};

use crate::{Caller, Error, Kernel, Result};

/// Rows returned when `limit` is not given.
pub const DEFAULT_LIMIT: i64 = 50;
/// Most rows a call may ask for; more is capped to this.
pub const MAX_LIMIT: i64 = 200;
/// Longest `q` and `kind`, in characters.
pub const MAX_TEXT: usize = 64;

/// `resources.list` for the logic of the plugin `from`, which declared `allowed` in `resources_read`.
/// `req`: `{ plugin, kind?, q?, limit? }`.
pub(crate) async fn list_from_logic(
    k: &Kernel,
    c: &Caller,
    allowed: &[String],
    req: &Value,
) -> Result<Value> {
    let bad = |m: &str| Error::bad(m.to_string());
    let target = req.get("plugin").and_then(Value::as_str).ok_or_else(|| bad("plugin is required"))?;
    if !allowed.iter().any(|a| a == target) {
        return Err(Error::forbidden("the plugin is not declared in `resources_read` in [permissions]")
            .with_code("permission_denied"));
    }
    let text = |key: &str| -> Result<Option<String>> {
        match req.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(Value::String(s)) => {
                let s = s.trim();
                if s.chars().count() > MAX_TEXT || s.chars().any(char::is_control) {
                    return Err(bad(&format!("{key}: at most {MAX_TEXT} characters, no control characters")));
                }
                Ok((!s.is_empty()).then(|| s.to_string()))
            }
            Some(_) => Err(bad(&format!("{key} must be a text"))),
        }
    };
    let (kind, q) = (text("kind")?, text("q")?);
    let limit = match req.get("limit") {
        None | Some(Value::Null) => DEFAULT_LIMIT,
        Some(v) => match v.as_i64() {
            Some(n) if n >= 1 => n.min(MAX_LIMIT),
            _ => return Err(bad("limit must be a positive integer")),
        },
    };
    // the plugin must be on in the tenant and the caller must use it
    let (p, _) = crate::access::require(k, c, target, crate::access::USE).await?;
    let like = q.map(|q| format!("%{}%", crate::util::like_escape(&q)));
    // the limit is a validated integer, written into the text: it cannot carry anything else
    let sql = format!(
        "select id, plugin_id, kind, title, owner_name,
                case my_level when 3 then 'manage' when 2 then 'write' else 'read' end, updated_at
         from core.visible_resources
         where kind <> 'folder' and ($1 is null or kind = $1) and ($2 is null or title ilike $2 escape '\\')
         order by updated_at desc, id
         limit {}",
        limit + 1
    );
    let mut tx = k.db.begin_plugin_read(&p.id, &c.ctx()).await?;
    let rows = mosaikit_db::query(&sql).bind(kind).bind(like).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    let truncated = rows.len() as i64 > limit;
    let entries: Vec<Value> = rows
        .iter()
        .take(limit as usize)
        .map(|r| {
            json!({
                "id": r.get::<uuid::Uuid, _>(0).to_string(),
                "plugin": r.get::<String, _>(1),
                "kind": r.get::<String, _>(2),
                "title": r.get::<String, _>(3),
                "owner_name": r.get::<String, _>(4),
                "my_level": r.get::<String, _>(5),
                "updated_at": r.get::<chrono::DateTime<chrono::Utc>, _>(6),
            })
        })
        .collect();
    Ok(json!({ "entries": entries, "truncated": truncated }))
}
