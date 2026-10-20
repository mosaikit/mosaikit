//! Autenticazione: utenti con password PBKDF2-HMAC-SHA256 (sale random),
//! sessioni con token, ruoli e autorizzazioni per azione.
//! Le sessioni possono essere PERSISTITE su disco (data_dir/sessions.json):
//! sopravvivono ai restart del processo (fondamentale in dev con cargo
//! watch). Default di compatibilita': solo memoria (Auth::seeded).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use crate::json::Json;
use crate::sha256::pbkdf2_hmac_sha256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role { Admin, User }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    InstallPlugin,
    UninstallPlugin,
    ActivatePlugin,
    DeactivatePlugin,
    CrudRead,
    CrudWrite,
}

#[derive(Debug)]
pub enum AuthError {
    InvalidCredentials,
    SessionExpired,
    Unauthorized { action: Action },
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::InvalidCredentials => write!(f, "credenziali non valide"),
            AuthError::SessionExpired => write!(f, "sessione scaduta"),
            AuthError::Unauthorized { action } => write!(f, "azione non autorizzata: {action:?}"),
        }
    }
}
impl std::error::Error for AuthError {}

#[derive(Debug, Clone)]
pub struct Session {
    pub token: String,
    pub username: String,
    pub role: Role,
    pub expires_unix: u64,
}

struct User {
    username: String,
    role: Role,
    salt: [u8; 16],
    hash: [u8; 32],
}

pub struct Auth {
    users: Vec<User>,
    sessions: HashMap<String, Session>,
    sessions_file: Option<PathBuf>,
}

const ITERATIONS: u32 = 10_000;
const SESSION_TTL_SECS: u64 = 24 * 3600;

fn rand_bytes(n: usize) -> Vec<u8> {
    use std::io::Read;
    let mut buf = vec![0u8; n];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        if f.read_exact(&mut buf).is_ok() { return buf; }
    }
    let mut x = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64
        ^ (std::process::id() as u64) << 32;
    for b in buf.iter_mut() {
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        *b = (x & 0xff) as u8;
    }
    buf
}

/// Token casuale esadecimale (2*n caratteri): sessioni, ticket di accesso.
pub fn random_token(n: usize) -> String {
    rand_bytes(n).iter().map(|b| format!("{b:02x}")).collect()
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

impl Auth {
    /// Utenti seed, sessioni solo in memoria.
    pub fn seeded() -> Self {
        let mut a = Auth { users: Vec::new(), sessions: HashMap::new(), sessions_file: None };
        a.add_user("admin", "mosaikit2026!", Role::Admin);
        a.add_user("user", "demo1234", Role::User);
        a
    }

    /// Utenti seed + sessioni persistite in <data_dir>/sessions.json:
    /// i restart del processo non invalidano le sessioni attive.
    pub fn seeded_persisted(data_dir: &Path) -> Self {
        let mut a = Self::seeded();
        let _ = std::fs::create_dir_all(data_dir);
        let file = data_dir.join("sessions.json");
        if let Ok(s) = std::fs::read_to_string(&file) {
            if let Ok(j) = Json::parse(&s) {
                for sj in j.as_arr().unwrap_or_default() {
                    if let Some(sess) = session_from_json(&sj) {
                        a.sessions.insert(sess.token.clone(), sess);
                    }
                }
            }
        }
        a.sessions_file = Some(file);
        a
    }

    pub fn add_user(&mut self, username: &str, password: &str, role: Role) {
        let salt_vec = rand_bytes(16);
        let mut salt = [0u8; 16];
        salt.copy_from_slice(&salt_vec);
        let dk = pbkdf2_hmac_sha256(password.as_bytes(), &salt, ITERATIONS, 32);
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&dk);
        self.users.push(User { username: username.to_string(), role, salt, hash });
    }

    pub fn login(&mut self, username: &str, password: &str) -> Result<Session, AuthError> {
        let user = self.users.iter().find(|u| u.username == username)
            .ok_or(AuthError::InvalidCredentials)?;
        let dk = pbkdf2_hmac_sha256(password.as_bytes(), &user.salt, ITERATIONS, 32);
        if dk[..32] != user.hash[..] { return Err(AuthError::InvalidCredentials); }
        let token = random_token(32);
        let session = Session {
            token: token.clone(),
            username: user.username.clone(),
            role: user.role,
            expires_unix: now_unix() + SESSION_TTL_SECS,
        };
        self.sessions.insert(token.clone(), session.clone());
        self.persist();
        Ok(session)
    }

    pub fn logout(&mut self, token: &str) {
        self.sessions.remove(token);
        self.persist();
    }

    fn persist(&self) {
        if let Some(f) = &self.sessions_file {
            let arr = Json::Arr(self.sessions.values().map(session_to_json).collect());
            let _ = std::fs::write(f, arr.to_string());
        }
    }

    fn session(&self, token: &str) -> Result<&Session, AuthError> {
        let s = self.sessions.get(token).ok_or(AuthError::SessionExpired)?;
        if s.expires_unix < now_unix() { return Err(AuthError::SessionExpired); }
        Ok(s)
    }

    pub fn require(&self, token: &str, action: Action) -> Result<Session, AuthError> {
        let s = self.session(token)?;
        let ok = match (s.role, action) {
            (Role::Admin, _) => true,
            (Role::User, Action::CrudRead) | (Role::User, Action::CrudWrite) => true,
            (Role::User, Action::ActivatePlugin) | (Role::User, Action::DeactivatePlugin) => true,
            (Role::User, _) => false,
        };
        if ok { Ok(s.clone()) } else { Err(AuthError::Unauthorized { action }) }
    }

    pub fn role_of(&self, token: &str) -> Option<Role> {
        self.session(token).ok().map(|s| s.role)
    }

    pub fn session_public(&self, token: &str) -> Option<Session> {
        self.session(token).ok().cloned()
    }
}

fn session_to_json(s: &Session) -> Json {
    Json::Obj(vec![
        ("token".into(), Json::Str(s.token.clone())),
        ("username".into(), Json::Str(s.username.clone())),
        ("role".into(), Json::Str(match s.role { Role::Admin => "admin", Role::User => "user" }.into())),
        ("expires_unix".into(), Json::Num(s.expires_unix as f64)),
    ])
}

fn session_from_json(j: &Json) -> Option<Session> {
    Some(Session {
        token: j.get("token")?.as_str()?.to_string(),
        username: j.get("username")?.as_str()?.to_string(),
        role: match j.get("role")?.as_str()? {
            "admin" => Role::Admin,
            _ => Role::User,
        },
        expires_unix: j.get("expires_unix")?.as_f64()? as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_ok_e_ko() {
        let mut a = Auth::seeded();
        assert!(a.login("admin", "mosaikit2026!").is_ok());
        assert!(a.login("admin", "sbagliata").is_err());
    }

    #[test]
    fn ruoli() {
        let mut a = Auth::seeded();
        let u = a.login("user", "demo1234").unwrap();
        assert!(a.require(&u.token, Action::CrudWrite).is_ok());
        assert!(a.require(&u.token, Action::InstallPlugin).is_err());
        let adm = a.login("admin", "mosaikit2026!").unwrap();
        assert!(a.require(&adm.token, Action::InstallPlugin).is_ok());
    }

    #[test]
    fn persistenza_sessioni() {
        let dir = std::env::temp_dir().join(format!("msk-auth-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let tok = {
            let mut a = Auth::seeded_persisted(&dir);
            a.login("admin", "mosaikit2026!").unwrap().token
        };
        // nuova istanza (simula restart): la sessione e' ancora valida
        let b = Auth::seeded_persisted(&dir);
        assert!(b.session_public(&tok).is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
