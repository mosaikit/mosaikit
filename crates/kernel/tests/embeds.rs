//! Embedded pages: `embed.url` mints a ticket limited to one resource and to the commands of the embed, for a plugin that
//! declares the other one. Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use std::collections::BTreeMap;

use mosaikit_kernel::acl::{set_grant, Level};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{crud, embeds, run_tickets, Caller, Kind};
use serde_json::{json, Value};
use uuid::Uuid;

const HOST: &str = "com.test.dash";
const MAPS: &str = "com.test.maps";

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

async fn install(t: &TestKernel, id: &str, body: &str) {
    let toml = format!(
        "id = \"{id}\"\nname = \"P\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"P\"\n\
         [requires]\nmosaikit = \">=1.0\"\n\
         [[resources]]\nname = \"items\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n{body}"
    );
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml.into_bytes());
    files.insert("logic.wasm".to_string(), echo_wasm());
    t.install_package(&mosaikit_mskp::pack(&files, Some(&test_key())).unwrap()).await.unwrap();
}

async fn map(t: &TestKernel, who: &Caller, plugin: &str) -> Uuid {
    let row = crud::create(t, who, plugin, "items", json!({ "title": "m" }).as_object().unwrap(), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

fn ask(plugin: &str, name: &str, rid: Uuid) -> Value {
    json!({ "plugin": plugin, "name": name, "resource": rid })
}

fn token_of(v: &Value) -> String {
    let u = v["url"].as_str().unwrap();
    u.split("embed=").nth(1).unwrap().split('&').next().unwrap().to_string()
}

#[tokio::test]
async fn a_plugin_shows_the_page_of_another_for_one_resource_with_the_rights_of_the_person() {
    let t = start().await;
    install(&t, MAPS, "[permissions]\nrun_commands = [\"layers\", \"extent\"]\n[[embeds]]\nname = \"map\"\nentry = \"embed.html\"\ncontract = \"geo-embed/1\"\nresource_kind = \"items\"\ncommands = [\"layers\"]\n").await;
    install(&t, HOST, &format!("[permissions]\nembeds = [\"{MAPS}\"]\n")).await;
    install(&t, "com.test.other", "").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let (ca, cb) = (t.home(&anna).await, t.home(&bruno).await);
    let rid = map(&t, &ca, MAPS).await;

    // the owner gets the address of the page on the origin of the maps plugin, with a ticket for the map
    let v = embeds::url(&t, &ca, HOST, &ask(MAPS, "map", rid)).await.unwrap();
    let url = v["url"].as_str().unwrap();
    assert!(
        url.contains(&format!("/ui/{MAPS}/embed.html?embed=")) && url.contains(&format!("resource={rid}")),
        "{url}"
    );
    assert_eq!(v["contract"], json!("geo-embed/1"));
    // the ticket calls the commands of the embed and no other, as the person
    let token = token_of(&v);
    run_tickets::call(&t, &token, MAPS, "layers", json!({})).await.unwrap();
    let e = run_tickets::call(&t, &token, MAPS, "extent", json!({})).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden, "{e}");
    // ...and never reaches another plugin
    assert!(run_tickets::call(&t, &token, "com.test.other", "layers", json!({})).await.is_err());

    // a person who does not see the map is told it does not exist; a reader gets a frame
    assert_eq!(embeds::url(&t, &cb, HOST, &ask(MAPS, "map", rid)).await.unwrap_err().kind, Kind::NotFound);
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read)).await.unwrap();
    embeds::url(&t, &cb, HOST, &ask(MAPS, "map", rid)).await.unwrap();

    // the plugin that embeds must declare the other; an embed must exist; the resource must be of the plugin
    let e = embeds::url(&t, &ca, "com.test.other", &ask(MAPS, "map", rid)).await.unwrap_err();
    assert_eq!(e.code(), "permission_denied", "{e}");
    assert_eq!(embeds::url(&t, &ca, HOST, &ask(MAPS, "nope", rid)).await.unwrap_err().kind, Kind::NotFound);
    let foreign = map(&t, &ca, "com.test.other").await;
    assert_eq!(
        embeds::url(&t, &ca, HOST, &ask(MAPS, "map", foreign)).await.unwrap_err().kind,
        Kind::NotFound
    );
}

/// `same_origin` of an embed: the answer says what the host must put in the `sandbox` of the frame. Only an embed that asks
/// for it, on an installation with one origin per plugin, gets `allow-same-origin`; every other case stays opaque.
#[tokio::test]
async fn same_origin_is_asked_by_the_plugin_that_offers_the_page_and_only_it() {
    const BODY: &str = "[permissions]
run_commands = [\"layers\"]
        [[embeds]]
name = \"pinned\"
entry = \"pinned.html\"
commands = [\"layers\"]
same_origin = true
        [[embeds]]
name = \"map\"
entry = \"embed.html\"
commands = [\"layers\"]
        [[embeds]]
name = \"off\"
entry = \"off.html\"
commands = [\"layers\"]
same_origin = false
";
    for wildcard in [true, false] {
        let t = mosaikit_kernel::testing::start_with(|c| {
            if wildcard {
                c.plugin_url_setting = Some("http://*.localhost:19999".into());
                c.derive().unwrap();
            }
        })
        .await;
        install(&t, MAPS, BODY).await;
        install(
            &t,
            HOST,
            &format!(
                "[permissions]
embeds = [\"{MAPS}\"]
"
            ),
        )
        .await;
        let g = t.tenant("alfa").await;
        let anna = t.member(&g, "anna").await;
        let ca = t.home(&anna).await;
        let rid = map(&t, &ca, MAPS).await;
        let sandbox = |name: &'static str| {
            let (t, ca) = (&t, &ca);
            async move { embeds::url(t, ca, HOST, &ask(MAPS, name, rid)).await.unwrap()["sandbox"].clone() }
        };
        let want = if wildcard { "allow-scripts allow-same-origin" } else { "allow-scripts" };
        assert_eq!(sandbox("pinned").await, json!(want), "wildcard {wildcard}");
        assert_eq!(sandbox("map").await, json!("allow-scripts"), "default is opaque");
        assert_eq!(sandbox("off").await, json!("allow-scripts"));
        // the kernel gives the page the same value (the server sends it as the CSP `sandbox` of the page)
        let k = &t;
        let h = k.plugins.active(MAPS).unwrap();
        let decl = h.manifest.embeds.iter().find(|e| e.name == "pinned").unwrap();
        assert_eq!(embeds::sandbox_for(k, decl), want);
        assert_eq!(
            embeds::sandbox_for(k, h.manifest.embeds.iter().find(|e| e.name == "map").unwrap()),
            "allow-scripts"
        );
    }
}
