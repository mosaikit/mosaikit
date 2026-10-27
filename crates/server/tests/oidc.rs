//! Sign-in through the identity provider of a tenant (OIDC), end to end over HTTP: the real routers
//! of Mosaikit and the test provider (`mosaikit_server::fake_idp`) on a free port.

use std::net::SocketAddr;

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use mosaikit_kernel::testing::{start, TestKernel, ADMIN_PASSWORD, PASSWORD};
use mosaikit_server::fake_idp::{FakeConfig, FakeIdp};
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
    fn location(&self) -> String {
        self.headers.get(header::LOCATION).map(|v| v.to_str().unwrap().to_string()).unwrap_or_default()
    }
    /// `name=value` of a `Set-Cookie` of the response.
    fn cookie(&self, name: &str) -> Option<String> {
        self.headers
            .get_all(header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .map(|v| v.split(';').next().unwrap_or_default().to_string())
            .find(|c| c.starts_with(&format!("{name}=")) && c.len() > name.len() + 1)
    }
}

#[derive(Clone, Default)]
struct Session {
    cookie: String,
    csrf: String,
}

struct App {
    t: TestKernel,
    app: Router,
    idp: FakeIdp,
    http: reqwest::Client,
}

impl App {
    async fn new() -> App {
        let t = start().await;
        let app = mosaikit_server::app_router(t.k.clone());
        let idp = FakeIdp::spawn(SocketAddr::from(([127, 0, 0, 1], 0)), FakeConfig::default()).await.unwrap();
        let http = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
        App { t, app, idp, http }
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
        self.send(req).await
    }

    async fn send(&self, req: Request<Body>) -> Res {
        let res = self.app.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        Res { status, headers, body }
    }

    async fn admin(&self) -> Session {
        let r = self
            .call(
                None,
                Method::POST,
                "/api/auth/admin/login",
                Some(json!({ "username": "admin", "password": ADMIN_PASSWORD })),
            )
            .await;
        assert_eq!(r.status, StatusCode::OK);
        Session { cookie: r.cookie("msk_session").unwrap(), csrf: r.json()["csrf"].as_str().unwrap().into() }
    }

    /// Tenant `slug` signing in through the test provider, roles from its groups.
    async fn oidc_tenant(&self, slug: &str, roles: &str) -> String {
        let manager = self.t.tenant(slug).await;
        let id = manager.home_tenant_id.to_string();
        let admin = self.admin().await;
        let r = self
            .call(
                Some(&admin),
                Method::PUT,
                &format!("/api/admin/tenants/{id}/sign-in"),
                Some(json!({
                    "enabled": true,
                    "issuer": self.idp.issuer,
                    "client_id": "mosaikit",
                    "client_secret": "fake-secret",
                    "button_text": "Test provider",
                    "roles_source": roles,
                    "manager_groups": ["mosaikit-managers"],
                    "user_groups": ["mosaikit-users"],
                })),
            )
            .await;
        assert_eq!(r.status, StatusCode::OK, "{}", String::from_utf8_lossy(&r.body));
        assert_eq!(
            (r.json()["has_secret"].as_bool(), r.json()["secret_hint"].as_str()),
            (Some(true), Some("cret"))
        );
        assert!(r.json().get("client_secret").is_none(), "the secret never goes back to the browser");
        id
    }

    /// The whole flow for `who`: start, page of the provider, return. Returns the response of the return.
    async fn sign_in(&self, slug: &str, who: &str) -> Res {
        self.sign_in_with(slug, who, |q| q).await
    }

    /// Like `sign_in`, with the query of the return changed by `edit` (tests of the refusals).
    async fn sign_in_with(&self, slug: &str, who: &str, edit: impl FnOnce(String) -> String) -> Res {
        let start = self.call(None, Method::GET, &format!("/api/auth/oidc/{slug}/start"), None).await;
        assert_eq!(start.status, StatusCode::SEE_OTHER);
        let to = start.location();
        assert!(to.starts_with(&format!("{}/authorize?", self.idp.issuer)), "{to}");
        for p in ["code_challenge_method=S256", "response_type=code", "nonce=", "state="] {
            assert!(to.contains(p), "{p} in {to}");
        }
        let flow = start.cookie("msk_oidc").expect("cookie of the flow");
        let idp = self.http.get(format!("{to}&login_hint={who}")).send().await.unwrap();
        assert_eq!(idp.status().as_u16(), 303, "{}", idp.text().await.unwrap_or_default());
        let back = url::Url::parse(idp.headers()[header::LOCATION].to_str().unwrap()).unwrap();
        let query = edit(back.query().unwrap_or_default().to_string());
        let req = Request::builder()
            .uri(format!("{}?{query}", back.path()))
            .header(header::COOKIE, flow)
            .body(Body::empty())
            .unwrap();
        self.send(req).await
    }

    /// A session from a successful return.
    async fn session_of(&self, back: &Res) -> Session {
        assert_eq!(back.status, StatusCode::SEE_OTHER);
        assert!(back.location().contains("#/t/"), "{}", back.location());
        let cookie = back.cookie("msk_session").expect("session cookie");
        let s = self
            .call(
                Some(&Session { cookie: cookie.clone(), csrf: String::new() }),
                Method::GET,
                "/api/session",
                None,
            )
            .await;
        assert_eq!(s.status, StatusCode::OK);
        Session { cookie, csrf: s.json()["csrf"].as_str().unwrap().into() }
    }
}

fn error_code(r: &Res) -> String {
    assert_eq!(r.status, StatusCode::SEE_OTHER);
    let l = r.location();
    assert!(l.contains("#/login/"), "{l}");
    l.split("oidc_error=").nth(1).unwrap_or_default().split('#').next().unwrap_or_default().to_string()
}

#[tokio::test]
async fn sign_in_through_the_provider_with_roles_from_groups() {
    let a = App::new().await;
    a.oidc_tenant("alfa", "idp").await;

    // the sign-in page knows the method; local passwords are refused
    let tenants = a.call(None, Method::GET, "/api/auth/tenants", None).await.json();
    let alfa = tenants.as_array().unwrap().iter().find(|t| t["slug"] == "alfa").unwrap().clone();
    assert_eq!((alfa["auth"].as_str(), alfa["button"].as_str()), (Some("oidc"), Some("Test provider")));
    let local = a
        .call(
            None,
            Method::POST,
            "/api/auth/login",
            Some(json!({ "tenant": "alfa", "username": "alfa-manager", "password": PASSWORD })),
        )
        .await;
    assert_eq!((local.status, local.json()["code"].as_str()), (StatusCode::BAD_REQUEST, Some("oidc_tenant")));

    // Anna is in the managers' group, Bruno in the users' one, Carla in none
    let anna = a.session_of(&a.sign_in("alfa", "anna.rossi").await).await;
    let me = a.call(Some(&anna), Method::GET, "/api/session", None).await.json();
    assert_eq!(me["external"], json!(true));
    assert_eq!(me["user"]["username"], json!("anna.rossi"));
    assert_eq!(me["user"]["display_name"], json!("Anna Rossi"));
    assert_eq!(me["memberships"][0]["role"], json!("tenant_manager"));
    let anna_id = me["user"]["user_id"].clone();
    let bruno = a.session_of(&a.sign_in("alfa", "bruno.neri").await).await;
    let me = a.call(Some(&bruno), Method::GET, "/api/session", None).await.json();
    assert_eq!(me["memberships"][0]["role"], json!("user"));
    assert_eq!(error_code(&a.sign_in("alfa", "carla.bassi").await), "oidc_no_role");

    // the second sign-in finds the same person (issuer + sub)
    let again = a.session_of(&a.sign_in("alfa", "anna.rossi").await).await;
    let me2 = a.call(Some(&again), Method::GET, "/api/session", None).await.json();
    assert_eq!(me2["user"]["user_id"], anna_id);
    let n: i64 =
        mosaikit_db::query_scalar("select count(*) from core.users where username like 'anna.rossi%'")
            .fetch_one(&a.t.k.db)
            .await
            .unwrap();
    assert_eq!(n, 1);

    // no local passwords in an OIDC tenant
    let pw = a
        .call(
            Some(&again),
            Method::POST,
            "/api/me/password",
            Some(json!({ "old": "x", "new": "a-new-password-1" })),
        )
        .await;
    assert_eq!(pw.json()["code"], json!("oidc_tenant"));
    let member = a
        .call(
            Some(&again),
            Method::POST,
            "/api/t/alfa/manage/members",
            Some(json!({ "username": "local1", "password": PASSWORD, "role": "user" })),
        )
        .await;
    assert_eq!(member.json()["code"], json!("oidc_tenant"));
}

#[tokio::test]
async fn roles_managed_in_mosaikit() {
    let a = App::new().await;
    a.oidc_tenant("beta", "mosaikit").await;
    // with the roles in Mosaikit everybody the provider lets in starts as User, Carla too
    for who in ["anna.rossi", "carla.bassi"] {
        let s = a.session_of(&a.sign_in("beta", who).await).await;
        let me = a.call(Some(&s), Method::GET, "/api/session", None).await.json();
        assert_eq!(me["memberships"][0]["role"], json!("user"), "{who}");
    }
}

#[tokio::test]
async fn refusals_of_the_return() {
    let a = App::new().await;
    a.oidc_tenant("gamma", "idp").await;
    // state changed: not the sign-in started by this browser
    let r = a.sign_in_with("gamma", "anna.rossi", |q| q.replace("state=", "state=x")).await;
    assert_eq!(error_code(&r), "oidc_state");
    // no cookie of the flow
    let req = Request::builder()
        .uri("/api/auth/oidc/gamma/callback?code=abc&state=def")
        .body(Body::empty())
        .unwrap();
    assert_eq!(error_code(&a.send(req).await), "oidc_state");
    // the provider refused
    let r = a.sign_in_with("gamma", "anna.rossi", |_| "error=access_denied&state=x".into()).await;
    assert_eq!(error_code(&r), "oidc_denied");
    // expired token
    a.idp.set_ttl(-600);
    assert_eq!(error_code(&a.sign_in("gamma", "anna.rossi").await), "oidc_token");
    a.idp.set_ttl(300);
    // token for another client
    a.idp.set_audience(Some("someone-else"));
    assert_eq!(error_code(&a.sign_in("gamma", "anna.rossi").await), "oidc_token");
    a.idp.set_audience(None);
    a.session_of(&a.sign_in("gamma", "bruno.neri").await).await;
}

#[tokio::test]
async fn key_rotation_and_both_algorithms() {
    let a = App::new().await;
    a.oidc_tenant("delta", "idp").await;
    a.session_of(&a.sign_in("delta", "anna.rossi").await).await;
    // new keys: the kernel fetches them again on the unknown key
    a.idp.rotate();
    a.session_of(&a.sign_in("delta", "anna.rossi").await).await;
    a.idp.set_alg("RS256");
    a.session_of(&a.sign_in("delta", "bruno.neri").await).await;
    // a second rotation within 30 s of the last fetch is not fetched again (no hammering of the
    // provider): the sign-in fails until then
    a.idp.rotate();
    assert_eq!(error_code(&a.sign_in("delta", "bruno.neri").await), "oidc_token");
}

#[tokio::test]
async fn back_channel_logout_and_end_session() {
    let a = App::new().await;
    a.oidc_tenant("eps", "idp").await;
    let anna = a.session_of(&a.sign_in("eps", "anna.rossi").await).await;
    let (sid, _) = a.idp.sessions().last().unwrap().clone();
    let anna2 = a.session_of(&a.sign_in("eps", "anna.rossi").await).await;

    let post = |token: String| {
        Request::builder()
            .method(Method::POST)
            .uri("/api/auth/oidc/eps/backchannel-logout")
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(Body::from(format!("logout_token={token}")))
            .unwrap()
    };
    // one session of the provider (sid): only that one closes
    let token = a.idp.logout_token(None, Some(&sid));
    let r = a.send(post(token.clone())).await;
    assert_eq!((r.status, r.json()["sessions"].as_u64()), (StatusCode::OK, Some(1)));
    assert_eq!(a.call(Some(&anna), Method::GET, "/api/session", None).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(a.call(Some(&anna2), Method::GET, "/api/session", None).await.status, StatusCode::OK);
    // the same token again is refused (jti)
    assert_eq!(a.send(post(token)).await.status, StatusCode::BAD_REQUEST);
    // a token that is not a logout token
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    let fake = a.idp.sign(
        &json!({ "iss": a.idp.issuer, "aud": "mosaikit", "iat": now, "jti": "x", "sub": "f1d0c0a1-0001" }),
    );
    assert_eq!(a.send(post(fake)).await.status, StatusCode::BAD_REQUEST);

    // sign-out from Mosaikit: the browser goes to the end-session endpoint of the provider
    let out = a.call(Some(&anna2), Method::POST, "/api/auth/logout", None).await;
    let to = out.json()["end_session"].as_str().unwrap_or_default().to_string();
    assert!(to.starts_with(&format!("{}/logout?id_token_hint=", a.idp.issuer)), "{to}");
    assert!(to.contains("&client_id=mosaikit&post_logout_redirect_uri="), "{to}");
    // the hint is the ID token of that sign-in (a JWT of the provider), gone with the session
    let hint = url::Url::parse(&to)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "id_token_hint")
        .unwrap()
        .1
        .into_owned();
    assert_eq!(hint.split('.').count(), 3, "{hint}");

    // the person (sub): all its sessions close
    let anna3 = a.session_of(&a.sign_in("eps", "anna.rossi").await).await;
    let r = a.send(post(a.idp.logout_token(Some("f1d0c0a1-0001"), None))).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(
        a.call(Some(&anna3), Method::GET, "/api/session", None).await.status,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn configuration_of_the_administrator() {
    let a = App::new().await;
    let manager = a.t.tenant("zeta").await;
    let id = manager.home_tenant_id;
    let admin = a.admin().await;
    let path = format!("/api/admin/tenants/{id}/sign-in");
    // local by default, with the addresses to register in the provider
    let c = a.call(Some(&admin), Method::GET, &path, None).await.json();
    assert_eq!(c["enabled"], json!(false));
    assert!(c["redirect_uri"].as_str().unwrap().ends_with("/api/auth/oidc/zeta/callback"));
    assert_eq!(c["local_accounts"], json!(1));
    // plain http only on this computer
    let bad = a
        .call(
            Some(&admin),
            Method::PUT,
            &path,
            Some(json!({ "enabled": true, "issuer": "http://login.example", "client_id": "x" })),
        )
        .await;
    assert_eq!(bad.status, StatusCode::BAD_REQUEST);
    // only the Administrator
    let m = mosaikit_kernel::identity::login(&a.t.k, "zeta", "zeta-manager", PASSWORD, "t").await.unwrap();
    let ms = Session { cookie: format!("msk_session={}", m.token), csrf: m.user.csrf.clone() };
    assert_eq!(a.call(Some(&ms), Method::GET, &path, None).await.status, StatusCode::FORBIDDEN);
    // "Check the configuration"
    let ok = a
        .call(Some(&admin), Method::POST, "/api/admin/oidc/check", Some(json!({ "issuer": a.idp.issuer })))
        .await;
    let steps = ok.json();
    assert!(steps.as_array().unwrap().iter().all(|s| s["level"] == "ok"), "{steps}");
    let ko = a
        .call(
            Some(&admin),
            Method::POST,
            "/api/admin/oidc/check",
            Some(json!({ "issuer": "http://127.0.0.1:1" })),
        )
        .await;
    assert_eq!(ko.json()[0]["level"], json!("error"));
    // saving without the secret keeps it; an empty one removes it
    a.oidc_tenant_keep(&admin, &path).await;
}

impl App {
    async fn oidc_tenant_keep(&self, admin: &Session, path: &str) {
        let body = |secret: Option<&str>| {
            let mut b = json!({ "enabled": false, "issuer": self.idp.issuer, "client_id": "mosaikit" });
            if let Some(s) = secret {
                b["client_secret"] = json!(s);
            }
            b
        };
        let r = self.call(Some(admin), Method::PUT, path, Some(body(Some("s3cret-value")))).await.json();
        assert_eq!((r["has_secret"].as_bool(), r["secret_hint"].as_str()), (Some(true), Some("alue")));
        let r = self.call(Some(admin), Method::PUT, path, Some(body(None))).await.json();
        assert_eq!(r["has_secret"], json!(true));
        let r = self.call(Some(admin), Method::PUT, path, Some(body(Some("")))).await.json();
        assert_eq!(r["has_secret"], json!(false));
    }
}

#[tokio::test]
async fn front_channel_logout() {
    let a = App::new().await;
    let id = a.oidc_tenant("fcl", "idp").await;
    let admin = a.admin().await;
    let view = a.call(Some(&admin), Method::GET, &format!("/api/admin/tenants/{id}/sign-in"), None).await;
    let front = view.json()["frontchannel_logout_uri"].as_str().unwrap_or_default().to_string();
    assert!(front.ends_with("/api/auth/oidc/fcl/frontchannel-logout"), "{front}");

    let anna = a.session_of(&a.sign_in("fcl", "anna.rossi").await).await;
    let (sid, _) = a.idp.sessions().last().unwrap().clone();
    let anna2 = a.session_of(&a.sign_in("fcl", "anna.rossi").await).await;
    let (sid2, _) = a.idp.sessions().last().unwrap().clone();

    // the page the provider loads in its iframe: only that session closes
    let url = url::Url::parse(&a.idp.frontchannel_url(&sid).expect("front-channel address")).unwrap();
    let path = format!("{}?{}", url.path(), url.query().unwrap_or_default());
    let r = a.call(None, Method::GET, &path, None).await;
    assert_eq!(r.status, StatusCode::OK);
    let csp = r.headers.get(header::CONTENT_SECURITY_POLICY).unwrap().to_str().unwrap().to_string();
    assert!(csp.contains(&format!("frame-ancestors {}", a.idp.issuer)), "{csp}");
    assert!(r.headers.get(header::CACHE_CONTROL).unwrap().to_str().unwrap().contains("no-store"));
    assert_eq!(a.call(Some(&anna), Method::GET, "/api/session", None).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(a.call(Some(&anna2), Method::GET, "/api/session", None).await.status, StatusCode::OK);

    // another issuer, or no session: refused, nothing closes
    let wrong = format!("/api/auth/oidc/fcl/frontchannel-logout?iss=https%3A%2F%2Fevil.example&sid={sid2}");
    assert_eq!(a.call(None, Method::GET, &wrong, None).await.status, StatusCode::BAD_REQUEST);
    let none = format!(
        "{}?iss={}",
        url.path(),
        url::form_urlencoded::byte_serialize(a.idp.issuer.as_bytes()).collect::<String>()
    );
    assert_eq!(a.call(None, Method::GET, &none, None).await.status, StatusCode::BAD_REQUEST);
    assert_eq!(a.call(Some(&anna2), Method::GET, "/api/session", None).await.status, StatusCode::OK);

    // the logout page of the provider frames the address of the session in its cookie
    let page = a
        .http
        .get(format!("{}/logout?client_id=mosaikit", a.idp.issuer))
        .header(header::COOKIE, format!("fake_idp_sid={sid2}"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(page.contains("/api/auth/oidc/fcl/frontchannel-logout?iss="), "{page}");
    assert!(page.contains(&format!("sid={sid2}")), "{page}");
}

#[tokio::test]
async fn groups_of_the_provider_over_http() {
    let a = App::new().await;
    let id = a.oidc_tenant("grp", "idp").await;
    let admin = a.admin().await;
    // turn the mirror of the groups on, only the groups starting with "s" (staff, not mosaikit-*)
    let r = a
        .call(
            Some(&admin),
            Method::PUT,
            &format!("/api/admin/tenants/{id}/sign-in"),
            Some(json!({
                "enabled": true,
                "issuer": a.idp.issuer,
                "client_id": "mosaikit",
                "roles_source": "idp",
                "manager_groups": ["mosaikit-managers"],
                "user_groups": ["mosaikit-users"],
                "sync_groups": true,
                "group_prefix": "s",
            })),
        )
        .await;
    assert_eq!(r.status, StatusCode::OK, "{}", String::from_utf8_lossy(&r.body));
    assert_eq!(
        (r.json()["sync_groups"].as_bool(), r.json()["group_prefix"].as_str()),
        (Some(true), Some("s"))
    );
    assert_eq!(r.json()["has_secret"].as_bool(), Some(true), "the secret is kept");

    let anna = a.session_of(&a.sign_in("grp", "anna.rossi").await).await;
    a.session_of(&a.sign_in("grp", "bruno.neri").await).await;
    let list = a.call(Some(&anna), Method::GET, "/api/t/grp/manage/groups", None).await;
    assert_eq!(list.status, StatusCode::OK);
    let groups = list.json();
    let groups = groups.as_array().unwrap();
    let names: Vec<&str> = groups.iter().filter_map(|g| g["name"].as_str()).collect();
    assert_eq!(names, vec!["staff"], "only the groups with the prefix");
    let staff = &groups[0];
    assert_eq!((staff["source"].as_str(), staff["members"].as_array().unwrap().len()), (Some("idp"), 2));

    // read-only: neither deleted nor changed by the Tenant Manager
    let gid = staff["id"].as_str().unwrap();
    let r = a.call(Some(&anna), Method::DELETE, &format!("/api/t/grp/manage/groups/{gid}"), None).await;
    assert_eq!((r.status, r.json()["code"].as_str()), (StatusCode::BAD_REQUEST, Some("group_from_idp")));
}
