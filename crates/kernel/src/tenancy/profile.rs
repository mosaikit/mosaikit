//! The profile a person changes by themselves (Account › Profile): the display name and the picture.
//! The email stays with the Tenant Manager of the home tenant (or another Administrator). Accounts of
//! an identity provider take the name from the provider at every sign-in: it is read-only for them.
//!
//! The picture is checked like the logos ([`super::levels::sniff_image`]: SVG, PNG or WebP, 512 KB,
//! no scripts) and kept with the identity images of the home tenant
//! (`<data_dir>/blobs/identity/<home tenant>/people/<user>`), so it travels with the export of the tenant.

use serde_json::json;
use uuid::Uuid;

use super::levels::sniff_image;
use crate::{events, Error, Kernel, Result, SessionUser};

/// Longest display name.
pub const NAME_MAX: usize = 120;

fn picture_path(k: &Kernel, home: Uuid, user: Uuid) -> std::path::PathBuf {
    k.blobs.root().join("identity").join(home.to_string()).join("people").join(user.to_string())
}

/// The person changes their own display name.
pub async fn set_my_name(k: &Kernel, me: &SessionUser, name: &str) -> Result<()> {
    if crate::oidc::is_external(k, me.user_id).await? {
        return Err(Error::bad("the name comes from the identity provider of the tenant")
            .with_code("profile_from_provider"));
    }
    let name = name.trim();
    if name.is_empty() || name.chars().count() > NAME_MAX || name.chars().any(char::is_control) {
        return Err(Error::bad("a name of 1 to 120 characters").with_code("profile_name_invalid"));
    }
    mosaikit_db::query("update core.users set display_name = $2 where id = $1")
        .bind(me.user_id)
        .bind(name)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        (!me.is_system_admin).then_some(me.home_tenant_id),
        Some(me.user_id),
        None,
        None,
        "profile.name",
        json!({ "name": name }),
    )
    .await;
    Ok(())
}

/// The person sets their own picture.
pub async fn set_my_picture(k: &Kernel, me: &SessionUser, data: &[u8]) -> Result<()> {
    let mime = sniff_image(data, false)?;
    let path = picture_path(k, me.home_tenant_id, me.user_id);
    std::fs::create_dir_all(path.parent().expect("folder"))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, &path)?;
    mosaikit_db::query("update core.users set picture_type = $2, picture_v = $3 where id = $1")
        .bind(me.user_id)
        .bind(mime)
        .bind(crate::util::random_token(4))
        .execute(&k.db)
        .await?;
    events::record(
        k,
        (!me.is_system_admin).then_some(me.home_tenant_id),
        Some(me.user_id),
        None,
        None,
        "profile.picture",
        json!({}),
    )
    .await;
    Ok(())
}

/// The person removes their picture (the initials come back).
pub async fn remove_my_picture(k: &Kernel, me: &SessionUser) -> Result<()> {
    let _ = std::fs::remove_file(picture_path(k, me.home_tenant_id, me.user_id));
    mosaikit_db::query("update core.users set picture_type = null, picture_v = null where id = $1")
        .bind(me.user_id)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        (!me.is_system_admin).then_some(me.home_tenant_id),
        Some(me.user_id),
        None,
        None,
        "profile.picture_removed",
        json!({}),
    )
    .await;
    Ok(())
}

/// The version of the picture of a person (changes with every new picture), if they have one.
pub async fn picture_version(k: &Kernel, user: Uuid) -> Result<Option<String>> {
    Ok(mosaikit_db::query_scalar::<Option<String>>("select picture_v from core.users where id = $1")
        .bind(user)
        .fetch_optional(&k.db)
        .await?
        .flatten())
}

/// The picture of `user` for `viewer`: the person themselves, an Administrator, or someone who shares
/// a tenant with them. `None`: no picture, or not visible to the viewer.
pub async fn picture(k: &Kernel, viewer: &SessionUser, user: Uuid) -> Result<Option<(Vec<u8>, String)>> {
    let row = mosaikit_db::query("select home_tenant_id, picture_type from core.users where id = $1")
        .bind(user)
        .fetch_optional(&k.db)
        .await?;
    let Some(r) = row else { return Ok(None) };
    let (home, mime): (Uuid, Option<String>) = (r.get(0), r.get(1));
    let Some(mime) = mime else { return Ok(None) };
    let visible = viewer.user_id == user
        || viewer.is_system_admin
        || mosaikit_db::query_scalar::<i64>(
            "select count(*) from core.memberships a join core.memberships b on a.tenant_id = b.tenant_id
             where a.user_id = $1 and b.user_id = $2",
        )
        .bind(viewer.user_id)
        .bind(user)
        .fetch_one(&k.db)
        .await?
            > 0;
    if !visible {
        return Ok(None);
    }
    match std::fs::read(picture_path(k, home, user)) {
        Ok(data) => Ok(Some((data, mime))),
        Err(_) => Ok(None),
    }
}
