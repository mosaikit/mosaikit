//! Identita', tenant, membri, inviti, gruppi (richiede PostgreSQL: `cargo xtask db up`).

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
async fn login_sessione_e_logout() {
    let t = start().await;
    let admin = t.admin().await;
    assert!(admin.is_system_admin);
    assert_eq!(admin.home_tenant_slug, "system");
    let gestore = t.tenant("alfa").await;

    let r = login(&t, "alfa", "alfa-gestore", "sbagliata", "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::Unauthorized);
    let r = login(&t, "alfa", "nessuno", "x", "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::Unauthorized, "utente inesistente: stesso errore");
    let r = admin_login(&t, "admin", "sbagliata", "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::Unauthorized);
    // gli Administrator non accedono dal form dei tenant
    let r = login(&t, "system", "admin", ADMIN_PASSWORD, "1.2.3.4").await.unwrap_err();
    assert_eq!(r.kind, Kind::BadRequest);
    // e gli utenti dei tenant non accedono come Administrator
    assert!(admin_login(&t, "alfa-gestore", PASSWORD, "1.2.3.4").await.is_err());

    let lr = login(&t, "Alfa", " ALFA-GESTORE ", PASSWORD, "1.2.3.4").await.unwrap();
    assert_eq!(lr.token.len(), 64);
    let s = session(&t, &lr.token).await.unwrap().unwrap();
    assert_eq!(s.user_id, gestore.user_id);
    assert!(session(&t, "token-falso").await.unwrap().is_none());
    logout(&t, &s).await.unwrap();
    assert!(session(&t, &lr.token).await.unwrap().is_none());
}

#[tokio::test]
async fn troppi_tentativi_bloccano_il_login() {
    let t = start().await;
    for _ in 0..8 {
        let _ = admin_login(&t, "admin", "sbagliata", "9.9.9.9").await;
    }
    let e = admin_login(&t, "admin", ADMIN_PASSWORD, "9.9.9.9").await.unwrap_err();
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
    // il tenant di sistema non e' tra i tenant (ne' nella pagina di accesso)
    assert_eq!(tenants.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(), vec!["alfa"]);
    let pubblici = login_tenants(&t).await.unwrap();
    assert_eq!(
        pubblici.iter().map(|x| (x.slug.as_str(), x.auth)).collect::<Vec<_>>(),
        vec![("alfa", "local")]
    );
    // solo l'amministratore elenca i tenant
    assert_eq!(list_tenants(&t, &gestore).await.unwrap_err().kind, Kind::Forbidden);

    let alfa = tenants.iter().find(|x| x.slug == "alfa").unwrap().id;
    set_tenant_status(&t, &admin, alfa, "suspended").await.unwrap();
    assert!(login_tenants(&t).await.unwrap().is_empty());
    assert!(login(&t, "alfa", "alfa-gestore", PASSWORD, "x").await.is_err());
    assert_eq!(caller(&t, &gestore, "alfa").await.unwrap_err().kind, Kind::Forbidden);
    set_tenant_status(&t, &admin, alfa, "active").await.unwrap();
    assert!(login(&t, "alfa", "alfa-gestore", PASSWORD, "x").await.is_ok());
    // il tenant di sistema non si sospende
    let system: uuid::Uuid = mosaikit_db::query_scalar("select id from core.tenants where is_system")
        .fetch_one(&t.k.db)
        .await
        .unwrap();
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
async fn administrator_account_del_tenant_di_sistema() {
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
        create_administrator(&t, &gestore, "anna", "", PASSWORD).await.unwrap_err().kind,
        Kind::Forbidden
    );
    assert_eq!(Role::parse("manager").unwrap_err().kind, Kind::BadRequest);
    assert_eq!(serde_json::to_value(Role::TenantManager).unwrap(), "tenant_manager");

    // il tenant di sistema non e' uno spazio di lavoro: nessuna membership, nessun caller
    assert!(memberships(&t, &admin).await.unwrap().is_empty());
    assert_eq!(caller(&t, &admin, "system").await.unwrap_err().kind, Kind::Forbidden);
    // un gestore non trova, non invita e non tocca gli account Administrator
    assert_eq!(invite(&t, &cg, "system", "admin", Role::User).await.unwrap_err().kind, Kind::NotFound);
    assert_eq!(
        reset_member_password(&t, &cg, admin.user_id, "password-rubata-1").await.unwrap_err().kind,
        Kind::Forbidden
    );

    // l'unico Administrator non puo' disabilitarsi
    assert_eq!(
        set_administrator_active(&t, &admin, admin.user_id, false).await.unwrap_err().kind,
        Kind::Conflict
    );
    // un secondo Administrator: account nuovo del tenant di sistema, anche con lo stesso
    // nome di un utente di un tenant (sono account distinti)
    let id = create_administrator(&t, &admin, "anna", "Anna Admin", PASSWORD).await.unwrap();
    assert_ne!(id, anna.user_id);
    assert_eq!(
        create_administrator(&t, &admin, "anna", "", PASSWORD).await.unwrap_err().kind,
        Kind::Conflict
    );
    let list = administrators(&t, &admin).await.unwrap();
    assert_eq!(list.iter().map(|a| a.username.as_str()).collect::<Vec<_>>(), vec!["admin", "anna"]);
    let AdminLogin::Done(lr) = admin_login(&t, "anna", PASSWORD, "t").await.unwrap() else {
        panic!("accesso incompleto")
    };
    assert!(lr.user.is_system_admin && lr.user.user_id == id);
    // l'account di anna nel tenant resta un semplice User
    assert!(!login(&t, "alfa", "anna", PASSWORD, "t").await.unwrap().user.is_system_admin);
    assert_eq!(caller(&t, &anna, "alfa").await.unwrap().tenant.role, Role::User);

    // disabilitato: perde le sessioni, non accede; riattivato: accede di nuovo
    set_administrator_active(&t, &admin, id, false).await.unwrap();
    assert!(session(&t, &lr.token).await.unwrap().is_none());
    assert!(admin_login(&t, "anna", PASSWORD, "t").await.is_err());
    set_administrator_active(&t, &admin, id, true).await.unwrap();
    assert!(admin_login(&t, "anna", PASSWORD, "t").await.is_ok());
    // un utente dei tenant non e' un Administrator da gestire
    assert_eq!(
        set_administrator_active(&t, &admin, anna.user_id, false).await.unwrap_err().kind,
        Kind::NotFound
    );
}

#[tokio::test]
async fn administrator_interviene_sui_tenant() {
    let t = start().await;
    let admin = t.admin().await;
    let gestore = t.tenant("alfa").await;
    let anna = t.member(&gestore, "anna").await;
    let alfa = list_tenants(&t, &admin).await.unwrap()[0].id;
    assert_eq!(tenant_members(&t, &gestore, alfa).await.unwrap_err().kind, Kind::Forbidden);
    let m = tenant_members(&t, &admin, alfa).await.unwrap();
    assert_eq!(m.iter().map(|x| x.username.as_str()).collect::<Vec<_>>(), vec!["alfa-gestore", "anna"]);

    // nomina un nuovo gestore, promuove anna, sblocca la password del gestore
    create_tenant_manager(&t, &admin, alfa, "nuovo", "Nuovo", PASSWORD).await.unwrap();
    assert_eq!(
        caller(&t, &t.login("alfa", "nuovo").await, "alfa").await.unwrap().tenant.role,
        Role::TenantManager
    );
    set_tenant_role(&t, &admin, alfa, anna.user_id, Role::TenantManager).await.unwrap();
    assert_eq!(caller(&t, &anna, "alfa").await.unwrap().tenant.role, Role::TenantManager);
    reset_tenant_password(&t, &admin, alfa, gestore.user_id, "password-nuova-1").await.unwrap();
    assert!(login(&t, "alfa", "alfa-gestore", "password-nuova-1", "t").await.is_ok());

    // mai sul tenant di sistema
    let system: uuid::Uuid = mosaikit_db::query_scalar("select id from core.tenants where is_system")
        .fetch_one(&t.k.db)
        .await
        .unwrap();
    assert_eq!(tenant_members(&t, &admin, system).await.unwrap_err().kind, Kind::BadRequest);
    assert!(create_tenant_manager(&t, &admin, system, "x1", "", PASSWORD).await.is_err());
    assert!(reset_tenant_password(&t, &admin, system, admin.user_id, "password-nuova-2").await.is_err());
}

#[tokio::test]
async fn nessun_tenant_resta_senza_gestore() {
    let t = start().await;
    let ga = t.tenant("alfa").await;
    let gb = t.tenant("beta").await;
    let anna = t.member(&ga, "anna").await;
    // anna (di alfa) diventa l'unica gestore di beta
    let cb = t.home(&gb).await;
    let inv = invite(&t, &cb, "alfa", "anna", Role::TenantManager).await.unwrap();
    respond_invitation(&t, &anna, inv.id, true).await.unwrap();
    // il gestore originario di beta esce: anna resta l'unica Tenant Manager
    let cab = caller(&t, &anna, "beta").await.unwrap();
    remove_member(&t, &cab, gb.user_id, None).await.unwrap();
    // alfa non puo' disabilitare anna: beta resterebbe senza Tenant Manager
    let ca = t.home(&ga).await;
    let e = remove_member(&t, &ca, anna.user_id, None).await.unwrap_err();
    assert_eq!(e.kind, Kind::Conflict);
    assert!(e.to_string().contains("beta"));
}

#[tokio::test]
async fn secondo_fattore_degli_administrator() {
    let t = start_with(|c| c.admin_totp = true).await;
    // primo accesso: registrazione dell'app
    let AdminLogin::Pending { token, step, .. } =
        admin_login(&t, "admin", ADMIN_PASSWORD, "t").await.unwrap()
    else {
        panic!("atteso il secondo fattore")
    };
    assert_eq!(step, "totp_setup");
    // la sessione in attesa non vale per le API
    assert!(session(&t, &token).await.unwrap().is_none());
    let p = pending_session(&t, &token).await.unwrap().unwrap();
    assert!(totp_verify(&t, &p, "000000", "t").await.is_err(), "prima va registrata l'app");
    let setup = totp_setup(&t, &p).await.unwrap();
    assert!(setup.uri.starts_with("otpauth://totp/") && setup.qr_svg.contains("<svg"));
    let secret = totp::base32_decode(&setup.secret).unwrap();
    let now = totp::current_step();
    assert_eq!(totp_enable(&t, &p, "12345", "t").await.unwrap_err().kind, Kind::Unauthorized);
    let (lr, codes) = totp_enable(&t, &p, &totp::code(&secret, now), "t").await.unwrap();
    assert!(lr.user.is_system_admin);
    assert_eq!(codes.len(), 10);
    assert!(pending_session(&t, &token).await.unwrap().is_none(), "la sessione in attesa e' chiusa");
    assert!(administrators(&t, &lr.user).await.unwrap()[0].totp);

    // accessi successivi: codice dell'app, mai due volte lo stesso
    let pending = |t: &mosaikit_kernel::testing::TestKernel| {
        let k = t.k.clone();
        async move {
            match admin_login(&k, "admin", ADMIN_PASSWORD, "t").await.unwrap() {
                AdminLogin::Pending { token, step, .. } => {
                    assert_eq!(step, "totp");
                    pending_session(&k, &token).await.unwrap().unwrap()
                }
                AdminLogin::Done(_) => panic!("atteso il codice"),
            }
        }
    };
    let p = pending(&t).await;
    assert!(totp_verify(&t, &p, &totp::code(&secret, now), "t").await.is_err(), "codice gia' usato");
    totp_verify(&t, &p, &totp::code(&secret, now + 1), "t").await.unwrap();
    // codici di recupero: monouso
    let p = pending(&t).await;
    totp_verify(&t, &p, &codes[0].to_uppercase(), "t").await.unwrap();
    let p = pending(&t).await;
    assert!(totp_verify(&t, &p, &codes[0], "t").await.is_err());

    // un altro Administrator puo' azzerarlo (telefono perso): si registra di nuovo
    let admin = lr.user;
    create_administrator(&t, &admin, "bis", "", PASSWORD).await.unwrap();
    let AdminLogin::Pending { step, .. } = admin_login(&t, "bis", PASSWORD, "t").await.unwrap() else {
        panic!("atteso il secondo fattore")
    };
    assert_eq!(step, "totp_setup");
    reset_administrator_totp(&t, &admin, admin.user_id).await.unwrap();
    let AdminLogin::Pending { step, .. } = admin_login(&t, "admin", ADMIN_PASSWORD, "t").await.unwrap()
    else {
        panic!("atteso il secondo fattore")
    };
    assert_eq!(step, "totp_setup");
}

#[tokio::test]
async fn tenant_di_lavoro_al_primo_avvio() {
    let t = start_with(|c| c.initial_tenant = Some("locale".into())).await;
    let pubblici = login_tenants(&t).await.unwrap();
    assert_eq!(pubblici.iter().map(|x| x.slug.as_str()).collect::<Vec<_>>(), vec!["locale"]);
    // credenziali generate nel file della cartella dei dati
    let file =
        std::fs::read_to_string(t.cfg.data_dir.join(mosaikit_kernel::identity::INITIAL_CREDENTIALS)).unwrap();
    let section = &file[file.find("utente: utente").expect("credenziali dell'utente")..];
    let password = section.lines().find_map(|l| l.strip_prefix("password: ")).unwrap();
    let u = login(&t, "locale", "utente", password, "t").await.unwrap().user;
    assert_eq!(caller(&t, &u, "locale").await.unwrap().tenant.role, Role::TenantManager);
    // gia' creato: un nuovo avvio non lo ricrea
    mosaikit_kernel::identity::bootstrap(&t).await.unwrap();
    assert_eq!(login_tenants(&t).await.unwrap().len(), 1);
}

#[tokio::test]
async fn password_iniziale_della_distribuzione() {
    let t = start_with(|c| {
        c.initial_tenant = Some("locale".into());
        c.initial_password = Some("mosaikit".into());
    })
    .await;
    // anche se piu' corta della policy, per entrambi gli account del primo avvio
    let u = login(&t, "locale", "utente", "mosaikit", "t").await.unwrap().user;
    let file =
        std::fs::read_to_string(t.cfg.data_dir.join(mosaikit_kernel::identity::INITIAL_CREDENTIALS)).unwrap();
    assert_eq!(file.matches("password: mosaikit").count(), 2, "{file}");
    // cambiandola vale di nuovo la policy
    assert_eq!(change_password(&t, &u, "mosaikit", "corta").await.unwrap_err().kind, Kind::BadRequest);
}

#[tokio::test]
async fn barra_in_alto_decisa_dall_administrator() {
    let t = start().await;
    let admin = t.admin().await;
    let gestore = t.tenant("alfa").await;
    // all'inizio tutto acceso
    assert_eq!(shell_band(&t).await.unwrap(), ShellBand::default());
    assert!(ShellBand::default().logo && ShellBand::default().mode);
    let band = ShellBand { logo: false, search: false, lang: true, help: false, mode: true };
    // solo l'Administrator la cambia
    assert_eq!(set_shell_band(&t, &gestore, &band).await.unwrap_err().kind, Kind::Forbidden);
    set_shell_band(&t, &admin, &band).await.unwrap();
    assert_eq!(shell_band(&t).await.unwrap(), band);
    // non tocca le altre impostazioni del tenant di sistema
    set_shell_band(&t, &admin, &ShellBand::default()).await.unwrap();
    assert_eq!(shell_band(&t).await.unwrap(), ShellBand::default());
}

#[tokio::test]
async fn tema_della_piattaforma_e_del_tenant() {
    use mosaikit_kernel::tenancy::{
        platform_theme, set_platform_theme, set_settings, set_tenant_theme, tenant_theme,
    };
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let gestore = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let alfa = gestore.tenant.tenant_id;
    // all'inizio il tema predefinito, ereditato dal tenant
    assert_eq!(platform_theme(&t).await.unwrap(), "mosaikit");
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().tenant, None);
    // la piattaforma: solo l'Administrator
    assert_eq!(set_platform_theme(&t, &g, "italia").await.unwrap_err().kind, Kind::Forbidden);
    assert_eq!(set_platform_theme(&t, &admin, "Non Valido").await.unwrap_err().kind, Kind::BadRequest);
    set_platform_theme(&t, &admin, "italia").await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "italia", "il tenant eredita");
    // il tenant: solo il Tenant Manager, non chi ci lavora
    assert_eq!(set_tenant_theme(&t, &anna, Some("mosaikit")).await.unwrap_err().kind, Kind::Forbidden);
    set_tenant_theme(&t, &gestore, Some("mosaikit")).await.unwrap();
    let th = tenant_theme(&t, alfa).await.unwrap();
    assert_eq!(
        (th.platform.as_str(), th.tenant.as_deref(), th.preset.as_str()),
        ("italia", Some("mosaikit"), "mosaikit")
    );
    // le policy del tenant non cancellano il tema
    set_settings(&t, &gestore, &gestore.tenant.settings).await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "mosaikit");
    // di nuovo quello della piattaforma
    set_tenant_theme(&t, &gestore, None).await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "italia");
}
