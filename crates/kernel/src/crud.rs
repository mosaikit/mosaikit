//! Generic CRUD on the `[[resources]]` of the manifests.
//!
//! Every row is a kernel resource (owner, permissions, links). Every
//! operation runs with the role of the plugin: RLS decides what is visible.

use std::sync::Arc;

use mosaikit_db::{qi, Ctx, Tx};
use mosaikit_mskp::{FieldKind, ResourceDecl};
use serde::Serialize;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::host::{self, ctx_json, FUEL_COMMAND, FUEL_HOOK};
use crate::plugins::LoadedPlugin;
use crate::{events, Caller, Error, Kernel, Result};

const MAX_TEXT: usize = 10 << 20;
const MAX_ROWS: i64 = 5000;
/// Largest page of a paged list.
pub const MAX_PAGE: i64 = 500;

pub type Values = Map<String, Value>;

#[derive(Debug, Clone, Serialize)]
pub struct ListResult {
    pub resource: String,
    pub fields: Vec<mosaikit_mskp::FieldDecl>,
    pub rows: Vec<Value>,
    /// paged lists: the cursor of the next page (none on the last one)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    /// paged lists: how many rows the filter matches in all
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}

/// A page of a list: the latest changed first; `cursor` is the `next` of the previous page.
#[derive(Debug, Clone, Default)]
pub struct Paging {
    pub limit: i64,
    pub cursor: Option<String>,
}

/// The cursor of the row after which the next page starts: `<updated_at>|<id>` (keyset on the order of
/// the list, not an offset: a page costs the same however deep it is).
fn cursor_of(row: &Value) -> Option<String> {
    let at = row.get("updated_at")?.as_str()?;
    let id = row.get("id")?.as_str()?;
    Some(format!("{at}|{id}"))
}

fn parse_cursor(c: &str) -> Result<(String, Uuid)> {
    let (at, id) = c.rsplit_once('|').ok_or_else(|| Error::bad("invalid cursor"))?;
    let id = Uuid::parse_str(id).map_err(|_| Error::bad("invalid cursor"))?;
    if at.is_empty() || at.len() > 64 {
        return Err(Error::bad("invalid cursor"));
    }
    Ok((at.to_string(), id))
}

fn decl<'a>(p: &'a LoadedPlugin, resource: &str) -> Result<&'a ResourceDecl> {
    p.manifest.resource(resource).ok_or_else(|| Error::not_found(format!("unknown resource: {resource}")))
}

/// SELECT of the visible rows with metadata, as JSON.
fn select_sql(k: &Kernel, p: &LoadedPlugin, d: &ResourceDecl, cond: &str) -> String {
    select_sql_limit(k, p, d, cond, MAX_ROWS, false)
}

/// `with_total` (SQLite only): the second column is how many rows match, counted in the same pass.
fn select_sql_limit(
    k: &Kernel,
    p: &LoadedPlugin,
    d: &ResourceDecl,
    cond: &str,
    limit: i64,
    with_total: bool,
) -> String {
    if k.db.is_sqlite() {
        return select_sql_lite(p, d, cond, limit, with_total);
    }
    let obj: Vec<String> = d.fields.iter().map(|f| format!("'{0}', t.{1}", f.key, qi(&f.key))).collect();
    format!(
        "select coalesce(json_agg(x order by x.updated_at desc, x.id desc), '[]'::json) from (
           select t.resource_id as id, v.parent_id, v.owner_id, v.owner_name, v.shared, v.created_at, v.updated_at,
                  case v.my_level when 3 then 'manage' when 2 then 'write' else 'read' end as my_level,
                  json_build_object({obj}) as values
           from {schema}.{table} t join core.visible_resources v on v.id = t.resource_id
           where true {cond}
           order by v.updated_at desc, t.resource_id desc
           limit {limit}) x",
        obj = obj.join(", "),
        schema = qi(&p.schema()),
        table = qi(&d.name),
    )
}

/// Like `select_sql` for SQLite: JSON objects built row by row (`json_agg(x)`
/// does not exist) and booleans converted (SQLite stores them as 0/1).
fn select_sql_lite(p: &LoadedPlugin, d: &ResourceDecl, cond: &str, limit: i64, with_total: bool) -> String {
    let obj: Vec<String> = d
        .fields
        .iter()
        .map(|f| match f.kind {
            FieldKind::Bool => format!(
                "'{0}', case when t.{1} is null then null when t.{1} then json('true') else json('false') end",
                f.key,
                qi(&f.key)
            ),
            _ => format!("'{0}', t.{1}", f.key, qi(&f.key)),
        })
        .collect();
    format!(
        "select coalesce(json_group_array(json(x.obj) order by x.updated_at desc, x.id desc), '[]'){total_col} from (
           select json_object('id', t.resource_id, 'parent_id', v.parent_id, 'owner_id', v.owner_id,
                  'owner_name', v.owner_name, 'shared', json(case when v.shared then 'true' else 'false' end),
                  'created_at', v.created_at, 'updated_at', v.updated_at,
                  'my_level', case v.my_level when 3 then 'manage' when 2 then 'write' else 'read' end,
                  'values', json_object({obj})) as obj, v.updated_at, t.resource_id as id{total_win}
           from {schema}.{table} t join core.visible_resources v on v.id = t.resource_id
           where true {cond}
           order by v.updated_at desc, t.resource_id desc
           limit {limit}) x",
        obj = obj.join(", "),
        schema = qi(&p.schema()),
        table = qi(&d.name),
        total_col = if with_total { ", max(x.total)" } else { "" },
        total_win = if with_total { ", count(*) over () as total" } else { "" },
    )
}

async fn fetch_rows(tx: &mut Tx, sql: &str, binds: &[Value]) -> Result<Vec<Value>> {
    let v: Value = host::bind_json(mosaikit_db::query(sql), binds).fetch_one(&mut **tx).await?.try_get(0)?;
    Ok(v.as_array().cloned().unwrap_or_default())
}

pub async fn list_ctx(
    k: &Kernel,
    ctx: &Ctx,
    p: &LoadedPlugin,
    resource: &str,
    filter: Option<&str>,
    parent: Option<Uuid>,
) -> Result<ListResult> {
    list_ctx_paged(k, ctx, p, resource, filter, parent, None).await
}

/// A list, whole (up to 5,000 rows) or one page at a time (`paging`): the latest changed first.
pub async fn list_ctx_paged(
    k: &Kernel,
    ctx: &Ctx,
    p: &LoadedPlugin,
    resource: &str,
    filter: Option<&str>,
    parent: Option<Uuid>,
    paging: Option<&Paging>,
) -> Result<ListResult> {
    let d = decl(p, resource)?;
    let mut cond = String::new();
    let mut binds = Vec::new();
    if let Some(f) = filter.map(str::trim).filter(|f| !f.is_empty()) {
        let cols: Vec<String> = d.fields.iter().map(|f| format!("t.{}::text", qi(&f.key))).collect();
        binds.push(json!(format!("%{}%", crate::util::like_escape(f))));
        cond.push_str(&format!(" and concat_ws(' ', {}) ilike $1 escape '\\'", cols.join(", ")));
    }
    if let Some(par) = parent {
        binds.push(json!(par.to_string()));
        cond.push_str(&format!(" and v.parent_id = ${}::uuid", binds.len()));
    }
    // reading only: on SQLite it does not wait for the writers
    let mut tx = k.db.begin_plugin_read(&p.id, ctx).await?;
    let Some(pg) = paging else {
        let rows = fetch_rows(&mut tx, &select_sql(k, p, d, &cond), &binds).await?;
        tx.commit().await?;
        return Ok(ListResult {
            resource: d.name.clone(),
            fields: d.fields.clone(),
            rows,
            next: None,
            total: None,
        });
    };
    let limit = pg.limit.clamp(1, MAX_PAGE);
    let cursor = pg.cursor.as_deref().filter(|c| !c.is_empty());
    // the total of the filter comes with the first page only (the following ones would count the same
    // set again: the shell keeps the first total). SQLite counts in the same pass as the page: the
    // visibility is most of the cost and a second pass doubled it.
    let single = k.db.is_sqlite() && cursor.is_none();
    let mut total: Option<i64> = None;
    if cursor.is_none() && !single {
        let sql = format!(
            "select count(*) from {schema}.{table} t join core.visible_resources v on v.id = t.resource_id where true {cond}",
            schema = qi(&p.schema()),
            table = qi(&d.name),
        );
        total = Some(host::bind_json(mosaikit_db::query(sql), &binds).fetch_one(&mut *tx).await?.try_get(0)?);
    }
    if let Some(c) = cursor {
        let (at, id) = parse_cursor(c)?;
        binds.push(json!(at));
        binds.push(json!(id.to_string()));
        cond.push_str(&format!(
            " and (v.updated_at, t.resource_id) < (${}::timestamptz, ${}::uuid)",
            binds.len() - 1,
            binds.len()
        ));
    }
    let sql = select_sql_limit(k, p, d, &cond, limit + 1, single);
    let mut rows = if single {
        let r = host::bind_json(mosaikit_db::query(sql), &binds).fetch_one(&mut *tx).await?;
        let v: Value = r.try_get(0)?;
        total = Some(r.try_get::<Option<i64>, _>(1)?.unwrap_or(0));
        v.as_array().cloned().unwrap_or_default()
    } else {
        fetch_rows(&mut tx, &sql, &binds).await?
    };
    tx.commit().await?;
    let next = if rows.len() as i64 > limit {
        rows.truncate(limit as usize);
        rows.last().and_then(cursor_of)
    } else {
        None
    };
    Ok(ListResult { resource: d.name.clone(), fields: d.fields.clone(), rows, next, total })
}

async fn get_in(
    k: &Kernel,
    tx: &mut Tx,
    p: &LoadedPlugin,
    d: &ResourceDecl,
    id: Uuid,
) -> Result<Option<Value>> {
    let rows =
        fetch_rows(tx, &select_sql(k, p, d, " and t.resource_id = $1::uuid"), &[json!(id.to_string())])
            .await?;
    Ok(rows.into_iter().next())
}

pub async fn get_ctx(k: &Kernel, ctx: &Ctx, p: &LoadedPlugin, resource: &str, id: Uuid) -> Result<Value> {
    let d = decl(p, resource)?;
    let mut tx = k.db.begin_plugin_read(&p.id, ctx).await?;
    let row = get_in(k, &mut tx, p, d, id).await?;
    tx.commit().await?;
    row.ok_or_else(|| Error::not_found("record not found"))
}

pub async fn list(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    resource: &str,
    filter: Option<&str>,
    parent: Option<Uuid>,
) -> Result<ListResult> {
    list_paged(k, c, plugin, resource, filter, parent, None).await
}

/// `list`, one page at a time when `paging` is given.
pub async fn list_paged(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    resource: &str,
    filter: Option<&str>,
    parent: Option<Uuid>,
    paging: Option<&Paging>,
) -> Result<ListResult> {
    let (p, _) = crate::access::require(k, c, plugin, crate::access::USE).await?;
    list_ctx_paged(k, &c.ctx(), &p, resource, filter, parent, paging).await
}

pub async fn get(k: &Kernel, c: &Caller, plugin: &str, resource: &str, id: Uuid) -> Result<Value> {
    let (p, _) = crate::access::require(k, c, plugin, crate::access::USE).await?;
    get_ctx(k, &c.ctx(), &p, resource, id).await
}

/// Converts and validates the values according to the manifest. `base` gives the values
/// of the fields not present in `input` (partial updates, output of the hooks).
pub fn coerce(d: &ResourceDecl, input: &Values, base: Option<&Values>) -> Result<Values> {
    for k in input.keys() {
        if !d.fields.iter().any(|f| &f.key == k) {
            return Err(Error::bad(format!("unknown field: {k}")));
        }
    }
    let mut out = Map::new();
    for f in &d.fields {
        let raw =
            input.get(&f.key).or_else(|| base.and_then(|b| b.get(&f.key))).cloned().unwrap_or(Value::Null);
        let label = if f.label.is_empty() { &f.key } else { &f.label };
        let bad = |what: &str| Error::bad(format!("field '{label}': {what}"));
        let v = match (f.kind, raw) {
            (_, Value::Null) => Value::Null,
            (FieldKind::Text, Value::String(s)) => {
                if s.len() > MAX_TEXT {
                    return Err(bad("text too long"));
                }
                if s.is_empty() {
                    Value::Null
                } else {
                    Value::String(s)
                }
            }
            (FieldKind::Text, other @ (Value::Number(_) | Value::Bool(_))) => {
                Value::String(other.to_string())
            }
            (FieldKind::Number, Value::Number(n)) => Value::Number(n),
            (FieldKind::Number, Value::String(s)) if s.trim().is_empty() => Value::Null,
            (FieldKind::Number, Value::String(s)) => match s.trim().replace(',', ".").parse::<f64>() {
                Ok(x) if x.is_finite() => json!(x),
                _ => return Err(bad("invalid number")),
            },
            (FieldKind::Bool, Value::Bool(b)) => Value::Bool(b),
            (FieldKind::Bool, Value::String(s)) => match s.trim().to_lowercase().as_str() {
                "true" | "1" | "yes" | "si" | "sì" | "on" | "✓" => Value::Bool(true),
                "false" | "0" | "no" | "off" | "" => Value::Bool(false),
                _ => return Err(bad("invalid boolean value")),
            },
            (FieldKind::Bool, Value::Number(n)) => Value::Bool(n.as_f64() != Some(0.0)),
            (FieldKind::Date, Value::String(s)) if s.trim().is_empty() => Value::Null,
            (FieldKind::Date, Value::String(s)) => {
                let s = s.trim();
                let d = s.get(..10).unwrap_or(s);
                chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d")
                    .map_err(|_| bad("invalid date (YYYY-MM-DD)"))?;
                Value::String(d.to_string())
            }
            (FieldKind::Choice, Value::String(s)) if s.is_empty() => Value::Null,
            (FieldKind::Choice, Value::String(s)) => {
                if !f.options.contains(&s) {
                    return Err(bad(&format!("value '{s}' is not among the options")));
                }
                Value::String(s)
            }
            _ => return Err(bad("invalid type")),
        };
        out.insert(f.key.clone(), v);
    }
    Ok(out)
}

fn check_required(d: &ResourceDecl, v: &Values) -> Result<()> {
    for f in d.fields.iter().filter(|f| f.required) {
        let empty = match v.get(&f.key) {
            None | Some(Value::Null) => true,
            Some(Value::String(s)) => s.trim().is_empty(),
            _ => false,
        };
        if empty {
            let label = if f.label.is_empty() { &f.key } else { &f.label };
            return Err(Error::bad(format!("required field: {label}")));
        }
    }
    Ok(())
}

/// Typed parameter of a field (native numbers and booleans: SQLite does not convert text).
fn bind_value(kind: FieldKind, v: &Value) -> mosaikit_db::Param {
    use mosaikit_db::{Param, Ty};
    match (kind, v) {
        (FieldKind::Number, Value::Null) => Param::Null(Ty::F64),
        (FieldKind::Bool, Value::Null) => Param::Null(Ty::Bool),
        (_, Value::Null) => Param::Null(Ty::Text),
        (FieldKind::Number, Value::Number(n)) => Param::F64(n.as_f64().unwrap_or_default()),
        (FieldKind::Bool, Value::Bool(b)) => Param::Bool(*b),
        (_, Value::String(s)) => Param::Text(s.clone()),
        (_, other) => Param::Text(other.to_string()),
    }
}

fn title_of(d: &ResourceDecl, v: &Values) -> String {
    let t = d.title_key().and_then(|k| v.get(k)).map(|v| match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        o => o.to_string(),
    });
    t.unwrap_or_default().chars().take(500).collect()
}

/// Runs a hook, if the plugin declares it; returns the values (possibly changed).
#[allow(clippy::too_many_arguments)]
async fn run_hook(
    k: &Kernel,
    c: &Caller,
    p: &Arc<LoadedPlugin>,
    d: &ResourceDecl,
    tx: Tx,
    hook: &str,
    id: Option<Uuid>,
    values: Values,
    previous: Option<&Values>,
) -> Result<(Values, Tx)> {
    if p.module.is_none() || !p.manifest.permissions.hooks.contains(&d.name) {
        return Ok((values, tx));
    }
    let msg = json!({
        "abi": 1, "kind": "hook", "hook": hook, "resource": d.name,
        "id": id.map(|i| i.to_string()), "values": values, "previous": previous,
        "ctx": ctx_json(c, &p.id),
    });
    let (out, tx) = host::run(k, c, p, tx, msg, FUEL_HOOK, 0).await?;
    match out.get("values").and_then(Value::as_object) {
        Some(newv) => Ok((coerce(d, newv, Some(&values))?, tx)),
        None => Ok((values, tx)),
    }
}

async fn level(tx: &mut Tx, id: Uuid) -> Result<i32> {
    Ok(mosaikit_db::query_scalar("select core.level_of($1)").bind(id).fetch_one(&mut **tx).await?)
}

pub async fn create(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    resource: &str,
    input: &Values,
    parent: Option<Uuid>,
) -> Result<Value> {
    let (p, _) = crate::access::require(k, c, plugin, crate::access::CREATE).await?;
    let d = decl(&p, resource)?;
    let values = coerce(d, input, None)?;
    let tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let (values, mut tx) = run_hook(k, c, &p, d, tx, "before_create", None, values, None).await?;
    check_required(d, &values)?;
    crate::quotas::check(k, c.tenant.tenant_id, crate::quotas::Add::items(1)).await?;
    let id = tx.create_resource(&d.name, &title_of(d, &values), parent, &json!({})).await?;
    let cols: Vec<String> = d.fields.iter().map(|f| qi(&f.key)).collect();
    let ph: Vec<String> =
        d.fields.iter().enumerate().map(|(i, f)| format!("${}::{}", i + 2, f.kind.sql_type())).collect();
    let sql = format!(
        "insert into {}.{} (resource_id, {}) values ($1::uuid, {})",
        qi(&p.schema()),
        qi(&d.name),
        cols.join(", "),
        ph.join(", ")
    );
    let mut q = mosaikit_db::query(&sql).bind(id);
    for f in &d.fields {
        q = q.bind(bind_value(f.kind, &values[&f.key]));
    }
    q.execute(&mut *tx).await?;
    let row =
        get_in(k, &mut tx, &p, d, id).await?.ok_or_else(|| Error::internal("created record not visible"))?;
    tx.commit().await?;
    crate::search::index(k, id, &crate::search::text_of(d, &values)).await;
    crate::quotas::touched(k, c.tenant.tenant_id);
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&p.id),
        Some(id),
        "resource.create",
        json!({ "kind": d.name }),
    )
    .await;
    Ok(row)
}

pub async fn update(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    resource: &str,
    id: Uuid,
    input: &Values,
) -> Result<Value> {
    let (p, _) = crate::access::require(k, c, plugin, crate::access::USE).await?;
    let d = decl(&p, resource)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let prev_row =
        get_in(k, &mut tx, &p, d, id).await?.ok_or_else(|| Error::not_found("record not found"))?;
    if level(&mut tx, id).await? < 2 {
        return Err(Error::forbidden("the write permission is required"));
    }
    let previous: Values = prev_row.get("values").and_then(Value::as_object).cloned().unwrap_or_default();
    let values = coerce(d, input, Some(&previous))?;
    let (values, mut tx) =
        run_hook(k, c, &p, d, tx, "before_update", Some(id), values, Some(&previous)).await?;
    check_required(d, &values)?;
    let sets: Vec<String> = d
        .fields
        .iter()
        .enumerate()
        .map(|(i, f)| format!("{} = ${}::{}", qi(&f.key), i + 2, f.kind.sql_type()))
        .collect();
    let sql = format!(
        "update {}.{} set {} where resource_id = $1::uuid",
        qi(&p.schema()),
        qi(&d.name),
        sets.join(", ")
    );
    let mut q = mosaikit_db::query(&sql).bind(id);
    for f in &d.fields {
        q = q.bind(bind_value(f.kind, &values[&f.key]));
    }
    let n = q.execute(&mut *tx).await?.rows_affected();
    if n != 1 {
        return Err(Error::forbidden("update not allowed"));
    }
    tx.update_resource(id, Some(&title_of(d, &values)), None, None).await?;
    let row = get_in(k, &mut tx, &p, d, id).await?.ok_or_else(|| Error::internal("record not visible"))?;
    tx.commit().await?;
    crate::search::index(k, id, &crate::search::text_of(d, &values)).await;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&p.id),
        Some(id),
        "resource.update",
        json!({ "kind": d.name }),
    )
    .await;
    Ok(row)
}

pub async fn delete(k: &Kernel, c: &Caller, plugin: &str, resource: &str, id: Uuid) -> Result<()> {
    let (p, _) = crate::access::require(k, c, plugin, crate::access::DELETE).await?;
    let d = decl(&p, resource)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let prev_row =
        get_in(k, &mut tx, &p, d, id).await?.ok_or_else(|| Error::not_found("record not found"))?;
    if level(&mut tx, id).await? < 3 {
        return Err(Error::forbidden("the manage permission is required to delete"));
    }
    let previous: Values = prev_row.get("values").and_then(Value::as_object).cloned().unwrap_or_default();
    // the log keeps the title: after the purge the resource is gone
    let title: Option<String> = mosaikit_db::query_scalar("select title from core.resources where id = $1")
        .bind(id)
        .fetch_optional(&k.db)
        .await?;
    // to the trash: the contents on disk stay until the purge
    tx.delete_resource(id).await?;
    let (_, tx) =
        run_hook(k, c, &p, d, tx, "after_delete", Some(id), previous.clone(), Some(&previous)).await?;
    tx.commit().await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&p.id),
        Some(id),
        "resource.delete",
        json!({ "kind": d.name, "title": title }),
    )
    .await;
    Ok(())
}

/// Command of the logic of the plugin (`msk.call` from the UI).
pub async fn call(k: &Kernel, c: &Caller, plugin: &str, name: &str, args: Value) -> Result<Value> {
    call_depth(k, c, plugin, name, args, 0).await
}

/// Like `call`, from another plugin (`plugin.call`) at depth `depth`.
pub(crate) async fn call_depth(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    name: &str,
    args: Value,
    depth: u8,
) -> Result<Value> {
    let (p, _) = crate::access::require(k, c, plugin, crate::access::USE).await?;
    let tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let msg = json!({ "abi": 1, "kind": "command", "name": name, "args": args, "ctx": ctx_json(c, &p.id) });
    let (out, tx) = host::run(k, c, &p, tx, msg, FUEL_COMMAND, depth).await?;
    tx.commit().await?;
    Ok(out)
}
