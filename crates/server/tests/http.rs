//! Test HTTP del server (router reali, PostgreSQL reale: `cargo xtask db up`).

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

    /// Accesso come Administrator (senza secondo fattore: `admin_totp = false` nei test).
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
async fn sessione_con_cookie_httponly_e_csrf() {
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
    // gli Administrator non accedono dal form dei tenant
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
        "il token non e' nel corpo"
    );
    let s = a.admin().await;

    // senza cookie: 401
    assert_eq!(a.call(None, Method::GET, "/api/session", None).await.status, StatusCode::UNAUTHORIZED);
    let me = a.call(Some(&s), Method::GET, "/api/session", None).await;
    assert_eq!(me.json()["user"]["username"], "admin");
    assert!(me.json()["user"].get("token_hash").is_none());

    // modifica senza CSRF: 403
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

    // logout: cookie cancellato e sessione invalidata
    let r = a.call(Some(&s), Method::POST, "/api/auth/logout", None).await;
    assert!(r.header(header::SET_COOKIE).contains("Max-Age=0"));
    assert_eq!(a.call(Some(&s), Method::GET, "/api/session", None).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn header_di_sicurezza_e_cors_chiuso() {
    let a = App::new().await;
    let r = a.call(None, Method::GET, "/", None).await;
    assert_eq!(r.status, StatusCode::OK);
    let csp = r.header(header::CONTENT_SECURITY_POLICY);
    assert!(csp.contains("frame-ancestors 'none'") && csp.contains("default-src 'self'"), "{csp}");
    assert!(csp.contains(&a.t.cfg.plugin_origin()), "frame-src verso l'origine dei plugin");
    assert_eq!(r.header(header::X_FRAME_OPTIONS), "DENY");
    assert_eq!(r.header(header::X_CONTENT_TYPE_OPTIONS), "nosniff");
    // preflight da un'altra origine: nessun Access-Control-Allow-Origin
    let req = Request::builder()
        .method(Method::OPTIONS)
        .uri("/api/session")
        .header(header::ORIGIN, "https://malevolo.example")
        .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
        .body(Body::empty())
        .unwrap();
    let r = send(&a.app, req).await;
    assert!(r.headers.get(header::ACCESS_CONTROL_ALLOW_ORIGIN).is_none());
    // API inesistente: JSON, non la SPA
    let r = a.call(None, Method::GET, "/api/nope", None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert!(r.json()["error"].is_string());
}

#[tokio::test]
async fn flusso_completo_tenant_crud_condivisione() {
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
    // un gestore non e' amministratore di sistema
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
    // tenant non proprio
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/t/system/context", None).await.status,
        StatusCode::FORBIDDEN
    );

    let r = a
        .call(
            Some(&anna),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": "Nota di Anna" } })),
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

    // il gestore non vede il contenuto ma vede i metadati
    let list = a.call(Some(&g), Method::GET, "/api/t/alfa/p/com.mosaikit.notes/r/notes", None).await.json();
    assert_eq!(list["rows"].as_array().unwrap().len(), 0);
    let r =
        a.call(Some(&g), Method::GET, &format!("/api/t/alfa/p/com.mosaikit.notes/r/notes/{rid}"), None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    let meta = a.call(Some(&g), Method::GET, "/api/t/alfa/manage/resources", None).await.json();
    assert_eq!(meta[0]["title"], "Nota di Anna");
    assert_eq!(meta[0]["owner_name"], "anna");

    // condivisione in lettura al gestore
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

    // comando WASM
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

    // KPI: gestore si', membro no
    assert_eq!(a.call(Some(&g), Method::GET, "/api/t/alfa/manage/kpi", None).await.status, StatusCode::OK);
    assert_eq!(
        a.call(Some(&anna), Method::GET, "/api/t/alfa/manage/kpi", None).await.status,
        StatusCode::FORBIDDEN
    );

    // uscita con riassegnazione
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
async fn installazione_plugin_solo_admin() {
    let a = App::new().await;
    let admin = a.admin().await;
    a.t.tenant("alfa").await;
    let g = a.login("alfa", "alfa-gestore", PASSWORD).await;
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
    let r = a.raw(&admin, "/api/admin/plugins", b"non e' uno zip".to_vec()).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ui_dei_plugin_solo_sull_origine_untrusted() {
    let a = App::new().await;
    // UI minima nella cartella del plugin installato
    a.t.install("maps").await;
    let p = a.t.plugins.get("com.mosaikit.maps").unwrap();
    let ui_dir = a.t.cfg.data_dir.join("plugins/com.mosaikit.maps/0.4.0/ui");
    std::fs::create_dir_all(&ui_dir).unwrap();
    std::fs::write(ui_dir.join("index.html"), "<h1>mappe</h1>").unwrap();
    drop(p);
    // ricarica: la cartella ui ora esiste
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
    assert_eq!(a.get_untrusted("/ui/com.inesistente.x/", None).await.status, StatusCode::NOT_FOUND);
    // l'origine app non serve le UI dei plugin (fallback SPA dell'host, non il file del plugin)
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
async fn contenuti_utente_sempre_in_sandbox() {
    let a = App::new().await;
    a.t.install("static-site").await;
    a.t.install("files").await;
    a.t.tenant("alfa").await;
    let g = a.login("alfa", "alfa-gestore", PASSWORD).await;
    let site = a
        .call(
            Some(&g),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.static-site/r/sites",
            Some(json!({ "values": { "name": "Sito" } })),
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
    assert_eq!(a.get_untrusted("/c/ticket-falso/index.html", None).await.status, StatusCode::FORBIDDEN);

    // file HTML caricato nel file manager: mai eseguito (sandbox senza script)
    let r = a
        .raw(
            &g,
            "/api/t/alfa/p/com.mosaikit.files/files/upload?name=pagina.html",
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
    // download dall'app: sempre attachment octet-stream
    let r = a
        .call(Some(&g), Method::GET, &format!("/api/t/alfa/p/com.mosaikit.files/files/{fid}/content"), None)
        .await;
    assert_eq!(r.header(header::CONTENT_TYPE), "application/octet-stream");
    assert!(r.header(header::CONTENT_DISPOSITION).starts_with("attachment"));
}

#[tokio::test]
async fn link_pubblici_via_http() {
    let a = App::new().await;
    a.t.install("notes").await;
    a.t.install("files").await;
    a.t.tenant("alfa").await;
    let g = a.login("alfa", "alfa-gestore", PASSWORD).await;
    let n = a
        .call(
            Some(&g),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.notes/r/notes",
            Some(json!({ "values": { "title": "Avviso", "body": "<b>testo</b>" } })),
        )
        .await;
    let rid = n.json()["id"].as_str().unwrap().to_string();
    let l =
        a.call(Some(&g), Method::POST, &format!("/api/t/alfa/resources/{rid}/links"), Some(json!({}))).await;
    assert_eq!(l.status, StatusCode::OK, "{}", l.text());
    let path = l.json()["url"].as_str().unwrap().trim_start_matches(&a.t.cfg.public_url).to_string();
    let r = a.get_untrusted(&path, None).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(
        r.text().contains("Avviso") && r.text().contains("&lt;b&gt;testo&lt;/b&gt;"),
        "contenuto escapato"
    );
    assert!(r.header(header::CONTENT_SECURITY_POLICY).contains("default-src 'none'"));
    let api = a.get_untrusted(&format!("{path}api"), None).await.json();
    assert_eq!(api["values"]["title"], "Avviso");
    let views: i64 = mosaikit_db::query_scalar("select view_count from core.public_links")
        .fetch_one(&a.t.db)
        .await
        .unwrap();
    assert_eq!(views, 1);

    // con password
    let l = a
        .call(
            Some(&g),
            Method::POST,
            &format!("/api/t/alfa/resources/{rid}/links"),
            Some(json!({ "password": "aperto123" })),
        )
        .await;
    let ppath = l.json()["url"].as_str().unwrap().trim_start_matches(&a.t.cfg.public_url).to_string();
    let r = a.get_untrusted(&ppath, None).await;
    assert!(r.text().contains("Contenuto protetto"));
    assert_eq!(a.get_untrusted(&format!("{ppath}api"), None).await.status, StatusCode::NOT_FOUND);
    let wrong = Request::builder()
        .method(Method::POST)
        .uri(format!("{ppath}unlock"))
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from("password=sbagliata"))
        .unwrap();
    assert_eq!(send(&a.untrusted, wrong).await.status, StatusCode::UNAUTHORIZED);
    let right = Request::builder()
        .method(Method::POST)
        .uri(format!("{ppath}unlock"))
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(Body::from("password=aperto123"))
        .unwrap();
    let r = send(&a.untrusted, right).await;
    let cookie = r.header(header::SET_COOKIE);
    assert!(cookie.contains("HttpOnly"), "{cookie}");
    let r = a.get_untrusted(&ppath, Some(cookie.split(';').next().unwrap())).await;
    assert!(r.text().contains("Avviso"));

    // cartella condivisa pubblicamente
    let f = a
        .call(
            Some(&g),
            Method::POST,
            "/api/t/alfa/p/com.mosaikit.files/files/folder",
            Some(json!({ "name": "Pubblica" })),
        )
        .await
        .json();
    let fid = f["id"].as_str().unwrap().to_string();
    a.raw(
        &g,
        &format!("/api/t/alfa/p/com.mosaikit.files/files/upload?parent={fid}&name=leggimi.txt"),
        b"ciao".to_vec(),
    )
    .await;
    let l =
        a.call(Some(&g), Method::POST, &format!("/api/t/alfa/resources/{fid}/links"), Some(json!({}))).await;
    let fpath = l.json()["url"].as_str().unwrap().trim_start_matches(&a.t.cfg.public_url).to_string();
    let page = a.get_untrusted(&fpath, None).await.text();
    assert!(page.contains("leggimi.txt"));
    let href = page.split("href=\"").nth(1).unwrap().split('"').next().unwrap().to_string();
    let file = a.get_untrusted(&href, None).await;
    assert_eq!(file.body, b"ciao");
    // un file non coperto dal link
    let other = a
        .raw(&g, "/api/t/alfa/p/com.mosaikit.files/files/upload?name=privato.txt", b"x".to_vec())
        .await
        .json();
    let forged = href.replace(href.split('/').nth(4).unwrap(), other["id"].as_str().unwrap());
    assert_eq!(a.get_untrusted(&forged, None).await.status, StatusCode::NOT_FOUND);

    // revoca
    let links =
        a.call(Some(&g), Method::GET, &format!("/api/t/alfa/resources/{rid}/links"), None).await.json();
    for l in links.as_array().unwrap() {
        a.call(Some(&g), Method::DELETE, &format!("/api/t/alfa/links/{}", l["id"].as_str().unwrap()), None)
            .await;
    }
    assert_eq!(a.get_untrusted(&path, None).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn percorso_base_da_un_solo_url() {
    let a = App::with(
        start_with(|c| {
            c.url = "http://127.0.0.1:9100/mosaikit".into();
        })
        .await,
    );
    assert_eq!(a.t.cfg.plugin_url, "http://127.0.0.1:9101/mosaikit");
    // API e UI solo sotto il percorso base
    assert_eq!(a.call(None, Method::GET, "/mosaikit/api/health", None).await.status, StatusCode::OK);
    assert_eq!(a.call(None, Method::GET, "/api/health", None).await.status, StatusCode::NOT_FOUND);
    let r = a.call(None, Method::GET, "/mosaikit", None).await;
    assert_eq!(r.status, StatusCode::PERMANENT_REDIRECT);
    assert_eq!(r.header(header::LOCATION), "/mosaikit/");
    assert_eq!(a.call(None, Method::GET, "/mosaikit/", None).await.status, StatusCode::OK);
    // cookie di sessione limitato al percorso base
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
    // origine dei plugin: stessa base
    assert_eq!(a.get_untrusted("/ui/x/", None).await.status, StatusCode::NOT_FOUND);
    let r = a.get_untrusted("/mosaikit/ui/inesistente/", None).await;
    assert_eq!(r.text(), "plugin non attivo");
}

#[tokio::test]
async fn marchio_della_distribuzione() {
    let brand = tempfile::tempdir().unwrap();
    std::fs::write(brand.path().join("logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>").unwrap();
    std::fs::write(
        brand.path().join("brand.toml"),
        "name = \"Atlante <beta>\"\nversion = \"2.0.0\"\nlogo = \"logo.svg\"\ntagline = \"dati territoriali\"\n[colors]\naccent = \"#1e88e5\"\n",
    )
    .unwrap();
    let dir = brand.path().to_path_buf();
    let a = App::with(start_with(move |c| c.brand = Some(dir)).await);
    let b = a.call(None, Method::GET, "/api/brand", None).await.json();
    assert_eq!(b["name"], "Atlante <beta>");
    assert_eq!(b["version"], "2.0.0");
    assert_eq!(b["logo"], true);
    let logo = a.call(None, Method::GET, "/brand/logo", None).await;
    assert_eq!(logo.status, StatusCode::OK);
    assert!(logo.header(header::CONTENT_TYPE).starts_with("image/svg"));
    assert!(logo.header(header::CONTENT_SECURITY_POLICY).contains("sandbox"));
    // senza favicon propria: quella di default
    assert_eq!(a.call(None, Method::GET, "/brand/favicon", None).await.status, StatusCode::OK);
    assert_eq!(a.call(None, Method::GET, "/brand/altro", None).await.status, StatusCode::NOT_FOUND);
    let page = a.call(None, Method::GET, "/", None).await.text();
    if page.contains("<title>") && !page.contains("UI non compilata") {
        assert!(page.contains("<title>Atlante &lt;beta&gt;</title>"), "{page}");
        assert!(page.contains("--acc:#1e88e5;"), "{page}");
    }
}

#[tokio::test]
async fn accesso_amministratori_con_secondo_fattore() {
    use mosaikit_kernel::totp;
    let a = App::with(start_with(|c| c.admin_totp = true).await);
    // tenant della pagina di accesso: pubblici, senza il tenant di sistema
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
    // la sessione in attesa non apre le API
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
    assert_ne!(s.cookie, pending.cookie, "nuovo token dopo il secondo fattore");
    assert_eq!(a.call(Some(&s), Method::GET, "/api/session", None).await.status, StatusCode::OK);
    assert_eq!(
        a.call(Some(&pending), Method::POST, "/api/auth/totp/setup", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    // nessuno spazio di lavoro per l'Administrator, ma la sua panoramica
    assert_eq!(
        a.call(Some(&s), Method::GET, "/api/t/system/context", None).await.status,
        StatusCode::FORBIDDEN
    );
    let o = a.call(Some(&s), Method::GET, "/api/admin/overview", None).await.json();
    assert_eq!((o["tenants"].as_i64(), o["administrators"].as_i64()), (Some(0), Some(1)));
}
