//! Plugins in the tenants: availability (Administrator) and on/off (Tenant Manager), extensions and
//! their fields and actions, settings of a plugin, update and uninstall of an extension.

use std::collections::BTreeMap;

use mosaikit_kernel::plugins::{self, config, extensions, tenants, InstallSource};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{crud, links, Kind};
use serde_json::{json, Map, Value};

const NOTES: &str = "com.mosaikit.notes";
const REVIEW: &str = "com.example.note-review";

fn review_manifest(version: &str, min: &str) -> String {
    format!(
        r#"
id = "{REVIEW}"
name = "Note review"
version = "{version}"
icon = "badge-check"
[contribution]
icon = "✔"
label = "Note review"
[extends]
plugin = "{NOTES}"
min_version = "{min}"
[[extension.fields]]
resource = "notes"
key = "reviewed"
label = "Reviewed"
kind = "bool"
[[extension.fields]]
resource = "notes"
key = "reviewer"
label = "Reviewed by"
kind = "text"
[[extension.actions]]
resource = "notes"
key = "mark_reviewed"
label = "Mark as reviewed"
set = {{ reviewed = true, reviewer = "$user" }}
[[config]]
key = "level"
label = "Level"
kind = "choice"
options = ["light", "strict"]
default = "light"
[[config]]
key = "token"
label = "Token"
kind = "secret"
[i18n.it]
extension = {{ fields = {{ reviewed = "Revisionata" }}, actions = {{ mark_reviewed = "Segna come revisionata" }} }}
"#
    )
}

async fn install_review(t: &TestKernel, version: &str, min: &str) -> mosaikit_kernel::Result<()> {
    let files = BTreeMap::from([("plugin.toml".to_string(), review_manifest(version, min).into_bytes())]);
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    let p = plugins::install_package(t, None, &pkg, InstallSource::Upload).await?;
    plugins::set_active(t, None, &p.id, true).await
}

fn obj(v: Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap()
}

async fn notifications_of(t: &TestKernel, user: uuid::Uuid) -> Vec<String> {
    mosaikit_db::query("select data->>'code' from core.notifications where user_id = $1 order by created_at")
        .bind(user)
        .fetch_all(&t.k.db)
        .await
        .unwrap()
        .iter()
        .map(|r| r.get::<Option<String>, _>(0).unwrap_or_default())
        .collect()
}

#[tokio::test]
async fn available_and_turned_on() {
    let t = start().await;
    t.install("notes").await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let alfa = manager.tenant.tenant_id;

    // by default a plugin installed and on is available and on in every tenant
    assert!(tenants::is_on(&t, alfa, NOTES).await.unwrap());
    let list = tenants::tenant_plugins(&t, &manager, "en").await.unwrap();
    let notes = list.iter().find(|p| p.id == NOTES).unwrap();
    assert!(notes.on && notes.enabled && notes.kind == "app");
    assert_eq!(tenants::tenant_plugins(&t, &anna, "en").await.unwrap_err().kind, Kind::Forbidden);
    crud::create(&t, &anna, NOTES, "notes", &obj(json!({ "title": "one" })), None).await.unwrap();

    // the Tenant Manager turns it off: nobody uses it, the context forgets it
    tenants::set_enabled(&t, &manager, NOTES, false).await.unwrap();
    let e = crud::list(&t, &anna, NOTES, "notes", None, None).await.unwrap_err();
    assert_eq!((e.kind, e.code), (Kind::NotFound, Some("plugin_off")));
    let perms =
        mosaikit_kernel::access::effective_all(&t, alfa, anna.user.user_id, anna.tenant.role).await.unwrap();
    assert!(!perms.contains_key(NOTES));
    assert_eq!(tenants::set_enabled(&t, &anna, NOTES, true).await.unwrap_err().kind, Kind::Forbidden);
    tenants::set_enabled(&t, &manager, NOTES, true).await.unwrap();
    assert_eq!(crud::list(&t, &anna, NOTES, "notes", None, None).await.unwrap().rows.len(), 1);

    // the Administrator takes it back: the Tenant Manager no longer sees it, nor can turn it on
    tenants::set_available(&t, &admin, NOTES, alfa, Some(false)).await.unwrap();
    assert!(!tenants::is_on(&t, alfa, NOTES).await.unwrap());
    assert!(tenants::tenant_plugins(&t, &manager, "en").await.unwrap().iter().all(|p| p.id != NOTES));
    let e = tenants::set_enabled(&t, &manager, NOTES, true).await.unwrap_err();
    assert_eq!((e.kind, e.code), (Kind::Forbidden, Some("plugin_unavailable")));
    assert!(crud::list(&t, &anna, NOTES, "notes", None, None).await.is_err());
    let (default, list) = tenants::plugin_tenants(&t, &admin, NOTES).await.unwrap();
    let row = list.iter().find(|x| x.slug == "alfa").unwrap();
    assert!(default && !row.available && row.own_choice == Some(false));
    assert_eq!(
        tenants::set_available(&t, &g, NOTES, alfa, Some(true)).await.unwrap_err().kind,
        Kind::Forbidden
    );

    // back to the default: available again; the Tenant Manager was told both times
    tenants::set_available(&t, &admin, NOTES, alfa, None).await.unwrap();
    assert!(tenants::is_on(&t, alfa, NOTES).await.unwrap());
    assert_eq!(notifications_of(&t, g.user_id).await, ["plugin.unavailable", "plugin.available"]);

    // the default of the plugin: unavailable to the tenants without a choice of their own
    tenants::set_available_default(&t, &admin, NOTES, false).await.unwrap();
    assert!(!tenants::is_on(&t, alfa, NOTES).await.unwrap());
    tenants::set_available(&t, &admin, NOTES, alfa, Some(true)).await.unwrap();
    assert!(tenants::is_on(&t, alfa, NOTES).await.unwrap(), "the choice for the tenant wins");
}

#[tokio::test]
async fn public_links_follow_the_plugin() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let row =
        crud::create(&t, &manager, NOTES, "notes", &obj(json!({ "title": "public" })), None).await.unwrap();
    let rid = row["id"].as_str().unwrap().parse().unwrap();
    let link = links::create(&t, &manager, rid, None, None).await.unwrap();
    let token = link.url.trim_end_matches('/').rsplit('/').next().unwrap().to_string();
    assert!(links::resolve(&t, &token).await.is_ok());
    tenants::set_enabled(&t, &manager, NOTES, false).await.unwrap();
    assert!(links::resolve(&t, &token).await.is_err(), "a plugin turned off takes its links with it");
    tenants::set_enabled(&t, &manager, NOTES, true).await.unwrap();
    assert!(links::resolve(&t, &token).await.is_ok());
}

#[tokio::test]
async fn extensions_add_fields_and_actions() {
    let t = start().await;
    t.install("notes").await;
    install_review(&t, "0.1.0", "0.1.0").await.unwrap();
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let bruno = t.member(&g, "bruno").await;
    let bruno = t.home(&bruno).await;

    let row = crud::create(&t, &anna, NOTES, "notes", &obj(json!({ "title": "draft" })), None).await.unwrap();
    let id: uuid::Uuid = row["id"].as_str().unwrap().parse().unwrap();

    // what the extension adds to the notes, in the language of the person
    let views = extensions::for_resource(&t, &anna, NOTES, "notes", "it").await.unwrap();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].id, REVIEW);
    assert_eq!(views[0].fields[0].label, "Revisionata");
    assert_eq!(views[0].actions[0].label, "Segna come revisionata");
    assert!(extensions::for_resource(&t, &anna, NOTES, "other", "en").await.is_err());

    // values: only on visible items, checked against the fields of the extension
    let set =
        extensions::set_values(&t, &anna, NOTES, "notes", id, REVIEW, &obj(json!({ "reviewer": "me" })))
            .await
            .unwrap();
    assert_eq!(set["reviewer"], "me");
    assert!(extensions::set_values(&t, &anna, NOTES, "notes", id, REVIEW, &obj(json!({ "missing": 1 })))
        .await
        .is_err());
    let v = extensions::values(&t, &anna, NOTES, "notes", &[id]).await.unwrap();
    assert_eq!(v[&id][REVIEW]["reviewer"], "me");
    assert!(extensions::values(&t, &bruno, NOTES, "notes", &[id]).await.unwrap().is_empty(), "not shared");
    let e = extensions::set_values(&t, &bruno, NOTES, "notes", id, REVIEW, &obj(json!({ "reviewed": true })))
        .await
        .unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);
    // only items of the extended plugin: not a task of Anna, although she may edit it
    t.install("tasks").await;
    let task = crud::create(&t, &anna, "com.mosaikit.tasks", "tasks", &obj(json!({ "title": "t" })), None)
        .await
        .unwrap();
    let tid: uuid::Uuid = task["id"].as_str().unwrap().parse().unwrap();
    let e = extensions::set_values(&t, &anna, NOTES, "notes", tid, REVIEW, &obj(json!({ "reviewer": "x" })))
        .await
        .unwrap_err();
    assert_eq!(e.kind, Kind::NotFound, "an item of another plugin");

    // an action: the values it sets, with the name of the person
    let after = extensions::run_action(&t, &anna, NOTES, "notes", id, REVIEW, "mark_reviewed").await.unwrap();
    assert_eq!((after["reviewed"].clone(), after["reviewer"].clone()), (json!(true), json!("anna")));
    assert!(extensions::run_action(&t, &anna, NOTES, "notes", id, REVIEW, "other").await.is_err());

    // turning off the plugin turns off its extensions; the extension needs its plugin on
    tenants::set_enabled(&t, &manager, NOTES, false).await.unwrap();
    assert!(!tenants::is_on(&t, manager.tenant.tenant_id, REVIEW).await.unwrap());
    let list = tenants::tenant_plugins(&t, &manager, "en").await.unwrap();
    let review = list.iter().find(|p| p.id == REVIEW).unwrap();
    assert!(review.enabled && !review.on && review.kind == "extension");
    tenants::set_enabled(&t, &manager, REVIEW, false).await.unwrap();
    let e = tenants::set_enabled(&t, &manager, REVIEW, true).await.unwrap_err();
    assert_eq!((e.kind, e.code), (Kind::Conflict, Some("base_off")));
    tenants::set_enabled(&t, &manager, NOTES, true).await.unwrap();
    assert!(
        extensions::for_resource(&t, &anna, NOTES, "notes", "en").await.unwrap().is_empty(),
        "turned off"
    );
    tenants::set_enabled(&t, &manager, REVIEW, true).await.unwrap();
    assert_eq!(extensions::for_resource(&t, &anna, NOTES, "notes", "en").await.unwrap().len(), 1);

    // the values follow the item: hidden in the trash, back with it, gone when it is purged
    crud::delete(&t, &anna, NOTES, "notes", id).await.unwrap();
    assert!(extensions::values(&t, &anna, NOTES, "notes", &[id]).await.unwrap().is_empty(), "in the trash");
    assert!(extensions::set_values(&t, &anna, NOTES, "notes", id, REVIEW, &obj(json!({ "reviewer": "x" })))
        .await
        .is_err());
    mosaikit_kernel::trash::restore(&t, &anna, id).await.unwrap();
    let v = extensions::values(&t, &anna, NOTES, "notes", &[id]).await.unwrap();
    assert_eq!(v[&id][REVIEW]["reviewer"], "anna");
    crud::delete(&t, &anna, NOTES, "notes", id).await.unwrap();
    // turned off in the tenant: the trash still shows the item and purges it
    tenants::set_enabled(&t, &manager, NOTES, false).await.unwrap();
    assert_eq!(mosaikit_kernel::trash::list(&t, &anna, None, None).await.unwrap().len(), 1);
    mosaikit_kernel::trash::purge(&t, &anna, id).await.unwrap();
    let left: i64 = mosaikit_db::query_scalar("select count(*) from core.extension_values")
        .fetch_one(&t.k.db)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

#[tokio::test]
async fn extension_needs_a_recent_enough_plugin() {
    let t = start().await;
    t.install("notes").await;
    install_review(&t, "0.1.0", "99.0.0").await.unwrap();
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let list = tenants::tenant_plugins(&t, &manager, "en").await.unwrap();
    let review = list.iter().find(|p| p.id == REVIEW).unwrap();
    assert!(!review.on);
    assert_eq!(serde_json::to_value(review.off).unwrap(), json!("base"));
    assert_eq!(list.iter().find(|p| p.id == NOTES).unwrap().extensions, [REVIEW]);
}

#[tokio::test]
async fn settings_update_and_uninstall() {
    let t = start().await;
    t.install("notes").await;
    install_review(&t, "0.1.0", "0.1.0").await.unwrap();
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;

    // settings: defaults, values checked against their kind, secrets never shown
    let c = config::config(&t, &admin, REVIEW, "en").await.unwrap();
    assert_eq!(c.values["level"], "light");
    assert!(c.secrets.is_empty());
    let change = |v: Value| serde_json::from_value::<config::ConfigChange>(v).unwrap();
    assert!(config::set_config(&t, &admin, REVIEW, &change(json!({ "values": { "level": "loose" } })))
        .await
        .is_err());
    assert!(config::set_config(&t, &admin, REVIEW, &change(json!({ "values": { "token": "x" } })))
        .await
        .is_err());
    let c = config::set_config(
        &t,
        &admin,
        REVIEW,
        &change(json!({ "values": { "level": "strict" }, "secrets": { "token": "s3cret" } })),
    )
    .await
    .unwrap();
    assert_eq!((c.values["level"].clone(), c.secrets.clone()), (json!("strict"), vec!["token".to_string()]));
    assert!(!serde_json::to_string(&c).unwrap().contains("s3cret"));
    assert_eq!(config::for_logic(&t, REVIEW).await.unwrap(), json!({ "level": "strict", "token": "s3cret" }));
    assert_eq!(config::config(&t, &g, REVIEW, "en").await.unwrap_err().kind, Kind::Forbidden);
    let sealed: Vec<u8> = mosaikit_db::query_scalar(
        "select value from core.secrets where name = 'plugin:com.example.note-review:token'",
    )
    .fetch_one(&t.k.db)
    .await
    .unwrap();
    assert!(!String::from_utf8_lossy(&sealed).contains("s3cret"), "encrypted");

    // update: a newer version keeps the state, the settings and the choices of the tenants
    tenants::set_enabled(&t, &manager, REVIEW, false).await.unwrap();
    install_review(&t, "0.2.0", "0.1.0").await.unwrap();
    assert_eq!(t.plugins.get(REVIEW).unwrap().manifest.version, "0.2.0");
    assert!(!tenants::is_on(&t, manager.tenant.tenant_id, REVIEW).await.unwrap());
    assert_eq!(config::config(&t, &admin, REVIEW, "en").await.unwrap().values["level"], "strict");

    // uninstall: what it takes away first, then the settings and the secrets with it
    crud::create(&t, &manager, NOTES, "notes", &obj(json!({ "title": "x" })), None).await.unwrap();
    let impact = plugins::uninstall_impact(&t, &admin, NOTES).await.unwrap();
    assert_eq!(
        (impact.items, impact.tenants, impact.extensions.clone()),
        (1, 1, vec!["Note review".to_string()])
    );
    plugins::uninstall(&t, &admin, REVIEW).await.unwrap();
    let secrets: i64 =
        mosaikit_db::query_scalar("select count(*) from core.secrets where name like 'plugin:%'")
            .fetch_one(&t.k.db)
            .await
            .unwrap();
    assert_eq!(secrets, 0);
    assert!(tenants::tenant_plugins(&t, &manager, "en").await.unwrap().iter().all(|p| p.id != REVIEW));
}

#[tokio::test]
async fn extension_tabs_need_the_ui_and_the_permission() {
    let t = start().await;
    t.install("notes").await;
    let manifest = format!(
        r#"
id = "com.example.note-tabs"
name = "Note tabs"
version = "0.1.0"
kind = "extension"
[contribution]
icon = "✔"
label = "Note tabs"
[extends]
plugin = "{NOTES}"
min_version = "0.1.0"
[ui]
entry = "index.html"
[[extension.tabs]]
resource = "notes"
key = "review"
label = "Review"
icon = "clipboard-check"
page = "tab.html"
[[extension.tabs]]
resource = "notes"
key = "plain"
label = "Plain"
[[extension.fields]]
resource = "notes"
key = "history"
label = "History"
kind = "text"
hidden = true
[i18n.it]
extension = {{ tabs = {{ review = "Revisione" }} }}
"#
    );
    let files = BTreeMap::from([
        ("plugin.toml".to_string(), manifest.into_bytes()),
        ("ui/index.html".to_string(), b"<!doctype html><title>x</title>".to_vec()),
        ("ui/tab.html".to_string(), b"<!doctype html><title>tab</title>".to_vec()),
    ]);
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    let p = plugins::install_package(&t, None, &pkg, InstallSource::Upload).await.unwrap();
    plugins::set_active(&t, None, &p.id, true).await.unwrap();
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;

    // only tabs and a hidden field: still an extension of the notes, with its tabs in the language of the person
    let views = extensions::for_resource(&t, &anna, NOTES, "notes", "it").await.unwrap();
    assert_eq!(views.len(), 1);
    let tabs = &views[0].tabs;
    assert_eq!(tabs.len(), 2);
    assert_eq!(
        (tabs[0].key.as_str(), tabs[0].label.as_str(), tabs[0].page.as_str()),
        ("review", "Revisione", "tab.html")
    );
    assert_eq!(tabs[0].icon.as_deref(), Some("clipboard-check"));
    assert_eq!(tabs[1].page, "index.html", "without a page: the entry of the UI");
    assert!(views[0].fields[0].hidden, "the hidden field is kept but not shown");

    // the hidden field keeps the data of the tab like any other value of the extension
    let row = crud::create(&t, &anna, NOTES, "notes", &obj(json!({ "title": "draft" })), None).await.unwrap();
    let id: uuid::Uuid = row["id"].as_str().unwrap().parse().unwrap();
    extensions::set_values(&t, &anna, NOTES, "notes", id, &p.id, &obj(json!({ "history": "[]" })))
        .await
        .unwrap();
    let v = extensions::values(&t, &anna, NOTES, "notes", &[id]).await.unwrap();
    assert_eq!(v[&id][&p.id]["history"], "[]");

    // the extension turned off in the tenant: no tab
    let manager = t.home(&g).await;
    tenants::set_enabled(&t, &manager, &p.id, false).await.unwrap();
    assert!(extensions::for_resource(&t, &anna, NOTES, "notes", "en").await.unwrap().is_empty());
}

#[tokio::test]
async fn uninstalling_an_extension_counts_its_values_and_installing_it_again_brings_back_the_choices() {
    let t = start().await;
    t.install("notes").await;
    install_review(&t, "0.1.0", "0.1.0").await.unwrap();
    let admin = t.admin().await;
    let ga = t.tenant("alfa").await;
    let gb = t.tenant("beta").await;
    let alfa = t.home(&ga).await;
    let beta = t.home(&gb).await;
    let note = crud::create(&t, &alfa, NOTES, "notes", &obj(json!({ "title": "x" })), None).await.unwrap();
    let id: uuid::Uuid = note["id"].as_str().unwrap().parse().unwrap();
    extensions::set_values(&t, &alfa, NOTES, "notes", id, REVIEW, &obj(json!({ "reviewer": "me" })))
        .await
        .unwrap();
    // on in both tenants, values in one: an extension has no items of its own
    let impact = plugins::uninstall_impact(&t, &admin, REVIEW).await.unwrap();
    assert_eq!((impact.items, impact.tenants), (1, 2));
    // beta turns it off, then the Administrator uninstalls it
    tenants::set_enabled(&t, &beta, REVIEW, false).await.unwrap();
    plugins::uninstall(&t, &admin, REVIEW).await.unwrap();
    assert!(t.plugins.get(REVIEW).is_none());
    // installed again (not turned on by hand): on in the platform as it was, on in alfa, off in beta
    let files = BTreeMap::from([("plugin.toml".to_string(), review_manifest("0.1.0", "0.1.0").into_bytes())]);
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    plugins::install_package(&t, None, &pkg, InstallSource::Upload).await.unwrap();
    assert_eq!(t.plugins.get(REVIEW).unwrap().status, plugins::Status::Active);
    assert!(tenants::is_on(&t, alfa.tenant.tenant_id, REVIEW).await.unwrap());
    assert!(!tenants::is_on(&t, beta.tenant.tenant_id, REVIEW).await.unwrap());
    // the memory is used once: an uninstall of a plugin never installed again leaves nothing behind
    let left: i64 = mosaikit_db::query_scalar("select count(*) from core.plugin_memory")
        .fetch_one(&t.k.db)
        .await
        .unwrap();
    assert_eq!(left, 0);
}
