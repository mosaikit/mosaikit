//! API of the developer profile (`developer_profile = true`): the test accounts for the sign-in page, the
//! manifest as the server reads it, the reset of the data of a plugin and the switch of test users.
//! The router is added to the app only while the profile is on (see `app_router`): a normal server answers
//! 404 to every address here, as to any unknown one.

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use mosaikit_kernel::devprofile::{self, PASSWORD, TENANT, USERS};
use mosaikit_kernel::Error;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{logged_in, ok};
use crate::auth::{Auth, ClientIp};
use crate::{ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/dev/info", get(info))
        .route("/api/dev/plugins/{id}/manifest", get(manifest))
        .route("/api/dev/plugins/{id}/reset", post(reset))
        .route("/api/dev/switch-user", post(switch_user))
}

/// The accounts and the password of the profile (public: the sign-in page lists them), and the plugins
/// loaded from folders.
async fn info(State(s): State<AppState>) -> Json<Value> {
    let plugins: Vec<Value> =
        s.k.plugins
            .list()
            .iter()
            .filter(|p| p.dev)
            .map(|p| json!({ "id": p.id, "version": p.manifest.version }))
            .collect();
    Json(json!({
        "tenant": TENANT,
        "password": PASSWORD,
        "users": USERS,
        "plugins": plugins,
        "app_url": s.k.cfg.app_url,
    }))
}

/// The manifest as the server reads it (after the defaults and the checks), with the state of the plugin.
async fn manifest(
    State(s): State<AppState>,
    Auth(_u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let p = s.k.plugins.get(&id).ok_or_else(|| Error::not_found(format!("plugin not installed: {id}")))?;
    Ok(Json(json!({
        "id": p.id,
        "dev": p.dev,
        "status": p.status,
        "sha256": p.sha256,
        "has_logic": p.module.is_some(),
        "ui_dir": p.ui_dir.as_ref().map(|d| d.display().to_string()),
        "manifest": serde_json::to_value(&p.manifest).map_err(|e| Error::internal(e.to_string()))?,
    })))
}

/// Deletes the data of a plugin loaded from a folder and runs its migrations again.
async fn reset(State(s): State<AppState>, Auth(_u): Auth, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    devprofile::reset_plugin(&s.k, &id).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct SwitchReq {
    username: String,
}

/// A session of another test user, without the password (the cookie of the current session is replaced).
async fn switch_user(
    State(s): State<AppState>,
    Auth(u): Auth,
    ClientIp(ip): ClientIp,
    Json(r): Json<SwitchReq>,
) -> ApiResult<axum::response::Response> {
    let lr = devprofile::session_for(&s.k, &r.username, &ip).await?;
    mosaikit_kernel::identity::logout(&s.k, &u).await?;
    logged_in(&s, lr, json!({})).await
}
