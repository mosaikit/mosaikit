//! Identity, tenants, members, invitations, groups (requires PostgreSQL: `cargo xtask db up`).

use mosaikit_kernel::identity::{
    admin_login, change_password, login, logout, memberships, pending_session, session, totp_enable,
    totp_setup, totp_verify, AdminLogin,
};
use mosaikit_kernel::tenancy::{
    administrators, caller, create_administrator, create_group, create_member, create_tenant_manager,
    directory, invite, list_tenants, login_tenants, members, my_invitations, remove_member,
    reset_administrator_totp, reset_member_password, reset_tenant_password, respond_invitation,
    set_administrator_active, set_group_member, set_role, set_shell_band, set_tenant_role, set_tenant_status,
    shell_band, tenant_members, ShellBand,
};
use mosaikit_kernel::testing::{start, start_with, ADMIN_PASSWORD, PASSWORD};
use mosaikit_kernel::{totp, Kind, Role};

#[tokio::test]
async fn login_session_and_logout() {
    let t = start().await;
    let admin = t.admin().await;
    assert!(admin.is_system_admin);
    assert_eq!(admin.home_tenant_slug, "system");
    let mgr = t.tenant("alfa").await;

    let r = login(&t, "alfa", "alfa-manager", "wrong-pass", "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::Unauthorized);
    let r = login(&t, "alfa", "nobody", "x", "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::Unauthorized, "unknown user: same error");
    let r = admin_login(&t, "admin", "wrong-pass", "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::Unauthorized);
    // Administrators do not sign in from the form of the tenants
    let r = login(&t, "system", "admin", ADMIN_PASSWORD, "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::BadRequest);
    // and users of the tenants do not sign in as Administrators
    assert!(admin_login(&t, "alfa-manager", PASSWORD, "1.2.3.4").await.is_err());

    let lr = login(&t, "Alfa", " ALFA-MANAGER ", PASSWORD, "1.2.3.4").await.unwrap();
    assert_eq!(lr.token.len(), 64);
    let s = session(&t, &lr.token).await.unwrap().unwrap();
    assert_eq!(s.user_id, mgr.user_id);
    assert!(session(&t, "fake-token").await.unwrap().is_none());
    logout(&t, &s).await.unwrap();
    assert!(session(&t, &lr.token).await.unwrap().is_none());
}

#[tokio::test]
async fn too_many_attempts_block_the_login() {
    let t = start().await;
    for _ in 0..8 {
        let _ = admin_login(&t, "admin", "wrong-pass", "9.9.9.9").await;
    }
    let e = admin_login(&t, "admin", ADMIN_PASSWORD, "9.9.9.9").await.unwrap_err();
    assert_eq!(e.kind, Kind::TooMany);
}

#[tokio::test]
async fn password_change_closes_the_other_sessions() {
    let t = start().await;
    let mgr = t.tenant("alfa").await;
    let other_session = t.login("alfa", "alfa-manager").await;
    let e = change_password(&t, &mgr, "wrong", "new-password-123").await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    let e = change_password(&t, &mgr, PASSWORD, "short").await.unwrap_err();
    assert_eq!(e.kind, Kind::BadRequest);
    change_password(&t, &mgr, PASSWORD, "new-password-123").await.unwrap();
    let exists = |h: Vec<u8>| {
        let k = t.k.clone();
        async move {
            mosaikit_db::query_scalar::<bool>(
                "select exists (select 1 from core.sessions where token_hash = $1)",
            )
            .bind(h)
            .fetch_one(&k.db)
            .await
            .unwrap()
        }
    };
    assert!(exists(mgr.token_hash.clone()).await, "the current session stays valid");
    assert!(!exists(other_session.token_hash.clone()).await, "the other session was closed");
    assert!(login(&t, "alfa", "alfa-manager", PASSWORD, "x").await.is_err());
    assert!(login(&t, "alfa", "alfa-manager", "new-password-123", "x").await.is_ok());
}

#[tokio::test]
async fn tenant_creation_and_suspension() {
    let t = start().await;
    let admin = t.admin().await;
    let mgr = t.tenant("alfa").await;
    let tenants = list_tenants(&t, &admin).await.unwrap();
    // the system tenant is not among the tenants (nor on the sign-in page)
    assert_eq!(tenants.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(), vec!["alfa"]);
    let public = login_tenants(&t).await.unwrap();
    assert_eq!(public.iter().map(|x| (x.slug.as_str(), x.auth)).collect::<Vec<_>>(), vec![("alfa", "local")]);
    // only the administrator lists the tenants
    assert_eq!(list_tenants(&t, &mgr).await.unwrap_err().kind, Kind::Forbidden);

    let alfa = tenants.iter().find(|x| x.slug == "alfa").unwrap().id;
    set_tenant_status(&t, &admin, alfa, "suspended").await.unwrap();
    assert!(login_tenants(&t).await.unwrap().is_empty());
    assert!(login(&t, "alfa", "alfa-manager", PASSWORD, "x").await.is_err());
    assert_eq!(caller(&t, &mgr, "alfa").await.unwrap_err().kind, Kind::Forbidden);
    set_tenant_status(&t, &admin, alfa, "active").await.unwrap();
    assert!(login(&t, "alfa", "alfa-manager", PASSWORD, "x").await.is_ok());
    // the system tenant cannot be suspended
    let system: uuid::Uuid = mosaikit_db::query_scalar("select id from core.tenants where is_system")
        .fetch_one(&t.k.db)
        .await
        .unwrap();
    assert!(set_tenant_status(&t, &admin, system, "suspended").await.is_err());
}

#[tokio::test]
async fn members_and_roles() {
    let t = start().await;
    let mgr = t.tenant("alfa").await;
    let c = t.home(&mgr).await;
    let anna = t.member(&mgr, "anna").await;
    let ca = t.home(&anna).await;
    assert_eq!(ca.tenant.role, Role::User);
    // a member does not manage the tenant
    assert_eq!(members(&t, &ca).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(
        create_member(&t, &ca, "x1", "x", PASSWORD, Role::User).await.unwrap_err().kind,
        Kind::Forbidden
    );
    // duplicate username
    assert_eq!(
        create_member(&t, &c, "anna", "a", PASSWORD, Role::User).await.unwrap_err().kind,
        Kind::Conflict
    );
    // at least one manager
    assert!(set_role(&t, &c, mgr.user_id, Role::User).await.is_err());
    set_role(&t, &c, anna.user_id, Role::TenantManager).await.unwrap();
    set_role(&t, &c, mgr.user_id, Role::User).await.unwrap();
    assert_eq!(members(&t, &c).await.unwrap().len(), 2);
}

#[tokio::test]
async fn invitations_and_sign_in_on_the_home_tenant() {
    let t = start().await;
    let ga = t.tenant("alfa").await;
    let gb = t.tenant("beta").await;
    let bruno = t.member(&gb, "bruno").await;
    let ca = t.home(&ga).await;

    // bruno (beta) invited into alfa as manager
    let inv = invite(&t, &ca, "beta", "bruno", Role::TenantManager).await.unwrap();
    assert_eq!(inv.user, "bruno@beta");
    assert_eq!(invite(&t, &ca, "beta", "bruno", Role::User).await.unwrap_err().kind, Kind::Conflict);
    assert_eq!(caller(&t, &bruno, "alfa").await.unwrap_err().kind, Kind::Forbidden, "before accepting");
    let mine = my_invitations(&t, &bruno).await.unwrap();
    assert_eq!(mine.len(), 1);
    respond_invitation(&t, &bruno, mine[0].id, true).await.unwrap();

    let in_alfa = caller(&t, &bruno, "alfa").await.unwrap();
    assert_eq!(in_alfa.tenant.role, Role::TenantManager);
    assert_eq!(caller(&t, &bruno, "beta").await.unwrap().tenant.role, Role::User);
    let ms = memberships(&t, &bruno).await.unwrap();
    assert_eq!(
        ms.iter().map(|m| (m.slug.as_str(), m.is_home)).collect::<Vec<_>>(),
        vec![("beta", true), ("alfa", false)]
    );

    // always signs in on beta: the sign-in on alfa fails
    assert!(login(&t, "alfa", "bruno", PASSWORD, "x").await.is_err());
    assert!(login(&t, "beta", "bruno", PASSWORD, "x").await.is_ok());

    // guest in the member list of alfa
    let m = members(&t, &ca).await.unwrap();
    let b = m.iter().find(|x| x.username == "bruno").unwrap();
    assert!(b.is_guest);
    assert_eq!(b.home_tenant, "beta");
}

#[tokio::test]
async fn groups_and_directory() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let c = t.home(&g).await;
    let gid = create_group(&t, &c, "GIS office").await.unwrap();
    set_group_member(&t, &c, gid, anna.user_id, true).await.unwrap();
    let ext = t.tenant("beta").await;
    assert!(set_group_member(&t, &c, gid, ext.user_id, true).await.is_err(), "members of the tenant only");
    let dir = directory(&t, &t.home(&anna).await, "").await.unwrap();
    assert!(dir.iter().any(|p| p.kind == "group" && p.name == "GIS office"));
    assert!(dir.iter().any(|p| p.kind == "user" && p.detail == "anna@alfa"));
    assert!(!dir.iter().any(|p| p.detail.ends_with("@beta")), "the directory shows only the tenant");
}

#[tokio::test]
async fn leaving_the_home_tenant_disables_the_account() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let c = t.home(&g).await;
    let rep = remove_member(&t, &c, anna.user_id, None).await.unwrap();
    assert!(rep.disabled);
    assert!(login(&t, "alfa", "anna", PASSWORD, "x").await.is_err());
    // the only manager cannot be removed
    assert!(remove_member(&t, &c, g.user_id, None).await.is_err());
}

#[tokio::test]
async fn administrator_account_of_the_system_tenant() {
    let t = start().await;
    let admin = t.admin().await;
    let mgr = t.tenant("alfa").await;
    let anna = t.member(&mgr, "anna").await;
    // Tenant Manager and User in the tenant; neither is an Administrator
    let cg = caller(&t, &mgr, "alfa").await.unwrap();
    assert_eq!(cg.tenant.role, Role::TenantManager);
    assert_eq!(caller(&t, &anna, "alfa").await.unwrap().tenant.role, Role::User);
    assert_eq!(administrators(&t, &mgr).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(create_administrator(&t, &mgr, "anna", "", PASSWORD).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(Role::parse("manager").unwrap_err().kind, Kind::BadRequest);
    assert_eq!(serde_json::to_value(Role::TenantManager).unwrap(), "tenant_manager");

    // the system tenant is not a workspace: no membership, no caller
    assert!(memberships(&t, &admin).await.unwrap().is_empty());
    assert_eq!(caller(&t, &admin, "system").await.unwrap_err().kind, Kind::Forbidden);
    // a manager does not find, invite or touch the Administrator accounts
    assert_eq!(invite(&t, &cg, "system", "admin", Role::User).await.unwrap_err().kind, Kind::NotFound);
    assert_eq!(
        reset_member_password(&t, &cg, admin.user_id, "stolen-password-1").await.unwrap_err().kind,
        Kind::Forbidden
    );

    // the only Administrator cannot disable themself
    assert_eq!(
        set_administrator_active(&t, &admin, admin.user_id, false).await.unwrap_err().kind,
        Kind::Conflict
    );
    // a second Administrator: a new account of the system tenant, even with the same
    // name as a user of a tenant (they are distinct accounts)
    let id = create_administrator(&t, &admin, "anna", "Anna Admin", PASSWORD).await.unwrap();
    assert_ne!(id, anna.user_id);
    assert_eq!(
        create_administrator(&t, &admin, "anna", "", PASSWORD).await.unwrap_err().kind,
        Kind::Conflict
    );
    let list = administrators(&t, &admin).await.unwrap();
    assert_eq!(list.iter().map(|a| a.username.as_str()).collect::<Vec<_>>(), vec!["admin", "anna"]);
    let AdminLogin::Done(lr) = admin_login(&t, "anna", PASSWORD, "t").await.unwrap() else {
        panic!("incomplete sign-in")
    };
    assert!(lr.user.is_system_admin && lr.user.user_id == id);
    // anna's account in the tenant stays a plain User
    assert!(!login(&t, "alfa", "anna", PASSWORD, "t").await.unwrap().user.is_system_admin);
    assert_eq!(caller(&t, &anna, "alfa").await.unwrap().tenant.role, Role::User);

    // disabled: loses the sessions, cannot sign in; reactivated: signs in again
    set_administrator_active(&t, &admin, id, false).await.unwrap();
    assert!(session(&t, &lr.token).await.unwrap().is_none());
    assert!(admin_login(&t, "anna", PASSWORD, "t").await.is_err());
    set_administrator_active(&t, &admin, id, true).await.unwrap();
    assert!(admin_login(&t, "anna", PASSWORD, "t").await.is_ok());
    // a user of the tenants is not an Administrator to manage
    assert_eq!(
        set_administrator_active(&t, &admin, anna.user_id, false).await.unwrap_err().kind,
        Kind::NotFound
    );
}

#[tokio::test]
async fn administrator_acts_on_the_tenants() {
    let t = start().await;
    let admin = t.admin().await;
    let mgr = t.tenant("alfa").await;
    let anna = t.member(&mgr, "anna").await;
    let alfa = list_tenants(&t, &admin).await.unwrap()[0].id;
    assert_eq!(tenant_members(&t, &mgr, alfa).await.unwrap_err().kind, Kind::Forbidden);
    let m = tenant_members(&t, &admin, alfa).await.unwrap();
    assert_eq!(m.iter().map(|x| x.username.as_str()).collect::<Vec<_>>(), vec!["alfa-manager", "anna"]);

    // appoints a new manager, promotes anna, unlocks the password of the manager
    create_tenant_manager(&t, &admin, alfa, "newbie", "Newbie", PASSWORD).await.unwrap();
    assert_eq!(
        caller(&t, &t.login("alfa", "newbie").await, "alfa").await.unwrap().tenant.role,
        Role::TenantManager
    );
    set_tenant_role(&t, &admin, alfa, anna.user_id, Role::TenantManager).await.unwrap();
    assert_eq!(caller(&t, &anna, "alfa").await.unwrap().tenant.role, Role::TenantManager);
    reset_tenant_password(&t, &admin, alfa, mgr.user_id, "new-password-1").await.unwrap();
    assert!(login(&t, "alfa", "alfa-manager", "new-password-1", "t").await.is_ok());

    // never on the system tenant
    let system: uuid::Uuid = mosaikit_db::query_scalar("select id from core.tenants where is_system")
        .fetch_one(&t.k.db)
        .await
        .unwrap();
    assert_eq!(tenant_members(&t, &admin, system).await.unwrap_err().kind, Kind::BadRequest);
    assert!(create_tenant_manager(&t, &admin, system, "x1", "", PASSWORD).await.is_err());
    assert!(reset_tenant_password(&t, &admin, system, admin.user_id, "new-password-2").await.is_err());
}

#[tokio::test]
async fn no_tenant_stays_without_a_manager() {
    let t = start().await;
    let ga = t.tenant("alfa").await;
    let gb = t.tenant("beta").await;
    let anna = t.member(&ga, "anna").await;
    // anna (of alfa) becomes the only manager of beta
    let cb = t.home(&gb).await;
    let inv = invite(&t, &cb, "alfa", "anna", Role::TenantManager).await.unwrap();
    respond_invitation(&t, &anna, inv.id, true).await.unwrap();
    // the original manager of beta leaves: anna stays the only Tenant Manager
    let cab = caller(&t, &anna, "beta").await.unwrap();
    remove_member(&t, &cab, gb.user_id, None).await.unwrap();
    // alfa cannot disable anna: beta would stay without a Tenant Manager
    let ca = t.home(&ga).await;
    let e = remove_member(&t, &ca, anna.user_id, None).await.unwrap_err();
    assert_eq!(e.kind, Kind::Conflict);
    assert!(e.to_string().contains("beta"));
}

#[tokio::test]
async fn second_factor_of_the_administrators() {
    let t = start_with(|c| c.admin_totp = true).await;
    // first sign-in: registration of the app
    let AdminLogin::Pending { token, step, .. } =
        admin_login(&t, "admin", ADMIN_PASSWORD, "t").await.unwrap()
    else {
        panic!("expected the second factor")
    };
    assert_eq!(step, "totp_setup");
    // the pending session is not good for the APIs
    assert!(session(&t, &token).await.unwrap().is_none());
    let p = pending_session(&t, &token).await.unwrap().unwrap();
    assert!(totp_verify(&t, &p, "000000", "t").await.is_err(), "the app must be registered first");
    let setup = totp_setup(&t, &p).await.unwrap();
    assert!(setup.uri.starts_with("otpauth://totp/") && setup.qr_svg.contains("<svg"));
    let secret = totp::base32_decode(&setup.secret).unwrap();
    let now = totp::current_step();
    assert_eq!(totp_enable(&t, &p, "12345", "t").await.unwrap_err().kind, Kind::Unauthorized);
    let (lr, codes) = totp_enable(&t, &p, &totp::code(&secret, now), "t").await.unwrap();
    assert!(lr.user.is_system_admin);
    assert_eq!(codes.len(), 10);
    assert!(pending_session(&t, &token).await.unwrap().is_none(), "the pending session is closed");
    assert!(administrators(&t, &lr.user).await.unwrap()[0].totp);

    // following sign-ins: code of the app, never the same one twice
    let pending = |t: &mosaikit_kernel::testing::TestKernel| {
        let k = t.k.clone();
        async move {
            match admin_login(&k, "admin", ADMIN_PASSWORD, "t").await.unwrap() {
                AdminLogin::Pending { token, step, .. } => {
                    assert_eq!(step, "totp");
                    pending_session(&k, &token).await.unwrap().unwrap()
                }
                AdminLogin::Done(_) => panic!("expected the code"),
            }
        }
    };
    let p = pending(&t).await;
    assert!(totp_verify(&t, &p, &totp::code(&secret, now), "t").await.is_err(), "code already used");
    totp_verify(&t, &p, &totp::code(&secret, now + 1), "t").await.unwrap();
    // recovery codes: single use
    let p = pending(&t).await;
    totp_verify(&t, &p, &codes[0].to_uppercase(), "t").await.unwrap();
    let p = pending(&t).await;
    assert!(totp_verify(&t, &p, &codes[0], "t").await.is_err());

    // another Administrator can reset it (lost phone): one registers again
    let admin = lr.user;
    create_administrator(&t, &admin, "bis", "", PASSWORD).await.unwrap();
    let AdminLogin::Pending { step, .. } = admin_login(&t, "bis", PASSWORD, "t").await.unwrap() else {
        panic!("expected the second factor")
    };
    assert_eq!(step, "totp_setup");
    reset_administrator_totp(&t, &admin, admin.user_id).await.unwrap();
    let AdminLogin::Pending { step, .. } = admin_login(&t, "admin", ADMIN_PASSWORD, "t").await.unwrap()
    else {
        panic!("expected the second factor")
    };
    assert_eq!(step, "totp_setup");
}

#[tokio::test]
async fn work_tenant_at_the_first_start() {
    let t = start_with(|c| c.initial_tenant = Some("locale".into())).await;
    let public = login_tenants(&t).await.unwrap();
    assert_eq!(public.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(), vec!["locale"]);
    // credentials generated in the file of the data folder
    let file =
        std::fs::read_to_string(t.cfg.data_dir.join(mosaikit_kernel::identity::INITIAL_CREDENTIALS)).unwrap();
    let section = &file[file.find("username: utente").expect("credentials of the user")..];
    let password = section.lines().find_map(|l| l.strip_prefix("password: ")).unwrap();
    let u = login(&t, "locale", "utente", password, "t").await.unwrap().user;
    assert_eq!(caller(&t, &u, "locale").await.unwrap().tenant.role, Role::TenantManager);
    // already created: a new start does not create it again
    mosaikit_kernel::identity::bootstrap(&t).await.unwrap();
    assert_eq!(login_tenants(&t).await.unwrap().len(), 1);
}

#[tokio::test]
async fn initial_password_of_the_distribution() {
    let t = start_with(|c| {
        c.initial_tenant = Some("locale".into());
        c.initial_password = Some("mosaikit".into());
    })
    .await;
    // even if shorter than the policy, for both accounts of the first start
    let u = login(&t, "locale", "utente", "mosaikit", "t").await.unwrap().user;
    let file =
        std::fs::read_to_string(t.cfg.data_dir.join(mosaikit_kernel::identity::INITIAL_CREDENTIALS)).unwrap();
    assert_eq!(file.matches("password: mosaikit").count(), 2, "{file}");
    // after changing it the policy holds again
    assert_eq!(change_password(&t, &u, "mosaikit", "short").await.unwrap_err().kind, Kind::BadRequest);
}

#[tokio::test]
async fn top_bar_decided_by_the_administrator() {
    let t = start().await;
    let admin = t.admin().await;
    let mgr = t.tenant("alfa").await;
    // at the beginning everything on
    assert_eq!(shell_band(&t).await.unwrap(), ShellBand::default());
    assert!(ShellBand::default().logo && ShellBand::default().mode);
    let band = ShellBand { logo: false, search: false, lang: true, help: false, mode: true };
    // only the Administrator changes it
    assert_eq!(set_shell_band(&t, &mgr, &band).await.unwrap_err().kind, Kind::Forbidden);
    set_shell_band(&t, &admin, &band).await.unwrap();
    assert_eq!(shell_band(&t).await.unwrap(), band);
    // it does not touch the other settings of the system tenant
    set_shell_band(&t, &admin, &ShellBand::default()).await.unwrap();
    assert_eq!(shell_band(&t).await.unwrap(), ShellBand::default());
}

#[tokio::test]
async fn theme_of_the_platform_and_of_the_tenant() {
    use mosaikit_kernel::tenancy::{
        platform_theme, set_platform_theme, set_settings, set_tenant_theme, tenant_theme,
    };
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let mgr = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let alfa = mgr.tenant.tenant_id;
    // at the beginning the default theme, inherited by the tenant
    assert_eq!(platform_theme(&t).await.unwrap(), "mosaikit");
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().tenant, None);
    // the platform: only the Administrator
    assert_eq!(set_platform_theme(&t, &g, "italia").await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(set_platform_theme(&t, &admin, "Not Valid").await.unwrap_err().kind, Kind::BadRequest);
    set_platform_theme(&t, &admin, "italia").await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "italia", "the tenant inherits");
    // the tenant: only the Tenant Manager, not whoever works in it
    assert_eq!(set_tenant_theme(&t, &anna, Some("mosaikit")).await.unwrap_err().kind, Kind::Forbidden);
    set_tenant_theme(&t, &mgr, Some("mosaikit")).await.unwrap();
    let th = tenant_theme(&t, alfa).await.unwrap();
    assert_eq!(
        (th.platform.as_str(), th.tenant.as_deref(), th.preset.as_str()),
        ("italia", Some("mosaikit"), "mosaikit")
    );
    // the policies of the tenant do not erase the theme
    set_settings(&t, &mgr, &mgr.tenant.settings).await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "mosaikit");
    // again the one of the platform
    set_tenant_theme(&t, &mgr, None).await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "italia");
}
