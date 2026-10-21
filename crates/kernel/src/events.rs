//! Registro eventi (audit e KPI di attivita').

use serde_json::Value;
use uuid::Uuid;

use crate::Kernel;

/// Registra un evento. Un errore qui non deve mai far fallire l'operazione.
pub async fn record(
    k: &Kernel,
    tenant: Option<Uuid>,
    user: Option<Uuid>,
    plugin: Option<&str>,
    resource: Option<Uuid>,
    action: &str,
    detail: Value,
) {
    let r = mosaikit_db::query(
        "insert into core.events (tenant_id, user_id, plugin_id, resource_id, action, detail)
         values ($1, $2, $3, $4, $5, $6)",
    )
    .bind(tenant)
    .bind(user)
    .bind(plugin)
    .bind(resource)
    .bind(action)
    .bind(detail)
    .execute(&k.db)
    .await;
    if let Err(e) = r {
        tracing::warn!("evento {action} non registrato: {e}");
    }
}
