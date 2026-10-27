//! Review round 1: email required for local accounts (D9) and "Forgot your password?" (C3).

use mosaikit_kernel::identity::login;
use mosaikit_kernel::mail::{self, EmailChange, EmailSettings, Security};
use mosaikit_kernel::tenancy::{
    self, bulk, create_member, create_person, forgot_password, reset_with_link, update_person, By, NewPerson,
};
use mosaikit_kernel::testing::{start, TestKernel, PASSWORD};
use mosaikit_kernel::{Kind, Role};

async fn mail_server(t: &TestKernel) {
    let admin = t.admin().await;
    mail::set_settings(
        t,
        &admin,
        &EmailChange {
            settings: EmailSettings {
                host: "127.0.0.1".into(),
                port: 1,
                security: Security::None,
                username: String::new(),
                sender: "Mosaikit <noreply@example.org>".into(),
                footer: "Automatic message".into(),
            },
            password: None,
        },
    )
    .await
    .unwrap();
}

async fn outbox(t: &TestKernel) -> Vec<(String, String, String)> {
    mosaikit_db::query("select to_addr, subject, body from core.mail_outbox order by created_at")
        .fetch_all(&t.db)
        .await
        .unwrap()
        .iter()
        .map(|r| (r.get(0), r.get(1), r.get(2)))
        .collect()
}

#[tokio::test]
async fn email_is_required_for_local_accounts() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let mgr = t.home(&g).await;
    // create: missing or not an address
    for bad in ["", "  ", "not-an-address"] {
        let e = create_member(&t, &mgr, "carla", "Carla", bad, PASSWORD, Role::User).await.unwrap_err();
        assert_eq!(e.kind, Kind::BadRequest, "{bad}");
        assert!(matches!(e.code(), "email_required" | "email_invalid"), "{bad}: {}", e.code());
    }
    let carla =
        create_member(&t, &mgr, "carla", "Carla", " Carla@Example.org ", PASSWORD, Role::User).await.unwrap();
    // the Administrator creates a person: same rule
    let admin = t.admin().await;
    let alfa =
        tenancy::list_tenants(&t, &admin).await.unwrap().into_iter().find(|x| x.slug == "alfa").unwrap().id;
    let n = |email: Option<&str>| NewPerson {
        username: "dino".into(),
        display_name: String::new(),
        email: email.map(Into::into),
        home_tenant: alfa,
        role: Role::User,
        profile: None,
        password: Some("a-password-123".into()),
        others: vec![],
    };
    assert_eq!(create_person(&t, &admin, &n(None)).await.unwrap_err().code(), "email_required");
    create_person(&t, &admin, &n(Some("dino@example.org"))).await.unwrap();
    // import: the row without an address fails, the others go on
    let row = |u: &str, e: Option<&str>| bulk::ImportRow {
        username: u.into(),
        display_name: String::new(),
        email: e.map(Into::into),
        role: Role::User,
        profile: String::new(),
        groups: vec![],
    };
    let out = bulk::import_people(&t, &mgr, &[row("eva", None), row("fabio", Some("fabio@example.org"))])
        .await
        .unwrap();
    assert_eq!((out[0].ok, out[0].code), (false, Some("email_required")));
    assert!(out[1].ok);
    // edit: the address cannot be emptied; a name-only edit of an account without one asks for it
    assert_eq!(
        update_person(&t, By::Admin(&admin), carla, None, Some("")).await.unwrap_err().code(),
        "email_required"
    );
    update_person(&t, By::Admin(&admin), carla, Some("Carla B."), Some("carla.b@example.org")).await.unwrap();
    mosaikit_db::query("update core.users set email = null where id = $1")
        .bind(carla)
        .execute(&t.db)
        .await
        .unwrap();
    assert_eq!(
        update_person(&t, By::Admin(&admin), carla, Some("Carla C."), None).await.unwrap_err().code(),
        "email_required",
        "an account made before the rule"
    );
    update_person(&t, By::Admin(&admin), carla, Some("Carla C."), Some("carla@example.org")).await.unwrap();
}

#[tokio::test]
async fn forgot_password_by_email() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let mgr = t.home(&g).await;
    create_member(&t, &mgr, "anna", "Anna", "anna@example.org", PASSWORD, Role::User).await.unwrap();
    // no mail server: it says so, and sends nothing
    assert!(!forgot_password(&t, "alfa", "anna", "1.1.1.1").await.unwrap().mail);
    assert!(outbox(&t).await.is_empty());
    mail_server(&t).await;
    // an unknown account, a wrong tenant: the same answer, no message
    for (tenant, who) in [("alfa", "nobody"), ("zzz", "anna"), ("alfa", "")] {
        assert!(forgot_password(&t, tenant, who, "1.1.1.1").await.unwrap().mail);
    }
    assert!(outbox(&t).await.is_empty(), "no message for an account that does not exist");
    // by username, then by email address (case does not matter): each time one message with a link
    assert!(forgot_password(&t, "alfa", "anna", "1.1.1.1").await.unwrap().mail);
    let first = outbox(&t).await;
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].0, "anna@example.org");
    let link = |m: &str| m.split_whitespace().find(|w| w.contains("#/reset/")).unwrap().to_string();
    let token1 = link(&first[0].2).rsplit('/').next().unwrap().to_string();
    assert!(forgot_password(&t, "alfa", "Anna@Example.ORG", "1.1.1.2").await.unwrap().mail);
    let second = outbox(&t).await;
    assert_eq!(second.len(), 2);
    let token2 = link(&second[1].2).rsplit('/').next().unwrap().to_string();
    // the earlier link stopped working; the new one works once
    assert_eq!(reset_with_link(&t, &token1, "a-new-password-1").await.unwrap_err().code(), "reset_expired");
    reset_with_link(&t, &token2, "a-new-password-1").await.unwrap();
    assert_eq!(reset_with_link(&t, &token2, "other-password-2").await.unwrap_err().code(), "reset_expired");
    login(&t, "alfa", "anna", "a-new-password-1", "x").await.unwrap();
    // too many requests for one person: dropped silently
    for _ in 0..6 {
        assert!(forgot_password(&t, "alfa", "anna", "1.1.1.3").await.unwrap().mail);
    }
    assert!(outbox(&t).await.len() <= 2 + 3, "at most 3 per person in the window");
}

// ------------------------------------------------------------------ web pages for a plugin (H1, H2)

/// A tiny web server: `/` answers with the page and headers of `routes`, anything else 404.
async fn web(routes: Vec<(&'static str, String, Vec<u8>)>) -> u16 {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = l.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut s, _)) = l.accept().await else { return };
            let routes = routes.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = s.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (head, body) = match routes.iter().find(|r| r.0 == path) {
                    Some(r) if r.1.starts_with("Location:") => {
                        (format!("HTTP/1.1 302 Found\r\n{}", r.1), r.2.clone())
                    }
                    Some(r) => (format!("HTTP/1.1 200 OK\r\n{}", r.1), r.2.clone()),
                    None => ("HTTP/1.1 404 Not Found\r\n".to_string(), b"no".to_vec()),
                };
                let _ = s
                    .write_all(
                        format!("{head}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len())
                            .as_bytes(),
                    )
                    .await;
                let _ = s.write_all(&body).await;
            });
        }
    });
    port
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n0000000000";

#[tokio::test]
async fn a_site_by_address_is_probed_safely() {
    use mosaikit_kernel::webfetch::inspect;
    // the guards: with the default configuration nothing on this computer or the local network is fetched
    let t = start().await;
    for bad in [
        "http://127.0.0.1:1/",
        "http://localhost/",
        "http://[::1]/",
        "http://10.1.2.3/",
        "http://169.254.169.254/latest/meta-data/",
        "file:///etc/passwd",
        "ftp://example.org/",
        "http://user:pw@example.org/",
    ] {
        let e = inspect(&t, bad, false).await.unwrap_err();
        assert!(matches!(e.code(), "web_blocked" | "web_url"), "{bad}: {}", e.code());
    }
    drop(t);

    let t = mosaikit_kernel::testing::start_with(|c| c.allow_private_fetch = true).await;
    let page =
        |extra: &str, body: &str| (format!("Content-Type: text/html\r\n{extra}"), body.as_bytes().to_vec());
    let (h_ok, b_ok) = page("", r#"<title>Free site</title><meta property="og:image" content="/pic.png">"#);
    let (h_xfo, b_xfo) = page("X-Frame-Options: DENY\r\n", "<title>Closed</title><img src=\"/pic.png\">");
    let (h_csp, b_csp) =
        page("Content-Security-Policy: frame-ancestors 'self'\r\n", "<title>Also closed</title>");
    let (h_open, b_open) = page("Content-Security-Policy: frame-ancestors *\r\n", "<title>Open</title>");
    let (h_redir, _) = ("Location: /go\r\n".to_string(), ());
    let port = web(vec![
        ("/", h_ok, b_ok),
        ("/xfo", h_xfo, b_xfo),
        ("/csp", h_csp, b_csp),
        ("/open", h_open, b_open),
        ("/pic.png", "Content-Type: image/png\r\n".into(), PNG.to_vec()),
        ("/go", h_redir, vec![]),
    ])
    .await;
    let at = |p: &str| format!("http://127.0.0.1:{port}{p}");
    let ok = inspect(&t, &at("/"), true).await.unwrap();
    assert_eq!((ok.embeddable, ok.reason.as_deref(), ok.title.as_str()), (true, None, "Free site"));
    assert!(ok.image.as_deref().is_some_and(|i| i.starts_with("data:image/png;base64,")), "og:image");
    // forbidden to frame: X-Frame-Options, then CSP frame-ancestors; the first image is the fallback
    let x = inspect(&t, &at("/xfo"), true).await.unwrap();
    assert_eq!((x.embeddable, x.reason.as_deref()), (false, Some("x_frame_options")));
    assert!(x.image.is_some(), "first image of the page");
    let c = inspect(&t, &at("/csp"), false).await.unwrap();
    assert_eq!((c.embeddable, c.reason.as_deref(), c.image), (false, Some("frame_ancestors"), None));
    assert!(inspect(&t, &at("/open"), false).await.unwrap().embeddable);
    // missing page: not embeddable
    assert!(!inspect(&t, &at("/missing"), false).await.unwrap().embeddable);
    // an endless redirect stops
    assert_eq!(inspect(&t, &at("/go"), false).await.unwrap_err().code(), "web_unreachable");
}

// ------------------------------------------------------------------ language plugins (I2)

const LANG_MANIFEST: &str = r#"
id = "com.example.lang-fr"
name = "French"
version = "0.1.0"
kind = "language"
[contribution]
icon = "x"
label = "Français"
[language]
code = "fr"
name = "Français"
"#;

#[tokio::test]
async fn a_language_plugin_adds_a_language() {
    let t = start().await;
    assert!(t.plugins.languages().is_empty());
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("plugin.toml"), LANG_MANIFEST).unwrap();
    std::fs::create_dir_all(dir.path().join("lang/plugins")).unwrap();
    std::fs::write(dir.path().join("lang/host.json"), r#"{"Sign in": "Se connecter"}"#).unwrap();
    std::fs::write(
        dir.path().join("lang/plugins/com.example.notes.toml"),
        "name = \"Notes FR\"\nlabel = \"Notes\"",
    )
    .unwrap();
    mosaikit_kernel::plugins::dev::load_one(&t, dir.path()).await.unwrap();

    let langs = t.plugins.languages();
    assert_eq!(langs.len(), 1);
    assert_eq!((langs[0].code.as_str(), langs[0].name.as_str()), ("fr", "Français"));
    assert_eq!(langs[0].host["Sign in"], "Se connecter");

    // the manifest of another plugin is shown in French, unless it has its own French texts
    let other = |extra: &str| {
        mosaikit_mskp::Manifest::from_toml(&format!(
            "id = \"com.example.notes\"\nname = \"Notes\"\nversion = \"1.0.0\"\nkind = \"service\"\n[contribution]\nicon = \"x\"\nlabel = \"Notes\"\n{extra}"
        ))
        .unwrap()
    };
    assert_eq!(other("").localized("fr-FR").name, "Notes FR");
    assert_eq!(other("").localized("it").name, "Notes", "no texts for Italian");
    assert_eq!(
        other("[i18n.fr]\nname = \"Mes notes\"").localized("fr").name,
        "Mes notes",
        "its own texts win"
    );

    // turned off: the language and its texts go away
    mosaikit_kernel::plugins::set_active(&t, None, "com.example.lang-fr", false).await.unwrap();
    assert!(t.plugins.languages().is_empty());
    assert_eq!(other("").localized("fr").name, "Notes");
    mosaikit_kernel::plugins::set_active(&t, None, "com.example.lang-fr", true).await.unwrap();
    assert_eq!(other("").localized("fr").name, "Notes FR");
}

#[test]
fn a_language_manifest_is_checked() {
    use mosaikit_mskp::Manifest;
    assert!(Manifest::from_toml(LANG_MANIFEST).is_ok());
    // without [language], with a built-in code, with an app inside
    assert!(Manifest::from_toml(
        &LANG_MANIFEST.replace("[language]\ncode = \"fr\"\nname = \"Français\"", "")
    )
    .is_err());
    assert!(Manifest::from_toml(&LANG_MANIFEST.replace("code = \"fr\"", "code = \"it\"")).is_err());
    assert!(Manifest::from_toml(&format!("{LANG_MANIFEST}\n[ui]\nentry = \"index.html\"")).is_err());
    // [language] on a plugin of another kind
    assert!(Manifest::from_toml(&LANG_MANIFEST.replace("kind = \"language\"", "kind = \"service\"")).is_err());
}
