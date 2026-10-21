//! Policy del tenant (Tenant Manager) e preferenze dell'utente nel tenant.

use serde_json::{json, Value};

use crate::{events, Caller, Error, Kernel, Result, TenantSettings};

pub async fn set_settings(k: &Kernel, c: &Caller, s: &TenantSettings) -> Result<()> {
    c.require_manager()?;
    if s.public_link_max_days > 3650 {
        return Err(Error::bad("durata massima dei link: al massimo 3650 giorni"));
    }
    mosaikit_db::query("update core.tenants set settings = $2 where id = $1")
        .bind(c.tenant.tenant_id)
        .bind(serde_json::to_value(s)?)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "tenant.settings",
        serde_json::to_value(s)?,
    )
    .await;
    Ok(())
}

pub async fn prefs(k: &Kernel, c: &Caller) -> Result<Value> {
    let p: Option<Value> =
        mosaikit_db::query_scalar("select prefs from core.user_prefs where user_id = $1 and tenant_id = $2")
            .bind(c.user.user_id)
            .bind(c.tenant.tenant_id)
            .fetch_optional(&k.db)
            .await?;
    Ok(p.unwrap_or_else(|| json!({})))
}

pub async fn set_prefs(k: &Kernel, c: &Caller, prefs: &Value) -> Result<()> {
    if !prefs.is_object() || prefs.to_string().len() > 16 * 1024 {
        return Err(Error::bad("preferenze non valide"));
    }
    mosaikit_db::query(
        "insert into core.user_prefs (user_id, tenant_id, prefs) values ($1, $2, $3)
         on conflict (user_id, tenant_id) do update set prefs = excluded.prefs",
    )
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .bind(prefs)
    .execute(&k.db)
    .await?;
    Ok(())
}
