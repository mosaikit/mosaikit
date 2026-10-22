//! Quotas of the tenants: quotas of the platform and of a tenant, the check at the limit (items,
//! storage, people), the alerts once per crossing, the forecast, who may read and change what,
//! isolation between tenants.

use std::collections::BTreeMap;

use chrono::Utc;
use mosaikit_kernel::notify::{self, Filter};
use mosaikit_kernel::quotas::{self, Alerts, Limits, Metric, OwnQuota, PlatformLimits, Usage};
use mosaikit_kernel::tenancy::{create_member, invite, set_member_suspended};
use mosaikit_kernel::testing::{start, TestKernel};
use mosaikit_kernel::{crud, files, Caller, Kind, Role, SessionUser};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";
const FILES: &str = "com.mosaikit.files";

async fn note(t: &TestKernel, c: &Caller, title: &str) -> mosaikit_kernel::Result<Value> {
    let v: Map<String, Value> = json!({ "title": title, "body": "text" }).as_object().unwrap().clone();
    crud::create(t, c, NOTES, "notes", &v, None).await
}

fn own(m: &str, limit: Option<i64>) -> BTreeMap<String, OwnQuota> {
    BTreeMap::from([(m.to_string(), OwnQuota { customized: true, limit })])
}

fn inherit(m: &str) -> BTreeMap<String, OwnQuota> {
    BTreeMap::from([(m.to_string(), OwnQuota { customized: false, limit: None })])
}

async fn alerts_of(t: &TestKernel, user: &SessionUser) -> Vec<(String, String)> {
    notify::list(t, user, &Filter { limit: Some(100), ..Filter::default() })
        .await
        .unwrap()
        .items
        .iter()
        .filter(|n| n.data["code"] == "quota.alert")
        .map(|n| {
            (n.data["metric"].as_str().unwrap().to_string(), n.data["level"].as_str().unwrap().to_string())
        })
        .collect()
}

struct World {
    t: TestKernel,
    admin: SessionUser,
    mgr: Caller,
    anna: Caller,
    tenant: Uuid,
}

async fn world() -> World {
    let t = start().await;
    for p in ["notes", "files"] {
        t.install(p).await;
    }
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let (mgr, anna) = (t.home(&g).await, t.home(&anna).await);
    let tenant = mgr.tenant.tenant_id;
    World { t, admin, mgr, anna, tenant }
}

#[tokio::test]
async fn quotas_of_the_platform_and_of_a_tenant() {
    let w = world().await;
    let (t, admin, tenant) = (&w.t, &w.admin, w.tenant);
    // nothing set: no limit
    assert_eq!(quotas::limits(t, tenant).await.unwrap(), Limits::default());
    // only the Administrator changes them
    let mgr_user = w.mgr.user.clone();
    let p = PlatformLimits {
        defaults: Limits { storage: Some(1000), people: Some(10), items: Some(20) },
        capacity: Limits { storage: Some(1500), people: None, items: None },
    };
    assert_eq!(quotas::set_platform(t, &mgr_user, p).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(
        quotas::set_tenant(t, &mgr_user, tenant, &own("items", Some(5))).await.unwrap_err().kind,
        Kind::Forbidden
    );
    let summary = quotas::set_platform(t, admin, p).await.unwrap();
    // the tenant inherits the quotas of the platform
    assert_eq!(quotas::limits(t, tenant).await.unwrap(), p.defaults);
    let storage = summary.rows.iter().find(|r| r.metric == Metric::Storage).unwrap();
    assert_eq!(
        (storage.default, storage.capacity, storage.given, storage.over),
        (Some(1000), Some(1500), 1000, false)
    );
    // a quota of its own, then back to the platform's
    let q = quotas::set_tenant(t, admin, tenant, &own("items", Some(5))).await.unwrap();
    let items = q.rows.iter().find(|r| r.metric == Metric::Items).unwrap();
    assert!(items.customized);
    assert_eq!((items.platform, items.limit), (Some(20), Some(5)));
    // "no limit" of its own is not "inherited"
    quotas::set_tenant(t, admin, tenant, &own("storage", None)).await.unwrap();
    assert_eq!(quotas::limits(t, tenant).await.unwrap().storage, None);
    let summary = quotas::platform(t, admin).await.unwrap();
    let storage = summary.rows.iter().find(|r| r.metric == Metric::Storage).unwrap();
    // a tenant without a limit while the platform has a capacity: more given than it has
    assert_eq!((storage.unlimited, storage.over), (1, true));
    quotas::set_tenant(t, admin, tenant, &inherit("storage")).await.unwrap();
    assert_eq!(quotas::limits(t, tenant).await.unwrap().storage, Some(1000));
    // a negative quota is refused
    let bad = PlatformLimits { defaults: Limits { items: Some(-1), ..Limits::default() }, ..p };
    assert_eq!(quotas::set_platform(t, admin, bad).await.unwrap_err().code(), "quota_invalid");
}

#[tokio::test]
async fn at_the_limit_additions_stop() {
    let w = world().await;
    let (t, admin, tenant) = (&w.t, &w.admin, w.tenant);
    // items: 2 notes, the third is refused; deleting one frees a place
    quotas::set_tenant(t, admin, tenant, &own("items", Some(2))).await.unwrap();
    let first = note(t, &w.anna, "one").await.unwrap();
    note(t, &w.anna, "two").await.unwrap();
    let err = note(t, &w.mgr, "three").await.unwrap_err();
    assert_eq!((err.kind, err.code()), (Kind::Conflict, "quota_exceeded"));
    assert_eq!(quotas::usage(t, tenant).await.unwrap().items, 2, "nothing was added");
    let id: Uuid = first["id"].as_str().unwrap().parse().unwrap();
    // an item in the trash still counts until it is deleted for good
    crud::delete(t, &w.anna, NOTES, "notes", id).await.unwrap();
    assert_eq!(note(t, &w.mgr, "three").await.unwrap_err().code(), "quota_exceeded");
    // restoring never fails on a quota: it was counted all along
    mosaikit_kernel::trash::restore(t, &w.anna, id).await.unwrap();
    crud::delete(t, &w.anna, NOTES, "notes", id).await.unwrap();
    mosaikit_kernel::trash::purge(t, &w.anna, id).await.unwrap();
    note(t, &w.anna, "three").await.unwrap();

    // storage: files up to 10 bytes; replacing a file counts only the difference
    quotas::set_tenant(t, admin, tenant, &inherit("items")).await.unwrap();
    quotas::set_tenant(t, admin, tenant, &own("storage", Some(10))).await.unwrap();
    files::upload(t, &w.anna, FILES, None, "a.txt", b"12345678", false).await.unwrap();
    let err = files::upload(t, &w.anna, FILES, None, "b.txt", b"123", false).await.unwrap_err();
    assert_eq!(err.code(), "quota_exceeded");
    files::upload(t, &w.anna, FILES, None, "a.txt", b"1234567890", true).await.unwrap();
    assert_eq!(quotas::usage(t, tenant).await.unwrap().storage, 10);
    files::upload(t, &w.anna, FILES, None, "a.txt", b"12", true).await.unwrap();
    // a folder is an item without bytes: no storage needed
    files::mkdir(t, &w.anna, FILES, None, "docs").await.unwrap();

    // people: the manager and anna; a third is refused, also by invitation; a suspension frees a place
    quotas::set_tenant(t, admin, tenant, &own("people", Some(2))).await.unwrap();
    let err = create_member(t, &w.mgr, "carla", "Carla", mosaikit_kernel::testing::PASSWORD, Role::User)
        .await
        .unwrap_err();
    assert_eq!(err.code(), "quota_exceeded");
    let beta = t.tenant("beta").await;
    t.member(&beta, "dario").await;
    assert_eq!(invite(t, &w.mgr, "beta", "dario", Role::User).await.unwrap_err().code(), "quota_exceeded");
    set_member_suspended(t, &w.mgr, w.anna.user.user_id, true).await.unwrap();
    create_member(t, &w.mgr, "carla", "Carla", mosaikit_kernel::testing::PASSWORD, Role::User).await.unwrap();
    // anna cannot come back while the tenant is full
    assert_eq!(
        set_member_suspended(t, &w.mgr, w.anna.user.user_id, false).await.unwrap_err().code(),
        "quota_exceeded"
    );
    // the quotas of another tenant are not touched
    assert_eq!(quotas::limits(t, beta.home_tenant_id).await.unwrap(), Limits::default());
}

#[tokio::test]
async fn alerts_once_per_crossing() {
    let w = world().await;
    let (t, admin, tenant) = (&w.t, &w.admin, w.tenant);
    quotas::set_tenant(t, admin, tenant, &own("items", Some(5))).await.unwrap();
    let mut ids = Vec::new();
    for i in 0..4 {
        ids.push(note(t, &w.anna, &format!("n{i}")).await.unwrap());
    }
    // 4 of 5: 80 %, to the Tenant Manager, once
    assert_eq!(quotas::evaluate(t, tenant).await.unwrap(), vec![(Metric::Items, "80")]);
    assert!(quotas::evaluate(t, tenant).await.unwrap().is_empty(), "once per crossing");
    assert_eq!(alerts_of(t, &w.mgr.user).await, vec![("items".into(), "80".into())]);
    assert!(alerts_of(t, &w.anna.user).await.is_empty(), "only the recipients");
    // 5 of 5: 100 %
    note(t, &w.anna, "n4").await.unwrap();
    assert_eq!(quotas::evaluate(t, tenant).await.unwrap(), vec![(Metric::Items, "100")]);
    // back below 80 %: the thresholds are re-armed and warn again on the next crossing
    for r in ids.iter().take(3) {
        let id: Uuid = r["id"].as_str().unwrap().parse().unwrap();
        crud::delete(t, &w.anna, NOTES, "notes", id).await.unwrap();
        mosaikit_kernel::trash::purge(t, &w.anna, id).await.unwrap();
    }
    assert!(quotas::evaluate(t, tenant).await.unwrap().is_empty());
    for i in 0..2 {
        note(t, &w.anna, &format!("m{i}")).await.unwrap();
    }
    assert_eq!(quotas::evaluate(t, tenant).await.unwrap(), vec![(Metric::Items, "80")]);

    // recipients and thresholds chosen by the Tenant Manager: anna instead of the managers, no 80 %
    let a = Alerts { at_80: false, managers: false, people: vec![w.anna.user.user_id], ..Alerts::default() };
    assert_eq!(quotas::set_alerts(t, &w.anna, a.clone()).await.unwrap_err().kind, Kind::Forbidden);
    quotas::set_alerts(t, &w.mgr, a).await.unwrap();
    note(t, &w.anna, "full").await.unwrap();
    assert_eq!(quotas::evaluate(t, tenant).await.unwrap(), vec![(Metric::Items, "100")]);
    assert_eq!(alerts_of(t, &w.anna.user).await, vec![("items".into(), "100".into())]);
    // a person of another tenant is not a recipient
    let beta = t.tenant("beta").await;
    let a = Alerts { people: vec![beta.user_id], ..Alerts::default() };
    assert!(quotas::set_alerts(t, &w.mgr, a).await.is_err());
}

#[tokio::test]
async fn forecast_and_trend() {
    let w = world().await;
    let (t, admin, tenant) = (&w.t, &w.admin, w.tenant);
    quotas::set_tenant(t, admin, tenant, &own("items", Some(100))).await.unwrap();
    for i in 0..10 {
        note(t, &w.anna, &format!("n{i}")).await.unwrap();
    }
    // ten days ago it had none: 1 a day, the limit of 100 in 90 days — no forecast alert
    let today = Utc::now().date_naive();
    quotas::record_day(t, tenant, today - chrono::Duration::days(10), Usage::default()).await.unwrap();
    assert!(quotas::evaluate(t, tenant).await.unwrap().is_empty());
    let q = quotas::tenant(t, tenant).await.unwrap();
    let items = q.rows.iter().find(|r| r.metric == Metric::Items).unwrap();
    assert_eq!((items.used, items.percent, items.forecast_days), (10, Some(10), Some(90)));
    // with a limit of 30 the pace reaches it in 20 days: one forecast alert
    quotas::set_tenant(t, admin, tenant, &own("items", Some(30))).await.unwrap();
    assert_eq!(quotas::evaluate(t, tenant).await.unwrap(), vec![(Metric::Items, "forecast")]);
    // the trend: the day recorded and today (Tenant Manager only)
    let trend = quotas::trend(t, &w.mgr, 30).await.unwrap();
    assert_eq!(trend.len(), 2);
    assert_eq!(trend.last().unwrap().items, 10);
    assert_eq!(quotas::trend(t, &w.anna, 30).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(quotas::consumers(t, &w.anna).await.unwrap_err().kind, Kind::Forbidden);
    let c = quotas::consumers(t, &w.mgr).await.unwrap();
    assert_eq!(c.people[0].items, 10);
    assert_eq!(c.plugins[0].id, NOTES);
    // one's own usage and what is left in the tenant (every member)
    let mine = quotas::mine(t, &w.anna).await.unwrap();
    assert_eq!(mine.items, 10);
    assert_eq!(mine.tenant.iter().find(|r| r.metric == Metric::Items).unwrap().limit, Some(30));
    // the alert of the sidebar: nothing below 80 %
    assert!(quotas::near(t, &w.anna).await.unwrap().is_empty());
    quotas::set_tenant(t, admin, tenant, &own("items", Some(12))).await.unwrap();
    let near = quotas::near(t, &w.anna).await.unwrap();
    assert_eq!((near.len(), near[0].percent), (1, Some(83)));
}
