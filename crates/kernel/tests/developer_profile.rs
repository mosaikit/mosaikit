//! The developer profile: strictly opt-in. With it on there is a tenant with known accounts and sample
//! content; with it off (the default) nothing of it exists and the signature rules stay as they are.

use mosaikit_kernel::devprofile::{self, PASSWORD, TENANT};
use mosaikit_kernel::notify::{self, Filter};
use mosaikit_kernel::testing::{plugins_root, start, start_with};
use mosaikit_kernel::{identity, plugins, Config};

#[test]
fn the_default_configuration_has_none_of_the_development_behaviours() {
    let c = Config::default();
    assert!(!c.developer_profile && !c.developer_profile_allow_remote);
    assert!(!c.allow_unsigned, "unsigned packages are refused by default");
    assert!(!c.dev.enabled, "no hot reload by default");
    assert!(c.admin_totp, "the second factor of the Administrator is on by default");
    assert!(!c.plugin_wildcard, "the plugin origin is the one of the configuration");
    assert!(c.initial_password.is_none());
    // an environment that asks for nothing changes nothing
    let mut c = Config::default();
    c.apply_env(std::iter::empty());
    c.derive().unwrap();
    assert!(!c.developer_profile && !c.allow_unsigned && !c.dev.enabled);
    // only the explicit setting turns it on, and it brings the development behaviours with it
    let mut c = Config::default();
    c.apply_env([("MOSAIKIT_DEVELOPER_PROFILE".to_string(), "1".to_string())].into_iter());
    c.derive().unwrap();
    assert!(c.developer_profile && c.allow_unsigned && c.dev.enabled && !c.admin_totp);
    assert!(c.plugin_wildcard && c.plugin_url.contains("*.localhost"), "{}", c.plugin_url);
    assert_eq!(c.initial_password.as_deref(), Some(PASSWORD));
}

#[test]
fn the_profile_refuses_a_machine_others_can_reach() {
    let on = |f: &dyn Fn(&mut Config)| {
        let mut c = Config { developer_profile: true, ..Config::default() };
        f(&mut c);
        c.derive()
    };
    assert!(on(&|_| {}).is_ok());
    // every interface
    let e = on(&|c| c.listen = Some("0.0.0.0:8080".into())).unwrap_err();
    assert!(e.message.contains("developer profile") && e.message.contains("0.0.0.0:8080"), "{e}");
    assert!(on(&|c| c.plugin_listen = Some("192.168.1.5:8081".into())).is_err());
    // a public address
    assert!(on(&|c| {
        c.url = "https://mosaikit.example.org".into();
        c.plugin_url_setting = Some("https://*.plugins.example.org".into());
    })
    .is_err());
    // a database that is not on this computer
    assert!(on(&|c| c.database.url = Some("postgres://u:p@db.example.org:5432/m".into())).is_err());
    assert!(on(&|c| c.database.url = Some("postgres://u:p@127.0.0.1:5432/m".into())).is_ok());
    // a reverse proxy
    assert!(on(&|c| c.trust_proxy = true).is_err());
    // the extra flag lets it through (the Docker kit)
    assert!(on(&|c| {
        c.listen = Some("0.0.0.0:8080".into());
        c.plugin_listen = Some("0.0.0.0:8081".into());
        c.database.url = Some("postgres://u:p@db:5432/m".into());
        c.developer_profile_allow_remote = true;
    })
    .is_ok());
    // without the profile the same addresses are the business of the deployer
    let mut c = Config { listen: Some("0.0.0.0:8080".into()), ..Config::default() };
    assert!(c.derive().is_ok());
}

#[tokio::test]
async fn a_default_start_has_no_test_tenant_no_test_users_and_no_switch() {
    let t = start().await;
    let tenants: i64 = mosaikit_db::query_scalar("select count(*) from core.tenants where not is_system")
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(tenants, 0, "no tenant, no sample content");
    assert!(!t.cfg.developer_profile && !t.cfg.allow_unsigned && !t.cfg.dev.enabled);
    // the switch of users and the reset are closed
    assert!(devprofile::session_for(&t, "alice", "test").await.is_err());
    assert!(devprofile::session_for(&t, "admin", "test").await.is_err());
    assert!(devprofile::reset_plugin(&t, "com.example.x").await.is_err());
    // a package without a signature is refused
    let unsigned = mosaikit_mskp::pack(
        &mosaikit_mskp::collect_plugin_dir(&plugins_root().join("notes"), None).unwrap(),
        None,
    )
    .unwrap();
    assert!(t.install_package(&unsigned).await.is_err(), "unsigned packages are refused");
    // the development password opens nothing
    assert!(identity::login(&t, TENANT, "alice", PASSWORD, "test").await.is_err());
}

#[tokio::test]
async fn the_profile_seeds_the_tenant_the_users_and_the_sample_content() {
    let src = tempfile::tempdir().unwrap();
    let dir = src.path().join("notes");
    std::fs::create_dir_all(dir.join("migrations")).unwrap();
    std::fs::copy(plugins_root().join("notes/plugin.toml"), dir.join("plugin.toml")).unwrap();
    std::fs::copy(plugins_root().join("notes/migrations/001_kpi.sql"), dir.join("migrations/001_kpi.sql"))
        .unwrap();
    let d2 = dir.clone();
    let t = start_with(move |c| {
        c.developer_profile = true;
        c.dev.plugins = vec![d2];
    })
    .await;
    assert!(t.cfg.allow_unsigned && t.cfg.dev.enabled);
    // the four accounts, with the documented password
    for (tenant, user) in [(TENANT, "manager"), (TENANT, "alice"), (TENANT, "bob")] {
        identity::login(&t, tenant, user, PASSWORD, "test").await.unwrap_or_else(|e| panic!("{user}: {e}"));
    }
    let s = devprofile::session_for(&t, "bob", "test").await.unwrap();
    assert_eq!(s.user.username, "bob");
    assert!(devprofile::session_for(&t, "mallory", "test").await.is_err(), "only the four test users");
    // notifications, the group, the Log and the item shared with Bob
    let page = notify::list(&t, &s.user, &Filter::default()).await.unwrap();
    assert!(page.items.len() >= 2, "welcome + share: {}", page.items.len());
    let groups: i64 = mosaikit_db::query_scalar("select count(*) from core.groups where name = 'Developers'")
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(groups, 1);
    let events: i64 = mosaikit_db::query_scalar("select count(*) from core.events where action = 'dev.seed'")
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(events, 1);
    // the plugin folder is loaded as a development plugin
    assert!(t.plugins.active("com.mosaikit.notes").unwrap().dev);
    // the seed is made once
    devprofile::seed(&t).await.unwrap();
    let again: i64 = mosaikit_db::query_scalar("select count(*) from core.groups where name = 'Developers'")
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(again, 1);
}

#[tokio::test]
async fn the_profile_refuses_a_database_with_real_tenants() {
    let t = start().await;
    t.tenant("acme").await;
    let e = devprofile::seed(&t).await.unwrap_err();
    assert!(e.message.contains("real data"), "{e}");
}

#[tokio::test]
async fn the_reset_deletes_the_data_of_a_plugin_and_runs_its_migrations_again() {
    let src = tempfile::tempdir().unwrap();
    let dir = src.path().join("notes");
    std::fs::create_dir_all(dir.join("migrations")).unwrap();
    std::fs::copy(plugins_root().join("notes/plugin.toml"), dir.join("plugin.toml")).unwrap();
    std::fs::copy(plugins_root().join("notes/migrations/001_kpi.sql"), dir.join("migrations/001_kpi.sql"))
        .unwrap();
    let d2 = dir.clone();
    let t = start_with(move |c| {
        c.developer_profile = true;
        c.dev.plugins = vec![d2];
    })
    .await;
    // a migration changed after it ran: the reload refuses, the reset (the confirmation of the shell) fixes it
    let mut changed = std::fs::read_to_string(dir.join("migrations/001_kpi.sql")).unwrap();
    changed.push_str("\n-- changed\n");
    std::fs::write(dir.join("migrations/001_kpi.sql"), changed).unwrap();
    let e = plugins::dev::load_one(&t, &dir).await.unwrap_err();
    assert!(e.message.contains("already applied and then changed"), "{e}");
    devprofile::reset_plugin(&t, "com.mosaikit.notes").await.unwrap();
    assert!(t.plugins.active("com.mosaikit.notes").unwrap().dev);
    // a plugin that is not loaded from a folder cannot be reset
    assert!(devprofile::reset_plugin(&t, "com.example.none").await.is_err());
}
