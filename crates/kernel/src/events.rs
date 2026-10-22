//! Event log (the Log pages, the activity of a person, the activity KPIs).
//!
//! The server runs every request inside [`with_request`], so the events of the request carry its address
//! and browser; the background work records them without.

use serde_json::Value;
use uuid::Uuid;

use crate::Kernel;

/// Who sent the request that causes an event.
#[derive(Debug, Clone, Default)]
pub struct RequestInfo {
    pub ip: Option<String>,
    pub agent: Option<String>,
}

tokio::task_local! {
    static REQUEST: RequestInfo;
}

/// Runs `f` with the address and the browser of the current request, for the events it records.
pub async fn with_request<F: std::future::Future>(info: RequestInfo, f: F) -> F::Output {
    REQUEST.scope(info, f).await
}

/// Records an event. An error here must never make the operation fail.
pub async fn record(
    k: &Kernel,
    tenant: Option<Uuid>,
    user: Option<Uuid>,
    plugin: Option<&str>,
    resource: Option<Uuid>,
    action: &str,
    detail: Value,
) {
    insert(k, tenant, user, plugin, resource, action, detail, true).await
}

/// Records a refused operation (a failed sign-in, a wrong code): `ok` is false in the Log.
pub async fn record_failure(
    k: &Kernel,
    tenant: Option<Uuid>,
    user: Option<Uuid>,
    action: &str,
    detail: Value,
) {
    insert(k, tenant, user, None, None, action, detail, false).await
}

#[allow(clippy::too_many_arguments)]
async fn insert(
    k: &Kernel,
    tenant: Option<Uuid>,
    user: Option<Uuid>,
    plugin: Option<&str>,
    resource: Option<Uuid>,
    action: &str,
    detail: Value,
    ok: bool,
) {
    let req = REQUEST.try_with(Clone::clone).unwrap_or_default();
    let clip = |s: Option<String>, n: usize| s.map(|s| s.chars().take(n).collect::<String>());
    let r = mosaikit_db::query(
        "insert into core.events (tenant_id, user_id, plugin_id, resource_id, action, detail, ok, ip, agent)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(tenant)
    .bind(user)
    .bind(plugin)
    .bind(resource)
    .bind(action)
    .bind(detail)
    .bind(ok)
    .bind(clip(req.ip, 64))
    .bind(clip(req.agent, 300))
    .execute(&k.db)
    .await;
    if let Err(e) = r {
        tracing::warn!("event {action} not recorded: {e}");
    }
}
