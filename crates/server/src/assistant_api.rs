//! REST API of the AI assistant and the MCP server (docs/architecture.md, "AI assistant"): the status, the tools, the
//! chat loop and the confirmation of a proposal for the person; the settings for the Administrator and the Tenant
//! Manager; the personal access tokens; and the MCP endpoint, which a token (not a session) opens.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use mosaikit_kernel::assistant::{self, mcp, settings, tokens, ChatRequest};
use mosaikit_kernel::{Error, Kind};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{ok, request_lang, uuid};
use crate::auth::{Auth, Tenant};
use crate::{ApiError, ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/assistant", get(a_settings).put(a_set_settings))
        .route("/api/t/{t}/manage/assistant", get(m_settings).put(m_set_settings).delete(m_clear_settings))
        .route("/api/t/{t}/assistant/status", get(status))
        .route("/api/t/{t}/assistant/tools", get(tools))
        .route("/api/t/{t}/assistant/chat", post(chat))
        .route("/api/t/{t}/assistant/tools/{name}/call", post(call))
        .route("/api/t/{t}/assistant/tokens", get(token_list).post(token_create))
        .route("/api/t/{t}/assistant/tokens/{id}", delete(token_revoke))
        .route("/api/t/{t}/mcp", post(mcp_post).get(mcp_get))
}

/// An answer that may carry a token or the content of a chat is never cached.
fn no_store(mut res: Response) -> Response {
    res.headers_mut().insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-store"));
    res
}

async fn a_settings(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(settings::platform_view(&s.k, &u).await?)))
}

async fn a_set_settings(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(i): Json<settings::SettingsInput>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(settings::set_platform(&s.k, &u, &i).await?)))
}

async fn m_settings(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(settings::tenant_view(&s.k, &c).await?)))
}

async fn m_set_settings(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(i): Json<settings::SettingsInput>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(settings::set_tenant(&s.k, &c, &i).await?)))
}

async fn m_clear_settings(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    settings::clear_tenant(&s.k, &c).await?;
    Ok(ok())
}

async fn status(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(assistant::status(&s.k, &c).await?)))
}

async fn tools(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(assistant::list_tools(&s.k, &c).await?)))
}

async fn chat(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    h: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> ApiResult<Response> {
    let r = assistant::chat(&s.k, &c, &request_lang(&h), req).await?;
    Ok(no_store(Json(json!(r)).into_response()))
}

#[derive(Deserialize)]
struct CallBody {
    #[serde(default)]
    arguments: Value,
}

/// The person confirmed a proposal (the session and the CSRF header are the confirmation): the tool runs as them.
async fn call(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, name)): Path<(String, String)>,
    h: HeaderMap,
    Json(b): Json<CallBody>,
) -> ApiResult<Response> {
    let args = if b.arguments.is_null() { json!({}) } else { b.arguments };
    let r = assistant::invoke(&s.k, &c, &request_lang(&h), &name, args, true, "confirm").await?;
    Ok(no_store(Json(json!({ "result": r })).into_response()))
}

async fn token_list(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tokens::list(&s.k, &c).await?)))
}

#[derive(Deserialize)]
struct NewToken {
    name: String,
    #[serde(default)]
    allow_write: bool,
    #[serde(default)]
    days: Option<u32>,
}

async fn token_create(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(b): Json<NewToken>,
) -> ApiResult<Response> {
    let t = tokens::create(&s.k, &c, &b.name, b.allow_write, b.days).await?;
    Ok(no_store(Json(json!(t)).into_response()))
}

async fn token_revoke(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    tokens::revoke(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

// ------------------------------------------------------------------ MCP

fn bearer(h: &HeaderMap) -> Option<&str> {
    h.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer ").map(str::trim)
}

/// The endpoint of the MCP server of a tenant: JSON-RPC over HTTP (Streamable HTTP, answers as JSON). The credential is a
/// personal access token, no cookie, so there is no CSRF: a page of another origin cannot know the token.
async fn mcp_post(
    State(s): State<AppState>,
    Path(t): Path<String>,
    h: HeaderMap,
    body: Bytes,
) -> ApiResult<Response> {
    let token = bearer(&h).ok_or_else(|| {
        ApiError(Error::unauthorized("a personal access token is required (Authorization: Bearer mska_...)"))
    })?;
    let (c, allow_write, _) = tokens::authenticate(&s.k, token).await?;
    // a token opens the tenant it was made in, whatever the address says
    if c.tenant.slug != t {
        return Err(ApiError(Error::new(Kind::Forbidden, "this token is for another tenant")));
    }
    let lang = request_lang(&h);
    let msg: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            let e = json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } });
            return Ok(no_store(Json(e).into_response()));
        }
    };
    let res = match msg {
        Value::Array(items) => {
            let mut out = Vec::new();
            for m in items.iter().take(20) {
                if let Some(r) = mcp::handle(&s.k, &c, &lang, allow_write, m).await {
                    out.push(r);
                }
            }
            (!out.is_empty()).then_some(Value::Array(out))
        }
        m => mcp::handle(&s.k, &c, &lang, allow_write, &m).await,
    };
    Ok(no_store(match res {
        Some(v) => Json(v).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }))
}

/// No server-initiated stream: the clients that try `GET` are told so, as the specification says.
async fn mcp_get() -> Response {
    let mut res = StatusCode::METHOD_NOT_ALLOWED.into_response();
    res.headers_mut().insert(header::ALLOW, header::HeaderValue::from_static("POST"));
    res
}
