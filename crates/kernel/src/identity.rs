//! Identita': password (argon2id), sessioni, limite ai tentativi di login, secondo
//! fattore degli Administrator (TOTP), bootstrap.
//!
//! Ogni utente si autentica sempre sul proprio tenant di appartenenza. Gli
//! Administrator sono account del tenant di sistema e hanno un accesso a parte
//! ([`admin_login`]), sempre locale, con secondo fattore se `admin_totp`.

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
use crate::{events, totp, Error, Kernel, Result, Role, SessionUser};

pub const MIN_PASSWORD_LEN: usize = 10;
const MAX_FAILURES: u32 = 8;
const FAILURE_WINDOW: Duration = Duration::from_secs(15 * 60);
/// durata di una sessione in attesa del secondo fattore
const PENDING_MINUTES: i32 = 10;
const RECOVERY_CODES: usize = 10;

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

/// File con le credenziali generate al primo avvio (nella cartella dei dati).
pub const INITIAL_CREDENTIALS: &str = "credenziali-iniziali.txt";

/// Primo avvio: tenant `system` con l'Administrator `admin` e, se configurato
/// (`initial_tenant`, versione desktop), un tenant di lavoro con il suo Tenant Manager.
pub async fn bootstrap(k: &Kernel) -> Result<()> {
    let mut notes: Vec<String> = Vec::new();
    let exists: bool =
        mosaikit_db::query_scalar("select exists (select 1 from core.tenants where is_system)")
            .fetch_one(&k.db)
            .await?;
    if !exists {
        let (password, generated) = match std::env::var("MOSAIKIT_ADMIN_PASSWORD") {
            Ok(p) if !p.is_empty() => {
                check_password_policy(&p)?;
                (p, false)
            }
            // `initial_password` (desktop) vale anche se piu' corta della policy: si cambia dall'Account
            _ => (initial_password(k), true),
        };
        let hash = hash_password(k, &password).await?;
        let mut tx = k.db.begin_app().await?;
        let tenant: Uuid = mosaikit_db::query_scalar(
            "insert into core.tenants (slug, name, is_system) values ('system', 'Sistema', true) returning id",
        )
        .fetch_one(&mut *tx)
        .await?;
        // il tenant di sistema contiene solo Administrator, senza membership: non e' uno spazio di lavoro
        mosaikit_db::query(
            "insert into core.users (home_tenant_id, username, display_name, password_hash, is_system_admin)
             values ($1, 'admin', 'Amministratore', $2, true)",
        )
        .bind(tenant)
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        if generated {
            notes.push(format!(
                "Amministrazione (link \"Accesso amministratori\", indirizzo dell'app + #/admin)\n\
                 utente: admin\npassword: {password}\n"
            ));
        }
    }
    if let Some(slug) = k.cfg.initial_tenant.as_deref() {
        if let Some(note) = initial_tenant(k, slug).await? {
            notes.push(note);
        }
    }
    if !notes.is_empty() {
        let file = k.cfg.data_dir.join(INITIAL_CREDENTIALS);
        let text = format!(
            "{}: credenziali iniziali\n\n{}\nCambia le password al primo accesso (pagina Account) ed elimina questo file.\n",
            k.brand.name,
            notes.join("\n")
        );
        let _ = std::fs::write(&file, &text);
        eprintln!("\n{text}(salvate in {})\n", file.display());
    }
    Ok(())
}

/// Password degli account creati al primo avvio: `initial_password` oppure generata.
fn initial_password(k: &Kernel) -> String {
    k.cfg.initial_password.clone().filter(|p| !p.is_empty()).unwrap_or_else(|| random_token(9))
}

/// Tenant di lavoro del primo avvio (nome del prodotto) con il Tenant Manager `utente`,
/// se non esiste ancora nessun tenant oltre a quello di sistema. Ritorna le credenziali.
async fn initial_tenant(k: &Kernel, slug: &str) -> Result<Option<String>> {
    let any: bool =
        mosaikit_db::query_scalar("select exists (select 1 from core.tenants where not is_system)")
            .fetch_one(&k.db)
            .await?;
    if any {
        return Ok(None);
    }
    let slug = slug.trim().to_lowercase();
    if !crate::tenancy::valid_slug(&slug) {
        return Err(Error::bad(format!("initial_tenant non valido: {slug} (minuscole, cifre e '-')")));
    }
    let password = initial_password(k);
    let hash = hash_password(k, &password).await?;
    let mut tx = k.db.begin_app().await?;
    let tenant: Uuid =
        mosaikit_db::query_scalar("insert into core.tenants (slug, name) values ($1, $2) returning id")
            .bind(&slug)
            .bind(&k.brand.name)
            .fetch_one(&mut *tx)
            .await?;
    let user: Uuid = mosaikit_db::query_scalar(
        "insert into core.users (home_tenant_id, username, display_name, password_hash)
         values ($1, 'utente', 'Utente', $2) returning id",
    )
    .bind(tenant)
    .bind(&hash)
    .fetch_one(&mut *tx)
    .await?;
    mosaikit_db::query(
        "insert into core.memberships (tenant_id, user_id, role) values ($1, $2, 'tenant_manager')",
    )
    .bind(tenant)
    .bind(user)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(format!(
        "Lavoro (pagina di accesso, tenant {})\nutente: utente\npassword: {password}\n",
        k.brand.name
    )))
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

/// Accesso di un utente al proprio tenant. Gli Administrator usano [`admin_login`].
pub async fn login(
    k: &Kernel,
    tenant_slug: &str,
    username: &str,
    password: &str,
    ip: &str,
) -> Result<LoginResult> {
    let tenant_slug = tenant_slug.trim().to_lowercase();
    let system: Option<bool> =
        mosaikit_db::query_scalar("select is_system from core.tenants where slug = $1")
            .bind(&tenant_slug)
            .fetch_optional(&k.db)
            .await?;
    if system == Some(true) {
        return Err(Error::bad("gli Administrator accedono dalla pagina \"Accesso amministratori\""));
    }
    let user_id = check_credentials(k, &tenant_slug, username, password, ip).await?;
    finish_login(k, user_id, ip).await
}

/// Esito dell'accesso di un Administrator: completo, oppure in attesa del secondo fattore.
#[derive(Debug)]
pub enum AdminLogin {
    Done(LoginResult),
    /// `step`: "totp" (codice) o "totp_setup" (prima registrazione dell'app)
    Pending {
        token: String,
        csrf: String,
        step: &'static str,
    },
}

/// Accesso di un Administrator (tenant di sistema, sempre con password locale).
pub async fn admin_login(k: &Kernel, username: &str, password: &str, ip: &str) -> Result<AdminLogin> {
    let slug: String =
        mosaikit_db::query_scalar("select slug from core.tenants where is_system").fetch_one(&k.db).await?;
    let user_id = check_credentials(k, &slug, username, password, ip).await?;
    let enabled: bool = mosaikit_db::query_scalar("select totp_enabled from core.users where id = $1")
        .bind(user_id)
        .fetch_one(&k.db)
        .await?;
    let step = if enabled {
        "totp"
    } else if k.cfg.admin_totp {
        "totp_setup"
    } else {
        return Ok(AdminLogin::Done(finish_login(k, user_id, ip).await?));
    };
    let (token, csrf) = open_session(k, user_id, Some(step)).await?;
    Ok(AdminLogin::Pending { token, csrf, step })
}

/// Utente e password sul tenant indicato, con il limite ai tentativi falliti.
async fn check_credentials(
    k: &Kernel,
    tenant_slug: &str,
    username: &str,
    password: &str,
    ip: &str,
) -> Result<Uuid> {
    let username = username.trim().to_lowercase();
    let user_key = format!("u:{tenant_slug}/{username}");
    let ip_key = format!("ip:{ip}");
    if k.limiter.blocked(&user_key) || k.limiter.blocked(&ip_key) {
        return Err(too_many());
    }
    let row = mosaikit_db::query(
        "select u.id, u.password_hash from core.users u join core.tenants t on t.id = u.home_tenant_id
         where t.slug = $1 and u.username = $2 and u.status = 'active' and t.status = 'active'",
    )
    .bind(tenant_slug)
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
    Ok(user_id)
}

fn too_many() -> Error {
    Error::new(crate::Kind::TooMany, "troppi tentativi falliti: riprova tra qualche minuto")
}

/// Nuova sessione (completa, o in attesa del secondo fattore); ritorna token e CSRF.
async fn open_session(k: &Kernel, user_id: Uuid, pending: Option<&str>) -> Result<(String, String)> {
    let token = random_token(32);
    let csrf = random_token(16);
    let minutes = match pending {
        Some(_) => PENDING_MINUTES,
        None => (k.cfg.session_ttl_hours * 60) as i32,
    };
    mosaikit_db::query(
        "insert into core.sessions (token_hash, user_id, csrf, expires_at, pending)
         values ($1, $2, $3, now() + make_interval(mins => $4), $5)",
    )
    .bind(sha256(token.as_bytes()))
    .bind(user_id)
    .bind(&csrf)
    .bind(minutes)
    .bind(pending.map(str::to_string))
    .execute(&k.db)
    .await?;
    // pulizia delle sessioni scadute
    let _ = mosaikit_db::query("delete from core.sessions where expires_at < now()").execute(&k.db).await;
    Ok((token, csrf))
}

async fn finish_login(k: &Kernel, user_id: Uuid, ip: &str) -> Result<LoginResult> {
    let (token, _) = open_session(k, user_id, None).await?;
    let user =
        session(k, &token).await?.ok_or_else(|| Error::internal("sessione appena creata non trovata"))?;
    events::record(k, Some(user.home_tenant_id), Some(user_id), None, None, "login", json!({ "ip": ip }))
        .await;
    Ok(LoginResult { token, user })
}

/// Sessione in attesa del secondo fattore (vale solo per completare l'accesso).
#[derive(Debug, Clone)]
pub struct PendingLogin {
    pub user_id: Uuid,
    pub username: String,
    pub step: String,
    pub csrf: String,
    pub token_hash: Vec<u8>,
}

pub async fn pending_session(k: &Kernel, token: &str) -> Result<Option<PendingLogin>> {
    if token.len() != 64 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(None);
    }
    let hash = sha256(token.as_bytes());
    let row = mosaikit_db::query(
        "select s.user_id, u.username, s.pending, s.csrf from core.sessions s join core.users u on u.id = s.user_id
         where s.token_hash = $1 and s.pending is not null and s.expires_at > now() and u.status = 'active'",
    )
    .bind(&hash)
    .fetch_optional(&k.db)
    .await?;
    Ok(row.map(|r| PendingLogin {
        user_id: r.get(0),
        username: r.get(1),
        step: r.get(2),
        csrf: r.get(3),
        token_hash: hash,
    }))
}

/// Dati per registrare l'app di autenticazione.
#[derive(Debug, Clone, Serialize)]
pub struct TotpSetup {
    pub secret: String,
    pub uri: String,
    pub qr_svg: String,
}

/// Nuovo segreto TOTP per la prima registrazione (sostituisce uno non ancora confermato).
pub async fn totp_setup(k: &Kernel, p: &PendingLogin) -> Result<TotpSetup> {
    if p.step != "totp_setup" {
        return Err(Error::bad("il secondo fattore e' gia' configurato"));
    }
    let secret = totp::new_secret();
    mosaikit_db::query("update core.users set totp_secret = $2, totp_enabled = false where id = $1")
        .bind(p.user_id)
        .bind(&secret)
        .execute(&k.db)
        .await?;
    let uri = totp::uri(&k.brand.name, &p.username, &secret);
    Ok(TotpSetup { qr_svg: totp::qr_svg(&uri), secret, uri })
}

/// Conferma la registrazione con un codice dell'app: attiva il secondo fattore, completa
/// l'accesso e ritorna i codici di recupero (mostrati una sola volta).
pub async fn totp_enable(
    k: &Kernel,
    p: &PendingLogin,
    code: &str,
    ip: &str,
) -> Result<(LoginResult, Vec<String>)> {
    if p.step != "totp_setup" {
        return Err(Error::bad("il secondo fattore e' gia' configurato"));
    }
    let key = format!("totp:{}", p.user_id);
    if k.limiter.blocked(&key) {
        return Err(too_many());
    }
    let secret: Option<String> =
        mosaikit_db::query_scalar("select totp_secret from core.users where id = $1")
            .bind(p.user_id)
            .fetch_one(&k.db)
            .await?;
    let secret = secret.ok_or_else(|| Error::bad("registra prima l'app di autenticazione"))?;
    let Some(step) = totp::verify(&secret, code, totp::current_step(), 0) else {
        k.limiter.fail(&key);
        return Err(Error::unauthorized("codice non valido"));
    };
    k.limiter.clear(&key);
    let codes = totp::recovery_codes(RECOVERY_CODES);
    mosaikit_db::query(
        "update core.users set totp_enabled = true, totp_last_step = $2, totp_recovery = $3 where id = $1",
    )
    .bind(p.user_id)
    .bind(step as i64)
    .bind(recovery_json(&codes))
    .execute(&k.db)
    .await?;
    close_pending(k, p).await?;
    events::record(k, None, Some(p.user_id), None, None, "admin.totp_enable", json!({})).await;
    Ok((finish_login(k, p.user_id, ip).await?, codes))
}

/// Secondo passaggio dell'accesso: codice dell'app oppure un codice di recupero (monouso).
pub async fn totp_verify(k: &Kernel, p: &PendingLogin, code: &str, ip: &str) -> Result<LoginResult> {
    if p.step != "totp" {
        return Err(Error::bad("registra prima l'app di autenticazione"));
    }
    let key = format!("totp:{}", p.user_id);
    if k.limiter.blocked(&key) {
        return Err(too_many());
    }
    let r =
        mosaikit_db::query("select totp_secret, totp_last_step, totp_recovery from core.users where id = $1")
            .bind(p.user_id)
            .fetch_one(&k.db)
            .await?;
    let secret: String = r.get::<Option<String>, _>(0).unwrap_or_default();
    let last: i64 = r.get(1);
    let mut recovery: Vec<String> = serde_json::from_str(r.get::<&str, _>(2)).unwrap_or_default();
    let ok = if let Some(step) = totp::verify(&secret, code, totp::current_step(), last.max(0) as u64) {
        // condizionale: lo stesso codice non vale per due accessi concorrenti
        mosaikit_db::query("update core.users set totp_last_step = $2 where id = $1 and totp_last_step < $2")
            .bind(p.user_id)
            .bind(step as i64)
            .execute(&k.db)
            .await?
            .rows_affected()
            == 1
    } else {
        let h = hex::encode(sha256(totp::normalize_recovery(code).as_bytes()));
        match recovery.iter().position(|x| *x == h) {
            Some(i) => {
                recovery.remove(i);
                mosaikit_db::query("update core.users set totp_recovery = $2 where id = $1")
                    .bind(p.user_id)
                    .bind(serde_json::to_string(&recovery).unwrap_or_default())
                    .execute(&k.db)
                    .await?;
                events::record(
                    k,
                    None,
                    Some(p.user_id),
                    None,
                    None,
                    "admin.recovery_code",
                    json!({ "left": recovery.len() }),
                )
                .await;
                true
            }
            None => false,
        }
    };
    if !ok {
        k.limiter.fail(&key);
        return Err(Error::unauthorized("codice non valido"));
    }
    k.limiter.clear(&key);
    close_pending(k, p).await?;
    finish_login(k, p.user_id, ip).await
}

async fn close_pending(k: &Kernel, p: &PendingLogin) -> Result<()> {
    mosaikit_db::query("delete from core.sessions where token_hash = $1")
        .bind(&p.token_hash)
        .execute(&k.db)
        .await?;
    Ok(())
}

fn recovery_json(codes: &[String]) -> String {
    let hashes: Vec<String> = codes.iter().map(|c| hex::encode(sha256(c.as_bytes()))).collect();
    serde_json::to_string(&hashes).unwrap_or_default()
}

/// Toglie il secondo fattore: al prossimo accesso l'app va registrata di nuovo.
pub async fn reset_totp(k: &Kernel, user_id: Uuid) -> Result<()> {
    mosaikit_db::query(
        "update core.users set totp_secret = null, totp_enabled = false, totp_last_step = 0, totp_recovery = '[]'
         where id = $1",
    )
    .bind(user_id)
    .execute(&k.db)
    .await?;
    mosaikit_db::query("delete from core.sessions where user_id = $1").bind(user_id).execute(&k.db).await?;
    Ok(())
}

/// Accesso di emergenza (riga di comando): toglie il secondo fattore di un Administrator.
pub async fn reset_admin_totp(k: &Kernel, username: &str) -> Result<()> {
    let id: Option<Uuid> = mosaikit_db::query_scalar(
        "select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id
         where t.is_system and u.username = $1",
    )
    .bind(username.trim().to_lowercase())
    .fetch_optional(&k.db)
    .await?;
    let id = id.ok_or_else(|| Error::not_found("Administrator non trovato"))?;
    reset_totp(k, id).await
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
         where s.token_hash = $1 and s.pending is null and s.expires_at > now()
           and u.status = 'active' and t.status = 'active'",
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
