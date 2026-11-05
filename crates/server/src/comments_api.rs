//! REST API of the comments on resources (see `docs/architecture.md`, "Comments on resources"). The
//! session, its CSRF header and the membership are checked by `Tenant`; the right on the resource by the kernel.

use axum::extract::{Path, State};
use axum::routing::{delete, get};
use axum::{Json, Router};
use mosaikit_kernel::comments;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{ok, uuid};
use crate::auth::Tenant;
use crate::{ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/t/{t}/resources/{id}/comments", get(list).post(add))
        .route("/api/t/{t}/resources/{id}/comments/{cid}", delete(remove))
}

async fn list(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(comments::list(&s.k, &c, uuid(&id)?).await?)))
}

#[derive(Deserialize)]
struct Add {
    body: String,
}

async fn add(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
    Json(req): Json<Add>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(comments::add(&s.k, &c, uuid(&id)?, &req.body).await?)))
}

async fn remove(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id, cid)): Path<(String, String, String)>,
) -> ApiResult<Json<Value>> {
    comments::delete(&s.k, &c, uuid(&id)?, uuid(&cid)?).await?;
    Ok(ok())
}
