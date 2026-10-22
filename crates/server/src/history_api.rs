//! REST API of shares, trash and log (see `docs/architecture.md`, "Shares, trash and log"):
//! - shares: what I shared (Home), revoking every share and link of an item, the bulk revoke of the
//!   Tenant Manager on the Shares page;
//! - trash: list, restore, delete for good, empty;
//! - log: the events of a tenant (its manager) or of the platform (an Administrator), as pages or CSV.

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderValue};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use mosaikit_kernel::log::{self, LogFilter, Scope};
use mosaikit_kernel::{acl, trash};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::api::{ok, uuid};
use crate::auth::{Auth, Tenant};
use crate::{bad, ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        // shares
        .route("/api/t/{t}/me/shared", get(shared_by_me))
        .route("/api/t/{t}/resources/{rid}/revoke-all", post(revoke_all))
        .route("/api/t/{t}/manage/resources/revoke", post(m_revoke))
        // trash
        .route("/api/t/{t}/trash", get(trash_list))
        .route("/api/t/{t}/trash/empty", post(trash_empty))
        .route("/api/t/{t}/trash/{id}/restore", post(trash_restore))
        .route("/api/t/{t}/trash/{id}", delete(trash_purge))
        // log
        .route("/api/t/{t}/manage/log", get(m_log))
        .route("/api/t/{t}/manage/log.csv", get(m_log_csv))
        .route("/api/admin/log", get(a_log))
        .route("/api/admin/log.csv", get(a_log_csv))
}

// ------------------------------------------------------------------ shares

async fn shared_by_me(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(acl::shared_by_me(&s.k, &c).await?)))
}

async fn revoke_all(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, rid)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(acl::revoke_all(&s.k, &c, uuid(&rid)?).await?)))
}

#[derive(Deserialize)]
struct IdsReq {
    ids: Vec<Uuid>,
}

/// The Tenant Manager revokes shares and links of several items at once (at most 500).
async fn m_revoke(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<IdsReq>,
) -> ApiResult<Json<Value>> {
    c.require_manager()?;
    if r.ids.len() > 500 {
        return Err(bad("at most 500 items at a time"));
    }
    let mut total = acl::Revoked::default();
    for id in r.ids {
        let one = acl::revoke_all(&s.k, &c, id).await?;
        total.shares += one.shares;
        total.links += one.links;
    }
    Ok(Json(json!(total)))
}

// ------------------------------------------------------------------ trash

#[derive(Deserialize)]
struct TrashQuery {
    plugin: Option<String>,
    q: Option<String>,
}

async fn trash_list(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(q): Query<TrashQuery>,
) -> ApiResult<Json<Value>> {
    let items = trash::list(&s.k, &c, q.plugin.as_deref(), q.q.as_deref()).await?;
    Ok(Json(json!({ "items": items, "retention_days": trash::retention_days(&s.k).await })))
}

async fn trash_restore(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    trash::restore(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

async fn trash_purge(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    trash::purge(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

async fn trash_empty(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "deleted": trash::empty(&s.k, &c).await? })))
}

// ------------------------------------------------------------------ log

async fn m_log(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(f): Query<LogFilter>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(log::page(&s.k, Scope::Tenant(&c), &f).await?)))
}

async fn a_log(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(f): Query<LogFilter>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(log::page(&s.k, Scope::Platform(&u), &f).await?)))
}

fn csv_response(body: String, name: &str) -> Response {
    let mut res = body.into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/csv; charset=utf-8"));
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{name}\"")) {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

async fn m_log_csv(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(f): Query<LogFilter>,
) -> ApiResult<Response> {
    let body = log::csv(&s.k, Scope::Tenant(&c), &f).await?;
    Ok(csv_response(body, &format!("log-{}.csv", c.tenant.slug)))
}

async fn a_log_csv(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(f): Query<LogFilter>,
) -> ApiResult<Response> {
    let body = log::csv(&s.k, Scope::Platform(&u), &f).await?;
    Ok(csv_response(body, "log-platform.csv"))
}
