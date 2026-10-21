//! Identita', tenant, membri, inviti, gruppi (richiede PostgreSQL: `cargo xtask db up`).

use mosaikit_kernel::identity::{change_password, login, logout, memberships, session};
use mosaikit_kernel::tenancy::{
    administrators, caller, create_group, create_member, directory, invite, list_tenants, members,
    my_invitations, remove_member, respond_invitation, set_administrator, set_group_member, set_role,
    set_tenant_status,
};
use mosaikit_kernel::testing::{start, PASSWORD};
use mosaikit_kernel::{Kind, Role};

#[tokio::test]
async fn login_sessione_e_logout() {
    let t = start().await;
    let admin = t.admin().await;
    assert!(admin.is_system_admin);
    assert_eq!(admin.home_tenant_slug, "system");

    let r = login(&t, "system", "admin", "sbagliata", "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::Unauthorized);
    let r = login(&t, "system", "nessuno", "x", "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::Unauthorized, "utente inesistente: stesso errore");

    let lr =
        login(&t, "System", " ADMIN ", mosaikit_kernel::testing::ADMIN_PASSWORD, "1.2.3.4").await.unwrap();
    assert_eq!(lr.token.len(), 64);
    let s = session(&t, &lr.token).await.unwrap().unwrap();
    assert_eq!(s.user_id, admin.user_id);
    assert!(session(&t, "token-falso").await.unwrap().is_none());
    logout(&t, &s).await.unwrap();
    assert!(session(&t, &lr.token).await.unwrap().is_none());
}

#[tokio::test]
async fn troppi_tentativi_bloccano_il_login() {
    let t = start().await;
    for _ in 0..8 {
        let _ = login(&t, "system", "admin", "sbagliata", "9.9.9.9").await;
    }
    let e =
        login(&t, "system", "admin", mosaikit_kernel::testing::ADMIN_PASSWORD, "9.9.9.9").await.unwrap_err();
    assert_eq!(e.kind, Kind::TooMany);
}

#[tokio::test]
async fn cambio_password_chiude_le_altre_sessioni() {
    let t = start().await;
    let gestore = t.tenant("alfa").await;
    let altra = t.login("alfa", "alfa-gestore").await;
    let e = change_password(&t, &gestore, "errata", "nuova-password-123").await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    let e = change_password(&t, &gestore, PASSWORD, "corta").await.unwrap_err();
    assert_eq!(e.kind, Kind::BadRequest);
    change_password(&t, &gestore, PASSWORD, "nuova-password-123").await.unwrap();
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
    assert!(exists(gestore.token_hash.clone()).await, "la sessione corrente resta valida");
    assert!(!exists(altra.token_hash.clone()).await, "l'altra sessione e' stata chiusa");
    assert!(login(&t, "alfa", "alfa-gestore", PASSWORD, "x").await.is_err());
    assert!(login(&t, "alfa", "alfa-gestore", "nuova-password-123", "x").await.is_ok());
}

#[tokio::test]
async fn tenant_creazione_e_sospensione() {
    let t = start().await;
    let admin = t.admin().await;
    let gestore = t.tenant("alfa").await;
    let tenants = list_tenants(&t, &admin).await.unwrap();
    assert_eq!(tenants.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(), vec!["system", "alfa"]);
    // solo l'amministratore elenca i tenant
    assert_eq!(list_tenants(&t, &gestore).await.unwrap_err().kind, Kind::Forbidden);

    let alfa = tenants.iter().find(|x| x.slug == "alfa").unwrap().id;
    set_tenant_status(&t, &admin, alfa, "suspended").await.unwrap();
    assert!(login(&t, "alfa", "alfa-gestore", PASSWORD, "x").await.is_err());
    assert_eq!(caller(&t, &gestore, "alfa").await.unwrap_err().kind, Kind::Forbidden);
    set_tenant_status(&t, &admin, alfa, "active").await.unwrap();
    assert!(login(&t, "alfa", "alfa-gestore", PASSWORD, "x").await.is_ok());
    // il tenant di sistema non si sospende
    let system = tenants.iter().find(|x| x.slug == "system").unwrap().id;
    assert!(set_tenant_status(&t, &admin, system, "suspended").await.is_err());
}

#[tokio::test]
async fn membri_e_ruoli() {
    let t = start().await;
    let gestore = t.tenant("alfa").await;
    let c = t.home(&gestore).await;
    let anna = t.member(&gestore, "anna").await;
    let ca = t.home(&anna).await;
    assert_eq!(ca.tenant.role, Role::User);
    // un membro non gestisce il tenant
    assert_eq!(members(&t, &ca).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(
        create_member(&t, &ca, "x1", "x", PASSWORD, Role::User).await.unwrap_err().kind,
        Kind::Forbidden
    );
    // username duplicato
    assert_eq!(
        create_member(&t, &c, "anna", "a", PASSWORD, Role::User).await.unwrap_err().kind,
        Kind::Conflict
    );
    // almeno un gestore
    assert!(set_role(&t, &c, gestore.user_id, Role::User).await.is_err());
    set_role(&t, &c, anna.user_id, Role::TenantManager).await.unwrap();
    set_role(&t, &c, gestore.user_id, Role::User).await.unwrap();
    assert_eq!(members(&t, &c).await.unwrap().len(), 2);
}

#[tokio::test]
async fn inviti_e_autenticazione_sul_tenant_di_appartenenza() {
    let t = start().await;
    let ga = t.tenant("alfa").await;
    let gb = t.tenant("beta").await;
    let bruno = t.member(&gb, "bruno").await;
    let ca = t.home(&ga).await;

    // bruno (beta) invitato in alfa come gestore
    let inv = invite(&t, &ca, "beta", "bruno", Role::TenantManager).await.unwrap();
    assert_eq!(inv.user, "bruno@beta");
    assert_eq!(invite(&t, &ca, "beta", "bruno", Role::User).await.unwrap_err().kind, Kind::Conflict);
    assert_eq!(caller(&t, &bruno, "alfa").await.unwrap_err().kind, Kind::Forbidden, "prima di accettare");
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

    // si autentica sempre su beta: il login su alfa fallisce
    assert!(login(&t, "alfa", "bruno", PASSWORD, "x").await.is_err());
    assert!(login(&t, "beta", "bruno", PASSWORD, "x").await.is_ok());

    // ospite nella lista membri di alfa
    let m = members(&t, &ca).await.unwrap();
    let b = m.iter().find(|x| x.username == "bruno").unwrap();
    assert!(b.is_guest);
    assert_eq!(b.home_tenant, "beta");
}

#[tokio::test]
async fn gruppi_e_rubrica() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let c = t.home(&g).await;
    let gid = create_group(&t, &c, "Ufficio GIS").await.unwrap();
    set_group_member(&t, &c, gid, anna.user_id, true).await.unwrap();
    let ext = t.tenant("beta").await;
    assert!(set_group_member(&t, &c, gid, ext.user_id, true).await.is_err(), "solo membri del tenant");
    let dir = directory(&t, &t.home(&anna).await, "").await.unwrap();
    assert!(dir.iter().any(|p| p.kind == "group" && p.name == "Ufficio GIS"));
    assert!(dir.iter().any(|p| p.kind == "user" && p.detail == "anna@alfa"));
    assert!(!dir.iter().any(|p| p.detail.ends_with("@beta")), "la rubrica mostra solo il tenant");
}

#[tokio::test]
async fn uscita_dal_tenant_di_appartenenza_disabilita_l_account() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let c = t.home(&g).await;
    let rep = remove_member(&t, &c, anna.user_id, None).await.unwrap();
    assert!(rep.disabled);
    assert!(login(&t, "alfa", "anna", PASSWORD, "x").await.is_err());
    // non si rimuove l'unico gestore
    assert!(remove_member(&t, &c, g.user_id, None).await.is_err());
}

#[tokio::test]
async fn tre_ruoli_e_piu_administrator() {
    let t = start().await;
    let admin = t.admin().await;
    let gestore = t.tenant("alfa").await;
    let anna = t.member(&gestore, "anna").await;
    // Tenant Manager e User nel tenant; nessuno dei due e' Administrator
    let cg = caller(&t, &gestore, "alfa").await.unwrap();
    assert_eq!(cg.tenant.role, Role::TenantManager);
    assert_eq!(caller(&t, &anna, "alfa").await.unwrap().tenant.role, Role::User);
    assert_eq!(administrators(&t, &gestore).await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(
        set_administrator(&t, &gestore, "alfa", "anna", true).await.unwrap_err().kind,
        Kind::Forbidden
    );
    assert_eq!(Role::parse("manager").unwrap_err().kind, Kind::BadRequest);
    assert_eq!(serde_json::to_value(Role::TenantManager).unwrap(), "tenant_manager");

    // l'unico Administrator non puo' togliersi il ruolo
    assert_eq!(
        set_administrator(&t, &admin, "system", "admin", false).await.unwrap_err().kind,
        Kind::Conflict
    );
    // un secondo Administrator, da un altro tenant
    set_administrator(&t, &admin, "alfa", "anna", true).await.unwrap();
    let list = administrators(&t, &admin).await.unwrap();
    assert_eq!(list.iter().map(|a| a.username.as_str()).collect::<Vec<_>>(), vec!["anna", "admin"]);
    let anna = login(&t, "alfa", "anna", PASSWORD, "t").await.unwrap().user;
    assert!(anna.is_system_admin);
    assert_eq!(list_tenants(&t, &anna).await.unwrap().len(), 2);
    // ora il primo puo' essere tolto; le sessioni di chi perde il ruolo sono chiuse
    let tok = login(&t, "alfa", "anna", PASSWORD, "t").await.unwrap().token;
    set_administrator(&t, &admin, "system", "admin", false).await.unwrap();
    set_administrator(&t, &anna, "system", "admin", true).await.unwrap();
    set_administrator(&t, &admin, "alfa", "anna", false).await.unwrap();
    assert!(session(&t, &tok).await.unwrap().is_none());
    assert_eq!(
        set_administrator(&t, &admin, "alfa", "nessuno", true).await.unwrap_err().kind,
        Kind::NotFound
    );
}
