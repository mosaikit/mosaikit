//! Session from an `HttpOnly` cookie, CSRF, tenant of the request, IP of the client.

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

/// `Set-Cookie` of the session, token and lifetime in seconds (empty + expired for the logout).
pub fn session_cookie(state: &AppState, token: Option<(&str, i64)>) -> HeaderValue {
    let secure = if state.k.cfg.cookie_secure() { "; Secure" } else { "" };
    let path = format!("{}/", state.k.cfg.base_path);
    let v = match token {
        Some((t, max_age)) => {
            format!("{SESSION_COOKIE}={t}; HttpOnly; SameSite=Strict; Path={path}; Max-Age={max_age}{secure}")
        }
        None => format!("{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path={path}; Max-Age=0{secure}"),
    };
    HeaderValue::from_str(&v).expect("valid cookie")
}

fn mutating(m: &Method) -> bool {
    !matches!(*m, Method::GET | Method::HEAD | Method::OPTIONS)
}

/// Authenticated user. For the methods that change data it requires `X-CSRF-Token`.
pub struct Auth(pub SessionUser);

impl FromRequestParts<AppState> for Auth {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token =
            cookie(parts, SESSION_COOKIE).ok_or_else(|| ApiError(Error::unauthorized("sign-in required")))?;
        let user = identity::session(&state.k, &token)
            .await?
            .ok_or_else(|| ApiError(Error::unauthorized("session expired: sign in again")))?;
        if mutating(&parts.method) {
            let sent = parts.headers.get(CSRF_HEADER).and_then(|v| v.to_str().ok()).unwrap_or_default();
            if sent.is_empty() || sent != user.csrf {
                return Err(ApiError(Error::forbidden("missing or invalid CSRF token")));
            }
        }
        // during maintenance only the Administrators work; signing out stays possible
        if !parts.uri.path().contains("/api/auth/") {
            mosaikit_kernel::ops::maintenance::check(&state.k, Some(&user)).await?;
        }
        Ok(Auth(user))
    }
}

/// Session waiting for the second factor (sign-in of the Administrators). It always
/// requires `X-CSRF-Token` (received with the response to the sign-in).
pub struct Pending(pub identity::PendingLogin);

impl FromRequestParts<AppState> for Pending {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token =
            cookie(parts, SESSION_COOKIE).ok_or_else(|| ApiError(Error::unauthorized("sign-in required")))?;
        let p = identity::pending_session(&state.k, &token).await?.ok_or_else(|| {
            ApiError(Error::unauthorized("sign-in expired: enter username and password again"))
        })?;
        let sent = parts.headers.get(CSRF_HEADER).and_then(|v| v.to_str().ok()).unwrap_or_default();
        if sent.is_empty() || sent != p.csrf {
            return Err(ApiError(Error::forbidden("missing or invalid CSRF token")));
        }
        Ok(Pending(p))
    }
}

/// User + active tenant (`/api/t/{tenant}/...`), membership checked.
pub struct Tenant(pub Caller);

impl FromRequestParts<AppState> for Tenant {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let Auth(user) = Auth::from_request_parts(parts, state).await?;
        let Path(params): Path<std::collections::HashMap<String, String>> =
            Path::from_request_parts(parts, state).await.map_err(|e| crate::bad(e.to_string()))?;
        let slug = params.get("t").ok_or_else(|| crate::bad("missing tenant"))?;
        Ok(Tenant(tenancy::caller(&state.k, &user, slug).await?))
    }
}

/// IP of the client (for the limit on sign-in attempts).
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
            .unwrap_or_else(|| "unknown".into());
        Ok(ClientIp(ip))
    }
}
