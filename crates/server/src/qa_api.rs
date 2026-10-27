//! REST API of the follow-ups of the QA walkthrough (docs/reports/mockup-vs-product.md): import of people
//! and invitations of several people at once (Tenant Manager), asking for a plugin, details of a tenant
//! (Administrator).

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use mosaikit_kernel::tenancy::bulk::{self, ImportRow, TenantDetails};
use mosaikit_kernel::Role;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::api::uuid;
use crate::auth::{Auth, Tenant};
use crate::{ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/t/{t}/manage/people/import", post(m_import))
        .route("/api/t/{t}/manage/invitations/many", post(m_invite_many))
        .route("/api/t/{t}/manage/plugins/ask", post(m_ask))
        .route("/api/admin/tenants/{id}/details", get(a_details).put(a_set_details))
}

#[derive(Deserialize)]
struct ImportReq {
    rows: Vec<ImportRow>,
}

async fn m_import(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<ImportReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(bulk::import_people(&s.k, &c, &r.rows).await?)))
}

#[derive(Deserialize)]
struct InviteManyReq {
    people: Vec<String>,
    role: Role,
    #[serde(default)]
    profile: Option<Uuid>,
}

async fn m_invite_many(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<InviteManyReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(bulk::invite_many(&s.k, &c, &r.people, r.role, r.profile).await?)))
}

#[derive(Deserialize)]
struct AskReq {
    text: String,
}

async fn m_ask(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<AskReq>,
) -> ApiResult<Json<Value>> {
    bulk::ask_for_plugin(&s.k, &c, &r.text).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn a_details(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(bulk::tenant_details(&s.k, &u, uuid(&id)?).await?)))
}

async fn a_set_details(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(d): Json<TenantDetails>,
) -> ApiResult<Json<Value>> {
    let id = uuid(&id)?;
    bulk::set_tenant_details(&s.k, &u, id, &d).await?;
    Ok(Json(json!(bulk::tenant_details(&s.k, &u, id).await?)))
}
