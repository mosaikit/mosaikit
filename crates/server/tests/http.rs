//! HTTP tests of the server (real routers, real PostgreSQL: `cargo xtask db up`).

use std::io::Write;

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use mosaikit_kernel::testing::{pack_plugin, start, start_with, TestKernel, ADMIN_PASSWORD, PASSWORD};
use serde_json::{json, Value};
use tower::ServiceExt;

struct Res {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Res {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
    fn header(&self, h: header::HeaderName) -> String {
        self.headers.get(h).map(|v| v.to_str().unwrap_or_default().to_string()).unwrap_or_default()
    }
}

async fn send(router: &Router, req: Request<Body>) -> Res {
    let res = router.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    Res { status, headers, body }
}

#[derive(Clone, Default)]
struct Session {
    cookie: String,
    csrf: String,
}

struct App {
    t: TestKernel,
    app: Router,
    untrusted: Router,
}

impl App {
    async fn new() -> App {
        App::with(start().await)
    }

    fn with(t: TestKernel) -> App {
        let app = mosaikit_server::app_router(t.k.clone());
        let untrusted = mosaikit_server::untrusted_router(t.k.clone());
        App { t, app, untrusted }
    }

    async fn call(&self, s: Option<&Session>, method: Method, path: &str, body: Option<Value>) -> Res {
        let mut b = Request::builder().method(method).uri(path);
        if let Some(s) = s {
            b = b.header(header::COOKIE, &s.cookie).header("x-csrf-token", &s.csrf);
        }
        let req = match body {
            Some(v) => {
                b.header(header::CONTENT_TYPE, "application/json").body(Body::from(v.to_string())).unwrap()
            }
            None => b.body(Body::empty()).unwrap(),
        };
        send(&self.app, req).await
    }

    async fn raw(&self, s: &Session, path: &str, bytes: Vec<u8>) -> Res {
        let req = Request::builder()
            .method(Method::POST)
            .uri(path)
            .header(header::COOKIE, &s.cookie)
            .header("x-csrf-token", &s.csrf)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .body(Body::from(bytes))
            .unwrap();
        send(&self.app, req).await
    }

    async fn get_untrusted(&self, path: &str, cookie: Option<&str>) -> Res {
        let mut b = Request::builder().uri(path);
        if let Some(c) = cookie {
            b = b.header(header::COOKIE, c);
        }
        send(&self.untrusted, b.body(Body::empty()).unwrap()).await
    }

    async fn login(&self, tenant: &str, user: &str, password: &str) -> Session {
        let r = self
            .call(
                None,
                Method::POST,
                "/api/auth/login",
                Some(json!({ "tenant": tenant, "username": user, "password": password })),
            )
            .await;
        assert_eq!(r.status, StatusCode::OK, "{}", r.text());
        let set = r.header(header::SET_COOKIE);
        let cookie = set.split(';').next().unwrap().to_string();
        Session { cookie, csrf: r.json()["csrf"].as_str().unwrap().to_string() }
    }

    /// A refused sign-in: the code of the error.
    async fn login_err(&self, tenant: &str, user: &str) -> String {
        let r = self
            .call(
                None,
                Method::POST,
                "/api/auth/login",
                Some(json!({ "tenant": tenant, "username": user, "password": PASSWORD })),
            )
            .await;
        assert_ne!(r.status, StatusCode::OK);
        r.json()["code"].as_str().unwrap_or_default().to_string()
    }

    /// Sign-in as Administrator (without second factor: `admin_totp = false` in the tests).
    async fn admin(&self) -> Session {
        let r = self
            .call(
                None,
                Method::POST,
                "/api/auth/admin/login",
                Some(json!({ "username": "admin", "password": ADMIN_PASSWORD })),
            )
            .await;
        assert_eq!(r.status, StatusCode::OK, "{}", r.text());
        let cookie = r.header(header::SET_COOKIE).split(';').next().unwrap().to_string();
        Session { cookie, csrf: r.json()["csrf"].as_str().unwrap().to_string() }
    }
}

#[tokio::test]
async fn session_with_httponly_cookie_and_csrf() {
    let a = App::new().await;
    let r = a
        .call(
            None,
            Method::POST,
            "/api/auth/admin/login",
            Some(json!({ "username": "admin", "password": "no" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::UNAUTHORIZED);
    assert!(r.json()["error"].is_string());
    // Administrators do not sign in from the form of the tenants
    let r = a
        .call(
            None,
            Method::POST,
            "/api/auth/login",
            Some(json!({ "tenant": "system", "username": "admin", "password": ADMIN_PASSWORD })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    let r = a
        .call(
            None,
            Method::POST,
            "/api/auth/admin/login",
            Some(json!({ "username": "admin", "password": ADMIN_PASSWORD })),
        )
        .await;
    let cookie = r.header(header::SET_COOKIE);
    assert!(
        cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict") && cookie.contains("Path=/"),
        "{cookie}"
    );
    assert!(
        !r.text().contains(cookie.split(';').next().unwrap().split('=').nth(1).unwrap()),
        "the token is not in the body"
    );
    let s = a.admin().await;

    // without cookie: 401
    assert_eq!(a.call(None, Method::GET, "/api/session", None).await.status, StatusCode::UNAUTHORIZED);
    let me = a.call(Some(&s), Method::GET, "/api/session", None).await;
    assert_eq!(me.json()["user"]["username"], "admin");
    assert!(me.json()["user"].get("token_hash").is_none());

    // change without CSRF: 403
    let no_csrf = Session { cookie: s.cookie.clone(), csrf: String::new() };
    let r = a
        .call(Some(&no_csrf), Method::POST, "/api/me/password", Some(json!({ "old": "a", "new": "b" })))
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let wrong = Session { cookie: s.cookie.clone(), csrf: "x".repeat(32) };
    assert_eq!(
        a.call(Some(&wrong), Method::POST, "/api/auth/logout", None).await.status,
        StatusCode::FORBIDDEN
    );

    // logout: cookie cleared and session invalidated
    let r = a.call(Some(&s), Method::POST, "/api/auth/logout", None).await;
    assert!(r.header(header::SET_COOKIE).contains("Max-Age=0"));
    assert_eq!(a.call(Some(&s), Method::GET, "/api/session", None).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn security_headers_and_closed_cors() {
    let a = App::new().await;
    let r = a.call(None, Method::GET, "/", None).await;
    assert_eq!(r.status, StatusCode::OK);
    let csp = r.header(header::CONTENT_SECURITY_POLICY);
    assert!(csp.contains("frame-ancestors 'none'") && csp.contains("default-src 'self'"), "{csp}");
    assert!(csp.contains(&a.t.cfg.plugin_origin()), "frame-src towards the origin of the plugins");
    assert_eq!(r.header(header::X_FRAME_OPTIONS), "DENY");
    assert_eq!(r.header(header::X_CONTENT_TYPE_OPTIONS), "nosniff");
    // preflight from another origin: no Access-Control-Allow-Origin
    let req = Request::builder()
        .method(Method::OPTIONS)
        .uri("/api/session")
        .header(header::ORIGIN, "https://malicious.example")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .body(Body::empty())
        .unwrap();
    let r = send(&a.app, req).await;
    assert!(r.headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
    // API that does not exist: JSON, not the SPA
    let r = a.call(None, Method::GET, "/api/nope", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert!(r.json()["error"].is_string());
}

#[tokio::test]
async fn full_flow_tenant_crud_sharing() {
    let a = App::new().await;
    a.t.install("notes").await;
    let admin = a.admin().await;
    let r = a
        .call(
            Some(&admin),
            Method::POST,
            "/api/admin/tenants",
            Some(json!({
                "slug": "alfa", "name": "Alfa", "manager_username": "gestore", "manager_password": PASSWORD
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let g = a.login("alfa", "gestore", PASSWORD).await;
    // a manager is not a system administrator
    assert_eq!(a.call(Some(&g), Method::GET, "/api/admin/tenants", None).await.status, StatusCode::FORBIDDEN);
    let r = a
        .call(
            Some(&g),
            Method::POST,
            "/api/t/alfa/manage/members",
            Some(json!({ "username": "anna", "password": PASSWORD })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let anna_id = r.json()["user_id"].as_str().unwrap().to_string();
    let anna = a.login("alfa", "anna", PASSWORD).await;

    let ctx = a.call(Some(&anna), Method::GET, "/api/t/alfa/context", None).await.json();
    assert_eq!(ctx["tenant"]["role"], "user");
    assert_eq!(ctx["plugins"][0]["id"], "com.mosaikit.notes");
    // tenant not one's own
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/t/system/context", None).await.status,
        StatusCode::FORBIDDEN
    );

    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": "Anna's note" } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
    let rid = r.json()["id"].as_str().unwrap().to_string();
    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": {} })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    // the manager does not see the content but sees the metadata
    let list = a.call(Some(&g), Method::GET, "/api/t/alfa/p/com.mosaikit.notes/r/notes", None).await.json();
    assert_eq!(list["rows"].as_array().unwrap().len(), 0);
    let r =
        a.call(Some(&g), Method::GET, &format!("/api/t/alfa/p/com.mosaikit.notes/r/notes/{rid}"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    let meta = a.call(Some(&g), Method::GET, "/api/t/alfa/manage/resources", None).await.json();
    assert_eq!(meta[0]["title"], "Anna's note");
    assert_eq!(meta[0]["owner_name"], "anna");

    // read sharing with the manager
    let gid = a.call(Some(&g), Method::GET, "/api/session", None).await.json()["user"]["user_id"]
        .as_str()
        .unwrap()
        .to_string();
    let r = a
        .call(
            Some(&anna),
            Method::PUT,
            &format!("/api/t/alfa/resources/{rid}/grants"),
            Some(json!({
                "principal_type": "user", "principal_id": gid, "level": "read"
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let list = a.call(Some(&g), Method::GET, "/api/t/alfa/p/com.mosaikit.notes/r/notes", None).await.json();
    assert_eq!(list["rows"][0]["my_level"], "read");
    let r = a
        .call(
            Some(&g),
            Method::PUT,
            &format!("/api/t/alfa/p/com.mosaikit.notes/r/notes/{rid}"),
            Some(json!({ "values": { "title": "x" } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // WASM command
    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/call/notes.count_by_tag",
            Some(json!({ "args": {} })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["result"][0]["n"], 1);

    // KPIs: manager yes, member no
    assert_eq!(a.call(Some(&g), Method::GET, "/api/t/alfa/manage/kpi", None).await.status, StatusCode::OK);
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/t/alfa/manage/kpi", None).await.status,
        StatusCode::FORBIDDEN
    );

    // leaving with reassignment
    let r = a
        .call(
            Some(&g),
            Method::DELETE,
            &format!("/api/t/alfa/manage/members/{anna_id}?new_owner={gid}"),
            None,
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["reassigned"], 1);
    let list = a.call(Some(&g), Method::GET, "/api/t/alfa/p/com.mosaikit.notes/r/notes", None).await.json();
    assert_eq!(list["rows"][0]["my_level"], "manage");
    assert_eq!(a.call(Some(&anna), Method::GET, "/api/session", None).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn plugin_installation_admin_only() {
    let a = App::new().await;
    let admin = a.admin().await;
    a.t.tenant("alfa").await;
    let g = a.login("alfa", "alfa-manager", PASSWORD).await;
    let pkg = pack_plugin("contacts");
    assert_eq!(a.raw(&g, "/api/admin/plugins", pkg.clone()).await.status, StatusCode::FORBIDDEN);
    let r = a.raw(&admin, "/api/admin/plugins", pkg).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["status"], "installed");
    let r =
        a.call(Some(&admin), Method::POST, "/api/admin/plugins/com.mosaikit.contacts/activate", None).await;
    assert_eq!(r.status, StatusCode::OK);
    let list = a.call(Some(&admin), Method::GET, "/api/admin/plugins", None).await.json();
    assert_eq!(list[0]["status"], "active");
    assert!(list[0]["signed_by"].is_string());
    let r = a.raw(&admin, "/api/admin/plugins", b"not a zip".to_vec()).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn plugin_uis_only_on_the_untrusted_origin() {
    let a = App::new().await;
    // minimal UI in the folder of the installed plugin
    a.t.install("maps").await;
    let p = a.t.plugins.get("com.mosaikit.maps").unwrap();
    let ui_dir = a.t.cfg.data_dir.join("plugins/com.mosaikit.maps/0.5.1/ui");
    std::fs::create_dir_all(&ui_dir).unwrap();
    std::fs::write(ui_dir.join("index.html"), "<h1>mappe</h1>").unwrap();
    drop(p);
    // reload: the ui folder now exists
    mosaikit_kernel::plugins::load_installed(&a.t).await.unwrap();

    let r = a.get_untrusted("/ui/com.mosaikit.maps/", None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let csp = r.header(header::CONTENT_SECURITY_POLICY);
    assert!(csp.contains("frame-src 'self' blob: https://web.geolibre.app"), "{csp}");
    assert!(csp.contains(&format!("frame-ancestors {}", a.t.cfg.app_origin())), "{csp}");
    assert_eq!(
        a.get_untrusted("/ui/com.mosaikit.maps/../../../etc/passwd", None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(a.get_untrusted("/ui/com.nonexistent.x/", None).await.status, StatusCode::NOT_FOUND);
    // the app origin does not serve the UIs of the plugins (SPA fallback of the host, not the file of the plugin)
    let r = a.call(None, Method::GET, "/ui/com.mosaikit.maps/index.html", None).await;
    assert!(!r.text().contains("<h1>mappe</h1>"));
}

fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in entries {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

#[tokio::test]
async fn user_contents_always_sandboxed() {
    let a = App::new().await;
    a.t.install("static-site").await;
    a.t.install("files").await;
    a.t.tenant("alfa").await;
    let g = a.login("alfa", "alfa-manager", PASSWORD).await;
    let site = a
        .call(
            Some(&g),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.static-site/r/sites",
            Some(json!({ "values": { "name": "Site" } })),
        )
        .await;
    let sid = site.json()["id"].as_str().unwrap().to_string();
    let zip = zip_of(&[
        ("index.html", b"<script>document.cookie</script>"),
        ("css/a.css", b"a{}"),
        ("docs/index.html", b"doc"),
    ]);
    let r = a.raw(&g, &format!("/api/t/alfa/p/com.mosaikit.static-site/content/{sid}"), zip).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let url = a
        .call(Some(&g), Method::POST, &format!("/api/t/alfa/p/com.mosaikit.static-site/ticket/{sid}"), None)
        .await
        .json()["url"]
        .as_str()
        .unwrap()
        .to_string();
    let path = url.trim_start_matches(&a.t.cfg.public_url).to_string();
    let r = a.get_untrusted(&path, None).await;
    assert_eq!(r.status, StatusCode::OK, "{path}");
    let csp = r.header(header::CONTENT_SECURITY_POLICY);
    assert!(csp.starts_with("sandbox allow-scripts") && !csp.contains("allow-same-origin"), "{csp}");
    assert_eq!(r.header(header::REFERRER_POLICY), "no-referrer");
    let base = path.trim_end_matches("index.html");
    assert_eq!(
        a.get_untrusted(&format!("{base}css/a.css"), None).await.header(header::CONTENT_TYPE),
        "text/css"
    );
    assert_eq!(a.get_untrusted(&format!("{base}docs"), None).await.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(a.get_untrusted(&format!("{base}../../x"), None).await.status, StatusCode::NOT_FOUND);
    assert_eq!(a.get_untrusted("/c/fake-ticket/index.html", None).await.status, StatusCode::FORBIDDEN);

    // HTML file uploaded in the file manager: never run (sandbox without scripts)
    let r = a
        .raw(
            &g,
            "/api/t/alfa/p/com.mosaikit.files/files/upload?name=page.html",
            b"<script>alert(1)</script>".to_vec(),
        )
        .await;
    let fid = r.json()["id"].as_str().unwrap().to_string();
    let url = a
        .call(Some(&g), Method::POST, &format!("/api/t/alfa/p/com.mosaikit.files/ticket/{fid}"), None)
        .await
        .json()["url"]
        .as_str()
        .unwrap()
        .to_string();
    let r = a.get_untrusted(url.trim_start_matches(&a.t.cfg.public_url), None).await;
    let csp = r.header(header::CONTENT_SECURITY_POLICY);
    assert!(csp.starts_with("sandbox allow-downloads") && !csp.contains("allow-scripts"), "{csp}");
    // download from the app: always attachment octet-stream
    let r = a
        .call(Some(&g), Method::GET, &format!("/api/t/alfa/p/com.mosaikit.files/files/{fid}/content"), None)
        .await;
    assert_eq!(r.header(header::CONTENT_TYPE), "application/octet-stream");
    assert!(r.header(header::CONTENT_DISPOSITION).starts_with("attachment"));
}

#[tokio::test]
async fn public_links_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    a.t.install("files").await;
    a.t.tenant("alfa").await;
    let g = a.login("alfa", "alfa-manager", PASSWORD).await;
    let n = a
        .call(
            Some(&g),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": "Notice", "body": "<b>text</b>" } })),
        )
        .await;
    let rid = n.json()["id"].as_str().unwrap().to_string();
    let l =
        a.call(Some(&g), Method::POST, &format!("/api/t/alfa/resources/{rid}/links"), Some(json!({}))).await;
    assert_eq!(l.status, StatusCode::OK, "{}", l.text());
    let path = l.json()["url"].as_str().unwrap().trim_start_matches(&a.t.cfg.public_url).to_string();
    let r = a.get_untrusted(&path, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.text().contains("Notice") && r.text().contains("&lt;b&gt;text&lt;/b&gt;"), "content escaped");
    assert!(r.header(header::CONTENT_SECURITY_POLICY).contains("default-src 'none'"));
    let api = a.get_untrusted(&format!("{path}api"), None).await.json();
    assert_eq!(api["values"]["title"], "Notice");
    let views: i64 = mosaikit_db::query_scalar("select view_count from core.public_links")
        .fetch_one(&a.t.db)
        .await
        .unwrap();
    assert_eq!(views, 1);

    // with password
    let l = a
        .call(
            Some(&g),
            Method::POST,
            &format!("/api/t/alfa/resources/{rid}/links"),
            Some(json!({ "password": "open123" })),
        )
        .await;
    let ppath = l.json()["url"].as_str().unwrap().trim_start_matches(&a.t.cfg.public_url).to_string();
    let r = a.get_untrusted(&ppath, None).await;
    assert!(r.text().contains("Protected content"));
    assert_eq!(a.get_untrusted(&format!("{ppath}api"), None).await.status, StatusCode::NOT_FOUND);
    let wrong = Request::builder()
        .method(Method::POST)
        .uri(format!("{ppath}unlock"))
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from("password=wrong-pass"))
        .unwrap();
    assert_eq!(send(&a.untrusted, wrong).await.status, StatusCode::UNAUTHORIZED);
    let right = Request::builder()
        .method(Method::POST)
        .uri(format!("{ppath}unlock"))
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from("password=open123"))
        .unwrap();
    let r = send(&a.untrusted, right).await;
    let cookie = r.header(header::SET_COOKIE);
    assert!(cookie.contains("HttpOnly"), "{cookie}");
    let r = a.get_untrusted(&ppath, Some(cookie.split(';').next().unwrap())).await;
    assert!(r.text().contains("Notice"));

    // publicly shared folder
    let f = a
        .call(
            Some(&g),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.files/files/folder",
            Some(json!({ "name": "Public" })),
        )
        .await
        .json();
    let fid = f["id"].as_str().unwrap().to_string();
    a.raw(
        &g,
        &format!("/api/t/alfa/p/com.mosaikit.files/files/upload?parent={fid}&name=readme.txt"),
        b"hello".to_vec(),
    )
    .await;
    let l =
        a.call(Some(&g), Method::POST, &format!("/api/t/alfa/resources/{fid}/links"), Some(json!({}))).await;
    let fpath = l.json()["url"].as_str().unwrap().trim_start_matches(&a.t.cfg.public_url).to_string();
    let page = a.get_untrusted(&fpath, None).await.text();
    assert!(page.contains("readme.txt"));
    let href = page.split("href=\"").nth(1).unwrap().split('"').next().unwrap().to_string();
    let file = a.get_untrusted(&href, None).await;
    assert_eq!(file.body, b"hello");
    // a file not covered by the link
    let other = a
        .raw(&g, "/api/t/alfa/p/com.mosaikit.files/files/upload?name=private.txt", b"x".to_vec())
        .await
        .json();
    let forged = href.replace(href.split('/').nth(4).unwrap(), other["id"].as_str().unwrap());
    assert_eq!(a.get_untrusted(&forged, None).await.status, StatusCode::NOT_FOUND);

    // revocation
    let links =
        a.call(Some(&g), Method::GET, &format!("/api/t/alfa/resources/{rid}/links"), None).await.json();
    for l in links.as_array().unwrap() {
        a.call(Some(&g), Method::DELETE, &format!("/api/t/alfa/links/{}", l["id"].as_str().unwrap()), None)
            .await;
    }
    assert_eq!(a.get_untrusted(&path, None).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn base_path_from_a_single_url() {
    let a = App::with(
        start_with(|c| {
            c.url = "http://127.0.0.1:9100/mosaikit".into();
        })
        .await,
    );
    assert_eq!(a.t.cfg.plugin_url, "http://127.0.0.1:9101/mosaikit");
    // API and UI only under the base path
    assert_eq!(a.call(None, Method::GET, "/mosaikit/api/health", None).await.status, StatusCode::OK);
    assert_eq!(a.call(None, Method::GET, "/api/health", None).await.status, StatusCode::NOT_FOUND);
    let r = a.call(None, Method::GET, "/mosaikit", None).await;
    assert_eq!(r.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(r.header(header::LOCATION), "/mosaikit/");
    assert_eq!(a.call(None, Method::GET, "/mosaikit/", None).await.status, StatusCode::OK);
    // session cookie limited to the base path
    let r = a
        .call(
            None,
            Method::POST,
            "/mosaikit/api/auth/admin/login",
            Some(json!({ "username": "admin", "password": ADMIN_PASSWORD })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert!(r.header(header::SET_COOKIE).contains("Path=/mosaikit/"));
    assert_eq!(r.json()["plugin_url"], "http://127.0.0.1:9101/mosaikit");
    // origin of the plugins: same base
    assert_eq!(a.get_untrusted("/ui/x/", None).await.status, StatusCode::NOT_FOUND);
    let r = a.get_untrusted("/mosaikit/ui/nonexistent/", None).await;
    assert_eq!(r.text(), "plugin not active");
}

#[tokio::test]
async fn brand_of_the_distribution() {
    let brand = tempfile::tempdir().unwrap();
    std::fs::write(brand.path().join("logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
    std::fs::write(
        brand.path().join("brand.toml"),
        "name = \"Atlas <beta>\"\nversion = \"2.0.0\"\nlogo = \"logo.svg\"\ntagline = \"territorial data\"\n[colors]\naccent = \"#1e88e5\"\n",
    )
    .unwrap();
    let dir = brand.path().to_path_buf();
    let a = App::with(start_with(move |c| c.brand = Some(dir)).await);
    let b = a.call(None, Method::GET, "/api/brand", None).await.json();
    assert_eq!(b["name"], "Atlas <beta>");
    assert_eq!(b["version"], "2.0.0");
    assert_eq!(b["logo"], true);
    let logo = a.call(None, Method::GET, "/brand/logo", None).await;
    assert_eq!(logo.status, StatusCode::OK);
    assert!(logo.header(header::CONTENT_TYPE).starts_with("image/svg"));
    assert!(logo.header(header::CONTENT_SECURITY_POLICY).contains("sandbox"));
    // without a favicon of its own: the default one
    assert_eq!(a.call(None, Method::GET, "/brand/favicon", None).await.status, StatusCode::OK);
    assert_eq!(a.call(None, Method::GET, "/brand/other", None).await.status, StatusCode::NOT_FOUND);
    let page = a.call(None, Method::GET, "/", None).await.text();
    if page.contains("<title>") && !page.contains("UI not built") {
        assert!(page.contains("<title>Atlas &lt;beta&gt;</title>"), "{page}");
        assert!(page.contains("--acc:#1e88e5;"), "{page}");
    }
}

#[tokio::test]
async fn administrator_sign_in_with_second_factor() {
    use mosaikit_kernel::totp;
    let a = App::with(start_with(|c| c.admin_totp = true).await);
    // tenants of the sign-in page: public, without the system tenant
    let r = a.call(None, Method::GET, "/api/auth/tenants", None).await;
    assert_eq!((r.status, r.json()), (StatusCode::OK, json!([])));

    let r = a
        .call(
            None,
            Method::POST,
            "/api/auth/admin/login",
            Some(json!({ "username": "admin", "password": ADMIN_PASSWORD })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["pending"], "totp_setup");
    assert!(r.json().get("user").is_none());
    let pending = Session {
        cookie: r.header(header::SET_COOKIE).split(';').next().unwrap().to_string(),
        csrf: r.json()["csrf"].as_str().unwrap().to_string(),
    };
    // the pending session does not open the APIs
    assert_eq!(
        a.call(Some(&pending), Method::GET, "/api/session", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        a.call(Some(&pending), Method::GET, "/api/admin/tenants", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    let no_csrf = Session { cookie: pending.cookie.clone(), csrf: String::new() };
    assert_eq!(
        a.call(Some(&no_csrf), Method::POST, "/api/auth/totp/setup", None).await.status,
        StatusCode::FORBIDDEN
    );
    let setup = a.call(Some(&pending), Method::POST, "/api/auth/totp/setup", None).await.json();
    assert!(setup["qr_svg"].as_str().unwrap().contains("<svg"));
    let secret = totp::base32_decode(setup["secret"].as_str().unwrap()).unwrap();
    let code = totp::code(&secret, totp::current_step());
    let r =
        a.call(Some(&pending), Method::POST, "/api/auth/totp/enable", Some(json!({ "code": code }))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["recovery_codes"].as_array().unwrap().len(), 10);
    assert_eq!(r.json()["user"]["is_system_admin"], true);
    let s = Session {
        cookie: r.header(header::SET_COOKIE).split(';').next().unwrap().to_string(),
        csrf: r.json()["csrf"].as_str().unwrap().to_string(),
    };
    assert_ne!(s.cookie, pending.cookie, "new token after the second factor");
    assert_eq!(a.call(Some(&s), Method::GET, "/api/session", None).await.status, StatusCode::OK);
    assert_eq!(
        a.call(Some(&pending), Method::POST, "/api/auth/totp/setup", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    // no workspace for the Administrator, but their overview
    assert_eq!(
        a.call(Some(&s), Method::GET, "/api/t/system/context", None).await.status,
        StatusCode::FORBIDDEN
    );
    let o = a.call(Some(&s), Method::GET, "/api/admin/overview", None).await.json();
    assert_eq!((o["tenants"].as_i64(), o["administrators"].as_i64()), (Some(0), Some(1)));
}

#[tokio::test]
async fn errors_with_a_stable_code() {
    let a = App::new().await;
    a.t.tenant("alfa").await;
    let r = a
        .call(
            None,
            Method::POST,
            "/api/auth/login",
            Some(json!({ "tenant": "alfa", "username": "alfa-manager", "password": "wrong-pass-123" })),
        )
        .await;
    assert_eq!((r.status, r.json()["code"].as_str()), (StatusCode::UNAUTHORIZED, Some("wrong_credentials")));
    assert!(r.json()["error"].is_string(), "the message stays, as a fallback");

    let s = a.login("alfa", "alfa-manager", PASSWORD).await;
    let r = a
        .call(Some(&s), Method::POST, "/api/me/password", Some(json!({ "old": PASSWORD, "new": "short" })))
        .await;
    assert_eq!((r.status, r.json()["code"].as_str()), (StatusCode::BAD_REQUEST, Some("password_too_short")));
    let r = a
        .call(
            Some(&s),
            Method::POST,
            "/api/me/password",
            Some(json!({ "old": "not-this-one", "new": "long-enough-1" })),
        )
        .await;
    assert_eq!(r.json()["code"], "wrong_password");
    // without a specific code: the one of the category
    let r = a.call(Some(&s), Method::GET, "/api/admin/tenants", None).await;
    assert_eq!((r.status, r.json()["code"].as_str()), (StatusCode::FORBIDDEN, Some("forbidden")));

    // too many attempts
    let mut last = None;
    for _ in 0..10 {
        last = Some(
            a.call(
                None,
                Method::POST,
                "/api/auth/login",
                Some(json!({ "tenant": "alfa", "username": "alfa-manager", "password": "wrong-pass-123" })),
            )
            .await,
        );
    }
    let r = last.unwrap();
    assert_eq!(
        (r.status, r.json()["code"].as_str()),
        (StatusCode::TOO_MANY_REQUESTS, Some("too_many_attempts"))
    );
}

#[tokio::test]
async fn sign_in_page_knows_the_themes() {
    let a = App::new().await;
    a.t.tenant("alfa").await;
    a.t.tenant("beta").await;
    // public, before any session: theme and top bar of the platform, theme of every tenant
    let brand = a.call(None, Method::GET, "/api/brand", None).await.json();
    assert_eq!(brand["theme"], "mosaikit");
    assert_eq!(brand["band"]["search"], true);
    let themes = |v: Value| {
        v.as_array()
            .unwrap()
            .iter()
            .map(|t| (t["slug"].as_str().unwrap().to_string(), t["theme"].as_str().unwrap().to_string()))
            .collect::<Vec<_>>()
    };
    let r = a.call(None, Method::GET, "/api/auth/tenants", None).await;
    assert_eq!(themes(r.json()), [("alfa".into(), "mosaikit".into()), ("beta".into(), "mosaikit".into())]);
    // a tenant with a theme of its own; the others follow the platform
    let m = a.login("alfa", "alfa-manager", PASSWORD).await;
    let r =
        a.call(Some(&m), Method::PUT, "/api/t/alfa/manage/theme", Some(json!({ "preset": "tessera" }))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let admin = a.admin().await;
    let r = a.call(Some(&admin), Method::PUT, "/api/admin/theme", Some(json!({ "preset": "italia" }))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a.call(None, Method::GET, "/api/auth/tenants", None).await;
    assert_eq!(themes(r.json()), [("alfa".into(), "tessera".into()), ("beta".into(), "italia".into())]);
    assert_eq!(a.call(None, Method::GET, "/api/brand", None).await.json()["theme"], "italia");
}

#[tokio::test]
async fn settings_on_three_levels_over_http() {
    let a = App::new().await;
    a.t.tenant("alfa").await;
    let admin = a.admin().await;
    let m = a.login("alfa", "alfa-manager", PASSWORD).await;

    // the Administrator: values and "tenants may customize it"
    let r = a
        .call(
            Some(&admin),
            Method::PUT,
            "/api/admin/settings",
            Some(json!({ "values": { "security.password_min": 12, "identity.name": "Atlas" },
                         "customizable": { "identity.welcome": false } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let pm =
        r.json().as_array().unwrap().iter().find(|s| s["key"] == "security.password_min").cloned().unwrap();
    assert_eq!(
        (pm["value"].clone(), pm["kind"].clone(), pm["rule"].clone()),
        (json!(12), json!("limit"), json!("min"))
    );
    // nobody else
    assert_eq!(
        a.call(Some(&m), Method::GET, "/api/admin/settings", None).await.status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(a.call(None, Method::GET, "/api/brand", None).await.json()["name"], "Atlas");

    // the Tenant Manager: limits, locks, values of its own
    let cfg = a.call(Some(&m), Method::GET, "/api/t/alfa/manage/config", None).await.json();
    let row = |key: &str| cfg.as_array().unwrap().iter().find(|s| s["key"] == key).cloned().unwrap();
    assert_eq!(row("security.password_min")["platform"], 12);
    assert_eq!(row("identity.welcome")["locked"], true);
    assert_eq!(row("band")["locked"], true);
    let put = |values: Value| {
        a.call(Some(&m), Method::PUT, "/api/t/alfa/manage/config", Some(json!({ "values": values })))
    };
    let r = put(json!({ "security.password_min": 11 })).await;
    assert_eq!(
        (r.status, r.json()["code"].clone()),
        (StatusCode::BAD_REQUEST, json!("setting_beyond_platform"))
    );
    let r = put(json!({ "identity.welcome": "x" })).await;
    assert_eq!((r.status, r.json()["code"].clone()), (StatusCode::FORBIDDEN, json!("setting_locked")));
    let r =
        put(json!({ "lang.enabled": ["it"], "lang.default": "it", "identity.name": "Comune di Alfa" })).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let ctx = a.call(Some(&m), Method::GET, "/api/t/alfa/context", None).await.json();
    assert_eq!(ctx["config"]["lang.enabled"], json!(["it"]));
    assert_eq!(ctx["config"]["lang.default"], json!("it"));
    let session = a.call(Some(&m), Method::GET, "/api/session", None).await.json();
    assert_eq!(session["config"]["security.password_min"], 12);

    // the sign-in page of the tenant: name, languages, logo
    let upload = |slot: &str, body: &'static str| {
        Request::builder()
            .method(Method::PUT)
            .uri(format!("/api/t/alfa/manage/identity/{slot}"))
            .header(header::COOKIE, &m.cookie)
            .header("x-csrf-token", &m.csrf)
            .body(Body::from(body))
            .unwrap()
    };
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"4\" height=\"4\"/></svg>";
    assert_eq!(send(&a.app, upload("logo_light", svg)).await.status, StatusCode::OK);
    let list = a.call(None, Method::GET, "/api/auth/tenants", None).await.json();
    let alfa = &list[0];
    assert_eq!(alfa["name"], "Comune di Alfa");
    assert_eq!(alfa["languages"], json!(["it"]));
    assert_eq!(alfa["logo_light"], true);
    let logo = a.call(None, Method::GET, "/api/auth/tenants/alfa/logo/logo_light", None).await;
    assert_eq!(logo.status, StatusCode::OK);
    assert_eq!(logo.header(header::CONTENT_TYPE), "image/svg+xml");
    assert!(logo.header(header::CONTENT_SECURITY_POLICY).contains("sandbox"));
    let r = send(&a.app, upload("logo_dark", "<svg><script>alert(1)</script></svg>")).await;
    assert_eq!((r.status, r.json()["code"].clone()), (StatusCode::BAD_REQUEST, json!("image_unsafe")));
    let r = a.call(None, Method::GET, "/api/auth/tenants/alfa/logo/logo_dark", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn keys_never_go_back_to_the_browser() {
    let a = App::new().await;
    let g = a.t.tenant("alfa").await;
    a.t.member(&g, "anna").await;
    let admin = a.admin().await;
    let anna = a.login("alfa", "anna", PASSWORD).await;
    let body = json!({ "value": "sk-platform-abcd", "shared": true });
    let r = a.call(Some(&admin), Method::PUT, "/api/admin/keys/ai-hosted", Some(body)).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert!(!r.text().contains("sk-platform"), "{}", r.text());
    let mine = a.call(Some(&anna), Method::GET, "/api/t/alfa/me/keys", None).await.json();
    let ai = mine.as_array().unwrap().iter().find(|k| k["service"] == "ai-hosted").cloned().unwrap();
    assert_eq!(ai["set"], false);
    assert_eq!(ai["in_use"], "platform");
    let body = json!({ "value": "my-own-key-wxyz" });
    let r = a.call(Some(&anna), Method::PUT, "/api/t/alfa/me/keys/ai-hosted", Some(body)).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let ai = r.json().as_array().unwrap().iter().find(|k| k["service"] == "ai-hosted").cloned().unwrap();
    assert_eq!(ai["hint"], "wxyz");
    assert_eq!(ai["in_use"], "own");
    assert!(!r.text().contains("my-own"));
    // a person does not see or change the keys of the tenant
    let r = a.call(Some(&anna), Method::GET, "/api/t/alfa/manage/keys", None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = a.call(Some(&anna), Method::DELETE, "/api/t/alfa/me/keys/ai-hosted", None).await;
    assert_eq!(r.status, StatusCode::OK);
}

#[tokio::test]
async fn remember_me_and_embedding_of_public_pages() {
    let a = App::new().await;
    a.t.install("notes").await;
    a.t.tenant("alfa").await;
    let admin = a.admin().await;
    let m = a.login("alfa", "alfa-manager", PASSWORD).await;
    let values = json!({ "values": { "security.session_hours": 4, "security.remember_days": 10,
                                     "embed.sites": ["https://www.alfa.example", "https://intranet.example"] } });
    let r = a.call(Some(&admin), Method::PUT, "/api/admin/settings", Some(values)).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let sign_in = |remember: bool| json!({ "tenant": "alfa", "username": "alfa-manager", "password": PASSWORD, "remember": remember });
    let r = a.call(None, Method::POST, "/api/auth/login", Some(sign_in(false))).await;
    let cookie = r.header(header::SET_COOKIE);
    assert!(cookie.contains(&format!("Max-Age={}", 4 * 3600)), "{cookie}");
    let r = a.call(None, Method::POST, "/api/auth/login", Some(sign_in(true))).await;
    assert!(r.header(header::SET_COOKIE).contains(&format!("Max-Age={}", 10 * 86400)));

    // the tenant allows one of the sites of the platform: only that one embeds its public pages
    let only = json!({ "values": { "embed.sites": ["https://www.alfa.example"] } });
    let r = a.call(Some(&m), Method::PUT, "/api/t/alfa/manage/config", Some(only)).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let note = json!({ "values": { "title": "Open day" } });
    let n = a.call(Some(&m), Method::POST, "/api/t/alfa/p/com.mosaikit.notes/r/notes", Some(note)).await;
    let rid = n.json()["id"].as_str().unwrap().to_string();
    let l =
        a.call(Some(&m), Method::POST, &format!("/api/t/alfa/resources/{rid}/links"), Some(json!({}))).await;
    let path = l.json()["url"].as_str().unwrap().trim_start_matches(&a.t.cfg.public_url).to_string();
    let csp = a.get_untrusted(&path, None).await.header(header::CONTENT_SECURITY_POLICY);
    assert!(csp.contains("frame-ancestors https://www.alfa.example"), "{csp}");
    assert!(!csp.contains("intranet"), "{csp}");
    // a site the platform does not allow is refused
    let evil = json!({ "values": { "embed.sites": ["https://evil.example"] } });
    let r = a.call(Some(&m), Method::PUT, "/api/t/alfa/manage/config", Some(evil)).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn notifications_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let g = a.t.tenant("alfa").await;
    a.t.member(&g, "anna").await;
    let bruno_user = a.t.member(&g, "bruno").await;
    let anna = a.login("alfa", "anna", PASSWORD).await;
    let bruno = a.login("alfa", "bruno", PASSWORD).await;

    // the live stream starts with the number of unread notifications
    let req = Request::builder()
        .uri("/api/me/stream")
        .header(header::COOKIE, &bruno.cookie)
        .body(Body::empty())
        .unwrap();
    let res = a.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers()[header::CONTENT_TYPE].to_str().unwrap().starts_with("text/event-stream"));
    let mut body = res.into_body();
    let first = tokio::time::timeout(std::time::Duration::from_secs(5), body.frame())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let text = String::from_utf8_lossy(first.data_ref().unwrap()).into_owned();
    assert!(text.contains("\"event\":\"count\"") && text.contains("\"unread\":0"), "{text}");

    // Anna shares a note with Bruno: a notification, also on the stream
    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": "Plan" } })),
        )
        .await;
    let rid = r.json()["id"].as_str().unwrap().to_string();
    let r = a
        .call(
            Some(&anna),
            Method::PUT,
            &format!("/api/t/alfa/resources/{rid}/grants"),
            Some(json!({ "principal_type": "user", "principal_id": bruno_user.user_id, "level": "read" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let next = tokio::time::timeout(std::time::Duration::from_secs(5), body.frame())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let text = String::from_utf8_lossy(next.data_ref().unwrap()).into_owned();
    assert!(text.contains("\"event\":\"notification\"") && text.contains("\"unread\":1"), "{text}");

    let list = a.call(Some(&bruno), Method::GET, "/api/me/notifications?unread=true&kind=share", None).await;
    assert_eq!(list.status, StatusCode::OK, "{}", list.text());
    let list = list.json();
    assert_eq!(list["unread"], 1);
    let id = list["items"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(list["items"][0]["data"]["code"], "share.received");
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/me/notifications", None).await.json()["items"],
        json!([])
    );
    // Anna cannot touch the notification of Bruno
    let r =
        a.call(Some(&anna), Method::POST, "/api/me/notifications/read", Some(json!({ "ids": [id] }))).await;
    assert_eq!(r.json()["changed"], 0);
    let r =
        a.call(Some(&bruno), Method::POST, "/api/me/notifications/read", Some(json!({ "ids": [id] }))).await;
    assert_eq!((r.json()["changed"].clone(), r.json()["unread"].clone()), (json!(1), json!(0)));
    assert_eq!(
        a.call(Some(&bruno), Method::GET, "/api/me/notifications/count", None).await.json()["unread"],
        0
    );

    // preferences, with the email address
    let r = a
        .call(
            Some(&bruno),
            Method::PUT,
            "/api/me/notifications/prefs",
            Some(json!({ "address": "nope", "mode": "immediate" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(r.json()["code"], "email_invalid");
    let r = a
        .call(
            Some(&bruno),
            Method::PUT,
            "/api/me/notifications/prefs",
            Some(json!({ "address": "bruno@example.org", "mode": "off", "kinds": { "share": false } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let p = a.call(Some(&bruno), Method::GET, "/api/me/notifications/prefs", None).await.json();
    assert_eq!((p["mode"].clone(), p["address"].clone()), (json!("off"), json!("bruno@example.org")));

    // a plugin notifies the person using it; an invalid place is refused
    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/notify",
            Some(json!({ "title": "Saved", "at": "notes/1" })),
        )
        .await;
    assert_eq!((r.status, r.json()["sent"].clone()), (StatusCode::OK, json!(1)));
    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/notify",
            Some(json!({ "title": "x", "at": "<b>" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/notify",
            Some(json!({ "title": "To all", "resource": rid })),
        )
        .await;
    assert_eq!(r.json()["sent"], 1, "Bruno can see the note");
    let mine = a.call(Some(&anna), Method::GET, "/api/me/notifications", None).await.json();
    let ids: Vec<Value> = mine["items"].as_array().unwrap().iter().map(|x| x["id"].clone()).collect();
    let r =
        a.call(Some(&anna), Method::POST, "/api/me/notifications/delete", Some(json!({ "ids": ids }))).await;
    assert_eq!(r.json()["deleted"], 1);
    let r = a.call(Some(&bruno), Method::POST, "/api/me/notifications/read-all", None).await;
    assert_eq!(r.status, StatusCode::OK);
}

#[tokio::test]
async fn email_of_the_platform_over_http() {
    let a = App::new().await;
    let fake = mosaikit_kernel::testing::FakeSmtp::start().await;
    let admin = a.admin().await;
    a.t.tenant("alfa").await;
    let g = a.login("alfa", "alfa-manager", PASSWORD).await;
    assert_eq!(a.call(Some(&g), Method::GET, "/api/admin/email", None).await.status, StatusCode::FORBIDDEN);
    let r = a
        .call(Some(&admin), Method::POST, "/api/admin/email/test", Some(json!({ "to": "p@example.org" })))
        .await;
    assert_eq!(r.json()["code"], "email_not_configured");
    let r = a
        .call(
            Some(&admin),
            Method::PUT,
            "/api/admin/email",
            Some(json!({ "host": "127.0.0.1", "port": fake.port, "security": "none", "username": "robot",
                         "sender": "Mosaikit <noreply@example.org>", "footer": "Bye", "password": "very-secret" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let v = a.call(Some(&admin), Method::GET, "/api/admin/email", None).await;
    assert!(!v.text().contains("very-secret"));
    assert_eq!(
        (v.json()["has_password"].clone(), v.json()["configured"].clone()),
        (json!(true), json!(true))
    );
    let r = a
        .call(Some(&admin), Method::POST, "/api/admin/email/test", Some(json!({ "to": "p@example.org" })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(fake.mails.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn people_and_permissions_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let g = a.t.tenant("alfa").await;
    let anna_user = a.t.member(&g, "anna").await;
    let bruno_user = a.t.member(&g, "bruno").await;
    let mgr = a.login("alfa", "alfa-manager", PASSWORD).await;
    let anna = a.login("alfa", "anna", PASSWORD).await;
    let bruno = a.login("alfa", "bruno", PASSWORD).await;
    const NOTES: &str = "/api/t/alfa/p/com.mosaikit.notes/r/notes";

    // the context says what each person may do in each plugin
    let ctx = a.call(Some(&anna), Method::GET, "/api/t/alfa/context", None).await.json();
    assert!(ctx["perms"]["com.mosaikit.notes"].as_array().unwrap().iter().any(|p| p == "create"));
    assert_eq!(ctx["plugins"].as_array().unwrap().len(), 1);

    // a profile that may only use the app, given to Anna: creating is refused with a code
    let p = a
        .call(Some(&mgr), Method::POST, "/api/t/alfa/manage/profiles", Some(json!({ "name": "Reader" })))
        .await
        .json();
    let pid = p["id"].as_str().unwrap().to_string();
    let r = a
        .call(
            Some(&mgr),
            Method::PUT,
            &format!("/api/t/alfa/manage/profiles/{pid}"),
            Some(json!({ "plugins": { "com.mosaikit.notes": ["use"] } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a
        .call(
            Some(&mgr),
            Method::PUT,
            &format!("/api/t/alfa/manage/members/{}/profile", anna_user.user_id),
            Some(json!({ "profile": pid })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a.call(Some(&anna), Method::POST, NOTES, Some(json!({ "values": { "title": "x" } }))).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(r.json()["code"], "missing_permission");
    // a personal grant gives it back
    let r = a
        .call(
            Some(&mgr),
            Method::PUT,
            "/api/t/alfa/manage/plugins/com.mosaikit.notes/grants",
            Some(json!({ "principal_type": "user", "principal_id": anna_user.user_id, "perms": ["create"] })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a.call(Some(&anna), Method::POST, NOTES, Some(json!({ "values": { "title": "Plan" } }))).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
    let rid = r.json()["id"].as_str().unwrap().to_string();
    let access = a
        .call(Some(&mgr), Method::GET, "/api/t/alfa/manage/plugins/com.mosaikit.notes/access", None)
        .await
        .json();
    assert_eq!(access["grants"].as_array().unwrap().len(), 1);
    // a User cannot manage
    let r = a.call(Some(&anna), Method::GET, "/api/t/alfa/manage/profiles", None).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // the detail of a person, with permissions, sessions and activity
    let d = a
        .call(Some(&mgr), Method::GET, &format!("/api/t/alfa/manage/members/{}", anna_user.user_id), None)
        .await;
    assert_eq!(d.status, StatusCode::OK, "{}", d.text());
    assert_eq!(d.json()["member"]["profile"], "Reader");
    let s = a
        .call(
            Some(&mgr),
            Method::GET,
            &format!("/api/t/alfa/manage/members/{}/sessions", anna_user.user_id),
            None,
        )
        .await
        .json();
    assert!(!s.as_array().unwrap().is_empty());

    // Bruno asks to see the note; Anna approves
    let r = a
        .call(
            Some(&bruno),
            Method::POST,
            &format!("/api/t/alfa/resources/{rid}/request"),
            Some(json!({ "level": "read", "message": "please" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let rq = r.json()["id"].as_str().unwrap().to_string();
    let list = a.call(Some(&anna), Method::GET, "/api/t/alfa/requests", None).await.json();
    assert_eq!(list.as_array().unwrap().len(), 1);
    let r = a.call(Some(&anna), Method::POST, &format!("/api/t/alfa/requests/{rq}/approve"), None).await;
    assert_eq!(r.json()["status"], "approved");
    let r = a.call(Some(&bruno), Method::GET, &format!("/api/t/alfa/resources/{rid}"), None).await;
    assert_eq!(r.status, StatusCode::OK);

    // suspension: Bruno is out of the tenant until reactivated
    let r = a
        .call(
            Some(&mgr),
            Method::PUT,
            &format!("/api/t/alfa/manage/members/{}/status", bruno_user.user_id),
            Some(json!({ "suspended": true })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(
        a.call(Some(&bruno), Method::GET, "/api/t/alfa/context", None).await.status,
        StatusCode::FORBIDDEN
    );

    // the Administrator: directory, a link to choose a new password, used from the public page
    let admin = a.admin().await;
    let people = a.call(Some(&admin), Method::GET, "/api/admin/people", None).await.json();
    assert!(people.as_array().unwrap().iter().any(|p| p["username"] == "anna"));
    let link = a
        .call(
            Some(&admin),
            Method::POST,
            &format!("/api/admin/people/{}/reset-link", anna_user.user_id),
            None,
        )
        .await
        .json();
    let token = link["url"].as_str().unwrap().rsplit('/').next().unwrap().to_string();
    let info = a.call(None, Method::GET, &format!("/api/auth/reset/{token}"), None).await.json();
    assert_eq!(info["username"], "anna");
    let r = a
        .call(
            None,
            Method::POST,
            "/api/auth/reset",
            Some(json!({ "token": token, "password": "brand-new-pass-1" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    // the link closed the old sessions
    assert_eq!(a.call(Some(&anna), Method::GET, "/api/session", None).await.status, StatusCode::UNAUTHORIZED);
    let anna = a.login("alfa", "anna", "brand-new-pass-1").await;
    let r = a
        .call(
            None,
            Method::POST,
            "/api/auth/reset",
            Some(json!({ "token": token, "password": "again-pass-2222" })),
        )
        .await;
    assert_eq!(r.json()["code"], "reset_expired");
    // not for Users
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/admin/people", None).await.status,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn plugins_in_the_tenants_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let g = a.t.tenant("alfa").await;
    a.t.member(&g, "anna").await;
    let admin = a.admin().await;
    let mgr = a.login("alfa", "alfa-manager", PASSWORD).await;
    let anna = a.login("alfa", "anna", PASSWORD).await;
    const NOTES_ID: &str = "com.mosaikit.notes";

    // an extension of Notes, uploaded and turned on by the Administrator
    let manifest = r#"
id = "com.example.review"
name = "Review"
version = "0.1.0"
icon = "badge-check"
[contribution]
icon = "✔"
label = "Review"
[extends]
plugin = "com.mosaikit.notes"
[[extension.fields]]
resource = "notes"
key = "reviewed"
label = "Reviewed"
kind = "bool"
[[extension.actions]]
resource = "notes"
key = "approve"
label = "Approve"
set = { reviewed = true }
[[config]]
key = "token"
label = "Token"
kind = "secret"
"#;
    let files = std::collections::BTreeMap::from([("plugin.toml".to_string(), manifest.as_bytes().to_vec())]);
    let pkg = mosaikit_mskp::pack(&files, Some(&mosaikit_kernel::testing::test_key())).unwrap();
    let r = a.raw(&admin, "/api/admin/plugins", pkg).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a.call(Some(&admin), Method::POST, "/api/admin/plugins/com.example.review/activate", None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let list = a.call(Some(&admin), Method::GET, "/api/admin/plugins", None).await.json();
    let review = list.as_array().unwrap().iter().find(|p| p["id"] == "com.example.review").unwrap().clone();
    assert_eq!(
        (review["kind"].clone(), review["icon_name"].clone()),
        (json!("extension"), json!("badge-check"))
    );
    assert_eq!(review["extends"], NOTES_ID);

    // the Tenant Manager sees the plugins available to the tenant, the others do not
    let mine = a.call(Some(&mgr), Method::GET, "/api/t/alfa/manage/plugins", None).await.json();
    assert_eq!(mine.as_array().unwrap().len(), 2);
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/t/alfa/manage/plugins", None).await.status,
        StatusCode::FORBIDDEN
    );

    // fields and actions of the extension, through the plugin it extends
    let note = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": "x" } })),
        )
        .await
        .json();
    let id = note["id"].as_str().unwrap().to_string();
    let ext =
        a.call(Some(&anna), Method::GET, "/api/t/alfa/p/com.mosaikit.notes/ext/notes", None).await.json();
    assert_eq!(ext[0]["fields"][0]["key"], "reviewed");
    let r = a
        .call(
            Some(&anna),
            Method::POST,
            &format!("/api/t/alfa/p/com.mosaikit.notes/ext/notes/{id}/com.example.review/approve"),
            None,
        )
        .await;
    assert_eq!(r.json()["values"]["reviewed"], true, "{}", r.text());
    let v = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/ext/notes/values",
            Some(json!({ "ids": [id] })),
        )
        .await
        .json();
    assert_eq!(v[&id]["com.example.review"]["reviewed"], true);

    // the Tenant Manager turns Notes off: its extension goes with it, the context forgets both
    let r = a
        .call(
            Some(&mgr),
            Method::PUT,
            "/api/t/alfa/manage/plugins/com.mosaikit.notes/on",
            Some(json!({ "on": false })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let ctx = a.call(Some(&anna), Method::GET, "/api/t/alfa/context", None).await.json();
    assert!(ctx["plugins"].as_array().unwrap().is_empty());
    let r = a.call(Some(&anna), Method::GET, "/api/t/alfa/p/com.mosaikit.notes/r/notes", None).await;
    assert_eq!((r.status, r.json()["code"].clone()), (StatusCode::NOT_FOUND, json!("plugin_off")));
    let r = a
        .call(
            Some(&mgr),
            Method::PUT,
            "/api/t/alfa/manage/plugins/com.example.review/on",
            Some(json!({ "on": true })),
        )
        .await;
    assert_eq!(r.json()["code"], "base_off");
    a.call(
        Some(&mgr),
        Method::PUT,
        "/api/t/alfa/manage/plugins/com.mosaikit.notes/on",
        Some(json!({ "on": true })),
    )
    .await;

    // the Administrator: tenants of a plugin, availability, settings, what uninstalling takes away
    let ten =
        a.call(Some(&admin), Method::GET, "/api/admin/plugins/com.mosaikit.notes/tenants", None).await.json();
    let tid = ten["tenants"][0]["tenant_id"].as_str().unwrap().to_string();
    assert_eq!(ten["tenants"][0]["on"], true);
    let r = a
        .call(
            Some(&admin),
            Method::PUT,
            &format!("/api/admin/plugins/com.mosaikit.notes/tenants/{tid}"),
            Some(json!({ "available": false })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let mine = a.call(Some(&mgr), Method::GET, "/api/t/alfa/manage/plugins", None).await.json();
    assert!(mine.as_array().unwrap().iter().all(|p| p["id"] != NOTES_ID));
    assert_eq!(
        a.call(Some(&mgr), Method::GET, "/api/admin/plugins/com.mosaikit.notes/tenants", None).await.status,
        StatusCode::FORBIDDEN
    );
    let c = a
        .call(
            Some(&admin),
            Method::PUT,
            "/api/admin/plugins/com.example.review/config",
            Some(json!({ "secrets": { "token": "abc123" } })),
        )
        .await;
    assert_eq!(c.json()["secrets"], json!(["token"]), "{}", c.text());
    assert!(!c.text().contains("abc123"));
    let of_tenant =
        a.call(Some(&admin), Method::GET, &format!("/api/admin/tenants/{tid}/plugins"), None).await.json();
    let notes = of_tenant.as_array().unwrap().iter().find(|p| p["id"] == NOTES_ID).unwrap().clone();
    assert_eq!((notes["available"].clone(), notes["on"].clone()), (json!(false), json!(false)));
    let impact =
        a.call(Some(&admin), Method::GET, "/api/admin/plugins/com.mosaikit.notes/impact", None).await.json();
    assert_eq!((impact["items"].clone(), impact["extensions"].clone()), (json!(1), json!(["Review"])));
}

#[tokio::test]
async fn trash_log_and_shares_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let g = a.t.tenant("alfa").await;
    let bruno_user = a.t.member(&g, "bruno").await;
    a.t.member(&g, "anna").await;
    let mgr = a.login("alfa", "alfa-manager", PASSWORD).await;
    let anna = a.login("alfa", "anna", PASSWORD).await;
    const NOTES: &str = "/api/t/alfa/p/com.mosaikit.notes/r/notes";

    // a note shared with Bruno and with a public link: it shows in "Shared by me"
    let r = a.call(Some(&anna), Method::POST, NOTES, Some(json!({ "values": { "title": "Plan" } }))).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
    let rid = r.json()["id"].as_str().unwrap().to_string();
    let r = a
        .call(
            Some(&anna),
            Method::PUT,
            &format!("/api/t/alfa/resources/{rid}/grants"),
            Some(json!({ "principal_type": "user", "principal_id": bruno_user.user_id, "level": "read" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a
        .call(Some(&anna), Method::POST, &format!("/api/t/alfa/resources/{rid}/links"), Some(json!({})))
        .await;
    assert!(r.status.is_success(), "{}", r.text());
    let mine = a.call(Some(&anna), Method::GET, "/api/t/alfa/me/shared", None).await.json();
    assert_eq!(mine.as_array().unwrap().len(), 1);
    assert_eq!(mine[0]["shares"], 1);
    assert_eq!(mine[0]["public_links"], 1);

    // the manager revokes everything from the Shares page
    let r = a
        .call(Some(&anna), Method::POST, "/api/t/alfa/manage/resources/revoke", Some(json!({ "ids": [rid] })))
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    let r = a
        .call(Some(&mgr), Method::POST, "/api/t/alfa/manage/resources/revoke", Some(json!({ "ids": [rid] })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json(), json!({ "shares": 1, "links": 1 }));
    assert!(a
        .call(Some(&anna), Method::GET, "/api/t/alfa/me/shared", None)
        .await
        .json()
        .as_array()
        .unwrap()
        .is_empty());

    // delete → trash → restore → delete for good
    let r = a.call(Some(&anna), Method::DELETE, &format!("{NOTES}/{rid}"), None).await;
    assert!(r.status.is_success(), "{}", r.text());
    let tr = a.call(Some(&anna), Method::GET, "/api/t/alfa/trash", None).await.json();
    assert_eq!(tr["retention_days"], 30);
    assert_eq!(tr["items"][0]["title"], "Plan");
    assert_eq!(
        a.call(Some(&anna), Method::GET, &format!("{NOTES}/{rid}"), None).await.status,
        StatusCode::NOT_FOUND
    );
    let r = a.call(Some(&anna), Method::POST, &format!("/api/t/alfa/trash/{rid}/restore"), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(
        a.call(Some(&anna), Method::GET, &format!("{NOTES}/{rid}"), None).await.status,
        StatusCode::OK
    );
    a.call(Some(&anna), Method::DELETE, &format!("{NOTES}/{rid}"), None).await;
    let r = a.call(Some(&anna), Method::DELETE, &format!("/api/t/alfa/trash/{rid}"), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a.call(Some(&anna), Method::POST, &format!("/api/t/alfa/trash/{rid}/restore"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(r.json()["code"], "trash_not_found");

    // a refused sign-in, with the browser of the request
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/login")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::USER_AGENT, "TestBrowser/1.0")
        .body(Body::from(json!({ "tenant": "alfa", "username": "anna", "password": "nope" }).to_string()))
        .unwrap();
    assert_eq!(send(&a.app, req).await.status, StatusCode::UNAUTHORIZED);

    // the Log of the manager: filters, failures, CSV; not for whoever is not a manager
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/t/alfa/manage/log", None).await.status,
        StatusCode::FORBIDDEN
    );
    let log = a.call(Some(&mgr), Method::GET, "/api/t/alfa/manage/log?what=items", None).await.json();
    let actions: Vec<&str> =
        log["events"].as_array().unwrap().iter().map(|e| e["action"].as_str().unwrap()).collect();
    for a in ["resource.create", "resource.delete", "resource.restore", "resource.purge"] {
        assert!(actions.contains(&a), "{a} in {actions:?}");
    }
    let failed = a.call(Some(&mgr), Method::GET, "/api/t/alfa/manage/log?failed=true", None).await.json();
    assert_eq!(failed["events"].as_array().unwrap().len(), 1);
    assert_eq!(failed["events"][0]["action"], "login.failed");
    assert_eq!(failed["events"][0]["agent"], "TestBrowser/1.0");
    let csv = a.call(Some(&mgr), Method::GET, "/api/t/alfa/manage/log.csv?failed=true", None).await;
    assert_eq!(csv.status, StatusCode::OK);
    assert!(csv.header(header::CONTENT_TYPE).starts_with("text/csv"));
    assert!(csv.header(header::CONTENT_DISPOSITION).contains("log-alfa.csv"));
    assert!(csv.text().contains("login.failed"));

    // the Administrator: the platform, one tenant
    let admin = a.admin().await;
    assert_eq!(a.call(Some(&mgr), Method::GET, "/api/admin/log", None).await.status, StatusCode::FORBIDDEN);
    let all =
        a.call(Some(&admin), Method::GET, &format!("/api/admin/log?tenant={}", g.home_tenant_id), None).await;
    assert_eq!(all.status, StatusCode::OK, "{}", all.text());
    assert!(all.json()["events"].as_array().unwrap().iter().all(|e| e["tenant_slug"] == "alfa"));
    let csv = a.call(Some(&admin), Method::GET, "/api/admin/log.csv", None).await;
    assert!(csv.text().contains("time,tenant,person"));
}

#[tokio::test]
async fn quotas_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let g = a.t.tenant("alfa").await;
    a.t.member(&g, "anna").await;
    let admin = a.admin().await;
    let m = a.login("alfa", "alfa-manager", PASSWORD).await;
    let anna = a.login("alfa", "anna", PASSWORD).await;

    // the Administrator: quotas of new tenants and capacity; nobody else
    let r = a
        .call(
            Some(&admin),
            Method::PUT,
            "/api/admin/quotas",
            Some(json!({ "defaults": { "storage": 1000000, "people": 10, "items": null },
                         "capacity": { "storage": 500000 } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let storage =
        r.json()["rows"].as_array().unwrap().iter().find(|x| x["metric"] == "storage").cloned().unwrap();
    assert_eq!((storage["given"].clone(), storage["over"].clone()), (json!(1000000), json!(true)));
    assert_eq!(a.call(Some(&m), Method::GET, "/api/admin/quotas", None).await.status, StatusCode::FORBIDDEN);

    // a quota of the tenant: one note
    let tenant = r.json()["tenants"][0]["id"].as_str().unwrap().to_string();
    let r = a
        .call(
            Some(&admin),
            Method::PUT,
            &format!("/api/admin/tenants/{tenant}/quotas"),
            Some(json!({ "items": { "customized": true, "limit": 1 } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a
        .call(
            Some(&m),
            Method::PUT,
            &format!("/api/admin/tenants/{tenant}/quotas"),
            Some(json!({ "items": { "customized": false } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // at the limit the addition is refused with a stable code
    let note = |title: &str| {
        a.call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": title } })),
        )
    };
    assert_eq!(note("one").await.status, StatusCode::CREATED);
    let r = note("two").await;
    assert_eq!((r.status, r.json()["code"].clone()), (StatusCode::CONFLICT, json!("quota_exceeded")));

    // the Tenant Manager reads the quotas (managed by the platform), the trend, the alerts
    let q = a.call(Some(&m), Method::GET, "/api/t/alfa/manage/quotas", None).await.json();
    let items = q["rows"].as_array().unwrap().iter().find(|x| x["metric"] == "items").cloned().unwrap();
    assert_eq!(
        (items["limit"].clone(), items["used"].clone(), items["percent"].clone()),
        (json!(1), json!(1), json!(100))
    );
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/t/alfa/manage/quotas", None).await.status,
        StatusCode::FORBIDDEN
    );
    let trend = a.call(Some(&m), Method::GET, "/api/t/alfa/manage/usage/trend?days=30", None).await.json();
    assert_eq!(trend.as_array().unwrap().len(), 1);
    let r = a
        .call(
            Some(&m),
            Method::PUT,
            "/api/t/alfa/manage/usage/alerts",
            Some(json!({ "at_80": true, "at_100": true, "forecast": false, "managers": true })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(
        a.call(Some(&m), Method::GET, "/api/t/alfa/manage/usage/alerts", None).await.json()["forecast"],
        false
    );
    let c = a.call(Some(&m), Method::GET, "/api/t/alfa/manage/usage/consumers", None).await.json();
    assert_eq!(c["plugins"][0]["items"], 1);

    // every member: their own usage, the alert of the sidebar
    let mine = a.call(Some(&anna), Method::GET, "/api/t/alfa/usage/mine", None).await.json();
    assert_eq!(mine["items"], 1);
    let near = a.call(Some(&anna), Method::GET, "/api/t/alfa/usage/near", None).await.json();
    assert_eq!(near.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn lifecycle_and_operations_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let admin = a.admin().await;
    // new tenant with a trial period
    let until = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();
    let r = a
        .call(
            Some(&admin),
            Method::POST,
            "/api/admin/tenants",
            Some(json!({ "slug": "gamma", "name": "Gamma", "manager_username": "boss", "manager_password": PASSWORD,
                         "trial_until": until })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let id = r.json()["id"].as_str().unwrap().to_string();
    assert!(r.json()["trial_until"].is_string());
    let boss = a.login("gamma", "boss", PASSWORD).await;
    let r = a.call(Some(&admin), Method::GET, &format!("/api/admin/tenants/{id}/impact"), None).await;
    assert_eq!(r.json()["people"], 1);
    // export, download, import refused while it exists, then with replace
    let r = a.call(Some(&admin), Method::POST, &format!("/api/admin/tenants/{id}/export"), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let file = r.json()["file"].as_str().unwrap().to_string();
    let r = a.call(Some(&admin), Method::GET, &format!("/api/admin/exports/{file}"), None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.header(header::CONTENT_TYPE), "application/zip");
    let zip = r.body.clone();
    assert_eq!(
        a.call(Some(&boss), Method::GET, &format!("/api/admin/exports/{file}"), None).await.status,
        StatusCode::FORBIDDEN
    );
    let r = a.raw(&admin, "/api/admin/tenants/import", zip.clone()).await;
    assert_eq!((r.status, r.json()["code"].as_str()), (StatusCode::CONFLICT, Some("tenant_exists")));
    let r = a.raw(&admin, "/api/admin/tenants/import?replace=true", zip).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["replaced"], true);
    // maintenance: the notice for everybody, only the Administrators work
    let r = a
        .call(
            Some(&admin),
            Method::PUT,
            "/api/admin/maintenance",
            Some(json!({ "on": true, "message": "Back at 10" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a.call(None, Method::GET, "/api/brand", None).await;
    assert_eq!(
        (r.json()["maintenance"]["on"].as_bool(), r.json()["maintenance"]["message"].as_str()),
        (Some(true), Some("Back at 10"))
    );
    let boss = a.login_err("gamma", "boss").await;
    assert_eq!(boss, "maintenance");
    assert_eq!(a.call(Some(&admin), Method::GET, "/api/session", None).await.status, StatusCode::OK);
    a.call(Some(&admin), Method::PUT, "/api/admin/maintenance", Some(json!({ "on": false }))).await;
    let boss = a.login("gamma", "boss", PASSWORD).await;
    // monitoring
    for p in ["status", "performance?period=12h", "errors", "tenants", "capacity", "alerts"] {
        let r = a.call(Some(&admin), Method::GET, &format!("/api/admin/monitoring/{p}"), None).await;
        assert_eq!(r.status, StatusCode::OK, "{p}: {}", r.text());
        assert_eq!(
            a.call(Some(&boss), Method::GET, &format!("/api/admin/monitoring/{p}"), None).await.status,
            StatusCode::FORBIDDEN
        );
    }
    let r = a.call(Some(&admin), Method::GET, "/api/admin/monitoring/status", None).await;
    assert!(r.json()["services"].as_array().unwrap().iter().any(|s| s["key"] == "database"));
    let r = a.call(Some(&admin), Method::GET, "/api/admin/metrics", None).await;
    assert!(r.text().contains("mosaikit_requests_total"));
    assert_eq!(a.call(None, Method::GET, "/metrics", None).await.status, StatusCode::NOT_FOUND);
    // a backup in the background, then listed
    let r = a.call(Some(&admin), Method::POST, "/api/admin/backups", None).await;
    assert_eq!(r.status, StatusCode::ACCEPTED);
    let mut done = Value::Null;
    for _ in 0..100 {
        let r = a.call(Some(&admin), Method::GET, "/api/admin/backups", None).await;
        if let Some(b) = r.json()["backups"].as_array().and_then(|l| l.first().cloned()) {
            if b["status"] != "running" {
                done = b;
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    assert_eq!(done["status"], "ok", "{done}");
    let bid = done["id"].as_str().unwrap();
    let r = a.call(Some(&admin), Method::GET, &format!("/api/admin/backups/{bid}/tenants"), None).await;
    assert!(r.json().as_array().unwrap().iter().any(|m| m["tenant"]["slug"] == "gamma"));
    // archive, then delete with the address typed
    assert_eq!(
        a.call(Some(&admin), Method::POST, &format!("/api/admin/tenants/{id}/archive"), None).await.status,
        StatusCode::OK
    );
    let r = a
        .call(
            Some(&admin),
            Method::POST,
            &format!("/api/admin/tenants/{id}/delete"),
            Some(json!({ "confirm": "gam" })),
        )
        .await;
    assert_eq!(r.json()["code"], "confirm_mismatch");
    let r = a
        .call(
            Some(&admin),
            Method::POST,
            &format!("/api/admin/tenants/{id}/delete"),
            Some(json!({ "confirm": "gamma" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    // and back from the backup
    let r = a
        .call(
            Some(&admin),
            Method::POST,
            &format!("/api/admin/backups/{bid}/restore"),
            Some(json!({ "slug": "gamma" })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    a.login("gamma", "boss", PASSWORD).await;
}

#[tokio::test]
async fn search_prefs_and_themes_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let g = a.t.tenant("alfa").await;
    a.t.member(&g, "anna").await;
    let admin = a.admin().await;
    let m = a.login("alfa", "alfa-manager", PASSWORD).await;
    let anna = a.login("alfa", "anna", PASSWORD).await;

    // search: Anna finds her note by a word of the text, the Tenant Manager does not see it
    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": "Site visit", "body": "north depot" } })),
        )
        .await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
    let r = a.call(Some(&anna), Method::GET, "/api/t/alfa/search?q=depot", None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()[0]["plugin_id"], "com.mosaikit.notes");
    assert_eq!(r.json()[0]["items"][0]["title"], "Site visit");
    assert_eq!(a.call(Some(&m), Method::GET, "/api/t/alfa/search?q=depot", None).await.json(), json!([]));
    let r = a.call(Some(&admin), Method::GET, "/api/admin/search?q=alf", None).await;
    assert_eq!(r.json()["tenants"][0]["sub"], "alfa");
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/admin/search?q=alf", None).await.status,
        StatusCode::FORBIDDEN
    );

    // preferences that follow the person: in the session too
    let r = a
        .call(
            Some(&anna),
            Method::PUT,
            "/api/me/prefs",
            Some(json!({ "contrast": true, "tour_done": "home" })),
        )
        .await;
    assert_eq!(r.json(), json!({ "contrast": true, "tours_done": ["home"] }));
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/session", None).await.json()["me"]["contrast"],
        json!(true)
    );

    // a theme of the platform: contrast checked, offered to tenants, public for the sign-in page
    let vars = json!({ "--background": "#ffffff", "--foreground": "#242424", "--primary": "#1f6f5c",
                       "--primary-foreground": "#ffffff", "--band": "#174f42", "--band-foreground": "#ffffff" });
    let bad = json!({ "name": "Low", "light": { "--background": "#ffffff", "--foreground": "#bbbbbb",
        "--primary": "#1f6f5c", "--primary-foreground": "#ffffff", "--band": "#174f42", "--band-foreground": "#ffffff" },
        "dark": vars });
    let r = a.call(Some(&admin), Method::POST, "/api/admin/themes", Some(bad)).await;
    assert_eq!((r.status, r.json()["code"].clone()), (StatusCode::BAD_REQUEST, json!("theme_contrast")));
    let r = a
        .call(
            Some(&admin),
            Method::POST,
            "/api/admin/themes",
            Some(json!({ "name": "Green", "light": vars, "dark": vars })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let id = r.json()["id"].as_str().unwrap().to_string();
    let r = a
        .call(
            Some(&m),
            Method::POST,
            "/api/admin/themes",
            Some(json!({ "name": "X", "light": vars, "dark": vars })),
        )
        .await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
    assert_eq!(a.call(None, Method::GET, "/api/auth/themes", None).await.json()[0]["id"], json!(id));
    let r = a.call(Some(&m), Method::PUT, "/api/t/alfa/manage/theme", Some(json!({ "preset": id }))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let ctx = a.call(Some(&anna), Method::GET, "/api/t/alfa/context", None).await.json();
    assert_eq!((ctx["theme"]["preset"].clone(), ctx["themes"][0]["id"].clone()), (json!(id), json!(id)));
    // no longer offered: the tenant goes back to the theme of the platform
    let r = a
        .call(Some(&admin), Method::PUT, "/api/admin/themes-allowed", Some(json!({ "allowed": ["tessera"] })))
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let ctx = a.call(Some(&anna), Method::GET, "/api/t/alfa/context", None).await.json();
    assert_eq!(ctx["theme"]["preset"], "mosaikit");
    // a theme of the tenant
    let r = a
        .call(
            Some(&m),
            Method::POST,
            "/api/t/alfa/manage/themes",
            Some(json!({ "name": "Ours", "light": vars, "dark": vars })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(
        a.call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/manage/themes",
            Some(json!({ "name": "No", "light": vars, "dark": vars }))
        )
        .await
        .status,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn extension_tabs_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let g = a.t.tenant("alfa").await;
    a.t.member(&g, "anna").await;
    let admin = a.admin().await;
    let anna = a.login("alfa", "anna", PASSWORD).await;

    // an extension of Notes with a tab: a page of its UI
    let manifest = r#"
id = "com.example.tabs"
name = "Tabs"
version = "0.1.0"
kind = "extension"
[contribution]
icon = "✔"
label = "Tabs"
[extends]
plugin = "com.mosaikit.notes"
[ui]
entry = "index.html"
[[extension.tabs]]
resource = "notes"
key = "review"
label = "Review"
page = "tab.html"
[i18n.it]
extension = { tabs = { review = "Revisione" } }
"#;
    let files = std::collections::BTreeMap::from([
        ("plugin.toml".to_string(), manifest.as_bytes().to_vec()),
        ("ui/index.html".to_string(), b"<!doctype html><title>tabs</title>".to_vec()),
        ("ui/tab.html".to_string(), b"<!doctype html><title>tab</title><p>the tab</p>".to_vec()),
    ]);
    let pkg = mosaikit_mskp::pack(&files, Some(&mosaikit_kernel::testing::test_key())).unwrap();
    let r = a.raw(&admin, "/api/admin/plugins", pkg).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let r = a.call(Some(&admin), Method::POST, "/api/admin/plugins/com.example.tabs/activate", None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());

    // the tab in the list of the extensions of the notes (its Italian label: kernel tests)
    let ext =
        a.call(Some(&anna), Method::GET, "/api/t/alfa/p/com.mosaikit.notes/ext/notes", None).await.json();
    let tab = &ext[0]["tabs"][0];
    assert_eq!(
        (tab["key"].clone(), tab["label"].clone(), tab["page"].clone()),
        (json!("review"), json!("Review"), json!("tab.html"))
    );

    // its page on the origin of the plugins: framed only by the app, readable from a frame without an origin
    let r = a.get_untrusted("/ui/com.example.tabs/tab.html", None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert!(r.text().contains("the tab"));
    assert_eq!(r.header(header::ACCESS_CONTROL_ALLOW_ORIGIN), "*");
    let csp = r.header(header::CONTENT_SECURITY_POLICY);
    assert!(csp.contains(&format!("frame-ancestors {}", a.t.cfg.app_origin())), "{csp}");
}

#[tokio::test]
async fn one_item_from_a_backup_over_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    let g = a.t.tenant("alfa").await;
    let anna_u = a.t.member(&g, "anna").await;
    let admin = a.admin().await;
    let admin_u = a.t.admin().await;
    let anna = a.login("alfa", "anna", PASSWORD).await;
    let note = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": "Minutes" } })),
        )
        .await
        .json();
    let id: uuid::Uuid = note["id"].as_str().unwrap().parse().unwrap();
    let b = mosaikit_kernel::ops::backup::run(&a.t, Some(&admin_u)).await.unwrap();
    let anna_c = a.t.home(&anna_u).await;
    mosaikit_kernel::crud::delete(&a.t, &anna_c, "com.mosaikit.notes", "notes", id).await.unwrap();
    mosaikit_kernel::trash::purge(&a.t, &anna_c, id).await.unwrap();

    // looked for by its title, then restored with its id
    let path = format!("/api/admin/backups/{}/tenants/alfa/items", b.id);
    let r = a.call(Some(&admin), Method::GET, &format!("{path}?q=minutes"), None).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let list = r.json();
    assert_eq!((list["total"].clone(), list["items"][0]["state"].clone()), (json!(1), json!("missing")));
    let restore = format!("{path}/{id}/restore");
    let r = a.call(Some(&admin), Method::POST, &restore, Some(json!({}))).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["mode"], "original");
    // again: it is there now, the Administrator must choose
    let r = a.call(Some(&admin), Method::POST, &restore, Some(json!({}))).await;
    assert_eq!((r.status, r.json()["code"].clone()), (StatusCode::CONFLICT, json!("item_exists")));
    let r = a.call(Some(&admin), Method::POST, &restore, Some(json!({ "mode": "copy" }))).await;
    assert_eq!(r.json()["mode"], "copy", "{}", r.text());
    // only the Administrators
    assert_eq!(a.call(Some(&anna), Method::GET, &path, None).await.status, StatusCode::FORBIDDEN);
}
