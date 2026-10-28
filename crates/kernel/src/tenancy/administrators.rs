//! Administrators: accounts of the system tenant, managed only by other Administrators.
//! Creation, disabling (at least one always stays active), reset of password and
//! second factor. The role is not given to users of the tenants: whoever is also
//! Tenant Manager or User of a tenant has a separate account there.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::require_admin;
use crate::identity::{check_password_len, hash_password, password_min, valid_username};
use crate::{events, Error, Kernel, Result, SessionUser};

/// Administrator account.
#[derive(Debug, Clone, Serialize)]
pub struct AdminInfo {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub status: String,
    /// second factor registered
    pub totp: bool,
    pub created_at: DateTime<Utc>,
}

pub async fn administrators(k: &Kernel, admin: &SessionUser) -> Result<Vec<AdminInfo>> {
    require_admin(admin)?;
    let rows = mosaikit_db::query(
        "select u.id, u.username, u.display_name, u.email, u.status, u.totp_enabled, u.created_at
         from core.users u join core.tenants t on t.id = u.home_tenant_id
         where t.is_system and u.is_system_admin order by u.username",
    )
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| AdminInfo {
            user_id: r.get(0),
            username: r.get(1),
            display_name: r.get(2),
            email: r.get(3),
            status: r.get(4),
            totp: r.get(5),
            created_at: r.get(6),
        })
        .collect())
}

/// New Administrator (at the first sign-in registers the second factor, if required).
pub async fn create_administrator(
    k: &Kernel,
    admin: &SessionUser,
    username: &str,
    display_name: &str,
    email: &str,
    password: &str,
) -> Result<Uuid> {
    require_admin(admin)?;
    let email = crate::notify::required_email(email)?.to_lowercase();
    ensure_email_free(k, &email, None).await?;
    let username = username.trim().to_lowercase();
    if !valid_username(&username) {
        return Err(Error::bad("invalid username: lower case, digits, '.', '-', '_' (2-64)"));
    }
    check_password_len(password, password_min(k, None).await?)?;
    let hash = hash_password(k, password).await?;
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.users (home_tenant_id, username, display_name, password_hash, is_system_admin, email)
         select id, $1, $2, $3, true, $4 from core.tenants where is_system returning id",
    )
    .bind(&username)
    .bind(display_name.trim())
    .bind(hash)
    .bind(&email)
    .fetch_one(&k.db)
    .await
    .map_err(|e| match Error::from(e) {
        err if err.kind == crate::Kind::Conflict => {
            Error::conflict(format!("an Administrator '{username}' already exists"))
        }
        err => err,
    })?;
    events::record(k, None, Some(admin.user_id), None, None, "admin.create", json!({ "username": username }))
        .await;
    Ok(id)
}

/// Id of the Administrator `user_id` (error if it is not an account of the system tenant).
async fn administrator(k: &Kernel, user_id: Uuid) -> Result<String> {
    let name: Option<String> = mosaikit_db::query_scalar(
        "select u.username from core.users u join core.tenants t on t.id = u.home_tenant_id
         where u.id = $1 and t.is_system and u.is_system_admin",
    )
    .bind(user_id)
    .fetch_optional(&k.db)
    .await?;
    name.ok_or_else(|| Error::not_found("Administrator not found"))
}

/// Disables or reactivates an Administrator. At least one active Administrator always stays;
/// once disabled, it loses its open sessions at once.
pub async fn set_administrator_active(
    k: &Kernel,
    admin: &SessionUser,
    user_id: Uuid,
    active: bool,
) -> Result<()> {
    require_admin(admin)?;
    let username = administrator(k, user_id).await?;
    let mut tx = k.db.begin_app().await?;
    // serializes concurrent changes (never zero administrators)
    mosaikit_db::query("select pg_advisory_xact_lock(hashtext('mosaikit.administrators'))")
        .execute(&mut *tx)
        .await?;
    if !active {
        let others: i64 = mosaikit_db::query_scalar(
            "select count(*) from core.users where is_system_admin and status = 'active' and id <> $1",
        )
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
        if others == 0 {
            return Err(Error::conflict("at least one active Administrator must stay"));
        }
    }
    mosaikit_db::query("update core.users set status = $2 where id = $1")
        .bind(user_id)
        .bind(if active { "active" } else { "disabled" })
        .execute(&mut *tx)
        .await?;
    if !active {
        mosaikit_db::query("delete from core.sessions where user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        if active { "admin.enable" } else { "admin.disable" },
        json!({ "user": user_id, "username": username }),
    )
    .await;
    Ok(())
}

/// New password for another Administrator (their sessions are closed).
pub async fn reset_administrator_password(
    k: &Kernel,
    admin: &SessionUser,
    user_id: Uuid,
    password: &str,
) -> Result<()> {
    require_admin(admin)?;
    let username = administrator(k, user_id).await?;
    crate::identity::set_password(k, user_id, password).await?;
    mosaikit_db::query("delete from core.sessions where user_id = $1").bind(user_id).execute(&k.db).await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        "admin.password_reset",
        json!({ "user": user_id, "username": username }),
    )
    .await;
    Ok(())
}

/// Removes the second factor of an Administrator (lost phone): at the next sign-in
/// they register the app again.
pub async fn reset_administrator_totp(k: &Kernel, admin: &SessionUser, user_id: Uuid) -> Result<()> {
    require_admin(admin)?;
    let username = administrator(k, user_id).await?;
    crate::identity::reset_totp(k, user_id).await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        "admin.totp_reset",
        json!({ "user": user_id, "username": username }),
    )
    .await;
    Ok(())
}

/// The email is unique among the accounts (the sign-in help finds the account by it).
async fn ensure_email_free(k: &Kernel, email: &str, except: Option<Uuid>) -> Result<()> {
    let taken: bool = mosaikit_db::query_scalar(
        "select exists (select 1 from core.users where lower(email) = $1 and id <> $2)",
    )
    .bind(email)
    .bind(except.unwrap_or_else(Uuid::nil))
    .fetch_one(&k.db)
    .await?;
    if taken {
        return Err(
            Error::conflict("this email address is already used by another account").with_code("email_taken")
        );
    }
    Ok(())
}

fn check_admin_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > super::profile::NAME_MAX
        || name.chars().any(char::is_control)
    {
        return Err(Error::bad("a name of 1 to 120 characters").with_code("profile_name_invalid"));
    }
    Ok(name)
}

/// Name and email of an Administrator, changed by another Administrator. The own email is changed
/// with [`change_my_email`] (current password and second factor); the own name is free here too.
pub async fn update_administrator(
    k: &Kernel,
    admin: &SessionUser,
    user_id: Uuid,
    name: &str,
    email: &str,
) -> Result<()> {
    require_admin(admin)?;
    let username = administrator(k, user_id).await?;
    let name = check_admin_name(name)?;
    // the own address stays as it is here: an empty text means "keep" (the name alone changes)
    if user_id == admin.user_id && email.trim().is_empty() {
        mosaikit_db::query("update core.users set display_name = $2 where id = $1")
            .bind(user_id)
            .bind(name)
            .execute(&k.db)
            .await?;
        events::record(
            k,
            None,
            Some(admin.user_id),
            None,
            None,
            "admin.update",
            json!({ "username": username }),
        )
        .await;
        return Ok(());
    }
    let email = crate::notify::required_email(email)?.to_lowercase();
    let current: Option<String> = mosaikit_db::query_scalar("select email from core.users where id = $1")
        .bind(user_id)
        .fetch_one(&k.db)
        .await?;
    let changed = current.as_deref().map(str::to_lowercase).as_deref() != Some(email.as_str());
    if changed {
        if user_id == admin.user_id {
            return Err(Error::forbidden("change your own email from the Account page, with your password")
                .with_code("own_email_reauth"));
        }
        ensure_email_free(k, &email, Some(user_id)).await?;
    }
    mosaikit_db::query("update core.users set display_name = $2, email = $3 where id = $1")
        .bind(user_id)
        .bind(name)
        .bind(&email)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        "admin.update",
        json!({ "username": username, "user": user_id, "email_changed": changed }),
    )
    .await;
    Ok(())
}

/// An Administrator changes their own email: needs the current password and, if the second
/// factor is on, a code of the app. Required and unique.
pub async fn change_my_email(
    k: &Kernel,
    admin: &SessionUser,
    email: &str,
    password: &str,
    code: Option<&str>,
) -> Result<()> {
    require_admin(admin)?;
    let email = crate::notify::required_email(email)?.to_lowercase();
    crate::identity::confirm_sensitive(k, admin, password, code).await?;
    ensure_email_free(k, &email, Some(admin.user_id)).await?;
    mosaikit_db::query("update core.users set email = $2 where id = $1")
        .bind(admin.user_id)
        .bind(&email)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        "admin.email_change",
        json!({ "user": admin.user_id }),
    )
    .await;
    Ok(())
}
