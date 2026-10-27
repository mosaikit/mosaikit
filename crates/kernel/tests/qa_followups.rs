//! Follow-ups of the QA walkthrough (docs/reports/qa-walkthrough.md): the Home of a person (pick up, due
//! soon), what the Log and the Activity of a person say about people, many people at once, asking for a
//! plugin, the details of a tenant.

use std::collections::BTreeMap;

use mosaikit_kernel::log::{self, LogFilter, Scope};
use mosaikit_kernel::plugins::{self, InstallSource};
use mosaikit_kernel::tenancy::bulk::{self, ImportRow, TenantDetails};
use mosaikit_kernel::tenancy::{person_activity, set_member_suspended, By};
use mosaikit_kernel::testing::{start, test_key};
use mosaikit_kernel::{crud, overview, Kind, Role};
use serde_json::{json, Map, Value};

const TODO: &str = "com.example.todo";

fn obj(v: Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap()
}

/// A plugin with a due date and a done flag, without logic.
async fn install_todo(t: &mosaikit_kernel::testing::TestKernel) {
    let manifest = format!(
        r#"
id = "{TODO}"
name = "Todo"
version = "0.1.0"
[contribution]
icon = "✓"
label = "Todo"
[[resources]]
name = "todo"
title_field = "title"
due_field = "due"
done_field = "done"
fields = [
  {{ key = "title", label = "Title", kind = "text", required = true }},
  {{ key = "due", label = "Due", kind = "date" }},
  {{ key = "done", label = "Done", kind = "bool" }},
]
"#
    );
    let files = BTreeMap::from([("plugin.toml".to_string(), manifest.into_bytes())]);
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    let p = plugins::install_package(t, None, &pkg, InstallSource::Upload).await.unwrap();
    plugins::set_active(t, None, &p.id, true).await.unwrap();
}

#[test]
fn due_field_must_be_a_date_and_done_field_a_bool() {
    let bad = r#"
id = "com.example.x"
name = "X"
version = "0.1.0"
[contribution]
icon = "x"
label = "X"
[[resources]]
name = "x"
due_field = "title"
fields = [ { key = "title", label = "Title", kind = "text" } ]
"#;
    assert!(mosaikit_mskp::Manifest::from_toml(bad).is_err());
}

#[tokio::test]
async fn the_home_lists_what_to_pick_up_and_what_is_due() {
    let t = start().await;
    install_todo(&t).await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let today = chrono::Utc::now().date_naive();
    let soon = (today + chrono::Duration::days(2)).to_string();
    let later = (today + chrono::Duration::days(40)).to_string();
    let late = (today - chrono::Duration::days(1)).to_string();
    let a = crud::create(&t, &anna, TODO, "todo", &obj(json!({ "title": "soon", "due": soon })), None)
        .await
        .unwrap();
    crud::create(&t, &anna, TODO, "todo", &obj(json!({ "title": "later", "due": later })), None)
        .await
        .unwrap();
    crud::create(&t, &anna, TODO, "todo", &obj(json!({ "title": "late", "due": late })), None).await.unwrap();
    let o = overview::overview(&t, &anna).await.unwrap();
    let due: Vec<&str> = o.me.due.iter().map(|x| x.title.as_str()).collect();
    assert_eq!(due, ["late", "soon"], "within a week and late ones, soonest first");
    assert_eq!(o.me.pick_up.len(), 3, "the items she created");
    // done: no longer due
    let id: uuid::Uuid = a["id"].as_str().unwrap().parse().unwrap();
    crud::update(&t, &anna, TODO, "todo", id, &obj(json!({ "title": "soon", "due": soon, "done": true })))
        .await
        .unwrap();
    let o = overview::overview(&t, &anna).await.unwrap();
    assert_eq!(o.me.due.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), ["late"]);
    // somebody else sees none of it
    let bruno = t.member(&g, "bruno").await;
    let bruno = t.home(&bruno).await;
    let o = overview::overview(&t, &bruno).await.unwrap();
    assert!(o.me.due.is_empty() && o.me.pick_up.is_empty());
}

#[tokio::test]
async fn the_log_names_the_person_and_the_activity_shows_what_was_done_on_them() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let mgr = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    set_member_suspended(&t, &mgr, anna.user_id, true).await.unwrap();
    set_member_suspended(&t, &mgr, anna.user_id, false).await.unwrap();
    let page = log::page(&t, Scope::Tenant(&mgr), &LogFilter::default()).await.unwrap();
    let back = page.events.iter().find(|e| e.action == "member.reactivate").unwrap();
    assert_eq!(back.detail["name"], "anna", "«On what» says who");
    let acts = person_activity(&t, By::Manager(&mgr), anna.user_id).await.unwrap();
    assert!(acts.iter().any(|a| a.action == "member.suspend"), "what was done on her");
}

#[tokio::test]
async fn many_people_at_once_with_an_outcome_per_row() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let mgr = t.home(&g).await;
    let row = |u: &str, groups: &[&str]| ImportRow {
        username: u.into(),
        display_name: format!("Person {u}"),
        email: Some(format!("{u}@example.org")),
        role: Role::User,
        profile: String::new(),
        groups: groups.iter().map(|g| g.to_string()).collect(),
    };
    let out =
        bulk::import_people(&t, &mgr, &[row("carla", &[]), row("carla", &[]), row("dino", &["nowhere"])])
            .await
            .unwrap();
    assert!(out[0].ok && out[0].link.is_some());
    assert!(!out[1].ok, "the second carla already exists");
    assert_eq!((out[2].ok, out[2].code), (false, Some("group_unknown")));
    let members = mosaikit_kernel::tenancy::members(&t, &mgr).await.unwrap();
    assert!(members.iter().any(|m| m.username == "carla"));
    // only the Tenant Manager
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    assert_eq!(bulk::import_people(&t, &anna, &[]).await.unwrap_err().kind, Kind::Forbidden);

    // invitations of people of other tenants
    let b = t.tenant("beta").await;
    t.member(&b, "bruno").await;
    let out = bulk::invite_many(
        &t,
        &mgr,
        &["bruno@beta".into(), "nobody".into(), "ghost@beta".into()],
        Role::User,
        None,
    )
    .await
    .unwrap();
    assert_eq!(out.iter().map(|o| o.ok).collect::<Vec<_>>(), [true, false, false]);
    assert_eq!(out[1].code, Some("invite_address"));
}

#[tokio::test]
async fn asking_for_a_plugin_and_the_details_of_a_tenant() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let mgr = t.home(&g).await;
    bulk::ask_for_plugin(&t, &mgr, "a plugin for the minutes of the meetings").await.unwrap();
    let n: i64 = mosaikit_db::query_scalar("select count(*) from core.notifications where user_id = $1")
        .bind(admin.user_id)
        .fetch_one(&t.k.db)
        .await
        .unwrap();
    assert_eq!(n, 1);
    assert!(bulk::ask_for_plugin(&t, &mgr, " ").await.is_err());

    let alfa = mgr.tenant.tenant_id;
    assert_eq!(bulk::tenant_details(&t, &admin, alfa).await.unwrap(), TenantDetails::default());
    let d = TenantDetails {
        contact_name: "Maria Bianchi".into(),
        contact_email: "maria@alfa.example.org".into(),
        contact_phone: "+39 06 0000".into(),
        registration: "IT01234567890".into(),
    };
    bulk::set_tenant_details(&t, &admin, alfa, &d).await.unwrap();
    assert_eq!(bulk::tenant_details(&t, &admin, alfa).await.unwrap(), d);
    let bad = TenantDetails { contact_email: "nope".into(), ..d.clone() };
    assert!(bulk::set_tenant_details(&t, &admin, alfa, &bad).await.is_err());
    assert_eq!(bulk::tenant_details(&t, &g, alfa).await.unwrap_err().kind, Kind::Forbidden);
}
