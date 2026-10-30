//! Server-side sort of the paged lists: the order holds across pages (the sort acts on the whole data set), `desc`
//! reverses it, an unknown field is a 400 with a translatable code, and the visibility rules (tenant, owner, RLS)
//! are the same as without a sort. Runs on both databases (see `testing::test_backend_sqlite`).

use mosaikit_kernel::acl::{manager_resources_page, ResourcePageFilter};
use mosaikit_kernel::log::{self, LogFilter, Scope};
use mosaikit_kernel::paging::PageQuery;
use mosaikit_kernel::tenancy::{
    members_page, people_page, tenant_invitations_page, tenants_page, MemberFilter, PeopleFilter, TenantFilter,
};
use mosaikit_kernel::testing::{start, TestKernel};
use mosaikit_kernel::{crud, trash, Caller, Kind};
use serde_json::json;
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

async fn note(t: &TestKernel, c: &Caller, title: &str) -> Uuid {
    let row = crud::create(t, c, NOTES, "notes", json!({ "title": title }).as_object().unwrap(), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

fn sorted(v: &[String], desc: bool) -> Vec<String> {
    let mut s = v.to_vec();
    s.sort();
    if desc {
        s.reverse();
    }
    s
}

fn dir(desc: bool) -> Option<String> {
    Some(if desc { "desc" } else { "asc" }.to_string())
}

#[tokio::test]
async fn tenants_sort_across_pages_and_refuse_unknown_fields() {
    let t = start().await;
    let admin = t.admin().await;
    for s in ["tc", "ta", "te", "tb", "td"] {
        t.tenant(s).await;
    }
    for desc in [false, true] {
        let mut slugs = Vec::new();
        let mut cursor = None;
        loop {
            let f = TenantFilter {
                limit: Some(2),
                cursor: cursor.clone(),
                sort: Some("slug".into()),
                dir: dir(desc),
                ..Default::default()
            };
            let p = tenants_page(&t, &admin, &f).await.unwrap();
            assert_eq!(p.total, 5);
            slugs.extend(p.items.iter().map(|x| x.slug.clone()));
            cursor = p.next;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(slugs.len(), 5);
        assert_eq!(slugs, sorted(&slugs, desc));
    }
    // the filter still applies, the default order is kept without a sort
    let f = TenantFilter { q: Some("tb".into()), sort: Some("name".into()), ..Default::default() };
    assert_eq!(tenants_page(&t, &admin, &f).await.unwrap().total, 1);
    let plain = tenants_page(&t, &admin, &TenantFilter { limit: Some(10), ..Default::default() }).await.unwrap();
    let names: Vec<String> = plain.items.iter().map(|x| x.name.to_lowercase()).collect();
    assert_eq!(names, sorted(&names, false));
    for bad in [("slug; drop table x", "asc"), ("members", "asc"), ("name", "sideways")] {
        let f = TenantFilter { sort: Some(bad.0.into()), dir: Some(bad.1.into()), ..Default::default() };
        let e = tenants_page(&t, &admin, &f).await.unwrap_err();
        assert_eq!((e.kind, e.code()), (Kind::BadRequest, "sort_unknown"));
    }
    // a Tenant Manager is not an Administrator: the sort does not open the list
    let mgr = t.login("ta", "ta-manager").await;
    assert!(tenants_page(&t, &mgr, &TenantFilter { sort: Some("name".into()), ..Default::default() }).await.is_err());
}

#[tokio::test]
async fn members_and_people_sort_across_pages() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    for u in ["mike", "anna", "zoe", "bob", "carl"] {
        t.member(&g, u).await;
    }
    let c = t.home(&g).await;
    for desc in [false, true] {
        let mut names = Vec::new();
        let mut cursor = None;
        loop {
            let f = MemberFilter {
                limit: Some(2),
                cursor: cursor.clone(),
                sort: Some("username".into()),
                dir: dir(desc),
                ..Default::default()
            };
            let p = members_page(&t, &c, &f).await.unwrap();
            assert_eq!(p.page.total, 6);
            names.extend(p.page.items.iter().map(|m| m.username.clone()));
            cursor = p.page.next;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(names.len(), 6);
        assert_eq!(names, sorted(&names, desc));
        let mut names = Vec::new();
        let mut cursor = None;
        loop {
            let f = PeopleFilter {
                limit: Some(3),
                cursor: cursor.clone(),
                sort: Some("username".into()),
                dir: dir(desc),
                ..Default::default()
            };
            let p = people_page(&t, &admin, &f).await.unwrap();
            names.extend(p.page.items.iter().map(|m| m.username.clone()));
            cursor = p.page.next;
            if cursor.is_none() {
                break;
            }
        }
        assert!(names.len() >= 7);
        assert_eq!(names, sorted(&names, desc));
    }
    for sort in ["groups", "items", "password_hash"] {
        let e = members_page(&t, &c, &MemberFilter { sort: Some(sort.into()), ..Default::default() })
            .await
            .unwrap_err();
        assert_eq!(e.code(), "sort_unknown");
        let e = people_page(&t, &admin, &PeopleFilter { sort: Some(sort.into()), ..Default::default() })
            .await
            .unwrap_err();
        assert_eq!(e.code(), "sort_unknown");
    }
    // an ordinary member cannot list the members, with or without a sort
    let anna = t.login("alfa", "anna").await;
    let ca = t.home(&anna).await;
    assert!(members_page(&t, &ca, &MemberFilter { sort: Some("name".into()), ..Default::default() }).await.is_err());
    // invitations: the sort is checked even when the list is empty
    let e = tenant_invitations_page(&t, &c, &PageQuery { sort: Some("nope".into()), ..Default::default() })
        .await
        .unwrap_err();
    assert_eq!(e.code(), "sort_unknown");
    let ok = PageQuery { sort: Some("status".into()), dir: Some("desc".into()), ..Default::default() };
    assert_eq!(tenant_invitations_page(&t, &c, &ok).await.unwrap().0.total, 0);
}

#[tokio::test]
async fn items_trash_log_and_plugin_lists_sort_across_pages() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let ca = t.home(&anna).await;
    let mgr = t.home(&g).await;
    let other = t.tenant("beta").await;
    let cb = t.home(&other).await;
    note(&t, &cb, "zzz of another tenant").await;
    let titles = ["pear", "apple", "fig", "cherry", "banana"].map(String::from);
    let mut ids = Vec::new();
    for ti in &titles {
        ids.push(note(&t, &ca, ti).await);
    }
    // plugin resource list (RLS: the owner sees her rows only): the whole list is sorted, page by page
    for desc in [false, true] {
        let mut got = Vec::new();
        let mut cursor = None;
        loop {
            let pg = crud::Paging { limit: 2, cursor: cursor.clone(), sort: Some("title".into()), dir: dir(desc) };
            let r = crud::list_paged(&t, &ca, NOTES, "notes", None, None, Some(&pg)).await.unwrap();
            got.extend(r.rows.iter().map(|x| x["values"]["title"].as_str().unwrap().to_string()));
            cursor = r.next;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(got, sorted(&titles, desc));
    }
    for s in ["nope", "values", "title; drop table x"] {
        let pg = crud::Paging { limit: 2, sort: Some(s.into()), ..Default::default() };
        let e = crud::list_paged(&t, &ca, NOTES, "notes", None, None, Some(&pg)).await.unwrap_err();
        assert_eq!((e.kind, e.code()), (Kind::BadRequest, "sort_unknown"));
    }
    // metadata columns sort too; a person without rows gets nothing
    let by_date = crud::Paging { limit: 10, sort: Some("updated_at".into()), dir: dir(true), cursor: None };
    let r = crud::list_paged(&t, &ca, NOTES, "notes", None, None, Some(&by_date)).await.unwrap();
    assert_eq!(r.rows.len(), 5);
    let bob = t.member(&g, "bob").await;
    let cbob = t.home(&bob).await;
    let none = crud::list_paged(&t, &cbob, NOTES, "notes", None, None, Some(&by_date)).await.unwrap();
    assert_eq!(none.rows.len(), 0);

    // Manage > Items: sorted by title over every item of the tenant, not of the other tenant
    let mut got = Vec::new();
    let mut cursor = None;
    loop {
        let f = ResourcePageFilter {
            limit: Some(2),
            cursor: cursor.clone(),
            sort: Some("title".into()),
            dir: dir(true),
            ..Default::default()
        };
        let p = manager_resources_page(&t, &mgr, &f).await.unwrap();
        assert_eq!(p.page.total, 5);
        got.extend(p.page.items.iter().map(|r| r.title.clone()));
        cursor = p.page.next;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(got, sorted(&titles, true));
    let f = ResourcePageFilter { sort: Some("shares".into()), ..Default::default() };
    assert_eq!(manager_resources_page(&t, &mgr, &f).await.unwrap_err().code(), "sort_unknown");

    // Trash: the owner sees hers, sorted by title across pages
    for id in &ids {
        crud::delete(&t, &ca, NOTES, "notes", *id).await.unwrap();
    }
    let mut got = Vec::new();
    let mut cursor = None;
    loop {
        let p = PageQuery {
            limit: Some(2),
            cursor: cursor.clone(),
            sort: Some("title".into()),
            dir: dir(false),
            ..Default::default()
        };
        let page = trash::list_page(&t, &ca, None, &p).await.unwrap();
        assert_eq!(page.total, 5);
        got.extend(page.items.iter().map(|i| i.title.clone()));
        cursor = page.next;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(got, sorted(&titles, false));
    let p = PageQuery { sort: Some("bogus".into()), ..Default::default() };
    assert_eq!(trash::list_page(&t, &ca, None, &p).await.unwrap_err().code(), "sort_unknown");
    let p = PageQuery { sort: Some("title".into()), ..Default::default() };
    assert_eq!(trash::list_page(&t, &cbob, None, &p).await.unwrap().total, 0);

    // Log of the tenant: sorted by time ascending the order continues across pages
    let all = log::page(&t, Scope::Tenant(&mgr), &LogFilter { limit: Some(50), ..Default::default() })
        .await
        .unwrap()
        .events;
    assert!(all.len() > 6);
    let mut got = Vec::new();
    let mut offset = None;
    loop {
        let f = LogFilter { limit: Some(4), sort: Some("when".into()), dir: dir(false), offset, ..Default::default() };
        let p = log::page(&t, Scope::Tenant(&mgr), &f).await.unwrap();
        got.extend(p.events.iter().map(|e| (e.ts, e.id)));
        offset = p.next;
        if offset.is_none() || got.len() >= all.len() {
            break;
        }
    }
    assert!(got.windows(2).all(|w| w[0] <= w[1]));
    assert_eq!(got.first().unwrap().1, all.iter().map(|e| e.id).min().unwrap());
    let f = LogFilter { sort: Some("detail".into()), ..Default::default() };
    assert_eq!(log::page(&t, Scope::Tenant(&mgr), &f).await.unwrap_err().code(), "sort_unknown");
    // the events of another tenant never show up through the sort
    let f = LogFilter { sort: Some("who".into()), ..Default::default() };
    let beta = log::page(&t, Scope::Tenant(&mgr), &f).await.unwrap();
    assert!(beta.events.iter().all(|e| e.tenant_slug.as_deref() == Some("alfa")));
}
