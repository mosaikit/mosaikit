//! Uploads in pieces: a file too big for one request goes up a piece at a time into a staging area on disk
//! (`<tenant>/.uploads/<id>.part`) and, when complete, is moved into place as the file. The person who begins
//! it is the only one who may continue it; nothing is visible in Files until it is finished.

use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::files::{self, Content, Entry};
use crate::util::valid_name;
use crate::{Caller, Error, Kernel, Result};

/// Largest piece one request may carry.
pub const CHUNK_MAX: usize = 64 << 20;
/// Largest file that can be sent in pieces.
pub const UPLOAD_MAX: u64 = 16 << 30;
/// How many uploads in pieces a person may have open at once.
const OPEN_PER_PERSON: usize = 8;
/// An upload nobody continued for this long is thrown away.
const STALE_HOURS: u64 = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Meta {
    user: Uuid,
    plugin: String,
    parent: Option<Uuid>,
    name: String,
    size: u64,
    replace: bool,
}

/// How far an upload has got.
#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub id: Uuid,
    pub received: u64,
    pub size: u64,
}

fn paths(k: &Kernel, c: &Caller, id: Uuid) -> (PathBuf, PathBuf) {
    let dir = k.blobs.upload_dir(c.tenant.tenant_id);
    (dir.join(format!("{id}.json")), dir.join(format!("{id}.part")))
}

fn load(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<(Meta, PathBuf, PathBuf)> {
    let (meta_path, part) = paths(k, c, id);
    let meta: Meta = std::fs::read(&meta_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or_else(|| Error::not_found("upload not found"))?;
    // somebody else's upload, or one of another plugin, is not there as far as the caller can tell
    if meta.user != c.user.user_id || meta.plugin != plugin_id {
        return Err(Error::not_found("upload not found"));
    }
    Ok((meta, meta_path, part))
}

fn received(part: &Path) -> u64 {
    std::fs::metadata(part).map(|m| m.len()).unwrap_or(0)
}

/// Starts an upload of `size` bytes into the folder `parent` (the root if `None`) as `name`. The errors a finished
/// upload would give (no write permission, a name taken without `replace`, the quota) come now, before the bytes.
pub async fn begin(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    parent: Option<Uuid>,
    name: &str,
    size: u64,
    replace: bool,
) -> Result<Progress> {
    if !valid_name(name) {
        return Err(Error::bad("invalid name"));
    }
    if size == 0 || size > UPLOAD_MAX {
        return Err(Error::bad(format!("the size must be between 1 byte and {} GB", UPLOAD_MAX >> 30)));
    }
    let p = files::plugin(k, c, plugin_id, crate::access::CREATE).await?;
    let tenant = c.tenant.tenant_id;
    let mut tx = k.db.begin_plugin_read(&p.id, &c.ctx()).await?;
    files::folder(&mut tx, parent).await?;
    let existing = files::sibling(&mut tx, parent, name, None).await?;
    tx.commit().await?;
    let add = match &existing {
        Some(e) if e.is_dir => return Err(Error::conflict(format!("a folder '{name}' already exists"))),
        Some(_) if !replace => return Err(Error::conflict(format!("a file '{name}' already exists"))),
        Some(e) => crate::quotas::Add::storage(size as i64 - e.size),
        None => crate::quotas::Add { items: 1, storage: size as i64, people: 0 },
    };
    crate::quotas::check(k, tenant, add).await?;

    let dir = k.blobs.upload_dir(tenant);
    std::fs::create_dir_all(&dir)?;
    let mine = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| std::fs::read(e.path()).ok())
        .filter_map(|b| serde_json::from_slice::<Meta>(&b).ok())
        .filter(|m| m.user == c.user.user_id)
        .count();
    if mine >= OPEN_PER_PERSON {
        return Err(Error::new(crate::Kind::TooMany, "too many uploads open: finish or cancel one")
            .with_code("too_many_uploads"));
    }
    let id = Uuid::new_v4();
    let (meta_path, part) = paths(k, c, id);
    let meta =
        Meta { user: c.user.user_id, plugin: p.id.clone(), parent, name: name.to_string(), size, replace };
    std::fs::File::create(&part)?;
    std::fs::write(&meta_path, serde_json::to_vec(&meta).map_err(|e| Error::bad(e.to_string()))?)?;
    Ok(Progress { id, received: 0, size })
}

/// Where an upload has got to (to go on after an interruption).
pub async fn status(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<Progress> {
    let (meta, _, part) = load(k, c, plugin_id, id)?;
    Ok(Progress { id, received: received(&part), size: meta.size })
}

/// Adds the piece that starts at `offset`, which must be exactly where the upload stands: a piece sent twice or out of
/// order is a conflict that says how far the upload really is.
pub async fn chunk(
    k: &Kernel,
    c: &Caller,
    plugin_id: &str,
    id: Uuid,
    offset: u64,
    data: &[u8],
) -> Result<Progress> {
    let (meta, _, part) = load(k, c, plugin_id, id)?;
    if data.is_empty() || data.len() > CHUNK_MAX {
        return Err(Error::bad(format!("a piece is 1 byte to {} MB", CHUNK_MAX >> 20)));
    }
    let have = received(&part);
    if offset != have {
        return Err(Error::conflict(format!("the upload has {have} bytes, the piece starts at {offset}"))
            .with_code("upload_offset"));
    }
    if have + data.len() as u64 > meta.size {
        return Err(Error::bad("more bytes than the declared size"));
    }
    let mut f = std::fs::OpenOptions::new().write(true).open(&part)?;
    f.seek(SeekFrom::Start(have))?;
    f.write_all(data)?;
    f.flush()?;
    Ok(Progress { id, received: have + data.len() as u64, size: meta.size })
}

/// Completes the upload: the file appears in Files (the same checks as any upload), the staged bytes become its content.
pub async fn finish(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<Entry> {
    let (meta, meta_path, part) = load(k, c, plugin_id, id)?;
    let have = received(&part);
    if have != meta.size {
        return Err(Error::bad(format!("the upload has {have} of {} bytes", meta.size))
            .with_code("upload_incomplete"));
    }
    let e = files::store(
        k,
        c,
        plugin_id,
        meta.parent,
        &meta.name,
        Content::Staged(&part, meta.size),
        meta.replace,
    )
    .await?;
    let _ = std::fs::remove_file(meta_path);
    Ok(e)
}

/// Throws an upload away.
pub async fn abort(k: &Kernel, c: &Caller, plugin_id: &str, id: Uuid) -> Result<()> {
    let (_, meta_path, part) = load(k, c, plugin_id, id)?;
    let _ = std::fs::remove_file(part);
    let _ = std::fs::remove_file(meta_path);
    Ok(())
}

/// Removes what nobody has touched for a day from a staging folder (called by the cleanup of the contents).
pub(crate) fn sweep(dir: &Path) {
    let Ok(items) = std::fs::read_dir(dir) else { return };
    let age = |p: &Path| {
        std::fs::metadata(p).and_then(|m| m.modified()).map(|m| m.elapsed().unwrap_or_default()).ok()
    };
    for it in items.flatten() {
        let path = it.path();
        // an upload is as old as its last piece: the description waits with its bytes
        let part = path.with_extension("part");
        let idle = match (age(&path), age(&part)) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) => a,
            _ => continue,
        };
        if idle > std::time::Duration::from_secs(STALE_HOURS * 3600) {
            let _ = std::fs::remove_file(path);
        }
    }
}
