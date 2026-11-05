//! Schedules: the registry (create, list, pause, resume, delete), who may do what, the limits and the
//! hooks that pause the schedules of a person who is removed or suspended. Nothing runs a job yet.
//! Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use std::collections::BTreeMap;

use mosaikit_kernel::plugins::tenants;
use mosaikit_kernel::schedules::{self as sc, CreateRequest};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{crud, tenancy, Caller, Kind};
use serde_json::{json, Value};
use uuid::Uuid;

const PLUGIN: &str = "com.test.sched";
const OTHER: &str = "com.test.schedother";

fn echo_wasm() -> Vec<u8> {
    wat::parse_str(
        r#"(module
  (memory (export "memory") 2)
  (data (i32.const 32768) "{\"ok\":null}")
  (global $bump (mut i32) (i32.const 65536))
  (func (export "msk_alloc") (param $len i32) (result i32)
    (local $p i32) (local.set $p (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $len))) (local.get $p))
  (func (export "msk_call") (param $ptr i32) (param $len i32) (result i64)
    (i64.or (i64.shl (i64.const 32768) (i64.const 32)) (i64.const 11)))
)"#,
    )
    .unwrap()
}

fn toml(id: &str, schedules: &str) -> String {
    format!(
        "id = \"{id}\"\nname = \"Sched\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"Sched\"\n\
         [requires]\nmosaikit = \">=1.0\"\n\
         [[resources]]\nname = \"items\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n\
         [permissions]\nrun_commands = [\"x\"]\nnetwork = [\"https://svc:8080\"]\n{schedules}"
    )
}

const DECLS: &str = r#"
[[schedules]]
name = "sync"
command = "x"
target = "https://svc:8080/run"

[[schedules]]
name = "capped"
command = "x"
target = "https://svc:8080/run"
max_per_tenant = 2

[[schedules]]
name = "scoped"
command = "x"
target = "https://svc:8080/run"
resources_required = true
"#;

async fn install(t: &TestKernel, id: &str, schedules: &str) {
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml(id, schedules).into_bytes());
    files.insert("logic.wasm".to_string(), echo_wasm());
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

/// Two tenants. In `alfa`: anna, bob, the manager. In `beta`: carl and his manager.
struct World {
    t: TestKernel,
    anna: Caller,
    bob: Caller,
    mgr: Caller,
    carl: Caller,
    beta_mgr: Caller,
    /// an item of anna and one of bob's (of the schedules plugin), and an item of anna's of another plugin
    a: Uuid,
    b: Uuid,
    other: Uuid,
}

async fn item(t: &TestKernel, who: &Caller, plugin: &str) -> Uuid {
    let row = crud::create(t, who, plugin, "items", json!({ "title": "i" }).as_object().unwrap(), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn world() -> World {
    let t = start().await;
    install(&t, PLUGIN, DECLS).await;
    install(&t, OTHER, "").await;
    let alfa = t.tenant("alfa").await;
    let anna = t.member(&alfa, "anna").await;
    let bob = t.member(&alfa, "bob").await;
    let mgr = t.home(&alfa).await;
    let (anna, bob) = (t.home(&anna).await, t.home(&bob).await);
    let beta = t.tenant("beta").await;
    let carl = t.member(&beta, "carl").await;
    let carl = t.home(&carl).await;
    let beta_mgr = t.home(&beta).await;
    let (a, b, other) =
        (item(&t, &anna, PLUGIN).await, item(&t, &bob, PLUGIN).await, item(&t, &anna, OTHER).await);
    World { t, anna, bob, mgr, carl, beta_mgr, a, b, other }
}

fn req(name: &str, cron: &str) -> CreateRequest {
    CreateRequest {
        plugin: PLUGIN.into(),
        name: name.into(),
        cron: cron.into(),
        args: None,
        resources: None,
        label: None,
        ..Default::default()
    }
}

async fn make(w: &World, who: &Caller, name: &str) -> Uuid {
    sc::create(&w.t, who, &req(name, "0 3 * * *")).await.unwrap().id
}

/// Kind and code of the refusal of a create.
async fn refused(w: &World, who: &Caller, r: CreateRequest) -> (Kind, String) {
    let e = sc::create(&w.t, who, &r).await.unwrap_err();
    (e.kind, e.code().to_string())
}

async fn state(w: &World, id: Uuid) -> (String, Option<String>) {
    let row = mosaikit_db::query("select status, paused_reason from core.schedules where id = $1")
        .bind(id)
        .fetch_one(&w.t.db)
        .await
        .unwrap();
    (row.get(0), row.get(1))
}

async fn events(w: &World, action: &str) -> Vec<Value> {
    mosaikit_db::query_scalar("select detail from core.events where action = $1 order by id")
        .bind(action)
        .fetch_all(&w.t.db)
        .await
        .unwrap()
}

#[tokio::test]
async fn the_author_creates_and_lists_and_a_manager_sees_all_but_not_the_content() {
    let w = world().await;
    let mut r = req("sync", "*/30 * * * *");
    r.args = Some(json!({ "secret": "s3" }));
    r.resources = Some(vec![w.a]);
    r.label = Some("  Nightly  ".into());
    let made = sc::create(&w.t, &w.anna, &r).await.unwrap();
    assert!(made.next_run_at > chrono::Utc::now());
    let own = sc::list(&w.t, &w.anna, None).await.unwrap();
    assert_eq!(own.len(), 1);
    assert_eq!((own[0].id, own[0].name.as_str(), own[0].label.as_str()), (made.id, "sync", "Nightly"));
    assert_eq!(own[0].status, "active");
    assert_eq!(own[0].args, Some(json!({ "secret": "s3" })));
    assert_eq!(own[0].resources, Some(vec![w.a]));
    // another member sees nothing; a manager sees it without the arguments and the resources
    assert!(sc::list(&w.t, &w.bob, None).await.unwrap().is_empty());
    let all = sc::list(&w.t, &w.mgr, None).await.unwrap();
    assert_eq!(all.len(), 1);
    assert!(all[0].args.is_none() && all[0].resources.is_none() && !all[0].mine);
    assert_eq!(all[0].author, w.anna.user.user_id);
    assert!(sc::list(&w.t, &w.mgr, Some(OTHER)).await.unwrap().is_empty());
    assert_eq!(sc::list(&w.t, &w.mgr, Some(PLUGIN)).await.unwrap().len(), 1);
    // the audit row has no arguments
    let ev = events(&w, "schedule.create").await;
    assert_eq!(ev.len(), 1);
    assert!(!ev[0].to_string().contains("s3"), "{}", ev[0]);
    assert_eq!(ev[0]["schedule"], made.id.to_string());
}

#[tokio::test]
async fn only_the_author_or_a_manager_acts_on_a_schedule() {
    let w = world().await;
    let id = make(&w, &w.anna, "sync").await;
    // somebody else: it does not exist
    for e in [
        sc::pause(&w.t, &w.bob, id).await.unwrap_err(),
        sc::resume(&w.t, &w.bob, id).await.unwrap_err(),
        sc::delete(&w.t, &w.bob, id).await.unwrap_err(),
    ] {
        assert_eq!(e.kind, Kind::NotFound);
    }
    assert_eq!(state(&w, id).await, ("active".into(), None));
    // the author pauses and resumes
    sc::pause(&w.t, &w.anna, id).await.unwrap();
    assert_eq!(state(&w, id).await, ("paused".into(), Some("author".into())));
    // a manager cannot undo the decision of the author
    let e = sc::resume(&w.t, &w.mgr, id).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::Forbidden, "author_must_resume"));
    sc::resume(&w.t, &w.anna, id).await.unwrap();
    assert_eq!(state(&w, id).await, ("active".into(), None));
    // a manager pauses (and resumes their own pause)
    sc::pause(&w.t, &w.mgr, id).await.unwrap();
    assert_eq!(state(&w, id).await, ("paused".into(), Some("manager".into())));
    sc::resume(&w.t, &w.mgr, id).await.unwrap();
    assert_eq!(state(&w, id).await, ("active".into(), None));
    // a manager deletes, and the audit says who did what
    sc::delete(&w.t, &w.mgr, id).await.unwrap();
    assert!(sc::list(&w.t, &w.anna, None).await.unwrap().is_empty());
    assert_eq!(events(&w, "schedule.pause").await.len(), 2);
    assert_eq!(events(&w, "schedule.resume").await.len(), 2);
    let del = events(&w, "schedule.delete").await;
    assert_eq!((del.len(), del[0]["author"].clone()), (1, json!(w.anna.user.user_id.to_string())));
    // the author deletes their own
    let id2 = make(&w, &w.anna, "sync").await;
    sc::delete(&w.t, &w.anna, id2).await.unwrap();
    assert_eq!(sc::delete(&w.t, &w.anna, id2).await.unwrap_err().kind, Kind::NotFound);
}

#[tokio::test]
async fn the_tenants_are_apart() {
    let w = world().await;
    let id = make(&w, &w.anna, "sync").await;
    // the id of a schedule of alfa, used in beta by a member and by the manager of beta
    for who in [&w.carl, &w.beta_mgr] {
        assert_eq!(sc::pause(&w.t, who, id).await.unwrap_err().kind, Kind::NotFound);
        assert_eq!(sc::resume(&w.t, who, id).await.unwrap_err().kind, Kind::NotFound);
        assert_eq!(sc::delete(&w.t, who, id).await.unwrap_err().kind, Kind::NotFound);
        assert!(sc::list(&w.t, who, None).await.unwrap().is_empty());
    }
    assert_eq!(state(&w, id).await, ("active".into(), None));
    // a person of beta registers their own, which alfa does not see
    let cid = make(&w, &w.carl, "sync").await;
    assert_eq!(sc::list(&w.t, &w.mgr, None).await.unwrap().len(), 1);
    assert_eq!(sc::list(&w.t, &w.beta_mgr, None).await.unwrap()[0].id, cid);
    // the cap of a kind counts per tenant: two in alfa do not use up beta's
    make(&w, &w.anna, "capped").await;
    make(&w, &w.bob, "capped").await;
    make(&w, &w.carl, "capped").await;
}

#[tokio::test]
async fn what_the_manifest_does_not_declare_is_refused() {
    let w = world().await;
    assert_eq!(
        refused(&w, &w.anna, req("nope", "0 3 * * *")).await,
        (Kind::BadRequest, "schedule_not_declared".into())
    );
    // a plugin that declares none
    let mut r = req("sync", "0 3 * * *");
    r.plugin = OTHER.into();
    assert_eq!(refused(&w, &w.anna, r.clone()).await.1, "schedule_not_declared");
    // a plugin that is not there
    r.plugin = "com.test.missing".into();
    assert_eq!(refused(&w, &w.anna, r).await.0, Kind::NotFound);
}

#[tokio::test]
async fn a_plugin_that_is_off_for_the_tenant_takes_no_schedule_and_no_resume() {
    let w = world().await;
    let id = make(&w, &w.anna, "sync").await;
    sc::pause(&w.t, &w.mgr, id).await.unwrap();
    tenants::set_enabled(&w.t, &w.mgr, PLUGIN, false).await.unwrap();
    // the plugin does not exist for the tenant while it is off
    assert_eq!(refused(&w, &w.anna, req("sync", "0 3 * * *")).await.0, Kind::NotFound);
    assert!(sc::resume(&w.t, &w.anna, id).await.is_err());
    assert!(sc::resume(&w.t, &w.mgr, id).await.is_err());
    assert_eq!(state(&w, id).await.0, "paused");
    // the other tenant is not affected
    make(&w, &w.carl, "sync").await;
    tenants::set_enabled(&w.t, &w.mgr, PLUGIN, true).await.unwrap();
    sc::resume(&w.t, &w.anna, id).await.unwrap();
    assert_eq!(state(&w, id).await.0, "active");
}

#[tokio::test]
async fn the_timetable_is_checked() {
    let w = world().await;
    let bad = |c: &str| (Kind::BadRequest, c.to_string());
    // below the floor of the kernel (5) and of the entry (15 by default), also when only some gaps are short
    for cron in ["* * * * *", "*/10 * * * *", "0,5 * * * *", "0,14 9 * * *"] {
        assert_eq!(refused(&w, &w.anna, req("sync", cron)).await, bad("interval_too_short"), "{cron}");
    }
    // not a cron of five fields, or never fires
    for cron in ["", "0 3 * *", "0 0 3 * * *", "0 3 * * MON", "61 * * * *", "0 0 31 2 *", "@daily"] {
        assert_eq!(refused(&w, &w.anna, req("sync", cron)).await, bad("bad_cron"), "{cron}");
    }
    // the edge is allowed
    sc::create(&w.t, &w.anna, &req("sync", "*/15 * * * *")).await.unwrap();
    // a whole number of fields with odd spacing is stored in one form
    sc::create(&w.t, &w.anna, &req("sync", "  0   3 * *  * ")).await.unwrap();
    let cron: Vec<String> =
        sc::list(&w.t, &w.anna, None).await.unwrap().into_iter().map(|s| s.cron).collect();
    assert_eq!(cron, ["*/15 * * * *", "0 3 * * *"]);
}

#[tokio::test]
async fn arguments_label_and_resources_are_checked() {
    let w = world().await;
    let bad = |c: &str| (Kind::BadRequest, c.to_string());
    let mut r = req("sync", "0 3 * * *");
    r.args = Some(json!({ "blob": "x".repeat(70 * 1024) }));
    assert_eq!(refused(&w, &w.anna, r).await, bad("args_too_large"));
    let mut r = req("sync", "0 3 * * *");
    r.args = Some(json!([1, 2]));
    assert_eq!(refused(&w, &w.anna, r).await, bad("bad_args"));
    let mut r = req("sync", "0 3 * * *");
    r.label = Some("x".repeat(121));
    assert_eq!(refused(&w, &w.anna, r).await, bad("bad_label"));
    // a resource of another plugin, one the author does not see, one that is not there, an empty list
    for ids in [vec![w.other], vec![w.b], vec![Uuid::new_v4()], vec![]] {
        let mut r = req("sync", "0 3 * * *");
        r.resources = Some(ids);
        let (kind, _) = refused(&w, &w.anna, r).await;
        assert!(matches!(kind, Kind::BadRequest | Kind::NotFound), "{kind:?}");
    }
    // what the entry requires: resources
    assert_eq!(refused(&w, &w.anna, req("scoped", "0 3 * * *")).await, bad("resources_required"));
    let mut r = req("scoped", "0 3 * * *");
    r.resources = Some(vec![w.a]);
    sc::create(&w.t, &w.anna, &r).await.unwrap();
    assert!(sc::list(&w.t, &w.anna, None).await.unwrap().len() == 1);
}

#[tokio::test]
async fn a_run_ticket_cannot_register_or_manage() {
    let w = world().await;
    let id = make(&w, &w.anna, "sync").await;
    let mut c = w.anna.clone();
    c.run = Some(mosaikit_kernel::RunCall {
        ticket: Uuid::new_v4(),
        run_ref: "r".into(),
        resources: None,
        scheduled_by: None,
        schedule_name: None,
    });
    assert_eq!(sc::create(&w.t, &c, &req("sync", "0 3 * * *")).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(sc::pause(&w.t, &c, id).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(sc::delete(&w.t, &c, id).await.unwrap_err().kind, Kind::Forbidden);
}

#[tokio::test]
async fn the_limits_hold() {
    let w = world().await;
    // per kind and tenant: the entry says 2
    make(&w, &w.anna, "capped").await;
    make(&w, &w.bob, "capped").await;
    assert_eq!(
        refused(&w, &w.anna, req("capped", "0 3 * * *")).await,
        (Kind::BadRequest, "too_many_schedules_of_kind".into())
    );
    // a deleted one frees a place
    let mine = sc::list(&w.t, &w.anna, None).await.unwrap()[0].id;
    sc::delete(&w.t, &w.anna, mine).await.unwrap();
    make(&w, &w.anna, "capped").await;

    // per person: 50 in the tenant, all plugins together (bob already has one above)
    let tenant = w.bob.tenant.tenant_id;
    for i in 0..(sc::MAX_PER_PERSON - 1) {
        mosaikit_db::query(
            "insert into core.schedules (tenant_id, user_id, plugin_id, name, cron) values ($1, $2, $3, $4, '0 3 * * *')",
        )
        .bind(tenant)
        .bind(w.bob.user.user_id)
        .bind(PLUGIN)
        .bind(format!("filler{i}"))
        .execute(&w.t.db)
        .await
        .unwrap();
    }
    assert_eq!(
        refused(&w, &w.bob, req("sync", "0 3 * * *")).await,
        (Kind::BadRequest, "too_many_schedules".into())
    );
    // the cap is of the person: anna can still register
    make(&w, &w.anna, "sync").await;
}

#[tokio::test]
async fn creating_is_rate_limited_per_person() {
    let w = world().await;
    for _ in 0..10 {
        make(&w, &w.bob, "sync").await;
    }
    // 10 a minute are allowed; the 11th waits (it is of another kind, so no cap of a kind is what stops it)
    let e = sc::create(&w.t, &w.bob, &req("capped", "0 3 * * *")).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::TooMany, "schedule_rate_limited"));
    // another person is not held back
    let mut r = req("scoped", "0 3 * * *");
    r.resources = Some(vec![w.a]);
    sc::create(&w.t, &w.anna, &r).await.unwrap();
}

#[tokio::test]
async fn a_suspended_or_removed_author_has_their_schedules_paused() {
    let w = world().await;
    let (a1, a2) = (make(&w, &w.anna, "sync").await, make(&w, &w.anna, "capped").await);
    let b1 = make(&w, &w.bob, "sync").await;
    let c1 = make(&w, &w.carl, "sync").await;
    // one that the author had paused keeps its own reason
    sc::pause(&w.t, &w.anna, a2).await.unwrap();

    tenancy::set_member_suspended(&w.t, &w.mgr, w.anna.user.user_id, true).await.unwrap();
    assert_eq!(state(&w, a1).await, ("paused".into(), Some("author_inactive".into())));
    assert_eq!(state(&w, a2).await, ("paused".into(), Some("author".into())));
    assert_eq!(state(&w, b1).await.0, "active");
    assert_eq!(state(&w, c1).await.0, "active");

    // reactivating does not resume: the manager cannot, the author must
    tenancy::set_member_suspended(&w.t, &w.mgr, w.anna.user.user_id, false).await.unwrap();
    assert_eq!(state(&w, a1).await.0, "paused");
    let e = sc::resume(&w.t, &w.mgr, a1).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::Forbidden, "author_must_resume"));
    sc::resume(&w.t, &w.anna, a1).await.unwrap();
    assert_eq!(state(&w, a1).await, ("active".into(), None));

    // removed from the tenant: bob owns an item, so it goes to anna
    tenancy::remove_member(&w.t, &w.mgr, w.bob.user.user_id, Some(w.anna.user.user_id)).await.unwrap();
    assert_eq!(state(&w, b1).await, ("paused".into(), Some("author_inactive".into())));
    assert_eq!(state(&w, a1).await.0, "active");
    assert_eq!(state(&w, c1).await.0, "active");
}

#[tokio::test]
async fn a_schedule_is_edited_in_place_and_keeps_its_history() {
    use mosaikit_kernel::schedules::PatchRequest;
    let w = world().await;
    let id = make(&w, &w.anna, "sync").await;
    let patch = |f: &dyn Fn(&mut PatchRequest)| {
        let mut p = PatchRequest::default();
        f(&mut p);
        p
    };
    // the author changes the label, the timetable and the arguments; the id stays
    let s = sc::update(
        &w.t,
        &w.anna,
        id,
        &patch(&|p| {
            p.label = Some("Nightly".into());
            p.cron = Some("30  4 * * *".into());
            p.time_zone = Some("Europe/Rome".into());
            p.args = Some(json!({ "x": 1 }));
        }),
    )
    .await
    .unwrap();
    assert_eq!(
        (s.id, s.label.as_str(), s.cron.as_str(), s.time_zone.as_str()),
        (id, "Nightly", "30 4 * * *", "Europe/Rome")
    );
    assert_eq!(s.args, Some(json!({ "x": 1 })));
    assert!(s.next_run_at.is_some());
    // pause and resume through `enabled`
    let s = sc::update(&w.t, &w.anna, id, &patch(&|p| p.enabled = Some(false))).await.unwrap();
    assert_eq!(s.status, "paused");
    let s = sc::update(&w.t, &w.anna, id, &patch(&|p| p.enabled = Some(true))).await.unwrap();
    assert_eq!(s.status, "active");
    // the same checks as a create
    let e = sc::update(&w.t, &w.anna, id, &patch(&|p| p.cron = Some("* * * * *".into()))).await.unwrap_err();
    assert_eq!(e.code(), "interval_too_short");
    let e =
        sc::update(&w.t, &w.anna, id, &patch(&|p| p.time_zone = Some("Mars/Base".into()))).await.unwrap_err();
    assert_eq!(e.code(), "bad_time_zone");
    let e = sc::update(&w.t, &w.anna, id, &patch(&|p| p.resources = Some(vec![w.other]))).await.unwrap_err();
    assert_eq!(e.code(), "bad_resources");
    // a manager changes the timetable, never what the job does as the author
    sc::update(&w.t, &w.mgr, id, &patch(&|p| p.cron = Some("0 5 * * *".into()))).await.unwrap();
    let e = sc::update(&w.t, &w.mgr, id, &patch(&|p| p.args = Some(json!({})))).await.unwrap_err();
    assert_eq!(e.code(), "author_only");
    // another person does not even learn it exists
    let e = sc::update(&w.t, &w.bob, id, &patch(&|p| p.label = Some("x".into()))).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);
    assert_eq!(events(&w, "schedule.update").await.len(), 4);
}

#[tokio::test]
async fn a_new_schedule_reads_its_cron_in_the_time_zone_of_the_tenant() {
    let w = world().await;
    let values = json!({ "timezone": "Europe/Rome" }).as_object().cloned().unwrap();
    tenancy::levels::set_tenant(&w.t, &w.mgr, &values).await.unwrap();
    let id = make(&w, &w.anna, "sync").await;
    let list = sc::list(&w.t, &w.anna, None).await.unwrap();
    assert_eq!(list.iter().find(|s| s.id == id).unwrap().time_zone, "Europe/Rome");
    // a zone asked for wins; a wrong setting is refused
    let mut r = req("sync", "0 3 * * *");
    r.time_zone = Some("UTC".into());
    let other = sc::create(&w.t, &w.anna, &r).await.unwrap().id;
    assert_eq!(
        sc::list(&w.t, &w.anna, None).await.unwrap().iter().find(|s| s.id == other).unwrap().time_zone,
        "UTC"
    );
    let bad = json!({ "timezone": "Mars/Base" }).as_object().cloned().unwrap();
    assert!(tenancy::levels::set_tenant(&w.t, &w.mgr, &bad).await.is_err());
}
