//! Sicurezza a livello di database, con gli stessi casi su PostgreSQL (RLS, ruoli)
//! e su SQLite (riscrittura delle query, trigger, authorizer).
//! PostgreSQL: `cargo xtask db up` (o MOSAIKIT_TEST_DATABASE_URL).

use mosaikit_db::testing::TestDb;
use mosaikit_db::{query, query_scalar, sqlstate, Ctx, Db, PluginSchema};
use uuid::Uuid;

const PLUGIN: &str = "com.test.notes";
const SCHEMA: &str = "plg_com_test_notes";

#[derive(Clone, Copy, PartialEq)]
enum B {
    Pg,
    Lite,
}

#[allow(dead_code, clippy::large_enum_variant)]
enum Store {
    Pg(TestDb),
    Lite(tempfile::TempDir),
}

struct World {
    _store: Store,

    db: Db,
    tenant_a: Uuid,
    tenant_b: Uuid,
    alice: Uuid,
    bob: Uuid,
    carol: Uuid,
    ps: PluginSchema,
}

async fn tenant(db: &Db, slug: &str) -> Uuid {
    query_scalar("insert into core.tenants (slug, name) values ($1, $1) returning id")
        .bind(slug)
        .fetch_one(db)
        .await
        .unwrap()
}

async fn user(db: &Db, tenant: Uuid, name: &str) -> Uuid {
    let id: Uuid =
        query_scalar("insert into core.users (home_tenant_id, username) values ($1, $2) returning id")
            .bind(tenant)
            .bind(name)
            .fetch_one(db)
            .await
            .unwrap();
    query("insert into core.memberships (tenant_id, user_id, role) values ($1, $2, 'user')")
        .bind(tenant)
        .bind(id)
        .execute(db)
        .await
        .unwrap();
    id
}

async fn world(b: B) -> World {
    let (store, db) = match b {
        B::Pg => {
            let t = TestDb::create().await;
            let db = Db::connect(&t.url, 5).await.unwrap();
            (Store::Pg(t), db)
        }
        B::Lite => {
            let dir = tempfile::tempdir().unwrap();
            let db = Db::open_sqlite(&dir.path().join("t.db"), 5).await.unwrap();
            (Store::Lite(dir), db)
        }
    };
    let tenant_a = tenant(&db, "alfa").await;
    let tenant_b = tenant(&db, "beta").await;
    let alice = user(&db, tenant_a, "alice").await;
    let bob = user(&db, tenant_a, "bob").await;
    let carol = user(&db, tenant_b, "carol").await;

    let ps = db.plugin_schema(PLUGIN, SCHEMA);
    query(
        "insert into core.plugins (id, version, manifest, sha256, schema_name, role_name, role_password)
         values ($1, '1.0.0', '{}', 'x', $2, $3, 'pw-test-123')",
    )
    .bind(PLUGIN)
    .bind(SCHEMA)
    .bind(db.plugin_role(PLUGIN))
    .execute(&db)
    .await
    .unwrap();
    let mut tx = db.begin_app().await.unwrap();
    ps.provision(&mut tx, "pw-test-123").await.unwrap();
    ps.thaw(&mut tx).await.unwrap();
    ps.run_as_plugin(
        &mut tx,
        &[
            "create table notes (resource_id uuid not null, tenant_id uuid not null default core.ctx_tenant(), title text)".into(),
            "create view kpi_notes as select tenant_id, count(*) as n from notes group by tenant_id".into(),
            "create view notes_v as select * from notes".into(),
        ],
    )
    .await
    .unwrap();
    let report = ps.freeze(&mut tx).await.unwrap();
    assert_eq!(report.tables, vec!["notes"]);
    assert_eq!(report.kpi_views, vec!["kpi_notes"]);
    tx.commit().await.unwrap();
    db.forget_plugin_pool(PLUGIN).await;
    World { _store: store, db, tenant_a, tenant_b, alice, bob, carol, ps }
}

/// Crea una nota come `owner` e ritorna l'id della risorsa.
async fn note(w: &World, owner: Uuid, tenant: Uuid, title: &str, parent: Option<Uuid>) -> Uuid {
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(owner, tenant)).await.unwrap();
    let id = tx.create_resource("note", title, parent, &serde_json::json!({})).await.unwrap();
    query("insert into notes (resource_id, title) values ($1, $2)")
        .bind(id)
        .bind(title)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    id
}

async fn visible(w: &World, ctx: Ctx) -> i64 {
    let mut tx = w.db.begin_plugin(PLUGIN, &ctx).await.unwrap();
    let n: i64 = query_scalar("select count(*) from notes").fetch_one(&mut *tx).await.unwrap();
    let via_view: i64 = query_scalar("select count(*) from notes_v").fetch_one(&mut *tx).await.unwrap();
    let meta: i64 =
        query_scalar("select count(*) from core.visible_resources").fetch_one(&mut *tx).await.unwrap();
    assert_eq!(n, via_view, "la vista normale non deve scavalcare i filtri");
    assert_eq!(n, meta, "visible_resources coerente con i filtri");
    // anche l'SQL scritto dal plugin vede le stesse righe
    let p = tx.plugin_sql("select count(*) as n from notes", true, true, &[]).await.unwrap();
    assert_eq!(p[0]["n"], n, "SQL del plugin");
    n
}

async fn grant(w: &World, rid: Uuid, user: Uuid, level: i16) {
    query(
        "insert into core.grants (resource_id, principal_type, principal_id, level) values ($1, 'user', $2, $3)
         on conflict (resource_id, principal_type, principal_id) do update set level = excluded.level",
    )
    .bind(rid)
    .bind(user)
    .bind(level)
    .execute(&w.db)
    .await
    .unwrap();
}

macro_rules! both {
    ($name:ident) => {
        mod $name {
            #[tokio::test]
            async fn postgres() {
                super::$name(super::B::Pg).await
            }
            #[tokio::test]
            async fn sqlite() {
                super::$name(super::B::Lite).await
            }
        }
    };
}

both!(proprieta_condivisione_e_isolamento);
async fn proprieta_condivisione_e_isolamento(b: B) {
    let w = world(b).await;
    let rid = note(&w, w.alice, w.tenant_a, "segreto di alice", None).await;

    assert_eq!(visible(&w, Ctx::user(w.alice, w.tenant_a)).await, 1);
    assert_eq!(visible(&w, Ctx::user(w.bob, w.tenant_a)).await, 0, "bob non vede le note di alice");
    assert_eq!(visible(&w, Ctx::user(w.carol, w.tenant_b)).await, 0);
    assert_eq!(visible(&w, Ctx::user(w.carol, w.tenant_a)).await, 0, "carol non e' membro di alfa");
    assert_eq!(visible(&w, Ctx::default()).await, 0, "senza contesto non si vede nulla");

    // lettura: bob vede ma non modifica
    grant(&w, rid, w.bob, 1).await;
    assert_eq!(visible(&w, Ctx::user(w.bob, w.tenant_a)).await, 1);
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.bob, w.tenant_a)).await.unwrap();
    let updated = query("update notes set title = 'manomessa'").execute(&mut *tx).await.unwrap();
    assert_eq!(updated.rows_affected(), 0);
    let p = tx.plugin_sql("update notes set title = 'manomessa'", false, false, &[]).await.unwrap();
    assert_eq!(p["rows"], 0, "neanche dall'SQL del plugin");
    let del = tx.delete_resource(rid).await.unwrap_err();
    assert_eq!(sqlstate(&del).as_deref(), Some("42501"));
    drop(tx);

    // scrittura: bob modifica ma non elimina
    grant(&w, rid, w.bob, 2).await;
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.bob, w.tenant_a)).await.unwrap();
    let updated = query("update notes set title = 'modificata da bob'").execute(&mut *tx).await.unwrap();
    assert_eq!(updated.rows_affected(), 1);
    let del = tx.delete_resource(rid).await.unwrap_err();
    assert_eq!(sqlstate(&del).as_deref(), Some("42501"));
    drop(tx);

    // inserire righe con tenant_id falso e' vietato
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
    let e = query("insert into notes (resource_id, tenant_id, title) values ($1, $2, 'x')")
        .bind(rid)
        .bind(w.tenant_b)
        .execute(&mut *tx)
        .await
        .unwrap_err();
    assert_eq!(sqlstate(&e).as_deref(), Some("42501"), "{e}");
    drop(tx);
    // ...e righe legate a risorse altrui
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.carol, w.tenant_b)).await.unwrap();
    let e = tx
        .plugin_sql(
            "insert into notes (resource_id, title) values ($1::uuid, 'furto')",
            false,
            false,
            &[serde_json::json!(rid.to_string())],
        )
        .await
        .unwrap_err();
    assert_eq!(sqlstate(&e).as_deref(), Some("42501"), "{e}");
}

both!(il_plugin_non_esce_dal_suo_spazio);
async fn il_plugin_non_esce_dal_suo_spazio(b: B) {
    let w = world(b).await;
    note(&w, w.alice, w.tenant_a, "x", None).await;
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
    for sql in [
        "select * from core.users",
        "select * from core.session_ctx",
        "select * from core.secrets",
        "select * from core.grants",
        "select * from kpi_notes",
        "insert into core.grants values (gen_random_uuid(), 'user', gen_random_uuid(), 3)",
    ] {
        let e = tx.plugin_sql(sql, true, false, &[]).await.unwrap_err();
        assert_eq!(sqlstate(&e).as_deref(), Some("42501"), "{sql}: {e}");
    }
    if b == B::Lite {
        // nomi fisici e oggetti di SQLite
        for sql in [
            "select * from core_users",
            "select * from plg_com_test_notes__notes",
            "select * from sqlite_master",
        ] {
            let e = tx.plugin_sql(sql, true, false, &[]).await.unwrap_err();
            assert_eq!(sqlstate(&e).as_deref(), Some("42501"), "{sql}: {e}");
        }
    }
    if b == B::Pg {
        // contesto falsificato senza segreto
        let e = query("select core.set_ctx('\\x00'::bytea, $1, $2, $3, null)")
            .bind(w.bob)
            .bind(w.tenant_a)
            .bind(PLUGIN)
            .execute(&mut *tx)
            .await
            .unwrap_err();
        assert_eq!(sqlstate(&e).as_deref(), Some("42501"));
        drop(tx);
        // nessun ruolo piu' privilegiato a cui passare
        let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
        let app_role: String = query_scalar("select current_user::text").fetch_one(&w.db).await.unwrap();
        let e = query(format!("set role \"{app_role}\"")).execute(&mut *tx).await.unwrap_err();
        assert_eq!(sqlstate(&e).as_deref(), Some("42501"));
    }
}

both!(il_contesto_vale_solo_nella_sua_transazione);
async fn il_contesto_vale_solo_nella_sua_transazione(b: B) {
    let w = world(b).await;
    note(&w, w.alice, w.tenant_a, "x", None).await;
    let pool_tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
    pool_tx.commit().await.unwrap();
    // nuova transazione sullo stesso pool senza contesto: nessun accesso
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::default()).await.unwrap();
    let n: i64 = query_scalar("select count(*) from notes").fetch_one(&mut *tx).await.unwrap();
    assert_eq!(n, 0);
}

both!(ereditarieta_spostamento_ed_eliminazione);
async fn ereditarieta_spostamento_ed_eliminazione(b: B) {
    let w = world(b).await;
    let folder = note(&w, w.alice, w.tenant_a, "cartella", None).await;
    let child = note(&w, w.alice, w.tenant_a, "figlio", Some(folder)).await;
    let other = note(&w, w.alice, w.tenant_a, "altra", None).await;

    grant(&w, folder, w.bob, 2).await;
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.bob, w.tenant_a)).await.unwrap();
    let lvl: i32 = query_scalar("select core.level_of($1)").bind(child).fetch_one(&mut *tx).await.unwrap();
    assert_eq!(lvl, 2, "il grant sulla cartella vale sul contenuto");
    // bob (scrittura) crea un file nella cartella: ne e' proprietario
    let mine = tx.create_resource("note", "di bob", Some(folder), &serde_json::json!({})).await.unwrap();
    tx.commit().await.unwrap();

    // alice, proprietaria della cartella, gestisce anche il file di bob
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
    let lvl: i32 = query_scalar("select core.level_of($1)").bind(mine).fetch_one(&mut *tx).await.unwrap();
    assert_eq!(lvl, 3);
    // sposta la cartella dentro "altra": gli antenati dei discendenti si aggiornano
    tx.move_resource(folder, Some(other)).await.unwrap();
    let anc: Vec<Uuid> = query_scalar("select ancestors from core.visible_resources where id = $1")
        .bind(child)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(anc, vec![other, folder]);
    // ciclo vietato
    tx.savepoint().await.unwrap();
    assert!(tx.move_resource(other, Some(child)).await.is_err());
    tx.rollback_savepoint().await.unwrap();
    let gone = tx.delete_resource(other).await.unwrap();
    assert_eq!(gone.len(), 4);
    tx.commit().await.unwrap();
    assert_eq!(visible(&w, Ctx::user(w.alice, w.tenant_a)).await, 0);
}

both!(link_pubblico_sola_lettura);
async fn link_pubblico_sola_lettura(b: B) {
    let w = world(b).await;
    let rid = note(&w, w.alice, w.tenant_a, "pubblica", None).await;
    note(&w, w.alice, w.tenant_a, "privata", None).await;
    let link = Ctx { tenant: Some(w.tenant_a), link: Some(rid), ..Ctx::default() };
    assert_eq!(visible(&w, link.clone()).await, 1);
    let mut tx = w.db.begin_plugin(PLUGIN, &link).await.unwrap();
    let u = query("update notes set title = 'x'").execute(&mut *tx).await.unwrap();
    assert_eq!(u.rows_affected(), 0);
    let e = tx.create_resource("note", "x", None, &serde_json::json!({})).await.unwrap_err();
    assert_eq!(sqlstate(&e).as_deref(), Some("42501"));
}

both!(kpi_aggregati_per_tenant);
async fn kpi_aggregati_per_tenant(b: B) {
    let w = world(b).await;
    note(&w, w.alice, w.tenant_a, "1", None).await;
    note(&w, w.bob, w.tenant_a, "2", None).await;
    note(&w, w.carol, w.tenant_b, "3", None).await;
    let rows: Vec<(Uuid, i64)> =
        query(format!("select tenant_id, n from {SCHEMA}.kpi_notes order by n desc"))
            .fetch_all(&w.db)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.get(0), r.get(1)))
            .collect();
    assert_eq!(rows, vec![(w.tenant_a, 2), (w.tenant_b, 1)]);
}

both!(freeze_rifiuta_tabelle_senza_colonne_obbligatorie);
async fn freeze_rifiuta_tabelle_senza_colonne_obbligatorie(b: B) {
    let w = world(b).await;
    let mut tx = w.db.begin_app().await.unwrap();
    w.ps.thaw(&mut tx).await.unwrap();
    w.ps.run_as_plugin(&mut tx, &["create table libera (titolo text)".into()]).await.unwrap();
    let e = w.ps.freeze(&mut tx).await.unwrap_err();
    assert!(e.to_string().contains("resource_id"), "{e}");
}

both!(le_migrazioni_restano_nello_spazio_del_plugin);
async fn le_migrazioni_restano_nello_spazio_del_plugin(b: B) {
    let w = world(b).await;
    // anche se il guard venisse aggirato: una vista su core non passa (PostgreSQL la
    // crea, perche' controlla i privilegi solo all'uso, ma freeze la rifiuta)
    let mut tx = w.db.begin_app().await.unwrap();
    w.ps.thaw(&mut tx).await.unwrap();
    let r = w
        .ps
        .run_as_plugin(&mut tx, &["create view kpi_furto as select tenant_id, username from core.users join core.memberships on user_id = id".into()])
        .await;
    let e = match r {
        Ok(()) => w.ps.freeze(&mut tx).await.unwrap_err(),
        Err(e) => e,
    };
    let m = e.to_string();
    assert!(m.contains("fuori dal suo schema") || m.contains("core.users"), "{m}");
    drop(tx);
    // una tabella che legge core all'inserimento non si puo' creare: niente subquery nei default
    let mut tx = w.db.begin_app().await.unwrap();
    w.ps.thaw(&mut tx).await.unwrap();
    assert!(w
        .ps
        .run_as_plugin(&mut tx, &["create table t2 (resource_id uuid not null, tenant_id uuid not null, x text default (select username from core.users limit 1))".into()])
        .await
        .is_err());
}

both!(disinstallazione);
async fn disinstallazione(b: B) {
    let w = world(b).await;
    note(&w, w.alice, w.tenant_a, "x", None).await;
    w.db.forget_plugin_pool(PLUGIN).await;
    let mut tx = w.db.begin_app().await.unwrap();
    w.ps.drop(&mut tx).await.unwrap();
    query("delete from core.plugins where id = $1").bind(PLUGIN).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let n: i64 = query_scalar("select count(*) from core.resources").fetch_one(&w.db).await.unwrap();
    assert_eq!(n, 0, "le risorse del plugin sono rimosse a cascata");
    if b == B::Pg {
        let role: bool = query_scalar("select exists (select 1 from pg_roles where rolname = $1)")
            .bind(w.db.plugin_role(PLUGIN))
            .fetch_one(&w.db)
            .await
            .unwrap();
        assert!(!role);
    } else {
        let left: i64 =
            query_scalar("select count(*) from sqlite_master where name like 'plg_com_test_notes%'")
                .sqlite("select count(*) from sqlite_master where name like 'plg_com_test_notes%'")
                .fetch_one(&w.db)
                .await
                .unwrap();
        assert_eq!(left, 0, "nessun oggetto del plugin resta nel database");
    }
    let _ = (w.tenant_b, w.carol);
}
