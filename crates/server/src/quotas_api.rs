//! REST API of the quotas (docs/architecture.md, "Quotas and usage"): the Administrator sets them, the
//! Tenant Manager reads them with the trend, who uses the most and the alerts, every member sees their
//! own usage and the alert of the sidebar.

use std::collections::BTreeMap;

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use mosaikit_kernel::quotas::{self, Alerts, OwnQuota, PlatformLimits};
use mosaikit_kernel::tenancy::require_admin;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::uuid;
use crate::auth::{Auth, Tenant};
use crate::{ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        // Administrator
        .route("/api/admin/quotas", get(a_quotas).put(a_set_quotas))
        .route("/api/admin/tenants/{id}/quotas", get(a_tenant_quotas).put(a_set_tenant_quotas))
        // Tenant Manager
        .route("/api/t/{t}/manage/quotas", get(m_quotas))
        .route("/api/t/{t}/manage/usage/trend", get(m_trend))
        .route("/api/t/{t}/manage/usage/consumers", get(m_consumers))
        .route("/api/t/{t}/manage/usage/alerts", get(m_alerts).put(m_set_alerts))
        // every member
        .route("/api/t/{t}/usage/mine", get(my_usage))
        .route("/api/t/{t}/usage/near", get(near))
}

async fn a_quotas(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::platform(&s.k, &u).await?)))
}

async fn a_set_quotas(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(l): Json<PlatformLimits>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::set_platform(&s.k, &u, l).await?)))
}

async fn a_tenant_quotas(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&u)?;
    Ok(Json(json!(quotas::tenant(&s.k, uuid(&id)?).await?)))
}

async fn a_set_tenant_quotas(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(c): Json<BTreeMap<String, OwnQuota>>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::set_tenant(&s.k, &u, uuid(&id)?, &c).await?)))
}

async fn m_quotas(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    c.require_manager()?;
    Ok(Json(json!(quotas::tenant(&s.k, c.tenant.tenant_id).await?)))
}

#[derive(Deserialize)]
struct Days {
    days: Option<i64>,
}

async fn m_trend(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(q): Query<Days>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::trend(&s.k, &c, q.days.unwrap_or(180)).await?)))
}

async fn m_consumers(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::consumers(&s.k, &c).await?)))
}

async fn m_alerts(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::alerts(&s.k, &c).await?)))
}

async fn m_set_alerts(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(a): Json<Alerts>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::set_alerts(&s.k, &c, a).await?)))
}

async fn my_usage(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::mine(&s.k, &c).await?)))
}

async fn near(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(quotas::near(&s.k, &c).await?)))
}
