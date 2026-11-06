//! Folders that look like something a plugin knows (`[[folder_profiles]]` in a manifest): a folder with a
//! `tileset.json` is a 3D Tiles dataset, one with a `*.pmtiles`-style marker is another format, and so on.
//! The kernel only looks at the names at the root of the folder (nothing is read, no plugin code runs) and
//! tells the person which plugin could take it from there.

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::{Caller, Kernel, Result};

/// A plugin that offers to take a folder further.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Suggestion {
    /// the plugin that declares the profile, and its name
    pub plugin: String,
    pub plugin_label: String,
    /// the id of the profile and its English label (`[[folder_profiles]]`)
    pub profile: String,
    pub label: String,
    /// the folder that holds the marker: the one given, or the only folder inside it (a zip often has one
    /// folder around everything)
    pub folder: Uuid,
    /// path of the marker file from that folder (its name)
    pub marker: String,
    /// the place to open inside the plugin (`msk.at`) and the address in the app that opens it
    pub at: String,
    pub link: String,
}

/// The plugins on for the tenant, usable by the person, that declare a profile the folder matches.
/// `source` is the plugin whose Files area holds the folder. At most one suggestion per profile.
pub async fn detect(k: &Kernel, c: &Caller, source: &str, folder: Uuid) -> Result<Vec<Suggestion>> {
    let declared: Vec<_> =
        k.plugins.list().into_iter().filter(|p| !p.manifest.folder_profiles.is_empty()).collect();
    if declared.is_empty() {
        return Ok(Vec::new());
    }
    let listing = children(k, c, source, folder).await?;
    // the only folder inside, when nothing at the root says what it is
    let inner = match listing.iter().filter(|(_, is_dir, _)| *is_dir).collect::<Vec<_>>().as_slice() {
        [(id, _, _)] => Some((*id, children(k, c, source, *id).await?)),
        _ => None,
    };
    let find = |names: &[(Uuid, bool, String)], marker: &str| {
        names.iter().find(|(_, dir, n)| !*dir && n.eq_ignore_ascii_case(marker)).map(|(_, _, n)| n.clone())
    };
    let mut out = Vec::new();
    for p in declared {
        if crate::access::plugin_for(k, c, &p.id).await.is_err() {
            continue;
        }
        for prof in &p.manifest.folder_profiles {
            let hit =
                prof.markers.iter().find_map(|m| find(&listing, m).map(|n| (folder, n))).or_else(|| {
                    let (id, names) = inner.as_ref()?;
                    prof.markers.iter().find_map(|m| find(names, m).map(|n| (*id, n)))
                });
            let Some((at_folder, marker)) = hit else { continue };
            let at = format!("profile/{}/{at_folder}?source={source}", prof.id);
            out.push(Suggestion {
                plugin: p.id.clone(),
                plugin_label: p.manifest.contribution.label.clone(),
                profile: prof.id.clone(),
                label: prof.label.clone(),
                folder: at_folder,
                marker,
                link: crate::notify::plugin_link(&c.tenant.slug, &p.id, Some(&at)),
                at,
            });
        }
    }
    out.sort_by(|a, b| (&a.plugin, &a.profile).cmp(&(&b.plugin, &b.profile)));
    Ok(out)
}

/// Id, is-folder and name of what is directly inside a folder, as the person sees it (at most 2000).
async fn children(k: &Kernel, c: &Caller, source: &str, folder: Uuid) -> Result<Vec<(Uuid, bool, String)>> {
    let mut tx = k.db.begin_plugin_read(source, &c.ctx()).await?;
    let rows = mosaikit_db::query(
        "select id, kind = 'folder', title from core.visible_resources
         where parent_id = $1 and kind in ('file', 'folder') limit 2000",
    )
    .bind(folder)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows.iter().map(|r| (r.get(0), r.get(1), r.get(2))).collect())
}

/// Tells the person, in the bell, what a folder they have just unpacked could become. Best effort.
pub async fn announce(k: &Kernel, c: &Caller, name: &str, found: &[Suggestion]) {
    for s in found {
        crate::notify::emit(
            k,
            crate::notify::New {
                user: c.user.user_id,
                tenant: Some(c.tenant.tenant_id),
                kind: crate::notify::NoteKind::Plugin,
                title: format!("“{name}” looks like {}", s.label),
                body: format!("Open it in {} to publish it.", s.plugin_label),
                link: s.link.clone(),
                source: s.plugin.clone(),
                resource: Some(s.folder),
                data: json!({ "app": s.plugin_label, "code": "folder_profile", "name": name, "label": s.label }),
            },
        )
        .await;
    }
}
