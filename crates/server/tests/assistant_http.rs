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
        .call(Some(&mgr), None, Method::POST, "/api/t/alfa/assistant/chat/stream",
            Some(json!({ "messages": [{ "role": "user", "content": "hello there my friend" }] })))
        .await;
    assert_eq!(r.status, StatusCode::OK);
    let text = String::from_utf8_lossy(&r.body).to_string();
    assert!(text.contains("event: delta") && text.contains("event: message") && text.contains("event: done"), "{text}");
    assert!(text.find("event: delta").unwrap() < text.find("event: done").unwrap());
    let bad = app
        .call(Some(&mgr), None, Method::POST, "/api/t/alfa/assistant/chat/stream", Some(json!({ "messages": [] })))
        .await;
    assert!(String::from_utf8_lossy(&bad.body).contains("event: error"));
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
