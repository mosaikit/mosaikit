//! The developer profile (`developer_profile = true`, see `Config::developer_guard`): a throwaway tenant
//! with known accounts and sample content to try a plugin against, and what the development tools of the
//! shell need. Everything here runs only when the profile is on; with it off none of it is reachable.
//!
//! Accounts (the password of all of them is [`PASSWORD`]):
//! - `admin`, the Administrator (signs in from the "Administrator access" page, without second factor);
//! - `manager`, Tenant Manager of the tenant `dev`;
//! - `alice` and `bob`, Users of the tenant `dev`.
//!
//! The sample content is made once, with the tenant: a group of the two users, notifications, entries in
//! the Log and, when a plugin in development declares a resource, one item of it shared with Bob.

use serde::Serialize;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::acl::Level;
use crate::{events, identity, notify, tenancy, Error, Kernel, Result, SessionUser};

/// Slug of the tenant of the profile.
pub const TENANT: &str = "dev";
/// Development password of every account of the profile (public: it is in the documents).
pub const PASSWORD: &str = "mosaikit-dev";

/// A test account, as the shell shows it in the switch of users and on the sign-in page.
#[derive(Debug, Clone, Serialize)]
pub struct TestUser {
    pub username: &'static str,
    pub name: &'static str,
    /// "Administrator", "Tenant Manager" or "User"
    pub role: &'static str,
    /// the tenant it works in; none for the Administrator
    pub tenant: Option<&'static str>,
}

pub const USERS: [TestUser; 4] = [
    TestUser { username: "admin", name: "Administrator", role: "Administrator", tenant: None },
    TestUser { username: "manager", name: "Dev Manager", role: "Tenant Manager", tenant: Some(TENANT) },
    TestUser { username: "alice", name: "Alice Dev", role: "User", tenant: Some(TENANT) },
    TestUser { username: "bob", name: "Bob Dev", role: "User", tenant: Some(TENANT) },
];

/// The line of the log, and the text printed at start, while the profile is on.
pub fn announce(k: &Kernel) {
    let msg = format!(
        "DEVELOPER PROFILE ON: known passwords ({PASSWORD}), unsigned packages accepted, tenant '{TENANT}' with \
         the users admin, manager, alice and bob. Never use it for real data. App {}",
        k.cfg.app_url
    );
    tracing::warn!("{msg}");
    eprintln!("*** {msg}");
}

/// First start of the profile: the tenant, the users and the sample content. A tenant that is neither the
/// system one nor `dev` means real data: the start is refused (unless `developer_profile_allow_remote`).
pub async fn seed(k: &Kernel) -> Result<()> {
    let others: i64 =
        mosaikit_db::query_scalar("select count(*) from core.tenants where not is_system and slug <> $1")
            .bind(TENANT)
            .fetch_one(&k.db)
            .await?;
    if others > 0 && !k.cfg.developer_profile_allow_remote {
        return Err(Error::bad(format!(
            "the developer profile refuses to start: this database already has {others} tenant(s) besides '{TENANT}', so it may hold \
             real data. Use a new data folder for development, or set developer_profile_allow_remote = true."
        )));
    }
    let exists: bool =
        mosaikit_db::query_scalar("select exists (select 1 from core.tenants where slug = $1)")
            .bind(TENANT)
            .fetch_one(&k.db)
            .await?;
    if exists {
        return Ok(());
    }
    let hash = identity::hash_password(k, PASSWORD).await?;
    let mut tx = k.db.begin_app().await?;
    let tenant: Uuid = mosaikit_db::query_scalar(
        "insert into core.tenants (slug, name) values ($1, 'Development') returning id",
    )
    .bind(TENANT)
    .fetch_one(&mut *tx)
    .await?;
    for (i, u) in USERS.iter().filter(|u| u.tenant.is_some()).enumerate() {
        let id: Uuid = mosaikit_db::query_scalar(
            "insert into core.users (home_tenant_id, username, display_name, email, password_hash)
             values ($1, $2, $3, $4, $5) returning id",
        )
        .bind(tenant)
        .bind(u.username)
        .bind(u.name)
        .bind(format!("{}@dev.example.test", u.username))
        .bind(&hash)
        .fetch_one(&mut *tx)
        .await?;
        let role = if i == 0 { "tenant_manager" } else { "user" };
        mosaikit_db::query("insert into core.memberships (tenant_id, user_id, role) values ($1, $2, $3)")
            .bind(tenant)
            .bind(id)
            .bind(role)
            .execute(&mut *tx)
            .await?;
    }
    crate::access::create_default_profile(&mut tx, tenant).await?;
    tx.commit().await?;
    // boxed: the futures of the sample content are large in a debug build, and `Kernel::start` is polled on
    // the stack of the main thread: kept inline they would grow the future of the whole start
    Box::pin(sample_content(k)).await?;
    Ok(())
}

/// A session user for the seeding and for the switch of users, read from the database.
async fn user_of(k: &Kernel, username: &str) -> Result<SessionUser> {
    let row = mosaikit_db::query(
        "select u.id, u.display_name, u.home_tenant_id, t.slug, u.is_system_admin
         from core.users u join core.tenants t on t.id = u.home_tenant_id where u.username = $1",
    )
    .bind(username)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found(format!("test user {username} not found")))?;
    Ok(SessionUser {
        user_id: row.get(0),
        username: username.to_string(),
        display_name: row.get(1),
        home_tenant_id: row.get(2),
        home_tenant_slug: row.get(3),
        is_system_admin: row.get(4),
        csrf: String::new(),
        token_hash: Vec::new(),
    })
}

/// Group, notifications, Log and a shared item, so that sharing, the bell and the Log are not empty.
async fn sample_content(k: &Kernel) -> Result<()> {
    let manager = tenancy::caller(k, &user_of(k, "manager").await?, TENANT).await?;
    let alice = tenancy::caller(k, &user_of(k, "alice").await?, TENANT).await?;
    let bob = user_of(k, "bob").await?;
    let group = tenancy::create_group(k, &manager, "Developers").await?;
    for u in [&alice.user, &bob] {
        tenancy::set_group_member(k, &manager, group, u.user_id, true).await?;
    }
    for (user, body) in [
        (alice.user.user_id, "This is a test tenant: the data can be reset at any time."),
        (bob.user_id, "Switch users from the developer tools to try sharing."),
    ] {
        notify::emit(
            k,
            notify::New {
                user,
                tenant: Some(manager.tenant.tenant_id),
                kind: notify::NoteKind::System,
                title: "Welcome to the developer profile".into(),
                body: body.into(),
                link: format!("#/t/{TENANT}"),
                source: "kernel".into(),
                resource: None,
                data: json!({}),
            },
        )
        .await;
    }
    events::record(
        k,
        Some(manager.tenant.tenant_id),
        Some(manager.user.user_id),
        None,
        None,
        "dev.seed",
        json!({ "note": "sample content of the developer profile" }),
    )
    .await;
    // one item of the first plugin in development that has a resource, shared with Bob
    for p in k.plugins.list().into_iter().filter(|p| p.dev && p.is_active()) {
        let Some(decl) = p.manifest.resources.first() else { continue };
        let mut values = Map::new();
        for f in decl.fields.iter().filter(|f| !f.hidden) {
            use mosaikit_mskp::FieldKind::*;
            let v: Value = match f.kind {
                Text => json!("Sample item"),
                Number => json!(1),
                Bool => json!(false),
                Date => json!("2030-01-01"),
                Choice => match f.options.first() {
                    Some(o) => json!(o),
                    None => continue,
                },
            };
            values.insert(f.key.clone(), v);
        }
        match Box::pin(crate::crud::create(k, &alice, &p.id, &decl.name, &values, None)).await {
            Ok(row) => {
                let rid = row.get("id").and_then(Value::as_str).and_then(|s| s.parse::<Uuid>().ok());
                if let Some(rid) = rid {
                    if let Err(e) = Box::pin(crate::acl::set_grant(
                        k,
                        &alice,
                        rid,
                        "user",
                        bob.user_id,
                        Some(Level::Read),
                    ))
                    .await
                    {
                        tracing::debug!("sample share: {e}");
                    }
                }
            }
            Err(e) => tracing::debug!("sample item of {}: {e}", p.id),
        }
        break;
    }
    Ok(())
}

/// A session of one of the test users, without the password: the switch of users of the shell.
pub async fn session_for(k: &Kernel, username: &str, ip: &str) -> Result<identity::LoginResult> {
    if !k.cfg.developer_profile || !USERS.iter().any(|u| u.username == username) {
        return Err(Error::not_found("no such test user"));
    }
    let u = user_of(k, username).await?;
    identity::dev_session(k, u.user_id, ip).await
}

/// Deletes the data of a plugin in development (schema, rows, files) and loads it again from its folder:
/// the migrations run from the first one. The tenants keep it on.
pub async fn reset_plugin(k: &Kernel, id: &str) -> Result<()> {
    if !k.cfg.developer_profile {
        return Err(Error::not_found("developer profile not active"));
    }
    let dir = crate::plugins::dev::folder_of(k, id).ok_or_else(|| {
        Error::bad(format!("{id} is not loaded from a plugin folder: only those can be reset"))
    })?;
    crate::plugins::wipe(k, id).await?;
    crate::plugins::dev::load_one(k, &dir).await?;
    k.emit(crate::DevEvent::PluginChanged { id: id.to_string(), what: "schema".into() });
    Ok(())
}
