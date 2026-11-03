//! REST API of the schedules (see `docs/architecture.md`, "Schedules"): the registry of the jobs a person
//! put on a timetable. The session, its CSRF header and the membership are checked by `Tenant`.

use axum::extract::{Path, Query, State};
use axum::routing::{delete, post};
use axum::{Json, Router};
use mosaikit_kernel::schedules::{self, CreateRequest};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{ok, uuid};
use crate::auth::Tenant;
use crate::{ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/t/{t}/schedules", post(create).get(list))
        .route("/api/t/{t}/schedules/{id}", delete(remove))
        .route("/api/t/{t}/schedules/{id}/pause", post(pause))
        .route("/api/t/{t}/schedules/{id}/resume", post(resume))
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

async fn pause(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    schedules::pause(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

async fn resume(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    schedules::resume(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

async fn remove(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    schedules::delete(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}
