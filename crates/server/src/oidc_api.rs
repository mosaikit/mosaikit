//! Sign-in through the identity provider of a tenant (OIDC): start, return from the provider,
//! back-channel and front-channel logout, and the configuration of the Administrator
//! (docs/architecture.md, OIDC).

use axum::extract::{Path, Query, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use mosaikit_kernel::oidc;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::auth::{cookie, session_cookie, Auth, ClientIp};
use crate::{bad, ApiResult, AppState};

/// Cookie of a sign-in in progress (`state`, `nonce` and PKCE verifier, encrypted). `SameSite=Lax`:
/// the browser sends it back on the top-level return from the provider, which a `Strict` cookie would
/// not survive.
const FLOW_COOKIE: &str = "msk_oidc";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/auth/oidc/{slug}/start", get(start))
        .route("/api/auth/oidc/{slug}/callback", get(callback))
        .route("/api/auth/oidc/{slug}/backchannel-logout", post(backchannel))
        .route("/api/auth/oidc/{slug}/frontchannel-logout", get(frontchannel))
        .route("/api/admin/tenants/{id}/sign-in", get(a_config).put(a_set_config))
        .route("/api/admin/oidc/check", post(a_check))
}

fn flow_cookie(s: &AppState, value: Option<&str>) -> HeaderValue {
    let secure = if s.k.cfg.cookie_secure() { "; Secure" } else { "" };
    let path = format!("{}/api/auth/oidc/", s.k.cfg.base_path);
    let v = match value {
        Some(v) => format!("{FLOW_COOKIE}={v}; HttpOnly; SameSite=Lax; Path={path}; Max-Age=600{secure}"),
        None => format!("{FLOW_COOKIE}=; HttpOnly; SameSite=Lax; Path={path}; Max-Age=0{secure}"),
    };
    HeaderValue::from_str(&v).expect("valid cookie")
}

fn redirect(to: &str) -> Response {
    let mut res = StatusCode::SEE_OTHER.into_response();
    let h = res.headers_mut();
    h.insert(header::LOCATION, HeaderValue::from_str(to).unwrap_or(HeaderValue::from_static("/")));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

/// Back to the sign-in page of the tenant, with the code of what went wrong (the page translates it).
fn back_to_login(s: &AppState, slug: &str, code: &str) -> Response {
    let slug: String = slug.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let code: String = code.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    let mut res = redirect(&format!("{}/?oidc_error={code}#/login/{slug}", s.k.cfg.app_url));
    res.headers_mut().append(header::SET_COOKIE, flow_cookie(s, None));
    res
}

#[derive(Deserialize)]
struct StartReq {
    #[serde(default)]
    remember: Option<String>,
}

/// Sends the browser to the provider of the tenant.
async fn start(State(s): State<AppState>, Path(slug): Path<String>, Query(q): Query<StartReq>) -> Response {
    let remember = matches!(q.remember.as_deref(), Some("1" | "true"));
    if let Err(e) = mosaikit_kernel::ops::maintenance::check(&s.k, None).await {
        return back_to_login(&s, &slug, e.code());
    }
    match oidc::begin(&s.k, &slug, remember).await {
        Ok(b) => {
            let mut res = redirect(&b.url);
            res.headers_mut().append(header::SET_COOKIE, flow_cookie(&s, Some(&b.cookie)));
            res
        }
        Err(e) => {
            tracing::warn!("OIDC sign-in of {slug} not started: {}", e.message);
            back_to_login(&s, &slug, e.code())
        }
    }
}

/// Return from the provider: session and cookie, then the app; on error the sign-in page.
async fn callback(
    State(s): State<AppState>,
    ClientIp(ip): ClientIp,
    Path(slug): Path<String>,
    Query(cb): Query<oidc::Callback>,
    parts: Parts,
) -> Response {
    let flow = cookie(&parts, FLOW_COOKIE);
    match oidc::finish(&s.k, &slug, flow.as_deref(), &cb, &ip).await {
        Ok(lr) => {
            let mut res = redirect(&format!("{}/#/t/{}", s.k.cfg.app_url, slug.trim().to_lowercase()));
            let h = res.headers_mut();
            h.append(header::SET_COOKIE, session_cookie(&s, Some((&lr.token, lr.max_age))));
            h.append(header::SET_COOKIE, flow_cookie(&s, None));
            res
        }
        Err(e) => {
            tracing::warn!("OIDC sign-in of {slug} refused: {}", e.message);
            back_to_login(&s, &slug, e.code())
        }
    }
}

#[derive(Deserialize)]
struct LogoutForm {
    logout_token: String,
}

/// Back-channel logout (OpenID Connect Back-Channel Logout 1.0): the provider closes sessions.
async fn backchannel(
    State(s): State<AppState>,
    Path(slug): Path<String>,
    Form(f): Form<LogoutForm>,
) -> Response {
    let mut res = match oidc::backchannel_logout(&s.k, &slug, &f.logout_token).await {
        Ok(n) => Json(json!({ "ok": true, "sessions": n })).into_response(),
        Err(e) => {
            tracing::warn!("back-channel logout of {slug} refused: {}", e.message);
            (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_request", "code": e.code() })))
                .into_response()
        }
    };
    res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

#[derive(Deserialize)]
struct FrontchannelReq {
    #[serde(default)]
    iss: String,
    #[serde(default)]
    sid: String,
}

/// Front-channel logout (OpenID Connect Front-Channel Logout 1.0): a page the provider loads in an
/// iframe of its own logout page. Only the provider of the tenant may frame it; nothing is cached.
async fn frontchannel(
    State(s): State<AppState>,
    Path(slug): Path<String>,
    Query(q): Query<FrontchannelReq>,
) -> Response {
    let (status, text) = match oidc::frontchannel_logout(&s.k, &slug, &q.iss, &q.sid).await {
        Ok(_) => (StatusCode::OK, "Signed out of Mosaikit."),
        Err(e) => {
            tracing::warn!("front-channel logout of {slug} refused: {}", e.message);
            (StatusCode::BAD_REQUEST, "Sign-out refused.")
        }
    };
    let ancestors = oidc::issuer_origin(&s.k, &slug).await.unwrap_or_else(|| "'none'".into());
    let mut res = (
        status,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        format!("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Sign-out</title><p>{text}</p></html>"),
    )
        .into_response();
    let h = res.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-store"));
    if let Ok(v) = HeaderValue::from_str(&format!(
        "default-src 'none'; frame-ancestors {ancestors}; base-uri 'none'; form-action 'none'"
    )) {
        h.insert(header::CONTENT_SECURITY_POLICY, v);
    }
    res
}

fn uuid(s: &str) -> ApiResult<Uuid> {
    s.parse().map_err(|_| bad(format!("invalid id: {s}")))
}

async fn a_config(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(oidc::config(&s.k, &u, uuid(&id)?).await?)))
}

async fn a_set_config(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(i): Json<oidc::OidcInput>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(oidc::set_config(&s.k, &u, uuid(&id)?, &i).await?)))
}

#[derive(Deserialize)]
struct CheckReq {
    issuer: String,
}

async fn a_check(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<CheckReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(oidc::check(&s.k, &u, &r.issuer).await?)))
}
