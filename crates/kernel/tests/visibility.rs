//! The built-in group «All members» and the visibility summary of an item (`resources.list` and
//! `resource.shares`). Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use mosaikit_kernel::acl::{grants, set_grant, Level};
use mosaikit_kernel::tenancy::{
    create_group, delete_group, directory, groups, remove_member, set_group_member,
};
use mosaikit_kernel::testing::start;
use mosaikit_kernel::{crud, links, visibility, Kind};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

fn vals(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

async fn vis_of(t: &mosaikit_kernel::testing::TestKernel, tenant: Uuid, id: Uuid) -> &'static str {
    visibility::of(t, tenant, &[id]).await.unwrap()[&id]
}

#[tokio::test]
async fn every_tenant_has_a_group_with_all_the_members_and_nobody_edits_it() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let mgr = t.home(&g).await;
    let all =
        visibility::all_members_group(&t, mgr.tenant.tenant_id).await.unwrap().expect("the group exists");

    // the manager and the member that came in afterwards are in it (the list of people is not sent: it is every member)
    let gs = groups(&t, &mgr).await.unwrap();
    let b = gs.iter().find(|x| x.id == all).unwrap();
    assert_eq!(b.builtin.as_deref(), Some("all"));
    assert!(b.members.is_empty());
    let n: i64 = mosaikit_db::query_scalar("select count(*) from core.group_members where group_id = $1")
        .bind(all)
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(n, 2);

    // the share dialog finds it, with its marker
    let found = directory(&t, &mgr, "all").await.unwrap();
    assert!(found.iter().any(|p| p.id == all && p.builtin.as_deref() == Some("all")));

    // nobody edits it: no member added or removed, no deletion
    let me = t.home(&anna).await;
    let e = set_group_member(&t, &mgr, all, me.user.user_id, false).await.unwrap_err();
    assert_eq!(e.code, Some("group_builtin"));
    assert_eq!(delete_group(&t, &mgr, all).await.unwrap_err().code, Some("group_builtin"));

    // a member who leaves is out of it too
    remove_member(&t, &mgr, me.user.user_id, None).await.unwrap();
    let n: i64 = mosaikit_db::query_scalar("select count(*) from core.group_members where group_id = $1")
        .bind(all)
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(n, 1);
    // an ordinary group of the same name does not clash with it
    create_group(&t, &mgr, "Team").await.unwrap();
}

#[tokio::test]
async fn the_visibility_follows_the_shares_and_the_links_of_the_platform() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let mgr = t.home(&g).await;
    let (anna, bruno) = (t.home(&anna).await, t.home(&bruno).await);
    let all = visibility::all_members_group(&t, mgr.tenant.tenant_id).await.unwrap().unwrap();

    let row = crud::create(&t, &anna, NOTES, "notes", &vals(json!({ "title": "Plan", "body": "x" })), None)
        .await
        .unwrap();
    let id: Uuid = row["id"].as_str().unwrap().parse().unwrap();
    let tenant = mgr.tenant.tenant_id;
    assert_eq!(vis_of(&t, tenant, id).await, "private");

    set_grant(&t, &anna, id, "user", bruno.user.user_id, Some(Level::Read)).await.unwrap();
    assert_eq!(vis_of(&t, tenant, id).await, "shared");
    // the rows of the plugin's own list carry it too, next to `shared` and `my_level`
    let l = crud::list(&t, &anna, NOTES, "notes", None, None).await.unwrap();
    assert_eq!(l.rows[0]["visibility"], "shared");
    assert_eq!(crud::get(&t, &anna, NOTES, "notes", id).await.unwrap()["visibility"], "shared");

    // everybody: the person added after the share sees it too
    set_grant(&t, &anna, id, "group", all, Some(Level::Read)).await.unwrap();
    assert_eq!(vis_of(&t, tenant, id).await, "organization");
    let late = t.member(&g, "carla").await;
    let late = t.home(&late).await;
    assert_eq!(crud::list(&t, &late, NOTES, "notes", None, None).await.unwrap().rows.len(), 1);

    let link = links::create(&t, &anna, id, None, None).await.unwrap();
    assert_eq!(vis_of(&t, tenant, id).await, "public");
    links::revoke(&t, &anna, link.info.id).await.unwrap();
    assert_eq!(vis_of(&t, tenant, id).await, "organization");
    set_grant(&t, &anna, id, "group", all, None).await.unwrap();
    assert_eq!(vis_of(&t, tenant, id).await, "shared");

    // the share list for the plugin that owns the item: who manages it, who may read it
    let s = visibility::shares_from_logic(&t, &anna, NOTES, &[], &json!({ "id": id })).await.unwrap();
    assert_eq!(s["visibility"], "shared");
    assert_eq!(s["shares"].as_array().unwrap().len(), 1);
    assert_eq!(s["shares"][0]["principal_id"], bruno.user.user_id.to_string());
    assert!(s["links"].as_array().unwrap().is_empty());
    // a person with the read level does not see the list, and another plugin needs `resources_read`
    let e = visibility::shares_from_logic(&t, &bruno, NOTES, &[], &json!({ "id": id })).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    let e =
        visibility::shares_from_logic(&t, &anna, "com.other", &[], &json!({ "id": id })).await.unwrap_err();
    assert_eq!(e.code, Some("permission_denied"));
    assert_eq!(grants(&t, &anna, id).await.unwrap().len(), 1);
}
