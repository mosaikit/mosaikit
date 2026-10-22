//! A test identity provider (OpenID Connect) for the tests and the development environment: discovery,
//! keys, an authorization page that lists its people, the token endpoint with PKCE, end session and the
//! sending of back-channel logout tokens. Not a real provider: no passwords, fixed client.
//!
//! Started in-process by the tests ([`FakeIdp::spawn`]) or as `mosaikit-fake-idp` (e2e and manual tests,
//! see docs/manual-tests.md).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::{Form, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use mosaikit_kernel::oidc::fake::{self, FakeKeys};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Settings of the test provider.
#[derive(Debug, Clone)]
pub struct FakeConfig {
    pub client_id: String,
    pub client_secret: String,
    /// algorithm of the ID tokens: "ES256" or "RS256"
    pub alg: String,
}

impl Default for FakeConfig {
    fn default() -> FakeConfig {
        FakeConfig { client_id: "mosaikit".into(), client_secret: "fake-secret".into(), alg: "ES256".into() }
    }
}

struct Code {
    sub: String,
    redirect_uri: String,
    nonce: String,
    challenge: String,
    sid: String,
}

struct Inner {
    cfg: FakeConfig,
    keys: FakeKeys,
    codes: HashMap<String, Code>,
    /// seconds of validity of the next ID tokens (negative: already expired)
    ttl: i64,
    /// audience of the next ID tokens, if not the client
    aud: Option<String>,
    /// sessions opened: sid -> sub
    sessions: Vec<(String, String)>,
}

/// A running test provider.
#[derive(Clone)]
pub struct FakeIdp {
    pub issuer: String,
    inner: Arc<Mutex<Inner>>,
}

impl FakeIdp {
    /// Starts the provider on `addr` (port 0: a free one).
    pub async fn spawn(addr: SocketAddr, cfg: FakeConfig) -> std::io::Result<FakeIdp> {
        let listener = tokio::net::TcpListener::bind(addr).await?;
        let issuer = format!("http://{}", listener.local_addr()?);
        let idp = FakeIdp {
            issuer: issuer.clone(),
            inner: Arc::new(Mutex::new(Inner {
                cfg,
                keys: FakeKeys::new(0),
                codes: HashMap::new(),
                ttl: 300,
                aud: None,
                sessions: vec![],
            })),
        };
        let app = router(idp.clone());
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Ok(idp)
    }

    /// New signing keys (rotation); the old ones are no longer published.
    pub fn rotate(&self) {
        let mut i = self.inner.lock().expect("fake idp");
        i.keys = FakeKeys::new(i.keys.generation + 1);
    }

    pub fn set_alg(&self, alg: &str) {
        self.inner.lock().expect("fake idp").cfg.alg = alg.into();
    }

    /// Validity of the next ID tokens in seconds (negative: expired).
    pub fn set_ttl(&self, ttl: i64) {
        self.inner.lock().expect("fake idp").ttl = ttl;
    }

    /// Audience of the next ID tokens (`None`: the client).
    pub fn set_audience(&self, aud: Option<&str>) {
        self.inner.lock().expect("fake idp").aud = aud.map(str::to_owned);
    }

    /// The sessions opened by the provider: (sid, sub).
    pub fn sessions(&self) -> Vec<(String, String)> {
        self.inner.lock().expect("fake idp").sessions.clone()
    }

    /// A signed back-channel logout token for a person (`sub`) or a session (`sid`).
    pub fn logout_token(&self, sub: Option<&str>, sid: Option<&str>) -> String {
        let i = self.inner.lock().expect("fake idp");
        i.keys.sign(&i.cfg.alg, &fake::logout_claims(&self.issuer, &i.cfg.client_id, sub, sid))
    }

    /// Signs claims with the current key (tests of tokens built by hand).
    pub fn sign(&self, claims: &Value) -> String {
        let i = self.inner.lock().expect("fake idp");
        i.keys.sign(&i.cfg.alg, claims)
    }
}

fn router(idp: FakeIdp) -> Router {
    Router::new()
        .route("/.well-known/openid-configuration", get(discovery))
        .route("/jwks", get(jwks))
        .route("/authorize", get(authorize_page).post(authorize))
        .route("/token", post(token))
        .route("/logout", get(end_session))
        .route("/_admin/backchannel", post(send_backchannel))
        .route("/_admin/rotate", post(rotate))
        .with_state(idp)
}

async fn discovery(State(idp): State<FakeIdp>) -> Json<Value> {
    let i = &idp.issuer;
    Json(json!({
        "issuer": i,
        "authorization_endpoint": format!("{i}/authorize"),
        "token_endpoint": format!("{i}/token"),
        "jwks_uri": format!("{i}/jwks"),
        "end_session_endpoint": format!("{i}/logout"),
        "backchannel_logout_supported": true,
        "backchannel_logout_session_supported": true,
        "response_types_supported": ["code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["ES256", "RS256"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
        "scopes_supported": ["openid", "profile", "email", "groups"],
    }))
}

async fn jwks(State(idp): State<FakeIdp>) -> Json<Value> {
    Json(json!(idp.inner.lock().expect("fake idp").keys.jwks()))
}

#[derive(Debug, Deserialize)]
struct AuthReq {
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    redirect_uri: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    nonce: String,
    #[serde(default)]
    code_challenge: String,
    #[serde(default)]
    code_challenge_method: String,
    #[serde(default)]
    response_type: String,
    /// with a person (`login_hint` or the button of the page) the provider answers at once
    #[serde(default)]
    login_hint: Option<String>,
    #[serde(default)]
    user: Option<String>,
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The page of the provider: one button per person (no password: it is a test provider).
async fn authorize_page(State(idp): State<FakeIdp>, Query(q): Query<AuthReq>) -> Response {
    if q.login_hint.is_some() {
        return issue_code(&idp, &q, q.login_hint.as_deref().unwrap_or_default());
    }
    let hidden: String = [
        ("client_id", &q.client_id),
        ("redirect_uri", &q.redirect_uri),
        ("state", &q.state),
        ("nonce", &q.nonce),
        ("code_challenge", &q.code_challenge),
        ("code_challenge_method", &q.code_challenge_method),
        ("response_type", &q.response_type),
    ]
    .iter()
    .map(|(k, v)| format!("<input type=\"hidden\" name=\"{k}\" value=\"{}\">", esc(v)))
    .collect();
    let buttons: String = fake::USERS
        .iter()
        .map(|u| {
            let groups = if u.groups.is_empty() { "no groups".to_string() } else { u.groups.join(", ") };
            format!(
                "<li><button type=\"submit\" name=\"user\" value=\"{}\">Sign in as {}</button> <small>{} · {}</small></li>",
                u.username, u.name, u.username, groups
            )
        })
        .collect();
    Html(format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Test identity provider</title>\
         <style>body{{font:16px system-ui;margin:40px;max-width:640px}}li{{margin:12px 0}}button{{font:inherit;padding:8px 14px}}</style></head>\
         <body><main><h1>Test identity provider</h1><p>Development and tests only. Choose who signs in.</p>\
         <form method=\"post\" action=\"authorize\">{hidden}<ul>{buttons}</ul></form></main></body></html>"
    ))
    .into_response()
}

async fn authorize(State(idp): State<FakeIdp>, Form(f): Form<AuthReq>) -> Response {
    let who = f.user.clone().unwrap_or_default();
    issue_code(&idp, &f, &who)
}

fn issue_code(idp: &FakeIdp, q: &AuthReq, who: &str) -> Response {
    let mut i = idp.inner.lock().expect("fake idp");
    if q.client_id != i.cfg.client_id || q.response_type != "code" || q.redirect_uri.is_empty() {
        return (StatusCode::BAD_REQUEST, "invalid_request: client_id, response_type=code, redirect_uri")
            .into_response();
    }
    if q.code_challenge_method != "S256" || q.code_challenge.is_empty() {
        return (StatusCode::BAD_REQUEST, "invalid_request: PKCE S256 required").into_response();
    }
    let Some(u) = fake::user(who) else {
        return (StatusCode::BAD_REQUEST, "unknown person").into_response();
    };
    let code = hex::encode(rand::random::<[u8; 16]>());
    let sid = hex::encode(rand::random::<[u8; 8]>());
    i.sessions.push((sid.clone(), u.sub.to_string()));
    i.codes.insert(
        code.clone(),
        Code {
            sub: u.sub.into(),
            redirect_uri: q.redirect_uri.clone(),
            nonce: q.nonce.clone(),
            challenge: q.code_challenge.clone(),
            sid,
        },
    );
    let mut to = match url::Url::parse(&q.redirect_uri) {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid redirect_uri").into_response(),
    };
    to.query_pairs_mut()
        .append_pair("code", &code)
        .append_pair("state", &q.state)
        .append_pair("iss", &idp.issuer);
    let mut res = StatusCode::SEE_OTHER.into_response();
    res.headers_mut().insert(header::LOCATION, HeaderValue::from_str(to.as_str()).expect("location"));
    res
}

#[derive(Debug, Deserialize)]
struct TokenReq {
    grant_type: String,
    code: String,
    redirect_uri: String,
    code_verifier: String,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    client_secret: Option<String>,
}

fn token_error(e: &str) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))).into_response()
}

fn decode_component(s: &str) -> String {
    url::form_urlencoded::parse(format!("x={s}").as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default()
}

async fn token(State(idp): State<FakeIdp>, headers: HeaderMap, Form(f): Form<TokenReq>) -> Response {
    let mut i = idp.inner.lock().expect("fake idp");
    // client authentication: basic or in the body
    let basic = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
        .and_then(|b| STANDARD.decode(b).ok())
        .and_then(|b| String::from_utf8(b).ok())
        .and_then(|s| s.split_once(':').map(|(a, b)| (decode_component(a), decode_component(b))));
    let (id, secret) = basic
        .unwrap_or((f.client_id.clone().unwrap_or_default(), f.client_secret.clone().unwrap_or_default()));
    if id != i.cfg.client_id || secret != i.cfg.client_secret {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "invalid_client" }))).into_response();
    }
    if f.grant_type != "authorization_code" {
        return token_error("unsupported_grant_type");
    }
    let Some(c) = i.codes.remove(&f.code) else { return token_error("invalid_grant") };
    if c.redirect_uri != f.redirect_uri {
        return token_error("invalid_grant");
    }
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(f.code_verifier.as_bytes()));
    if challenge != c.challenge {
        return token_error("invalid_grant");
    }
    let u = fake::user(&c.sub).expect("person of the code");
    let mut claims = fake::id_claims(&idp.issuer, &i.cfg.client_id, u, &c.nonce, &c.sid, i.ttl);
    if let Some(aud) = &i.aud {
        claims["aud"] = json!(aud);
    }
    let id_token = i.keys.sign(&i.cfg.alg, &claims);
    Json(json!({
        "access_token": hex::encode(rand::random::<[u8; 16]>()),
        "token_type": "Bearer",
        "expires_in": 300,
        "id_token": id_token,
    }))
    .into_response()
}

#[derive(Debug, Deserialize)]
struct EndSessionReq {
    #[serde(default)]
    post_logout_redirect_uri: Option<String>,
}

async fn end_session(Query(q): Query<EndSessionReq>) -> Response {
    match q.post_logout_redirect_uri {
        Some(to) if to.starts_with("http") => {
            let mut res = StatusCode::SEE_OTHER.into_response();
            if let Ok(v) = HeaderValue::from_str(&to) {
                res.headers_mut().insert(header::LOCATION, v);
            }
            res
        }
        _ => Html("<!doctype html><title>Signed out</title><p>Signed out of the test identity provider.</p>")
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct BackchannelReq {
    /// back-channel logout address of the client (shown by Mosaikit in the configuration of the tenant)
    url: String,
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    sid: Option<String>,
}

/// Sends a back-channel logout token to the client (manual tests: closes the sessions of a person).
async fn send_backchannel(State(idp): State<FakeIdp>, Json(r): Json<BackchannelReq>) -> Response {
    let sub = r.sub.as_deref().and_then(fake::user).map(|u| u.sub).or(r.sub.as_deref());
    let token = idp.logout_token(sub, r.sid.as_deref());
    let res = reqwest::Client::new().post(&r.url).form(&[("logout_token", token)]).send().await;
    match res {
        Ok(res) => {
            let status = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            Json(json!({ "status": status, "body": body })).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    }
}

async fn rotate(State(idp): State<FakeIdp>) -> Json<Value> {
    idp.rotate();
    Json(json!({ "ok": true }))
}
