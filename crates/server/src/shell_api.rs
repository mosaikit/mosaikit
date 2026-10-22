//! REST API of the shell itself (docs/architecture.md, "Search, help and themes"): the search of the top
//! bar, the preferences that follow a person everywhere (high contrast, guided tours seen) and the
//! themes made with the theme editor.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{get, put};
use axum::{Json, Router};
use mosaikit_kernel::personal::{self, PrefsChange};
use mosaikit_kernel::search;
use mosaikit_kernel::tenancy::themes::{self, ThemeInput};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{ok, request_lang};
use crate::auth::{Auth, Tenant};
use crate::{ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/t/{t}/search", get(tenant_search))
        .route("/api/admin/search", get(admin_search))
        .route("/api/me/prefs", get(my_prefs).put(set_my_prefs))
        .route("/api/auth/themes", get(public_themes))
        .route("/api/admin/themes", get(a_themes).post(a_save_theme))
        .route("/api/admin/themes/{id}", put(a_save_theme_id).delete(a_delete_theme))
        .route("/api/admin/themes-allowed", put(a_set_allowed))
        .route("/api/t/{t}/themes", get(t_themes))
        .route("/api/t/{t}/manage/themes", axum::routing::post(m_save_theme))
        .route("/api/t/{t}/manage/themes/{id}", put(m_save_theme_id).delete(m_delete_theme))
}

fn q_of(q: &HashMap<String, String>) -> &str {
    q.get("q").map(String::as_str).unwrap_or_default()
}

async fn tenant_search(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    h: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(search::search(&s.k, &c, q_of(&q), &request_lang(&h)).await?)))
}

async fn admin_search(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(search::admin_search(&s.k, &u, q_of(&q)).await?)))
}

async fn my_prefs(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(personal::get(&s.k, u.user_id).await?)))
}

async fn set_my_prefs(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(ch): Json<PrefsChange>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(personal::change(&s.k, u.user_id, &ch).await?)))
}

async fn public_themes(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(json!(themes::public(&s.k).await?)))
}

async fn a_themes(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    mosaikit_kernel::tenancy::require_admin(&u)?;
    Ok(Json(json!({
        "themes": themes::platform_themes(&s.k).await?,
        "allowed": themes::allowed(&s.k).await?,
        "built_in": themes::BUILT_IN,
    })))
}

async fn a_save_theme(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(mut t): Json<ThemeInput>,
) -> ApiResult<Json<Value>> {
    t.id = None;
    Ok(Json(json!(themes::save_platform(&s.k, &u, &t).await?)))
}

async fn a_save_theme_id(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(mut t): Json<ThemeInput>,
) -> ApiResult<Json<Value>> {
    t.id = Some(id);
    Ok(Json(json!(themes::save_platform(&s.k, &u, &t).await?)))
}

async fn a_delete_theme(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    themes::delete_platform(&s.k, &u, &id).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct AllowedReq {
    /// null: every theme
    allowed: Option<Vec<String>>,
}

async fn a_set_allowed(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<AllowedReq>,
) -> ApiResult<Json<Value>> {
    themes::set_allowed(&s.k, &u, r.allowed).await?;
    Ok(ok())
}

async fn t_themes(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!({
        "themes": themes::for_tenant(&s.k, c.tenant.tenant_id).await?,
        "allowed": themes::allowed(&s.k).await?,
    })))
}

async fn m_save_theme(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(mut t): Json<ThemeInput>,
) -> ApiResult<Json<Value>> {
    t.id = None;
    Ok(Json(json!(themes::save_tenant(&s.k, &c, &t).await?)))
}

#[derive(Deserialize)]
struct TenantThemePath {
    #[allow(dead_code)]
    t: String,
    id: String,
}

async fn m_save_theme_id(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<TenantThemePath>,
    Json(mut t): Json<ThemeInput>,
) -> ApiResult<Json<Value>> {
    t.id = Some(p.id);
    Ok(Json(json!(themes::save_tenant(&s.k, &c, &t).await?)))
}

async fn m_delete_theme(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<TenantThemePath>,
) -> ApiResult<Json<Value>> {
    themes::delete_tenant(&s.k, &c, &p.id).await?;
    Ok(ok())
}
