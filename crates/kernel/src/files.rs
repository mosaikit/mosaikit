//! Files and folders (permission `files`): `folder`/`file` resources with content on disk.

use std::io::Write;

use chrono::{DateTime, Utc};
use mosaikit_db::Tx;
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::plugins::LoadedPlugin;
use crate::util::valid_name;
use crate::{events, Caller, Error, Kernel, Result};

const MAX_COPY_ITEMS: usize = 10_000;
const MAX_ZIP_BYTES: i64 = 1 << 30;

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub id: Uuid,
    pub name: String,
    pub is_dir: bool,
    pub size: i64,
    pub mime: String,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub my_level: String,
    pub shared: bool,
    pub parent_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Crumb {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Listing {
    pub parent: Option<Uuid>,
    pub path: Vec<Crumb>,
    pub entries: Vec<Entry>,
    /// level on the current folder (at the root: "write", one creates resources of one's own)
    pub my_level: String,
}

/// The plugin, with the files permission of its manifest and the permission `perm` of the caller.
async fn plugin(k: &Kernel, c: &Caller, id: &str, perm: &str) -> Result<std::sync::Arc<LoadedPlugin>> {
    let (p, _) = crate::access::require(k, c, id, perm).await?;
    if !p.manifest.permissions.files {
        return Err(Error::forbidden("the plugin does not declare the files permission"));
    }
    Ok(p)
}

fn mime_of(name: &str) -> String {
    mime_guess::from_path(name).first_or_octet_stream().essence_str().to_string()
}

const ENTRY_SQL: &str = "
    select id, title, kind = 'folder', size_bytes, coalesce(meta->>'mime', ''), created_at, updated_at,
           owner_id, owner_name, case my_level when 3 then 'manage' when 2 then 'write' else 'read' end, shared, parent_id
    from core.visible_resources";

fn entry(r: &mosaikit_db::Row) -> Entry {
    Entry {
        id: r.get(0),
        name: r.get(1),
        is_dir: r.get(2),
        size: r.get(3),
        mime: r.get(4),
        created: r.get(5),
        modified: r.get(6),
        owner_id: r.get(7),
        owner_name: r.get(8),
        my_level: r.get(9),
        shared: r.get(10),
        parent_id: r.get(11),
    }
}

async fn get_entry(tx: &mut Tx, id: Uuid) -> Result<Entry> {
    let r = mosaikit_db::query(format!("{ENTRY_SQL} where id = $1 and kind in ('file', 'folder')"))
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| Error::not_found("file or folder not found"))?;
    Ok(entry(&r))
}

fn level_rank(l: &str) -> u8 {
    match l {
        "manage" => 3,
        "write" => 2,
        _ => 1,
    }
}

fn need(e: &Entry, lvl: u8) -> Result<()> {
    if level_rank(&e.my_level) < lvl {
        return Err(Error::forbidden(if lvl >= 3 {
            "the manage permission is required"
        } else {
            "the write permission is required"
        }));
    }
    Ok(())
}

async fn folder(tx: &mut Tx, parent: Option<Uuid>) -> Result<Option<Entry>> {
    match parent {
        None => Ok(None),
        Some(id) => {
            let e = get_entry(tx, id).await?;
            if !e.is_dir {
                return Err(Error::bad("the destination is not a folder"));
            }
            Ok(Some(e))
        }
    }
}

async fn sibling(
    tx: &mut Tx,
    parent: Option<Uuid>,
    name: &str,
    except: Option<Uuid>,
) -> Result<Option<Entry>> {
    let r = mosaikit_db::query(format!(
        "{ENTRY_SQL} where parent_id is not distinct from $1 and lower(title) = lower($2) and kind in ('file', 'folder')
           and ($3::uuid is null or id <> $3) and ($1::uuid is not null or owner_id = core.ctx_user()) limit 1"
    ))
    .bind(parent)
    .bind(name)
    .bind(except)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(r.as_ref().map(entry))
}

pub async fn list(k: &Kernel, c: &Caller, plugin_id: &str, parent: Option<Uuid>) -> Result<Listing> {
    let p = plugin(k, c, plugin_id, crate::access::USE).await?;
    let mut tx = k.db.begin_plugin_read(&p.id, &c.ctx()).await?;
    let current = folder(&mut tx, parent).await?;
    let rows = match parent {
        Some(pid) => mosaikit_db::query(format!("{ENTRY_SQL} where parent_id = $1 and kind in ('file', 'folder') order by kind desc, lower(title)"))
            .bind(pid)
            .fetch_all(&mut *tx)
            .await?,
        // root: own resources and the shared ones whose folder is not visible (the visible ones as a
        // set, not core.level_of() for every item)
        None => mosaikit_db::query(format!(
            "{ENTRY_SQL} where kind in ('file', 'folder')
               and (parent_id is null or parent_id not in (select id from core.visible_resources))
             order by kind desc, lower(title)"
        ))
        .fetch_all(&mut *tx)
        .await?,
    };
    let mut path = Vec::new();
    if let Some(cur) = &current {
        let anc: Vec<Uuid> =
            mosaikit_db::query_scalar("select ancestors from core.visible_resources where id = $1")
                .bind(cur.id)
                .fetch_optional(&mut *tx)
                .await?
                .unwrap_or_default();
        for a in anc {
            if let Some(r) = mosaikit_db::query("select id, title from core.visible_resources where id = $1")
                .bind(a)
                .fetch_optional(&mut *tx)
                .await?
            {
                path.push(Crumb { id: r.get(0), name: r.get(1) });
            }
        }
        path.push(Crumb { id: cur.id, name: cur.name.clone() });
    }
    tx.commit().await?;
    Ok(Listing {
        parent,
        path,
        entries: rows.iter().map(entry).collect(),
        my_level: current.map(|c| c.my_level).unwrap_or_else(|| "write".into()),
    })
}

pub async fn mkdir(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    parent: Option<Uuid>,
    name: &str,
) -> Result<Entry> {
    if !valid_name(name) {
        return Err(Error::bad("invalid name"));
    }
    let p = plugin(k, c, plugin_id, crate::access::CREATE).await?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    folder(&mut tx, parent).await?;
    if sibling(&mut tx, parent, name, None).await?.is_some() {
        return Err(Error::conflict(format!("an item called '{name}' already exists")));
    }
    crate::quotas::check(k, c.tenant.tenant_id, crate::quotas::Add::items(1)).await?;
    let id = tx.create_resource("folder", name, parent, &json!({})).await?;
    let e = get_entry(&mut tx, id).await?;
    tx.commit().await?;
    crate::quotas::touched(k, c.tenant.tenant_id);
    Ok(e)
}

/// Uploads a file. With `replace` it overwrites the content of a file with the same name.
pub async fn upload(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    parent: Option<Uuid>,
    name: &str,
    data: &[u8],
    replace: bool,
) -> Result<Entry> {
    if !valid_name(name) {
        return Err(Error::bad("invalid name"));
    }
    let p = plugin(k, c, plugin_id, crate::access::CREATE).await?;
    let tenant = c.tenant.tenant_id;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    folder(&mut tx, parent).await?;
    let existing = sibling(&mut tx, parent, name, None).await?;
    // at the limit nothing new comes in: a new file adds an item and its bytes, a replaced one the difference
    let add = match &existing {
        Some(e) => crate::quotas::Add::storage(data.len() as i64 - e.size),
        None => crate::quotas::Add { items: 1, storage: data.len() as i64, people: 0 },
    };
    crate::quotas::check(k, tenant, add).await?;
    let id = match existing {
        Some(e) if e.is_dir => return Err(Error::conflict(format!("a folder '{name}' already exists"))),
        Some(_) if !replace => return Err(Error::conflict(format!("a file '{name}' already exists"))),
        Some(e) => {
            need(&e, 2)?;
            e.id
        }
        None => tx.create_resource("file", name, parent, &json!({ "mime": mime_of(name) })).await?,
    };
    tx.update_resource(id, None, Some(&json!({ "mime": mime_of(name) })), Some(data.len() as i64)).await?;
    let e = get_entry(&mut tx, id).await?;
    k.blobs.write_file(tenant, id, data)?;
    if let Err(err) = tx.commit().await {
        if !replace {
            k.blobs.remove(tenant, id);
        }
        return Err(err.into());
    }
    events::record(
        k,
        Some(tenant),
        Some(c.user.user_id),
        Some(&p.id),
        Some(id),
        "file.upload",
        json!({ "size": data.len() }),
    )
    .await;
    crate::quotas::touched(k, tenant);
    Ok(e)
}

/// Content of a file (read required).
pub async fn read(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<(Entry, Vec<u8>)> {
    let p = plugin(k, c, plugin_id, crate::access::USE).await?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    tx.commit().await?;
    if e.is_dir {
        return Err(Error::bad("it is a folder: use the zip"));
    }
    let data = k.blobs.read_file(c.tenant.tenant_id, id)?;
    Ok((e, data))
}

/// Hard ceiling, in bytes, of what the host operation `files.read` returns in one call, whatever
/// `max_bytes` the logic asks (the answer is base64 inside a JSON message of at most 16 MB).
pub const HOST_READ_CEILING: usize = 4 << 20;
/// Most rows `files.list` returns for a folder (the rows are cut, `truncated` says so).
pub const HOST_LIST_MAX: usize = 1000;
/// The plugin whose files the host operations read when the request does not name another one.
pub const DEFAULT_SOURCE: &str = "com.mosaikit.files";

/// Plugin whose files the host operations read: active, on for the tenant, with the files permission
/// of its manifest, and the caller may use it (the rules of its own UI).
async fn host_source(k: &Kernel, c: &Caller, source: &str) -> Result<std::sync::Arc<LoadedPlugin>> {
    plugin(k, c, source, crate::access::USE).await
}

/// `files.list`: the files and folders of `parent` (the root if `None`) the caller sees, as the Files
/// UI lists them. Never more than [`HOST_LIST_MAX`]; the flag says if rows were left out.
pub async fn host_list(
    k: &Kernel,
    c: &Caller,
    source: &str,
    parent: Option<Uuid>,
) -> Result<(Vec<Entry>, bool)> {
    let mut entries = list(k, c, source, parent).await?.entries;
    let cut = entries.len() > HOST_LIST_MAX;
    entries.truncate(HOST_LIST_MAX);
    Ok((entries, cut))
}

/// `files.describe`: the metadata of one file or folder the caller sees.
pub async fn host_describe(k: &Kernel, c: &Caller, source: &str, id: Uuid) -> Result<Entry> {
    let p = host_source(k, c, source).await?;
    let mut tx = k.db.begin_plugin_read(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    tx.commit().await?;
    Ok(e)
}

/// `files.read`: the first `max_bytes` (at most [`HOST_READ_CEILING`]) of a file the caller sees.
/// Returns the entry, the bytes and whether the file is longer than what was returned.
pub async fn host_read(
    k: &Kernel,
    c: &Caller,
    source: &str,
    id: Uuid,
    max_bytes: usize,
) -> Result<(Entry, Vec<u8>, bool)> {
    let e = host_describe(k, c, source, id).await?;
    if e.is_dir {
        return Err(Error::bad("it is a folder"));
    }
    let cap = max_bytes.min(HOST_READ_CEILING);
    let (data, total) = k.blobs.read_file_head(c.tenant.tenant_id, id, cap)?;
    let truncated = total > data.len() as u64;
    Ok((e, data, truncated))
}

pub async fn rename(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid, name: &str) -> Result<Entry> {
    if !valid_name(name) {
        return Err(Error::bad("invalid name"));
    }
    let p = plugin(k, c, plugin_id, crate::access::USE).await?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    need(&e, 2)?;
    if sibling(&mut tx, e.parent_id, name, Some(id)).await?.is_some() {
        return Err(Error::conflict(format!("an item called '{name}' already exists")));
    }
    let meta = if e.is_dir { Value::Null } else { json!({ "mime": mime_of(name) }) };
    tx.update_resource(id, Some(name), Some(&meta).filter(|m| !m.is_null()), None).await?;
    let e = get_entry(&mut tx, id).await?;
    tx.commit().await?;
    Ok(e)
}

pub async fn move_to(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    id: Uuid,
    parent: Option<Uuid>,
) -> Result<Entry> {
    let p = plugin(k, c, plugin_id, crate::access::USE).await?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    folder(&mut tx, parent).await?;
    if sibling(&mut tx, parent, &e.name, Some(id)).await?.is_some() {
        return Err(Error::conflict(format!("'{}' already exists in the destination", e.name)));
    }
    tx.move_resource(id, parent).await?;
    let e = get_entry(&mut tx, id).await?;
    tx.commit().await?;
    Ok(e)
}

/// Recursive copy: the copy belongs to whoever makes it.
pub async fn copy_to(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    id: Uuid,
    parent: Option<Uuid>,
) -> Result<Entry> {
    let p = plugin(k, c, plugin_id, crate::access::CREATE).await?;
    let tenant = c.tenant.tenant_id;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let src = get_entry(&mut tx, id).await?;
    if let Some(dest) = folder(&mut tx, parent).await? {
        let anc: Vec<Uuid> =
            mosaikit_db::query_scalar("select ancestors from core.visible_resources where id = $1")
                .bind(dest.id)
                .fetch_optional(&mut *tx)
                .await?
                .unwrap_or_default();
        if dest.id == id || anc.contains(&id) {
            return Err(Error::bad("a folder cannot be copied into itself"));
        }
    }
    // free name in the destination: "name (copy)", "name (copy 2)"...
    let mut name = src.name.clone();
    let mut n = 1;
    while sibling(&mut tx, parent, &name, None).await?.is_some() {
        name = copy_name(&src.name, n, src.is_dir);
        n += 1;
    }
    let mut copied: Vec<(Uuid, Uuid)> = Vec::new();
    let mut add = crate::quotas::Add::default();
    let root = copy_rec(&mut tx, &src, parent, &name, &mut copied, &mut add).await?;
    // the copy is still in the transaction: the quota is checked on what it adds
    crate::quotas::check(k, tenant, add).await?;
    for (from, to) in &copied {
        k.blobs.copy_file(tenant, *from, *to)?;
    }
    let e = get_entry(&mut tx, root).await?;
    if let Err(err) = tx.commit().await {
        for (_, to) in copied {
            k.blobs.remove(tenant, to);
        }
        return Err(err.into());
    }
    crate::quotas::touched(k, tenant);
    Ok(e)
}

fn copy_name(name: &str, n: usize, is_dir: bool) -> String {
    let suffix = if n == 1 { " (copy)".to_string() } else { format!(" (copy {n})") };
    match name.rfind('.') {
        Some(i) if i > 0 && !is_dir => format!("{}{suffix}{}", &name[..i], &name[i..]),
        _ => format!("{name}{suffix}"),
    }
}

async fn copy_rec(
    tx: &mut Tx,
    src: &Entry,
    parent: Option<Uuid>,
    name: &str,
    copied: &mut Vec<(Uuid, Uuid)>,
    add: &mut crate::quotas::Add,
) -> Result<Uuid> {
    if copied.len() > MAX_COPY_ITEMS {
        return Err(Error::bad("too many items to copy"));
    }
    let kind = if src.is_dir { "folder" } else { "file" };
    let meta = if src.is_dir { json!({}) } else { json!({ "mime": src.mime }) };
    let id = tx.create_resource(kind, name, parent, &meta).await?;
    add.items += 1;
    if src.is_dir {
        let children: Vec<Entry> =
            mosaikit_db::query(format!("{ENTRY_SQL} where parent_id = $1 and kind in ('file', 'folder')"))
                .bind(src.id)
                .fetch_all(&mut **tx)
                .await?
                .iter()
                .map(entry)
                .collect();
        for ch in children {
            Box::pin(copy_rec(tx, &ch, Some(id), &ch.name, copied, add)).await?;
        }
    } else {
        tx.update_resource(id, None, None, Some(src.size)).await?;
        add.storage += src.size;
        copied.push((src.id, id));
    }
    Ok(id)
}

pub async fn delete(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<()> {
    let p = plugin(k, c, plugin_id, crate::access::DELETE).await?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    need(&e, 3)?;
    // to the trash: the contents on disk stay until the purge
    tx.delete_resource(id).await?;
    tx.commit().await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&p.id),
        Some(id),
        "file.delete",
        json!({ "title": e.name }),
    )
    .await;
    Ok(())
}

/// Zip of a folder (only the readable content).
pub async fn zip_folder(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<(String, Vec<u8>)> {
    let p = plugin(k, c, plugin_id, crate::access::USE).await?;
    let tenant = c.tenant.tenant_id;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let root = get_entry(&mut tx, id).await?;
    if !root.is_dir {
        return Err(Error::bad("it is not a folder"));
    }
    let rows = mosaikit_db::query(
        "select id, kind, title, parent_id, size_bytes from core.visible_resources
         where $1 = any(ancestors) and kind in ('file', 'folder')",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let total: i64 = rows.iter().map(|r| r.get::<i64, _>(4)).sum();
    if total > MAX_ZIP_BYTES {
        return Err(Error::bad("folder over 1 GB: download the files one by one"));
    }
    // relative paths rebuilt from the parents
    let mut names: std::collections::HashMap<Uuid, (String, Option<Uuid>, bool)> = rows
        .iter()
        .map(|r| {
            (
                r.get::<Uuid, _>(0),
                (r.get::<String, _>(2), r.get::<Option<Uuid>, _>(3), r.get::<String, _>(1) == "folder"),
            )
        })
        .collect();
    names.insert(id, (String::new(), None, true));
    let path_of = |mut cur: Uuid| -> String {
        let mut parts = Vec::new();
        while cur != id {
            let Some((n, par, _)) = names.get(&cur) else { break };
            parts.push(n.clone());
            match par {
                Some(p) => cur = *p,
                None => break,
            }
        }
        parts.reverse();
        parts.join("/")
    };
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for r in &rows {
        let rid: Uuid = r.get(0);
        if r.get::<String, _>(1) == "folder" {
            continue;
        }
        let path = path_of(rid);
        let data = k.blobs.read_file(tenant, rid).unwrap_or_default();
        w.start_file(path, opts).map_err(|e| Error::internal(e.to_string()))?;
        w.write_all(&data)?;
    }
    let bytes = w.finish().map_err(|e| Error::internal(e.to_string()))?.into_inner();
    Ok((format!("{}.zip", root.name), bytes))
}

/// A file found inside a folder tree by its relative path.
#[derive(Debug, Clone)]
pub struct TreeFile {
    pub id: Uuid,
    pub name: String,
}

/// Finds the file at `rel` (segments separated by `/`) under the folder `root`, as the context `ctx`
/// sees it (a person's, or a public link's): trashed or hidden items are not found. Names are matched
/// exactly; siblings never differ only by case. `None` for an empty path, a path that is not safe
/// (`.`, `..`, empty segments, separators or control characters in a name) or one that leads to a
/// folder. This is how a folder is served as a static tree (tickets and public links).
pub async fn resolve_path(
    k: &Kernel,
    plugin_id: &str,
    ctx: &mosaikit_db::Ctx,
    root: Uuid,
    rel: &str,
) -> Result<Option<TreeFile>> {
    let segs: Vec<&str> = rel.split('/').collect();
    if rel.is_empty() || segs.len() > 64 || !segs.iter().all(|s| valid_name(s)) {
        return Ok(None);
    }
    let mut tx = k.db.begin_plugin_read(plugin_id, ctx).await?;
    let mut cur = root;
    for (i, seg) in segs.iter().enumerate() {
        let last = i + 1 == segs.len();
        let row = mosaikit_db::query(
            "select id, title from core.visible_resources
             where parent_id = $1 and title = $2 and kind = $3 limit 1",
        )
        .bind(cur)
        .bind(*seg)
        .bind(if last { "file" } else { "folder" })
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            tx.commit().await?;
            return Ok(None);
        };
        cur = row.get(0);
        if last {
            let name: String = row.get(1);
            tx.commit().await?;
            return Ok(Some(TreeFile { id: cur, name }));
        }
    }
    tx.commit().await?;
    Ok(None)
}

/// What to do with a file of the zip whose name is already taken in the destination.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OnConflict {
    /// stop and undo what was created (the default)
    Fail,
    /// keep the existing one
    Skip,
    /// overwrite the content of an existing file (what was overwritten cannot be undone)
    Replace,
}

impl OnConflict {
    pub fn parse(s: &str) -> Option<OnConflict> {
        match s {
            "" | "fail" => Some(OnConflict::Fail),
            "skip" => Some(OnConflict::Skip),
            "replace" => Some(OnConflict::Replace),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Unzipped {
    /// the folder made for the content, when one was asked for
    pub folder: Option<Entry>,
    pub files: usize,
    pub folders: usize,
    pub skipped: usize,
    /// plugins that could take the folder further (`[[folder_profiles]]`); the person was told in the bell
    pub suggestions: Vec<crate::profiles::Suggestion>,
}

const UNZIP_MAX_FILES: usize = 20_000;
const UNZIP_MAX_BYTES: u64 = 512 << 20;

/// A folder called `name` under `parent`: the existing one, or a new one (then its id is in `created`).
async fn ensure_folder(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    parent: Option<Uuid>,
    name: &str,
    created: &mut Vec<Uuid>,
) -> Result<Uuid> {
    let p = plugin(k, c, plugin_id, crate::access::USE).await?;
    let mut tx = k.db.begin_plugin_read(&p.id, &c.ctx()).await?;
    let existing = sibling(&mut tx, parent, name, None).await?;
    tx.commit().await?;
    match existing {
        Some(e) if e.is_dir => Ok(e.id),
        Some(_) => Err(Error::conflict(format!("a file '{name}' already exists where a folder is needed"))),
        None => {
            let e = mkdir(k, c, plugin_id, parent, name).await?;
            created.push(e.id);
            Ok(e.id)
        }
    }
}

/// Unpacks a zip into the folder `parent` (the root if `None`), or into a new folder `folder` inside it,
/// keeping its structure. The whole archive is checked before anything is created: paths (no `..`, no
/// absolute or drive paths, no separators or control characters in a name), the number of files, the
/// size really inflated (the sizes in a zip header are written by whoever made it) and the quotas of the
/// tenant. `__MACOSX/` and `._*` entries are dropped. If a step fails, what was created is removed.
pub async fn unzip(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    parent: Option<Uuid>,
    folder: Option<&str>,
    zip_bytes: &[u8],
    on_conflict: OnConflict,
) -> Result<Unzipped> {
    use std::io::Read;
    let p = plugin(k, c, plugin_id, crate::access::CREATE).await?;
    if let Some(f) = folder {
        if !valid_name(f) {
            return Err(Error::bad("invalid folder name"));
        }
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| Error::bad(format!("invalid zip: {e}")))?;
    if zip.len() > UNZIP_MAX_FILES {
        return Err(Error::bad(format!("the zip contains more than {UNZIP_MAX_FILES} entries")));
    }

    // pass 1: names and real sizes
    struct Item {
        index: usize,
        segs: Vec<String>,
        is_dir: bool,
    }
    let mut items: Vec<Item> = Vec::new();
    let (mut total, mut files, mut dirs) = (0u64, 0usize, std::collections::HashSet::new());
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| Error::bad(format!("zip: {e}")))?;
        let name = f.name().map_err(|e| Error::bad(format!("zip: {e}")))?.replace('\\', "/");
        let trimmed = name.trim_end_matches('/');
        if trimmed.is_empty() {
            continue;
        }
        if f.enclosed_name().is_none() || trimmed.starts_with('/') || trimmed.contains(':') {
            return Err(Error::bad(format!("unsafe path in the zip: {name}")));
        }
        let segs: Vec<String> = trimmed.split('/').map(str::to_string).collect();
        if segs[0] == "__MACOSX" || segs.last().is_some_and(|s| s.starts_with("._")) {
            continue;
        }
        if segs.len() > 64 || !segs.iter().all(|s| valid_name(s)) {
            return Err(Error::bad(format!("unsafe or invalid name in the zip: {name}")));
        }
        for n in 1..segs.len() {
            dirs.insert(segs[..n].join("/"));
        }
        let is_dir = f.is_dir();
        if is_dir {
            dirs.insert(segs.join("/"));
        } else {
            let left = UNZIP_MAX_BYTES - total;
            let n = std::io::copy(&mut (&mut f).take(left + 1), &mut std::io::sink())
                .map_err(|e| Error::bad(format!("zip: {e}")))?;
            total += n;
            if total > UNZIP_MAX_BYTES {
                return Err(Error::bad(format!("content of the zip over {} MB", UNZIP_MAX_BYTES >> 20))
                    .with_code("content_too_large"));
            }
            files += 1;
        }
        items.push(Item { index: i, segs, is_dir });
    }
    let tenant = c.tenant.tenant_id;
    crate::quotas::check(
        k,
        tenant,
        crate::quotas::Add {
            items: (files + dirs.len() + usize::from(folder.is_some())) as i64,
            storage: total as i64,
            people: 0,
        },
    )
    .await?;

    // pass 2: create; on failure remove what this call made
    let mut created: Vec<Uuid> = Vec::new();
    let res = async {
        let mut root = parent;
        let mut made = None;
        if let Some(name) = folder {
            if on_conflict == OnConflict::Fail {
                let mut tx = k.db.begin_plugin_read(&p.id, &c.ctx()).await?;
                let taken = sibling(&mut tx, parent, name, None).await?;
                tx.commit().await?;
                if taken.is_some() {
                    return Err(Error::conflict(format!("an item called '{name}' already exists")));
                }
            }
            let id = ensure_folder(k, c, plugin_id, parent, name, &mut created).await?;
            root = Some(id);
            made = Some(id);
        }
        let mut ids: std::collections::HashMap<String, Uuid> = std::collections::HashMap::new();
        let (mut nfiles, mut skipped) = (0usize, 0usize);
        for it in &items {
            // the folders on the way
            let upto = if it.is_dir { it.segs.len() } else { it.segs.len() - 1 };
            let mut at = root;
            for n in 1..=upto {
                let key = it.segs[..n].join("/");
                let id = match ids.get(&key) {
                    Some(id) => *id,
                    None => {
                        let id = ensure_folder(k, c, plugin_id, at, &it.segs[n - 1], &mut created).await?;
                        ids.insert(key, id);
                        id
                    }
                };
                at = Some(id);
            }
            if it.is_dir {
                continue;
            }
            let mut f = zip.by_index(it.index).map_err(|e| Error::bad(format!("zip: {e}")))?;
            let mut buf = Vec::with_capacity(f.size().min(16 << 20) as usize);
            (&mut f)
                .take(UNZIP_MAX_BYTES + 1)
                .read_to_end(&mut buf)
                .map_err(|e| Error::bad(format!("zip: {e}")))?;
            drop(f);
            let name = it.segs.last().expect("a file has a name");
            match upload(k, c, plugin_id, at, name, &buf, on_conflict == OnConflict::Replace).await {
                Ok(e) => {
                    if on_conflict != OnConflict::Replace {
                        created.push(e.id);
                    }
                    nfiles += 1;
                }
                Err(e) if on_conflict == OnConflict::Skip && e.kind == crate::Kind::Conflict => skipped += 1,
                Err(e) => return Err(e),
            }
        }
        Ok((made, nfiles, ids.len() + usize::from(folder.is_some()), skipped))
    }
    .await;
    match res {
        Ok((made, nfiles, nfolders, skipped)) => {
            let folder = match made {
                Some(id) => {
                    let mut tx = k.db.begin_plugin_read(&p.id, &c.ctx()).await?;
                    let e = get_entry(&mut tx, id).await?;
                    tx.commit().await?;
                    Some(e)
                }
                None => None,
            };
            events::record(
                k,
                Some(tenant),
                Some(c.user.user_id),
                Some(&p.id),
                folder.as_ref().map(|f| f.id).or(parent),
                "file.unzip",
                json!({ "files": nfiles, "folders": nfolders, "skipped": skipped }),
            )
            .await;
            crate::quotas::touched(k, tenant);
            // what the folder looks like: the one made for the content, or the one it went into
            let target = match (&folder, parent) {
                (Some(f), _) => Some((f.id, f.name.clone())),
                (None, Some(id)) => {
                    let mut tx = k.db.begin_plugin_read(&p.id, &c.ctx()).await?;
                    let e = get_entry(&mut tx, id).await?;
                    tx.commit().await?;
                    Some((id, e.name))
                }
                (None, None) => None,
            };
            let mut suggestions = Vec::new();
            if let (Some((id, name)), true) = (target, nfiles > 0) {
                suggestions = crate::profiles::detect(k, c, plugin_id, id).await.unwrap_or_default();
                crate::profiles::announce(k, c, &name, &suggestions).await;
            }
            Ok(Unzipped { folder, files: nfiles, folders: nfolders, skipped, suggestions })
        }
        Err(e) => {
            // newest first: the files before the folders that hold them
            for id in created.into_iter().rev() {
                let _ = delete(k, c, plugin_id, id).await;
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn copy_names() {
        assert_eq!(super::copy_name("a.txt", 1, false), "a (copy).txt");
        assert_eq!(super::copy_name("a.txt", 2, false), "a (copy 2).txt");
        assert_eq!(super::copy_name("folder", 1, true), "folder (copy)");
    }
}
