//! People and permissions: permission profiles and grants of the plugins (enforced by the kernel),
//! suspension of a membership, access requests, the directory of the Administrator, links to choose a
//! new password, isolation between tenants.

use mosaikit_kernel::access::{
    self, create_profile, delete_profile, effective, plugin_access, profiles, set_member_profile,
    set_plugin_grant, update_profile, ProfileChange,
};
use mosaikit_kernel::acl::{self, Level};
use mosaikit_kernel::identity::login;
use mosaikit_kernel::tenancy::{
    self, add_to_tenant, caller, create_group, create_person, decide_request, directory_of_people,
    group_detail, member_detail, members, move_home, person_activity, person_sessions, remove_from_tenant,
    request_access, requests, reset_info, reset_link, reset_with_link, set_group_member,
    set_member_suspended, set_person_status, update_membership, why_not, By, MembershipChange, NewPerson,
};
use mosaikit_kernel::testing::{start, TestKernel, PASSWORD};
use mosaikit_kernel::{crud, Caller, Kind, Role};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

fn vals(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

async fn note(t: &TestKernel, c: &Caller, title: &str) -> mosaikit_kernel::Result<Value> {
    crud::create(t, c, NOTES, "notes", &vals(json!({ "title": title, "body": "text" })), None).await
}

fn rid(row: &Value) -> Uuid {
    row["id"].as_str().unwrap().parse().unwrap()
}

struct World {
    t: TestKernel,
    mgr: Caller,
    anna: Caller,
    bruno: Caller,
}

async fn world() -> World {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    World { mgr: t.home(&g).await, anna: t.home(&anna).await, bruno: t.home(&bruno).await, t }
}

#[tokio::test]
async fn profiles_and_grants_decide_what_a_person_may_do_in_a_plugin() {
    let w = world().await;
    let t = &w.t;
    // a new tenant has the Standard profile, the default one: every default permission
    let ps = profiles(t, &w.mgr).await.unwrap();
    assert_eq!(ps.len(), 1);
    assert!(ps[0].is_default && ps[0].name == "Standard");
    assert_eq!(ps[0].members, 3);
    let std_keys = effective(t, &w.anna, NOTES).await.unwrap();
    for k in ["use", "create", "delete", "share"] {
        assert!(std_keys.contains(k), "{k}");
    }
    note(t, &w.anna, "first").await.unwrap();

    // a profile that may only read: the kernel refuses to create, delete and share
    let reader = create_profile(t, &w.mgr, "Reader", "Opens what is shared", None).await.unwrap();
    let ch = ProfileChange {
        plugins: [(NOTES.to_string(), vec!["use".to_string()])].into(),
        ..Default::default()
    };
    update_profile(t, &w.mgr, reader.id, &ch).await.unwrap();
    set_member_profile(t, &w.mgr, w.anna.user.user_id, Some(reader.id)).await.unwrap();
    let e = note(t, &w.anna, "second").await.unwrap_err();
    assert_eq!((e.kind, e.code), (Kind::Forbidden, Some("missing_permission")));
    // reading still works: the permission does not touch the access to the items
    assert_eq!(crud::list(t, &w.anna, NOTES, "notes", None, None).await.unwrap().rows.len(), 1);
    let mine = crud::list(t, &w.anna, NOTES, "notes", None, None).await.unwrap().rows[0].clone();
    let e = acl::set_grant(t, &w.anna, rid(&mine), "user", w.bruno.user.user_id, Some(Level::Read))
        .await
        .unwrap_err();
    assert_eq!(e.code, Some("missing_permission"));

    // a grant to a group adds to the profile
    let g = create_group(t, &w.mgr, "Editors").await.unwrap();
    set_group_member(t, &w.mgr, g, w.anna.user.user_id, true).await.unwrap();
    set_plugin_grant(t, &w.mgr, NOTES, "group", g, &["create".into()]).await.unwrap();
    note(t, &w.anna, "second").await.unwrap();
    let access = plugin_access(t, &w.mgr, NOTES, "en").await.unwrap();
    assert_eq!(access.grants.len(), 1);
    assert_eq!(access.permissions[0].key, "use");
    assert!(access.permissions.iter().all(|p| p.standard));
    // the summaries say where each permission comes from
    let d = member_detail(t, &w.mgr, w.anna.user.user_id, "en").await.unwrap();
    let notes = d.permissions.iter().find(|p| p.plugin_id == NOTES).unwrap();
    let create = notes.perms.iter().find(|p| p.key == "create").unwrap();
    assert!(create.granted && create.sources.iter().any(|s| s.kind == "group" && s.name == "Editors"));
    let delete = notes.perms.iter().find(|p| p.key == "delete").unwrap();
    assert!(!delete.granted);
    let gd = group_detail(t, &w.mgr, g).await.unwrap();
    assert_eq!(gd.plugins, vec![(NOTES.to_string(), vec!["create".to_string()])]);

    // without `use` the plugin is closed
    set_plugin_grant(t, &w.mgr, NOTES, "group", g, &[]).await.unwrap();
    let none = ProfileChange { plugins: [(NOTES.to_string(), vec![])].into(), ..Default::default() };
    update_profile(t, &w.mgr, reader.id, &none).await.unwrap();
    let e = crud::list(t, &w.anna, NOTES, "notes", None, None).await.unwrap_err();
    assert_eq!(e.code, Some("missing_permission"));
    // the Tenant Manager may always do everything
    assert!(effective(t, &w.mgr, NOTES).await.unwrap().contains("delete"));
    note(t, &w.mgr, "of the manager").await.unwrap();

    // unknown permissions are refused; the default profile cannot be deleted
    let bad =
        ProfileChange { plugins: [(NOTES.to_string(), vec!["fly".into()])].into(), ..Default::default() };
    assert_eq!(update_profile(t, &w.mgr, reader.id, &bad).await.unwrap_err().kind, Kind::BadRequest);
    assert_eq!(delete_profile(t, &w.mgr, ps[0].id).await.unwrap_err().kind, Kind::BadRequest);
    // a new default profile, then the old one may go; its members get the default one
    update_profile(t, &w.mgr, reader.id, &ProfileChange { make_default: true, ..Default::default() })
        .await
        .unwrap();
    delete_profile(t, &w.mgr, ps[0].id).await.unwrap();
    let ps = profiles(t, &w.mgr).await.unwrap();
    assert_eq!((ps.len(), ps[0].is_default, ps[0].members), (1, true, 3));
    // a copy keeps the permissions of the original
    let copy = create_profile(t, &w.mgr, "Copy", "", Some(reader.id)).await.unwrap();
    assert_eq!(copy.perms[NOTES], Vec::<String>::new());
    // only the manager handles profiles
    assert_eq!(profiles(t, &w.anna).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(
        set_plugin_grant(t, &w.anna, NOTES, "user", w.anna.user.user_id, &["use".into()])
            .await
            .unwrap_err()
            .kind,
        Kind::Forbidden
    );
}

#[tokio::test]
async fn a_suspended_member_cannot_work_in_the_tenant() {
    let w = world().await;
    let t = &w.t;
    let item = note(t, &w.anna, "shared").await.unwrap();
    acl::set_grant(t, &w.anna, rid(&item), "user", w.bruno.user.user_id, Some(Level::Read)).await.unwrap();
    set_member_suspended(t, &w.mgr, w.bruno.user.user_id, true).await.unwrap();
    assert_eq!(caller(t, &w.bruno.user, "alfa").await.unwrap_err().kind, Kind::Forbidden);
    // with the old context it sees nothing: the database does not count the membership
    assert!(crud::list(t, &w.bruno, NOTES, "notes", None, None)
        .await
        .map(|l| l.rows.is_empty())
        .unwrap_or(true));
    let m = members(t, &w.mgr).await.unwrap().into_iter().find(|m| m.username == "bruno").unwrap();
    assert_eq!(m.membership, "suspended");
    set_member_suspended(t, &w.mgr, w.bruno.user.user_id, false).await.unwrap();
    let bruno = caller(t, &w.bruno.user, "alfa").await.unwrap();
    assert_eq!(crud::list(t, &bruno, NOTES, "notes", None, None).await.unwrap().rows.len(), 1);
    // the only manager stays
    assert_eq!(
        set_member_suspended(t, &w.mgr, w.mgr.user.user_id, true).await.unwrap_err().kind,
        Kind::BadRequest
    );
}

#[tokio::test]
async fn access_requests_are_decided_by_the_owner_or_a_manager() {
    let w = world().await;
    let t = &w.t;
    let item = note(t, &w.anna, "plan").await.unwrap();
    let id = rid(&item);
    // bruno cannot see it, asks to see it
    assert_eq!(acl::meta(t, &w.bruno, id).await.unwrap_err().kind, Kind::NotFound);
    let r = request_access(t, &w.bruno, id, Level::Read, "for the meeting").await.unwrap();
    assert_eq!((r.status.as_str(), r.level), ("pending", "read"));
    assert_eq!(request_access(t, &w.bruno, id, Level::Read, "").await.unwrap_err().kind, Kind::Conflict);
    // the owner sees it, the manager too (all of the tenant); bruno does not decide
    assert_eq!(requests(t, &w.anna).await.unwrap().len(), 1);
    assert_eq!(requests(t, &w.mgr).await.unwrap().len(), 1);
    assert!(requests(t, &w.bruno).await.unwrap().is_empty());
    assert_eq!(decide_request(t, &w.bruno, r.id, "approve").await.unwrap_err().kind, Kind::Forbidden);
    // the manager forwards, the owner approves
    assert_eq!(decide_request(t, &w.anna, r.id, "forward").await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(decide_request(t, &w.mgr, r.id, "forward").await.unwrap().status, "forwarded");
    assert_eq!(decide_request(t, &w.anna, r.id, "approve").await.unwrap().status, "approved");
    assert_eq!(acl::meta(t, &w.bruno, id).await.unwrap().my_level, "read");
    assert_eq!(decide_request(t, &w.anna, r.id, "refuse").await.unwrap_err().kind, Kind::Conflict);
    // with that access already, the same request makes no sense; editing is a new request
    assert_eq!(
        request_access(t, &w.bruno, id, Level::Read, "").await.unwrap_err().code,
        Some("access_already")
    );
    let edit = request_access(t, &w.bruno, id, Level::Write, "").await.unwrap();
    assert_eq!(decide_request(t, &w.mgr, edit.id, "refuse").await.unwrap().status, "refused");
    assert_eq!(acl::meta(t, &w.bruno, id).await.unwrap().my_level, "read");
    // the requester was told both answers
    let notes = mosaikit_kernel::notify::list(t, &w.bruno.user, &Default::default()).await.unwrap();
    let codes: Vec<&str> = notes.items.iter().filter_map(|n| n.data["code"].as_str()).collect();
    assert!(codes.contains(&"access.approved") && codes.contains(&"access.refused"), "{codes:?}");
    // the explanation of the manager follows the same steps
    let why = why_not(t, &w.mgr, w.bruno.user.user_id, id).await.unwrap();
    assert_eq!(why.level, "read");
    assert!(why.steps.iter().any(|s| s.code == "shared" && s.ok));
}

#[tokio::test]
async fn the_administrator_handles_every_person() {
    let t = start().await;
    let admin = t.admin().await;
    let ga = t.tenant("alfa").await;
    let gb = t.tenant("beta").await;
    let anna = t.member(&ga, "anna").await;
    let alfa = ga.home_tenant_id;
    let beta = gb.home_tenant_id;
    // the directory: everybody, the Administrator too, with their tenants
    let all = directory_of_people(&t, &admin).await.unwrap();
    assert!(all.iter().any(|p| p.is_admin));
    let a = all.iter().find(|p| p.username == "anna").unwrap();
    assert_eq!((a.home_tenant.as_str(), a.tenants.len()), ("alfa", 1));
    assert!(a.last_sign_in_at.is_some());
    assert_eq!(directory_of_people(&t, &ga).await.unwrap_err().kind, Kind::Forbidden);

    // add to a tenant at once, with a role and the default profile; change the role; move the home
    add_to_tenant(&t, &admin, anna.user_id, beta, Role::User, None).await.unwrap();
    assert_eq!(
        add_to_tenant(&t, &admin, anna.user_id, beta, Role::User, None).await.unwrap_err().kind,
        Kind::Conflict
    );
    let ch = MembershipChange { role: Some(Role::TenantManager), ..Default::default() };
    update_membership(&t, &admin, anna.user_id, beta, &ch).await.unwrap();
    assert_eq!(
        remove_from_tenant(&t, &admin, anna.user_id, alfa, None).await.unwrap_err().kind,
        Kind::BadRequest
    );
    move_home(&t, &admin, anna.user_id, beta).await.unwrap();
    assert!(login(&t, "alfa", "anna", PASSWORD, "x").await.is_err());
    let anna = login(&t, "beta", "anna", PASSWORD, "x").await.unwrap().user;
    // the old home is a tenant where she is a guest; it can go
    remove_from_tenant(&t, &admin, anna.user_id, alfa, None).await.unwrap();
    let p = tenancy::person(&t, &admin, anna.user_id).await.unwrap();
    assert_eq!((p.home_tenant.as_str(), p.tenants.len()), ("beta", 1));

    // disable: sessions closed, sign-in refused; the only manager of a tenant stays
    assert_eq!(set_person_status(&t, &admin, ga.user_id, false).await.unwrap_err().kind, Kind::Conflict);
    set_person_status(&t, &admin, anna.user_id, false).await.unwrap();
    assert!(login(&t, "beta", "anna", PASSWORD, "x").await.is_err());
    set_person_status(&t, &admin, anna.user_id, true).await.unwrap();
    // Administrators are not handled here
    assert_eq!(set_person_status(&t, &admin, admin.user_id, false).await.unwrap_err().kind, Kind::BadRequest);

    // a new person without a password: a link to choose it
    let n = NewPerson {
        username: "carla".into(),
        display_name: "Carla".into(),
        email: Some("carla@example.org".into()),
        home_tenant: alfa,
        role: Role::User,
        profile: None,
        password: None,
        others: vec![tenancy::NewMembership { tenant: beta, role: Role::User, profile: None }],
    };
    let (carla, link) = create_person(&t, &admin, &n).await.unwrap();
    assert_eq!(carla.tenants.len(), 2);
    let link = link.unwrap();
    let token = link.url.rsplit('/').next().unwrap().to_string();
    assert!(link.url.contains("#/reset/"));
    assert!(link.emailed, "queued for the address of the account");
    let info = reset_info(&t, &token).await.unwrap();
    assert_eq!((info.username.as_str(), info.min_length), ("carla", 10));
    assert_eq!(reset_with_link(&t, &token, "short").await.unwrap_err().kind, Kind::BadRequest);
    reset_with_link(&t, &token, "a-new-password-1").await.unwrap();
    login(&t, "alfa", "carla", "a-new-password-1", "x").await.unwrap();
    assert_eq!(
        reset_with_link(&t, &token, "again-password-2").await.unwrap_err().code,
        Some("reset_expired")
    );
    // two uses of the same link at the same instant: only one wins
    let again = reset_link(&t, By::Admin(&admin), carla.user_id).await.unwrap();
    let token2 = again.url.rsplit('/').next().unwrap().to_string();
    let (a, b) = tokio::join!(
        reset_with_link(&t, &token2, "first-password-3"),
        reset_with_link(&t, &token2, "second-password-4")
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1, "single use");
    let winner = if a.is_ok() { "first-password-3" } else { "second-password-4" };
    login(&t, "alfa", "carla", winner, "x").await.unwrap();
    // sessions and activity
    assert_eq!(person_sessions(&t, By::Admin(&admin), carla.user_id).await.unwrap().len(), 1);
    assert!(person_activity(&t, By::Admin(&admin), carla.user_id)
        .await
        .unwrap()
        .iter()
        .any(|e| e.action == "login"));
}

#[tokio::test]
async fn managers_only_see_and_touch_their_tenant() {
    let t = start().await;
    t.install("notes").await;
    let ga = t.tenant("alfa").await;
    let gb = t.tenant("beta").await;
    let anna = t.member(&ga, "anna").await;
    let mgr_a = t.home(&ga).await;
    let mgr_b = t.home(&gb).await;
    // the other tenant's people are not visible, nor reachable
    assert_eq!(member_detail(&t, &mgr_b, anna.user_id, "en").await.unwrap_err().kind, Kind::NotFound);
    assert!(set_plugin_grant(&t, &mgr_b, NOTES, "user", anna.user_id, &["use".into()]).await.is_err());
    assert!(set_member_profile(&t, &mgr_b, anna.user_id, None).await.is_err());
    assert_eq!(
        person_sessions(&t, By::Manager(&mgr_b), anna.user_id).await.unwrap_err().kind,
        Kind::Forbidden
    );
    // a profile of another tenant is refused
    let other = profiles(&t, &mgr_b).await.unwrap()[0].id;
    assert_eq!(
        set_member_profile(&t, &mgr_a, anna.user_id, Some(other)).await.unwrap_err().kind,
        Kind::NotFound
    );
    // a link for a member of the own tenant: yes; and sessions of home members
    reset_link(&t, By::Manager(&mgr_a), anna.user_id).await.unwrap();
    assert_eq!(person_sessions(&t, By::Manager(&mgr_a), anna.user_id).await.unwrap().len(), 1);
    let detail = member_detail(&t, &mgr_a, anna.user_id, "it").await.unwrap();
    assert!(detail.home_here);
    // access::require stays inside the tenant: the members of beta see nothing of alfa
    let item = note(&t, &t.home(&anna).await, "of alfa").await.unwrap();
    assert!(request_access(&t, &mgr_b, rid(&item), Level::Read, "").await.is_err());
    let _ = access::USE;
}

#[tokio::test]
async fn a_person_changes_their_own_name_and_picture() {
    use mosaikit_kernel::tenancy::profile;
    let t = start().await;
    let admin = t.admin().await;
    let alfa = t.tenant("alfa").await;
    let anna = t.member(&alfa, "anna").await;
    let beta = t.tenant("beta").await;

    // the name: trimmed, 1 to 120 characters, recorded in the log
    profile::set_my_name(&t, &anna, "  Anna Rossi ").await.unwrap();
    let name: String = mosaikit_db::query_scalar("select display_name from core.users where id = $1")
        .bind(anna.user_id)
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(name, "Anna Rossi");
    for bad in ["", "   ", &"x".repeat(121)] {
        let e = profile::set_my_name(&t, &anna, bad).await.unwrap_err();
        assert_eq!(e.code, Some("profile_name_invalid"), "{bad:?}");
    }
    let n: i64 = mosaikit_db::query_scalar("select count(*) from core.events where action = 'profile.name'")
        .fetch_one(&t.db)
        .await
        .unwrap();
    assert_eq!(n, 1);

    // the picture: checked like the logos, a new version every time
    let png = b"\x89PNG\r\n\x1a\nrest-of-a-picture".to_vec();
    assert_eq!(
        profile::set_my_picture(&t, &anna, b"not an image").await.unwrap_err().code,
        Some("image_type")
    );
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><script>x</script></svg>";
    assert_eq!(profile::set_my_picture(&t, &anna, svg).await.unwrap_err().code, Some("image_unsafe"));
    profile::set_my_picture(&t, &anna, &png).await.unwrap();
    let v1 = profile::picture_version(&t, anna.user_id).await.unwrap().unwrap();
    profile::set_my_picture(&t, &anna, &png).await.unwrap();
    let v2 = profile::picture_version(&t, anna.user_id).await.unwrap().unwrap();
    assert_ne!(v1, v2);

    // who sees it: the person, the people of the same tenant, the Administrators; not other tenants
    let (data, mime) = profile::picture(&t, &alfa, anna.user_id).await.unwrap().unwrap();
    assert_eq!((data, mime.as_str()), (png.clone(), "image/png"));
    assert!(profile::picture(&t, &anna, anna.user_id).await.unwrap().is_some());
    assert!(profile::picture(&t, &admin, anna.user_id).await.unwrap().is_some());
    assert!(profile::picture(&t, &beta, anna.user_id).await.unwrap().is_none());

    profile::remove_my_picture(&t, &anna).await.unwrap();
    assert!(profile::picture_version(&t, anna.user_id).await.unwrap().is_none());
    assert!(profile::picture(&t, &alfa, anna.user_id).await.unwrap().is_none());

    // an account of an identity provider: the name comes from the provider
    mosaikit_db::query("insert into core.user_identities (issuer, subject, user_id, tenant_id) values ('https://idp', 's1', $1, $2)")
        .bind(anna.user_id)
        .bind(anna.home_tenant_id)
        .execute(&t.db)
        .await
        .unwrap();
    let e = profile::set_my_name(&t, &anna, "Other").await.unwrap_err();
    assert_eq!(e.code, Some("profile_from_provider"));
    // the picture stays the person's own
    profile::set_my_picture(&t, &anna, &png).await.unwrap();
}
