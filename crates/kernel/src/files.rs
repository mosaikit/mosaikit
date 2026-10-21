//! File e cartelle (permesso `files`): risorse `folder`/`file` con contenuto su disco.

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
    /// livello sulla cartella corrente (alla radice: "write", si creano risorse proprie)
    pub my_level: String,
}

fn plugin(k: &Kernel, id: &str) -> Result<std::sync::Arc<LoadedPlugin>> {
    let p = k.plugins.active(id)?;
    if !p.manifest.permissions.files {
        return Err(Error::forbidden("il plugin non dichiara il permesso files"));
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
        .ok_or_else(|| Error::not_found("file o cartella non trovati"))?;
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
            "serve il permesso di gestione"
        } else {
            "serve il permesso di scrittura"
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
                return Err(Error::bad("la destinazione non e' una cartella"));
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
    let p = plugin(k, plugin_id)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let current = folder(&mut tx, parent).await?;
    let rows = match parent {
        Some(pid) => mosaikit_db::query(format!("{ENTRY_SQL} where parent_id = $1 and kind in ('file', 'folder') order by kind desc, lower(title)"))
            .bind(pid)
            .fetch_all(&mut *tx)
            .await?,
        // radice: risorse proprie e quelle condivise la cui cartella non e' visibile
        None => mosaikit_db::query(format!(
            "{ENTRY_SQL} where kind in ('file', 'folder') and (parent_id is null or core.level_of(parent_id) = 0)
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
        return Err(Error::bad("nome non valido"));
    }
    let p = plugin(k, plugin_id)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    folder(&mut tx, parent).await?;
    if sibling(&mut tx, parent, name, None).await?.is_some() {
        return Err(Error::conflict(format!("esiste gia' un elemento chiamato '{name}'")));
    }
    let id = tx.create_resource("folder", name, parent, &json!({})).await?;
    let e = get_entry(&mut tx, id).await?;
    tx.commit().await?;
    Ok(e)
}

/// Carica un file. Con `replace` sovrascrive il contenuto di un file omonimo.
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
        return Err(Error::bad("nome non valido"));
    }
    let p = plugin(k, plugin_id)?;
    let tenant = c.tenant.tenant_id;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    folder(&mut tx, parent).await?;
    let id = match sibling(&mut tx, parent, name, None).await? {
        Some(e) if e.is_dir => return Err(Error::conflict(format!("esiste gia' una cartella '{name}'"))),
        Some(_) if !replace => return Err(Error::conflict(format!("esiste gia' un file '{name}'"))),
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
    Ok(e)
}

/// Contenuto di un file (lettura richiesta).
pub async fn read(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<(Entry, Vec<u8>)> {
    let p = plugin(k, plugin_id)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    tx.commit().await?;
    if e.is_dir {
        return Err(Error::bad("e' una cartella: usa lo zip"));
    }
    let data = k.blobs.read_file(c.tenant.tenant_id, id)?;
    Ok((e, data))
}

pub async fn rename(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid, name: &str) -> Result<Entry> {
    if !valid_name(name) {
        return Err(Error::bad("nome non valido"));
    }
    let p = plugin(k, plugin_id)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    need(&e, 2)?;
    if sibling(&mut tx, e.parent_id, name, Some(id)).await?.is_some() {
        return Err(Error::conflict(format!("esiste gia' un elemento chiamato '{name}'")));
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
    let p = plugin(k, plugin_id)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    folder(&mut tx, parent).await?;
    if sibling(&mut tx, parent, &e.name, Some(id)).await?.is_some() {
        return Err(Error::conflict(format!("nella destinazione esiste gia' '{}'", e.name)));
    }
    tx.move_resource(id, parent).await?;
    let e = get_entry(&mut tx, id).await?;
    tx.commit().await?;
    Ok(e)
}

/// Copia ricorsiva: la copia appartiene a chi la fa.
pub async fn copy_to(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    id: Uuid,
    parent: Option<Uuid>,
) -> Result<Entry> {
    let p = plugin(k, plugin_id)?;
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
            return Err(Error::bad("impossibile copiare una cartella dentro se stessa"));
        }
    }
    // nome libero nella destinazione: "nome (copia)", "nome (copia 2)"...
    let mut name = src.name.clone();
    let mut n = 1;
    while sibling(&mut tx, parent, &name, None).await?.is_some() {
        name = copy_name(&src.name, n, src.is_dir);
        n += 1;
    }
    let mut copied: Vec<(Uuid, Uuid)> = Vec::new();
    let root = copy_rec(&mut tx, &src, parent, &name, &mut copied).await?;
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
    Ok(e)
}

fn copy_name(name: &str, n: usize, is_dir: bool) -> String {
    let suffix = if n == 1 { " (copia)".to_string() } else { format!(" (copia {n})") };
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
) -> Result<Uuid> {
    if copied.len() > MAX_COPY_ITEMS {
        return Err(Error::bad("troppi elementi da copiare"));
    }
    let kind = if src.is_dir { "folder" } else { "file" };
    let meta = if src.is_dir { json!({}) } else { json!({ "mime": src.mime }) };
    let id = tx.create_resource(kind, name, parent, &meta).await?;
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
            Box::pin(copy_rec(tx, &ch, Some(id), &ch.name, copied)).await?;
        }
    } else {
        tx.update_resource(id, None, None, Some(src.size)).await?;
        copied.push((src.id, id));
    }
    Ok(id)
}

pub async fn delete(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<()> {
    let p = plugin(k, plugin_id)?;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let e = get_entry(&mut tx, id).await?;
    need(&e, 3)?;
    let gone = tx.delete_resource(id).await?;
    tx.commit().await?;
    for g in gone {
        k.blobs.remove(c.tenant.tenant_id, g);
    }
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&p.id),
        Some(id),
        "file.delete",
        json!({}),
    )
    .await;
    Ok(())
}

/// Zip di una cartella (solo il contenuto leggibile).
pub async fn zip_folder(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<(String, Vec<u8>)> {
    let p = plugin(k, plugin_id)?;
    let tenant = c.tenant.tenant_id;
    let mut tx = k.db.begin_plugin(&p.id, &c.ctx()).await?;
    let root = get_entry(&mut tx, id).await?;
    if !root.is_dir {
        return Err(Error::bad("non e' una cartella"));
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
        return Err(Error::bad("cartella oltre 1 GB: scarica i file singolarmente"));
    }
    // percorsi relativi ricostruiti dai genitori
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

#[cfg(test)]
mod tests {
    #[test]
    fn nomi_di_copia() {
        assert_eq!(super::copy_name("a.txt", 1, false), "a (copia).txt");
        assert_eq!(super::copy_name("a.txt", 2, false), "a (copia 2).txt");
        assert_eq!(super::copy_name("cartella", 1, true), "cartella (copia)");
    }
}
