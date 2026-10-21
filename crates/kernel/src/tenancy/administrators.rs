//! Ruolo di sistema Administrator: elenco, assegnazione e revoca (ne resta sempre almeno uno attivo).

use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::require_admin;
use crate::{events, Error, Kernel, Result, SessionUser};

/// Utente con il ruolo di sistema Administrator.
#[derive(Debug, Clone, Serialize)]
pub struct AdminInfo {
    pub user_id: Uuid,
    pub tenant: String,
    pub username: String,
    pub display_name: String,
    pub status: String,
}

pub async fn administrators(k: &Kernel, admin: &SessionUser) -> Result<Vec<AdminInfo>> {
    require_admin(admin)?;
    let rows = mosaikit_db::query(
        "select u.id, t.slug, u.username, u.display_name, u.status from core.users u
         join core.tenants t on t.id = u.home_tenant_id where u.is_system_admin order by t.slug, u.username",
    )
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| AdminInfo {
            user_id: r.get(0),
            tenant: r.get(1),
            username: r.get(2),
            display_name: r.get(3),
            status: r.get(4),
        })
        .collect())
}

/// Assegna o toglie il ruolo Administrator a `<tenant>/<username>`. Resta sempre
/// almeno un Administrator attivo.
pub async fn set_administrator(
    k: &Kernel,
    admin: &SessionUser,
    tenant: &str,
    username: &str,
    on: bool,
) -> Result<()> {
    require_admin(admin)?;
    let mut tx = k.db.begin_app().await?;
    // serializza le modifiche concorrenti (mai zero amministratori)
    mosaikit_db::query("select pg_advisory_xact_lock(hashtext('mosaikit.administrators'))")
        .execute(&mut *tx)
        .await?;
    let row = mosaikit_db::query(
        "select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id
         where t.slug = $1 and u.username = $2",
    )
    .bind(tenant)
    .bind(username)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| Error::not_found(format!("utente {tenant}/{username} inesistente")))?;
    let id: Uuid = row.get(0);
    if !on {
        let others: i64 = mosaikit_db::query_scalar(
            "select count(*) from core.users where is_system_admin and status = 'active' and id <> $1",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if others == 0 {
            return Err(Error::conflict("deve restare almeno un Administrator attivo"));
        }
    }
    mosaikit_db::query("update core.users set is_system_admin = $2 where id = $1")
        .bind(id)
        .bind(on)
        .execute(&mut *tx)
        .await?;
    if !on {
        // le sessioni aperte perdono subito i privilegi
        mosaikit_db::query("delete from core.sessions where user_id = $1").bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        if on { "admin.grant" } else { "admin.revoke" },
        json!({ "user": id, "tenant": tenant, "username": username }),
    )
    .await;
    Ok(())
}
