//! Settings on three levels: platform and tenant values, limits enforced by the kernel, locks,
//! identity images, keys of outside services encrypted at rest.

use mosaikit_kernel::identity::{admin_login, change_password, login, login_remembered, AdminLogin};
use mosaikit_kernel::plugins::{self, InstallSource};
use mosaikit_kernel::tenancy::keys::{self, key_in_use, Level};
use mosaikit_kernel::tenancy::levels::{
    self, effective, platform_settings, set_platform, set_tenant, tenant_settings, Who,
};
use mosaikit_kernel::tenancy::{login_tenants, set_tenant_theme, tenant_theme};
use mosaikit_kernel::testing::{start, test_key, TestKernel, PASSWORD};
use mosaikit_kernel::Kind;
use serde_json::{json, Map, Value};

fn map(v: Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap()
}

fn get<'a>(l: &'a [levels::Setting], key: &str) -> &'a levels::Setting {
    l.iter().find(|s| s.key == key).unwrap()
}

#[tokio::test]
async fn platform_and_tenant_values() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let alfa = manager.tenant.tenant_id;

    // defaults
    let p = platform_settings(&t).await.unwrap();
    assert_eq!(get(&p, "security.password_min").value, json!(10));
    assert_eq!(get(&p, "lang.enabled").value, json!(["en", "it"]));
    assert_eq!(get(&p, "security.password_min").source, "default");

    // only the Administrator changes the platform, with valid values
    let v = map(json!({ "security.password_min": 12, "identity.footer": "© Platform" }));
    assert_eq!(set_platform(&t, &g, &v, &Map::new()).await.unwrap_err().kind, Kind::Forbidden);
    let wrong = map(json!({ "security.password_min": 6 }));
    assert_eq!(set_platform(&t, &admin, &wrong, &Map::new()).await.unwrap_err().code(), "setting_invalid");
    set_platform(&t, &admin, &v, &Map::new()).await.unwrap();

    // the tenant inherits, and may only be stricter
    let l = tenant_settings(&t, alfa).await.unwrap();
    assert_eq!(get(&l, "security.password_min").value, json!(12));
    assert_eq!(get(&l, "identity.footer").value, json!("© Platform"));
    let weaker = map(json!({ "security.password_min": 11 }));
    assert_eq!(set_tenant(&t, &manager, &weaker).await.unwrap_err().code(), "setting_beyond_platform");
    let langs = map(json!({ "lang.enabled": ["it", "fr"] }));
    assert!(set_tenant(&t, &manager, &langs).await.is_err());
    // people of the tenant do not change its settings
    let own =
        map(json!({ "security.password_min": 14, "identity.footer": "© Alfa", "lang.enabled": ["it"] }));
    assert_eq!(set_tenant(&t, &anna, &own).await.unwrap_err().kind, Kind::Forbidden);
    let l = set_tenant(&t, &manager, &own).await.unwrap();
    assert_eq!(get(&l, "security.password_min").value, json!(14));
    assert_eq!(get(&l, "identity.footer").source, "tenant");
    assert_eq!(get(&l, "lang.enabled").value, json!(["it"]));
    // managed by the platform: never from the tenant
    let band = map(json!({ "band": { "logo": false } }));
    assert_eq!(set_tenant(&t, &manager, &band).await.unwrap_err().code(), "setting_locked");

    // the platform becomes stricter than the tenant: the stricter value is in use
    set_platform(&t, &admin, &map(json!({ "security.password_min": 16 })), &Map::new()).await.unwrap();
    let v = effective(&t, Some(alfa)).await.unwrap();
    assert_eq!(v["security.password_min"], json!(16));

    // back to the platform's value
    let back = map(json!({ "identity.footer": null }));
    let l = set_tenant(&t, &manager, &back).await.unwrap();
    assert_eq!(get(&l, "identity.footer").value, json!("© Platform"));
    assert_eq!(get(&l, "identity.footer").source, "platform");
}

#[tokio::test]
async fn tenants_may_customize_it_switch() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let alfa = manager.tenant.tenant_id;
    set_tenant_theme(&t, &manager, Some("tessera")).await.unwrap();
    set_tenant(&t, &manager, &map(json!({ "identity.welcome": "Welcome to Alfa" }))).await.unwrap();

    // off: the tenant uses the platform values and cannot change them
    let off = map(json!({ "theme": false, "identity.welcome": false }));
    set_platform(&t, &admin, &Map::new(), &off).await.unwrap();
    let l = tenant_settings(&t, alfa).await.unwrap();
    assert!(get(&l, "theme").locked && get(&l, "identity.welcome").locked);
    assert_eq!(get(&l, "identity.welcome").value, json!(""));
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "mosaikit");
    assert_eq!(set_tenant_theme(&t, &manager, Some("italia")).await.unwrap_err().code(), "setting_locked");
    let w = map(json!({ "identity.welcome": "x" }));
    assert_eq!(set_tenant(&t, &manager, &w).await.unwrap_err().code(), "setting_locked");
    // only customizable settings have the switch
    let bad = map(json!({ "security.password_min": false }));
    assert!(set_platform(&t, &admin, &Map::new(), &bad).await.is_err());

    // on again: the value of the tenant comes back
    set_platform(&t, &admin, &Map::new(), &map(json!({ "theme": true, "identity.welcome": true })))
        .await
        .unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "tessera");
    let l = tenant_settings(&t, alfa).await.unwrap();
    assert_eq!(get(&l, "identity.welcome").value, json!("Welcome to Alfa"));
}

#[tokio::test]
async fn password_rules_and_sign_in_lock_follow_the_settings() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let anna = t.member(&g, "anna").await;

    // a password of 13 characters, with a minimum of 14 in the tenant
    set_tenant(&t, &manager, &map(json!({ "security.password_min": 14 }))).await.unwrap();
    let e = change_password(&t, &anna, PASSWORD, "thirteen-char").await.unwrap_err();
    assert_eq!(e.code(), "password_too_short");
    assert!(e.message.contains("14"), "{}", e.message);
    change_password(&t, &anna, PASSWORD, "fourteen-chars").await.unwrap();
    let c = t.home(&g).await;
    let e = mosaikit_kernel::tenancy::create_member(
        &t,
        &c,
        "bruno",
        "Bruno",
        "short-pass-1",
        mosaikit_kernel::Role::User,
    )
    .await
    .unwrap_err();
    assert_eq!(e.code(), "password_too_short");
    // the Administrators follow the platform (10)
    mosaikit_kernel::tenancy::create_administrator(&t, &admin, "second", "Second", "ten-chars!")
        .await
        .unwrap();

    // 3 attempts lock the accounts of the tenant
    set_tenant(&t, &manager, &map(json!({ "security.lock_attempts": 3 }))).await.unwrap();
    for _ in 0..3 {
        let e = login(&t, "alfa", "anna", "wrong-password", "10.0.0.1").await.unwrap_err();
        assert_eq!(e.code(), "wrong_credentials");
    }
    let e = login(&t, "alfa", "anna", "fourteen-chars", "10.0.0.2").await.unwrap_err();
    assert_eq!(e.code(), "too_many_attempts");
    // the Administrators keep the limit of the platform
    assert!(
        matches!(admin_login(&t, "admin", "wrong", "10.0.0.3").await, Err(e) if e.code() == "wrong_credentials")
    );
    assert!(admin_login(&t, "second", "ten-chars!", "10.0.0.3").await.is_ok());
}

#[tokio::test]
async fn session_length_and_remember_me() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    t.member(&g, "anna").await;
    set_tenant(&t, &manager, &map(json!({ "security.session_hours": 2, "security.remember_days": 7 })))
        .await
        .unwrap();
    let r = login(&t, "alfa", "anna", PASSWORD, "x").await.unwrap();
    assert_eq!(r.max_age, 2 * 3600);
    let r = login_remembered(&t, "alfa", "anna", PASSWORD, "x", true).await.unwrap();
    assert_eq!(r.max_age, 7 * 24 * 3600);
    // without "remember me" in the tenant the session lasts its hours
    set_tenant(&t, &manager, &map(json!({ "security.remember_days": 0 }))).await.unwrap();
    let r = login_remembered(&t, "alfa", "anna", PASSWORD, "x", true).await.unwrap();
    assert_eq!(r.max_age, 2 * 3600);
    let list = login_tenants(&t).await.unwrap();
    assert!(!list[0].remember);
}

#[tokio::test]
async fn identity_images_and_sign_in_page() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let svg =
        b"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><rect width='10' height='10'/></svg>";

    levels::set_image(&t, Who::Tenant(&manager), "logo_light", svg).await.unwrap();
    assert_eq!(
        levels::set_image(&t, Who::Tenant(&anna), "logo_light", svg).await.unwrap_err().kind,
        Kind::Forbidden
    );
    let bad = b"<svg onload='alert(1)'></svg>";
    let e = levels::set_image(&t, Who::Tenant(&manager), "logo_dark", bad).await.unwrap_err();
    assert_eq!(e.code(), "image_unsafe");
    // the browser icon belongs to the platform
    assert!(levels::set_image(&t, Who::Tenant(&manager), "icon", svg).await.is_err());
    levels::set_image(&t, Who::Platform(&admin), "icon", svg).await.unwrap();

    let alfa = manager.tenant.tenant_id;
    let (data, mime) = levels::image(&t, Some(alfa), "logo_light").await.unwrap().unwrap();
    assert_eq!((data.as_slice(), mime.as_str()), (&svg[..], "image/svg+xml"));
    assert!(levels::image(&t, None, "icon").await.unwrap().is_some());

    set_tenant(
        &t,
        &manager,
        &map(json!({ "identity.name": "Comune di Alfa", "identity.welcome": "Benvenuti" })),
    )
    .await
    .unwrap();
    let list = login_tenants(&t).await.unwrap();
    let alfa_page = list.iter().find(|x| x.slug == "alfa").unwrap();
    assert_eq!(alfa_page.name, "Comune di Alfa");
    assert_eq!(alfa_page.welcome, "Benvenuti");
    assert!(alfa_page.logo_light && !alfa_page.logo_dark);

    levels::remove_image(&t, Who::Tenant(&manager), "logo_light").await.unwrap();
    assert!(levels::image(&t, Some(alfa), "logo_light").await.unwrap().is_none());
}

/// A plugin without logic that only declares keys of outside services.
async fn install_key_plugin(t: &TestKernel, id: &str, keys: &str) {
    let manifest = format!(
        "id = \"{id}\"\nname = \"Keys\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"K\"\nlabel = \"{id}\"\n{keys}"
    );
    let files = std::collections::BTreeMap::from([("plugin.toml".to_string(), manifest.into_bytes())]);
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    let p = plugins::install_package(t, None, &pkg, InstallSource::Upload).await.unwrap();
    plugins::set_active(t, None, &p.id, true).await.unwrap();
}

#[tokio::test]
async fn keys_of_outside_services() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let alfa = manager.tenant.tenant_id;

    // no plugin declares the service: no key for it, and the pages list nothing
    let err =
        keys::set_key(&t, admin.user_id, Level::Platform, "translate", Some("pk-1"), None).await.unwrap_err();
    assert_eq!(err.kind, Kind::NotFound);
    assert!(keys::platform_keys(&t, &admin, "en").await.unwrap().is_empty());

    // the plugins declare the services: two plugins share "translate", the scopes add up
    install_key_plugin(
        &t,
        "com.example.translator",
        "[[service_keys]]\nid = \"translate\"\nlabel = \"Translation service\"\nscopes = [\"platform\", \"tenant\"]\n\
         [[service_keys]]\nid = \"ai-local\"\nlabel = \"Self-hosted model\"\naddress = true\nscopes = [\"platform\"]\n\
         [i18n.it]\nservice_keys = { translate = { label = \"Servizio di traduzione\" } }\n",
    )
    .await;
    install_key_plugin(
        &t,
        "com.example.voice",
        "[[service_keys]]\nid = \"translate\"\nlabel = \"Translator\"\nscopes = [\"personal\"]\n",
    )
    .await;
    let services = keys::services(&t, "it");
    let tr = services.iter().find(|s| s.id == "translate").unwrap();
    assert_eq!(
        tr.label, "Servizio di traduzione",
        "the first plugin (in the order of the ids) gives the texts"
    );
    assert_eq!(tr.plugins.len(), 2);
    assert_eq!(tr.scopes.len(), 3);
    // a scope nobody declares is refused
    let me = Level::User(anna.user.user_id);
    let err = keys::set_key(&t, anna.user.user_id, me, "ai-local", Some("http://x"), None).await.unwrap_err();
    assert_eq!(err.kind, Kind::NotFound);

    // the platform's key, not shared: nobody in the tenant uses it
    keys::set_key(&t, admin.user_id, Level::Platform, "translate", Some("pk-platform-1234"), Some(false))
        .await
        .unwrap();
    assert_eq!(key_in_use(&t, &anna, "translate").await.unwrap(), None);
    keys::set_key(&t, admin.user_id, Level::Platform, "translate", None, Some(true)).await.unwrap();
    assert_eq!(key_in_use(&t, &anna, "translate").await.unwrap().as_deref(), Some("pk-platform-1234"));

    // the tenant's key, not shared: only the Tenant Managers
    keys::set_key(&t, manager.user.user_id, Level::Tenant(alfa), "translate", Some("tk-alfa-5678"), None)
        .await
        .unwrap();
    assert_eq!(key_in_use(&t, &manager, "translate").await.unwrap().as_deref(), Some("tk-alfa-5678"));
    assert_eq!(key_in_use(&t, &anna, "translate").await.unwrap().as_deref(), Some("pk-platform-1234"));

    // a personal key wins, and is never shared
    keys::set_key(&t, anna.user.user_id, me, "translate", Some("my-key-9999"), None).await.unwrap();
    assert_eq!(key_in_use(&t, &anna, "translate").await.unwrap().as_deref(), Some("my-key-9999"));
    assert!(keys::set_key(&t, anna.user.user_id, me, "translate", None, Some(true)).await.is_err());

    // the pages see only the last four characters, which key is in use and the plugins using it
    let mine = keys::my_keys(&t, &anna, "en").await.unwrap();
    assert_eq!(mine.len(), 1, "only the services with the personal scope: {mine:?}");
    let tr = &mine[0];
    assert_eq!((tr.hint.as_deref(), tr.in_use, tr.declared), (Some("9999"), "own", true));
    let json = serde_json::to_string(&mine).unwrap();
    assert!(!json.contains("my-key"), "{json}");
    let tenant = keys::tenant_keys(&t, &manager, "en").await.unwrap();
    assert_eq!(tenant.iter().find(|k| k.service == "translate").unwrap().hint.as_deref(), Some("5678"));
    assert!(tenant.iter().all(|k| k.service != "ai-local"), "platform only");
    assert_eq!(keys::tenant_keys(&t, &anna, "en").await.unwrap_err().kind, Kind::Forbidden);

    // encrypted in the database
    let raw: Vec<u8> = mosaikit_db::query_scalar("select secret from core.service_keys where hint = '9999'")
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert!(!String::from_utf8_lossy(&raw).contains("my-key-9999"));

    // the address of a self-hosted model shows whole
    keys::set_key(&t, admin.user_id, Level::Platform, "ai-local", Some("not an address"), None)
        .await
        .unwrap_err();
    keys::set_key(&t, admin.user_id, Level::Platform, "ai-local", Some("http://llm.internal:11434"), None)
        .await
        .unwrap();
    let p = keys::platform_keys(&t, &admin, "en").await.unwrap();
    assert_eq!(
        p.iter().find(|k| k.service == "ai-local").unwrap().hint.as_deref(),
        Some("http://llm.internal:11434")
    );

    keys::remove_key(&t, anna.user.user_id, me, "translate").await.unwrap();
    assert_eq!(key_in_use(&t, &anna, "translate").await.unwrap().as_deref(), Some("pk-platform-1234"));

    // a key whose service no installed plugin declares any more: shown as not used, removable
    mosaikit_db::query(
        "insert into core.service_keys (scope, tenant_id, user_id, service, secret, hint, shared, updated_by)
         values ('platform', null, null, 'sms', $1, '0000', false, $2)",
    )
    .bind(vec![0u8; 4])
    .bind(admin.user_id)
    .execute(&t.db)
    .await
    .unwrap();
    let p = keys::platform_keys(&t, &admin, "en").await.unwrap();
    let sms = p.iter().find(|k| k.service == "sms").unwrap();
    assert!(!sms.declared && sms.set && sms.plugins.is_empty());
    assert!(keys::set_key(&t, admin.user_id, Level::Platform, "sms", Some("x"), None).await.is_err());
    assert_eq!(key_in_use(&t, &anna, "sms").await.unwrap_err().kind, Kind::NotFound);
    keys::remove_key(&t, admin.user_id, Level::Platform, "sms").await.unwrap();
    assert!(keys::platform_keys(&t, &admin, "en").await.unwrap().iter().all(|k| k.service != "sms"));
}

#[tokio::test]
async fn admin_session_follows_the_platform() {
    let t = start().await;
    let admin = t.admin().await;
    set_platform(&t, &admin, &map(json!({ "security.session_hours": 3 })), &Map::new()).await.unwrap();
    match admin_login(&t, "admin", mosaikit_kernel::testing::ADMIN_PASSWORD, "x").await.unwrap() {
        AdminLogin::Done(r) => assert_eq!(r.max_age, 3 * 3600),
        other => panic!("{other:?}"),
    }
}
