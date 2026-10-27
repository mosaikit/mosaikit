//! Host additions for the WASM logic: `ctx.groups` and the host operation `notify`.
//!
//! The logic is hand-written WAT: `proxy` forwards its `args` to the host as a request and returns the
//! answer; `echo` returns the message it received.

use std::collections::BTreeMap;

use mosaikit_kernel::acl::{set_grant, Level};
use mosaikit_kernel::notify::{self, Filter};
use mosaikit_kernel::tenancy::{create_group, set_group_member};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{crud, Caller, Kind, SessionUser};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const PROXY: &str = "com.test.proxy";

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

fn toml(id: &str, notify: bool) -> String {
    format!(
        "id = \"{id}\"\nname = \"Host\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"Host\"\n\
         [[resources]]\nname = \"items\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n\
         [permissions]\nnotify = {notify}\n"
    )
}

async fn install(t: &TestKernel, id: &str, notify: bool, wasm: Vec<u8>) {
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml(id, notify).into_bytes());
    files.insert("logic.wasm".to_string(), wasm);
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

async fn ask(t: &TestKernel, c: &Caller, req: Value) -> mosaikit_kernel::Result<Value> {
    crud::call(t, c, PROXY, "x", req).await
}

fn notify_req(n: Value) -> Value {
    json!({ "op": "notify", "req": n })
}

async fn got(t: &TestKernel, u: &SessionUser) -> Vec<String> {
    let p = notify::list(t, u, &Filter::default()).await.unwrap();
    let mut v: Vec<String> = p.items.into_iter().filter(|n| n.source == PROXY).map(|n| n.title).collect();
    v.sort();
    v
}

fn vals(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

#[tokio::test]
async fn groups_in_the_context() {
    let t = start().await;
    install(&t, "com.test.echo", false, echo_wasm()).await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let mgr = t.home(&g).await;
    let (ca, cb) = (t.home(&anna).await, t.home(&bruno).await);
    let office = create_group(&t, &mgr, "Office").await.unwrap();
    let field = create_group(&t, &mgr, "Field").await.unwrap();
    let _other = create_group(&t, &mgr, "Nobody").await.unwrap();
    set_group_member(&t, &mgr, office, anna.user_id, true).await.unwrap();
    set_group_member(&t, &mgr, field, anna.user_id, true).await.unwrap();

    let msg = crud::call(&t, &ca, "com.test.echo", "x", json!(null)).await.unwrap();
    assert_eq!(
        msg["ctx"]["groups"],
        json!([{ "id": field.to_string(), "name": "Field" }, { "id": office.to_string(), "name": "Office" }])
    );
    // no group: an empty list, not a missing key
    let msg = crud::call(&t, &cb, "com.test.echo", "x", json!(null)).await.unwrap();
    assert_eq!(msg["ctx"]["groups"], json!([]));
    // leaving a group is seen at the next call
    set_group_member(&t, &mgr, office, anna.user_id, false).await.unwrap();
    let msg = crud::call(&t, &ca, "com.test.echo", "x", json!(null)).await.unwrap();
    assert_eq!(msg["ctx"]["groups"], json!([{ "id": field.to_string(), "name": "Field" }]));
}

#[tokio::test]
async fn notify_needs_the_permission_in_the_manifest() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    install(&t, PROXY, false, proxy_wasm()).await;
    let c = t.home(&g).await;
    let e = ask(&t, &c, notify_req(json!({ "title": "Hi" }))).await.unwrap_err();
    assert!(e.message.contains("notify"), "{e}");
    assert!(got(&t, &g).await.is_empty());
}

#[tokio::test]
async fn notify_the_caller_and_the_viewers_of_an_item() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    install(&t, PROXY, true, proxy_wasm()).await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let carla = t.member(&g, "carla").await;
    let (ca, cb) = (t.home(&anna).await, t.home(&bruno).await);

    // to the caller alone, with a place inside the plugin
    ask(&t, &ca, notify_req(json!({ "title": "Mine", "body": "b", "at": "items/1" }))).await.unwrap();
    assert_eq!(got(&t, &anna).await, vec!["Mine"]);
    assert!(got(&t, &bruno).await.is_empty());
    let n = &notify::list(&t, &anna, &Filter::default()).await.unwrap().items[0];
    assert_eq!(n.link, format!("#/t/alfa/p/{PROXY}/items%2F1"));

    // to the people who see an item: Bruno reads it, Carla does not; the sender is left out
    let item = crud::create(&t, &ca, PROXY, "items", &vals(json!({ "title": "i" })), None).await.unwrap();
    let rid: Uuid = item["id"].as_str().unwrap().parse().unwrap();
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read)).await.unwrap();
    ask(&t, &ca, notify_req(json!({ "title": "Item", "resource": rid }))).await.unwrap();
    assert_eq!(got(&t, &bruno).await, vec!["Item"]);
    assert_eq!(got(&t, &anna).await, vec!["Mine"]);
    assert!(got(&t, &carla).await.is_empty());

    // Bruno only reads the item: his request is refused when it is sent (logged), nobody is notified
    ask(&t, &cb, notify_req(json!({ "title": "Spoof", "resource": rid }))).await.unwrap();
    assert!(!got(&t, &anna).await.contains(&"Spoof".to_string()));
}

#[tokio::test]
async fn notify_limits_and_links() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    install(&t, PROXY, true, proxy_wasm()).await;
    let anna = t.member(&g, "anna").await;
    let ca = t.home(&anna).await;
    for bad in [json!({ "title": "  " }), json!({ "title": "x", "at": "<script>alert(1)" })] {
        let e = ask(&t, &ca, notify_req(bad)).await.unwrap_err();
        assert_eq!(e.kind, Kind::BadRequest, "{e}");
    }
    let e = ask(&t, &ca, notify_req(json!({ "title": "x", "at": "javascript:alert(1)" }))).await.unwrap_err();
    assert!(e.message.contains("invalid place"), "{e}");
    // long texts are cut, not refused
    ask(&t, &ca, notify_req(json!({ "title": "t".repeat(500), "body": "b".repeat(2000) }))).await.unwrap();
    let n = &notify::list(&t, &anna, &Filter::default()).await.unwrap().items[0];
    assert!(n.title.chars().count() <= 160 && n.body.chars().count() <= 600);
    // 30 a minute per person and plugin
    let mut refused = None;
    for i in 0..40 {
        if let Err(e) = ask(&t, &ca, notify_req(json!({ "title": format!("n{i}") }))).await {
            refused = Some(e);
            break;
        }
    }
    assert!(refused.expect("rate limit").message.contains("too many notifications"));
}

#[tokio::test]
async fn notify_never_crosses_tenants() {
    let t = start().await;
    let ga = t.tenant("alfa").await;
    let gb = t.tenant("beta").await;
    install(&t, PROXY, true, proxy_wasm()).await;
    let anna = t.member(&ga, "anna").await;
    let (ca, cb) = (t.home(&anna).await, t.home(&gb).await);
    let item = crud::create(&t, &ca, PROXY, "items", &vals(json!({ "title": "i" })), None).await.unwrap();
    let rid: Uuid = item["id"].as_str().unwrap().parse().unwrap();
    // the manager of another tenant names the item: nothing happens, nobody is told
    ask(&t, &cb, notify_req(json!({ "title": "Cross", "resource": rid }))).await.unwrap();
    assert!(got(&t, &anna).await.is_empty());
    assert!(got(&t, &ga).await.is_empty());
    assert!(got(&t, &gb).await.is_empty());
}
