//! Public links: the settings a public page may read and the commands it may call.
//!
//! The logic is hand-written WAT: `proxy` forwards its `args` to the host as a request and returns the
//! answer (so a test can ask for any host operation as the visitor); `echo` returns the message it
//! received (so a test can see everything the logic is given).

use std::collections::BTreeMap;

use mosaikit_kernel::plugins::config::{self as pconf, ConfigChange};
use mosaikit_kernel::tenancy::keys::{self, Level};
use mosaikit_kernel::tenancy::set_settings;
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{crud, links, Caller, Kind};
use serde_json::{json, Value};
use uuid::Uuid;

const PROXY: &str = "com.test.pubproxy";
const ECHO: &str = "com.test.pubecho";

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

fn toml(id: &str, extra: &str) -> String {
    format!(
        "id = \"{id}\"\nname = \"Public\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"Public\"\n\
         [[resources]]\nname = \"items\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n\
         [[config]]\nkey = \"endpoint\"\nlabel = \"Endpoint\"\nkind = \"text\"\ndefault = \"https://tiles.example\"\npublic = true\n\
         [[config]]\nkey = \"internal\"\nlabel = \"Internal\"\nkind = \"text\"\ndefault = \"not-for-visitors\"\n\
         [[config]]\nkey = \"token\"\nlabel = \"Token\"\nkind = \"secret\"\n\
         [[service_keys]]\nid = \"translate\"\nlabel = \"Translation service\"\n\
         [[public_commands]]\nname = \"x\"\ndescription = \"what a visitor may do\"\n\
         {extra}"
    )
}

/// As `install`, with migrations (`(file name, SQL)`).
async fn install_with(t: &TestKernel, id: &str, wasm: Vec<u8>, extra: &str, migrations: &[(&str, &str)]) {
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml(id, extra).into_bytes());
    files.insert("logic.wasm".to_string(), wasm);
    for (name, sql) in migrations {
        files.insert(format!("migrations/{name}"), sql.as_bytes().to_vec());
    }
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

/// A tenant with public commands allowed, the plugin installed, one member (anna) with two items.
struct World {
    t: TestKernel,
    anna: Caller,
    shared: Uuid,
    other: Uuid,
}

async fn world(plugin: &str, allow: bool) -> World {
    world_with(plugin, allow, "").await
}

/// As `world`, with more manifest text for the plugin.
async fn world_with(plugin: &str, allow: bool, extra: &str) -> World {
    world_full(plugin, allow, extra, &[]).await
}

/// As `world_with`, with migrations for the plugin.
async fn world_full(plugin: &str, allow: bool, extra: &str, migrations: &[(&str, &str)]) -> World {
    let t = start().await;
    let wasm = if plugin == PROXY { proxy_wasm() } else { echo_wasm() };
    install_with(&t, plugin, wasm, extra, migrations).await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let mgr = t.home(&g).await;
    if allow {
        let mut s = mgr.tenant.settings.clone();
        s.public_commands_enabled = true;
        set_settings(&t, &mgr, &s).await.unwrap();
    }
    let anna = t.home(&anna).await;
    let mut ids = Vec::new();
    for title in ["shared item", "other item"] {
        let row =
            crud::create(&t, &anna, plugin, "items", json!({ "title": title }).as_object().unwrap(), None)
                .await
                .unwrap();
        ids.push(row["id"].as_str().unwrap().parse().unwrap());
    }
    World { t, anna, shared: ids[0], other: ids[1] }
}

fn token_of(url: &str) -> String {
    url.trim_end_matches('/').rsplit('/').next().unwrap().to_string()
}

async fn link(w: &World) -> links::Resolved {
    let l = links::create(&w.t, &w.anna, w.shared, None, None).await.unwrap();
    links::resolve(&w.t, &token_of(&l.url)).await.unwrap()
}

fn host(op: &str, req: Value) -> Value {
    json!({ "op": op, "req": req })
}

fn titles(v: &Value) -> Vec<String> {
    v.as_array().unwrap().iter().map(|r| r["title"].as_str().unwrap().to_string()).collect()
}

async fn item_count(w: &World) -> usize {
    let row = crud::list(&w.t, &w.anna, PROXY, "items", None, None).await.unwrap();
    row.rows.len()
}

#[tokio::test]
async fn a_public_command_sees_only_the_item_of_the_link() {
    let w = world(PROXY, true).await;
    let r = link(&w).await;
    let read = host("db.query", json!({ "sql": "select title from items order by title", "params": [] }));
    let out = crud::call_public(&w.t, &r, "x", read).await.unwrap();
    assert_eq!(titles(&out), ["shared item"], "the sibling is invisible");
    // asking for the other item by name gets nothing (the id of an item is never an argument to trust)
    let by_id = host(
        "db.query",
        json!({ "sql": "select title from items where title = $1", "params": ["other item"] }),
    );
    assert!(crud::call_public(&w.t, &r, "x", by_id).await.unwrap().as_array().unwrap().is_empty());
    // the ids of the arguments do not replace the link: a "resource" or "link_resource" key is ignored
    let sneaky = json!({
        "op": "db.query",
        "resource": w.other, "link_resource": w.other,
        "req": { "sql": "select title from items order by title", "params": [] },
    });
    assert_eq!(titles(&crud::call_public(&w.t, &r, "x", sneaky).await.unwrap()), ["shared item"]);
}

#[tokio::test]
async fn a_public_command_cannot_write_or_reach_other_operations() {
    let w = world(PROXY, true).await;
    let r = link(&w).await;
    let attempts = [
        host("db.exec", json!({ "sql": "insert into items (title) values ('x')", "params": [] })),
        host(
            "db.query",
            json!({ "sql": "insert into items (title) values ('x') returning id", "params": [] }),
        ),
        host("db.query", json!({ "sql": "update items set title = 'x' returning id", "params": [] })),
        host("db.exec", json!({ "sql": "delete from items", "params": [] })),
        host("resource.create", json!({ "kind": "items", "title": "x" })),
        host("resource.delete", json!({ "id": w.shared })),
        host("plugin.call", json!({ "plugin": "com.mosaikit.notes", "name": "x", "args": null })),
        host("notify", json!({ "title": "x" })),
        host("files.list", json!({})),
    ];
    for a in attempts {
        let e = crud::call_public(&w.t, &r, "x", a.clone()).await.unwrap_err();
        assert!(e.message.contains("public link") || e.message.contains("only read"), "{a}: {}", e.message);
    }
    // nothing changed: two items, the title is intact
    assert_eq!(item_count(&w).await, 2);
    let row = crud::get(&w.t, &w.anna, PROXY, "items", w.shared).await.unwrap();
    assert_eq!(row["values"]["title"], "shared item");
}

/// `runs.mint` is for a person: a visitor of a public link gets no ticket, even when the manifest could mint one, and
/// nothing is written.
#[tokio::test]
async fn a_public_command_cannot_mint_a_run_ticket() {
    let w = world_with(PROXY, true, "[permissions]\nrun_commands = [\"x\"]\n").await;
    let r = link(&w).await;
    let count = || async {
        mosaikit_db::query_scalar::<i64>("select count(*) from core.run_tickets")
            .fetch_one(&w.t.db)
            .await
            .unwrap()
    };
    let before = count().await;
    let mint =
        host("runs.mint", json!({ "commands": ["x"], "run_ref": "visitor", "ttl_minutes": 5, "uses": 10 }));
    let e = crud::call_public(&w.t, &r, "x", mint).await.unwrap_err();
    assert!(e.message.contains("public link") && e.message.contains("runs.mint"), "{}", e.message);
    // with targets too
    let targets = host(
        "runs.mint",
        json!({ "commands": ["x"], "run_ref": "visitor", "targets": [{ "plugin": PROXY, "commands": ["x"] }] }),
    );
    assert!(crud::call_public(&w.t, &r, "x", targets).await.is_err());
    assert_eq!(count().await, before, "no ticket was written");
    let audit: i64 =
        mosaikit_db::query_scalar("select count(*) from core.events where action = 'run_ticket.mint'")
            .fetch_one(&w.t.db)
            .await
            .unwrap();
    assert_eq!(audit, 0);
}

#[tokio::test]
async fn only_declared_commands_run() {
    let w = world(PROXY, true).await;
    let r = link(&w).await;
    for name in ["y", "items.create", "", "X"] {
        let e = crud::call_public(&w.t, &r, name, json!(null)).await.unwrap_err();
        assert_eq!((e.kind, e.code()), (Kind::Forbidden, "command_not_public"), "{name}");
    }
    // a normal command is not a public one, even if it exists: it needs a person
    let e = crud::call_public(&w.t, &r, "x2", json!(null)).await.unwrap_err();
    assert_eq!(e.code(), "command_not_public");
    // arguments over the limit are refused before anything runs
    let big = json!({ "pad": "a".repeat(20 * 1024) });
    let e = crud::call_public(&w.t, &r, "x", big).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::BadRequest, "args_too_large"));
}

#[tokio::test]
async fn a_revoked_or_expired_link_runs_nothing() {
    let w = world(PROXY, true).await;
    let l = links::create(&w.t, &w.anna, w.shared, None, None).await.unwrap();
    let token = token_of(&l.url);
    assert!(links::resolve(&w.t, &token).await.is_ok());
    // the server resolves the link on every call: once it fails there is nothing to pass to the kernel
    mosaikit_db::query("update core.public_links set expires_at = now() - interval '1 minute' where id = $1")
        .bind(l.info.id)
        .execute(&w.t.db)
        .await
        .unwrap();
    assert_eq!(links::resolve(&w.t, &token).await.unwrap_err().kind, Kind::NotFound);
    let l2 = links::create(&w.t, &w.anna, w.shared, None, None).await.unwrap();
    let r2 = links::resolve(&w.t, &token_of(&l2.url)).await.unwrap();
    links::revoke(&w.t, &w.anna, l2.info.id).await.unwrap();
    assert_eq!(links::resolve(&w.t, &token_of(&l2.url)).await.unwrap_err().kind, Kind::NotFound);
    // a Resolved kept from before the revocation still reads only the item of its link (it is never
    // held across requests: the server resolves again)
    let out = crud::call_public(
        &w.t,
        &r2,
        "x",
        host("db.query", json!({ "sql": "select title from items", "params": [] })),
    )
    .await
    .unwrap();
    assert_eq!(titles(&out), ["shared item"]);
    // a trashed item takes its links with it
    let l3 = links::create(&w.t, &w.anna, w.shared, None, None).await.unwrap();
    crud::delete(&w.t, &w.anna, PROXY, "items", w.shared).await.unwrap();
    assert!(links::resolve(&w.t, &token_of(&l3.url)).await.is_err());
}

#[tokio::test]
async fn the_tenant_switch_is_off_by_default() {
    let w = world(PROXY, false).await;
    let r = link(&w).await;
    let q = host("db.query", json!({ "sql": "select 1 as n", "params": [] }));
    let e = crud::call_public(&w.t, &r, "x", q.clone()).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::Forbidden, "public_commands_off"));
    // the manager turns it on: the next resolve of the link carries the policy
    let g = w.t.login("alfa", "alfa-manager").await;
    let mgr = w.t.home(&g).await;
    let mut s = mgr.tenant.settings.clone();
    assert!(!s.public_commands_enabled);
    s.public_commands_enabled = true;
    set_settings(&w.t, &mgr, &s).await.unwrap();
    let r = link(&w).await;
    assert_eq!(crud::call_public(&w.t, &r, "x", q.clone()).await.unwrap(), json!([{ "n": 1 }]));
    // and off again
    s.public_commands_enabled = false;
    set_settings(&w.t, &mgr, &s).await.unwrap();
    let r = link(&w).await;
    assert_eq!(crud::call_public(&w.t, &r, "x", q).await.unwrap_err().code(), "public_commands_off");
}

#[tokio::test]
async fn a_link_has_a_rate_limit() {
    let w = world(PROXY, true).await;
    let r = link(&w).await;
    let q = host("db.query", json!({ "sql": "select 1 as n", "params": [] }));
    for i in 0..30 {
        crud::call_public(&w.t, &r, "x", q.clone()).await.unwrap_or_else(|e| panic!("call {i}: {e}"));
    }
    let e = crud::call_public(&w.t, &r, "x", q.clone()).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::TooMany, "public_rate_limited"));
    // another link of the same item has its own budget
    let r2 = link(&w).await;
    assert!(crud::call_public(&w.t, &r2, "x", q).await.is_ok());
}

#[tokio::test]
async fn secrets_never_reach_a_public_page_or_command() {
    let w = world(ECHO, true).await;
    let admin = w.t.admin().await;
    let mut ch = ConfigChange::default();
    ch.secrets.insert("token".into(), json!("tok-secret-9"));
    ch.values.insert("endpoint".into(), json!("https://chosen.example"));
    pconf::set_config(&w.t, &admin, ECHO, &ch).await.unwrap();

    // what the page may read: the key marked public, not the other one, not the secret
    let public = pconf::public_values(&w.t, ECHO).await.unwrap();
    assert_eq!(Value::Object(public), json!({ "endpoint": "https://chosen.example" }));
    // a plugin that does not exist has nothing
    assert!(pconf::public_values(&w.t, "com.test.nobody").await.unwrap().is_empty());

    // what the logic is given in public mode: no secret, no user, the item of the link
    let r = link(&w).await;
    let msg = crud::call_public(&w.t, &r, "x", json!({ "ask": "token" })).await.unwrap();
    let text = msg.to_string();
    assert!(!text.contains("tok-secret-9"), "{text}");
    assert!(msg["ctx"]["config"].get("token").is_none(), "{text}");
    assert_eq!(msg["ctx"]["config"]["endpoint"], "https://chosen.example");
    assert_eq!(msg["ctx"]["public"], true);
    assert_eq!(msg["ctx"]["link_resource"], w.shared.to_string());
    assert!(msg["ctx"].get("user").is_none() && msg["ctx"].get("username").is_none(), "{text}");
    // the arguments are what the visitor sent: nothing replaces the item of the link
    assert_eq!(msg["args"], json!({ "ask": "token" }));
    // in a normal call the logic does get its secret (the contrast that matters)
    let normal = crud::call(&w.t, &w.anna, ECHO, "x", json!(null)).await.unwrap();
    assert_eq!(normal["ctx"]["config"]["token"], "tok-secret-9");
}

#[tokio::test]
async fn a_public_command_never_uses_a_personal_key() {
    let w = world(PROXY, true).await;
    let admin = w.t.admin().await;
    let r = link(&w).await;
    let ask = host("key.get", json!({ "service": "translate" }));
    // the link creator's own key is not "the caller": nobody is
    keys::set_key(
        &w.t,
        w.anna.user.user_id,
        Level::User(w.anna.user.user_id),
        "translate",
        Some("anna-key"),
        None,
    )
    .await
    .unwrap();
    assert_eq!(crud::call_public(&w.t, &r, "x", ask.clone()).await.unwrap(), Value::Null);
    // a tenant key that is not shared is for the Tenant Manager alone
    let tenant = Level::Tenant(w.anna.tenant.tenant_id);
    keys::set_key(&w.t, admin.user_id, tenant, "translate", Some("tenant-key"), Some(false)).await.unwrap();
    assert_eq!(crud::call_public(&w.t, &r, "x", ask.clone()).await.unwrap(), Value::Null);
    keys::set_key(&w.t, admin.user_id, tenant, "translate", None, Some(true)).await.unwrap();
    assert_eq!(crud::call_public(&w.t, &r, "x", ask.clone()).await.unwrap(), json!("tenant-key"));
    // the platform key when the tenant has none
    keys::remove_key(&w.t, admin.user_id, tenant, "translate").await.unwrap();
    keys::set_key(&w.t, admin.user_id, Level::Platform, "translate", Some("platform-key"), Some(true))
        .await
        .unwrap();
    assert_eq!(crud::call_public(&w.t, &r, "x", ask).await.unwrap(), json!("platform-key"));
    // the person herself still gets her own key in a normal call
    let own = crud::call(&w.t, &w.anna, PROXY, "x", host("key.get", json!({ "service": "translate" })))
        .await
        .unwrap();
    assert_eq!(own, json!("anna-key"));
}

#[tokio::test]
async fn a_public_call_leaves_one_event_per_minute_and_no_arguments() {
    let w = world(PROXY, true).await;
    let r = link(&w).await;
    let q = host("db.query", json!({ "sql": "select 1 as n", "params": ["private-argument"] }));
    for _ in 0..3 {
        crud::call_public(&w.t, &r, "x", q.clone()).await.unwrap();
    }
    let rows: Vec<serde_json::Value> = mosaikit_db::query_scalar(
        "select detail from core.events where action = 'link.call' and tenant_id = $1",
    )
    .bind(r.tenant)
    .fetch_all(&w.t.db)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1, "rate limited like the views");
    assert_eq!(rows[0]["command"], "x");
    assert!(!rows[0].to_string().contains("private-argument"));
}

#[tokio::test]
async fn a_secret_setting_cannot_be_declared_public() {
    let t = start().await;
    let mut files = BTreeMap::new();
    let bad = toml("com.test.badpub", "").replace("kind = \"secret\"", "kind = \"secret\"\npublic = true");
    files.insert("plugin.toml".to_string(), bad.into_bytes());
    // refused when the manifest is read: it cannot even be packed, let alone installed
    let e = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap_err();
    assert!(e.to_string().contains("cannot be public"), "{e}");
    assert!(t.plugins.get("com.test.badpub").is_none());
}

const WRITES: &str = "[[public_commands]]\nname = \"w\"\ndescription = \"adds an answer\"\nwrite = true\n\
                      [[tables]]\nname = \"answers\"\ninsert_for = \"visitor\"\n";
const ANSWERS: &str = "create table answers (resource_id uuid not null, tenant_id uuid not null, user_id uuid not null, body text);";

/// A public command declared with `write = true` may INSERT into the tables made for visitors, for the item of the link
/// and nothing else: no update, no delete, no other table, and the plain commands stay read only.
#[tokio::test]
async fn a_public_command_that_writes_only_inserts_into_a_visitor_table() {
    let w = world_full(PROXY, true, WRITES, &[("001_answers.sql", ANSWERS)]).await;
    let r = link(&w).await;
    let insert = |item: Uuid, body: &str| {
        host(
            "db.exec",
            json!({ "sql": "insert into answers (resource_id, tenant_id, user_id, body) values ($1::uuid, $2::uuid, $3::uuid, $4)",
                    "params": [item.to_string(), r.tenant.to_string(), Uuid::new_v4().to_string(), body] }),
        )
    };
    // the command that writes inserts an answer for the item of the link
    crud::call_public(&w.t, &r, "w", insert(w.shared, "yes")).await.unwrap();
    // the plain command cannot write, whatever the table
    let e = crud::call_public(&w.t, &r, "x", insert(w.shared, "no")).await.unwrap_err();
    assert!(e.message.contains("public link"), "{}", e.message);
    // the command that writes still cannot update, delete or touch the items of the plugin
    for sql in [
        "update answers set body = 'tampered'",
        "delete from answers",
        "insert into items (title) values ('x')",
    ] {
        let e = crud::call_public(&w.t, &r, "w", host("db.exec", json!({ "sql": sql, "params": [] })))
            .await
            .unwrap_err();
        assert!(!e.message.is_empty(), "{sql}");
    }
    // and not for an item the link does not reach
    assert!(crud::call_public(&w.t, &r, "w", insert(w.other, "elsewhere")).await.is_err());
    // what is there: one answer, said by the visitor, intact; the items of the plugin are as they were
    let rows = crud::call_public(
        &w.t,
        &r,
        "x",
        host("db.query", json!({ "sql": "select body from answers", "params": [] })),
    )
    .await
    .unwrap();
    assert_eq!(rows, json!([{ "body": "yes" }]));
    assert_eq!(item_count(&w).await, 2);
}

/// The calls of a command that writes are limited more tightly than the reading ones.
#[tokio::test]
async fn a_public_command_that_writes_is_rate_limited() {
    let w = world_full(PROXY, true, WRITES, &[("001_answers.sql", ANSWERS)]).await;
    let r = link(&w).await;
    let read = host("db.query", json!({ "sql": "select body from answers", "params": [] }));
    let mut refused = None;
    for n in 0..20 {
        match crud::call_public(&w.t, &r, "w", read.clone()).await {
            Ok(_) => {}
            Err(e) => {
                refused = Some((n, e.code().to_string()));
                break;
            }
        }
    }
    assert_eq!(refused, Some((10, "public_rate_limited".to_string())), "ten calls a minute for a link");
    // reading with the plain command is still allowed (its own, larger limit)
    crud::call_public(&w.t, &r, "x", read).await.unwrap();
}
