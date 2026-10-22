//! Life cycle of the plugins: signature, update, migrations, catalog, blocklist,
//! uninstall, development, malicious plugins.

use std::collections::BTreeMap;

use mosaikit_kernel::plugins::{self, install_package, set_active, InstallSource};
use mosaikit_kernel::testing::{pack_plugin, plugins_root, start, start_with, test_key, TestKernel};
use mosaikit_kernel::{crud, Kind};
use serde_json::json;

fn notes_files() -> BTreeMap<String, Vec<u8>> {
    let dir = plugins_root().join("notes");
    let wasm = mosaikit_kernel::testing::build_wasm_plugins().join("notes.wasm");
    mosaikit_mskp::collect_plugin_dir(&dir, Some(&wasm)).unwrap()
}

fn with_version(files: BTreeMap<String, Vec<u8>>, v: &str) -> BTreeMap<String, Vec<u8>> {
    edit_manifest(files, |toml| {
        toml.lines()
            .map(|l| if l.starts_with("version = ") { format!("version = \"{v}\"") } else { l.to_string() })
            .collect::<Vec<_>>()
            .join("\n")
    })
}

fn edit_manifest(
    mut files: BTreeMap<String, Vec<u8>>,
    f: impl FnOnce(&str) -> String,
) -> BTreeMap<String, Vec<u8>> {
    let toml = f(std::str::from_utf8(&files["plugin.toml"]).unwrap());
    files.insert("plugin.toml".into(), toml.into_bytes());
    files
}

async fn install(t: &TestKernel, files: &BTreeMap<String, Vec<u8>>) -> mosaikit_kernel::Result<()> {
    let pkg = mosaikit_mskp::pack(files, Some(&test_key())).unwrap();
    install_package(t, None, &pkg, InstallSource::Upload).await.map(|_| ())
}

#[tokio::test]
async fn signature_required_and_trusted_keys() {
    let t = start().await;
    let unsigned = mosaikit_mskp::pack(&notes_files(), None).unwrap();
    let e = install_package(&t, None, &unsigned, InstallSource::Upload).await.err().unwrap();
    assert!(e.message.contains("unsigned"), "{e}");
    let other = mosaikit_mskp::generate_key();
    let foreign = mosaikit_mskp::pack(&notes_files(), Some(&other)).unwrap();
    let e = install_package(&t, None, &foreign, InstallSource::Upload).await.err().unwrap();
    assert!(e.message.contains("not trusted"), "{e}");
    // altered package: one byte changed
    let mut bad = pack_plugin("notes");
    let n = bad.len();
    bad[n / 2] ^= 0xff;
    assert!(install_package(&t, None, &bad, InstallSource::Upload).await.is_err());
    // an administrator is required when the request comes from a user
    let g = t.tenant("alfa").await;
    let e = install_package(&t, Some(&g), &pack_plugin("notes"), InstallSource::Upload).await.err().unwrap();
    assert_eq!(e.kind, Kind::Forbidden);

    // in development unsigned packages are accepted
    let dev = start_with(|c| c.allow_unsigned = true).await;
    install_package(&dev, None, &unsigned, InstallSource::Upload).await.unwrap();
}

#[tokio::test]
async fn update_with_migrations_keeps_the_data() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let c = t.home(&g).await;
    crud::create(
        &t,
        &c,
        "com.mosaikit.notes",
        "notes",
        json!({ "title": "first" }).as_object().unwrap(),
        None,
    )
    .await
    .unwrap();

    let mut v2 = with_version(notes_files(), "0.5.0");
    v2.insert("migrations/003_priority.sql".into(), b"alter table notes add column priority text".to_vec());
    install(&t, &v2).await.unwrap();
    let p = t.plugins.get("com.mosaikit.notes").unwrap();
    assert_eq!(p.manifest.version, "0.5.0");
    assert!(p.is_active(), "the active state is kept");
    let rows = crud::list(&t, &c, "com.mosaikit.notes", "notes", None, None).await.unwrap().rows;
    assert_eq!(rows.len(), 1);
    let ps = t.db.plugin_schema("com.mosaikit.notes", "plg_com_mosaikit_notes");
    let mut tx = t.db.begin_app().await.unwrap();
    let cols = ps.columns(&mut tx, "notes").await.unwrap();
    drop(tx);
    assert!(cols.iter().any(|(c, _)| c == "priority"), "{cols:?}");

    // downgrade and the same version with a different content refused
    assert!(install(&t, &notes_files()).await.unwrap_err().message.contains("downgrade"));
    let mut same = v2.clone();
    same.insert("migrations/004_x.sql".into(), b"alter table notes add column x text".to_vec());
    assert_eq!(install(&t, &same).await.unwrap_err().kind, Kind::Conflict);
    // migration already applied and then changed
    let mut changed = with_version(notes_files(), "0.6.0");
    changed.insert(
        "migrations/003_priority.sql".into(),
        b"alter table notes add column priority2 text".to_vec(),
    );
    let e = install(&t, &changed).await.unwrap_err();
    assert!(e.message.contains("differs"), "{e}");
}

#[tokio::test]
async fn update_to_english_converts_the_values() {
    let t = start().await;
    // the version before the translation: Italian values of the tag, no 002_english.sql
    let mut old = edit_manifest(with_version(notes_files(), "0.3.0"), |toml| {
        toml.replace(
            r#"options = ["personal", "work", "urgent"]"#,
            r#"options = ["personale", "lavoro", "urgente"]"#,
        )
        .lines()
        .filter(|l| !l.starts_with("options.tag"))
        .collect::<Vec<_>>()
        .join("\n")
    });
    old.remove("migrations/002_english.sql");
    install(&t, &old).await.unwrap();
    set_active(&t, None, "com.mosaikit.notes", true).await.unwrap();
    let g = t.tenant("alfa").await;
    let c = t.home(&g).await;
    let tag = |v: &str| json!({ "title": v, "tag": v }).as_object().unwrap().clone();
    for v in ["lavoro", "urgente"] {
        crud::create(&t, &c, "com.mosaikit.notes", "notes", &tag(v), None).await.unwrap();
    }
    install(&t, &notes_files()).await.unwrap();
    let rows = crud::list(&t, &c, "com.mosaikit.notes", "notes", None, None).await.unwrap().rows;
    let mut tags: Vec<&str> = rows.iter().map(|r| r["values"]["tag"].as_str().unwrap()).collect();
    tags.sort();
    assert_eq!(tags, ["urgent", "work"]);
    // the KPI view has the English columns
    let k = mosaikit_kernel::kpi::tenant(&t, &c).await.unwrap();
    let notes = k.plugins.iter().find(|p| p.view == "kpi_notes_by_tag").unwrap();
    assert!(notes.rows.iter().all(|r| r.get("notes").is_some()), "{:?}", notes.rows);
}

#[tokio::test]
async fn texts_in_the_language_of_the_request() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let c = t.home(&g).await;
    let view = |lang: &str| {
        plugins::active_views_in(&t, lang).into_iter().find(|p| p.id == "com.mosaikit.notes").unwrap()
    };
    assert_eq!(view("en").label, "Notes");
    assert_eq!(view("it-IT").label, "Note");
    assert_eq!(view("fr").label, "Notes", "no translation: English");
    let fields = plugins::localized_fields(&t, "com.mosaikit.notes", "notes", "it").unwrap();
    let tag = fields.iter().find(|f| f.key == "tag").unwrap();
    assert_eq!(tag.option_labels.get("work").map(String::as_str), Some("lavoro"));
    assert_eq!(fields.iter().find(|f| f.key == "title").unwrap().label, "Titolo");
    let mut k = mosaikit_kernel::kpi::tenant(&t, &c).await.unwrap();
    mosaikit_kernel::kpi::localize(&t, &mut k.plugins, "it");
    let notes = k.plugins.iter().find(|p| p.view == "kpi_notes_by_tag").unwrap();
    assert_eq!((notes.plugin.as_str(), notes.label.as_str()), ("Note", "Note per tag"));
    assert_eq!(notes.columns.get("notes").map(String::as_str), Some("note"));
}

#[tokio::test]
async fn refused_migration_rolls_back_everything() {
    let t = start().await;
    for (sql, expect) in [
        ("create table free_table (title text)", "resource_id"),
        ("create function f() returns int as 'select 1' language sql", "not allowed"),
        ("create table t (resource_id uuid not null, tenant_id uuid not null); grant all on t to public", "not allowed"),
        ("create view kpi_theft as select tenant_id, username from core.users join core.memberships on user_id = id", "not accessible"),
    ] {
        let mut f = notes_files();
        f.insert("migrations/003_bad.sql".into(), sql.as_bytes().to_vec());
        let e = install(&t, &f).await.unwrap_err();
        assert!(e.message.contains(expect), "{sql}: {e}");
        let rows: i64 = mosaikit_db::query_scalar("select count(*) from core.plugins").fetch_one(&t.db).await.unwrap();
        assert_eq!(rows, 0, "no trace of the plugin");
        let schema: bool = mosaikit_db::query_scalar("select exists (select 1 from pg_namespace where nspname = 'plg_com_mosaikit_notes')")
            .sqlite("select exists (select 1 from sqlite_master where name like 'plg_com_mosaikit_notes%')")
            .fetch_one(&t.db)
            .await
            .unwrap();
        assert!(!schema);
        assert!(t.plugins.get("com.mosaikit.notes").is_none());
    }
}

#[tokio::test]
async fn catalog_and_blocklist() {
    let t = start().await;
    let reg = tempfile::tempdir().unwrap();
    let dir = reg.path().to_path_buf();
    std::fs::create_dir_all(dir.join("plugins")).unwrap();
    let pkg = pack_plugin("notes");
    std::fs::write(dir.join("plugins/notes.mskp"), &pkg).unwrap();
    let sha = mosaikit_mskp::package_sha256(&pkg);
    let index = |blocked: bool, sha: &str| {
        json!({
            "plugins": [{ "id": "com.mosaikit.notes", "name": "Notes", "versions": [
                { "version": "0.4.1", "file": "plugins/notes.mskp", "sha256": sha }
            ]}],
            "blocklist": if blocked { json!([{ "id": "com.mosaikit.notes", "version": "0.4.1", "reason": "test" }]) } else { json!([]) }
        })
    };
    std::fs::write(dir.join("index.json"), index(false, "0000").to_string()).unwrap();
    let t = restart_with_registry(t, dir.join("index.json")).await;
    let admin = t.admin().await;
    let cat = plugins::registry::catalog(&t, &admin).unwrap();
    assert_eq!(cat.len(), 1);
    assert!(cat[0].installed.is_none());
    // sha256 different from the one of the registry
    let e = plugins::registry::install_from_catalog(&t, &admin, "com.mosaikit.notes").await.unwrap_err();
    assert_eq!(e.kind, Kind::Forbidden);
    std::fs::write(t.cfg.registry.as_ref().unwrap(), index(false, &sha).to_string()).unwrap();
    plugins::registry::install_from_catalog(&t, &admin, "com.mosaikit.notes").await.unwrap();
    assert_eq!(plugins::registry::catalog(&t, &admin).unwrap()[0].installed.as_deref(), Some("0.4.1"));
    // blocklist: it is not turned on and not reinstalled
    std::fs::write(t.cfg.registry.as_ref().unwrap(), index(true, &sha).to_string()).unwrap();
    plugins::uninstall(&t, &admin, "com.mosaikit.notes").await.unwrap();
    let e = install_package(&t, None, &pkg, InstallSource::Upload).await.err().unwrap();
    assert!(e.message.contains("blocklist"), "{e}");
}

async fn restart_with_registry(old: TestKernel, path: std::path::PathBuf) -> TestKernel {
    drop(old);
    start_with(|c| c.registry = Some(path)).await
}

#[tokio::test]
async fn preinstall_from_the_catalog() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("plugins")).unwrap();
    let pkg = pack_plugin("tasks");
    std::fs::write(dir.path().join("plugins/tasks.mskp"), &pkg).unwrap();
    let index = json!({ "plugins": [{ "id": "com.mosaikit.tasks", "name": "Tasks", "versions": [
        { "version": "0.4.1", "file": "plugins/tasks.mskp", "sha256": mosaikit_mskp::package_sha256(&pkg) } ]}] });
    std::fs::write(dir.path().join("index.json"), index.to_string()).unwrap();
    let path = dir.path().join("index.json");
    let t = start_with(|c| {
        c.registry = Some(path);
        c.preinstall = true;
    })
    .await;
    assert!(t.plugins.active("com.mosaikit.tasks").is_ok());
}

#[tokio::test]
async fn uninstall_removes_everything() {
    let t = start().await;
    t.install("files").await;
    let g = t.tenant("alfa").await;
    let c = t.home(&g).await;
    let f = mosaikit_kernel::files::upload(&t, &c, "com.mosaikit.files", None, "a.txt", b"x", false)
        .await
        .unwrap();
    let blob = t.blobs.file_path(c.tenant.tenant_id, f.id);
    assert!(blob.is_file());
    let admin = t.admin().await;
    assert_eq!(plugins::uninstall(&t, &g, "com.mosaikit.files").await.unwrap_err().kind, Kind::Forbidden);
    plugins::uninstall(&t, &admin, "com.mosaikit.files").await.unwrap();
    assert!(!blob.exists());
    let n: i64 =
        mosaikit_db::query_scalar("select count(*) from core.resources").fetch_one(&t.db).await.unwrap();
    assert_eq!(n, 0);
    assert!(t.plugins.get("com.mosaikit.files").is_none());
}

#[tokio::test]
async fn deactivation_hides_the_plugin() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let c = t.home(&g).await;
    set_active(&t, None, "com.mosaikit.notes", false).await.unwrap();
    let e = crud::list(&t, &c, "com.mosaikit.notes", "notes", None, None).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);
    assert!(plugins::active_views(&t).is_empty());
}

// ------------------------------------------------------------------ malicious plugin (WAT)

/// Guest that, at every call, forwards a fixed request to the host and returns the answer.
fn evil_wasm(request: &str) -> Vec<u8> {
    let escaped = request.replace('\\', "\\\\").replace('"', "\\\"");
    let wat = format!(
        r#"(module
  (import "msk" "host_call" (func $host_call (param i32 i32) (result i32)))
  (import "msk" "host_read" (func $host_read (param i32)))
  (memory (export "memory") 2)
  (data (i32.const 16) "{escaped}")
  (global $bump (mut i32) (i32.const 65536))
  (func (export "msk_alloc") (param $len i32) (result i32)
    (local $p i32) (local.set $p (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $len))) (local.get $p))
  (func (export "msk_call") (param i32 i32) (result i64)
    (local $n i32)
    (local.set $n (call $host_call (i32.const 16) (i32.const {len})))
    (call $host_read (i32.const 32768))
    (i64.or (i64.shl (i64.const 32768) (i64.const 32)) (i64.extend_i32_u (local.get $n))))
)"#,
        len = request.len()
    );
    wat::parse_str(wat).unwrap()
}

const EVIL_TOML: &str = r#"
id = "com.test.evil"
name = "Evil"
version = "1.0.0"
[contribution]
icon = "x"
label = "Evil"
[[resources]]
name = "items"
fields = [{ key = "title", kind = "text" }]
"#;

async fn evil(t: &TestKernel, request: serde_json::Value) -> mosaikit_kernel::Result<serde_json::Value> {
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), EVIL_TOML.as_bytes().to_vec());
    files.insert("logic.wasm".to_string(), evil_wasm(&request.to_string()));
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    if t.plugins.get("com.test.evil").is_some() {
        let admin = t.admin().await;
        plugins::uninstall(t, &admin, "com.test.evil").await.unwrap();
    }
    let p = install_package(t, None, &pkg, InstallSource::Upload).await.unwrap();
    set_active(t, None, &p.id, true).await.unwrap();
    let g = t.login("alfa", "alfa-manager").await;
    let c = t.home(&g).await;
    crud::call(t, &c, "com.test.evil", "x", json!(null)).await
}

#[tokio::test]
async fn malicious_plugin_contained() {
    let t = start().await;
    t.tenant("alfa").await;
    let ok = evil(
        &t,
        json!({ "op": "db.query", "req": { "sql": "select count(*)::int as n from items", "params": [] } }),
    )
    .await
    .unwrap();
    assert_eq!(ok, json!([{ "n": 0 }]));
    for (sql, expect) in [
        ("select * from core.users", "not accessible"),
        ("select * from core.secrets", "not accessible"),
        ("select * from pg_catalog.pg_authid", "not accessible"),
        ("set role postgres", "not allowed"),
        ("select set_config('a.b', 'c', false)", "not allowed"),
        ("select pg_sleep(30)", "not allowed"),
        ("update core.resources set owner_id = owner_id", "not accessible"),
    ] {
        let e = evil(&t, json!({ "op": "db.query", "req": { "sql": sql, "params": [] } })).await.unwrap_err();
        assert!(e.message.contains(expect), "{sql}: {e}");
    }
    let e =
        evil(&t, json!({ "op": "http.fetch", "req": { "url": "https://example.com/x" } })).await.unwrap_err();
    assert!(e.message.contains("permissions.network"), "{e}");
    let e = evil(&t, json!({ "op": "fs.read", "req": {} })).await.unwrap_err();
    assert!(e.message.contains("unknown"), "{e}");
}

#[tokio::test]
async fn plugin_in_endless_loop_stopped() {
    let t = start().await;
    t.tenant("alfa").await;
    let wat = r#"(module (memory (export "memory") 1)
        (func (export "msk_alloc") (param i32) (result i32) i32.const 1024)
        (func (export "msk_call") (param i32 i32) (result i64) (loop $l (br $l)) i64.const 0))"#;
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), EVIL_TOML.as_bytes().to_vec());
    files.insert("logic.wasm".to_string(), wat::parse_str(wat).unwrap());
    let p = install_package(
        &t,
        None,
        &mosaikit_mskp::pack(&files, Some(&test_key())).unwrap(),
        InstallSource::Upload,
    )
    .await
    .unwrap();
    set_active(&t, None, &p.id, true).await.unwrap();
    let g = t.login("alfa", "alfa-manager").await;
    let c = t.home(&g).await;
    let started = std::time::Instant::now();
    let e = crud::call(&t, &c, "com.test.evil", "x", json!(null)).await.unwrap_err();
    assert!(e.message.contains("instruction limit"), "{e}");
    assert!(started.elapsed() < std::time::Duration::from_secs(120));
}

// ------------------------------------------------------------------ development

#[tokio::test]
async fn development_mode_loads_from_the_folder() {
    let src = tempfile::tempdir().unwrap();
    let dir = src.path().join("notes");
    std::fs::create_dir_all(dir.join("migrations")).unwrap();
    std::fs::copy(plugins_root().join("notes/plugin.toml"), dir.join("plugin.toml")).unwrap();
    std::fs::copy(plugins_root().join("notes/migrations/001_kpi.sql"), dir.join("migrations/001_kpi.sql"))
        .unwrap();
    let d2 = dir.clone();
    let t = start_with(move |c| {
        c.dev.enabled = true;
        c.dev.plugins = vec![d2];
    })
    .await;
    let p = t.plugins.active("com.mosaikit.notes").unwrap();
    assert!(p.dev);
    assert!(p.module.is_none(), "no Cargo.toml in the copy: plugin without logic");
    // new migration: applied at reload
    std::fs::write(dir.join("migrations/002_x.sql"), "alter table notes add column extra text").unwrap();
    plugins::dev::load_one(&t, &dir).await.unwrap();
    // changed migration: message that guides to the reset
    std::fs::write(dir.join("migrations/002_x.sql"), "alter table notes add column other text").unwrap();
    let e = plugins::dev::load_one(&t, &dir).await.unwrap_err();
    assert!(e.message.contains("db-reset"), "{e}");
    // a package cannot overwrite a development plugin
    let e = install_package(&t, None, &pack_plugin("notes"), InstallSource::Upload).await.err().unwrap();
    assert_eq!(e.kind, Kind::Conflict);
}
