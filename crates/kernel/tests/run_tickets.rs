//! Run tickets: a plugin called on behalf of a process that outlives the session that started it.
//!
//! The logic is hand-written WAT: `proxy` forwards its `args` to the host as a request and returns the
//! answer (so a test can ask for any host operation as the person of the ticket); `echo` returns the
//! message it received (so a test can see everything the logic is given). Run with
//! `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use std::collections::BTreeMap;

use mosaikit_kernel::acl::Level;
use mosaikit_kernel::plugins::tenants;
use mosaikit_kernel::run_tickets::{self as rt, MintRequest, Minted};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{acl, crud, Caller, Kind};
use serde_json::{json, Value};
use uuid::Uuid;

const PROXY: &str = "com.test.runproxy";
const ECHO: &str = "com.test.runecho";
/// a second target, with the logic of the proxy so a test can query it; both are in `run_targets` of PROXY
const TARGET: &str = "com.test.runtarget";
/// installed and with run commands, but not in `run_targets` of PROXY
const OTHER: &str = "com.test.runother";

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

fn echo_wasm() -> Vec<u8> {
    wat::parse_str(
        r#"(module
  (memory (export "memory") 2)
  (data (i32.const 32768) "{\"ok\":")
  (global $bump (mut i32) (i32.const 65536))
  (func (export "msk_alloc") (param $len i32) (result i32)
    (local $p i32) (local.set $p (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $len))) (local.get $p))
  (func (export "msk_call") (param $ptr i32) (param $len i32) (result i64)
    (memory.copy (i32.const 32774) (local.get $ptr) (local.get $len))
    (i32.store8 (i32.add (i32.const 32774) (local.get $len)) (i32.const 125))
    (i64.or (i64.shl (i64.const 32768) (i64.const 32))
            (i64.extend_i32_u (i32.add (local.get $len) (i32.const 7)))))
)"#,
    )
    .unwrap()
}

fn toml(id: &str, version: &str, run_commands: &str, run_targets: &str) -> String {
    format!(
        "id = \"{id}\"\nname = \"Run\"\nversion = \"{version}\"\n[contribution]\nicon = \"x\"\nlabel = \"Run\"\n\
         [requires]\nmosaikit = \">=1.0\"\n\
         [[resources]]\nname = \"items\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n\
         [permissions]\nrun_commands = {run_commands}\nrun_targets = {run_targets}\n"
    )
}

async fn install(t: &TestKernel, id: &str, version: &str, run_commands: &str) {
    let targets = if id == PROXY { r#"["com.test.runecho", "com.test.runtarget"]"# } else { "[]" };
    install_with(t, id, version, run_commands, targets).await;
}

async fn install_with(t: &TestKernel, id: &str, version: &str, run_commands: &str, run_targets: &str) {
    let wasm = if id == PROXY || id == TARGET { proxy_wasm() } else { echo_wasm() };
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml(id, version, run_commands, run_targets).into_bytes());
    files.insert("logic.wasm".to_string(), wasm);
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

/// Two tenants. In `alfa`: anna (two items, `a` and `b`), bob (one item, `c`), the manager.
/// In `beta`: carl, with one item (`d`) of the same plugin.
struct World {
    t: TestKernel,
    anna: Caller,
    bob: Caller,
    mgr: Caller,
    carl: Caller,
    a: Uuid,
    b: Uuid,
    c: Uuid,
    d: Uuid,
}

async fn item(t: &TestKernel, who: &Caller, title: &str) -> Uuid {
    let row = crud::create(t, who, PROXY, "items", json!({ "title": title }).as_object().unwrap(), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn world() -> World {
    let t = start().await;
    install(&t, PROXY, "1.0.0", r#"["x", "z"]"#).await;
    install(&t, ECHO, "1.0.0", r#"["x"]"#).await;
    install(&t, TARGET, "1.0.0", r#"["x"]"#).await;
    install(&t, OTHER, "1.0.0", r#"["x"]"#).await;
    let alfa = t.tenant("alfa").await;
    let anna = t.member(&alfa, "anna").await;
    let bob = t.member(&alfa, "bob").await;
    let mgr = t.home(&alfa).await;
    let (anna, bob) = (t.home(&anna).await, t.home(&bob).await);
    let beta = t.tenant("beta").await;
    let carl = t.member(&beta, "carl").await;
    let carl = t.home(&carl).await;
    let (a, b, c, d) = (
        item(&t, &anna, "item a").await,
        item(&t, &anna, "item b").await,
        item(&t, &bob, "item c").await,
        item(&t, &carl, "item d").await,
    );
    World { t, anna, bob, mgr, carl, a, b, c, d }
}

fn req(plugin: &str, commands: &[&str], resources: Option<Vec<Uuid>>) -> MintRequest {
    MintRequest {
        plugin: plugin.into(),
        commands: commands.iter().map(|c| c.to_string()).collect(),
        run_ref: "run-1".into(),
        ttl_minutes: None,
        uses: None,
        resources,
        targets: vec![],
        schedule: None,
    }
}

async fn mint(w: &World, plugin: &str, commands: &[&str], resources: Option<Vec<Uuid>>) -> Minted {
    rt::mint(&w.t, &w.anna, &req(plugin, commands, resources)).await.unwrap()
}

fn host(op: &str, req: Value) -> Value {
    json!({ "op": op, "req": req })
}

fn query(sql: &str) -> Value {
    host("db.query", json!({ "sql": sql, "params": [] }))
}

async fn titles(w: &World, token: &str) -> Vec<String> {
    let out =
        rt::call(&w.t, token, PROXY, "x", query("select title from items order by title")).await.unwrap();
    out.as_array().unwrap().iter().map(|r| r["title"].as_str().unwrap().to_string()).collect()
}

async fn uses_left(w: &World, id: Uuid) -> i32 {
    mosaikit_db::query_scalar("select uses_left from core.run_tickets where id = $1")
        .bind(id)
        .fetch_one(&w.t.db)
        .await
        .unwrap()
}

async fn events(w: &World, action: &str) -> Vec<Value> {
    mosaikit_db::query_scalar("select detail from core.events where action = $1 order by id")
        .bind(action)
        .fetch_all(&w.t.db)
        .await
        .unwrap()
}

fn code(e: &mosaikit_kernel::Error) -> String {
    e.code().to_string()
}

#[tokio::test]
async fn a_call_runs_as_the_starter_and_knows_the_run() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    // the rights of anna, nothing of bob's or of the other tenant
    assert_eq!(titles(&w, &m.token).await, ["item a", "item b"]);
    // the command is told which run it serves (and the arguments cannot say otherwise)
    let e = mint(&w, ECHO, &["x"], None).await;
    let out =
        rt::call(&w.t, &e.token, ECHO, "x", json!({ "on_behalf": { "run_ref": "forged" } })).await.unwrap();
    assert_eq!(out["ctx"]["on_behalf"]["run_ref"], "run-1");
    assert_eq!(out["ctx"]["user"], w.anna.user.user_id.to_string());
    // an ordinary call has no on_behalf
    let plain = crud::call(&w.t, &w.anna, ECHO, "x", Value::Null).await.unwrap();
    assert!(plain["ctx"].get("on_behalf").is_none());
}

#[tokio::test]
async fn the_resource_scope_is_enforced_by_the_database() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], Some(vec![w.a])).await;
    assert_eq!(titles(&w, &m.token).await, ["item a"], "the sibling of the scope is invisible");
    // asking for it by name or id gets nothing
    let by_name =
        host("db.query", json!({ "sql": "select title from items where title = $1", "params": ["item b"] }));
    assert!(rt::call(&w.t, &m.token, PROXY, "x", by_name).await.unwrap().as_array().unwrap().is_empty());
    // a write on a resource outside the scope touches nothing, and a root item cannot be created
    let write = host("db.exec", json!({ "sql": "update items set title = 'hijacked'", "params": [] }));
    let _ = rt::call(&w.t, &m.token, PROXY, "x", write).await;
    let row = crud::get(&w.t, &w.anna, PROXY, "items", w.b).await.unwrap();
    assert_eq!(row["values"]["title"], "item b");
    let create = host("resource.create", json!({ "kind": "items", "title": "new root" }));
    assert!(rt::call(&w.t, &m.token, PROXY, "x", create).await.is_err());
    let all = crud::list(&w.t, &w.anna, PROXY, "items", None, None).await.unwrap();
    assert_eq!(all.rows.len(), 2, "nothing was created");
    // the same ticket without the scope would see both: the cap is the scope's doing
    let free = mint(&w, PROXY, &["x"], None).await;
    assert_eq!(titles(&w, &free.token).await.len(), 2);
    // a scope on a resource anna cannot see, or of another tenant, cannot be minted
    for id in [w.c, w.d] {
        let e = rt::mint(&w.t, &w.anna, &req(PROXY, &["x"], Some(vec![id]))).await.unwrap_err();
        assert_eq!(e.kind, Kind::NotFound, "{id}");
    }
}

#[tokio::test]
async fn a_scope_that_is_a_folder_reaches_its_descendants_only() {
    let w = world().await;
    let folder = item(&w.t, &w.anna, "folder").await;
    {
        let row = crud::create(
            &w.t,
            &w.anna,
            PROXY,
            "items",
            json!({ "title": "child" }).as_object().unwrap(),
            Some(folder),
        )
        .await
        .unwrap();
        let _ = row;
    }
    let m = mint(&w, PROXY, &["x"], Some(vec![folder])).await;
    assert_eq!(titles(&w, &m.token).await, ["child", "folder"]);
}

#[tokio::test]
async fn an_expired_ticket_does_nothing() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    assert_eq!(titles(&w, &m.token).await.len(), 2);
    mosaikit_db::query("update core.run_tickets set expires_at = now() - make_interval(mins => 1)")
        .execute(&w.t.db)
        .await
        .unwrap();
    let e = rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Unauthorized, "run_ticket_invalid"));
}

#[tokio::test]
async fn a_ticket_cannot_be_used_beyond_its_uses() {
    let w = world().await;
    let mut r = req(PROXY, &["x"], None);
    r.uses = Some(2);
    let m = rt::mint(&w.t, &w.anna, &r).await.unwrap();
    for _ in 0..2 {
        rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap();
    }
    assert_eq!(uses_left(&w, m.id).await, 0);
    let e = rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap_err();
    assert_eq!(e.kind, Kind::Unauthorized);
}

#[tokio::test]
async fn a_revoked_ticket_does_nothing() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    // someone else of the tenant cannot even see it
    let e = rt::revoke(&w.t, &w.bob, m.id).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);
    rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap();
    rt::revoke(&w.t, &w.anna, m.id).await.unwrap();
    let e = rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap_err();
    assert_eq!(e.kind, Kind::Unauthorized);
    // the Tenant Manager may revoke the tickets of the tenant; the service may end its own run
    let m2 = mint(&w, PROXY, &["x"], None).await;
    rt::revoke(&w.t, &w.mgr, m2.id).await.unwrap();
    assert!(rt::call(&w.t, &m2.token, PROXY, "x", query("select 1")).await.is_err());
    let m3 = mint(&w, PROXY, &["x"], None).await;
    rt::finish(&w.t, &m3.token).await.unwrap();
    assert!(rt::call(&w.t, &m3.token, PROXY, "x", query("select 1")).await.is_err());
    assert!(rt::finish(&w.t, &m3.token).await.is_err(), "finished twice");
}

#[tokio::test]
async fn a_ticket_is_for_its_plugin_and_its_commands() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    // another plugin, with the same command name
    let e = rt::call(&w.t, &m.token, ECHO, "x", Value::Null).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "run_wrong_plugin"));
    // a command the plugin declares but the ticket was not minted for
    let e = rt::call(&w.t, &m.token, PROXY, "z", query("select 1")).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "run_wrong_command"));
    // a command nobody declared
    let e = rt::call(&w.t, &m.token, PROXY, "y", query("select 1")).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    // refused calls did not spend the ticket
    assert_eq!(uses_left(&w, m.id).await, rt::DEFAULT_USES as i32);
    // at mint: a command the manifest does not declare, a plugin that declares none, a plugin that is not there
    let e = rt::mint(&w.t, &w.anna, &req(PROXY, &["x", "y"], None)).await.unwrap_err();
    assert_eq!(code(&e), "command_not_declared");
    let e = rt::mint(&w.t, &w.anna, &req("com.mosaikit.notes", &["x"], None)).await.unwrap_err();
    assert!(matches!(e.kind, Kind::NotFound | Kind::Forbidden | Kind::BadRequest), "{e:?}");
}

#[tokio::test]
async fn an_update_that_drops_the_declaration_stops_the_tickets() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x", "z"], None).await;
    titles(&w, &m.token).await;
    // the new version declares only `z`: the manifest is read again on every call
    install(&w.t, PROXY, "1.1.0", r#"["z"]"#).await;
    let e = rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap_err();
    assert_eq!(code(&e), "command_not_declared");
    rt::call(&w.t, &m.token, PROXY, "z", query("select 1")).await.unwrap();
}

#[tokio::test]
async fn the_ticket_of_one_tenant_never_reaches_another() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    // the item of the other tenant is not in the list, by name or by id
    let by_name =
        host("db.query", json!({ "sql": "select title from items where title = $1", "params": ["item d"] }));
    assert!(rt::call(&w.t, &m.token, PROXY, "x", by_name).await.unwrap().as_array().unwrap().is_empty());
    let write = host("db.exec", json!({ "sql": "update items set title = 'x'", "params": [] }));
    let _ = rt::call(&w.t, &m.token, PROXY, "x", write).await;
    let theirs: String = mosaikit_db::query_scalar("select title from core.resources where id = $1")
        .bind(w.d)
        .fetch_one(&w.t.db)
        .await
        .unwrap();
    assert_eq!(theirs, "item d");
}

#[tokio::test]
async fn the_rights_of_the_person_are_the_ones_of_the_call() {
    let w = world().await;
    // bob shares his item with anna (read): a ticket of anna sees it...
    acl::set_grant(&w.t, &w.bob, w.c, "user", w.anna.user.user_id, Some(Level::Read)).await.unwrap();
    let m = mint(&w, PROXY, &["x"], None).await;
    assert_eq!(titles(&w, &m.token).await, ["item a", "item b", "item c"]);
    // ... and no longer once the share is gone, with the same ticket
    acl::set_grant(&w.t, &w.bob, w.c, "user", w.anna.user.user_id, None).await.unwrap();
    assert_eq!(titles(&w, &m.token).await, ["item a", "item b"]);
}

#[tokio::test]
async fn a_suspended_removed_or_turned_off_person_gets_no_call() {
    // membership suspended
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    mosaikit_kernel::tenancy::set_member_suspended(&w.t, &w.mgr, w.anna.user.user_id, true).await.unwrap();
    assert!(rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.is_err());
    mosaikit_kernel::tenancy::set_member_suspended(&w.t, &w.mgr, w.anna.user.user_id, false).await.unwrap();
    rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap();
    // account disabled
    mosaikit_db::query("update core.users set status = 'disabled' where id = $1")
        .bind(w.anna.user.user_id)
        .execute(&w.t.db)
        .await
        .unwrap();
    assert!(rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.is_err());
    mosaikit_db::query("update core.users set status = 'active' where id = $1")
        .bind(w.anna.user.user_id)
        .execute(&w.t.db)
        .await
        .unwrap();
    rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap();
    // membership removed
    mosaikit_db::query("delete from core.memberships where user_id = $1 and tenant_id = $2")
        .bind(w.anna.user.user_id)
        .bind(w.anna.tenant.tenant_id)
        .execute(&w.t.db)
        .await
        .unwrap();
    assert!(rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.is_err());
    // the plugin turned off in the tenant
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    mosaikit_kernel::plugins::tenants::set_enabled(&w.t, &w.mgr, PROXY, false).await.unwrap();
    assert!(rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.is_err());
}

#[tokio::test]
async fn a_forged_or_tampered_token_is_refused() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    let mut flipped = m.token.clone();
    let last = flipped.pop().unwrap();
    flipped.push(if last == '0' { '1' } else { '0' });
    let forged: [String; 7] = [
        flipped,
        m.token[..47].to_string(),
        format!("{}0", m.token),
        "0".repeat(48),
        "z".repeat(48),
        String::new(),
        // the id of the ticket is not the secret
        m.id.to_string(),
    ];
    for t in forged {
        let e = rt::call(&w.t, &t, PROXY, "x", query("select 1")).await.unwrap_err();
        assert_eq!((e.kind, code(&e).as_str()), (Kind::Unauthorized, "run_ticket_invalid"), "{t}");
        assert!(rt::finish(&w.t, &t).await.is_err());
    }
    // a link token or a session token is not a ticket either
    assert!(rt::call(&w.t, &"a".repeat(64), PROXY, "x", Value::Null).await.is_err());
    assert_eq!(uses_left(&w, m.id).await, rt::DEFAULT_USES as i32);
}

#[tokio::test]
async fn the_raw_token_is_not_kept_anywhere() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap();
    let hash: Vec<u8> = mosaikit_db::query_scalar("select token_hash from core.run_tickets where id = $1")
        .bind(m.id)
        .fetch_one(&w.t.db)
        .await
        .unwrap();
    assert_eq!(hash.len(), 32, "a SHA-256 hash");
    assert_ne!(hash, m.token.as_bytes());
    let by_raw: i64 =
        mosaikit_db::query_scalar("select count(*) from core.run_tickets where token_hash = $1")
            .bind(m.token.as_bytes().to_vec())
            .fetch_one(&w.t.db)
            .await
            .unwrap();
    assert_eq!(by_raw, 0);
    // not in the other columns, not in the Log
    let run_ref: String = mosaikit_db::query_scalar("select run_ref from core.run_tickets where id = $1")
        .bind(m.id)
        .fetch_one(&w.t.db)
        .await
        .unwrap();
    assert!(!run_ref.contains(&m.token));
    for action in ["run_ticket.mint", "run_ticket.call"] {
        for e in events(&w, action).await {
            assert!(!e.to_string().contains(&m.token), "{action}");
        }
    }
}

#[tokio::test]
async fn a_call_on_behalf_cannot_call_other_plugins_or_mint() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], None).await;
    let nested = host("plugin.call", json!({ "plugin": ECHO, "name": "x", "args": null }));
    let e = rt::call(&w.t, &m.token, PROXY, "x", nested).await.unwrap_err();
    assert!(e.message.contains("on behalf"), "{}", e.message);
    // a caller that is itself a run cannot mint (the server only offers mint behind a session)
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
    let e = rt::mint(&w.t, &run, &req(PROXY, &["x"], None)).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
}

#[tokio::test]
async fn limits_on_size_lifetime_and_number() {
    let w = world().await;
    let bad = |f: &dyn Fn(&mut MintRequest)| {
        let mut r = req(PROXY, &["x"], None);
        f(&mut r);
        r
    };
    let cases = [
        bad(&|r| r.ttl_minutes = Some(rt::MAX_TTL_MINUTES + 1)),
        bad(&|r| r.ttl_minutes = Some(0)),
        bad(&|r| r.uses = Some(rt::MAX_USES + 1)),
        bad(&|r| r.uses = Some(0)),
        bad(&|r| r.run_ref = "x".repeat(rt::MAX_RUN_REF + 1)),
        bad(&|r| r.run_ref = "  ".into()),
        bad(&|r| r.run_ref = "a\nb".into()),
        bad(&|r| r.commands = vec![]),
        bad(&|r| r.resources = Some(vec![])),
        bad(&|r| r.resources = Some(vec![w.a; rt::MAX_RESOURCES + 1])),
    ];
    for (i, r) in cases.iter().enumerate() {
        let e = rt::mint(&w.t, &w.anna, r).await.unwrap_err();
        assert_eq!(e.kind, Kind::BadRequest, "case {i}: {e:?}");
    }
    // arguments over the limit are refused before anything runs, and spend nothing
    let m = mint(&w, PROXY, &["x"], None).await;
    let big =
        json!({ "op": "db.query", "req": { "sql": "select 1", "params": ["x".repeat(rt::MAX_ARG_BYTES)] } });
    let e = rt::call(&w.t, &m.token, PROXY, "x", big).await.unwrap_err();
    assert_eq!(code(&e), "args_too_large");
    assert_eq!(uses_left(&w, m.id).await, rt::DEFAULT_USES as i32);
}

#[tokio::test]
async fn minting_and_calling_are_rate_limited() {
    let w = world().await;
    let mut last = None;
    for _ in 0..40 {
        match rt::mint(&w.t, &w.anna, &req(PROXY, &["x"], None)).await {
            Ok(_) => {}
            Err(e) => {
                last = Some(e);
                break;
            }
        }
    }
    let e = last.expect("the 31st mint of the minute is refused");
    assert_eq!((e.kind, code(&e).as_str()), (Kind::TooMany, "run_rate_limited"));
    // calls: per ticket, with a plugin that costs nothing
    let w = world().await;
    let mut r = req(ECHO, &["x"], None);
    r.uses = Some(500);
    let m = rt::mint(&w.t, &w.anna, &r).await.unwrap();
    let mut refused = None;
    for i in 0..200 {
        if let Err(e) = rt::call(&w.t, &m.token, ECHO, "x", Value::Null).await {
            refused = Some((i, e));
            break;
        }
    }
    let (i, e) = refused.expect("the ticket is limited per minute");
    assert_eq!((i, e.kind), (120, Kind::TooMany));
    // a refused call (rate limit) did not spend a use
    assert_eq!(uses_left(&w, m.id).await, 500 - 120);
}

#[tokio::test]
async fn mint_call_and_revoke_leave_audit_rows_with_the_run() {
    let w = world().await;
    let m = mint(&w, PROXY, &["x"], Some(vec![w.a])).await;
    rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap();
    rt::call(&w.t, &m.token, PROXY, "x", host("db.exec", json!({ "sql": "nonsense", "params": [] })))
        .await
        .unwrap_err();
    rt::revoke(&w.t, &w.anna, m.id).await.unwrap();
    let minted = events(&w, "run_ticket.mint").await;
    assert_eq!(minted.len(), 1);
    assert_eq!(minted[0]["run_ref"], "run-1");
    assert_eq!(minted[0]["commands"], json!(["x"]));
    assert_eq!(minted[0]["resources"], 1);
    let calls = events(&w, "run_ticket.call").await;
    assert_eq!(calls.len(), 2);
    assert_eq!((calls[0]["ok"].as_bool(), calls[1]["ok"].as_bool()), (Some(true), Some(false)));
    assert!(calls.iter().all(|c| c["run_ref"] == "run-1" && c["command"] == "x"));
    assert_eq!(events(&w, "run_ticket.revoke").await.len(), 1);
    // who: the starter, in the tenant
    let who: Vec<(Uuid, Uuid)> =
        mosaikit_db::query("select user_id, tenant_id from core.events where action = 'run_ticket.call'")
            .fetch_all(&w.t.db)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.get(0), r.get(1)))
            .collect();
    assert!(who.iter().all(|x| *x == (w.anna.user.user_id, w.anna.tenant.tenant_id)));
}

// ------------------------------------------------------------------ targets: a run that reaches other plugins

use mosaikit_kernel::access::{create_profile, set_member_profile, update_profile, ProfileChange};
use mosaikit_kernel::run_tickets::Target;

fn target(plugin: &str, commands: &[&str], resources: Option<Vec<Uuid>>) -> Target {
    Target { plugin: plugin.into(), commands: commands.iter().map(|c| c.to_string()).collect(), resources }
}

fn req_t(targets: Vec<Target>) -> MintRequest {
    MintRequest { targets, ..req(PROXY, &["x"], None) }
}

async fn titem(w: &World, who: &Caller, title: &str) -> Uuid {
    let row = crud::create(&w.t, who, TARGET, "items", json!({ "title": title }).as_object().unwrap(), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn target_titles(w: &World, token: &str) -> Vec<String> {
    let out =
        rt::call(&w.t, token, TARGET, "x", query("select title from items order by title")).await.unwrap();
    out.as_array().unwrap().iter().map(|r| r["title"].as_str().unwrap().to_string()).collect()
}

async fn tickets_written(w: &World) -> i64 {
    mosaikit_db::query_scalar("select count(*) from core.run_tickets").fetch_one(&w.t.db).await.unwrap()
}

/// A profile where the person uses PROXY and nothing else: the target is closed to them.
async fn only_proxy(w: &World) {
    let p = create_profile(&w.t, &w.mgr, "Only proxy", "", None).await.unwrap();
    let ch = ProfileChange {
        plugins: [
            (PROXY.to_string(), vec!["use".to_string()]),
            (TARGET.to_string(), vec![]),
            (ECHO.to_string(), vec![]),
        ]
        .into(),
        ..Default::default()
    };
    update_profile(&w.t, &w.mgr, p.id, &ch).await.unwrap();
    set_member_profile(&w.t, &w.mgr, w.anna.user.user_id, Some(p.id)).await.unwrap();
}

#[tokio::test]
async fn a_mint_names_only_declared_targets_with_declared_commands() {
    let w = world().await;
    let before = tickets_written(&w).await;
    // a plugin that is installed but not in `run_targets`
    let e = rt::mint(&w.t, &w.anna, &req_t(vec![target(OTHER, &["x"], None)])).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "target_not_declared"));
    // a command the target does not declare in `run_commands`
    let e = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["z"], None)])).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "command_not_declared"));
    // the commands of the first plugin do not count for the target (PROXY declares `z`, TARGET does not)
    let e = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x", "z"], None)])).await.unwrap_err();
    assert_eq!(code(&e), "command_not_declared");
    // no command, the plugin itself, a repeat, too many
    for bad in [
        vec![target(ECHO, &[], None)],
        vec![target(PROXY, &["x"], None)],
        vec![target(ECHO, &["x"], None), target(ECHO, &["x"], None)],
        (0..9).map(|_| target(ECHO, &["x"], None)).collect(),
    ] {
        let e = rt::mint(&w.t, &w.anna, &req_t(bad)).await.unwrap_err();
        assert_eq!(e.kind, Kind::BadRequest, "{e}");
    }
    // a resource of the target must belong to the target and be visible to the person
    let (ta, tb) = (titem(&w, &w.anna, "ta").await, titem(&w, &w.bob, "tb").await);
    let e = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], Some(vec![w.a]))])).await.unwrap_err();
    assert_eq!(e.kind, Kind::BadRequest, "an item of the first plugin in the entry of the target: {e}");
    let e = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], Some(vec![tb]))])).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound, "an item the person does not see: {e}");
    let e = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], Some(vec![]))])).await.unwrap_err();
    assert_eq!(e.kind, Kind::BadRequest);
    // none of the refused mints left a ticket behind
    assert_eq!(tickets_written(&w).await, before);
    // and the same request, right, is accepted
    rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], Some(vec![ta]))])).await.unwrap();
}

#[tokio::test]
async fn a_mint_refuses_a_target_that_is_off_missing_or_not_used_by_the_person() {
    let w = world().await;
    // off in the tenant
    tenants::set_enabled(&w.t, &w.mgr, TARGET, false).await.unwrap();
    let e = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], None)])).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "target_not_available"));
    tenants::set_enabled(&w.t, &w.mgr, TARGET, true).await.unwrap();
    // declared but not installed at all
    install_with(&w.t, PROXY, "1.2.0", r#"["x"]"#, r#"["com.test.runghost"]"#).await;
    let e =
        rt::mint(&w.t, &w.anna, &req_t(vec![target("com.test.runghost", &["x"], None)])).await.unwrap_err();
    assert_eq!(code(&e), "target_not_available");
    install_with(&w.t, PROXY, "1.3.0", r#"["x", "z"]"#, r#"["com.test.runecho", "com.test.runtarget"]"#)
        .await;
    // the person has no `use` of the target
    only_proxy(&w).await;
    let e = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], None)])).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "missing_permission"));
    // and a target is never reached through the rights of someone else: bob mints for himself
    rt::mint(&w.t, &w.bob, &req_t(vec![target(TARGET, &["x"], None)])).await.unwrap();
}

#[tokio::test]
async fn a_ticket_cannot_mint_another_with_targets_either() {
    let w = world().await;
    let m = rt::mint(&w.t, &w.anna, &req_t(vec![target(ECHO, &["x"], None)])).await.unwrap();
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
    let e = rt::mint(&w.t, &run, &req_t(vec![target(ECHO, &["x"], None)])).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    // nor from the logic of a call on behalf of the run
    let mint = host("runs.mint", json!({ "commands": ["x"], "run_ref": "again" }));
    let e = rt::call(&w.t, &m.token, ECHO, "x", Value::Null).await;
    assert!(e.is_ok());
    let t = rt::mint(&w.t, &w.anna, &req_t(vec![])).await.unwrap();
    let e = rt::call(&w.t, &t.token, PROXY, "x", mint).await.unwrap_err();
    assert!(e.message.contains("on behalf of a run"), "{}", e.message);
}

#[tokio::test]
async fn one_ticket_calls_its_plugin_and_its_targets_as_the_person() {
    let w = world().await;
    let (ta, _tb) = (titem(&w, &w.anna, "ta").await, titem(&w, &w.bob, "tb").await);
    let m = rt::mint(&w.t, &w.anna, &req_t(vec![target(ECHO, &["x"], None), target(TARGET, &["x"], None)]))
        .await
        .unwrap();
    // the first plugin and each target, with the same token, as anna and knowing the run
    assert_eq!(titles(&w, &m.token).await, ["item a", "item b"]);
    assert_eq!(target_titles(&w, &m.token).await, ["ta"]);
    let out = rt::call(&w.t, &m.token, ECHO, "x", json!({ "on_behalf": "forged" })).await.unwrap();
    assert_eq!(out["ctx"]["user"], w.anna.user.user_id.to_string());
    assert_eq!(out["ctx"]["on_behalf"]["run_ref"], "run-1");
    // one budget for all of them
    assert_eq!(uses_left(&w, m.id).await, rt::DEFAULT_USES as i32 - 3);
    // the audit log names the target that was called, and the targets that were minted
    let calls = events(&w, "run_ticket.call").await;
    assert_eq!(calls.iter().filter(|e| e["target"] == PROXY).count(), 2, "{calls:?}");
    assert_eq!(calls.iter().filter(|e| e["target"].is_null()).count(), 1);
    let mints = events(&w, "run_ticket.mint").await;
    assert_eq!(mints[0]["targets"].as_array().unwrap().len(), 2);
    let _ = ta;
}

#[tokio::test]
async fn a_ticket_reaches_no_plugin_or_command_it_does_not_name() {
    let w = world().await;
    let m = rt::mint(&w.t, &w.anna, &req_t(vec![target(ECHO, &["x"], None)])).await.unwrap();
    // a plugin that is not an entry of the ticket (declared by the manifest, not named at mint), or not declared at all
    for plugin in [TARGET, OTHER] {
        let e = rt::call(&w.t, &m.token, plugin, "x", query("select 1")).await.unwrap_err();
        assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "run_wrong_plugin"), "{plugin}");
    }
    // a command of the target that the ticket did not name
    let e = rt::call(&w.t, &m.token, ECHO, "y", Value::Null).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "run_wrong_command"));
    // the commands of the first plugin do not open the target's: PROXY has `z`, ECHO has not
    let e = rt::call(&w.t, &m.token, ECHO, "z", Value::Null).await.unwrap_err();
    assert_eq!(code(&e), "run_wrong_command");
    // the entry of a target says nothing about the first plugin's commands
    let e = rt::call(&w.t, &m.token, PROXY, "z", query("select 1")).await.unwrap_err();
    assert_eq!(code(&e), "run_wrong_command");
    // refused calls spent nothing
    assert_eq!(uses_left(&w, m.id).await, rt::DEFAULT_USES as i32);
}

#[tokio::test]
async fn the_manifests_are_read_again_for_a_target_on_every_call() {
    let w = world().await;
    let mk = || async {
        rt::mint(&w.t, &w.anna, &req_t(vec![target(ECHO, &["x"], None), target(TARGET, &["x"], None)]))
            .await
            .unwrap()
    };
    // the first plugin no longer declares the target: that target stops at once, the rest goes on
    let m = mk().await;
    rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.unwrap();
    install_with(&w.t, PROXY, "1.1.0", r#"["x", "z"]"#, r#"["com.test.runecho"]"#).await;
    let e = rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Forbidden, "target_not_declared"));
    rt::call(&w.t, &m.token, ECHO, "x", Value::Null).await.unwrap();
    rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap();
    install_with(&w.t, PROXY, "1.2.0", r#"["x", "z"]"#, r#"["com.test.runecho", "com.test.runtarget"]"#)
        .await;
    // the target no longer declares the command
    install_with(&w.t, TARGET, "1.1.0", r#"["z"]"#, "[]").await;
    let e = rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.unwrap_err();
    assert_eq!(code(&e), "command_not_declared");
}

#[tokio::test]
async fn the_rights_for_a_target_are_the_ones_of_the_person_at_the_call() {
    let w = world().await;
    let (_ta, _tb) = (titem(&w, &w.anna, "ta").await, titem(&w, &w.bob, "tb").await);
    let m = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], None)])).await.unwrap();
    // a share taken or given is seen at once, in the target too
    assert_eq!(target_titles(&w, &m.token).await, ["ta"]);
    // the target turned off in the tenant
    tenants::set_enabled(&w.t, &w.mgr, TARGET, false).await.unwrap();
    assert!(rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.is_err());
    tenants::set_enabled(&w.t, &w.mgr, TARGET, true).await.unwrap();
    assert_eq!(target_titles(&w, &m.token).await, ["ta"]);
    // the person loses the use of the target after the mint
    only_proxy(&w).await;
    let e = rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    titles(&w, &m.token).await;
    // a suspended person gets nothing, in any of the plugins
    mosaikit_kernel::tenancy::set_member_suspended(&w.t, &w.mgr, w.anna.user.user_id, true).await.unwrap();
    assert!(titles_err(&w, &m.token).await);
}

async fn titles_err(w: &World, token: &str) -> bool {
    rt::call(&w.t, token, PROXY, "x", query("select 1")).await.is_err()
}

#[tokio::test]
async fn an_expired_revoked_or_finished_ticket_reaches_no_target() {
    let w = world().await;
    let mk = || async { rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], None)])).await.unwrap() };
    let (expired, revoked, finished) = (mk().await, mk().await, mk().await);
    mosaikit_db::query(
        "update core.run_tickets set expires_at = now() - make_interval(mins => 1) where id = $1",
    )
    .bind(expired.id)
    .execute(&w.t.db)
    .await
    .unwrap();
    rt::revoke(&w.t, &w.anna, revoked.id).await.unwrap();
    rt::finish(&w.t, &finished.token).await.unwrap();
    for t in [expired, revoked, finished] {
        let e = rt::call(&w.t, &t.token, TARGET, "x", query("select 1")).await.unwrap_err();
        assert_eq!((e.kind, code(&e).as_str()), (Kind::Unauthorized, "run_ticket_invalid"));
    }
    // a ticket ends for every plugin at once: one `finish`, one token
    let m = mk().await;
    rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.unwrap();
    rt::finish(&w.t, &m.token).await.unwrap();
    assert!(rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.is_err());
}

#[tokio::test]
async fn uses_size_and_rate_are_shared_by_the_plugins_of_a_ticket() {
    let w = world().await;
    let mut r = req_t(vec![target(TARGET, &["x"], None)]);
    r.uses = Some(2);
    let m = rt::mint(&w.t, &w.anna, &r).await.unwrap();
    rt::call(&w.t, &m.token, PROXY, "x", query("select 1")).await.unwrap();
    rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.unwrap();
    let e = rt::call(&w.t, &m.token, TARGET, "x", query("select 1")).await.unwrap_err();
    assert_eq!((e.kind, code(&e).as_str()), (Kind::Unauthorized, "run_ticket_invalid"));
    // size of the arguments, for a target as for the first plugin
    let m = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], None)])).await.unwrap();
    let big = json!({ "pad": "x".repeat(rt::MAX_ARG_BYTES) });
    let e = rt::call(&w.t, &m.token, TARGET, "x", big).await.unwrap_err();
    assert_eq!(code(&e), "args_too_large");
    // rate: 120 calls a minute per ticket, whatever the plugin
    let mut r = req_t(vec![target(TARGET, &["x"], None)]);
    r.uses = Some(rt::MAX_USES);
    let m = rt::mint(&w.t, &w.anna, &r).await.unwrap();
    let mut limited = false;
    for i in 0..130 {
        let plugin = if i % 2 == 0 { PROXY } else { TARGET };
        if let Err(e) = rt::call(&w.t, &m.token, plugin, "x", query("select 1")).await {
            assert_eq!(code(&e), "run_rate_limited");
            limited = true;
            break;
        }
    }
    assert!(limited, "the limit of the ticket applies to the calls of all its plugins");
}

#[tokio::test]
async fn each_entry_has_its_own_resource_scope() {
    let w = world().await;
    let (ta, ta2, _tb) =
        (titem(&w, &w.anna, "ta").await, titem(&w, &w.anna, "ta2").await, titem(&w, &w.bob, "tb").await);
    // the first plugin limited to `a`, the target limited to `ta`
    let mut r = req_t(vec![target(TARGET, &["x"], Some(vec![ta]))]);
    r.resources = Some(vec![w.a]);
    let m = rt::mint(&w.t, &w.anna, &r).await.unwrap();
    assert_eq!(titles(&w, &m.token).await, ["item a"]);
    assert_eq!(target_titles(&w, &m.token).await, ["ta"]);
    // the first plugin limited, the target not: the target has the person's reach (and no more)
    let mut r = req_t(vec![target(TARGET, &["x"], None)]);
    r.resources = Some(vec![w.a]);
    let m = rt::mint(&w.t, &w.anna, &r).await.unwrap();
    assert_eq!(titles(&w, &m.token).await, ["item a"]);
    assert_eq!(target_titles(&w, &m.token).await, ["ta", "ta2"]);
    // the first plugin not limited, the target limited
    let m = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], Some(vec![ta2]))])).await.unwrap();
    assert_eq!(titles(&w, &m.token).await, ["item a", "item b"]);
    assert_eq!(target_titles(&w, &m.token).await, ["ta2"]);
}

#[tokio::test]
async fn the_ticket_of_one_tenant_reaches_no_target_of_another() {
    let w = world().await;
    titem(&w, &w.anna, "ta").await;
    titem(&w, &w.carl, "of carl").await;
    let m = rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], None)])).await.unwrap();
    assert_eq!(target_titles(&w, &m.token).await, ["ta"]);
    // a resource of the other tenant cannot be put in the scope of an entry
    let theirs = titem(&w, &w.carl, "scoped").await;
    let e =
        rt::mint(&w.t, &w.anna, &req_t(vec![target(TARGET, &["x"], Some(vec![theirs]))])).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);
}

// ------------------------------------------------------------------ runs.mint, the host operation

fn mint_op(targets: Value) -> Value {
    host(
        "runs.mint",
        json!({ "commands": ["x"], "run_ref": "started-by-the-plugin", "ttl_minutes": 5, "uses": 10, "targets": targets }),
    )
}

#[tokio::test]
async fn the_logic_mints_for_its_own_plugin_and_the_person_who_called() {
    let w = world().await;
    let ta = titem(&w, &w.anna, "ta").await;
    let _ = titem(&w, &w.bob, "tb").await;
    let before = tickets_written(&w).await;
    let args = mint_op(
        json!([{ "plugin": TARGET, "commands": ["x"], "resources": [ta] }, { "plugin": ECHO, "commands": ["x"] }]),
    );
    let out = crud::call(&w.t, &w.anna, PROXY, "x", args).await.unwrap();
    // given to the logic at once, written when the command has committed
    let token = out["token"].as_str().unwrap();
    assert_eq!(token.len(), 48);
    assert_eq!(out["uses"], 10);
    assert_eq!(tickets_written(&w).await, before + 1);
    // it works for the plugin that minted it and for its targets, as anna, within the entry's scope
    assert_eq!(titles(&w, token).await, ["item a", "item b"]);
    assert_eq!(target_titles(&w, token).await, ["ta"]);
    rt::call(&w.t, token, ECHO, "x", Value::Null).await.unwrap();
    let mints = events(&w, "run_ticket.mint").await;
    assert_eq!(mints.last().unwrap()["by"], "plugin");
    assert_eq!(mints.last().unwrap()["run_ref"], "started-by-the-plugin");
    // the token is the only copy: the table keeps the hash
    let kept: i64 = mosaikit_db::query_scalar("select count(*) from core.run_tickets where id::text = $1")
        .bind(out["id"].as_str().unwrap())
        .fetch_one(&w.t.db)
        .await
        .unwrap();
    assert_eq!(kept, 1);
}

#[tokio::test]
async fn the_logic_cannot_mint_beyond_its_manifest_or_the_person() {
    let w = world().await;
    // the plugin is the one that runs: no field names another, and the targets are its own `run_targets`
    let e = cmd(
        &w,
        &w.anna,
        PROXY,
        host("runs.mint", json!({ "plugin": OTHER, "commands": ["x"], "run_ref": "r" })),
    )
    .await
    .unwrap_err();
    assert!(e.message.contains("runs.mint"), "{}", e.message);
    // TARGET declares no `run_targets`: whatever it asks, ECHO is not reachable from its tickets
    let e =
        cmd(&w, &w.anna, TARGET, mint_op(json!([{ "plugin": ECHO, "commands": ["x"] }]))).await.unwrap_err();
    assert!(e.message.contains("run_targets"), "{}", e.message);
    // not in `run_targets`, not a command of the target, the person lacks the target
    let e =
        cmd(&w, &w.anna, PROXY, mint_op(json!([{ "plugin": OTHER, "commands": ["x"] }]))).await.unwrap_err();
    assert!(e.message.contains("run_targets"), "{}", e.message);
    let e =
        cmd(&w, &w.anna, PROXY, mint_op(json!([{ "plugin": TARGET, "commands": ["z"] }]))).await.unwrap_err();
    assert!(e.message.contains("run command"), "{}", e.message);
    only_proxy(&w).await;
    let e =
        cmd(&w, &w.anna, PROXY, mint_op(json!([{ "plugin": TARGET, "commands": ["x"] }]))).await.unwrap_err();
    assert!(e.message.contains("permission"), "{}", e.message);
    // limits of the mint
    let e = cmd(
        &w,
        &w.anna,
        PROXY,
        host("runs.mint", json!({ "commands": ["x"], "run_ref": "r", "uses": 100000 })),
    )
    .await
    .unwrap_err();
    assert!(e.message.contains("uses"), "{}", e.message);
    // nothing was written by any of them
    assert_eq!(tickets_written(&w).await, 0);
}

async fn cmd(w: &World, who: &Caller, plugin: &str, args: Value) -> mosaikit_kernel::Result<Value> {
    crud::call(&w.t, who, plugin, "x", args).await
}
