//! Administrator: account del tenant di sistema, gestiti solo da altri Administrator.
//! Creazione, disabilitazione (ne resta sempre almeno uno attivo), reset di password e
//! secondo fattore. Il ruolo non si assegna agli utenti dei tenant: chi e' anche
//! Tenant Manager o User di un tenant ha un account separato la'.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::require_admin;
use crate::identity::{check_password_policy, hash_password, valid_username};
use crate::{events, Error, Kernel, Result, SessionUser};

/// Account Administrator.
#[derive(Debug, Clone, Serialize)]
pub struct AdminInfo {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub status: String,
    /// secondo fattore registrato
    pub totp: bool,
    pub created_at: DateTime<Utc>,
}

pub async fn administrators(k: &Kernel, admin: &SessionUser) -> Result<Vec<AdminInfo>> {
    require_admin(admin)?;
    let rows = mosaikit_db::query(
        "select u.id, u.username, u.display_name, u.status, u.totp_enabled, u.created_at
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
            status: r.get(3),
            totp: r.get(4),
            created_at: r.get(5),
        })
        .collect())
}

/// Nuovo Administrator (al primo accesso registra il secondo fattore, se richiesto).
pub async fn create_administrator(
    k: &Kernel,
    admin: &SessionUser,
    username: &str,
    display_name: &str,
    password: &str,
) -> Result<Uuid> {
    require_admin(admin)?;
    let username = username.trim().to_lowercase();
    if !valid_username(&username) {
        return Err(Error::bad("username non valido: minuscole, cifre, '.', '-', '_' (2-64)"));
    }
    check_password_policy(password)?;
    let hash = hash_password(k, password).await?;
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.users (home_tenant_id, username, display_name, password_hash, is_system_admin)
         select id, $1, $2, $3, true from core.tenants where is_system returning id",
    )
    .bind(&username)
    .bind(display_name.trim())
    .bind(hash)
    .fetch_one(&k.db)
    .await
    .map_err(|e| match Error::from(e) {
        err if err.kind == crate::Kind::Conflict => {
            Error::conflict(format!("esiste gia' un Administrator '{username}'"))
        }
        err => err,
    })?;
    events::record(k, None, Some(admin.user_id), None, None, "admin.create", json!({ "username": username }))
        .await;
    Ok(id)
}

/// Id dell'Administrator `user_id` (errore se non e' un account del tenant di sistema).
async fn administrator(k: &Kernel, user_id: Uuid) -> Result<String> {
    let name: Option<String> = mosaikit_db::query_scalar(
        "select u.username from core.users u join core.tenants t on t.id = u.home_tenant_id
         where u.id = $1 and t.is_system and u.is_system_admin",
    )
    .bind(user_id)
    .fetch_optional(&k.db)
    .await?;
    name.ok_or_else(|| Error::not_found("Administrator non trovato"))
}

/// Disabilita o riattiva un Administrator. Resta sempre almeno un Administrator attivo;
/// disabilitato, perde subito le sessioni aperte.
pub async fn set_administrator_active(
    k: &Kernel,
    admin: &SessionUser,
    user_id: Uuid,
    active: bool,
) -> Result<()> {
    require_admin(admin)?;
    let username = administrator(k, user_id).await?;
    let mut tx = k.db.begin_app().await?;
    // serializza le modifiche concorrenti (mai zero amministratori)
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
            return Err(Error::conflict("deve restare almeno un Administrator attivo"));
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

/// Nuova password per un altro Administrator (le sue sessioni vengono chiuse).
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

/// Toglie il secondo fattore di un Administrator (telefono perso): al prossimo accesso
/// registra di nuovo l'app.
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
