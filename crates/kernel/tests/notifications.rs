//! Notifications: producers, isolation between people, plugins, preferences, emails and digest.

use mosaikit_kernel::acl::{set_grant, Level};
use mosaikit_kernel::mail::{self, EmailChange, EmailSettings, Security};
use mosaikit_kernel::notify::{self, Filter, NoteKind, PluginNote, PrefsChange};
use mosaikit_kernel::tenancy::{invite, respond_invitation};
use mosaikit_kernel::testing::{start, FakeSmtp, TestKernel};
use mosaikit_kernel::{crud, Caller, Kind, Role, SessionUser};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

fn vals(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

async fn note(t: &TestKernel, c: &Caller, title: &str) -> Uuid {
    let row = crud::create(t, c, NOTES, "notes", &vals(json!({ "title": title, "body": "x" })), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn all(t: &TestKernel, u: &SessionUser) -> notify::Page {
    notify::list(t, u, &Filter::default()).await.unwrap()
}

/// The mail server of the platform pointed at a fake one.
async fn smtp(t: &TestKernel) -> FakeSmtp {
    let fake = FakeSmtp::start().await;
    let admin = t.admin().await;
    mail::set_settings(
        t,
        &admin,
        &EmailChange {
            settings: EmailSettings {
                host: "127.0.0.1".into(),
                port: fake.port,
                security: Security::None,
                username: "robot".into(),
                sender: "Mosaikit <noreply@example.org>".into(),
                footer: "Automatic message".into(),
            },
            password: Some("secret-of-the-server".into()),
        },
    )
    .await
    .unwrap();
    fake
}

#[tokio::test]
async fn invitations_notify_and_close() {
    let t = start().await;
    let alfa = t.tenant("alfa").await;
    let beta = t.tenant("beta").await;
    let bruno = t.member(&beta, "bruno").await;
    let mgr = t.home(&alfa).await;

    let inv = invite(&t, &mgr, "beta", "bruno", Role::User).await.unwrap();
    let page = all(&t, &bruno).await;
    assert_eq!(page.unread, 1);
    let n = &page.items[0];
    assert_eq!(n.kind, NoteKind::Invitation);
    assert_eq!(n.data["code"], "invitation.received");
    assert_eq!(n.data["invitation_id"], json!(inv.id));
    assert_eq!(n.tenant_slug.as_deref(), Some("alfa"));
    // the manager of beta sees nothing of it
    assert_eq!(all(&t, &beta).await.items.len(), 0);

    // the answer closes the notification and tells who invited
    respond_invitation(&t, &bruno, inv.id, true).await.unwrap();
    assert_eq!(all(&t, &bruno).await.unread, 0);
    let back = all(&t, &alfa).await;
    assert_eq!(back.items[0].data["code"], "invitation.accepted");
    assert_eq!(back.items[0].link, "#/t/alfa/manage");
}

#[tokio::test]
async fn shares_and_links_notify_the_right_people() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let (ca, cg) = (t.home(&anna).await, t.home(&g).await);
    let rid = note(&t, &ca, "Budget").await;

    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Manage)).await.unwrap();
    let b = all(&t, &bruno).await;
    assert_eq!(b.items.len(), 1);
    assert_eq!(b.items[0].kind, NoteKind::Share);
    assert_eq!(b.items[0].data["item"], "Budget");
    assert_eq!(b.items[0].link, "#/t/alfa/p/com.mosaikit.notes");
    // changing the level does not notify again
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read)).await.unwrap();
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Manage)).await.unwrap();
    assert_eq!(all(&t, &bruno).await.items.len(), 1);
    // who shares is not notified, nor the manager who sees nothing
    assert!(all(&t, &anna).await.items.is_empty());
    assert!(all(&t, &g).await.items.is_empty());

    // a public link by Bruno (manager of the item) tells the owner; one by the owner tells nobody
    let cb = t.home(&bruno).await;
    mosaikit_kernel::links::create(&t, &cb, rid, None, None).await.unwrap();
    let a = all(&t, &anna).await;
    assert_eq!(a.items[0].kind, NoteKind::Link);
    mosaikit_kernel::links::create(&t, &ca, rid, None, None).await.unwrap();
    assert_eq!(all(&t, &anna).await.items.len(), 1);
    let _ = cg;
}

#[tokio::test]
async fn people_see_and_change_only_their_own() {
    let t = start().await;
    let alfa = t.tenant("alfa").await;
    let beta = t.tenant("beta").await;
    let bruno = t.member(&beta, "bruno").await;
    let carla = t.member(&beta, "carla").await;
    invite(&t, &t.home(&alfa).await, "beta", "bruno", Role::User).await.unwrap();
    let id = all(&t, &bruno).await.items[0].id;

    // Carla cannot read, mark or delete the notification of Bruno
    assert!(all(&t, &carla).await.items.is_empty());
    assert_eq!(notify::mark(&t, &carla, &[id], true).await.unwrap(), 0);
    assert_eq!(notify::delete(&t, &carla, &[id]).await.unwrap(), 0);
    assert_eq!(all(&t, &bruno).await.unread, 1);

    // Bruno marks it read and unread, then deletes it
    assert_eq!(notify::mark(&t, &bruno, &[id], true).await.unwrap(), 1);
    assert_eq!(notify::unread_count(&t, &bruno).await.unwrap(), 0);
    assert_eq!(notify::mark(&t, &bruno, &[id], false).await.unwrap(), 1);
    assert_eq!(notify::mark_all_read(&t, &bruno).await.unwrap(), 1);
    assert_eq!(notify::delete(&t, &bruno, &[id]).await.unwrap(), 1);
    assert!(all(&t, &bruno).await.items.is_empty());
}

#[tokio::test]
async fn filters_and_pages() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let ca = t.home(&anna).await;
    for i in 0..5 {
        notify::from_plugin(
            &t,
            &ca,
            NOTES,
            &PluginNote { title: format!("Reminder {i}"), body: "due".into(), at: None, resource: None },
        )
        .await
        .unwrap();
    }
    let first = notify::list(&t, &anna, &Filter { limit: Some(2), ..Default::default() }).await.unwrap();
    assert_eq!(first.items.len(), 2);
    assert_eq!(first.unread, 5);
    let next = notify::list(&t, &anna, &Filter { limit: Some(10), before: first.next, ..Default::default() })
        .await
        .unwrap();
    assert_eq!(next.items.len(), 3);
    assert!(next.next.is_none());
    let found = notify::list(&t, &anna, &Filter { q: Some("reminder 3".into()), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(found.items.len(), 1);
    let kind =
        notify::list(&t, &anna, &Filter { kind: Some("share".into()), ..Default::default() }).await.unwrap();
    assert!(kind.items.is_empty());
    notify::mark(&t, &anna, &[found.items[0].id], true).await.unwrap();
    let unread =
        notify::list(&t, &anna, &Filter { unread: true, days: Some(1), ..Default::default() }).await.unwrap();
    assert_eq!(unread.items.len(), 4);
    assert!(notify::list(&t, &anna, &Filter { kind: Some("nonsense".into()), ..Default::default() })
        .await
        .is_err());
}

#[tokio::test]
async fn plugins_notify_only_who_may_see() {
    let t = start().await;
    t.install("notes").await;
    t.install("tasks").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let carla = t.member(&g, "carla").await;
    let (ca, cb) = (t.home(&anna).await, t.home(&bruno).await);
    let rid = note(&t, &ca, "Plan").await;

    // without an item: only the person using the plugin
    let n = notify::from_plugin(
        &t,
        &cb,
        NOTES,
        &PluginNote {
            title: "Saved".into(),
            body: String::new(),
            at: Some("notes/1".into()),
            resource: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(n, 1);
    let b = all(&t, &bruno).await;
    assert_eq!(b.items[0].source, NOTES);
    assert_eq!(b.items[0].link, "#/t/alfa/p/com.mosaikit.notes/notes%2F1");

    // with an item: Bruno cannot write on it yet
    let on =
        |title: &str| PluginNote { title: title.into(), body: "look".into(), at: None, resource: Some(rid) };
    assert_eq!(notify::from_plugin(&t, &cb, NOTES, &on("Look")).await.unwrap_err().kind, Kind::NotFound);
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Write)).await.unwrap();
    // the owner and the readers but the sender; Carla sees nothing and gets nothing
    assert_eq!(notify::from_plugin(&t, &cb, NOTES, &on("Look")).await.unwrap(), 1);
    assert!(all(&t, &anna).await.items.iter().any(|x| x.title == "Look"));
    assert!(all(&t, &carla).await.items.is_empty());
    // an item of another plugin cannot be named
    assert_eq!(
        notify::from_plugin(&t, &cb, "com.mosaikit.tasks", &on("Other")).await.unwrap_err().kind,
        Kind::NotFound
    );
    // bad places and titles
    let bad =
        PluginNote { title: "x".into(), body: String::new(), at: Some("<script>".into()), resource: None };
    assert_eq!(notify::from_plugin(&t, &cb, NOTES, &bad).await.unwrap_err().kind, Kind::BadRequest);
    let empty = PluginNote { title: "  ".into(), body: String::new(), at: None, resource: None };
    assert_eq!(notify::from_plugin(&t, &cb, NOTES, &empty).await.unwrap_err().kind, Kind::BadRequest);
    // at most 30 a minute per person and plugin
    let mut refused = false;
    for i in 0..40 {
        let r = notify::from_plugin(
            &t,
            &cb,
            NOTES,
            &PluginNote { title: format!("n{i}"), body: String::new(), at: None, resource: None },
        )
        .await;
        if let Err(e) = r {
            assert_eq!(e.kind, Kind::TooMany);
            refused = true;
            break;
        }
    }
    assert!(refused);
}

#[tokio::test]
async fn preferences_and_immediate_emails() {
    let t = start().await;
    t.install("notes").await;
    let fake = smtp(&t).await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let ca = t.home(&anna).await;

    // the default of the platform: a daily digest; links not by email
    let p = notify::prefs(&t, &bruno).await.unwrap();
    assert_eq!((p.mode.as_str(), p.own_mode.as_deref(), p.address.as_deref()), ("digest", None, Some("bruno@example.org")));
    assert!(p.kinds.iter().any(|k| k.kind == NoteKind::Link && !k.email));
    assert!(!p.kinds.iter().any(|k| k.kind == NoteKind::System), "only for Administrators");

    let bad = PrefsChange { address: Some(Some("not an address".into())), ..Default::default() };
    assert_eq!(notify::set_prefs(&t, &bruno, &bad).await.unwrap_err().kind, Kind::BadRequest);
    let bad = PrefsChange { mode: Some(Some("hourly".into())), ..Default::default() };
    assert!(notify::set_prefs(&t, &bruno, &bad).await.is_err());
    let change = PrefsChange {
        address: Some(Some("Bruno@Example.org".into())),
        mode: Some(Some("immediate".into())),
        kinds: Some(vals(json!({ "plugin": false }))),
    };
    let p = notify::set_prefs(&t, &bruno, &change).await.unwrap();
    assert_eq!((p.mode.as_str(), p.address.as_deref()), ("immediate", Some("bruno@example.org")));

    // a share goes out at once; a plugin notification does not (turned off by email)
    let rid = note(&t, &ca, "Città").await;
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read)).await.unwrap();
    let cb = t.home(&bruno).await;
    notify::from_plugin(
        &t,
        &cb,
        NOTES,
        &PluginNote { title: "Quiet".into(), body: String::new(), at: None, resource: None },
    )
    .await
    .unwrap();
    assert_eq!(mail::drain(&t).await.unwrap(), 1);
    let mails = fake.mails.lock().unwrap().clone();
    assert_eq!(mails.len(), 1);
    assert_eq!(mails[0].0, "bruno@example.org");
    assert!(mails[0].1.contains("Subject: =?UTF-8?B?"), "a subject with an accent is encoded");
    let text = FakeSmtp::text(&mails[0].1);
    assert!(text.contains("#/t/alfa/p/com.mosaikit.notes"), "{text}");
    assert!(text.contains("Automatic message"));
    // nothing else in the queue
    assert_eq!(mail::drain(&t).await.unwrap(), 0);

    // back to the default: null
    let p =
        notify::set_prefs(&t, &bruno, &PrefsChange { mode: Some(None), ..Default::default() }).await.unwrap();
    assert_eq!((p.mode.as_str(), p.own_mode.as_deref()), ("digest", None));
}

#[tokio::test]
async fn daily_digest() {
    let t = start().await;
    t.install("notes").await;
    let fake = smtp(&t).await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let ca = t.home(&anna).await;
    notify::set_prefs(
        &t,
        &bruno,
        &PrefsChange { address: Some(Some("bruno@example.org".into())), ..Default::default() },
    )
    .await
    .unwrap();
    for title in ["One", "Two"] {
        let rid = note(&t, &ca, title).await;
        set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read)).await.unwrap();
    }
    // nobody gets an email at once with the digest
    assert_eq!(mail::drain(&t).await.unwrap(), 0);
    assert_eq!(mail::digest(&t, true).await.unwrap(), 1);
    mail::drain(&t).await.unwrap();
    let mails = fake.mails.lock().unwrap().clone();
    assert_eq!(mails.len(), 1);
    assert!(mails[0].1.contains("Subject: 2 new notifications"));
    let text = FakeSmtp::text(&mails[0].1);
    assert!(text.contains("«One»") && text.contains("«Two»"), "{text}");
    // the same notifications are not sent twice; the digest of today already ran
    assert_eq!(mail::digest(&t, true).await.unwrap(), 0);
    assert_eq!(mail::digest(&t, false).await.unwrap(), 0);
}

#[tokio::test]
async fn email_settings_of_the_platform() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let admin = t.admin().await;
    // only the Administrator
    assert_eq!(mail::settings(&t, &g).await.unwrap_err().kind, Kind::Forbidden);
    let v = mail::settings(&t, &admin).await.unwrap();
    assert!(!v.configured && !v.has_password);
    // a test without a server is refused
    assert_eq!(mail::send_test(&t, &admin, "p@example.org").await.unwrap_err().kind, Kind::BadRequest);

    let fake = smtp(&t).await;
    let v = mail::settings(&t, &admin).await.unwrap();
    assert!(v.configured && v.has_password);
    assert!(
        !serde_json::to_string(&v).unwrap().contains("secret-of-the-server"),
        "the password never goes back"
    );
    mail::send_test(&t, &admin, "p@example.org").await.unwrap();
    assert_eq!(fake.mails.lock().unwrap()[0].0, "p@example.org");

    // keeping the password when it is not sent, removing it with an empty one
    let mut c = EmailChange { settings: v.settings.clone(), password: None };
    assert!(mail::set_settings(&t, &admin, &c).await.unwrap().has_password);
    c.password = Some(String::new());
    assert!(!mail::set_settings(&t, &admin, &c).await.unwrap().has_password);
    // invalid values
    c.settings.sender = "nobody".into();
    assert_eq!(mail::set_settings(&t, &admin, &c).await.unwrap_err().kind, Kind::BadRequest);

    // a server that does not answer: the message waits in the queue for another attempt
    c.settings.sender = "noreply@example.org".into();
    c.settings.port = 1;
    mail::set_settings(&t, &admin, &c).await.unwrap();
    mail::enqueue(&t, "x@example.org", "Hi", "text").await.unwrap();
    assert_eq!(mail::drain(&t).await.unwrap(), 0);
    let (status, attempts): (String, i32) = {
        let r = mosaikit_db::query("select status, attempts from core.mail_outbox")
            .fetch_one(&t.db)
            .await
            .unwrap();
        (r.get(0), r.get(1))
    };
    assert_eq!((status.as_str(), attempts), ("pending", 1));
    // the test message says why, with a code (never the text of the operating system)
    let e = mail::send_test(&t, &admin, "p@example.org").await.unwrap_err();
    assert!(matches!(e.code(), "email_refused" | "email_unreachable" | "email_timeout"), "{}", e.code());
    assert!(e.message.contains("127.0.0.1:1"), "{}", e.message);
    // Monitoring: the mail server down, with the outcome of the last delivery
    let s = mosaikit_kernel::ops::monitor::services(&t).await.unwrap();
    let m = s.iter().find(|x| x.key == "mail").unwrap();
    assert_eq!(m.state, "down");
    assert!(m.facts.iter().any(|f| f[0] == "Outcome"));
    assert!(s.iter().any(|x| x.key == "search"));
}

#[tokio::test]
async fn retention() {
    let t = start().await;
    let alfa = t.tenant("alfa").await;
    let beta = t.tenant("beta").await;
    let bruno = t.member(&beta, "bruno").await;
    invite(&t, &t.home(&alfa).await, "beta", "bruno", Role::User).await.unwrap();
    assert_eq!(notify::purge(&t).await.unwrap(), 0);
    mosaikit_db::query("update core.notifications set created_at = $1")
        .bind(chrono::Utc::now() - chrono::Duration::days(200))
        .execute(&t.db)
        .await
        .unwrap();
    assert_eq!(notify::purge(&t).await.unwrap(), 1);
    assert!(all(&t, &bruno).await.items.is_empty());
}
