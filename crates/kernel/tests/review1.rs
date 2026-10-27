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
    let carla = create_member(&t, &mgr, "carla", "Carla", " Carla@Example.org ", PASSWORD, Role::User).await.unwrap();
    // the Administrator creates a person: same rule
    let admin = t.admin().await;
    let alfa = tenancy::list_tenants(&t, &admin).await.unwrap().into_iter().find(|x| x.slug == "alfa").unwrap().id;
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
    let out = bulk::import_people(&t, &mgr, &[row("eva", None), row("fabio", Some("fabio@example.org"))]).await.unwrap();
    assert_eq!((out[0].ok, out[0].code), (false, Some("email_required")));
    assert!(out[1].ok);
    // edit: the address cannot be emptied; a name-only edit of an account without one asks for it
    assert_eq!(update_person(&t, By::Admin(&admin), carla, None, Some("")).await.unwrap_err().code(), "email_required");
    update_person(&t, By::Admin(&admin), carla, Some("Carla B."), Some("carla.b@example.org")).await.unwrap();
    mosaikit_db::query("update core.users set email = null where id = $1").bind(carla).execute(&t.db).await.unwrap();
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
