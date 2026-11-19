//! Settings of a tenant (`[[config]] scope = "tenant"`): each tenant has its own values, the Tenant Manager (or the
//! holder of the permission the setting names) writes them, a secret is never given back, the logic receives them,
//! and the Log keeps the keys.

use std::collections::BTreeMap;

use mosaikit_kernel::plugins::{self, config, InstallSource};
use mosaikit_kernel::testing::{start, test_key};
use mosaikit_kernel::Kind;
use serde_json::{json, Value};

const PLUGIN: &str = "com.example.catalog";

const MANIFEST: &str = r#"
id = "com.example.catalog"
name = "Catalog"
version = "0.1.0"
icon = "book"
[contribution]
icon = "C"
label = "Catalog"
[[user_permissions]]
key = "curate"
label = "Curate"
default = true
[[user_permissions]]
key = "audit"
label = "Audit"
default = false
[[config]]
key = "title"
label = "Title"
kind = "text"
default = "Public catalog"
scope = "tenant"
edit = "curate"
[[config]]
key = "feed"
label = "Feed key"
kind = "secret"
scope = "tenant"
[[config]]
key = "level"
label = "Level"
kind = "choice"
options = ["light", "strict"]
default = "light"
"#;

fn change(v: Value) -> config::ConfigChange {
    serde_json::from_value(v).unwrap()
}

#[tokio::test]
async fn each_tenant_has_its_own_settings() {
    let t = start().await;
    let files = BTreeMap::from([("plugin.toml".to_string(), MANIFEST.as_bytes().to_vec())]);
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    let p = plugins::install_package(&t, None, &pkg, InstallSource::Upload).await.unwrap();
    plugins::set_active(&t, None, &p.id, true).await.unwrap();
    let admin = t.admin().await;
    let alfa = t.tenant("alfa").await;
    let beta = t.tenant("beta").await;
    let (ma, mb) = (t.home(&alfa).await, t.home(&beta).await);
    let anna = t.member(&alfa, "anna").await;
    let anna = t.home(&anna).await;

    // the Administrator's page of the platform shows only the platform setting
    let platform = config::config(&t, &admin, PLUGIN, "en").await.unwrap();
    assert_eq!(platform.decls.iter().map(|d| d.key.as_str()).collect::<Vec<_>>(), ["level"]);
    assert!(config::set_config(&t, &admin, PLUGIN, &change(json!({ "values": { "title": "x" } })))
        .await
        .is_err());

    // a Tenant Manager sees both of the tenant, with the default where none is chosen; a secret is not set
    let v = config::tenant_config(&t, &ma, PLUGIN, "en").await.unwrap();
    assert_eq!(v.decls.iter().map(|d| d.key.as_str()).collect::<Vec<_>>(), ["title", "feed"]);
    assert_eq!(v.values["title"], "Public catalog");
    assert!(v.secrets.is_empty());

    // checked against the kind; an unknown key or a platform one is refused
    assert!(config::set_tenant_config(&t, &ma, PLUGIN, &change(json!({ "values": { "title": 4 } })))
        .await
        .is_err());
    assert!(config::set_tenant_config(&t, &ma, PLUGIN, &change(json!({ "values": { "level": "strict" } })))
        .await
        .is_err());
    let v = config::set_tenant_config(
        &t,
        &ma,
        PLUGIN,
        &change(json!({ "values": { "title": "Alfa" }, "secrets": { "feed": "s3cret" } })),
    )
    .await
    .unwrap();
    assert_eq!((v.values["title"].clone(), v.secrets.clone()), (json!("Alfa"), vec!["feed".to_string()]));
    assert!(!serde_json::to_string(&v).unwrap().contains("s3cret"));

    // the other tenant keeps its own; the logic of each receives its own (and the platform one)
    assert_eq!(config::tenant_config(&t, &mb, PLUGIN, "en").await.unwrap().values["title"], "Public catalog");
    let own = config::tenant_for_logic(&t, PLUGIN, ma.tenant.tenant_id).await.unwrap();
    assert_eq!((own["title"].clone(), own["feed"].clone()), (json!("Alfa"), json!("s3cret")));
    let other = config::tenant_for_logic(&t, PLUGIN, mb.tenant.tenant_id).await.unwrap();
    assert_eq!((other["title"].clone(), other["feed"].clone()), (json!("Public catalog"), Value::Null));
    assert!(!config::for_logic(&t, PLUGIN).await.unwrap().to_string().contains("Alfa"));

    // sealed in the database
    let sealed: Vec<u8> = mosaikit_db::query_scalar("select value from core.secrets where name like $1")
        .bind(format!("plugin:{PLUGIN}:t:{}:feed", ma.tenant.tenant_id))
        .fetch_one(&t.k.db)
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&sealed).contains("s3cret"));

    // a member holds the permission `curate` (the default of the profile): the setting that names it, not the other
    let v = config::tenant_config(&t, &anna, PLUGIN, "en").await.unwrap();
    assert_eq!(v.decls.iter().map(|d| d.key.as_str()).collect::<Vec<_>>(), ["title"]);
    config::set_tenant_config(&t, &anna, PLUGIN, &change(json!({ "values": { "title": "By Anna" } })))
        .await
        .unwrap();
    let err = config::set_tenant_config(&t, &anna, PLUGIN, &change(json!({ "secrets": { "feed": "x" } })))
        .await
        .unwrap_err();
    assert_eq!(err.kind, Kind::Forbidden);

    // `null` goes back to the default, and a secret `null` is removed
    let v = config::set_tenant_config(
        &t,
        &ma,
        PLUGIN,
        &change(json!({ "values": { "title": null }, "secrets": { "feed": null } })),
    )
    .await
    .unwrap();
    assert_eq!((v.values["title"].clone(), v.secrets.len()), (json!("Public catalog"), 0));

    // the Log has who and which keys, never the value
    let rows: Vec<Value> =
        mosaikit_db::query_scalar("select detail from core.events where action = 'plugin.setting'")
            .fetch_all(&t.k.db)
            .await
            .unwrap();
    assert_eq!(rows.len(), 3);
    assert!(!Value::Array(rows).to_string().contains("s3cret"));
}
