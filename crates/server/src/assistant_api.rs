//! REST API of the AI assistant and the MCP server (docs/architecture.md, "AI assistant"): the status, the tools, the
//! chat loop and the confirmation of a proposal for the person; the settings for the Administrator and the Tenant
//! Manager; the personal access tokens; and the MCP endpoint, which a token (not a session) opens.

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::sse::{Event as SseEvent, Sse};
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

/// A question may carry files (up to 20 MB of them, a third more as base64) next to the chat.
const CHAT_LIMIT: usize = 32 << 20;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/assistant", get(a_settings).put(a_set_settings))
        .route("/api/admin/assistant/models", get(a_models))
        .route("/api/t/{t}/assistant/models", get(models))
        .route("/api/t/{t}/manage/assistant", get(m_settings).put(m_set_settings).delete(m_clear_settings))
        .route("/api/t/{t}/assistant/status", get(status))
        .route("/api/t/{t}/assistant/tools", get(tools))
        .route("/api/t/{t}/assistant/chat", post(chat).layer(DefaultBodyLimit::max(CHAT_LIMIT)))
        .route("/api/t/{t}/assistant/chat/stream", post(chat_stream).layer(DefaultBodyLimit::max(CHAT_LIMIT)))
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

async fn a_models(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(assistant::platform_models(&s.k, &u).await?)))
}

async fn models(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(assistant::model_choices(&s.k, &c).await?)))
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

async fn tools(State(s): State<AppState>, Tenant(c): Tenant, h: HeaderMap) -> ApiResult<Json<Value>> {
    Ok(Json(json!(assistant::list_tools(&s.k, &c, &request_lang(&h)).await?)))
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

/// The chat as server-sent events: `delta` (a piece of the text), `message` (a message the loop added), `tool` (a tool is about
/// to run), then `done` (the same body `chat` answers) or `error` (`code`, `message`). The loop runs in a task of its own, so a
/// page that leaves does not leave a half-done loop in the request.
async fn chat_stream(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    h: HeaderMap,
    Json(req): Json<ChatRequest>,
) -> Response {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<SseEvent>();
    let lang = request_lang(&h);
    let k = s.k.clone();
    let task = tokio::spawn(async move {
        let sink = tx.clone();
        let emit = move |e: assistant::Event| {
            let name = match &e {
                assistant::Event::Delta { .. } => "delta",
                assistant::Event::Message { .. } => "message",
                assistant::Event::Tool { .. } => "tool",
            };
            let _ = sink.send(SseEvent::default().event(name).data(json!(e).to_string()));
        };
        let last = match assistant::chat_with(&k, &c, &lang, req, Some(&emit)).await {
            Ok(r) => SseEvent::default().event("done").data(json!(r).to_string()),
            Err(e) => SseEvent::default()
                .event("error")
                .data(json!({ "code": e.code(), "message": e.to_string() }).to_string()),
        };
        let _ = tx.send(last);
    });
    // the person pressed stop (the page closed the stream): the loop ends there, and the request to the model with it, so a local
    // model stops computing. Only read tools run in the loop, so nothing is left half done.
    let body = futures_util::stream::unfold((rx, StopOnDrop(task)), |(mut rx, guard)| async move {
        rx.recv().await.map(|e| (Ok::<_, std::convert::Infallible>(e), (rx, guard)))
    });
    no_store(Sse::new(body).into_response())
}

/// Ends a task when it is dropped: the stream of the answer owns it, so it lives as long as someone reads the answer.
struct StopOnDrop(tokio::task::JoinHandle<()>);

impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
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
    // a client that is not signed in is told where to find the authorization server (RFC 9728), so it can start the OAuth flow
    let challenge = |msg: &str| {
        let mut res =
            (StatusCode::UNAUTHORIZED, Json(json!({ "error": msg, "code": "assistant_bad_token" })))
                .into_response();
        let v =
            format!("Bearer resource_metadata=\"{}\"", crate::oauth_mcp_api::resource_metadata_url(&s, &t));
        if let Ok(v) = header::HeaderValue::from_str(&v) {
            res.headers_mut().insert(header::WWW_AUTHENTICATE, v);
        }
        res
    };
    let Some(token) = bearer(&h) else {
        return Ok(challenge(
            "a personal access token or an OAuth token is required (Authorization: Bearer ...)",
        ));
    };
    let (c, allow_write, _) = match tokens::authenticate(&s.k, token).await {
        Ok(x) => x,
        Err(e) if e.kind == Kind::Unauthorized => return Ok(challenge("invalid or expired token")),
        Err(e) => return Err(e.into()),
    };
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
