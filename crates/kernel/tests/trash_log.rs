//! Trash (delete, restore with grants and links, purge, retention) and Log (filters, isolation between
//! tenants, failures, CSV, retention).

use chrono::{Duration, Utc};
use mosaikit_kernel::acl::{revoke_all, set_grant, shared_by_me, Level};
use mosaikit_kernel::log::{self, LogFilter, Scope};
use mosaikit_kernel::testing::{start, TestKernel, PASSWORD};
use mosaikit_kernel::{crud, identity, links, trash, Caller, Kind};
use serde_json::json;
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

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

fn token_of(url: &str) -> String {
    url.trim_end_matches('/').rsplit('/').next().unwrap().to_string()
}

struct World {
    t: TestKernel,
    mgr: Caller,
    anna: Caller,
    bruno: Caller,
    beta_mgr: Caller,
}

async fn world() -> World {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let gb = t.tenant("beta").await;
    World {
        mgr: t.home(&g).await,
        anna: t.home(&anna).await,
        bruno: t.home(&bruno).await,
        beta_mgr: t.home(&gb).await,
        t,
    }
}

#[tokio::test]
async fn trash_hides_and_restores_with_grants_and_links() {
    let w = world().await;
    let t = &w.t;
    let rid = note(t, &w.anna, "Secret").await;
    note(t, &w.anna, "Other").await;
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Read)).await.unwrap();
    let link = links::create(t, &w.anna, rid, None, None).await.unwrap();
    assert!(links::resolve(t, &token_of(&link.url)).await.is_ok());
    assert_eq!(titles(t, &w.bruno).await, vec!["Secret"]);

    // delete: invisible to everybody, the link stops working
    crud::delete(t, &w.anna, NOTES, "notes", rid).await.unwrap();
    assert_eq!(titles(t, &w.anna).await, vec!["Other"]);
    assert!(titles(t, &w.bruno).await.is_empty());
    assert_eq!(crud::get(t, &w.anna, NOTES, "notes", rid).await.unwrap_err().kind, Kind::NotFound);
    assert!(links::resolve(t, &token_of(&link.url)).await.is_err());
    assert!(shared_by_me(t, &w.anna).await.unwrap().is_empty());

    // who sees it in the trash: the owner and the manager, not the one it was shared with nor another tenant
    let mine = trash::list(t, &w.anna, None, None).await.unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].title, "Secret");
    assert_eq!(mine[0].deleted_by, Some(w.anna.user.user_id));
    assert!(mine[0].purge_at > Utc::now() + Duration::days(29));
    assert!(trash::list(t, &w.bruno, None, None).await.unwrap().is_empty());
    assert_eq!(trash::list(t, &w.mgr, None, None).await.unwrap().len(), 1);
    assert!(trash::list(t, &w.beta_mgr, None, None).await.unwrap().is_empty());
    assert_eq!(trash::list(t, &w.anna, None, Some("secr")).await.unwrap().len(), 1);
    assert!(trash::list(t, &w.anna, None, Some("nothing")).await.unwrap().is_empty());
    assert_eq!(trash::restore(t, &w.bruno, rid).await.unwrap_err().kind, Kind::NotFound);
    assert_eq!(trash::restore(t, &w.beta_mgr, rid).await.unwrap_err().kind, Kind::NotFound);

    // restore: back where it was, with its share and its link
    trash::restore(t, &w.anna, rid).await.unwrap();
    assert_eq!(titles(t, &w.anna).await, vec!["Other", "Secret"]);
    assert_eq!(titles(t, &w.bruno).await, vec!["Secret"]);
    assert!(links::resolve(t, &token_of(&link.url)).await.is_ok());
    assert!(trash::list(t, &w.anna, None, None).await.unwrap().is_empty());

    // the manager deletes it for good
    crud::delete(t, &w.anna, NOTES, "notes", rid).await.unwrap();
    trash::purge(t, &w.mgr, rid).await.unwrap();
    assert!(trash::list(t, &w.anna, None, None).await.unwrap().is_empty());
    assert_eq!(trash::restore(t, &w.anna, rid).await.unwrap_err().kind, Kind::NotFound);
    let left: i64 = mosaikit_db::query_scalar("select count(*) from core.resources where id = $1")
        .bind(rid)
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

#[tokio::test]
async fn empty_and_retention_of_the_trash() {
    let w = world().await;
    let t = &w.t;
    let a = note(t, &w.anna, "A").await;
    let b = note(t, &w.anna, "B").await;
    let c = note(t, &w.bruno, "C").await;
    for (who, id) in [(&w.anna, a), (&w.anna, b), (&w.bruno, c)] {
        crud::delete(t, who, NOTES, "notes", id).await.unwrap();
    }
    // empty: only what is one's own, also for the manager
    assert_eq!(trash::empty(t, &w.anna).await.unwrap(), 2);
    assert_eq!(trash::list(t, &w.mgr, None, None).await.unwrap().len(), 1);
    assert_eq!(trash::empty(t, &w.mgr).await.unwrap(), 0);

    // retention: older than 30 days, purged by the background work
    mosaikit_db::query("update core.resources set deleted_at = $2 where id = $1")
        .bind(c)
        .bind(Utc::now() - Duration::days(31))
        .execute(&t.db)
        .await
        .unwrap();
    assert_eq!(trash::purge_expired(t).await.unwrap(), 1);
    assert!(trash::list(t, &w.mgr, None, None).await.unwrap().is_empty());
}

#[tokio::test]
async fn revoke_every_share_and_link() {
    let w = world().await;
    let t = &w.t;
    let rid = note(t, &w.anna, "Shared").await;
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Write)).await.unwrap();
    links::create(t, &w.anna, rid, None, None).await.unwrap();
    let mine = shared_by_me(t, &w.anna).await.unwrap();
    assert_eq!(mine.len(), 1);
    assert_eq!((mine[0].shares, mine[0].public_links), (1, 1));
    assert_eq!(mine[0].with, vec!["bruno"]);

    // not someone who only reads or writes, nor another tenant; yes the manager of the tenant
    assert_eq!(revoke_all(t, &w.bruno, rid).await.unwrap_err().kind, Kind::NotFound);
    assert_eq!(revoke_all(t, &w.beta_mgr, rid).await.unwrap_err().kind, Kind::NotFound);
    let r = revoke_all(t, &w.mgr, rid).await.unwrap();
    assert_eq!((r.shares, r.links), (1, 1));
    assert!(titles(t, &w.bruno).await.is_empty());
    assert!(shared_by_me(t, &w.anna).await.unwrap().is_empty());
}

#[tokio::test]
async fn the_lists_of_the_overview_come_in_pages() {
    use mosaikit_kernel::acl::shared_by_me_page;
    use mosaikit_kernel::paging::PageQuery;
    let w = world().await;
    let t = &w.t;
    let mut ids = Vec::new();
    for i in 0..3 {
        let rid = note(t, &w.anna, &format!("Item {i}")).await;
        set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Read)).await.unwrap();
        ids.push(rid);
    }
    // shared by me: two pages, the latest first, no row twice
    let p1 = shared_by_me_page(t, &w.anna, &PageQuery { limit: Some(2), ..Default::default() }).await.unwrap();
    assert_eq!((p1.items.len(), p1.total), (2, 3));
    let p2 = shared_by_me_page(t, &w.anna, &PageQuery { limit: Some(2), cursor: p1.next.clone(), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(p2.items.len(), 1);
    assert!(p2.next.is_none());
    assert!(p1.items.iter().all(|x| x.id != p2.items[0].id));
    // trash: the same through the cut in memory
    for rid in &ids {
        crud::delete(t, &w.anna, NOTES, "notes", *rid).await.unwrap();
    }
    let t1 = trash::list_page(t, &w.anna, None, &PageQuery { limit: Some(2), ..Default::default() }).await.unwrap();
    assert_eq!((t1.items.len(), t1.total), (2, 3));
    let t2 = trash::list_page(t, &w.anna, None, &PageQuery { limit: Some(2), cursor: t1.next.clone(), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(t2.items.len(), 1);
    assert!(t1.items.iter().all(|x| x.id != t2.items[0].id));
    // the log of a widget: a short page
    let short = log::page(t, Scope::Tenant(&w.mgr), &LogFilter { limit: Some(2), ..Default::default() }).await.unwrap();
    assert_eq!(short.events.len(), 2);
}

#[tokio::test]
async fn log_filters_failures_isolation_and_csv() {
    let w = world().await;
    let t = &w.t;
    let rid = note(t, &w.anna, "Logged").await;
    note(t, &w.bruno, "Bruno's").await;
    note(t, &w.beta_mgr, "Beta").await;
    assert!(identity::login(t, "alfa", "anna", "wrong password", "10.0.0.9").await.is_err());
    identity::login(t, "alfa", "anna", PASSWORD, "10.0.0.9").await.unwrap();

    let alfa = w.mgr.tenant.tenant_id;
    let all = log::page(t, Scope::Tenant(&w.mgr), &LogFilter::default()).await.unwrap();
    assert!(!all.events.is_empty());
    assert!(all.events.iter().all(|e| e.tenant_id == Some(alfa)), "only the events of the tenant");
    assert!(all
        .events
        .iter()
        .any(|e| e.action == "resource.create" && e.resource_title.as_deref() == Some("Logged")));

    // who, what, item, failures, search
    let anna = LogFilter { user: Some(w.anna.user.user_id), ..Default::default() };
    let p = log::page(t, Scope::Tenant(&w.mgr), &anna).await.unwrap();
    assert!(p.events.iter().all(|e| e.user_id == Some(w.anna.user.user_id)));
    let items = LogFilter { what: Some("items".into()), ..Default::default() };
    let p = log::page(t, Scope::Tenant(&w.mgr), &items).await.unwrap();
    assert!(p.events.len() >= 2 && p.events.iter().all(|e| e.action.starts_with("resource.")));
    let item = LogFilter { resource: Some(rid), ..Default::default() };
    assert_eq!(log::page(t, Scope::Tenant(&w.mgr), &item).await.unwrap().events.len(), 1);
    let failed = LogFilter { failed: true, ..Default::default() };
    let p = log::page(t, Scope::Tenant(&w.mgr), &failed).await.unwrap();
    assert_eq!(p.events.len(), 1);
    assert_eq!(p.events[0].action, "login.failed");
    assert!(!p.events[0].ok);
    let q = LogFilter { q: Some("login".into()), ..Default::default() };
    assert!(log::page(t, Scope::Tenant(&w.mgr), &q)
        .await
        .unwrap()
        .events
        .iter()
        .all(|e| e.action.contains("login")));

    // never the events of another tenant; only managers and administrators
    let beta = log::page(t, Scope::Tenant(&w.beta_mgr), &LogFilter::default()).await.unwrap();
    assert!(beta.events.iter().all(|e| e.tenant_id == Some(w.beta_mgr.tenant.tenant_id)));
    assert!(!beta.events.iter().any(|e| e.resource_title.as_deref() == Some("Logged")));
    assert_eq!(
        log::page(t, Scope::Tenant(&w.anna), &LogFilter::default()).await.unwrap_err().kind,
        Kind::Forbidden
    );
    assert_eq!(
        log::page(t, Scope::Platform(&w.anna.user), &LogFilter::default()).await.unwrap_err().kind,
        Kind::Forbidden
    );

    // the Administrator: every tenant, or one
    let admin = t.admin().await;
    let every = log::page(t, Scope::Platform(&admin), &LogFilter::default()).await.unwrap();
    assert!(every.events.iter().any(|e| e.tenant_id == Some(w.beta_mgr.tenant.tenant_id)));
    let only = LogFilter { tenant: Some(alfa), ..Default::default() };
    let p = log::page(t, Scope::Platform(&admin), &only).await.unwrap();
    assert!(!p.events.is_empty() && p.events.iter().all(|e| e.tenant_id == Some(alfa)));
    assert!(p.events.iter().all(|e| e.tenant_slug.as_deref() == Some("alfa")));

    // CSV: header, rows, a selection
    let csv = log::csv(t, Scope::Tenant(&w.mgr), &LogFilter::default()).await.unwrap();
    assert!(csv.starts_with("\u{feff}time,person,username,action"));
    assert!(csv.contains("login.failed") && csv.contains(",failed,"));
    let one = all.events[0].id;
    let sel = LogFilter { ids: Some(one.to_string()), ..Default::default() };
    let csv = log::csv(t, Scope::Tenant(&w.mgr), &sel).await.unwrap();
    assert_eq!(csv.trim_end().lines().count(), 2, "header and the selected event");
    let csv = log::csv(t, Scope::Platform(&admin), &LogFilter::default()).await.unwrap();
    assert!(csv.starts_with("\u{feff}time,tenant,person"));

    // paging
    let first = log::page(t, Scope::Platform(&admin), &LogFilter::default()).await.unwrap();
    if let Some(next) = first.next {
        let second =
            log::page(t, Scope::Platform(&admin), &LogFilter { before: Some(next), ..Default::default() })
                .await
                .unwrap();
        assert!(second.events.iter().all(|e| e.id < next));
    }

    // retention: events older than a year are purged
    mosaikit_db::query("update core.events set ts = $2 where id = $1")
        .bind(one)
        .bind(Utc::now() - Duration::days(400))
        .execute(&t.db)
        .await
        .unwrap();
    assert_eq!(log::purge(t).await.unwrap(), 1);
}

#[tokio::test]
async fn trash_and_log_of_a_deleted_item_in_the_log() {
    let w = world().await;
    let t = &w.t;
    let rid = note(t, &w.anna, "Gone").await;
    crud::delete(t, &w.anna, NOTES, "notes", rid).await.unwrap();
    trash::restore(t, &w.anna, rid).await.unwrap();
    let f = LogFilter { resource: Some(rid), ..Default::default() };
    let actions: Vec<String> =
        log::page(t, Scope::Tenant(&w.mgr), &f).await.unwrap().events.into_iter().map(|e| e.action).collect();
    assert_eq!(actions, vec!["resource.restore", "resource.delete", "resource.create"]);
}
