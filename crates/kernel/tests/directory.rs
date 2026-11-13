//! Directory search for plugins (`[permissions] directory`): who may call it, what it returns, what it
//! never returns. The logic is hand-written WAT: `proxy` forwards its `args` to the host as a request and
//! returns the answer. Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use std::collections::BTreeMap;

use mosaikit_kernel::access::ProfileChange;
use mosaikit_kernel::plugin_directory::{self as dir, MAX_LIMIT, MAX_Q};
use mosaikit_kernel::run_tickets::{self as rt, MintRequest};
use mosaikit_kernel::tenancy::{create_group, set_settings};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{access, crud, links, Caller, Kind};
use serde_json::{json, Value};

const DIR: &str = "com.test.dirproxy";
const NODIR: &str = "com.test.nodirproxy";

fn proxy_wasm() -> Vec<u8> {
    wat::parse_str(
        r#"(module
  (import "msk" "host_call" (func $host_call (param i32 i32) (result i32)))
  (import "msk" "host_read" (func $host_read (param i32)))
  (memory (export "memory") 2)
  (data (i32.const 16) "\"args\":")
  (data (i32.const 32) ",\"ctx\":")
  (global $bump (mut i32) (i32.const 65536))
  (func (export "msk_alloc") (param $len i32) (result i32)
    (local $p i32) (local.set $p (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $len))) (local.get $p))
  (func $find (param $from i32) (param $to i32) (param $n i32) (result i32)
    (local $i i32) (local $k i32)
    (local.set $i (local.get $from))
    (block $done (loop $outer
      (br_if $done (i32.gt_u (i32.add (local.get $i) (i32.const 7)) (local.get $to)))
      (local.set $k (i32.const 0))
      (block $miss (loop $inner
        (br_if $miss (i32.ne (i32.load8_u (i32.add (local.get $i) (local.get $k)))
                             (i32.load8_u (i32.add (local.get $n) (local.get $k)))))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (if (i32.eq (local.get $k) (i32.const 7)) (then (return (local.get $i))))
        (br $inner)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $outer)))
    (i32.const -1))
  (func (export "msk_call") (param $ptr i32) (param $len i32) (result i64)
    (local $s i32) (local $e i32) (local $n i32)
    (local.set $s (i32.add (call $find (local.get $ptr) (i32.add (local.get $ptr) (local.get $len)) (i32.const 16)) (i32.const 7)))
    (local.set $e (call $find (local.get $s) (i32.add (local.get $ptr) (local.get $len)) (i32.const 32)))
    (local.set $n (call $host_call (local.get $s) (i32.sub (local.get $e) (local.get $s))))
    (call $host_read (i32.const 32768))
    (i64.or (i64.shl (i64.const 32768) (i64.const 32)) (i64.extend_i32_u (local.get $n))))
)"#,
    )
    .unwrap()
}

fn toml(id: &str, directory: bool) -> String {
    format!(
        "id = \"{id}\"\nname = \"Dir\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"Dir\"\n\
         [requires]\nmosaikit = \">=1.0\"\n\
         [[resources]]\nname = \"items\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n\
         [[public_commands]]\nname = \"x\"\ndescription = \"public\"\n\
         [[user_permissions]]\nkey = \"review\"\nlabel = \"Review\"\ndescription = \"Approves\"\ndefault = false\n\
         [permissions]\ndirectory = {directory}\nrun_commands = [\"x\"]\n"
    )
}

async fn install(t: &TestKernel, id: &str, directory: bool) {
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml(id, directory).into_bytes());
    files.insert("logic.wasm".to_string(), proxy_wasm());
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

/// `alfa`: the manager, anna and ana (share right), bob (no share right), ugo (disabled), mia (membership
/// suspended); groups Alfa Team and Ops. `beta`: carl, anabel, and the group Ana Beta.
struct World {
    t: TestKernel,
    mgr: Caller,
    anna: Caller,
    bob: Caller,
}

async fn world() -> World {
    let t = start().await;
    install(&t, DIR, true).await;
    install(&t, NODIR, false).await;
    let alfa = t.tenant("alfa").await;
    let mgr = t.home(&alfa).await;
    let mut who = std::collections::HashMap::new();
    for n in ["anna", "ana", "bob", "ugo", "mia"] {
        let u = t.member(&alfa, n).await;
        who.insert(n, u);
    }
    let reader = access::create_profile(&t, &mgr, "Reader", "", None).await.unwrap();
    let ch = ProfileChange {
        plugins: [(DIR.to_string(), vec!["use".to_string()]), (NODIR.to_string(), vec!["use".to_string()])]
            .into(),
        ..Default::default()
    };
    access::update_profile(&t, &mgr, reader.id, &ch).await.unwrap();
    access::set_member_profile(&t, &mgr, who["bob"].user_id, Some(reader.id)).await.unwrap();
    mosaikit_db::query("update core.users set status = 'disabled' where username = 'ugo'")
        .execute(&t.db)
        .await
        .unwrap();
    mosaikit_db::query(
        "update core.memberships set status = 'suspended' where user_id = (select id from core.users where username = 'mia')",
    )
    .execute(&t.db)
    .await
    .unwrap();
    for g in ["Alfa Team", "Ops"] {
        create_group(&t, &mgr, g).await.unwrap();
    }
    let beta = t.tenant("beta").await;
    let bmgr = t.home(&beta).await;
    t.member(&beta, "carl").await;
    t.member(&beta, "anabel").await;
    create_group(&t, &bmgr, "Ana Beta").await.unwrap();
    let anna = t.home(&who["anna"]).await;
    let bob = t.home(&who["bob"]).await;
    World { t, mgr, anna, bob }
}

fn q(kind: &str, q: &str) -> Value {
    json!({ "kind": kind, "q": q })
}

async fn names(w: &World, c: &Caller, req: Value) -> Vec<String> {
    let out = dir::search(&w.t, c, DIR, &req).await.unwrap();
    out.as_array()
        .unwrap()
        .iter()
        .map(|r| r.get("username").or(r.get("name")).unwrap().as_str().unwrap().to_string())
        .collect()
}

fn host(op: &str, req: Value) -> Value {
    json!({ "op": op, "req": req })
}

#[tokio::test]
async fn a_member_with_the_share_right_and_the_manager_find_people() {
    let w = world().await;
    // case-insensitive substring on the username or the name, in a fixed order
    assert_eq!(names(&w, &w.anna, q("user", "AN")).await, ["ana", "anna", "alfa-manager"]);
    assert_eq!(names(&w, &w.mgr, q("user", "nn")).await, ["anna"]);
    let rows = dir::search(&w.t, &w.anna, DIR, &q("user", "bob")).await.unwrap();
    let row = &rows[0];
    // id, username and name: nothing else, never the email
    let mut keys: Vec<_> = row.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["id", "name", "username"]);
    assert!(!rows.to_string().contains("example.org"), "{rows}");
    // groups: id and name
    let g = dir::search(&w.t, &w.anna, DIR, &q("group", "ALFA")).await.unwrap();
    assert_eq!(g.as_array().unwrap().len(), 1);
    assert_eq!(g[0]["name"], "Alfa Team");
    let mut keys: Vec<_> = g[0].as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["id", "name"]);
    // a wildcard of LIKE is text, not a pattern
    assert!(names(&w, &w.anna, q("user", "%")).await.is_empty());
    assert!(names(&w, &w.anna, q("user", "a_a")).await.is_empty());
}

#[tokio::test]
async fn only_the_tenant_of_the_caller_is_searched() {
    let w = world().await;
    // anabel and the group Ana Beta are of beta (the manager of alfa matches with the name "Manager")
    assert_eq!(names(&w, &w.anna, q("user", "ana")).await, ["ana", "alfa-manager"]);
    assert!(names(&w, &w.anna, q("user", "carl")).await.is_empty());
    assert!(names(&w, &w.anna, q("group", "beta")).await.is_empty());
    // the tenant is not an argument
    let mut req = q("user", "carl");
    req["tenant"] = json!("beta");
    assert!(names(&w, &w.mgr, req).await.is_empty());
}

#[tokio::test]
async fn disabled_and_suspended_people_are_hidden() {
    let w = world().await;
    assert!(names(&w, &w.anna, q("user", "ugo")).await.is_empty());
    assert!(names(&w, &w.anna, q("user", "mia")).await.is_empty());
    assert_eq!(names(&w, &w.anna, q("user", "bob")).await, ["bob"]);
}

#[tokio::test]
async fn only_who_may_manage_or_share_can_search() {
    let w = world().await;
    // bob uses the plugin but has no share right
    let e = dir::search(&w.t, &w.bob, DIR, &q("user", "an")).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::Forbidden, "permission_denied"));
    // the plugin that does not declare the permission is refused for everyone, the manager too
    for c in [&w.mgr, &w.anna] {
        let e = dir::search(&w.t, c, NODIR, &q("user", "an")).await.unwrap_err();
        assert_eq!((e.kind, e.code()), (Kind::Forbidden, "permission_denied"));
        assert!(e.message.contains("directory"), "{e}");
    }
    // a person without `use` in the plugin is refused too
    let none = ProfileChange { plugins: [(DIR.to_string(), vec![])].into(), ..Default::default() };
    let p = access::create_profile(&w.t, &w.mgr, "None", "", None).await.unwrap();
    access::update_profile(&w.t, &w.mgr, p.id, &none).await.unwrap();
    access::set_member_profile(&w.t, &w.mgr, w.anna.user.user_id, Some(p.id)).await.unwrap();
    assert!(dir::search(&w.t, &w.anna, DIR, &q("user", "an")).await.is_err());
}

#[tokio::test]
async fn the_arguments_are_checked() {
    let w = world().await;
    for req in [
        json!({ "q": "an" }),
        json!({ "kind": "team", "q": "an" }),
        json!({ "kind": 3, "q": "an" }),
        json!({ "kind": "user" }),
        json!({ "kind": "user", "q": "" }),
        json!({ "kind": "user", "q": "   " }),
        json!({ "kind": "user", "q": 7 }),
        json!({ "kind": "user", "q": "a".repeat(MAX_Q + 1) }),
        json!({ "kind": "user", "q": "a\nb" }),
        json!({ "kind": "user", "q": "an", "limit": 0 }),
        json!({ "kind": "user", "q": "an", "limit": -3 }),
        json!({ "kind": "user", "q": "an", "limit": "5" }),
    ] {
        let e = dir::search(&w.t, &w.anna, DIR, &req).await.unwrap_err();
        assert_eq!(e.kind, Kind::BadRequest, "{req}: {e}");
    }
    // exactly MAX_Q characters is fine
    dir::search(&w.t, &w.anna, DIR, &q("user", &"a".repeat(MAX_Q))).await.unwrap();
}

#[tokio::test]
async fn the_limit_has_a_default_and_a_cap() {
    let w = world().await;
    for i in 0..(MAX_LIMIT + 5) {
        let manager = w.t.login("alfa", "alfa-manager").await;
        w.t.member(&manager, &format!("zz{i:03}")).await;
    }
    let count = |v: Value| v.as_array().unwrap().len();
    let ask = |l: Option<i64>| {
        let mut r = q("user", "zz");
        if let Some(l) = l {
            r["limit"] = json!(l);
        }
        r
    };
    assert_eq!(count(dir::search(&w.t, &w.anna, DIR, &ask(None)).await.unwrap()), 20);
    assert_eq!(count(dir::search(&w.t, &w.anna, DIR, &ask(Some(3))).await.unwrap()), 3);
    assert_eq!(count(dir::search(&w.t, &w.anna, DIR, &ask(Some(1000))).await.unwrap()), MAX_LIMIT as usize);
    // the order is fixed
    let a = names(&w, &w.anna, ask(Some(5))).await;
    assert_eq!(a, ["zz000", "zz001", "zz002", "zz003", "zz004"]);
}

#[tokio::test]
async fn the_logic_asks_through_the_host() {
    let w = world().await;
    // a command called by a person at the keyboard
    let out = crud::call(&w.t, &w.anna, DIR, "x", host("directory.search", q("user", "bob"))).await.unwrap();
    assert_eq!(out[0]["username"], "bob");
    // without the right or the permission the host says no
    let e = crud::call(&w.t, &w.bob, DIR, "x", host("directory.search", q("user", "bob"))).await.unwrap_err();
    assert!(e.message.contains("share"), "{e}");
    let e =
        crud::call(&w.t, &w.anna, NODIR, "x", host("directory.search", q("user", "bob"))).await.unwrap_err();
    assert!(e.message.contains("directory"), "{e}");
}

#[tokio::test]
async fn it_is_refused_in_a_public_link() {
    let w = world().await;
    let mut s = w.mgr.tenant.settings.clone();
    s.public_commands_enabled = true;
    set_settings(&w.t, &w.mgr, &s).await.unwrap();
    let row = crud::create(&w.t, &w.anna, DIR, "items", json!({ "title": "t" }).as_object().unwrap(), None)
        .await
        .unwrap();
    let id = row["id"].as_str().unwrap().parse().unwrap();
    let l = links::create(&w.t, &w.anna, id, None, None).await.unwrap();
    let token = l.url.trim_end_matches('/').rsplit('/').next().unwrap().to_string();
    let r = links::resolve(&w.t, &token).await.unwrap();
    let e = crud::call_public(&w.t, &r, "x", host("directory.search", q("user", "bob"))).await.unwrap_err();
    assert!(e.message.contains("public link"), "{e}");
}

#[tokio::test]
async fn it_is_refused_in_a_call_on_behalf_of_a_run() {
    let w = world().await;
    let m = rt::mint(
        &w.t,
        &w.anna,
        &MintRequest {
            plugin: DIR.into(),
            commands: vec!["x".into()],
            run_ref: "run-1".into(),
            ttl_minutes: None,
            uses: None,
            resources: None,
            targets: vec![],
            schedule: None,
        },
    )
    .await
    .unwrap();
    // anna may search at the keyboard; her run may not
    let e = rt::call(&w.t, &m.token, DIR, "x", host("directory.search", q("user", "bob"))).await.unwrap_err();
    assert!(e.message.contains("run"), "{e}");
    let run = Caller {
        run: Some(mosaikit_kernel::RunCall {
            ticket: m.id,
            run_ref: "r".into(),
            resources: None,
            scheduled_by: None,
            schedule_name: None,
        }),
        ..w.anna.clone()
    };
    let e = dir::search(&w.t, &run, DIR, &q("user", "bob")).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::Forbidden, "permission_denied"));
}

#[tokio::test]
async fn searches_are_rate_limited() {
    let w = world().await;
    for _ in 0..dir::PER_USER {
        dir::search(&w.t, &w.anna, DIR, &q("user", "bob")).await.unwrap();
    }
    let e = dir::search(&w.t, &w.anna, DIR, &q("user", "bob")).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::TooMany, "directory_rate_limited"));
    // another person is not held back by anna's searches
    dir::search(&w.t, &w.mgr, DIR, &q("user", "bob")).await.unwrap();
}

#[tokio::test]
async fn the_audit_log_has_one_event_a_minute_and_no_query() {
    let w = world().await;
    for text in ["bob", "SECRET-NAME", "ana"] {
        let _ = dir::search(&w.t, &w.anna, DIR, &q("user", text)).await;
    }
    let rows: Vec<Value> =
        mosaikit_db::query_scalar("select detail from core.events where action = 'directory.search'")
            .fetch_all(&w.t.db)
            .await
            .unwrap();
    assert_eq!(rows.len(), 1, "{rows:?}");
    let text = rows[0].to_string();
    for leak in ["bob", "SECRET", "ana", "username"] {
        assert!(!text.contains(leak), "{text}");
    }
}

#[tokio::test]
async fn the_people_who_hold_a_permission_of_the_plugin_can_be_listed() {
    let w = world().await;
    let req = json!({ "kind": "user", "permission": "review" });
    let list = |out: Value| {
        out.as_array()
            .unwrap()
            .iter()
            .map(|r| r["username"].as_str().unwrap().to_string())
            .collect::<Vec<_>>()
    };
    // nobody holds it by default except the Tenant Manager (who holds every permission)
    assert_eq!(list(dir::search(&w.t, &w.anna, DIR, &req).await.unwrap()), ["alfa-manager"]);
    // a person who has it through a grant
    let ana: uuid::Uuid = mosaikit_db::query_scalar("select id from core.users where username = 'ana'")
        .fetch_one(&w.t.db)
        .await
        .unwrap();
    access::set_plugin_grant(&w.t, &w.mgr, DIR, "user", ana, &["review".to_string()]).await.unwrap();
    assert_eq!(list(dir::search(&w.t, &w.anna, DIR, &req).await.unwrap()), ["ana", "alfa-manager"]);
    // a profile that lists the key gives it to its members
    let rev = access::create_profile(&w.t, &w.mgr, "Reviewers", "", None).await.unwrap();
    let ch = ProfileChange {
        plugins: [(DIR.to_string(), vec!["use".to_string(), "review".to_string()])].into(),
        ..Default::default()
    };
    access::update_profile(&w.t, &w.mgr, rev.id, &ch).await.unwrap();
    access::set_member_profile(&w.t, &w.mgr, w.bob.user.user_id, Some(rev.id)).await.unwrap();
    assert_eq!(list(dir::search(&w.t, &w.anna, DIR, &req).await.unwrap()), ["ana", "bob", "alfa-manager"]);
    // `q` narrows it
    let narrow = json!({ "kind": "user", "permission": "review", "q": "BO" });
    assert_eq!(list(dir::search(&w.t, &w.anna, DIR, &narrow).await.unwrap()), ["bob"]);
    // a key the plugin does not declare, a group search with a permission, and a plugin without the directory
    for bad in [
        json!({ "kind": "user", "permission": "nope" }),
        json!({ "kind": "group", "permission": "review", "q": "a" }),
    ] {
        assert!(dir::search(&w.t, &w.anna, DIR, &bad).await.is_err(), "{bad}");
    }
    assert!(dir::search(&w.t, &w.anna, NODIR, &req).await.is_err());
}
