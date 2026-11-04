//! What a distribution sets in `distribution.toml` (dev kit, phase 11): defaults, locked settings, the first
//! start. The unit tests of `product.rs` cover the checks of the file; here the kernel starts with one.

use mosaikit_kernel::tenancy::levels::{self, platform_settings, set_platform, set_tenant, tenant_settings};
use mosaikit_kernel::testing::start_with;
use serde_json::{json, Map, Value};

fn map(v: Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap()
}

fn get<'a>(l: &'a [levels::Setting], key: &str) -> &'a levels::Setting {
    l.iter().find(|s| s.key == key).unwrap()
}

fn seed_file(text: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("distribution.toml");
    std::fs::write(&path, text).unwrap();
    (dir, path)
}

#[tokio::test]
async fn defaults_and_locked_settings_of_a_product() {
    let (_dir, file) = seed_file(
        "[product]\nid = \"x\"\nname = \"X\"\nversion = \"1.0.0\"\nbase = \">=1.0, <2\"\n\
         [defaults]\n\"identity.welcome\" = \"Hello from the product\"\n\"security.password_min\" = 12\n\
         [locked]\nkeys = [\"identity.footer\"]\n\
         [languages]\nenabled = [\"it\", \"en\"]\ndefault = \"it\"\n",
    );
    let t = start_with(|c| c.plugin_settings_file = Some(file.clone())).await;
    let admin = t.admin().await;
    let p = platform_settings(&t).await.unwrap();
    // the values of the product are the defaults
    assert_eq!(get(&p, "identity.welcome").value, json!("Hello from the product"));
    assert_eq!(get(&p, "identity.welcome").source, "default");
    assert_eq!(get(&p, "security.password_min").value, json!(12));
    assert_eq!(get(&p, "lang.default").value, json!("it"));
    assert_eq!(get(&p, "lang.enabled").value, json!(["it", "en"]));
    // a setting that is not locked can still be changed by the Administrator
    let v = map(json!({ "identity.welcome": "Changed" }));
    set_platform(&t, &admin, &v, &Map::new()).await.unwrap();
    assert_eq!(get(&platform_settings(&t).await.unwrap(), "identity.welcome").value, json!("Changed"));
    // a locked one cannot, and says so
    assert!(get(&p, "identity.footer").locked);
    let v = map(json!({ "identity.footer": "© me" }));
    let e = set_platform(&t, &admin, &v, &Map::new()).await.unwrap_err();
    assert_eq!(e.code(), "setting_locked", "{e}");
    // nor can a tenant
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let l = tenant_settings(&t, manager.tenant.tenant_id).await.unwrap();
    assert!(get(&l, "identity.footer").locked);
    let e = set_tenant(&t, &manager, &map(json!({ "identity.footer": "© alfa" }))).await.unwrap_err();
    assert_eq!(e.code(), "setting_locked", "{e}");
}

#[tokio::test]
async fn the_first_tenant_of_a_product() {
    let (_dir, file) = seed_file(
        "[product]\nid = \"x\"\nname = \"X\"\nversion = \"1.0.0\"\n\
         [bootstrap]\ntenant = \"work\"\ntenant_name = \"Work Co\"\ntrial_days = 30\nadmin_email = \"ops@example.com\"\n",
    );
    let t = start_with(|c| c.plugin_settings_file = Some(file.clone())).await;
    let q = |col: &str| format!("select {col} from core.tenants where not is_system");
    let slug: String = mosaikit_db::query_scalar(q("slug").as_str()).fetch_one(&t.db).await.unwrap();
    let name: String = mosaikit_db::query_scalar(q("name").as_str()).fetch_one(&t.db).await.unwrap();
    let trial: bool =
        mosaikit_db::query_scalar(q("trial_until is not null").as_str()).fetch_one(&t.db).await.unwrap();
    assert_eq!((slug.as_str(), name.as_str(), trial), ("work", "Work Co", true));
    let email: Option<String> = mosaikit_db::query_scalar(
        "select email from core.users where username = 'admin' and is_system_admin",
    )
    .fetch_one(&t.db)
    .await
    .unwrap();
    assert_eq!(email.as_deref(), Some("ops@example.com"));
}

#[tokio::test]
async fn a_base_outside_the_range_of_the_product_does_not_start() {
    let (_dir, file) =
        seed_file("[product]\nid = \"x\"\nname = \"X\"\nversion = \"1.0.0\"\nbase = \">=99.0\"\n");
    let cfg =
        mosaikit_kernel::Config { plugin_settings_file: Some(file), ..mosaikit_kernel::Config::default() };
    let e = mosaikit_kernel::product::ProductPolicy::load(&cfg).unwrap_err();
    assert_eq!(e.code(), "product_base", "{e}");
    assert!(e.message.contains(">=99.0"), "{e}");
}
