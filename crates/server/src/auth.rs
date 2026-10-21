//! Sessione da cookie `HttpOnly`, CSRF, tenant della richiesta, IP del client.

use std::net::SocketAddr;

use axum::extract::{ConnectInfo, FromRef, FromRequestParts, Path};
use axum::http::request::Parts;
use axum::http::{header, HeaderValue, Method};
use mosaikit_kernel::{identity, tenancy, Caller, Error, SessionUser};

use crate::{ApiError, AppState};

pub const SESSION_COOKIE: &str = "msk_session";
pub const CSRF_HEADER: &str = "x-csrf-token";

impl FromRef<AppState> for std::sync::Arc<mosaikit_kernel::Kernel> {
    fn from_ref(s: &AppState) -> Self {
        s.k.clone()
    }
}

pub fn cookie(parts: &Parts, name: &str) -> Option<String> {
    parts
        .headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

/// `Set-Cookie` della sessione (vuoto + scaduto per il logout).
pub fn session_cookie(state: &AppState, token: Option<&str>) -> HeaderValue {
    let secure = if state.k.cfg.cookie_secure() { "; Secure" } else { "" };
    let path = format!("{}/", state.k.cfg.base_path);
    let v = match token {
        Some(t) => format!(
            "{SESSION_COOKIE}={t}; HttpOnly; SameSite=Strict; Path={path}; Max-Age={}{secure}",
            state.k.cfg.session_ttl_hours * 3600
        ),
        None => format!("{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path={path}; Max-Age=0{secure}"),
    };
    HeaderValue::from_str(&v).expect("cookie valido")
}

fn mutating(m: &Method) -> bool {
    !matches!(*m, Method::GET | Method::HEAD | Method::OPTIONS)
}

/// Utente autenticato. Per i metodi che modificano dati richiede `X-CSRF-Token`.
pub struct Auth(pub SessionUser);

impl FromRequestParts<AppState> for Auth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = cookie(parts, SESSION_COOKIE)
            .ok_or_else(|| ApiError(Error::unauthorized("accesso richiesto")))?;
        let user = identity::session(&state.k, &token)
            .await?
            .ok_or_else(|| ApiError(Error::unauthorized("sessione scaduta: accedi di nuovo")))?;
        if mutating(&parts.method) {
            let sent = parts.headers.get(CSRF_HEADER).and_then(|v| v.to_str().ok()).unwrap_or_default();
            if sent.is_empty() || sent != user.csrf {
                return Err(ApiError(Error::forbidden("token CSRF mancante o non valido")));
            }
        }
        Ok(Auth(user))
    }
}

/// Utente + tenant attivo (`/api/t/{tenant}/...`), membership verificata.
pub struct Tenant(pub Caller);

impl FromRequestParts<AppState> for Tenant {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let Auth(user) = Auth::from_request_parts(parts, state).await?;
        let Path(params): Path<std::collections::HashMap<String, String>> =
            Path::from_request_parts(parts, state).await.map_err(|e| crate::bad(e.to_string()))?;
        let slug = params.get("t").ok_or_else(|| crate::bad("tenant mancante"))?;
        Ok(Tenant(tenancy::caller(&state.k, &user, slug).await?))
    }
}

/// IP del client (per il limite ai tentativi di login).
pub struct ClientIp(pub String);

impl FromRequestParts<AppState> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        if state.k.cfg.trust_proxy {
            if let Some(ip) = parts
                .headers
                .get("x-forwarded-for")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.split(',').next())
            {
                return Ok(ClientIp(ip.trim().to_string()));
            }
        }
        let ip = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip().to_string())
            .unwrap_or_else(|| "sconosciuto".into());
        Ok(ClientIp(ip))
    }
}
