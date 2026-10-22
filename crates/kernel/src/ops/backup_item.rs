//! One item restored from a backup (docs/architecture.md, "Backup and restore").
//!
//! A backup holds the export of every tenant (`tenants/<slug>/`, see `transfer`). The Administrator
//! looks for an item in it (by app, title, owner) and brings back that item with what is under it (the
//! items of a folder), its rows in the tables of its plugin, the values of the extensions, its files and,
//! on request, its shares to the people and groups that still exist. Public links never come back: a
//! revoked link must stay revoked.
//!
//! An item that is no longer in the tenant comes back with its id (links to it work again). One that is
//! still there (also in the trash) is never overwritten silently: the Administrator chooses
//! - `copy`: the version of the backup comes back as a new item, next to the current one;
//! - `replace`: the current version, with everything under it, is deleted for good and the one of the
//!   backup takes its place, with the same id.
//!
//! The owner comes back if they still exist, otherwise the item goes to the first Tenant Manager. The
//! quotas do not stop a restore by the Administrator. The owner is told with a notification.

use std::collections::{HashMap, HashSet};
use std::fs::File;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use zip::ZipArchive;

use super::backup;
use crate::notify::{self, NoteKind};
use crate::tenancy::require_admin;
use crate::transfer::{self, Manifest};
use crate::{events, Error, Kernel, Result, SessionUser};

/// An item of a tenant in a backup, with its state in the tenant now.
#[derive(Debug, Clone, Serialize)]
pub struct BackupItem {
    pub id: Uuid,
    pub plugin_id: String,
    pub kind: String,
    pub title: String,
    pub owner_name: String,
    pub updated_at: Option<String>,
    /// items under it (a folder), restored with it
    pub children: usize,
    /// `missing` (no longer in the tenant), `trash` (in its trash) or `present`
    pub state: &'static str,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ItemQuery {
    /// words of the title
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub plugin: Option<String>,
    /// words of the name of the owner
    #[serde(default)]
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemList {
    pub tenant: String,
    /// when the backup was made (the export of the tenant)
    pub exported_at: String,
    pub total: usize,
    pub items: Vec<BackupItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Copy,
    Replace,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ItemRestore {
    /// required when the item is still in the tenant
    #[serde(default)]
    pub mode: Option<Mode>,
    /// also the shares to people and groups that still exist
    #[serde(default)]
    pub shares: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemReport {
    /// id of the restored item (new with `copy`)
    pub id: Uuid,
    pub title: String,
    /// `original`, `copy` or `replace`
    pub mode: &'static str,
    pub items: usize,
    pub files: usize,
    pub shares: usize,
}

/// At most this many items in a search of a backup.
const LIMIT: usize = 200;

struct Opened {
    zip: ZipArchive<File>,
    prefix: String,
    manifest: Manifest,
    resources: Vec<Value>,
}

async fn open(k: &Kernel, admin: &SessionUser, backup_id: Uuid, slug: &str) -> Result<Opened> {
    require_admin(admin)?;
    let p = backup::file(k, admin, backup_id).await?;
    let mut zip = ZipArchive::new(File::open(p)?).map_err(|e| Error::bad(format!("invalid backup: {e}")))?;
    let prefix = format!("tenants/{slug}/");
    let manifest = transfer::read_manifest(&mut zip, &prefix)
        .map_err(|_| Error::not_found(format!("the tenant '{slug}' is not in this backup")))?;
    let resources = rows(&mut zip, &format!("{prefix}core/resources.json"))?;
    Ok(Opened { zip, prefix, manifest, resources })
}

fn rows(zip: &mut ZipArchive<File>, name: &str) -> Result<Vec<Value>> {
    Ok(transfer::read_json(zip, name)?.and_then(|v| v.as_array().cloned()).unwrap_or_default())
}

fn text<'a>(row: &'a Value, col: &str) -> &'a str {
    row.get(col).and_then(Value::as_str).unwrap_or_default()
}

/// The ancestors of a row of `core.resources`: a JSON array (PostgreSQL) or its text (SQLite).
fn ancestors(row: &Value) -> Vec<String> {
    let v = match row.get("ancestors") {
        Some(Value::String(s)) => serde_json::from_str::<Value>(s).unwrap_or(Value::Null),
        Some(v) => v.clone(),
        None => Value::Null,
    };
    v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect()).unwrap_or_default()
}

/// The item `rid` and the items under it, the item first, then by depth.
fn subtree(resources: &[Value], rid: &str) -> Vec<Value> {
    let mut out: Vec<Value> = resources
        .iter()
        .filter(|r| text(r, "id") == rid || ancestors(r).iter().any(|a| a == rid))
        .cloned()
        .collect();
    out.sort_by_key(|r| if text(r, "id") == rid { 0 } else { ancestors(r).len() + 1 });
    out
}

async fn live_ids(k: &Kernel, tenant: Uuid, deleted: bool) -> Result<HashSet<Uuid>> {
    let sql = if deleted {
        "select id from core.resources where tenant_id = $1 and deleted_at is not null"
    } else {
        "select id from core.resources where tenant_id = $1 and deleted_at is null"
    };
    Ok(mosaikit_db::query_scalar::<Uuid>(sql).bind(tenant).fetch_all(&k.db).await?.into_iter().collect())
}

/// Names of the people: the ones in the backup, then the ones of the installation.
async fn names(k: &Kernel, zip: &mut ZipArchive<File>, prefix: &str) -> Result<HashMap<String, String>> {
    let mut out: HashMap<String, String> = HashMap::new();
    for u in rows(zip, &format!("{prefix}core/users.json"))? {
        let name = if text(&u, "display_name").trim().is_empty() {
            text(&u, "username")
        } else {
            text(&u, "display_name")
        };
        out.insert(text(&u, "id").to_string(), name.to_string());
    }
    for r in mosaikit_db::query("select id, coalesce(nullif(display_name, ''), username) from core.users")
        .fetch_all(&k.db)
        .await?
    {
        out.entry(r.get::<Uuid, _>(0).to_string()).or_insert_with(|| r.get(1));
    }
    Ok(out)
}

fn matches(hay: &str, words: &Option<String>) -> bool {
    match words.as_deref().map(str::trim) {
        None | Some("") => true,
        Some(w) => {
            let hay = hay.to_lowercase();
            w.to_lowercase().split_whitespace().all(|x| hay.contains(x))
        }
    }
}

/// The items of a tenant in a backup (the top of each subtree: an item whose parent is in the backup
/// comes back with its parent, but it can be looked for and restored on its own too).
pub async fn items(
    k: &Kernel,
    admin: &SessionUser,
    backup_id: Uuid,
    slug: &str,
    q: &ItemQuery,
) -> Result<ItemList> {
    let mut o = open(k, admin, backup_id, slug).await?;
    let tenant = o.manifest.tenant.id;
    let names = names(k, &mut o.zip, &o.prefix).await?;
    let present = live_ids(k, tenant, false).await?;
    let trashed = live_ids(k, tenant, true).await?;
    let mut found: Vec<BackupItem> = o
        .resources
        .iter()
        .filter(|r| q.plugin.as_deref().is_none_or(|p| p.is_empty() || text(r, "plugin_id") == p))
        .filter(|r| matches(text(r, "title"), &q.q))
        .filter(|r| matches(names.get(text(r, "owner_id")).map(String::as_str).unwrap_or_default(), &q.owner))
        .filter_map(|r| {
            let id: Uuid = text(r, "id").parse().ok()?;
            let children =
                o.resources.iter().filter(|x| ancestors(x).iter().any(|a| a == text(r, "id"))).count();
            Some(BackupItem {
                id,
                plugin_id: text(r, "plugin_id").into(),
                kind: text(r, "kind").into(),
                title: text(r, "title").into(),
                owner_name: names.get(text(r, "owner_id")).cloned().unwrap_or_default(),
                updated_at: r.get("updated_at").and_then(Value::as_str).map(str::to_owned),
                children,
                state: if present.contains(&id) {
                    "present"
                } else if trashed.contains(&id) {
                    "trash"
                } else {
                    "missing"
                },
            })
        })
        .collect();
    found.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let total = found.len();
    found.truncate(LIMIT);
    Ok(ItemList {
        tenant: o.manifest.tenant.name.clone(),
        exported_at: o.manifest.exported_at.to_rfc3339(),
        total,
        items: found,
    })
}

/// Rows of the backup with every old id replaced by its new one (a copy).
fn remap(rows: Vec<Value>, map: &HashMap<String, String>) -> Result<Vec<Value>> {
    if map.is_empty() {
        return Ok(rows);
    }
    rows.into_iter()
        .map(|r| {
            let mut s = serde_json::to_string(&r)?;
            for (old, new) in map {
                s = s.replace(old.as_str(), new.as_str());
            }
            Ok(serde_json::from_str(&s)?)
        })
        .collect()
}

/// The ancestors in the same form the backup has them (array, or the text of an array on SQLite).
fn set_ancestors(row: &mut Value, list: &[String]) {
    let arr = Value::Array(list.iter().map(|s| Value::String(s.clone())).collect());
    let v = match row.get("ancestors") {
        Some(Value::String(_)) => Value::String(arr.to_string()),
        _ => arr,
    };
    row["ancestors"] = v;
}

/// Restores one item of a backup (see the module).
pub async fn restore(
    k: &Kernel,
    admin: &SessionUser,
    backup_id: Uuid,
    slug: &str,
    rid: Uuid,
    opts: &ItemRestore,
) -> Result<ItemReport> {
    let mut o = open(k, admin, backup_id, slug).await?;
    let tenant = o.manifest.tenant.id;
    let live_slug: Option<String> = mosaikit_db::query_scalar("select slug from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?;
    let Some(live_slug) = live_slug else {
        return Err(Error::conflict("the tenant is no longer here: restore the tenant first")
            .with_code("tenant_missing"));
    };
    let mut items = subtree(&o.resources, &rid.to_string());
    if items.is_empty() {
        return Err(Error::not_found("the item is not in this backup"));
    }
    let root = items[0].clone();
    let title = text(&root, "title").to_string();
    let plugin = text(&root, "plugin_id").to_string();
    let schema: Option<String> =
        mosaikit_db::query_scalar("select schema_name from core.plugins where id = $1")
            .bind(&plugin)
            .fetch_optional(&k.db)
            .await?;
    let Some(schema) = schema else {
        return Err(
            Error::conflict(format!("the plugin {plugin} is not installed")).with_code("plugin_missing")
        );
    };

    // the item is still in the tenant: the Administrator says what to do
    let exists: bool = mosaikit_db::query_scalar::<Uuid>("select id from core.resources where id = $1")
        .bind(rid)
        .fetch_optional(&k.db)
        .await?
        .is_some();
    let mode: &'static str = match (exists, opts.mode) {
        (false, _) => "original",
        (true, None) => {
            return Err(Error::conflict(
                "the item is still in the tenant: restore it as a copy or replace it",
            )
            .with_code("item_exists"))
        }
        (true, Some(Mode::Copy)) => "copy",
        (true, Some(Mode::Replace)) => "replace",
    };

    // people and groups of the installation now
    let users: HashSet<String> = mosaikit_db::query_scalar::<Uuid>("select id from core.users")
        .fetch_all(&k.db)
        .await?
        .iter()
        .map(Uuid::to_string)
        .collect();
    let groups: HashSet<String> =
        mosaikit_db::query_scalar::<Uuid>("select id from core.groups where tenant_id = $1")
            .bind(tenant)
            .fetch_all(&k.db)
            .await?
            .iter()
            .map(Uuid::to_string)
            .collect();
    let manager: Option<Uuid> = mosaikit_db::query_scalar(
        "select m.user_id from core.memberships m join core.users u on u.id = m.user_id
         where m.tenant_id = $1 and m.role = 'tenant_manager' order by u.created_at limit 1",
    )
    .bind(tenant)
    .fetch_optional(&k.db)
    .await?;

    // where it goes: under its parent if the parent is still there (and not the item replaced), else at the top
    let parent = text(&root, "parent_id").to_string();
    let parent_live: Option<Uuid> = match parent.parse::<Uuid>() {
        Ok(p) => {
            mosaikit_db::query_scalar("select id from core.resources where id = $1 and deleted_at is null")
                .bind(p)
                .fetch_optional(&k.db)
                .await?
        }
        Err(_) => None,
    };
    let top: Vec<String> = match parent_live {
        Some(p) => {
            // the ancestors as the text of a JSON array, on both databases
            let raw: String = mosaikit_db::query_scalar(
                "select to_jsonb(ancestors)::text from core.resources where id = $1",
            )
            .sqlite("select ancestors from core_resources where id = ?1")
            .bind(p)
            .fetch_one(&k.db)
            .await?;
            let mut a = ancestors(&json!({ "ancestors": raw }));
            a.push(p.to_string());
            a
        }
        None => Vec::new(),
    };
    let root_id = rid.to_string();
    let ids: Vec<String> = items.iter().map(|r| text(r, "id").to_string()).collect();
    for r in items.iter_mut() {
        let own = ancestors(r);
        let below: Vec<String> = match own.iter().position(|a| a == &root_id) {
            Some(i) => own[i..].to_vec(),
            None => Vec::new(),
        };
        let mut list = top.clone();
        list.extend(below);
        set_ancestors(r, &list);
        if text(r, "id") == root_id {
            r["parent_id"] = parent_live.map(|p| Value::String(p.to_string())).unwrap_or(Value::Null);
        }
        // back in the tenant, out of the trash; an owner who no longer exists: the first Tenant Manager
        r["deleted_at"] = Value::Null;
        r["deleted_by"] = Value::Null;
        if !users.contains(text(r, "owner_id")) {
            let Some(m) = manager else {
                return Err(Error::conflict(
                    "the owner no longer exists and the tenant has no Tenant Manager",
                ));
            };
            r["owner_id"] = Value::String(m.to_string());
        }
    }
    let set: HashSet<&str> = ids.iter().map(String::as_str).collect();

    // its rows: in the tables of its plugin, the values of the extensions, the shares
    let installed: HashSet<String> = mosaikit_db::query_scalar::<String>("select id from core.plugins")
        .fetch_all(&k.db)
        .await?
        .into_iter()
        .collect();
    let mut tx = k.db.begin_app().await?;
    let mut plugin_rows: Vec<(String, Vec<Value>)> = Vec::new();
    for (logical, physical) in transfer::plugin_tables(k, &mut tx, &schema).await? {
        let cols = transfer::columns(k, &mut tx, &physical).await?;
        if !cols.iter().any(|(c, _)| c == "resource_id") {
            continue;
        }
        let rows: Vec<Value> = rows(&mut o.zip, &format!("{}plugins/{plugin}/{logical}.json", o.prefix))?
            .into_iter()
            .filter(|r| set.contains(text(r, "resource_id")))
            .collect();
        if !rows.is_empty() {
            plugin_rows.push((physical, rows));
        }
    }
    let ext_values: Vec<Value> = rows(&mut o.zip, &format!("{}core/extension_values.json", o.prefix))?
        .into_iter()
        .filter(|r| set.contains(text(r, "resource_id")) && installed.contains(text(r, "extension_id")))
        .map(|mut r| {
            if !users.contains(text(&r, "updated_by")) {
                r["updated_by"] = Value::Null;
            }
            r
        })
        .collect();
    let grants: Vec<Value> = if opts.shares {
        rows(&mut o.zip, &format!("{}core/grants.json", o.prefix))?
            .into_iter()
            .filter(|r| set.contains(text(r, "resource_id")))
            .filter(|r| match text(r, "principal_type") {
                "user" => users.contains(text(r, "principal_id")),
                "group" => groups.contains(text(r, "principal_id")),
                _ => false,
            })
            .collect()
    } else {
        Vec::new()
    };

    // a copy: every id of the subtree becomes a new one
    let map: HashMap<String, String> = if mode == "copy" {
        ids.iter().map(|i| (i.clone(), Uuid::new_v4().to_string())).collect()
    } else {
        HashMap::new()
    };
    let items = remap(items, &map)?;
    let plugin_rows: Vec<(String, Vec<Value>)> =
        plugin_rows.into_iter().map(|(p, r)| Ok((p, remap(r, &map)?))).collect::<Result<_>>()?;
    let ext_values = remap(ext_values, &map)?;
    let grants = remap(grants, &map)?;
    let new_root: Uuid =
        map.get(&root_id).map(|s| s.parse()).transpose().map_err(|_| Error::internal("id"))?.unwrap_or(rid);

    // replace: the current version goes first, with everything under it
    let mut removed: Vec<Uuid> = Vec::new();
    if mode == "replace" {
        removed =
            mosaikit_db::query_scalar("select id from core.resources where id = $1 or $1 = any(ancestors)")
                .bind(rid)
                .fetch_all(&mut tx)
                .await?;
        mosaikit_db::query("delete from core.resources where id = $1").bind(rid).execute(&mut tx).await?;
    }
    if k.db.is_sqlite() {
        mosaikit_db::query("select 1").sqlite("pragma defer_foreign_keys = on").execute(&mut tx).await?;
    }
    let n_items =
        transfer::restore(k, &mut tx, &transfer::core_table(k, "resources"), "resources", &items).await?;
    transfer::restore_plugin(k, &mut tx, plugin_rows).await?;
    transfer::restore(
        k,
        &mut tx,
        &transfer::core_table(k, "extension_values"),
        "extension_values",
        &ext_values,
    )
    .await?;
    let n_shares =
        transfer::restore(k, &mut tx, &transfer::core_table(k, "grants"), "grants", &grants).await?;
    tx.commit().await?;

    // the files: from the contents of the backup (blobs/<tenant>/<item>/), under the new ids for a copy
    for id in removed {
        k.blobs.remove(tenant, id);
    }
    let mut files = 0;
    for old in &ids {
        let new = map.get(old).unwrap_or(old);
        let from = if o.manifest.blobs == "included" {
            format!("{}blobs/{old}/", o.prefix)
        } else {
            format!("blobs/{tenant}/{old}/")
        };
        let dest = k.blobs.root().join(tenant.to_string()).join(new);
        files += transfer::extract(&mut o.zip, &from, &dest)?;
    }

    let owner: Option<Uuid> = mosaikit_db::query_scalar("select owner_id from core.resources where id = $1")
        .bind(new_root)
        .fetch_optional(&k.db)
        .await?;
    events::record(
        k,
        Some(tenant),
        Some(admin.user_id),
        Some(&plugin),
        Some(new_root),
        "backup.restore_item",
        json!({ "backup": backup_id, "mode": mode, "title": title, "from": rid, "items": n_items }),
    )
    .await;
    if let Some(owner) = owner.filter(|o| *o != admin.user_id) {
        let date = o.manifest.exported_at.format("%Y-%m-%d").to_string();
        let item = if title.trim().is_empty() { "an item".to_string() } else { format!("«{title}»") };
        notify::emit(
            k,
            notify::New {
                user: owner,
                tenant: Some(tenant),
                kind: NoteKind::Share,
                title: format!("{item} was restored from the backup of {date}"),
                body: if mode == "copy" {
                    "As a copy, next to the current one.".into()
                } else {
                    String::new()
                },
                link: format!("#/t/{live_slug}/item/{new_root}"),
                source: "kernel".into(),
                resource: Some(new_root),
                data: json!({ "code": "backup.item_restored", "item": title, "date": date, "mode": mode }),
            },
        )
        .await;
    }
    Ok(ItemReport { id: new_root, title, mode, items: n_items, files, shares: n_shares })
}
