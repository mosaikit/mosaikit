//! Identita': password (argon2id), sessioni, limite ai tentativi di login, bootstrap.
//!
//! Ogni utente si autentica sempre sul proprio tenant di appartenenza.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, SaltString};
use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::util::{random_token, sha256};
use crate::{events, Error, Kernel, Result, Role, SessionUser};

pub const MIN_PASSWORD_LEN: usize = 10;
const MAX_FAILURES: u32 = 8;
const FAILURE_WINDOW: Duration = Duration::from_secs(15 * 60);

/// Tentativi falliti per chiave (utente o IP) nella finestra.
#[derive(Default)]
pub struct LoginLimiter(Mutex<HashMap<String, (u32, Instant)>>);

impl LoginLimiter {
    fn blocked(&self, key: &str) -> bool {
        let map = self.0.lock().expect("lock limiter");
        map.get(key).is_some_and(|(n, t)| *n >= MAX_FAILURES && t.elapsed() < FAILURE_WINDOW)
    }
    fn fail(&self, key: &str) {
        let mut map = self.0.lock().expect("lock limiter");
        let e = map.entry(key.to_string()).or_insert((0, Instant::now()));
        if e.1.elapsed() >= FAILURE_WINDOW {
            *e = (0, Instant::now());
        }
        e.0 += 1;
        e.1 = Instant::now();
    }
    fn clear(&self, key: &str) {
        self.0.lock().expect("lock limiter").remove(key);
    }
}

pub fn check_password_policy(pw: &str) -> Result<()> {
    if pw.chars().count() < MIN_PASSWORD_LEN {
        return Err(Error::bad(format!("la password deve avere almeno {MIN_PASSWORD_LEN} caratteri")));
    }
    let first = pw.chars().next();
    if pw.chars().all(|c| Some(c) == first) {
        return Err(Error::bad("password troppo semplice"));
    }
    Ok(())
}

pub async fn hash_password(k: &Kernel, pw: &str) -> Result<String> {
    let _permit = k.argon.acquire().await.map_err(|e| Error::internal(e.to_string()))?;
    let pw = pw.to_string();
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(pw.as_bytes(), &salt)
            .map(|h| h.to_string())
            .map_err(|e| Error::internal(e.to_string()))
    })
    .await?
}

pub async fn verify_password(k: &Kernel, hash: Option<String>, pw: &str) -> Result<bool> {
    // hash fittizio: stesso tempo di risposta anche per utenti inesistenti
    static DUMMY: OnceLock<String> = OnceLock::new();
    let hash = match hash {
        Some(h) => h,
        None => DUMMY
            .get_or_init(|| {
                let salt = SaltString::generate(&mut OsRng);
                Argon2::default()
                    .hash_password(b"dummy-password", &salt)
                    .map(|h| h.to_string())
                    .unwrap_or_default()
            })
            .clone(),
    };
    let _permit = k.argon.acquire().await.map_err(|e| Error::internal(e.to_string()))?;
    let pw = pw.to_string();
    tokio::task::spawn_blocking(move || {
        Ok(PasswordHash::new(&hash)
            .is_ok_and(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok()))
    })
    .await?
}

/// Primo avvio: tenant `system` e utente `admin`.
pub async fn bootstrap(k: &Kernel) -> Result<()> {
    let exists: bool =
        mosaikit_db::query_scalar("select exists (select 1 from core.tenants where is_system)")
            .fetch_one(&k.db)
            .await?;
    if exists {
        return Ok(());
    }
    let (password, generated) = match std::env::var("MOSAIKIT_ADMIN_PASSWORD") {
        Ok(p) if !p.is_empty() => (p, false),
        _ => (random_token(9), true),
    };
    check_password_policy(&password)?;
    let hash = hash_password(k, &password).await?;
    let mut tx = k.db.begin_app().await?;
    let tenant: Uuid = mosaikit_db::query_scalar(
        "insert into core.tenants (slug, name, is_system) values ('system', 'Sistema', true) returning id",
    )
    .fetch_one(&mut *tx)
    .await?;
    let admin: Uuid = mosaikit_db::query_scalar(
        "insert into core.users (home_tenant_id, username, display_name, password_hash, is_system_admin)
         values ($1, 'admin', 'Amministratore', $2, true) returning id",
    )
    .bind(tenant)
    .bind(&hash)
    .fetch_one(&mut *tx)
    .await?;
    mosaikit_db::query(
        "insert into core.memberships (tenant_id, user_id, role) values ($1, $2, 'tenant_manager')",
    )
    .bind(tenant)
    .bind(admin)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if generated {
        let file = k.cfg.data_dir.join("initial-admin-password.txt");
        let text = format!(
            "Mosaikit: credenziali iniziali dell'amministratore di sistema\n\
             tenant: system\nutente: admin\npassword: {password}\n\n\
             Cambia la password al primo accesso ed elimina questo file.\n"
        );
        let _ = std::fs::write(&file, text);
        eprintln!(
            "\n  Amministratore creato -> tenant: system, utente: admin, password: {password}\n  \
             (salvata anche in {}: cambiala al primo accesso)\n",
            file.display()
        );
    }
    Ok(())
}

pub struct LoginResult {
    pub token: String,
    pub user: SessionUser,
}

impl std::fmt::Debug for LoginResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LoginResult")
            .field("token", &"<riservato>")
            .field("user", &self.user.username)
            .finish()
    }
}

pub async fn login(
    k: &Kernel,
    tenant_slug: &str,
    username: &str,
    password: &str,
    ip: &str,
) -> Result<LoginResult> {
    let tenant_slug = tenant_slug.trim().to_lowercase();
    let username = username.trim().to_lowercase();
    let user_key = format!("u:{tenant_slug}/{username}");
    let ip_key = format!("ip:{ip}");
    if k.limiter.blocked(&user_key) || k.limiter.blocked(&ip_key) {
        return Err(Error::new(crate::Kind::TooMany, "troppi tentativi falliti: riprova tra qualche minuto"));
    }
    let row = mosaikit_db::query(
        "select u.id, u.password_hash from core.users u join core.tenants t on t.id = u.home_tenant_id
         where t.slug = $1 and u.username = $2 and u.status = 'active' and t.status = 'active'",
    )
    .bind(&tenant_slug)
    .bind(&username)
    .fetch_optional(&k.db)
    .await?;
    let (user_id, hash) = match &row {
        Some(r) => (Some(r.get::<Uuid, _>(0)), r.get::<Option<String>, _>(1)),
        None => (None, None),
    };
    let ok = verify_password(k, hash, password).await?;
    let Some(user_id) = user_id.filter(|_| ok) else {
        k.limiter.fail(&user_key);
        k.limiter.fail(&ip_key);
        return Err(Error::unauthorized("credenziali non valide"));
    };
    k.limiter.clear(&user_key);

    let token = random_token(32);
    let csrf = random_token(16);
    mosaikit_db::query(
        "insert into core.sessions (token_hash, user_id, csrf, expires_at)
         values ($1, $2, $3, now() + make_interval(hours => $4))",
    )
    .bind(sha256(token.as_bytes()))
    .bind(user_id)
    .bind(&csrf)
    .bind(k.cfg.session_ttl_hours as i32)
    .execute(&k.db)
    .await?;
    // pulizia delle sessioni scadute
    let _ = mosaikit_db::query("delete from core.sessions where expires_at < now()").execute(&k.db).await;
    let user =
        session(k, &token).await?.ok_or_else(|| Error::internal("sessione appena creata non trovata"))?;
    events::record(k, Some(user.home_tenant_id), Some(user_id), None, None, "login", json!({ "ip": ip }))
        .await;
    Ok(LoginResult { token, user })
}

pub async fn session(k: &Kernel, token: &str) -> Result<Option<SessionUser>> {
    if token.len() != 64 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(None);
    }
    let hash = sha256(token.as_bytes());
    let row = mosaikit_db::query(
        "select s.user_id, u.username, u.display_name, u.home_tenant_id, t.slug, u.is_system_admin, s.csrf,
                s.last_seen < now() - interval '5 minutes' as stale
         from core.sessions s
         join core.users u on u.id = s.user_id
         join core.tenants t on t.id = u.home_tenant_id
         where s.token_hash = $1 and s.expires_at > now() and u.status = 'active' and t.status = 'active'",
    )
    .bind(&hash)
    .fetch_optional(&k.db)
    .await?;
    let Some(r) = row else { return Ok(None) };
    if r.get::<bool, _>(7) {
        let _ = mosaikit_db::query("update core.sessions set last_seen = now() where token_hash = $1")
            .bind(&hash)
            .execute(&k.db)
            .await;
    }
    Ok(Some(SessionUser {
        user_id: r.get(0),
        username: r.get(1),
        display_name: r.get(2),
        home_tenant_id: r.get(3),
        home_tenant_slug: r.get(4),
        is_system_admin: r.get(5),
        csrf: r.get(6),
        token_hash: hash,
    }))
}

pub async fn logout(k: &Kernel, user: &SessionUser) -> Result<()> {
    mosaikit_db::query("delete from core.sessions where token_hash = $1")
        .bind(&user.token_hash)
        .execute(&k.db)
        .await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct Membership {
    pub tenant_id: Uuid,
    pub slug: String,
    pub name: String,
    pub role: Role,
    pub is_home: bool,
    pub is_system: bool,
}

pub async fn memberships(k: &Kernel, user: &SessionUser) -> Result<Vec<Membership>> {
    let rows = mosaikit_db::query(
        "select t.id, t.slug, t.name, m.role, t.id = u.home_tenant_id, t.is_system
         from core.memberships m join core.tenants t on t.id = m.tenant_id join core.users u on u.id = m.user_id
         where m.user_id = $1 and t.status = 'active'
         order by (t.id = u.home_tenant_id) desc, t.name",
    )
    .bind(user.user_id)
    .fetch_all(&k.db)
    .await?;
    rows.iter()
        .map(|r| {
            Ok(Membership {
                tenant_id: r.get(0),
                slug: r.get(1),
                name: r.get(2),
                role: Role::parse(r.get::<&str, _>(3))?,
                is_home: r.get(4),
                is_system: r.get(5),
            })
        })
        .collect()
}

pub async fn change_password(k: &Kernel, user: &SessionUser, old: &str, new: &str) -> Result<()> {
    let hash: Option<String> =
        mosaikit_db::query_scalar("select password_hash from core.users where id = $1")
            .bind(user.user_id)
            .fetch_one(&k.db)
            .await?;
    if !verify_password(k, hash, old).await? {
        return Err(Error::forbidden("password attuale errata"));
    }
    set_password(k, user.user_id, new).await?;
    // le altre sessioni dell'utente vengono chiuse
    mosaikit_db::query("delete from core.sessions where user_id = $1 and token_hash <> $2")
        .bind(user.user_id)
        .bind(&user.token_hash)
        .execute(&k.db)
        .await?;
    Ok(())
}

pub async fn set_password(k: &Kernel, user_id: Uuid, new: &str) -> Result<()> {
    check_password_policy(new)?;
    let hash = hash_password(k, new).await?;
    mosaikit_db::query("update core.users set password_hash = $2 where id = $1")
        .bind(user_id)
        .bind(hash)
        .execute(&k.db)
        .await?;
    Ok(())
}

/// Reimposta la password di un utente (comando di amministrazione da riga di comando).
pub async fn reset_password(k: &Kernel, tenant_slug: &str, username: &str, new: &str) -> Result<()> {
    let id: Option<Uuid> = mosaikit_db::query_scalar(
        "select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id where t.slug = $1 and u.username = $2",
    )
    .bind(tenant_slug)
    .bind(username)
    .fetch_optional(&k.db)
    .await?;
    let id = id.ok_or_else(|| Error::not_found("utente non trovato"))?;
    set_password(k, id, new).await?;
    mosaikit_db::query("delete from core.sessions where user_id = $1").bind(id).execute(&k.db).await?;
    Ok(())
}

pub fn valid_username(u: &str) -> bool {
    let mut c = u.chars();
    matches!(c.next(), Some('a'..='z' | '0'..='9'))
        && u.len() >= 2
        && u.len() <= 64
        && c.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || ".-_".contains(c))
}
