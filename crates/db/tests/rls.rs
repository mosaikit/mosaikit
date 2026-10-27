//! Database-level security, with the same cases on PostgreSQL (RLS, roles)
//! and on SQLite (query rewriting, triggers, authorizer).
//! PostgreSQL: `cargo xtask db up` (or MOSAIKIT_TEST_DATABASE_URL).

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

/// Creates a note as `owner` and returns the id of the resource.
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
    assert_eq!(n, via_view, "the normal view must not bypass the filters");
    assert_eq!(n, meta, "visible_resources consistent with the filters");
    // the SQL written by the plugin sees the same rows too
    let p = tx.plugin_sql("select count(*) as n from notes", true, true, &[]).await.unwrap();
    assert_eq!(p[0]["n"], n, "SQL of the plugin");
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

both!(ownership_sharing_and_isolation);
async fn ownership_sharing_and_isolation(b: B) {
    let w = world(b).await;
    let rid = note(&w, w.alice, w.tenant_a, "alice's secret", None).await;

    assert_eq!(visible(&w, Ctx::user(w.alice, w.tenant_a)).await, 1);
    assert_eq!(visible(&w, Ctx::user(w.bob, w.tenant_a)).await, 0, "bob does not see alice's notes");
    assert_eq!(visible(&w, Ctx::user(w.carol, w.tenant_b)).await, 0);
    assert_eq!(visible(&w, Ctx::user(w.carol, w.tenant_a)).await, 0, "carol is not a member of alfa");
    assert_eq!(visible(&w, Ctx::default()).await, 0, "without context nothing is visible");

    // read: bob sees but does not change
    grant(&w, rid, w.bob, 1).await;
    assert_eq!(visible(&w, Ctx::user(w.bob, w.tenant_a)).await, 1);
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.bob, w.tenant_a)).await.unwrap();
    let updated = query("update notes set title = 'tampered'").execute(&mut *tx).await.unwrap();
    assert_eq!(updated.rows_affected(), 0);
    let p = tx.plugin_sql("update notes set title = 'tampered'", false, false, &[]).await.unwrap();
    assert_eq!(p["rows"], 0, "not even from the SQL of the plugin");
    let del = tx.delete_resource(rid).await.unwrap_err();
    assert_eq!(sqlstate(&del).as_deref(), Some("42501"));
    drop(tx);

    // write: bob changes but does not delete
    grant(&w, rid, w.bob, 2).await;
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.bob, w.tenant_a)).await.unwrap();
    let updated = query("update notes set title = 'changed by bob'").execute(&mut *tx).await.unwrap();
    assert_eq!(updated.rows_affected(), 1);
    let del = tx.delete_resource(rid).await.unwrap_err();
    assert_eq!(sqlstate(&del).as_deref(), Some("42501"));
    drop(tx);

    // inserting rows with a fake tenant_id is forbidden
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
    let e = query("insert into notes (resource_id, tenant_id, title) values ($1, $2, 'x')")
        .bind(rid)
        .bind(w.tenant_b)
        .execute(&mut *tx)
        .await
        .unwrap_err();
    assert_eq!(sqlstate(&e).as_deref(), Some("42501"), "{e}");
    drop(tx);
    // ...and rows tied to other people's resources
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.carol, w.tenant_b)).await.unwrap();
    let e = tx
        .plugin_sql(
            "insert into notes (resource_id, title) values ($1::uuid, 'theft')",
            false,
            false,
            &[serde_json::json!(rid.to_string())],
        )
        .await
        .unwrap_err();
    assert_eq!(sqlstate(&e).as_deref(), Some("42501"), "{e}");
}

both!(the_plugin_does_not_leave_its_space);
async fn the_plugin_does_not_leave_its_space(b: B) {
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
        // physical names and SQLite objects
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
        // forged context without the secret
        let e = query("select core.set_ctx('\\x00'::bytea, $1, $2, $3, null)")
            .bind(w.bob)
            .bind(w.tenant_a)
            .bind(PLUGIN)
            .execute(&mut *tx)
            .await
            .unwrap_err();
        assert_eq!(sqlstate(&e).as_deref(), Some("42501"));
        drop(tx);
        // no more privileged role to switch to
        let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
        let app_role: String = query_scalar("select current_user::text").fetch_one(&w.db).await.unwrap();
        let e = query(format!("set role \"{app_role}\"")).execute(&mut *tx).await.unwrap_err();
        assert_eq!(sqlstate(&e).as_deref(), Some("42501"));
    }
}

both!(the_context_holds_only_in_its_transaction);
async fn the_context_holds_only_in_its_transaction(b: B) {
    let w = world(b).await;
    note(&w, w.alice, w.tenant_a, "x", None).await;
    let pool_tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
    pool_tx.commit().await.unwrap();
    // new transaction on the same pool without context: no access
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::default()).await.unwrap();
    let n: i64 = query_scalar("select count(*) from notes").fetch_one(&mut *tx).await.unwrap();
    assert_eq!(n, 0);
}

both!(inheritance_move_and_delete);
async fn inheritance_move_and_delete(b: B) {
    let w = world(b).await;
    let folder = note(&w, w.alice, w.tenant_a, "folder", None).await;
    let child = note(&w, w.alice, w.tenant_a, "child", Some(folder)).await;
    let other = note(&w, w.alice, w.tenant_a, "other", None).await;

    grant(&w, folder, w.bob, 2).await;
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.bob, w.tenant_a)).await.unwrap();
    let lvl: i32 = query_scalar("select core.level_of($1)").bind(child).fetch_one(&mut *tx).await.unwrap();
    assert_eq!(lvl, 2, "the grant on the folder holds on the content");
    // bob (write) creates a file in the folder: he owns it
    let mine = tx.create_resource("note", "bob's", Some(folder), &serde_json::json!({})).await.unwrap();
    tx.commit().await.unwrap();

    // alice, owner of the folder, also manages bob's file
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.alice, w.tenant_a)).await.unwrap();
    let lvl: i32 = query_scalar("select core.level_of($1)").bind(mine).fetch_one(&mut *tx).await.unwrap();
    assert_eq!(lvl, 3);
    // moves the folder into "other": the ancestors of the descendants are updated
    tx.move_resource(folder, Some(other)).await.unwrap();
    let anc: Vec<Uuid> = query_scalar("select ancestors from core.visible_resources where id = $1")
        .bind(child)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert_eq!(anc, vec![other, folder]);
    // forbidden cycle
    tx.savepoint().await.unwrap();
    assert!(tx.move_resource(other, Some(child)).await.is_err());
    tx.rollback_savepoint().await.unwrap();
    let gone = tx.delete_resource(other).await.unwrap();
    assert_eq!(gone.len(), 4);
    tx.commit().await.unwrap();
    assert_eq!(visible(&w, Ctx::user(w.alice, w.tenant_a)).await, 0);
}

both!(public_link_read_only);
async fn public_link_read_only(b: B) {
    let w = world(b).await;
    let rid = note(&w, w.alice, w.tenant_a, "public", None).await;
    note(&w, w.alice, w.tenant_a, "private", None).await;
    let link = Ctx { tenant: Some(w.tenant_a), link: Some(rid), ..Ctx::default() };
    assert_eq!(visible(&w, link.clone()).await, 1);
    let mut tx = w.db.begin_plugin(PLUGIN, &link).await.unwrap();
    let u = query("update notes set title = 'x'").execute(&mut *tx).await.unwrap();
    assert_eq!(u.rows_affected(), 0);
    let e = tx.create_resource("note", "x", None, &serde_json::json!({})).await.unwrap_err();
    assert_eq!(sqlstate(&e).as_deref(), Some("42501"));
}

both!(kpis_aggregated_per_tenant);
async fn kpis_aggregated_per_tenant(b: B) {
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

both!(freeze_refuses_tables_without_required_columns);
async fn freeze_refuses_tables_without_required_columns(b: B) {
    let w = world(b).await;
    let mut tx = w.db.begin_app().await.unwrap();
    w.ps.thaw(&mut tx).await.unwrap();
    w.ps.run_as_plugin(&mut tx, &["create table free_table (title text)".into()]).await.unwrap();
    let e = w.ps.freeze(&mut tx).await.unwrap_err();
    assert!(e.to_string().contains("resource_id"), "{e}");
}

both!(migrations_stay_in_the_space_of_the_plugin);
async fn migrations_stay_in_the_space_of_the_plugin(b: B) {
    let w = world(b).await;
    // even if the guard were bypassed: a view on core does not pass (PostgreSQL
    // creates it, because it checks the privileges only when used, but freeze refuses it)
    let mut tx = w.db.begin_app().await.unwrap();
    w.ps.thaw(&mut tx).await.unwrap();
    let r = w
        .ps
        .run_as_plugin(&mut tx, &["create view kpi_theft as select tenant_id, username from core.users join core.memberships on user_id = id".into()])
        .await;
    let e = match r {
        Ok(()) => w.ps.freeze(&mut tx).await.unwrap_err(),
        Err(e) => e,
    };
    let m = e.to_string();
    assert!(m.contains("outside its schema") || m.contains("core.users"), "{m}");
    drop(tx);
    // a table that reads core when inserting cannot be created: no subqueries in defaults
    let mut tx = w.db.begin_app().await.unwrap();
    w.ps.thaw(&mut tx).await.unwrap();
    assert!(w
        .ps
        .run_as_plugin(&mut tx, &["create table t2 (resource_id uuid not null, tenant_id uuid not null, x text default (select username from core.users limit 1))".into()])
        .await
        .is_err());
}

both!(uninstall_removes_the_schema);
async fn uninstall_removes_the_schema(b: B) {
    let w = world(b).await;
    note(&w, w.alice, w.tenant_a, "x", None).await;
    w.db.forget_plugin_pool(PLUGIN).await;
    let mut tx = w.db.begin_app().await.unwrap();
    w.ps.drop(&mut tx).await.unwrap();
    query("delete from core.plugins where id = $1").bind(PLUGIN).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let n: i64 = query_scalar("select count(*) from core.resources").fetch_one(&w.db).await.unwrap();
    assert_eq!(n, 0, "the resources of the plugin are removed in cascade");
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
        assert_eq!(left, 0, "no object of the plugin stays in the database");
    }
    let _ = (w.tenant_b, w.carol);
}

/// The ids of the plugin's rows the context reads (row-level security of the table).
async fn rows_seen(w: &World, ctx: &Ctx) -> Vec<Uuid> {
    let mut tx = w.db.begin_plugin(PLUGIN, ctx).await.unwrap();
    let mut ids: Vec<Uuid> = query_scalar("select resource_id from notes").fetch_all(&mut *tx).await.unwrap();
    ids.sort();
    ids
}

/// The ids the per-item rule gives: `core.level_of()` of every item of the plugin in the tenant.
async fn rows_by_rule(w: &World, ctx: &Ctx, tenant: Uuid) -> Vec<Uuid> {
    let ids: Vec<Uuid> =
        query_scalar("select id from core.resources where tenant_id = $1 and plugin_id = $2")
            .bind(tenant)
            .bind(PLUGIN)
            .fetch_all(&w.db)
            .await
            .unwrap();
    let mut tx = w.db.begin_plugin(PLUGIN, ctx).await.unwrap();
    let mut out = Vec::new();
    for id in ids {
        let lvl: i32 = query_scalar("select core.level_of($1)").bind(id).fetch_one(&mut *tx).await.unwrap();
        if lvl >= 1 {
            out.push(id);
        }
    }
    out.sort();
    out
}

both!(reads_as_sets_follow_the_rules);
/// The read policy of the plugin tables (a set per statement on PostgreSQL, migration 0016) gives the
/// same rows as the per-item rule: owner and owned ancestors, shares to a person or to a group on the
/// item or on an ancestor, the trash, public links, members of other tenants, no context.
async fn reads_as_sets_follow_the_rules(b: B) {
    let w = world(b).await;
    let folder = note(&w, w.alice, w.tenant_a, "folder", None).await;
    let child = note(&w, w.alice, w.tenant_a, "child", Some(folder)).await;
    let deep = note(&w, w.alice, w.tenant_a, "deep", Some(child)).await;
    let alone = note(&w, w.alice, w.tenant_a, "alone", None).await;
    let trashed = note(&w, w.alice, w.tenant_a, "trashed folder", None).await;
    let in_trash = note(&w, w.alice, w.tenant_a, "inside the trash", Some(trashed)).await;
    let bobs = note(&w, w.bob, w.tenant_a, "bob's", None).await;
    let carols = note(&w, w.carol, w.tenant_b, "carol's", None).await;

    // a group of alfa with bob in it, shared the folder at level 1; bob also gets one item directly
    let group: Uuid =
        query_scalar("insert into core.groups (tenant_id, name) values ($1, 'team') returning id")
            .bind(w.tenant_a)
            .fetch_one(&w.db)
            .await
            .unwrap();
    query("insert into core.group_members (group_id, user_id) values ($1, $2)")
        .bind(group)
        .bind(w.bob)
        .execute(&w.db)
        .await
        .unwrap();
    query("insert into core.grants (resource_id, principal_type, principal_id, level) values ($1, 'group', $2, 1)")
        .bind(folder)
        .bind(group)
        .execute(&w.db)
        .await
        .unwrap();
    grant(&w, alone, w.bob, 2).await;
    grant(&w, trashed, w.bob, 3).await;
    // the folder in the trash hides itself and what it contains
    query("update core.resources set deleted_at = current_timestamp where id = $1")
        .bind(trashed)
        .execute(&w.db)
        .await
        .unwrap();

    let cases: Vec<(&str, Ctx, Uuid, Vec<Uuid>)> = vec![
        ("alice", Ctx::user(w.alice, w.tenant_a), w.tenant_a, vec![folder, child, deep, alone]),
        ("bob", Ctx::user(w.bob, w.tenant_a), w.tenant_a, vec![folder, child, deep, alone, bobs]),
        ("carol in her tenant", Ctx::user(w.carol, w.tenant_b), w.tenant_b, vec![carols]),
        ("carol in alfa", Ctx::user(w.carol, w.tenant_a), w.tenant_a, vec![]),
        ("no context", Ctx::default(), w.tenant_a, vec![]),
        (
            "public link on the child",
            Ctx { tenant: Some(w.tenant_a), link: Some(child), ..Ctx::default() },
            w.tenant_a,
            vec![child, deep],
        ),
        (
            "public link in the trash",
            Ctx { tenant: Some(w.tenant_a), link: Some(in_trash), ..Ctx::default() },
            w.tenant_a,
            vec![],
        ),
    ];
    for (name, ctx, tenant, expected) in cases {
        let mut expected = expected;
        expected.sort();
        let seen = rows_seen(&w, &ctx).await;
        assert_eq!(seen, expected, "{name}: rows read");
        assert_eq!(rows_by_rule(&w, &ctx, tenant).await, expected, "{name}: per-item rule");
    }

    // writes keep the per-row check: bob reads the folder (group, level 1) but cannot change it
    let mut tx = w.db.begin_plugin(PLUGIN, &Ctx::user(w.bob, w.tenant_a)).await.unwrap();
    let u = query("update notes set title = 'x' where resource_id = $1")
        .bind(child)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(u.rows_affected(), 0, "level 1 does not write");
    let u = query("update notes set title = 'y' where resource_id = $1")
        .bind(alone)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert_eq!(u.rows_affected(), 1, "level 2 writes");
    let d = query("delete from notes where resource_id = $1").bind(carols).execute(&mut *tx).await.unwrap();
    assert_eq!(d.rows_affected(), 0, "nothing of another tenant");
    drop(tx);

    if b == B::Pg {
        // the policy is the set, not the per-row function
        let qual: String = query_scalar(
            "select qual from pg_policies where schemaname = $1 and tablename = 'notes' and policyname = 'msk_select'",
        )
        .bind(SCHEMA)
        .fetch_one(&w.db)
        .await
        .unwrap();
        assert!(qual.contains("ctx_levels"), "{qual}");
    }
}
