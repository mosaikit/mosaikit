//! Groups of the identity provider mirrored in the tenant: created at the sign-in, membership refreshed,
//! read-only in Mosaikit, never deleted (the shares stay).

use mosaikit_kernel::acl::{set_grant, Level};
use mosaikit_kernel::oidc::sync_groups;
use mosaikit_kernel::tenancy::{create_group, delete_group, groups, set_group_member};
use mosaikit_kernel::testing::start;
use mosaikit_kernel::{crud, Kind};
use serde_json::json;
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

fn names(v: &[String]) -> Vec<String> {
    v.to_vec()
}

#[tokio::test]
async fn groups_of_the_provider() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let mgr = t.home(&g).await;
    let (anna_c, bruno_c) = (t.home(&anna).await, t.home(&bruno).await);
    let tenant = mgr.tenant.tenant_id;
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();

    // a group of Mosaikit already called "sales": the one of the provider gets another name
    create_group(&t, &mgr, "sales").await.unwrap();
    sync_groups(&t, tenant, anna.user_id, &names(&s(&["staff", "sales"]))).await.unwrap();
    sync_groups(&t, tenant, bruno.user_id, &names(&s(&["staff"]))).await.unwrap();
    let all = groups(&t, &mgr).await.unwrap();
    let find = |name: &str| all.iter().find(|x| x.name == name).cloned().unwrap();
    let staff = find("staff");
    assert_eq!(staff.source, "idp");
    let mut members: Vec<Uuid> = staff.members.iter().map(|m| m.user_id).collect();
    members.sort();
    let mut expected = vec![anna.user_id, bruno.user_id];
    expected.sort();
    assert_eq!(members, expected);
    assert_eq!(find("sales").source, "mosaikit");
    assert_eq!(find("sales (identity provider)").source, "idp");

    // read-only in Mosaikit
    let e = delete_group(&t, &mgr, staff.id).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::BadRequest, "group_from_idp"));
    let e = set_group_member(&t, &mgr, staff.id, mgr.user.user_id, true).await.unwrap_err();
    assert_eq!(e.code(), "group_from_idp");

    // a share to a group of the provider works like any other
    let row = crud::create(
        &t,
        &anna_c,
        NOTES,
        "notes",
        json!({ "title": "plan", "body": "x" }).as_object().unwrap(),
        None,
    )
    .await
    .unwrap();
    let rid: Uuid = row["id"].as_str().unwrap().parse().unwrap();
    set_grant(&t, &anna_c, rid, "group", staff.id, Some(Level::Read)).await.unwrap();
    assert!(crud::get(&t, &bruno_c, NOTES, "notes", rid).await.is_ok(), "bruno sees it through staff");

    // the provider no longer sends "staff" for bruno: he leaves the group at his next sign-in; the group
    // and its share stay
    sync_groups(&t, tenant, bruno.user_id, &[]).await.unwrap();
    assert_eq!(crud::get(&t, &bruno_c, NOTES, "notes", rid).await.unwrap_err().kind, Kind::NotFound);
    let staff2 = groups(&t, &mgr).await.unwrap().into_iter().find(|x| x.id == staff.id).unwrap();
    assert_eq!(staff2.members.len(), 1, "anna stays");
    // the same sign-in again changes nothing
    sync_groups(&t, tenant, anna.user_id, &names(&s(&["staff", "sales"]))).await.unwrap();
    assert_eq!(groups(&t, &mgr).await.unwrap().len(), all.len());
}
