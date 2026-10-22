//! REST API of the plugins in the tenants: availability (Administrator), on and off (Tenant Manager),
//! settings of a plugin, what uninstalling takes away, and the fields and actions of the extensions
//! (see `docs/architecture.md`, "Plugins in the tenants" and "Extensions").

use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use mosaikit_kernel::crud::Values;
use mosaikit_kernel::plugins::{self, config, extensions, tenants};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::api::{ok, request_lang, uuid};
use crate::auth::{Auth, Tenant};
use crate::{ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        // Administrator
        .route("/api/admin/plugins/{id}/tenants", get(a_tenants))
        .route("/api/admin/plugins/{id}/tenants/{tid}", put(a_set_available))
        .route("/api/admin/plugins/{id}/default", put(a_set_default))
        .route("/api/admin/plugins/{id}/config", get(a_config).put(a_set_config))
        .route("/api/admin/plugins/{id}/impact", get(a_impact))
        .route("/api/admin/tenants/{tid}/plugins", get(a_tenant_plugins))
        // Tenant Manager
        .route("/api/t/{t}/manage/plugins", get(m_plugins))
        .route("/api/t/{t}/manage/plugins/{plugin}/on", put(m_set_on))
        // every member: extensions of a plugin
        .route("/api/t/{t}/p/{plugin}/ext/{res}", get(ext_list))
        .route("/api/t/{t}/p/{plugin}/ext/{res}/values", post(ext_values))
        .route("/api/t/{t}/p/{plugin}/ext/{res}/{id}/{ext}", put(ext_set))
        .route("/api/t/{t}/p/{plugin}/ext/{res}/{id}/{ext}/{action}", post(ext_action))
}

// ------------------------------------------------------------------ Administrator

async fn a_tenants(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let (default, list) = tenants::plugin_tenants(&s.k, &u, &id).await?;
    Ok(Json(json!({ "default": default, "tenants": list })))
}

#[derive(Deserialize)]
struct Available {
    /// `null`: back to the default of the plugin
    available: Option<bool>,
}

async fn a_set_available(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path((id, tid)): Path<(String, String)>,
    Json(r): Json<Available>,
) -> ApiResult<Json<Value>> {
    tenants::set_available(&s.k, &u, &id, uuid(&tid)?, r.available).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct Default {
    available: bool,
}

async fn a_set_default(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(r): Json<Default>,
) -> ApiResult<Json<Value>> {
    tenants::set_available_default(&s.k, &u, &id, r.available).await?;
    Ok(ok())
}

async fn a_config(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(config::config(&s.k, &u, &id, &request_lang(&h)).await?)))
}

async fn a_set_config(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    h: HeaderMap,
    Json(r): Json<config::ConfigChange>,
) -> ApiResult<Json<Value>> {
    config::set_config(&s.k, &u, &id, &r).await?;
    Ok(Json(json!(config::config(&s.k, &u, &id, &request_lang(&h)).await?)))
}

async fn a_tenant_plugins(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(tid): Path<String>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenants::of_tenant(&s.k, &u, uuid(&tid)?, &request_lang(&h)).await?)))
}

async fn a_impact(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(plugins::uninstall_impact(&s.k, &u, &id).await?)))
}

// ------------------------------------------------------------------ Tenant Manager

async fn m_plugins(State(s): State<AppState>, Tenant(c): Tenant, h: HeaderMap) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenants::tenant_plugins(&s.k, &c, &request_lang(&h)).await?)))
}

#[derive(Deserialize)]
struct On {
    on: bool,
}

async fn m_set_on(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, plugin)): Path<(String, String)>,
    h: HeaderMap,
    Json(r): Json<On>,
) -> ApiResult<Json<Value>> {
    tenants::set_enabled(&s.k, &c, &plugin, r.on).await?;
    Ok(Json(json!(tenants::tenant_plugins(&s.k, &c, &request_lang(&h)).await?)))
}

// ------------------------------------------------------------------ extensions

async fn ext_list(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, plugin, res)): Path<(String, String, String)>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(extensions::for_resource(&s.k, &c, &plugin, &res, &request_lang(&h)).await?)))
}

#[derive(Deserialize)]
struct Ids {
    ids: Vec<String>,
}

async fn ext_values(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, plugin, res)): Path<(String, String, String)>,
    Json(r): Json<Ids>,
) -> ApiResult<Json<Value>> {
    let ids = r.ids.iter().map(|i| uuid(i)).collect::<ApiResult<Vec<Uuid>>>()?;
    let out: HashMap<String, _> = extensions::values(&s.k, &c, &plugin, &res, &ids)
        .await?
        .into_iter()
        .map(|(id, v)| (id.to_string(), v))
        .collect();
    Ok(Json(json!(out)))
}

#[derive(Deserialize)]
struct ExtValues {
    values: Values,
}

async fn ext_set(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, plugin, res, id, ext)): Path<(String, String, String, String, String)>,
    Json(r): Json<ExtValues>,
) -> ApiResult<Json<Value>> {
    let v = extensions::set_values(&s.k, &c, &plugin, &res, uuid(&id)?, &ext, &r.values).await?;
    Ok(Json(json!({ "values": v })))
}

async fn ext_action(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, plugin, res, id, ext, action)): Path<(String, String, String, String, String, String)>,
) -> ApiResult<Json<Value>> {
    let v = extensions::run_action(&s.k, &c, &plugin, &res, uuid(&id)?, &ext, &action).await?;
    Ok(Json(json!({ "values": v })))
}
