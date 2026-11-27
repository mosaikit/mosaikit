//! OAuth 2.1 of the MCP server (docs/architecture.md, "AI assistant"): the metadata documents (RFC 9728 and RFC 8414), the
//! registration of a client (RFC 7591), the page where the person approves it and the token endpoint, per tenant.
//!
//! The session cookie is `SameSite=Strict`, so it does not come with a request that another site sent the person to. The
//! `/authorize` page therefore needs no session: it shows who asks and a link, and the click on that link (the same site) comes
//! with the cookie to the page where the person approves.

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use mosaikit_kernel::assistant::{self, oauth};
use mosaikit_kernel::{identity, tenancy, Error};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{ClientIp, SESSION_COOKIE};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/.well-known/oauth-protected-resource/api/t/{t}/mcp", get(resource_metadata))
        .route("/.well-known/oauth-authorization-server/api/t/{t}/oauth", get(server_metadata))
        .route("/api/t/{t}/oauth/register", post(register))
        .route("/api/t/{t}/oauth/authorize", get(authorize))
        .route("/api/t/{t}/oauth/consent", get(consent).post(decide))
        .route("/api/t/{t}/oauth/token", post(token))
}

fn app(s: &AppState) -> String {
    s.k.cfg.url.trim_end_matches('/').to_string()
}

/// The address of the metadata of the MCP resource of a tenant, for `WWW-Authenticate`.
pub fn resource_metadata_url(s: &AppState, tenant: &str) -> String {
    format!("{}/.well-known/oauth-protected-resource/api/t/{tenant}/mcp", app(s))
}

fn no_store(mut res: Response) -> Response {
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res.headers_mut().insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    res
}

async fn resource_metadata(State(s): State<AppState>, Path(t): Path<String>) -> Json<Value> {
    let a = app(&s);
    Json(json!({
        "resource": format!("{a}/api/t/{t}/mcp"),
        "authorization_servers": [format!("{a}/api/t/{t}/oauth")],
        "bearer_methods_supported": ["header"],
        "scopes_supported": ["mcp"],
    }))
}

async fn server_metadata(State(s): State<AppState>, Path(t): Path<String>) -> Json<Value> {
    let a = format!("{}/api/t/{t}/oauth", app(&s));
    Json(json!({
        "issuer": a,
        "authorization_endpoint": format!("{a}/authorize"),
        "token_endpoint": format!("{a}/token"),
        "registration_endpoint": format!("{a}/register"),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "scopes_supported": ["mcp"],
    }))
}

/// An error of the OAuth endpoints: `{ "error", "error_description" }` with the code of the RFC, 400 (401 for a client).
fn oauth_error(e: Error) -> Response {
    let code = e.code();
    let known = [
        "invalid_request",
        "invalid_client",
        "invalid_grant",
        "unsupported_grant_type",
        "invalid_redirect_uri",
        "invalid_client_metadata",
    ];
    let (code, status) = if known.contains(&code) {
        (code, if code == "invalid_client" { StatusCode::UNAUTHORIZED } else { StatusCode::BAD_REQUEST })
    } else {
        ("server_error", StatusCode::INTERNAL_SERVER_ERROR)
    };
    no_store((status, Json(json!({ "error": code, "error_description": e.to_string() }))).into_response())
}

#[derive(Deserialize)]
struct Registration {
    #[serde(default)]
    client_name: String,
    #[serde(default)]
    redirect_uris: Vec<String>,
}

async fn register(
    State(s): State<AppState>,
    ClientIp(ip): ClientIp,
    Path(_t): Path<String>,
    Json(r): Json<Registration>,
) -> Response {
    if !assistant::rate_limit(&s.k, &format!("oauth-register:{ip}"), 30, std::time::Duration::from_secs(3600))
    {
        return oauth_error(
            Error::bad("too many registrations: try again later").with_code("invalid_client_metadata"),
        );
    }
    match oauth::register(&s.k, &r.client_name, &r.redirect_uris).await {
        Ok(c) => no_store((StatusCode::CREATED, Json(json!(c))).into_response()),
        Err(e) => oauth_error(e),
    }
}

// ---------------------------------------------------------------- pages

fn esc(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&#39;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

/// A small page of its own (no script, no outside resource); it cannot be framed.
fn page(status: StatusCode, title: &str, body: &str) -> Response {
    let html = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>{t}</title><style>\
:root{{color-scheme:light dark}}body{{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:Canvas;color:CanvasText}}\
main{{max-width:30rem;margin:1rem;padding:1.5rem 1.75rem;border:1px solid color-mix(in srgb,CanvasText 20%,transparent);border-radius:12px}}\
h1{{font-size:1.2rem;margin:0 0 .75rem}}p{{margin:.5rem 0}}.dim{{opacity:.7;font-size:.9rem}}\
a.btn,button{{font:inherit;display:inline-block;padding:.5rem 1rem;border-radius:8px;border:1px solid color-mix(in srgb,CanvasText 30%,transparent);background:transparent;color:inherit;text-decoration:none;cursor:pointer}}\
.go{{background:#8a1d2f;border-color:#8a1d2f;color:#fff}}form{{margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap}}label{{display:flex;gap:.5rem;align-items:flex-start}}\
</style></head><body><main>{b}</main></body></html>",
        t = esc(title),
        b = body
    );
    let mut res = (status, [(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response();
    let h = res.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"),
    );
    res
}

fn error_page(e: &Error) -> Response {
    page(
        StatusCode::BAD_REQUEST,
        "Connection request",
        &format!("<h1>Cannot connect</h1><p>{}</p>", esc(&e.to_string())),
    )
}

#[derive(Deserialize)]
struct AuthorizeQuery {
    response_type: Option<String>,
    client_id: Option<String>,
    redirect_uri: Option<String>,
    code_challenge: Option<String>,
    code_challenge_method: Option<String>,
    state: Option<String>,
}

/// An application sends the person here. Nothing is decided: the request is checked and kept, and the person is shown who asks.
async fn authorize(
    State(s): State<AppState>,
    Path(t): Path<String>,
    Query(q): Query<AuthorizeQuery>,
) -> Response {
    let bad = |m: &str| error_page(&Error::bad(m.to_string()));
    if q.response_type.as_deref() != Some("code") {
        return bad("response_type must be code");
    }
    let (Some(client), Some(redirect), Some(challenge)) =
        (q.client_id.as_deref(), q.redirect_uri.as_deref(), q.code_challenge.as_deref())
    else {
        return bad("client_id, redirect_uri and code_challenge are required");
    };
    let method = q.code_challenge_method.as_deref().unwrap_or("S256");
    match oauth::begin(&s.k, &t, client, redirect, challenge, method, q.state.as_deref()).await {
        Ok(b) => {
            let link = format!("{}/api/t/{}/oauth/consent?grant={}", app(&s), esc(&t), b.grant);
            page(
                StatusCode::OK,
                "Connect an application",
                &format!(
                    "<h1>{name} wants to connect</h1><p>It asks to use the tools of the assistant in this workspace with your rights. \
You decide on the next page what it may do.</p><p><a class=\"btn go\" href=\"{link}\">Continue</a></p>\
<p class=\"dim\">If you did not start this, close the page.</p>",
                    name = esc(&b.client_name)
                ),
            )
        }
        Err(e) => error_page(&e),
    }
}

/// The person of the session cookie, if the cookie is valid.
async fn session_of(s: &AppState, h: &HeaderMap) -> Option<mosaikit_kernel::SessionUser> {
    let token = h
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == SESSION_COOKIE)
        .map(|(_, v)| v.to_string())?;
    identity::session(&s.k, &token).await.ok().flatten()
}

#[derive(Deserialize)]
struct GrantQuery {
    grant: uuid::Uuid,
}

async fn consent(
    State(s): State<AppState>,
    Path(t): Path<String>,
    h: HeaderMap,
    Query(q): Query<GrantQuery>,
) -> Response {
    let Some(user) = session_of(&s, &h).await else {
        let home = format!("{}/", app(&s));
        return page(
            StatusCode::UNAUTHORIZED,
            "Sign in",
            &format!(
                "<h1>Sign in first</h1><p>Sign in to the platform in this browser, then come back to the application and connect again.</p>\
<p><a class=\"btn go\" href=\"{}\">Sign in</a></p>",
                esc(&home)
            ),
        );
    };
    let c = match tenancy::caller(&s.k, &user, &t).await {
        Ok(c) => c,
        Err(e) => return error_page(&e),
    };
    match oauth::pending(&s.k, &c, q.grant).await {
        Ok(p) => {
            let action = format!("{}/api/t/{}/oauth/consent", app(&s), esc(&t));
            page(
            StatusCode::OK,
            "Connect an application",
            &format!(
                "<h1>Let {name} use your assistant?</h1>\
<p>It will use the tools of the assistant in <b>{tenant}</b> as <b>{me}</b>: only what you can see and do. It was sent here from <b>{host}</b>.</p>\
<form method=\"post\" action=\"{action}\"><input type=\"hidden\" name=\"csrf\" value=\"{csrf}\"><input type=\"hidden\" name=\"grant\" value=\"{grant}\">\
<label><input type=\"checkbox\" name=\"allow_write\" value=\"1\"> <span>May also change data (create and edit items). Off: it can only read.</span></label>\
<p style=\"flex-basis:100%\"></p>\
<button class=\"go\" name=\"decision\" value=\"approve\">Allow</button><button name=\"decision\" value=\"deny\">Deny</button></form>\
<p class=\"dim\">You can end the access at any time in AI Assistant › Tokens and settings.</p>",
                name = esc(&p.client_name),
                tenant = esc(&c.tenant.name),
                me = esc(&c.user.display_name),
                host = esc(&p.redirect_host),
                action = action,
                csrf = esc(&user.csrf),
                grant = q.grant,
            ),
            )
        }
        Err(e) => error_page(&e),
    }
}

#[derive(Deserialize)]
struct Decision {
    csrf: String,
    grant: uuid::Uuid,
    decision: String,
    #[serde(default)]
    allow_write: Option<String>,
}

async fn decide(
    State(s): State<AppState>,
    Path(t): Path<String>,
    h: HeaderMap,
    Form(f): Form<Decision>,
) -> Response {
    let Some(user) = session_of(&s, &h).await else {
        return page(
            StatusCode::UNAUTHORIZED,
            "Sign in",
            "<h1>Sign in first</h1><p>Your session ended. Connect again from the application.</p>",
        );
    };
    // the form carries the CSRF token of the session (a form cannot set a header)
    if f.csrf.is_empty() || f.csrf != user.csrf {
        return page(
            StatusCode::FORBIDDEN,
            "Connection request",
            "<h1>Not allowed</h1><p>The request did not come from this page.</p>",
        );
    }
    let c = match tenancy::caller(&s.k, &user, &t).await {
        Ok(c) => c,
        Err(e) => return error_page(&e),
    };
    match oauth::decide(&s.k, &c, f.grant, f.decision == "approve", f.allow_write.is_some()).await {
        Ok(url) => no_store(Redirect::to(&url).into_response()),
        Err(e) => error_page(&e),
    }
}

// ---------------------------------------------------------------- tokens

#[derive(Deserialize)]
struct TokenForm {
    grant_type: String,
    client_id: Option<String>,
    code: Option<String>,
    code_verifier: Option<String>,
    redirect_uri: Option<String>,
    refresh_token: Option<String>,
}

async fn token(
    State(s): State<AppState>,
    ClientIp(ip): ClientIp,
    Path(t): Path<String>,
    Form(f): Form<TokenForm>,
) -> Response {
    if !assistant::rate_limit(&s.k, &format!("oauth-token:{ip}"), 120, std::time::Duration::from_secs(60)) {
        return oauth_error(
            Error::bad("too many requests: try again in a minute").with_code("invalid_request"),
        );
    }
    let Some(client) = f.client_id.as_deref() else {
        return oauth_error(Error::bad("client_id is required").with_code("invalid_client"));
    };
    let r = match f.grant_type.as_str() {
        "authorization_code" => {
            match (f.code.as_deref(), f.code_verifier.as_deref(), f.redirect_uri.as_deref()) {
                (Some(code), Some(verifier), Some(uri)) => {
                    oauth::exchange(&s.k, &t, client, code, verifier, uri).await
                }
                _ => Err(Error::bad("code, code_verifier and redirect_uri are required")
                    .with_code("invalid_request")),
            }
        }
        "refresh_token" => match f.refresh_token.as_deref() {
            Some(rt) => oauth::refresh(&s.k, &t, client, rt).await,
            None => Err(Error::bad("refresh_token is required").with_code("invalid_request")),
        },
        _ => Err(Error::bad("grant_type must be authorization_code or refresh_token")
            .with_code("unsupported_grant_type")),
    };
    match r {
        Ok(tok) => no_store(Json(json!(tok)).into_response()),
        Err(e) => oauth_error(e),
    }
}
