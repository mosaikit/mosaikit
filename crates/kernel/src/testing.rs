//! Support for the tests of the kernel and of the server: throwaway database, plugins
//! compiled and signed with a test key, tenants and users ready.

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

pub const PASSWORD: &str = "test-password";
pub const ADMIN_PASSWORD: &str = "admin-test-password";

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

/// Publisher key used in the tests (deterministic).
pub fn test_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

pub fn test_public_key() -> String {
    mosaikit_mskp::public_key_b64(&test_key())
}

/// Folder of the official plugins: `MOSAIKIT_PLUGINS_DIR` or `../mosaikit-plugins`.
pub fn plugins_root() -> PathBuf {
    std::env::var_os("MOSAIKIT_PLUGINS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_root().join("..").join("mosaikit-plugins"))
}

/// Compiles (once per process) the plugins with WASM logic.
pub fn build_wasm_plugins() -> PathBuf {
    static BUILD: Once = Once::new();
    let root = plugins_root();
    BUILD.call_once(|| {
        assert!(
            root.join("Cargo.toml").is_file(),
            "plugins not found in {}: clone mosaikit-plugins next to mosaikit or set MOSAIKIT_PLUGINS_DIR",
            root.display()
        );
        let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
        let status = std::process::Command::new(cargo)
            .current_dir(&root)
            .env_remove("CARGO_TARGET_DIR")
            .args(["build", "--quiet", "--target", "wasm32-unknown-unknown"])
            .args(["-p", "notes", "-p", "tasks", "-p", "contacts", "-p", "maps"])
            .status()
            .expect("cargo build of the plugins");
        assert!(status.success(), "WASM build of the plugins failed");
    });
    root.join("target").join("wasm32-unknown-unknown").join("debug")
}

/// Signed package of an official plugin (`mosaikit-plugins/<name>`).
pub fn pack_plugin(name: &str) -> Vec<u8> {
    let dir = plugins_root().join(name);
    let wasm = if dir.join("Cargo.toml").is_file() {
        Some(build_wasm_plugins().join(format!("{}.wasm", name.replace('-', "_"))))
    } else {
        None
    };
    let files = mosaikit_mskp::collect_plugin_dir(&dir, wasm.as_deref()).expect("files of the plugin");
    mosaikit_mskp::pack(&files, Some(&test_key())).expect("pack")
}

/// Compiles to WASM the given crates of a plugin workspace (e.g. the ones of a
/// distribution); returns the folder with the `.wasm` files.
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
        cmd.status().expect("cargo build of the plugins").success(),
        "WASM build failed in {}",
        workspace.display()
    );
    workspace.join("target").join("wasm32-unknown-unknown").join("debug")
}

/// Package signed with the test key of a plugin in any folder.
pub fn pack_dir(dir: &Path, wasm: Option<&Path>) -> Vec<u8> {
    let files = mosaikit_mskp::collect_plugin_dir(dir, wasm).expect("files of the plugin");
    mosaikit_mskp::pack(&files, Some(&test_key())).expect("pack")
}

pub struct TestKernel {
    pub k: Arc<Kernel>,
    pub dir: tempfile::TempDir,
    _db: Option<TestDb>,
}

/// Backend of the tests: `MOSAIKIT_TEST_BACKEND=sqlite` (default PostgreSQL).
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
        // the second factor has its own tests (identity_tenancy)
        admin_totp: false,
        no_background: true,
        ..Config::default()
    };
    f(&mut cfg);
    let k = Kernel::start(cfg).await.expect("start of the kernel");
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
            other => panic!("incomplete admin sign-in: {other:?}"),
        }
    }

    /// Installs (signed) and turns on a plugin of the repository.
    pub async fn install(&self, name: &str) {
        let p = install_package(&self.k, None, &pack_plugin(name), InstallSource::Upload)
            .await
            .expect("installation");
        set_active(&self.k, None, &p.id, true).await.expect("activation");
    }

    /// Installs and turns on a package (e.g. from `pack_dir`); returns the id of the plugin.
    pub async fn install_package(&self, pkg: &[u8]) -> crate::Result<String> {
        let p = install_package(&self.k, None, pkg, InstallSource::Upload).await?;
        set_active(&self.k, None, &p.id, true).await?;
        Ok(p.id.clone())
    }

    /// Creates a tenant with the manager `<slug>-manager`; returns the authenticated manager.
    pub async fn tenant(&self, slug: &str) -> SessionUser {
        let admin = self.admin().await;
        let manager = format!("{slug}-manager");
        create_tenant(
            &self.k,
            &admin,
            NewTenant {
                slug,
                name: &slug.to_uppercase(),
                manager_username: &manager,
                manager_display_name: "Manager",
                manager_email: &format!("{manager}@example.org"),
                manager_password: PASSWORD,
                trial_until: None,
            },
        )
        .await
        .expect("tenant");
        self.login(slug, &manager).await
    }

    /// Creates a member of the tenant of the manager and signs them in.
    pub async fn member(&self, manager: &SessionUser, username: &str) -> SessionUser {
        let c = self.caller(manager, &manager.home_tenant_slug).await;
        create_member(&self.k, &c, username, username, &format!("{username}@example.org"), PASSWORD, Role::User).await.expect("member");
        self.login(&manager.home_tenant_slug, username).await
    }

    pub async fn login(&self, tenant: &str, username: &str) -> SessionUser {
        login(&self.k, tenant, username, PASSWORD, "test").await.expect("login").user
    }

    pub async fn caller(&self, user: &SessionUser, tenant: &str) -> Caller {
        caller(&self.k, user, tenant).await.expect("caller")
    }

    /// Caller in the home tenant.
    pub async fn home(&self, user: &SessionUser) -> Caller {
        self.caller(user, &user.home_tenant_slug.clone()).await
    }
}

/// A mail server for the tests: accepts every message (EHLO, AUTH, MAIL, RCPT, DATA) and keeps it.
pub struct FakeSmtp {
    pub port: u16,
    /// the messages received: (recipient, whole message with the headers)
    pub mails: Arc<std::sync::Mutex<Vec<(String, String)>>>,
}

impl FakeSmtp {
    pub async fn start() -> FakeSmtp {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("fake smtp");
        let port = listener.local_addr().expect("address").port();
        let mails: Arc<std::sync::Mutex<Vec<(String, String)>>> = Arc::default();
        let store = mails.clone();
        tokio::spawn(async move {
            while let Ok((sock, _)) = listener.accept().await {
                let store = store.clone();
                tokio::spawn(async move {
                    let (r, mut w) = sock.into_split();
                    let mut r = BufReader::new(r);
                    let _ = w.write_all(b"220 fake ESMTP\r\n").await;
                    let mut to = String::new();
                    let mut line = String::new();
                    loop {
                        line.clear();
                        if r.read_line(&mut line).await.unwrap_or(0) == 0 {
                            break;
                        }
                        let cmd = line.trim_end().to_ascii_uppercase();
                        let answer: &[u8] = if cmd.starts_with("EHLO") {
                            b"250-fake\r\n250 AUTH PLAIN\r\n"
                        } else if cmd.starts_with("AUTH") {
                            b"235 ok\r\n"
                        } else if cmd.starts_with("RCPT TO:") {
                            to = line.trim_end()[8..]
                                .trim_matches(|c| c == '<' || c == '>' || c == ' ')
                                .to_string();
                            b"250 ok\r\n"
                        } else if cmd == "DATA" {
                            let _ = w.write_all(b"354 go\r\n").await;
                            let mut msg = String::new();
                            loop {
                                line.clear();
                                if r.read_line(&mut line).await.unwrap_or(0) == 0 || line.trim_end() == "." {
                                    break;
                                }
                                msg.push_str(&line);
                            }
                            store.lock().expect("mails").push((to.clone(), msg));
                            b"250 queued\r\n"
                        } else if cmd == "QUIT" {
                            let _ = w.write_all(b"221 bye\r\n").await;
                            break;
                        } else {
                            b"250 ok\r\n"
                        };
                        let _ = w.write_all(answer).await;
                    }
                });
            }
        });
        FakeSmtp { port, mails }
    }

    /// The text of a message received (the body is base64).
    pub fn text(message: &str) -> String {
        use base64::Engine;
        let body = message.split("\r\n\r\n").nth(1).unwrap_or_default().replace("\r\n", "");
        String::from_utf8(base64::engine::general_purpose::STANDARD.decode(body).unwrap_or_default())
            .unwrap_or_default()
    }
}
