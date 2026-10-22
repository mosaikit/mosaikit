//! Resources of the plugins: ownership, sharing, isolation, manager, hooks, commands, KPIs.

use mosaikit_kernel::acl::{grants, manager_resources, set_grant, transfer_owner, Level, ResourceFilter};
use mosaikit_kernel::tenancy::{
    create_group, invite, my_invitations, remove_member, respond_invitation, set_group_member, set_settings,
};
use mosaikit_kernel::testing::{start, TestKernel};
use mosaikit_kernel::{crud, kpi, Caller, Kind, Role};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

fn vals(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

fn id(row: &Value) -> Uuid {
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn note(t: &TestKernel, c: &Caller, title: &str) -> Value {
    crud::create(t, c, NOTES, "notes", &vals(json!({ "title": title, "body": "confidential" })), None)
        .await
        .unwrap()
}

async fn titles(t: &TestKernel, c: &Caller) -> Vec<String> {
    let mut v: Vec<String> = crud::list(t, c, NOTES, "notes", None, None)
        .await
        .unwrap()
        .rows
        .iter()
        .map(|r| r["values"]["title"].as_str().unwrap().to_string())
        .collect();
    v.sort();
    v
}

struct World {
    t: TestKernel,
    mgr: Caller,
    anna: Caller,
    bruno: Caller,
    other_tenant: Caller,
}

async fn world() -> World {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let gb = t.tenant("beta").await;
    World {
        mgr: t.home(&g).await,
        anna: t.home(&anna).await,
        bruno: t.home(&bruno).await,
        other_tenant: t.home(&gb).await,
        t,
    }
}

#[tokio::test]
async fn ownership_and_sharing_levels() {
    let w = world().await;
    let t = &w.t;
    let row = note(t, &w.anna, "piano").await;
    let rid = id(&row);
    assert_eq!(row["my_level"], "manage");
    assert_eq!(row["values"]["tag"], "personal", "before_create hook of the notes plugin");

    assert_eq!(titles(t, &w.anna).await, vec!["piano"]);
    assert!(titles(t, &w.bruno).await.is_empty(), "not shared");
    assert_eq!(crud::get(t, &w.bruno, NOTES, "notes", rid).await.unwrap_err().kind, Kind::NotFound);

    // read
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Read)).await.unwrap();
    assert_eq!(titles(t, &w.bruno).await, vec!["piano"]);
    let e = crud::update(t, &w.bruno, NOTES, "notes", rid, &vals(json!({ "title": "x" }))).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    // write: changes but neither deletes nor shares
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Write)).await.unwrap();
    let upd = crud::update(t, &w.bruno, NOTES, "notes", rid, &vals(json!({ "body": "reviewed by bruno" })))
        .await
        .unwrap();
    assert_eq!(upd["values"]["title"], "piano", "partial update");
    assert_eq!(upd["values"]["body"], "reviewed by bruno");
    assert_eq!(crud::delete(t, &w.bruno, NOTES, "notes", rid).await.unwrap_err().kind, Kind::Forbidden);
    let e = set_grant(t, &w.bruno, rid, "user", w.mgr.user.user_id, Some(Level::Read)).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    // manage: shares and deletes
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Manage)).await.unwrap();
    assert_eq!(grants(t, &w.bruno, rid).await.unwrap().len(), 1);
    // revocation
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, None).await.unwrap();
    assert!(titles(t, &w.bruno).await.is_empty());
    crud::delete(t, &w.anna, NOTES, "notes", rid).await.unwrap();
    assert!(titles(t, &w.anna).await.is_empty());
}

#[tokio::test]
async fn sharing_with_a_group() {
    let w = world().await;
    let t = &w.t;
    let rid = id(&note(t, &w.anna, "group note").await);
    let gid = create_group(t, &w.mgr, "Editorial").await.unwrap();
    set_grant(t, &w.anna, rid, "group", gid, Some(Level::Read)).await.unwrap();
    assert!(titles(t, &w.bruno).await.is_empty());
    set_group_member(t, &w.mgr, gid, w.bruno.user.user_id, true).await.unwrap();
    assert_eq!(titles(t, &w.bruno).await, vec!["group note"]);
    set_group_member(t, &w.mgr, gid, w.bruno.user.user_id, false).await.unwrap();
    assert!(titles(t, &w.bruno).await.is_empty());
}

#[tokio::test]
async fn isolation_between_tenants() {
    let w = world().await;
    let t = &w.t;
    let rid = id(&note(t, &w.anna, "alfa only").await);
    assert!(titles(t, &w.other_tenant).await.is_empty());
    assert_eq!(crud::get(t, &w.other_tenant, NOTES, "notes", rid).await.unwrap_err().kind, Kind::NotFound);
    // no sharing with whoever is not a member of the tenant
    let e =
        set_grant(t, &w.anna, rid, "user", w.other_tenant.user.user_id, Some(Level::Read)).await.unwrap_err();
    assert_eq!(e.kind, Kind::BadRequest);
    // an invited guest instead yes
    let inv = invite(t, &w.mgr, "beta", "beta-manager", Role::User).await.unwrap();
    let guest = w.other_tenant.user.clone();
    respond_invitation(t, &guest, my_invitations(t, &guest).await.unwrap()[0].id, true).await.unwrap();
    let _ = inv;
    set_grant(t, &w.anna, rid, "user", guest.user_id, Some(Level::Read)).await.unwrap();
    let guest_in_alfa = t.caller(&guest, "alfa").await;
    assert_eq!(titles(t, &guest_in_alfa).await, vec!["alfa only"]);
    assert!(titles(t, &w.other_tenant).await.is_empty(), "the note is not in their tenant");
}

#[tokio::test]
async fn the_manager_sees_metadata_not_contents() {
    let w = world().await;
    let t = &w.t;
    let rid = id(&note(t, &w.anna, "confidential minutes").await);
    assert!(titles(t, &w.mgr).await.is_empty(), "the manager does not read the content");
    assert_eq!(crud::get(t, &w.mgr, NOTES, "notes", rid).await.unwrap_err().kind, Kind::NotFound);
    let meta = manager_resources(t, &w.mgr, &ResourceFilter::default()).await.unwrap();
    assert_eq!(meta.len(), 1);
    assert_eq!(meta[0].title, "confidential minutes");
    assert_eq!(meta[0].owner_name, "anna");
    let json = serde_json::to_string(&meta).unwrap();
    assert!(!json.contains("confidential\"") || !json.contains("body"), "no content field");
    // policy: hidden titles
    let mut s = w.mgr.tenant.settings.clone();
    s.managers_see_titles = false;
    set_settings(t, &w.mgr, &s).await.unwrap();
    let g2 = t.caller(&w.mgr.user, "alfa").await;
    assert_eq!(manager_resources(t, &g2, &ResourceFilter::default()).await.unwrap()[0].title, "");
    // a member does not see the list
    assert_eq!(
        manager_resources(t, &w.anna, &ResourceFilter::default()).await.unwrap_err().kind,
        Kind::Forbidden
    );
}

#[tokio::test]
async fn reassignment_when_a_user_leaves() {
    let w = world().await;
    let t = &w.t;
    let r1 = id(&note(t, &w.anna, "uno").await);
    note(t, &w.anna, "due").await;
    set_grant(t, &w.anna, r1, "user", w.mgr.user.user_id, Some(Level::Read)).await.unwrap();
    let e = remove_member(t, &w.mgr, w.anna.user.user_id, None).await.unwrap_err();
    assert!(e.message.contains("reassign"), "{e}");
    let rep = remove_member(t, &w.mgr, w.anna.user.user_id, Some(w.bruno.user.user_id)).await.unwrap();
    assert_eq!(rep.reassigned, 2);
    assert!(rep.disabled);
    assert_eq!(titles(t, &w.bruno).await, vec!["due", "uno"], "bruno is the new owner");
    let row = crud::get(t, &w.bruno, NOTES, "notes", r1).await.unwrap();
    assert_eq!(row["my_level"], "manage");
    // the existing grants stay
    assert_eq!(titles(t, &w.mgr).await, vec!["uno"]);
}

#[tokio::test]
async fn ownership_transfer() {
    let w = world().await;
    let t = &w.t;
    let rid = id(&note(t, &w.anna, "goes to bruno").await);
    assert_eq!(
        transfer_owner(t, &w.bruno, rid, w.bruno.user.user_id).await.unwrap_err().kind,
        Kind::Forbidden
    );
    transfer_owner(t, &w.anna, rid, w.bruno.user.user_id).await.unwrap();
    assert!(titles(t, &w.anna).await.is_empty());
    assert_eq!(titles(t, &w.bruno).await, vec!["goes to bruno"]);
    // the manager can transfer too
    transfer_owner(t, &w.mgr, rid, w.anna.user.user_id).await.unwrap();
    assert_eq!(titles(t, &w.anna).await, vec!["goes to bruno"]);
}

#[tokio::test]
async fn validation_and_refusing_hooks() {
    let w = world().await;
    let t = &w.t;
    t.install("contacts").await;
    let c = &w.anna;
    let e = crud::create(t, c, NOTES, "notes", &vals(json!({ "body": "without title" })), None)
        .await
        .unwrap_err();
    assert!(e.message.contains("required"), "{e}");
    let e = crud::create(t, c, NOTES, "notes", &vals(json!({ "title": "x", "tag": "nonexistent" })), None)
        .await
        .unwrap_err();
    assert!(e.message.contains("options"), "{e}");
    let e = crud::create(t, c, NOTES, "notes", &vals(json!({ "title": "x", "nope": 1 })), None)
        .await
        .unwrap_err();
    assert!(e.message.contains("unknown"), "{e}");

    let ok = crud::create(
        t,
        c,
        "com.mosaikit.contacts",
        "contacts",
        &vals(json!({ "name": "Mario", "email": "Mario@Example.COM" })),
        None,
    )
    .await
    .unwrap();
    assert_eq!(ok["values"]["email"], "mario@example.com");
    let e = crud::create(
        t,
        c,
        "com.mosaikit.contacts",
        "contacts",
        &vals(json!({ "name": "Luigi", "email": "not-valid" })),
        None,
    )
    .await
    .unwrap_err();
    assert!(e.message.contains("invalid email"), "{e}");
    // the message of the plugin keeps its own code: the interface shows it, not the generic text
    assert_eq!(e.code(), "plugin_error");
    // the hook refused: no orphan resource
    let n: i64 = mosaikit_db::query_scalar(
        "select count(*) from core.resources where plugin_id = 'com.mosaikit.contacts'",
    )
    .fetch_one(&t.db)
    .await
    .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn hook_with_previous_values_and_computed_fields() {
    let w = world().await;
    let t = &w.t;
    t.install("tasks").await;
    t.install("maps").await;
    let c = &w.anna;
    let task = crud::create(
        t,
        c,
        "com.mosaikit.tasks",
        "tasks",
        &vals(json!({ "title": "report", "done": false })),
        None,
    )
    .await
    .unwrap();
    assert_eq!(task["values"]["priority"], "medium");
    assert!(task["values"]["completed_on"].is_null());
    let done = crud::update(t, c, "com.mosaikit.tasks", "tasks", id(&task), &vals(json!({ "done": true })))
        .await
        .unwrap();
    assert!(done["values"]["completed_on"].as_str().unwrap().len() == 10, "completion date from the DB");

    let cfg = json!({ "layers": [{ "id": "a" }, { "id": "b" }, { "id": "c" }] }).to_string();
    let map = crud::create(
        t,
        c,
        "com.mosaikit.maps",
        "maps",
        &vals(json!({ "name": "Water network", "config": cfg })),
        None,
    )
    .await
    .unwrap();
    assert_eq!(map["values"]["layers"], 3.0);
}

#[tokio::test]
async fn wasm_commands_respect_rls() {
    let w = world().await;
    let t = &w.t;
    note(t, &w.anna, "a1").await;
    crud::create(t, &w.anna, NOTES, "notes", &vals(json!({ "title": "a2", "tag": "work" })), None)
        .await
        .unwrap();
    note(t, &w.bruno, "b1").await;
    let mine = crud::call(t, &w.anna, NOTES, "notes.count_by_tag", json!({})).await.unwrap();
    let total: i64 = mine.as_array().unwrap().iter().map(|r| r["n"].as_i64().unwrap()).sum();
    assert_eq!(total, 2, "the command sees only anna's notes: {mine}");
    let e = crud::call(t, &w.anna, NOTES, "notes.nonexistent", json!({})).await.unwrap_err();
    assert!(e.message.contains("unknown"));
}

#[tokio::test]
async fn kpis_per_tenant_and_global() {
    let w = world().await;
    let t = &w.t;
    note(t, &w.anna, "1").await;
    crud::create(t, &w.bruno, NOTES, "notes", &vals(json!({ "title": "2", "tag": "work" })), None)
        .await
        .unwrap();
    note(t, &w.other_tenant, "beta").await;

    let k = kpi::tenant(t, &w.mgr).await.unwrap();
    assert_eq!(k.core.members, 3);
    assert_eq!(k.core.resources.iter().map(|r| r.count).sum::<i64>(), 2);
    let notes_kpi = k.plugins.iter().find(|p| p.view == "kpi_notes_by_tag").unwrap();
    let total: i64 = notes_kpi.rows.iter().map(|r| r["notes"].as_i64().unwrap()).sum();
    assert_eq!(total, 2, "only the alfa tenant");
    assert!(notes_kpi.rows.iter().all(|r| r.get("tenant_id").is_none()));
    assert_eq!(kpi::tenant(t, &w.anna).await.unwrap_err().kind, Kind::Forbidden);

    let admin = t.admin().await;
    let g = kpi::global(t, &admin).await.unwrap();
    assert_eq!(g.tenants.len(), 2, "the system tenant is not among the tenants");
    let notes_kpi = g.plugins.iter().find(|p| p.view == "kpi_notes_by_tag").unwrap();
    let tenants: std::collections::BTreeSet<&str> =
        notes_kpi.rows.iter().map(|r| r["tenant"].as_str().unwrap()).collect();
    assert_eq!(tenants.into_iter().collect::<Vec<_>>(), vec!["alfa", "beta"]);
    assert_eq!(kpi::global(t, &w.mgr.user).await.unwrap_err().kind, Kind::Forbidden);
}

/// The APIs of the kernel must be usable by HTTP handlers (`Send` futures).
#[allow(dead_code)]
fn the_futures_are_send(k: std::sync::Arc<mosaikit_kernel::Kernel>, c: Caller) {
    fn send<F: std::future::Future + Send + 'static>(_: F) {}
    let (k1, c1) = (k.clone(), c.clone());
    send(async move { crud::create(&k1, &c1, "p", "r", &Map::new(), None).await });
    let (k1, c1) = (k.clone(), c.clone());
    send(async move { crud::call(&k1, &c1, "p", "x", Value::Null).await });
    let k1 = k.clone();
    send(async move {
        mosaikit_kernel::plugins::install_package(
            &k1,
            None,
            &[],
            mosaikit_kernel::plugins::InstallSource::Upload,
        )
        .await
        .map(|_| ())
    });
    let (k1, c1) = (k.clone(), c.clone());
    send(async move { mosaikit_kernel::files::upload(&k1, &c1, "p", None, "x", &[], false).await });
    let (k1, c1) = (k, c);
    send(async move { mosaikit_kernel::content::upload_site(&k1, &c1, "p", Uuid::nil(), &[]).await });
}

#[tokio::test]
async fn overview_by_role() {
    use mosaikit_kernel::overview::overview;
    let w = world().await;
    let t = &w.t;
    let a = id(&note(t, &w.anna, "piano").await);
    note(t, &w.anna, "draft").await;
    note(t, &w.bruno, "bruno's").await;
    set_grant(t, &w.anna, a, "user", w.bruno.user.user_id, Some(Level::Write)).await.unwrap();

    // User: only their own data, no aggregates of tenant or system
    let o = overview(t, &w.anna).await.unwrap();
    assert_eq!(o.role, Role::User);
    assert_eq!(o.me.resources.iter().map(|r| r.count).sum::<i64>(), 2);
    assert_eq!((o.me.shared_by_me, o.me.shared_with_me), (1, 0));
    assert!(o.tenant.is_none());
    let o = overview(t, &w.bruno).await.unwrap();
    assert_eq!(o.me.shared_with_me, 1);
    assert_eq!(o.me.recent_shares[0].title, "piano");
    assert_eq!(o.me.recent_shares[0].owner, "anna");
    assert_eq!(o.me.recent_shares[0].level, "write");

    // Tenant Manager: the aggregates of the tenant too
    let o = overview(t, &w.mgr).await.unwrap();
    assert_eq!(o.role, Role::TenantManager);
    let core = o.tenant.unwrap();
    assert_eq!(core.resources.iter().map(|r| r.count).sum::<i64>(), 3);
    assert_eq!(core.shares, 1);

    // Administrator: the aggregates of the system (not a member of any tenant)
    let admin = t.admin().await;
    let s = mosaikit_kernel::overview::system_overview(t, &admin).await.unwrap();
    assert_eq!((s.tenants, s.administrators, s.resources), (2, 1, 3));
    assert!(mosaikit_kernel::overview::system_overview(t, &w.mgr.user).await.is_err());
    assert!(s.plugins_active >= 1);
}
