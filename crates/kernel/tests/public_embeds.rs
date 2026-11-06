//! Embedded pages in a public link view: the ticket belongs to the link, is limited to a resource under it and to the commands
//! of the embed that the plugin also exposes as public commands. Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.
//!
//! The logic of the embedded plugin returns the message it received, so a test sees the context of the call.

use std::collections::BTreeMap;

use mosaikit_kernel::tenancy::set_settings;
use mosaikit_kernel::testing::{start_with, test_key, TestKernel};
use mosaikit_kernel::{crud, embeds, links, run_tickets, Caller, Kind};
use serde_json::{json, Value};
use uuid::Uuid;

const HOST: &str = "com.test.board";
const MAPS: &str = "com.test.maps";
const OTHER: &str = "com.test.other";

fn msg_wasm() -> Vec<u8> {
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

async fn install(t: &TestKernel, id: &str, wasm: Vec<u8>, body: &str) {
    let toml = format!(
        "id = \"{id}\"\nname = \"P\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"P\"\n\
         [requires]\nmosaikit = \">=1.0\"\n\
         [[resources]]\nname = \"items\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n\
         [[resources]]\nname = \"notes\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n{body}"
    );
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml.into_bytes());
    files.insert("logic.wasm".to_string(), wasm);
    t.install_package(&mosaikit_mskp::pack(&files, Some(&test_key())).unwrap()).await.unwrap();
}

/// `layers` is public and offered to the page `map`; `extent` is offered but not public; `tiles` is public but not offered.
const MAPS_TOML: &str = "[permissions]\nrun_commands = [\"layers\", \"extent\", \"tiles\"]\n\
    [[public_commands]]\nname = \"layers\"\ndescription = \"layers\"\n\
    [[public_commands]]\nname = \"tiles\"\ndescription = \"tiles\"\n\
    [[embeds]]\nname = \"map\"\nentry = \"embed.html\"\nresource_kind = \"items\"\ncommands = [\"layers\", \"extent\"]\n\
    [[embeds]]\nname = \"plain\"\nentry = \"plain.html\"\ncommands = [\"extent\"]\n\
    [[embeds]]\nname = \"pinned\"\nentry = \"pinned.html\"\ncommands = [\"layers\"]\nsame_origin = true\n";

struct World {
    t: TestKernel,
    anna: Caller,
    mgr: Caller,
    /// the item of the link, a map and a note under it (kind `items` and `notes`), a root item outside it, another board
    board: Uuid,
    map: Uuid,
    note: Uuid,
    outside: Uuid,
    board2: Uuid,
    link: links::Resolved,
}

async fn item(
    t: &TestKernel,
    c: &Caller,
    plugin: &str,
    kind: &str,
    title: &str,
    parent: Option<Uuid>,
) -> Uuid {
    let row = crud::create(t, c, plugin, kind, json!({ "title": title }).as_object().unwrap(), parent)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn world() -> World {
    world_with(|_| {}).await
}

async fn world_with(f: impl FnOnce(&mut mosaikit_kernel::config::Config)) -> World {
    let t = start_with(f).await;
    install(&t, MAPS, msg_wasm(), MAPS_TOML).await;
    install(&t, HOST, echo_wasm(), &format!("[permissions]\nembeds = [\"{MAPS}\"]\n")).await;
    install(&t, OTHER, echo_wasm(), "").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let mgr = t.home(&g).await;
    let mut s = mgr.tenant.settings.clone();
    s.public_commands_enabled = true;
    set_settings(&t, &mgr, &s).await.unwrap();
    let anna = t.home(&anna).await;
    let board = item(&t, &anna, HOST, "items", "board", None).await;
    let map = item(&t, &anna, HOST, "items", "the map", Some(board)).await;
    let note = item(&t, &anna, HOST, "notes", "a note", Some(board)).await;
    let outside = item(&t, &anna, HOST, "items", "outside map", None).await;
    let board2 = item(&t, &anna, HOST, "items", "board 2", None).await;
    let link = link_of(&t, &anna, board).await;
    World { t, anna, mgr, board, map, note, outside, board2, link }
}

async fn link_of(t: &TestKernel, c: &Caller, rid: Uuid) -> links::Resolved {
    let l = links::create(t, c, rid, None, None).await.unwrap();
    links::resolve(t, l.url.trim_end_matches('/').rsplit('/').next().unwrap()).await.unwrap()
}

fn ask(plugin: &str, name: &str, rid: Uuid) -> Value {
    json!({ "plugin": plugin, "name": name, "resource": rid })
}

fn ticket(v: &Value) -> String {
    v["url"].as_str().unwrap().split("embed=").nth(1).unwrap().split('&').next().unwrap().to_string()
}

fn titles_query() -> Value {
    json!({ "q": 1 })
}

async fn mint(w: &World, rid: Uuid) -> String {
    ticket(&embeds::public_url(&w.t, &w.link, &ask(MAPS, "map", rid)).await.unwrap())
}

async fn call(w: &World, token: &str, command: &str) -> mosaikit_kernel::Result<Value> {
    run_tickets::call(&w.t, token, MAPS, command, titles_query()).await
}

#[tokio::test]
async fn a_public_view_cannot_ask_for_a_frame_the_link_does_not_grant() {
    let w = world().await;
    let (t, r) = (&w.t, &w.link);
    // the plugin of the link must declare the other one
    let other = link_of(t, &w.anna, item(t, &w.anna, OTHER, "items", "o", None).await).await;
    let e = embeds::public_url(t, &other, &ask(MAPS, "map", w.map)).await.unwrap_err();
    assert_eq!(e.code(), "permission_denied", "{e}");
    // the embed must exist
    let e = embeds::public_url(t, r, &ask(MAPS, "nope", w.map)).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);
    // the resource must be under the link and of the kind of the embed (a note is not an item)
    for rid in [w.outside, w.board2, w.note, Uuid::new_v4()] {
        let e = embeds::public_url(t, r, &ask(MAPS, "map", rid)).await.unwrap_err();
        assert_eq!(e.kind, Kind::NotFound, "{rid}");
    }
    // an embed with no command that the plugin also exposes as public gets no ticket
    let e = embeds::public_url(t, r, &ask(MAPS, "plain", w.map)).await.unwrap_err();
    assert_eq!(e.code(), "command_not_public", "{e}");
    // the tenant has not allowed public commands
    let mut s = w.mgr.tenant.settings.clone();
    s.public_commands_enabled = false;
    set_settings(t, &w.mgr, &s).await.unwrap();
    let off = links::resolve_id(t, r.link_id).await.unwrap();
    let e = embeds::public_url(t, &off, &ask(MAPS, "map", w.map)).await.unwrap_err();
    assert_eq!(e.code(), "public_commands_off", "{e}");
}

#[tokio::test]
async fn a_public_ticket_runs_only_public_commands_of_the_embed_on_its_resource() {
    let w = world().await;
    let v = embeds::public_url(&w.t, &w.link, &ask(MAPS, "map", w.map)).await.unwrap();
    assert!(v["url"].as_str().unwrap().contains(&format!("/ui/{MAPS}/embed.html?embed=pe.")), "{v}");
    assert_eq!(v["resource"], json!(w.map));
    let token = ticket(&v);
    // not a command of the embed, not public, another plugin
    assert_eq!(call(&w, &token, "tiles").await.unwrap_err().code(), "run_wrong_command");
    assert_eq!(call(&w, &token, "extent").await.unwrap_err().code(), "command_not_public");
    let e = run_tickets::call(&w.t, &token, OTHER, "layers", titles_query()).await.unwrap_err();
    assert_eq!(e.code(), "run_wrong_plugin", "{e}");
    // a ticket cut or altered is no ticket
    let (head, mac) = token.rsplit_once('.').unwrap();
    let flipped = format!("{head}.{}{}", if mac.starts_with('0') { '1' } else { '0' }, &mac[1..]);
    for bad in [flipped, head.to_string(), format!("{head}."), "pe.zz.zz".to_string(), "pe.".to_string()] {
        assert_eq!(call(&w, &bad, "layers").await.unwrap_err().code(), "run_ticket_invalid", "{bad}");
    }
    // the payload of one link with the signature of another does not pass
    let other = link_of(&w.t, &w.anna, w.board2).await;
    let payload = String::from_utf8(hex::decode(head.strip_prefix("pe.").unwrap()).unwrap()).unwrap();
    let swapped = payload.replace(&w.link.link_id.to_string(), &other.link_id.to_string());
    let forged = format!("pe.{}.{mac}", hex::encode(swapped));
    assert_eq!(call(&w, &forged, "layers").await.unwrap_err().code(), "run_ticket_invalid");
    // the other link cannot show the map of this one
    let e = embeds::public_url(&w.t, &other, &ask(MAPS, "map", w.map)).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);

    // what runs: a visitor (no user, no rights) with the link narrowed to the resource of the frame
    let out = call(&w, &token, "layers").await.unwrap();
    assert_eq!(out["ctx"]["link_resource"], json!(w.map), "{out}");
    assert_eq!(out["ctx"]["public"], json!(true));
    assert_eq!(out["ctx"]["plugin"], json!(MAPS));
    assert!(out["ctx"].get("user").is_none() && out["ctx"]["perms"] == json!([]), "{out}");
    // the arguments cannot name another resource
    let sneaky = json!({ "resource": w.outside, "link_resource": w.outside });
    let out = run_tickets::call(&w.t, &token, MAPS, "layers", sneaky).await.unwrap();
    assert_eq!(out["ctx"]["link_resource"], json!(w.map));
    // the board itself can be shown too, since it is the shared item
    let own = mint(&w, w.board).await;
    assert_eq!(call(&w, &own, "layers").await.unwrap()["ctx"]["link_resource"], json!(w.board));
}

#[tokio::test]
async fn a_public_ticket_stops_with_the_link_the_policy_and_the_resource() {
    let w = world().await;
    let token = mint(&w, w.map).await;
    call(&w, &token, "layers").await.unwrap();

    // the tenant takes public commands back, then allows them again
    let mut s = w.mgr.tenant.settings.clone();
    s.public_commands_enabled = false;
    set_settings(&w.t, &w.mgr, &s).await.unwrap();
    assert_eq!(call(&w, &token, "layers").await.unwrap_err().code(), "public_commands_off");
    s.public_commands_enabled = true;
    set_settings(&w.t, &w.mgr, &s).await.unwrap();
    call(&w, &token, "layers").await.unwrap();

    // an expired link
    let expired = mint(&w, w.map).await;
    mosaikit_db::query("update core.public_links set expires_at = now() - interval '1 minute' where id = $1")
        .bind(w.link.link_id)
        .execute(&w.t.db)
        .await
        .unwrap();
    for t in [&token, &expired] {
        assert_eq!(call(&w, t, "layers").await.unwrap_err().code(), "run_ticket_invalid");
    }
    mosaikit_db::query("update core.public_links set expires_at = null where id = $1")
        .bind(w.link.link_id)
        .execute(&w.t.db)
        .await
        .unwrap();
    call(&w, &token, "layers").await.unwrap();

    // the resource of the frame in the trash
    crud::delete(&w.t, &w.anna, HOST, "items", w.map).await.unwrap();
    assert_eq!(call(&w, &token, "layers").await.unwrap_err().code(), "run_ticket_invalid");

    // a revoked link: the ticket made before is dead, and no new one is made
    let w = world().await;
    let token = mint(&w, w.map).await;
    links::revoke(&w.t, &w.anna, w.link.link_id).await.unwrap();
    assert_eq!(call(&w, &token, "layers").await.unwrap_err().code(), "run_ticket_invalid");
    assert!(links::resolve_id(&w.t, w.link.link_id).await.is_err());
}

/// `same_origin` is for a person's frame only: in a public view the frame keeps the opaque origin, whatever the plugin
/// declares and whatever the installation (here one origin per plugin, where a person gets `allow-same-origin`: see the test of `embeds`).
#[tokio::test]
async fn a_public_view_never_gets_the_origin_of_the_plugin() {
    let w = world_with(|c| {
        c.plugin_url_setting = Some("http://*.localhost:19999".into());
        c.derive().unwrap();
    })
    .await;
    let rid = w.map;
    let public = embeds::public_url(&w.t, &w.link, &ask(MAPS, "pinned", rid)).await.unwrap();
    assert_eq!(public["sandbox"], json!("allow-scripts"), "{public}");
    assert!(ticket(&public).starts_with("pe."));
    // an embed that does not ask stays opaque for everybody
    let plain = embeds::public_url(&w.t, &w.link, &ask(MAPS, "map", rid)).await.unwrap();
    assert_eq!(plain["sandbox"], json!("allow-scripts"));
}
