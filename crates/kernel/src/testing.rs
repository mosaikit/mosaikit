//! Supporto ai test del kernel e del server: database usa e getta, plugin
//! compilati e firmati con una chiave di test, tenant e utenti pronti.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Once};

use ed25519_dalek_key::SigningKey;
use uuid::Uuid;

pub use mosaikit_db::testing::TestDb;

use crate::identity::{login, set_password};
use crate::plugins::{install_package, set_active, InstallSource};
use crate::tenancy::{caller, create_member, create_tenant, NewTenant};
use crate::{Caller, Config, Kernel, Role, SessionUser};

mod ed25519_dalek_key {
    pub type SigningKey = ed25519_dalek::SigningKey;
}

pub const PASSWORD: &str = "password-di-test";
pub const ADMIN_PASSWORD: &str = "admin-password-di-test";

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

/// Chiave dell'editore usata nei test (deterministica).
pub fn test_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

pub fn test_public_key() -> String {
    mosaikit_mskp::public_key_b64(&test_key())
}

/// Cartella dei plugin ufficiali: `MOSAIKIT_PLUGINS_DIR` o `../mosaikit-plugins`.
pub fn plugins_root() -> PathBuf {
    std::env::var_os("MOSAIKIT_PLUGINS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_root().join("..").join("mosaikit-plugins"))
}

/// Compila (una volta per processo) i plugin con logica in WASM.
pub fn build_wasm_plugins() -> PathBuf {
    static BUILD: Once = Once::new();
    let root = plugins_root();
    BUILD.call_once(|| {
        assert!(
            root.join("Cargo.toml").is_file(),
            "plugin non trovati in {}: clona mosaikit-plugins accanto a mosaikit o imposta MOSAIKIT_PLUGINS_DIR",
            root.display()
        );
        let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
        let status = std::process::Command::new(cargo)
            .current_dir(&root)
            .env_remove("CARGO_TARGET_DIR")
            .args(["build", "--quiet", "--target", "wasm32-unknown-unknown"])
            .args(["-p", "notes", "-p", "tasks", "-p", "contacts", "-p", "maps"])
            .status()
            .expect("cargo build dei plugin");
        assert!(status.success(), "build WASM dei plugin fallita");
    });
    root.join("target").join("wasm32-unknown-unknown").join("debug")
}

/// Pacchetto firmato di un plugin ufficiale (`mosaikit-plugins/<nome>`).
pub fn pack_plugin(name: &str) -> Vec<u8> {
    let dir = plugins_root().join(name);
    let wasm = if dir.join("Cargo.toml").is_file() {
        Some(build_wasm_plugins().join(format!("{}.wasm", name.replace('-', "_"))))
    } else {
        None
    };
    let files = mosaikit_mskp::collect_plugin_dir(&dir, wasm.as_deref()).expect("file del plugin");
    mosaikit_mskp::pack(&files, Some(&test_key())).expect("pack")
}

/// Compila in WASM i crate indicati di un workspace di plugin (es. quelli di una
/// distribuzione); ritorna la cartella con i `.wasm`.
pub fn build_wasm_in(workspace: &Path, crates: &[&str]) -> PathBuf {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    let mut cmd = std::process::Command::new(cargo);
    cmd.current_dir(workspace).env_remove("CARGO_TARGET_DIR").args([
        "build",
        "--quiet",
        "--target",
        "wasm32-unknown-unknown",
    ]);
    for c in crates {
        cmd.args(["-p", c]);
    }
    assert!(
        cmd.status().expect("cargo build dei plugin").success(),
        "build WASM fallita in {}",
        workspace.display()
    );
    workspace.join("target").join("wasm32-unknown-unknown").join("debug")
}

/// Pacchetto firmato con la chiave di test di un plugin in una cartella qualsiasi.
pub fn pack_dir(dir: &Path, wasm: Option<&Path>) -> Vec<u8> {
    let files = mosaikit_mskp::collect_plugin_dir(dir, wasm).expect("file del plugin");
    mosaikit_mskp::pack(&files, Some(&test_key())).expect("pack")
}

pub struct TestKernel {
    pub k: Arc<Kernel>,
    pub dir: tempfile::TempDir,
    _db: Option<TestDb>,
}

/// Backend dei test: `MOSAIKIT_TEST_BACKEND=sqlite` (default PostgreSQL).
pub fn test_backend_sqlite() -> bool {
    std::env::var("MOSAIKIT_TEST_BACKEND").is_ok_and(|b| b.eq_ignore_ascii_case("sqlite"))
}

impl std::ops::Deref for TestKernel {
    type Target = Kernel;
    fn deref(&self) -> &Kernel {
        &self.k
    }
}

pub async fn start() -> TestKernel {
    start_with(|_| {}).await
}

pub async fn start_with(f: impl FnOnce(&mut Config)) -> TestKernel {
    let dir = tempfile::tempdir().expect("tempdir");
    let (db, database) = if test_backend_sqlite() {
        (
            None,
            crate::config::DatabaseConfig {
                backend: Some("sqlite".into()),
                file: Some(dir.path().join("mosaikit.db")),
                max_connections: 8,
                ..Default::default()
            },
        )
    } else {
        let db = TestDb::create().await;
        let url = db.url.clone();
        (Some(db), crate::config::DatabaseConfig { url: Some(url), max_connections: 8, ..Default::default() })
    };
    let mut cfg = Config {
        data_dir: dir.path().join("data"),
        trusted_keys: vec![test_public_key()],
        database,
        // il secondo fattore ha i suoi test (identity_tenancy)
        admin_totp: false,
        ..Config::default()
    };
    f(&mut cfg);
    let k = Kernel::start(cfg).await.expect("avvio del kernel");
    let admin: Uuid = mosaikit_db::query_scalar("select id from core.users where is_system_admin limit 1")
        .fetch_one(&k.db)
        .await
        .expect("admin");
    set_password(&k, admin, ADMIN_PASSWORD).await.expect("password admin");
    TestKernel { k, dir, _db: db }
}

impl TestKernel {
    pub async fn admin(&self) -> SessionUser {
        match crate::identity::admin_login(&self.k, "admin", ADMIN_PASSWORD, "test")
            .await
            .expect("login admin")
        {
            crate::identity::AdminLogin::Done(r) => r.user,
            other => panic!("accesso admin incompleto: {other:?}"),
        }
    }

    /// Installa (firmato) e attiva un plugin del repository.
    pub async fn install(&self, name: &str) {
        let p = install_package(&self.k, None, &pack_plugin(name), InstallSource::Upload)
            .await
            .expect("installazione");
        set_active(&self.k, None, &p.id, true).await.expect("attivazione");
    }

    /// Installa e attiva un pacchetto (es. da `pack_dir`); ritorna l'id del plugin.
    pub async fn install_package(&self, pkg: &[u8]) -> crate::Result<String> {
        let p = install_package(&self.k, None, pkg, InstallSource::Upload).await?;
        set_active(&self.k, None, &p.id, true).await?;
        Ok(p.id.clone())
    }

    /// Crea un tenant con il gestore `<slug>-gestore`; ritorna il gestore autenticato.
    pub async fn tenant(&self, slug: &str) -> SessionUser {
        let admin = self.admin().await;
        let manager = format!("{slug}-gestore");
        create_tenant(
            &self.k,
            &admin,
            NewTenant {
                slug,
                name: &slug.to_uppercase(),
                manager_username: &manager,
                manager_display_name: "Gestore",
                manager_password: PASSWORD,
            },
        )
        .await
        .expect("tenant");
        self.login(slug, &manager).await
    }

    /// Crea un membro del tenant del gestore e lo autentica.
    pub async fn member(&self, manager: &SessionUser, username: &str) -> SessionUser {
        let c = self.caller(manager, &manager.home_tenant_slug).await;
        create_member(&self.k, &c, username, username, PASSWORD, Role::User).await.expect("membro");
        self.login(&manager.home_tenant_slug, username).await
    }

    pub async fn login(&self, tenant: &str, username: &str) -> SessionUser {
        login(&self.k, tenant, username, PASSWORD, "test").await.expect("login").user
    }

    pub async fn caller(&self, user: &SessionUser, tenant: &str) -> Caller {
        caller(&self.k, user, tenant).await.expect("caller")
    }

    /// Caller nel tenant di appartenenza.
    pub async fn home(&self, user: &SessionUser) -> Caller {
        self.caller(user, &user.home_tenant_slug.clone()).await
    }
}
