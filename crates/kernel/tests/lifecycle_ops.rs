//! Lifecycle of the tenants (trial, archive, deletion, export and import) and operations of the platform
//! (backups, maintenance mode, metrics and alerts).

use chrono::{Duration, Utc};
use mosaikit_kernel::ops::{backup, maintenance, metrics, monitor};
use mosaikit_kernel::tenancy::{lifecycle, list_tenants, set_tenant_status};
use mosaikit_kernel::testing::{start, TestKernel, PASSWORD};
use mosaikit_kernel::transfer::{self, ImportOptions};
use mosaikit_kernel::{crud, files, identity, Caller, Kind};
use serde_json::json;
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";
const FILES: &str = "com.mosaikit.files";

async fn note(t: &TestKernel, c: &Caller, title: &str) -> Uuid {
    let row = crud::create(t, c, NOTES, "notes", json!({ "title": title }).as_object().unwrap(), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn titles(t: &TestKernel, c: &Caller) -> Vec<String> {
    let mut v: Vec<String> = crud::list(t, c, NOTES, "notes", None, None)
        .await
        .unwrap()
        .rows
        .iter()
        .map(|r| r["values"]["title"].as_str().unwrap().to_string())
        .collect();
    v.sort();
    v
}

async fn tenant_id(t: &TestKernel, slug: &str) -> Uuid {
    mosaikit_db::query_scalar("select id from core.tenants where slug = $1")
        .bind(slug)
        .fetch_one(&t.db)
        .await
        .unwrap()
}

async fn notifications(t: &TestKernel, user: Uuid, code: &str) -> i64 {
    let all: Vec<serde_json::Value> =
        mosaikit_db::query_scalar("select data from core.notifications where user_id = $1")
            .bind(user)
            .fetch_all(&t.db)
            .await
            .unwrap();
    all.iter().filter(|d| d["code"] == code).count() as i64
}

#[tokio::test]
async fn export_delete_and_import_a_tenant() {
    let t = start().await;
    t.install("notes").await;
    t.install("files").await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let mgr = t.home(&g).await;
    let anna_c = t.home(&anna).await;
    note(&t, &mgr, "Budget").await;
    note(&t, &anna_c, "Minutes").await;
    let doc = files::upload(&t, &anna_c, FILES, None, "report.txt", b"hello", false).await.unwrap();
    let alfa = tenant_id(&t, "alfa").await;
    // a person of alfa owns an item as a guest of beta
    let gb = t.tenant("beta").await;
    let beta = t.home(&gb).await;
    mosaikit_db::query("insert into core.memberships (tenant_id, user_id, role) values ($1, $2, 'user')")
        .bind(beta.tenant.tenant_id)
        .bind(anna.user_id)
        .execute(&t.db)
        .await
        .unwrap();
    let anna_in_beta = t.caller(&anna, "beta").await;
    let guest_note = note(&t, &anna_in_beta, "Guest note").await;

    let imp = lifecycle::impact(&t, &admin, alfa).await.unwrap();
    assert_eq!((imp.people, imp.items, imp.items_elsewhere), (2, 3, 1));
    // what follows the people and the tenant: high contrast, a theme made for the tenant, the search
    mosaikit_kernel::personal::change(
        &t,
        anna.user_id,
        &mosaikit_kernel::personal::PrefsChange { contrast: Some(true), ..Default::default() },
    )
    .await
    .unwrap();
    let vars: std::collections::BTreeMap<String, String> = [
        ("--background", "#ffffff"),
        ("--foreground", "#242424"),
        ("--primary", "#1f6f5c"),
        ("--primary-foreground", "#ffffff"),
        ("--band", "#174f42"),
        ("--band-foreground", "#ffffff"),
    ]
    .into_iter()
    .map(|(a, b)| (a.to_string(), b.to_string()))
    .collect();
    let theme = mosaikit_kernel::tenancy::themes::save_tenant(
        &t,
        &mgr,
        &mosaikit_kernel::tenancy::themes::ThemeInput {
            id: None,
            name: "Ours".into(),
            input: serde_json::Value::Null,
            light: vars.clone(),
            dark: vars,
        },
    )
    .await
    .unwrap();
    mosaikit_kernel::tenancy::set_tenant_theme(&t, &mgr, Some(&theme.id)).await.unwrap();

    let (path, m) = transfer::export_tenant(&t, &admin, alfa).await.unwrap();
    assert!(path.is_file());
    assert_eq!(m.tenant.slug, "alfa");
    // Files keeps its items as resources and contents only: no tables of its own
    assert!(m.plugins.contains_key(NOTES), "{:?}", m.plugins);
    assert_eq!(m.counts["core/users"], 2);

    // deletion: typed confirmation, never the system tenant, guest items to the manager of beta
    assert_eq!(
        lifecycle::delete(&t, &admin, alfa, "alfa-wrong").await.unwrap_err().code(),
        "confirm_mismatch"
    );
    assert_eq!(lifecycle::delete(&t, &g, alfa, "alfa").await.unwrap_err().kind, Kind::Forbidden);
    let system: Uuid = mosaikit_db::query_scalar("select id from core.tenants where is_system")
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert!(lifecycle::delete(&t, &admin, system, "system").await.is_err());
    lifecycle::delete(&t, &admin, alfa, "alfa").await.unwrap();
    assert!(list_tenants(&t, &admin).await.unwrap().iter().all(|x| x.slug != "alfa"));
    assert!(!t.blobs.file_path(alfa, doc.id).exists(), "contents removed");
    let owner: Uuid = mosaikit_db::query_scalar("select owner_id from core.resources where id = $1")
        .bind(guest_note)
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(owner, gb.user_id, "the guest item passed to the Tenant Manager of beta");
    assert!(identity::login(&t, "alfa", "anna", PASSWORD, "t").await.is_err());

    // import: the same ids, the people, the items, the rows of the plugins and the contents
    let r = transfer::import_tenant(&t, &admin, &path, "", &ImportOptions::default()).await.unwrap();
    assert_eq!((r.slug.as_str(), r.replaced), ("alfa", false));
    assert_eq!(r.files, 1);
    let anna = t.login("alfa", "anna").await;
    let anna_c = t.home(&anna).await;
    let mgr = t.home(&t.login("alfa", "alfa-manager").await).await;
    assert_eq!(titles(&t, &mgr).await, vec!["Budget".to_string()]);
    assert_eq!(titles(&t, &anna_c).await, vec!["Minutes".to_string()]);
    let (_, data) = files::read(&t, &anna_c, FILES, doc.id).await.unwrap();
    assert_eq!(data, b"hello");
    assert!(mosaikit_kernel::personal::get(&t, anna.user_id).await.unwrap().contrast);
    assert_eq!(mosaikit_kernel::tenancy::tenant_theme(&t, alfa).await.unwrap().preset, theme.id);
    let found = mosaikit_kernel::search::search(&t, &anna_c, "minutes", "en").await.unwrap();
    assert_eq!(found.iter().map(|g| g.items.len()).sum::<usize>(), 1, "found after the import");
    // a second import needs `replace`
    let again = transfer::import_tenant(&t, &admin, &path, "", &ImportOptions::default()).await.unwrap_err();
    assert_eq!(again.code(), "tenant_exists");
    let r = transfer::import_tenant(&t, &admin, &path, "", &ImportOptions { replace: true }).await.unwrap();
    assert!(r.replaced);
    assert_eq!(titles(&t, &t.home(&t.login("alfa", "anna").await).await).await, vec!["Minutes".to_string()]);
}

#[tokio::test]
async fn trial_archive_and_reactivate() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let alfa = tenant_id(&t, "alfa").await;
    assert_eq!(
        lifecycle::set_trial(&t, &admin, alfa, Some(Utc::now() - Duration::days(1)))
            .await
            .unwrap_err()
            .code(),
        "trial_past"
    );
    lifecycle::set_trial(&t, &admin, alfa, Some(Utc::now() + Duration::days(3))).await.unwrap();
    // a week before: one notice to the manager and to the administrator, not twice
    lifecycle::check_trials(&t).await.unwrap();
    lifecycle::check_trials(&t).await.unwrap();
    assert_eq!(notifications(&t, g.user_id, "tenant.trial_ending").await, 1);
    assert_eq!(notifications(&t, admin.user_id, "tenant.trial_ending").await, 1);
    // at the end: suspended
    mosaikit_db::query("update core.tenants set trial_until = $2 where id = $1")
        .bind(alfa)
        .bind(Utc::now() - Duration::minutes(1))
        .execute(&t.db)
        .await
        .unwrap();
    lifecycle::check_trials(&t).await.unwrap();
    assert!(identity::login(&t, "alfa", "alfa-manager", PASSWORD, "t").await.is_err());
    assert_eq!(notifications(&t, admin.user_id, "tenant.trial_ended").await, 1);
    // reactivating forgets the trial that is over
    set_tenant_status(&t, &admin, alfa, "active").await.unwrap();
    let info = list_tenants(&t, &admin).await.unwrap().into_iter().find(|x| x.slug == "alfa").unwrap();
    assert!(info.trial_until.is_none());
    // archive: nobody signs in, the data stay, reactivation brings it back
    lifecycle::archive(&t, &admin, alfa).await.unwrap();
    let info = list_tenants(&t, &admin).await.unwrap().into_iter().find(|x| x.slug == "alfa").unwrap();
    assert!(info.archived_at.is_some() && info.status == "suspended");
    assert!(identity::login(&t, "alfa", "alfa-manager", PASSWORD, "t").await.is_err());
    set_tenant_status(&t, &admin, alfa, "active").await.unwrap();
    let info = list_tenants(&t, &admin).await.unwrap().into_iter().find(|x| x.slug == "alfa").unwrap();
    assert!(info.archived_at.is_none());
    t.login("alfa", "alfa-manager").await;
}

#[tokio::test]
async fn maintenance_lets_only_administrators_in() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    assert_eq!(
        maintenance::set(&t, &g, &maintenance::Maintenance { on: true, ..Default::default() })
            .await
            .unwrap_err()
            .kind,
        Kind::Forbidden
    );
    let m = maintenance::set(
        &t,
        &admin,
        &maintenance::Maintenance { on: true, message: "Upgrade until 10".into(), ..Default::default() },
    )
    .await
    .unwrap();
    assert!(m.on);
    let e = maintenance::check(&t, Some(&g)).await.unwrap_err();
    assert_eq!((e.code(), e.message.as_str()), ("maintenance", "Upgrade until 10"));
    maintenance::check(&t, Some(&admin)).await.unwrap();
    assert_eq!(maintenance::check(&t, None).await.unwrap_err().code(), "maintenance");
    // planned: the notice before, the mode at the time
    maintenance::set(&t, &admin, &maintenance::Maintenance::default()).await.unwrap();
    maintenance::check(&t, Some(&g)).await.unwrap();
    let planned = maintenance::Maintenance {
        planned_at: Some(Utc::now() + Duration::hours(1)),
        planned_message: "Tonight".into(),
        ..Default::default()
    };
    maintenance::set(&t, &admin, &planned).await.unwrap();
    maintenance::start_planned(&t).await.unwrap();
    assert!(!maintenance::get(&t).await.unwrap().on);
    let mut s: serde_json::Value =
        mosaikit_db::query_scalar("select settings from core.tenants where is_system")
            .fetch_one(&t.db)
            .await
            .unwrap();
    s["maintenance"]["planned_at"] = json!(Utc::now() - Duration::minutes(1));
    mosaikit_db::query("update core.tenants set settings = $1 where is_system")
        .bind(&s)
        .execute(&t.db)
        .await
        .unwrap();
    // the cache keeps the old state a few seconds: read the stored one
    maintenance::start_planned(&t).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(5100)).await;
    let m = maintenance::get(&t).await.unwrap();
    assert!(m.on && m.message == "Tonight" && m.planned_at.is_none());
}

#[tokio::test]
async fn backup_and_restore_of_one_tenant() {
    let t = start().await;
    t.install("notes").await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let mgr = t.home(&g).await;
    note(&t, &mgr, "Kept in the backup").await;
    t.tenant("beta").await;
    let b = backup::run(&t, Some(&admin)).await.unwrap();
    assert_eq!(b.status, "ok", "{}", b.error);
    assert_eq!(b.tenants, 2);
    assert!(b.manual);
    if t.db.is_sqlite() {
        assert!(b.whole, "the copy of the SQLite file is inside");
    }
    let inside = backup::tenants(&t, &admin, b.id).await.unwrap();
    assert_eq!(inside.iter().map(|m| m.tenant.slug.as_str()).collect::<Vec<_>>(), vec!["alfa", "beta"]);
    // the tenant is deleted, then restored from the backup alone
    let alfa = tenant_id(&t, "alfa").await;
    lifecycle::delete(&t, &admin, alfa, "alfa").await.unwrap();
    let r = backup::restore_tenant(&t, &admin, b.id, "alfa", &ImportOptions::default()).await.unwrap();
    assert_eq!(r.tenant_id, alfa);
    let mgr = t.home(&t.login("alfa", "alfa-manager").await).await;
    assert_eq!(titles(&t, &mgr).await, vec!["Kept in the backup".to_string()]);
    assert_eq!(
        backup::restore_tenant(&t, &admin, b.id, "gamma", &ImportOptions::default()).await.unwrap_err().kind,
        Kind::NotFound
    );
    // retention: only the last `keep`
    backup::set_config(&t, &admin, &backup::BackupConfig { enabled: false, hour: 2, keep: 1 }).await.unwrap();
    let b2 = backup::run(&t, Some(&admin)).await.unwrap();
    let list = backup::list(&t, &admin).await.unwrap();
    assert_eq!(list.iter().map(|x| x.id).collect::<Vec<_>>(), vec![b2.id]);
    assert!(!backup::dir(&t).join(&b.file).exists());
    // only the Administrators
    assert_eq!(backup::run(&t, Some(&g)).await.unwrap_err().kind, Kind::Forbidden);
}

#[tokio::test]
async fn metrics_monitoring_and_alerts_once_per_crossing() {
    let t = start().await;
    let admin = t.admin().await;
    t.tenant("alfa").await;
    for i in 0..40 {
        t.ops.metrics.record(10.0 + i as f64, if i < 10 { 500 } else { 200 }, Some("alfa"));
    }
    metrics::snapshot(&t).await.unwrap();
    let points = metrics::series(&t, "1h").await.unwrap();
    assert_eq!(points.iter().map(|p| p.requests).sum::<i64>(), 40);
    assert_eq!(points.iter().map(|p| p.errors).sum::<i64>(), 10);
    let load = monitor::tenants(&t).await.unwrap();
    assert_eq!(load.iter().find(|x| x.slug == "alfa").unwrap().requests_1h, 40);
    let services = monitor::services(&t).await.unwrap();
    assert!(services.iter().any(|s| s.key == "database" && s.state == "ok"));
    assert!(services.iter().any(|s| s.key == "storage" && s.state == "ok"));
    let cap = monitor::capacity(&t).await.unwrap();
    assert!(cap.disk_total > 0 && cap.memory_total > 0, "{cap:?}");
    // 25% of errors over the threshold of 5%: one alert, notified once
    monitor::check_alerts(&t).await.unwrap();
    monitor::check_alerts(&t).await.unwrap();
    assert_eq!(notifications(&t, admin.user_id, "alert.raised").await, 1);
    let states = monitor::alert_states(&t).await.unwrap();
    assert!(states.iter().any(|s| s.key == "errors" && s.active));
    // the threshold raised: the alert clears, and a new crossing notifies again
    let mut c = monitor::alert_config(&t).await.unwrap();
    c.error_rate_pct = 50;
    monitor::set_alert_config(&t, &admin, &c).await.unwrap();
    monitor::check_alerts(&t).await.unwrap();
    assert!(monitor::alert_states(&t).await.unwrap().iter().any(|s| s.key == "errors" && !s.active));
    c.error_rate_pct = 5;
    monitor::set_alert_config(&t, &admin, &c).await.unwrap();
    monitor::check_alerts(&t).await.unwrap();
    assert_eq!(notifications(&t, admin.user_id, "alert.raised").await, 2);
    let text = metrics::prometheus(&t).await.unwrap();
    assert!(text.contains("mosaikit_requests_total 40"));
}

#[tokio::test]
async fn one_item_from_a_backup() {
    use mosaikit_kernel::acl::{self, Level};
    use mosaikit_kernel::ops::backup_item::{self, ItemQuery, ItemRestore, Mode};
    let t = start().await;
    t.install("notes").await;
    t.install("files").await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let anna_c = t.home(&anna).await;
    let bruno_c = t.home(&bruno).await;
    let budget = note(&t, &anna_c, "Budget 2026").await;
    acl::set_grant(&t, &anna_c, budget, "user", bruno.user_id, Some(Level::Write)).await.unwrap();
    let doc = files::upload(&t, &anna_c, FILES, None, "report.txt", b"hello", false).await.unwrap();
    // a folder with a file in it
    let docs = files::mkdir(&t, &anna_c, FILES, None, "Docs").await.unwrap();
    let inner =
        files::upload(&t, &anna_c, FILES, Some(docs.id), "inner.txt", b"inside", false).await.unwrap();
    let b = backup::run(&t, Some(&admin)).await.unwrap();
    assert_eq!(b.status, "ok", "{}", b.error);

    // both deleted for good after the backup
    crud::delete(&t, &anna_c, NOTES, "notes", budget).await.unwrap();
    mosaikit_kernel::trash::purge(&t, &anna_c, budget).await.unwrap();
    files::delete(&t, &anna_c, FILES, doc.id).await.unwrap();
    mosaikit_kernel::trash::purge(&t, &anna_c, doc.id).await.unwrap();

    // the items of alfa in the backup, by title, app, owner; their state now
    let q = |q: &str, plugin: &str, owner: &str| ItemQuery {
        q: Some(q.into()),
        plugin: Some(plugin.into()),
        owner: Some(owner.into()),
    };
    let list = backup_item::items(&t, &admin, b.id, "alfa", &q("budget", "", "")).await.unwrap();
    assert_eq!(list.items.len(), 1);
    assert_eq!(
        (list.items[0].id, list.items[0].state, list.items[0].owner_name.as_str()),
        (budget, "missing", "anna")
    );
    assert_eq!(
        backup_item::items(&t, &admin, b.id, "alfa", &q("", FILES, "anna")).await.unwrap().items.len(),
        3,
        "the file, the folder and the file in it"
    );
    assert!(backup_item::items(&t, &admin, b.id, "alfa", &q("", "", "bruno"))
        .await
        .unwrap()
        .items
        .is_empty());

    // back with its id; the shares only on request
    let r = backup_item::restore(&t, &admin, b.id, "alfa", budget, &ItemRestore::default()).await.unwrap();
    assert_eq!((r.id, r.mode, r.items, r.shares), (budget, "original", 1, 0));
    assert_eq!(titles(&t, &anna_c).await, vec!["Budget 2026".to_string()]);
    assert!(titles(&t, &bruno_c).await.is_empty(), "the share did not come back");
    assert_eq!(notifications(&t, anna.user_id, "backup.item_restored").await, 1, "the owner is told");
    // the file, with its content
    let r = backup_item::restore(&t, &admin, b.id, "alfa", doc.id, &ItemRestore::default()).await.unwrap();
    assert_eq!(r.files, 1);
    assert_eq!(files::read(&t, &anna_c, FILES, doc.id).await.unwrap().1, b"hello");

    // a folder comes back with what is in it
    files::delete(&t, &anna_c, FILES, docs.id).await.unwrap();
    mosaikit_kernel::trash::purge(&t, &anna_c, docs.id).await.unwrap();
    let list = backup_item::items(&t, &admin, b.id, "alfa", &q("docs", FILES, "")).await.unwrap();
    assert_eq!(list.items[0].children, 1);
    let r = backup_item::restore(&t, &admin, b.id, "alfa", docs.id, &ItemRestore::default()).await.unwrap();
    assert_eq!((r.items, r.files), (2, 1));
    let inside = files::list(&t, &anna_c, FILES, Some(docs.id)).await.unwrap();
    assert_eq!(inside.entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["inner.txt"]);
    assert_eq!(files::read(&t, &anna_c, FILES, inner.id).await.unwrap().1, b"inside");
    // a file of a folder that is gone again: at the top
    files::delete(&t, &anna_c, FILES, docs.id).await.unwrap();
    mosaikit_kernel::trash::purge(&t, &anna_c, docs.id).await.unwrap();
    backup_item::restore(&t, &admin, b.id, "alfa", inner.id, &ItemRestore::default()).await.unwrap();
    let top = files::list(&t, &anna_c, FILES, None).await.unwrap();
    assert!(top.entries.iter().any(|e| e.name == "inner.txt"), "at the top");

    // still in the tenant: never overwritten without saying so
    let e =
        backup_item::restore(&t, &admin, b.id, "alfa", budget, &ItemRestore::default()).await.unwrap_err();
    assert_eq!((e.kind, e.code), (Kind::Conflict, Some("item_exists")));
    // a copy, with the shares this time: a new item next to the current one
    let copy = ItemRestore { mode: Some(Mode::Copy), shares: true };
    let r = backup_item::restore(&t, &admin, b.id, "alfa", budget, &copy).await.unwrap();
    assert!(r.id != budget && r.mode == "copy" && r.shares == 1);
    assert_eq!(titles(&t, &anna_c).await, vec!["Budget 2026".to_string(), "Budget 2026".to_string()]);
    assert_eq!(
        titles(&t, &bruno_c).await,
        vec!["Budget 2026".to_string()],
        "bruno sees the copy, shared again"
    );
    // replace: the current version goes, the one of the backup takes its place with the same id
    crud::update(&t, &anna_c, NOTES, "notes", budget, json!({ "title": "Changed" }).as_object().unwrap())
        .await
        .unwrap();
    let replace = ItemRestore { mode: Some(Mode::Replace), shares: false };
    let r = backup_item::restore(&t, &admin, b.id, "alfa", budget, &replace).await.unwrap();
    assert_eq!((r.id, r.mode), (budget, "replace"));
    let row = crud::get(&t, &anna_c, NOTES, "notes", budget).await.unwrap();
    assert_eq!(row["values"]["title"], "Budget 2026");
    // in the trash it is still there
    crud::delete(&t, &anna_c, NOTES, "notes", budget).await.unwrap();
    let list = backup_item::items(&t, &admin, b.id, "alfa", &q("budget", NOTES, "")).await.unwrap();
    assert_eq!(list.items[0].state, "trash");
    let e =
        backup_item::restore(&t, &admin, b.id, "alfa", budget, &ItemRestore::default()).await.unwrap_err();
    assert_eq!(e.code, Some("item_exists"));

    // only the Administrators; a tenant or an item not in the backup
    assert_eq!(
        backup_item::items(&t, &g, b.id, "alfa", &ItemQuery::default()).await.unwrap_err().kind,
        Kind::Forbidden
    );
    assert_eq!(
        backup_item::items(&t, &admin, b.id, "gamma", &ItemQuery::default()).await.unwrap_err().kind,
        Kind::NotFound
    );
    assert_eq!(
        backup_item::restore(&t, &admin, b.id, "alfa", Uuid::new_v4(), &ItemRestore::default())
            .await
            .unwrap_err()
            .kind,
        Kind::NotFound
    );
}
