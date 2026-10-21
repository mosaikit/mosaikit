//! Risorse dei plugin: proprieta', condivisione, isolamento, gestore, hook, comandi, KPI.

use mosaikit_kernel::acl::{grants, manager_resources, set_grant, transfer_owner, Level, ResourceFilter};
use mosaikit_kernel::tenancy::{
    create_group, invite, my_invitations, remove_member, respond_invitation, set_group_member, set_settings,
};
use mosaikit_kernel::testing::{start, TestKernel};
use mosaikit_kernel::{crud, kpi, Caller, Kind, Role};
use serde_json::{json, Map, Value};
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

fn vals(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

fn id(row: &Value) -> Uuid {
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn note(t: &TestKernel, c: &Caller, title: &str) -> Value {
    crud::create(t, c, NOTES, "notes", &vals(json!({ "title": title, "body": "riservato" })), None)
        .await
        .unwrap()
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

struct World {
    t: TestKernel,
    gestore: Caller,
    anna: Caller,
    bruno: Caller,
    altro_tenant: Caller,
}

async fn world() -> World {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let gb = t.tenant("beta").await;
    World {
        gestore: t.home(&g).await,
        anna: t.home(&anna).await,
        bruno: t.home(&bruno).await,
        altro_tenant: t.home(&gb).await,
        t,
    }
}

#[tokio::test]
async fn proprieta_e_livelli_di_condivisione() {
    let w = world().await;
    let t = &w.t;
    let row = note(t, &w.anna, "piano").await;
    let rid = id(&row);
    assert_eq!(row["my_level"], "manage");
    assert_eq!(row["values"]["tag"], "personale", "hook before_create del plugin notes");

    assert_eq!(titles(t, &w.anna).await, vec!["piano"]);
    assert!(titles(t, &w.bruno).await.is_empty(), "non condivisa");
    assert_eq!(crud::get(t, &w.bruno, NOTES, "notes", rid).await.unwrap_err().kind, Kind::NotFound);

    // lettura
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Read)).await.unwrap();
    assert_eq!(titles(t, &w.bruno).await, vec!["piano"]);
    let e = crud::update(t, &w.bruno, NOTES, "notes", rid, &vals(json!({ "title": "x" }))).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    // scrittura: modifica ma non elimina ne' condivide
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Write)).await.unwrap();
    let upd = crud::update(t, &w.bruno, NOTES, "notes", rid, &vals(json!({ "body": "rivisto da bruno" })))
        .await
        .unwrap();
    assert_eq!(upd["values"]["title"], "piano", "aggiornamento parziale");
    assert_eq!(upd["values"]["body"], "rivisto da bruno");
    assert_eq!(crud::delete(t, &w.bruno, NOTES, "notes", rid).await.unwrap_err().kind, Kind::Forbidden);
    let e = set_grant(t, &w.bruno, rid, "user", w.gestore.user.user_id, Some(Level::Read)).await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    // gestione: condivide ed elimina
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, Some(Level::Manage)).await.unwrap();
    assert_eq!(grants(t, &w.bruno, rid).await.unwrap().len(), 1);
    // revoca
    set_grant(t, &w.anna, rid, "user", w.bruno.user.user_id, None).await.unwrap();
    assert!(titles(t, &w.bruno).await.is_empty());
    crud::delete(t, &w.anna, NOTES, "notes", rid).await.unwrap();
    assert!(titles(t, &w.anna).await.is_empty());
}

#[tokio::test]
async fn condivisione_con_gruppo() {
    let w = world().await;
    let t = &w.t;
    let rid = id(&note(t, &w.anna, "di gruppo").await);
    let gid = create_group(t, &w.gestore, "Redazione").await.unwrap();
    set_grant(t, &w.anna, rid, "group", gid, Some(Level::Read)).await.unwrap();
    assert!(titles(t, &w.bruno).await.is_empty());
    set_group_member(t, &w.gestore, gid, w.bruno.user.user_id, true).await.unwrap();
    assert_eq!(titles(t, &w.bruno).await, vec!["di gruppo"]);
    set_group_member(t, &w.gestore, gid, w.bruno.user.user_id, false).await.unwrap();
    assert!(titles(t, &w.bruno).await.is_empty());
}

#[tokio::test]
async fn isolamento_tra_tenant() {
    let w = world().await;
    let t = &w.t;
    let rid = id(&note(t, &w.anna, "solo alfa").await);
    assert!(titles(t, &w.altro_tenant).await.is_empty());
    assert_eq!(crud::get(t, &w.altro_tenant, NOTES, "notes", rid).await.unwrap_err().kind, Kind::NotFound);
    // non si condivide con chi non e' membro del tenant
    let e =
        set_grant(t, &w.anna, rid, "user", w.altro_tenant.user.user_id, Some(Level::Read)).await.unwrap_err();
    assert_eq!(e.kind, Kind::BadRequest);
    // un ospite invitato invece si'
    let inv = invite(t, &w.gestore, "beta", "beta-gestore", Role::User).await.unwrap();
    let ospite = w.altro_tenant.user.clone();
    respond_invitation(t, &ospite, my_invitations(t, &ospite).await.unwrap()[0].id, true).await.unwrap();
    let _ = inv;
    set_grant(t, &w.anna, rid, "user", ospite.user_id, Some(Level::Read)).await.unwrap();
    let ospite_in_alfa = t.caller(&ospite, "alfa").await;
    assert_eq!(titles(t, &ospite_in_alfa).await, vec!["solo alfa"]);
    assert!(titles(t, &w.altro_tenant).await.is_empty(), "nel suo tenant la nota non c'e'");
}

#[tokio::test]
async fn il_gestore_vede_metadati_non_contenuti() {
    let w = world().await;
    let t = &w.t;
    let rid = id(&note(t, &w.anna, "verbale riservato").await);
    assert!(titles(t, &w.gestore).await.is_empty(), "il gestore non legge il contenuto");
    assert_eq!(crud::get(t, &w.gestore, NOTES, "notes", rid).await.unwrap_err().kind, Kind::NotFound);
    let meta = manager_resources(t, &w.gestore, &ResourceFilter::default()).await.unwrap();
    assert_eq!(meta.len(), 1);
    assert_eq!(meta[0].title, "verbale riservato");
    assert_eq!(meta[0].owner_name, "anna");
    let json = serde_json::to_string(&meta).unwrap();
    assert!(!json.contains("riservato\"") || !json.contains("body"), "nessun campo di contenuto");
    // policy: titoli nascosti
    let mut s = w.gestore.tenant.settings.clone();
    s.managers_see_titles = false;
    set_settings(t, &w.gestore, &s).await.unwrap();
    let g2 = t.caller(&w.gestore.user, "alfa").await;
    assert_eq!(manager_resources(t, &g2, &ResourceFilter::default()).await.unwrap()[0].title, "");
    // un membro non vede l'elenco
    assert_eq!(
        manager_resources(t, &w.anna, &ResourceFilter::default()).await.unwrap_err().kind,
        Kind::Forbidden
    );
}

#[tokio::test]
async fn riassegnazione_quando_un_utente_esce() {
    let w = world().await;
    let t = &w.t;
    let r1 = id(&note(t, &w.anna, "uno").await);
    note(t, &w.anna, "due").await;
    set_grant(t, &w.anna, r1, "user", w.gestore.user.user_id, Some(Level::Read)).await.unwrap();
    let e = remove_member(t, &w.gestore, w.anna.user.user_id, None).await.unwrap_err();
    assert!(e.message.contains("riassegnarle"), "{e}");
    let rep = remove_member(t, &w.gestore, w.anna.user.user_id, Some(w.bruno.user.user_id)).await.unwrap();
    assert_eq!(rep.reassigned, 2);
    assert!(rep.disabled);
    assert_eq!(titles(t, &w.bruno).await, vec!["due", "uno"], "bruno e' il nuovo proprietario");
    let row = crud::get(t, &w.bruno, NOTES, "notes", r1).await.unwrap();
    assert_eq!(row["my_level"], "manage");
    // i grant esistenti restano
    assert_eq!(titles(t, &w.gestore).await, vec!["uno"]);
}

#[tokio::test]
async fn trasferimento_di_proprieta() {
    let w = world().await;
    let t = &w.t;
    let rid = id(&note(t, &w.anna, "passa a bruno").await);
    assert_eq!(
        transfer_owner(t, &w.bruno, rid, w.bruno.user.user_id).await.unwrap_err().kind,
        Kind::Forbidden
    );
    transfer_owner(t, &w.anna, rid, w.bruno.user.user_id).await.unwrap();
    assert!(titles(t, &w.anna).await.is_empty());
    assert_eq!(titles(t, &w.bruno).await, vec!["passa a bruno"]);
    // anche il gestore puo' trasferire
    transfer_owner(t, &w.gestore, rid, w.anna.user.user_id).await.unwrap();
    assert_eq!(titles(t, &w.anna).await, vec!["passa a bruno"]);
}

#[tokio::test]
async fn validazione_e_hook_che_rifiutano() {
    let w = world().await;
    let t = &w.t;
    t.install("contacts").await;
    let c = &w.anna;
    let e =
        crud::create(t, c, NOTES, "notes", &vals(json!({ "body": "senza titolo" })), None).await.unwrap_err();
    assert!(e.message.contains("obbligatorio"), "{e}");
    let e = crud::create(t, c, NOTES, "notes", &vals(json!({ "title": "x", "tag": "inesistente" })), None)
        .await
        .unwrap_err();
    assert!(e.message.contains("opzioni"), "{e}");
    let e = crud::create(t, c, NOTES, "notes", &vals(json!({ "title": "x", "nope": 1 })), None)
        .await
        .unwrap_err();
    assert!(e.message.contains("sconosciuto"), "{e}");

    let ok = crud::create(
        t,
        c,
        "com.mosaikit.contacts",
        "contacts",
        &vals(json!({ "name": "Mario", "email": "Mario@Esempio.IT" })),
        None,
    )
    .await
    .unwrap();
    assert_eq!(ok["values"]["email"], "mario@esempio.it");
    let e = crud::create(
        t,
        c,
        "com.mosaikit.contacts",
        "contacts",
        &vals(json!({ "name": "Luigi", "email": "non-valida" })),
        None,
    )
    .await
    .unwrap_err();
    assert!(e.message.contains("email non valida"), "{e}");
    // l'hook ha rifiutato: nessuna risorsa orfana
    let n: i64 = mosaikit_db::query_scalar(
        "select count(*) from core.resources where plugin_id = 'com.mosaikit.contacts'",
    )
    .fetch_one(&t.db)
    .await
    .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn hook_con_valori_precedenti_e_campi_calcolati() {
    let w = world().await;
    let t = &w.t;
    t.install("tasks").await;
    t.install("maps").await;
    let c = &w.anna;
    let task = crud::create(
        t,
        c,
        "com.mosaikit.tasks",
        "tasks",
        &vals(json!({ "title": "relazione", "done": false })),
        None,
    )
    .await
    .unwrap();
    assert_eq!(task["values"]["priority"], "media");
    assert!(task["values"]["completed_on"].is_null());
    let done = crud::update(t, c, "com.mosaikit.tasks", "tasks", id(&task), &vals(json!({ "done": true })))
        .await
        .unwrap();
    assert!(done["values"]["completed_on"].as_str().unwrap().len() == 10, "data di completamento dal DB");

    let cfg = json!({ "layers": [{ "id": "a" }, { "id": "b" }, { "id": "c" }] }).to_string();
    let map = crud::create(
        t,
        c,
        "com.mosaikit.maps",
        "maps",
        &vals(json!({ "name": "Rete idrica", "config": cfg })),
        None,
    )
    .await
    .unwrap();
    assert_eq!(map["values"]["layers"], 3.0);
}

#[tokio::test]
async fn comandi_wasm_rispettano_la_rls() {
    let w = world().await;
    let t = &w.t;
    note(t, &w.anna, "a1").await;
    crud::create(t, &w.anna, NOTES, "notes", &vals(json!({ "title": "a2", "tag": "lavoro" })), None)
        .await
        .unwrap();
    note(t, &w.bruno, "b1").await;
    let mine = crud::call(t, &w.anna, NOTES, "notes.count_by_tag", json!({})).await.unwrap();
    let total: i64 = mine.as_array().unwrap().iter().map(|r| r["n"].as_i64().unwrap()).sum();
    assert_eq!(total, 2, "il comando vede solo le note di anna: {mine}");
    let e = crud::call(t, &w.anna, NOTES, "notes.inesistente", json!({})).await.unwrap_err();
    assert!(e.message.contains("sconosciuto"));
}

#[tokio::test]
async fn kpi_per_tenant_e_globali() {
    let w = world().await;
    let t = &w.t;
    note(t, &w.anna, "1").await;
    crud::create(t, &w.bruno, NOTES, "notes", &vals(json!({ "title": "2", "tag": "lavoro" })), None)
        .await
        .unwrap();
    note(t, &w.altro_tenant, "beta").await;

    let k = kpi::tenant(t, &w.gestore).await.unwrap();
    assert_eq!(k.core.members, 3);
    assert_eq!(k.core.resources.iter().map(|r| r.count).sum::<i64>(), 2);
    let notes_kpi = k.plugins.iter().find(|p| p.view == "kpi_notes_by_tag").unwrap();
    let total: i64 = notes_kpi.rows.iter().map(|r| r["note"].as_i64().unwrap()).sum();
    assert_eq!(total, 2, "solo il tenant alfa");
    assert!(notes_kpi.rows.iter().all(|r| r.get("tenant_id").is_none()));
    assert_eq!(kpi::tenant(t, &w.anna).await.unwrap_err().kind, Kind::Forbidden);

    let admin = t.admin().await;
    let g = kpi::global(t, &admin).await.unwrap();
    assert_eq!(g.tenants.len(), 3);
    let notes_kpi = g.plugins.iter().find(|p| p.view == "kpi_notes_by_tag").unwrap();
    let tenants: std::collections::BTreeSet<&str> =
        notes_kpi.rows.iter().map(|r| r["tenant"].as_str().unwrap()).collect();
    assert_eq!(tenants.into_iter().collect::<Vec<_>>(), vec!["alfa", "beta"]);
    assert_eq!(kpi::global(t, &w.gestore.user).await.unwrap_err().kind, Kind::Forbidden);
}

/// Le API del kernel devono essere utilizzabili dai gestori HTTP (future `Send`).
#[allow(dead_code)]
fn le_future_sono_send(k: std::sync::Arc<mosaikit_kernel::Kernel>, c: Caller) {
    fn send<F: std::future::Future + Send + 'static>(_: F) {}
    let (k1, c1) = (k.clone(), c.clone());
    send(async move { crud::create(&k1, &c1, "p", "r", &Map::new(), None).await });
    let (k1, c1) = (k.clone(), c.clone());
    send(async move { crud::call(&k1, &c1, "p", "x", Value::Null).await });
    let k1 = k.clone();
    send(async move {
        mosaikit_kernel::plugins::install_package(
            &k1,
            None,
            &[],
            mosaikit_kernel::plugins::InstallSource::Upload,
        )
        .await
        .map(|_| ())
    });
    let (k1, c1) = (k.clone(), c.clone());
    send(async move { mosaikit_kernel::files::upload(&k1, &c1, "p", None, "x", &[], false).await });
    let (k1, c1) = (k, c);
    send(async move { mosaikit_kernel::content::upload_site(&k1, &c1, "p", Uuid::nil(), &[]).await });
}

#[tokio::test]
async fn panoramica_secondo_il_ruolo() {
    use mosaikit_kernel::overview::overview;
    let w = world().await;
    let t = &w.t;
    let a = id(&note(t, &w.anna, "piano").await);
    note(t, &w.anna, "bozza").await;
    note(t, &w.bruno, "di bruno").await;
    set_grant(t, &w.anna, a, "user", w.bruno.user.user_id, Some(Level::Write)).await.unwrap();

    // User: solo i propri dati, niente aggregati di tenant o di sistema
    let o = overview(t, &w.anna).await.unwrap();
    assert_eq!(o.role, "user");
    assert_eq!(o.me.resources.iter().map(|r| r.count).sum::<i64>(), 2);
    assert_eq!((o.me.shared_by_me, o.me.shared_with_me), (1, 0));
    assert!(o.tenant.is_none() && o.system.is_none());
    let o = overview(t, &w.bruno).await.unwrap();
    assert_eq!(o.me.shared_with_me, 1);
    assert_eq!(o.me.recent_shares[0].title, "piano");
    assert_eq!(o.me.recent_shares[0].owner, "anna");
    assert_eq!(o.me.recent_shares[0].level, "write");

    // Tenant Manager: anche gli aggregati del tenant
    let o = overview(t, &w.gestore).await.unwrap();
    assert_eq!(o.role, "tenant_manager");
    let core = o.tenant.unwrap();
    assert_eq!(core.resources.iter().map(|r| r.count).sum::<i64>(), 3);
    assert_eq!(core.shares, 1);
    assert!(o.system.is_none());

    // Administrator: anche il sistema
    let admin = t.admin().await;
    let c = mosaikit_kernel::tenancy::caller(t, &admin, "system").await.unwrap();
    let o = overview(t, &c).await.unwrap();
    assert_eq!(o.role, "administrator");
    let s = o.system.unwrap();
    assert_eq!((s.tenants, s.administrators, s.resources), (3, 1, 3));
    assert!(s.plugins_active >= 1);
}
