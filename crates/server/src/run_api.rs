//! REST API of the run tickets (see `docs/architecture.md`, "Run tickets"): the person who starts a run
//! mints a ticket with their session; the service redeems it, with no cookie, on every call.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, post};
use axum::{Json, Router};
use mosaikit_kernel::run_tickets::{self, MintRequest};
use serde_json::{json, Value};

use crate::api::{ok, uuid};
use crate::auth::Tenant;
use crate::{bad, ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/t/{t}/run-tickets", post(mint))
        .route("/api/t/{t}/run-tickets/{id}", delete(revoke))
        .route("/api/run/{ticket}/call/{plugin}/{command}", post(call).options(preflight))
        .route("/api/run/{ticket}", delete(finish))
}

/// The frame of an embedded page has no origin of its own (a sandbox without `allow-same-origin`) and calls with its ticket:
/// the call is cross-origin and its `Content-Type: application/json` asks for a preflight. The ticket is the only credential
/// (no cookie is ever sent), so any origin may carry it.
async fn preflight() -> Response {
    let mut res = StatusCode::NO_CONTENT.into_response();
    let h = res.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("POST"));
    h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("content-type"));
    h.insert(header::ACCESS_CONTROL_MAX_AGE, HeaderValue::from_static("600"));
    res
}

/// An answer that carries a token or a result of a run is never cached.
fn no_store(mut res: Response) -> Response {
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

/// Mints a ticket for the person of the session (`Tenant` checks the cookie, the CSRF header and the
/// membership). The token is in the answer once.
async fn mint(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(req): Json<MintRequest>,
) -> ApiResult<Response> {
    let m = run_tickets::mint(&s.k, &c, &req).await?;
    Ok(no_store(Json(json!(m)).into_response()))
}

async fn revoke(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    run_tickets::revoke(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

/// Largest body of a call: the arguments (see `run_tickets::MAX_ARG_BYTES`) and a little framing.
const MAX_BODY: usize = run_tickets::MAX_ARG_BYTES + 1024;

/// A call on behalf of a run. The bearer ticket is the only credential: no cookie, no CSRF, and the
/// routes of the sessions never accept it. JSON only, so a form or a script of another site cannot send it.
async fn call(
    State(s): State<AppState>,
    Path((ticket, plugin, command)): Path<(String, String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    mosaikit_kernel::ops::maintenance::check(&s.k, None).await?;
    let json_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim_start().to_ascii_lowercase().starts_with("application/json"));
    if !json_type || body.len() > MAX_BODY {
        return Err(bad("a JSON body of at most 256 KiB is required"));
    }
    let args: Value = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).map_err(|_| bad("the arguments are not valid JSON"))?
    };
    let out = run_tickets::call(&s.k, &ticket, &plugin, &command, args).await?;
    let mut res = no_store(Json(json!({ "ok": out })).into_response());
    // read by the frame of an embedded page, which has no origin of its own (see `preflight`)
    res.headers_mut().insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    Ok(res)
}

/// The service says the run is over: the ticket stops working.
async fn finish(State(s): State<AppState>, Path(ticket): Path<String>) -> ApiResult<Json<Value>> {
    run_tickets::finish(&s.k, &ticket).await?;
    Ok(ok())
}
