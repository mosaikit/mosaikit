//! REST API of the schedules (see `docs/architecture.md`, "Schedules"): the registry of the jobs a person
//! put on a timetable. The session, its CSRF header and the membership are checked by `Tenant`.

use axum::extract::{Path, Query, State};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use mosaikit_kernel::schedules::{self, CreateRequest, PatchRequest};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{ok, uuid};
use crate::auth::Tenant;
use crate::{ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/t/{t}/schedules", post(create).get(list))
        .route("/api/t/{t}/schedules/timezone", get(timezone))
        .route("/api/t/{t}/schedules/{id}", delete(remove).patch(update))
        .route("/api/t/{t}/schedules/{id}/pause", post(pause))
        .route("/api/t/{t}/schedules/{id}/resume", post(resume))
        .route("/api/t/{t}/schedules/{id}/run", post(run_now))
        .route("/api/t/{t}/schedules/{id}/take-over", post(take_over))
        .route("/api/t/{t}/schedules/{id}/runs", get(runs))
}

async fn create(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(req): Json<CreateRequest>,
) -> ApiResult<Json<Value>> {
    let made = schedules::create(&s.k, &c, &req).await?;
    Ok(Json(json!(made)))
}

#[derive(Deserialize)]
struct ListQuery {
    plugin: Option<String>,
}

async fn list(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<Value>> {
    let rows = schedules::list(&s.k, &c, q.plugin.as_deref().filter(|p| !p.is_empty())).await?;
    Ok(Json(json!(rows)))
}

async fn update(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
    Query(q): Query<PluginQ>,
    Json(req): Json<PatchRequest>,
) -> ApiResult<Json<Value>> {
    guard(&s, &c, &id, &q).await?;
    Ok(Json(json!(schedules::update(&s.k, &c, uuid(&id)?, &req).await?)))
}

async fn pause(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
    Query(q): Query<PluginQ>,
) -> ApiResult<Json<Value>> {
    guard(&s, &c, &id, &q).await?;
    schedules::pause(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

async fn resume(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
    Query(q): Query<PluginQ>,
) -> ApiResult<Json<Value>> {
    guard(&s, &c, &id, &q).await?;
    schedules::resume(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

async fn remove(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
    Query(q): Query<PluginQ>,
) -> ApiResult<Json<Value>> {
    guard(&s, &c, &id, &q).await?;
    schedules::delete(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

async fn run_now(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
    Query(q): Query<PluginQ>,
) -> ApiResult<Json<Value>> {
    guard(&s, &c, &id, &q).await?;
    let run = schedules::run_now(&s.k, &c, uuid(&id)?).await?;
    Ok(Json(json!(run)))
}

async fn take_over(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    schedules::take_over(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

async fn runs(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
    Query(q): Query<PluginQ>,
) -> ApiResult<Json<Value>> {
    guard(&s, &c, &id, &q).await?;
    let rows = schedules::runs(&s.k, &c, uuid(&id)?).await?;
    Ok(Json(json!(rows)))
}

/// `?plugin=<id>` on the routes of one schedule: the schedule must belong to that plugin. The shell adds it for a
/// page of a plugin (`msk.schedules`), so the page reaches the schedules of its own plugin only.
#[derive(Deserialize, Default)]
struct PluginQ {
    plugin: Option<String>,
}

async fn guard(s: &AppState, c: &mosaikit_kernel::Caller, id: &str, q: &PluginQ) -> ApiResult<()> {
    if let Some(p) = q.plugin.as_deref().filter(|p| !p.is_empty()) {
        schedules::ensure_plugin(&s.k, c, uuid(id)?, p).await?;
    }
    Ok(())
}

async fn timezone(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "time_zone": schedules::tenant_time_zone(&s.k, c.tenant.tenant_id).await })))
}
