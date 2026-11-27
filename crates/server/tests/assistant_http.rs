//! HTTP tests of the AI assistant and of the MCP endpoint (real routers). Run with `MOSAIKIT_TEST_BACKEND=sqlite` for
//! SQLite.

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use mosaikit_kernel::testing::{start, TestKernel, ADMIN_PASSWORD, PASSWORD};
use serde_json::{json, Value};
use tower::ServiceExt;

struct App {
    _t: TestKernel,
    app: Router,
}

struct Session {
    cookie: String,
    csrf: String,
}

struct Res {
    status: StatusCode,
    body: Vec<u8>,
    cache: String,
}

impl Res {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

impl App {
    async fn call(
        &self,
        s: Option<&Session>,
        bearer: Option<&str>,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Res {
        let mut b = Request::builder().method(method).uri(path);
        if let Some(s) = s {
            b = b.header(header::COOKIE, &s.cookie).header("x-csrf-token", &s.csrf);
        }
        if let Some(t) = bearer {
            b = b.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let req = match body {
            Some(v) => {
                b.header(header::CONTENT_TYPE, "application/json").body(Body::from(v.to_string())).unwrap()
            }
            None => b.body(Body::empty()).unwrap(),
        };
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let cache = res
            .headers()
            .get(header::CACHE_CONTROL)
            .map(|v| v.to_str().unwrap().to_string())
            .unwrap_or_default();
        let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        Res { status, body, cache }
    }
}

async fn sign_in(app: &Router, path: &str, body: Value) -> Session {
    let req = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let set = res.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap().to_string();
    let cookie = set.split(';').next().unwrap().to_string();
    let b = res.into_body().collect().await.unwrap().to_bytes();
    let v: Value = serde_json::from_slice(&b).unwrap();
    Session { cookie, csrf: v["csrf"].as_str().unwrap().to_string() }
}

#[tokio::test]
async fn settings_chat_confirmation_tokens_and_mcp_over_http() {
    let t = start().await;
    let alfa = t.tenant("alfa").await;
    let _ = alfa;
    let app = App { app: mosaikit_server::app_router(t.k.clone()), _t: t };
    let admin = sign_in(
        &app.app,
        "/api/auth/admin/login",
        json!({ "username": "admin", "password": ADMIN_PASSWORD }),
    )
    .await;
    let mgr = sign_in(
        &app.app,
        "/api/auth/login",
        json!({ "tenant": "alfa", "username": "alfa-manager", "password": PASSWORD }),
    )
    .await;

    // nothing is configured: not available, and the chat says why
    assert_eq!(
        app.call(Some(&mgr), None, Method::GET, "/api/t/alfa/assistant/status", None).await.json()
            ["available"],
        false
    );
    let r = app
        .call(
            Some(&mgr),
            None,
            Method::POST,
            "/api/t/alfa/assistant/chat",
            Some(json!({ "messages": [{ "role": "user", "content": "hi" }] })),
        )
        .await;
    assert_eq!(r.json()["code"], "assistant_off");
    // the settings of the platform are the Administrator's
    let r = app.call(Some(&mgr), None, Method::GET, "/api/admin/assistant", None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = app
        .call(
            Some(&admin),
            None,
            Method::PUT,
            "/api/admin/assistant",
            Some(json!({ "provider": "fake", "model": "m", "api_key": "sk-secret", "allow_byok": false })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(!String::from_utf8_lossy(&r.body).contains("sk-secret") && r.json()["has_key"] == true);
    assert_eq!(
        app.call(Some(&mgr), None, Method::GET, "/api/t/alfa/assistant/status", None).await.json()
            ["available"],
        true
    );

    // the models: a Manager may choose every one of the provider; the Administrator reads them for the settings page
    let m = app.call(Some(&mgr), None, Method::GET, "/api/t/alfa/assistant/models", None).await.json();
    assert_eq!((m["default"].as_str(), m["all"].as_bool()), (Some("m"), Some(true)));
    assert_eq!(m["models"].as_array().unwrap().len(), 3);
    let a = app.call(Some(&admin), None, Method::GET, "/api/admin/assistant/models", None).await;
    assert_eq!(a.json().as_array().unwrap().len(), 2);
    assert_eq!(
        app.call(Some(&mgr), None, Method::GET, "/api/admin/assistant/models", None).await.status,
        StatusCode::FORBIDDEN
    );
    let r = app
        .call(
            Some(&mgr),
            None,
            Method::POST,
            "/api/t/alfa/assistant/chat",
            Some(json!({ "messages": [{ "role": "user", "content": "hi" }], "model": "fake-small" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);

    // a question with a file of several megabytes goes through (the body limit of the chat is larger than the default)
    let big = "A".repeat(4 << 20);
    let r = app
        .call(Some(&mgr), None, Method::POST, "/api/t/alfa/assistant/chat", Some(json!({ "messages": [{ "role": "user", "content": "see", "attachments": [{ "name": "big.png", "kind": "image", "mime": "image/png", "data": big }] }] })))
        .await;
    assert_eq!(
        r.status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&r.body).chars().take(200).collect::<String>()
    );
    assert!(r.json()["messages"][0]["content"].as_str().unwrap().contains("[1 file(s): big.png]"));

    // the chat runs a kernel tool as the person; the answer is never cached
    let r = app
        .call(
            Some(&mgr),
            None,
            Method::POST,
            "/api/t/alfa/assistant/chat",
            Some(json!({ "messages": [{ "role": "user", "content": "tool:kernel__whoami {}" }] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.cache, "no-store");
    let msgs = r.json()["messages"].clone();
    assert_eq!(msgs[0]["tool_calls"][0]["name"], "kernel__whoami");
    assert!(msgs[1]["content"].as_str().unwrap().contains("alfa-manager"));
    // the same chat as a stream: pieces, the messages, then `done`; an error is an event, not a broken answer
    let r = app
        .call(
            Some(&mgr),
            None,
            Method::POST,
            "/api/t/alfa/assistant/chat/stream",
            Some(json!({ "messages": [{ "role": "user", "content": "hello there my friend" }] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK);
    let text = String::from_utf8_lossy(&r.body).to_string();
    assert!(
        text.contains("event: delta") && text.contains("event: message") && text.contains("event: done"),
        "{text}"
    );
    assert!(text.find("event: delta").unwrap() < text.find("event: done").unwrap());
    let bad = app
        .call(
            Some(&mgr),
            None,
            Method::POST,
            "/api/t/alfa/assistant/chat/stream",
            Some(json!({ "messages": [] })),
        )
        .await;
    assert!(String::from_utf8_lossy(&bad.body).contains("event: error"));
    // stop: the page closes the stream of a slow answer and the loop ends there, with no reply and no record of a finished chat
    let before: i64 =
        mosaikit_db::query_scalar("select count(*) from core.events where action = 'assistant.chat'")
            .fetch_one(&app._t.db)
            .await
            .unwrap();
    let slow = app.call(
        Some(&mgr),
        None,
        Method::POST,
        "/api/t/alfa/assistant/chat/stream",
        Some(json!({ "messages": [{ "role": "user", "content": "sleep:1500 slow" }] })),
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(300), slow).await.is_err(),
        "the answer takes longer"
    );
    tokio::time::sleep(std::time::Duration::from_millis(2200)).await;
    let after: i64 =
        mosaikit_db::query_scalar("select count(*) from core.events where action = 'assistant.chat'")
            .fetch_one(&app._t.db)
            .await
            .unwrap();
    assert_eq!(before, after, "a stopped answer is not a finished chat");
    // and the same question left alone does finish
    let r = app
        .call(
            Some(&mgr),
            None,
            Method::POST,
            "/api/t/alfa/assistant/chat/stream",
            Some(json!({ "messages": [{ "role": "user", "content": "sleep:100 fast" }] })),
        )
        .await;
    assert!(String::from_utf8_lossy(&r.body).contains("event: done"));

    // a mutating call without the CSRF header is refused
    let no_csrf = Session { cookie: mgr.cookie.clone(), csrf: String::new() };
    let r = app
        .call(
            Some(&no_csrf),
            None,
            Method::POST,
            "/api/t/alfa/assistant/tools/kernel__whoami/call",
            Some(json!({})),
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = app
        .call(
            Some(&mgr),
            None,
            Method::POST,
            "/api/t/alfa/assistant/tools/kernel__whoami/call",
            Some(json!({})),
        )
        .await;
    assert_eq!(r.json()["result"]["tenant_slug"], "alfa");

    // a token: shown once, then MCP with no cookie
    let r = app
        .call(
            Some(&mgr),
            None,
            Method::POST,
            "/api/t/alfa/assistant/tokens",
            Some(json!({ "name": "desktop" })),
        )
        .await;
    assert_eq!(r.cache, "no-store");
    let token = r.json()["token"].as_str().unwrap().to_string();
    let listed = app.call(Some(&mgr), None, Method::GET, "/api/t/alfa/assistant/tokens", None).await;
    assert_eq!(listed.json().as_array().unwrap().len(), 1);
    assert!(!String::from_utf8_lossy(&listed.body).contains(&token));
    let rpc = json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/list" });
    let r = app.call(None, Some(&token), Method::POST, "/api/t/alfa/mcp", Some(rpc.clone())).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.json()["id"], 7);
    assert!(r.json()["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["name"] == "kernel__kpi_summary"));
    // a notification gets 202
    let n = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    assert_eq!(
        app.call(None, Some(&token), Method::POST, "/api/t/alfa/mcp", Some(n)).await.status,
        StatusCode::ACCEPTED
    );
    // no token, a wrong token, a session cookie alone, and another tenant's address: all refused
    assert_eq!(
        app.call(None, None, Method::POST, "/api/t/alfa/mcp", Some(rpc.clone())).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call(None, Some("mska_x"), Method::POST, "/api/t/alfa/mcp", Some(rpc.clone())).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call(Some(&mgr), None, Method::POST, "/api/t/alfa/mcp", Some(rpc.clone())).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        app.call(None, Some(&token), Method::POST, "/api/t/beta/mcp", Some(rpc.clone())).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        app.call(None, Some(&token), Method::GET, "/api/t/alfa/mcp", None).await.status,
        StatusCode::METHOD_NOT_ALLOWED
    );
    // revoked: refused
    let id = listed.json()[0]["id"].as_str().unwrap().to_string();
    let r =
        app.call(Some(&mgr), None, Method::DELETE, &format!("/api/t/alfa/assistant/tokens/{id}"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(
        app.call(None, Some(&token), Method::POST, "/api/t/alfa/mcp", Some(rpc)).await.status,
        StatusCode::UNAUTHORIZED
    );
}

async fn raw(app: &App, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, String) {
    let res = app.app.clone().oneshot(req).await.unwrap();
    let (status, headers) = (res.status(), res.headers().clone());
    let body = res.into_body().collect().await.unwrap().to_bytes();
    (status, headers, String::from_utf8_lossy(&body).to_string())
}

fn form(path: &str, s: Option<&Session>, fields: &str) -> Request<Body> {
    let mut b = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded");
    if let Some(s) = s {
        b = b.header(header::COOKIE, &s.cookie);
    }
    b.body(Body::from(fields.to_string())).unwrap()
}

fn get_req(p: String, s: Option<&Session>) -> Request<Body> {
    let mut b = Request::builder().uri(p);
    if let Some(s) = s {
        b = b.header(header::COOKIE, &s.cookie);
    }
    b.body(Body::empty()).unwrap()
}

/// A parameter of an address the person is sent back to.
fn param(location: &str, name: &str) -> Option<String> {
    let q = location.split_once('?')?.1;
    q.split('&').find_map(|kv| kv.strip_prefix(&format!("{name}=")).map(str::to_string))
}

async fn token_call(app: &App, fields: String) -> (StatusCode, axum::http::HeaderMap, String) {
    raw(app, form("/api/t/alfa/oauth/token", None, &fields)).await
}

fn grant_of(page: &str) -> String {
    page.split("grant=").nth(1).unwrap().split('"').next().unwrap().to_string()
}

#[tokio::test]
async fn an_outside_client_connects_with_oauth_and_the_person_decides_what_it_may_do() {
    let t = start().await;
    let _ = t.tenant("alfa").await;
    let app = App { app: mosaikit_server::app_router(t.k.clone()), _t: t };
    let mgr = sign_in(
        &app.app,
        "/api/auth/login",
        json!({ "tenant": "alfa", "username": "alfa-manager", "password": PASSWORD }),
    )
    .await;
    // RFC 7636 example: this verifier gives this S256 challenge
    let (verifier, challenge) =
        ("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    let redirect = "http://localhost:53682/callback";
    let rpc = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });

    // no token: the answer says where the authorization server is
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/t/alfa/mcp")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(rpc.to_string()))
        .unwrap();
    let (status, h, _) = raw(&app, req).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let www = h.get(header::WWW_AUTHENTICATE).unwrap().to_str().unwrap().to_string();
    assert!(
        www.contains("resource_metadata=")
            && www.contains("/.well-known/oauth-protected-resource/api/t/alfa/mcp"),
        "{www}"
    );

    // the metadata documents
    let pr = app
        .call(None, None, Method::GET, "/.well-known/oauth-protected-resource/api/t/alfa/mcp", None)
        .await
        .json();
    assert!(pr["authorization_servers"][0].as_str().unwrap().ends_with("/api/t/alfa/oauth"));
    let md = app
        .call(None, None, Method::GET, "/.well-known/oauth-authorization-server/api/t/alfa/oauth", None)
        .await
        .json();
    assert_eq!(md["code_challenge_methods_supported"][0], "S256");
    assert!(md["registration_endpoint"].as_str().unwrap().ends_with("/oauth/register"));

    // registration: an address that is neither https nor local is refused
    let r = app
        .call(
            None,
            None,
            Method::POST,
            "/api/t/alfa/oauth/register",
            Some(json!({ "client_name": "X", "redirect_uris": ["http://evil.example/cb"] })),
        )
        .await;
    assert_eq!(
        (r.status, r.json()["error"].as_str().map(str::to_string)),
        (StatusCode::BAD_REQUEST, Some("invalid_redirect_uri".to_string()))
    );
    let r = app
        .call(
            None,
            None,
            Method::POST,
            "/api/t/alfa/oauth/register",
            Some(json!({ "client_name": "Claude Desktop", "redirect_uris": [redirect] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED);
    let client = r.json()["client_id"].as_str().unwrap().to_string();

    // /authorize needs no session: it shows who asks and a link; an address the client did not register is not followed
    let q = |redir: &str| {
        format!("/api/t/alfa/oauth/authorize?response_type=code&client_id={client}&redirect_uri={redir}&code_challenge={challenge}&code_challenge_method=S256&state=xyz")
    };
    assert_eq!(raw(&app, get_req(q("http://localhost:1/other"), None)).await.0, StatusCode::BAD_REQUEST);
    let (st, h, page) = raw(&app, get_req(q(redirect), None)).await;
    assert_eq!(st, StatusCode::OK);
    assert!(page.contains("Claude Desktop wants to connect") && h.get(header::X_FRAME_OPTIONS).is_some());
    let grant = grant_of(&page);

    // the approval page needs the session of the person
    let consent = format!("/api/t/alfa/oauth/consent?grant={grant}");
    assert_eq!(raw(&app, get_req(consent.clone(), None)).await.0, StatusCode::UNAUTHORIZED);
    let (st, _, page) = raw(&app, get_req(consent.clone(), Some(&mgr))).await;
    assert_eq!(st, StatusCode::OK);
    assert!(page.contains("name=\"csrf\"") && page.contains("May also change data"));
    // a form without the CSRF token of the session is refused
    let body = format!("csrf=wrong&grant={grant}&decision=approve");
    assert_eq!(
        raw(&app, form("/api/t/alfa/oauth/consent", Some(&mgr), &body)).await.0,
        StatusCode::FORBIDDEN
    );
    // approve, read-only: the person is sent back with the code and the state of the client
    let body = format!("csrf={}&grant={grant}&decision=approve", mgr.csrf);
    let (st, h, _) = raw(&app, form("/api/t/alfa/oauth/consent", Some(&mgr), &body)).await;
    assert_eq!(st, StatusCode::SEE_OTHER);
    let loc = h.get(header::LOCATION).unwrap().to_str().unwrap().to_string();
    assert!(
        loc.starts_with("http://localhost:53682/callback?") && param(&loc, "state").as_deref() == Some("xyz")
    );
    let code = param(&loc, "code").unwrap();
    // the request is used up
    assert_eq!(raw(&app, get_req(consent, Some(&mgr))).await.0, StatusCode::BAD_REQUEST);

    // the token endpoint: a wrong verifier burns the code; the right one then fails too
    let ex = |c: &str, v: &str| {
        format!("grant_type=authorization_code&client_id={client}&code={c}&code_verifier={v}&redirect_uri={redirect}")
    };
    let (st, _, b) = token_call(&app, ex(&code, "wrong-verifier-wrong-verifier-wrong-verifier-1")).await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
    assert!(b.contains("invalid_grant"));
    assert!(
        token_call(&app, ex(&code, verifier)).await.2.contains("invalid_grant"),
        "a burnt code never works again"
    );

    // a second approval, now with writes on
    let (_, _, page) = raw(&app, get_req(q(redirect), None)).await;
    let grant = grant_of(&page);
    let body = format!("csrf={}&grant={grant}&decision=approve&allow_write=1", mgr.csrf);
    let (_, h, _) = raw(&app, form("/api/t/alfa/oauth/consent", Some(&mgr), &body)).await;
    let code = param(h.get(header::LOCATION).unwrap().to_str().unwrap(), "code").unwrap();
    let (st, h, b) = token_call(&app, ex(&code, verifier)).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(h.get(header::CACHE_CONTROL).unwrap(), "no-store");
    let tok: Value = serde_json::from_str(&b).unwrap();
    assert_eq!((tok["token_type"].as_str(), tok["expires_in"].as_i64()), (Some("Bearer"), Some(3600)));
    let (access, refresh) = (
        tok["access_token"].as_str().unwrap().to_string(),
        tok["refresh_token"].as_str().unwrap().to_string(),
    );

    // the access token opens the MCP server, and the person sees it among their tokens
    let r = app.call(None, Some(&access), Method::POST, "/api/t/alfa/mcp", Some(rpc.clone())).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.json()["result"]["tools"].as_array().unwrap().iter().any(|t| t["name"] == "kernel__whoami"));
    let listed = app.call(Some(&mgr), None, Method::GET, "/api/t/alfa/assistant/tokens", None).await.json();
    assert!(listed
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["name"] == "Claude Desktop (OAuth)" && t["allow_write"] == true));

    // refresh: new tokens, the old ones stop
    let rf = |r: &str| format!("grant_type=refresh_token&client_id={client}&refresh_token={r}");
    let (st, _, b) = token_call(&app, rf(&refresh)).await;
    assert_eq!(st, StatusCode::OK);
    let tok2: Value = serde_json::from_str(&b).unwrap();
    assert_ne!(tok2["access_token"], tok["access_token"]);
    assert_eq!(
        app.call(None, Some(&access), Method::POST, "/api/t/alfa/mcp", Some(rpc.clone())).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert!(token_call(&app, rf(&refresh)).await.2.contains("invalid_grant"));
    let access2 = tok2["access_token"].as_str().unwrap();
    assert_eq!(
        app.call(None, Some(access2), Method::POST, "/api/t/alfa/mcp", Some(rpc.clone())).await.status,
        StatusCode::OK
    );
    // a bad grant type
    assert!(token_call(&app, "grant_type=password&client_id=x".into())
        .await
        .2
        .contains("unsupported_grant_type"));

    // revoking the token in the list ends the refresh too
    let id = listed.as_array().unwrap().iter().find(|t| t["name"] == "Claude Desktop (OAuth)").unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        app.call(Some(&mgr), None, Method::DELETE, &format!("/api/t/alfa/assistant/tokens/{id}"), None)
            .await
            .status,
        StatusCode::OK
    );
    assert!(token_call(&app, rf(tok2["refresh_token"].as_str().unwrap())).await.2.contains("invalid_grant"));

    // deny: the client gets access_denied and its state
    let (_, _, page) = raw(&app, get_req(q(redirect), None)).await;
    let grant = grant_of(&page);
    let body = format!("csrf={}&grant={grant}&decision=deny", mgr.csrf);
    let (_, h, _) = raw(&app, form("/api/t/alfa/oauth/consent", Some(&mgr), &body)).await;
    let loc = h.get(header::LOCATION).unwrap().to_str().unwrap().to_string();
    assert_eq!(
        (param(&loc, "error").as_deref(), param(&loc, "state").as_deref()),
        (Some("access_denied"), Some("xyz"))
    );
}
