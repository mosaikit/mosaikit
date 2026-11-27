//! OAuth 2.1 for the MCP server (authorization code with PKCE, public clients that register themselves, refresh tokens), as the
//! MCP specification asks of a server a client such as Claude Desktop connects to as a connector. One authorization server per
//! tenant. The result is an ordinary access token of `core.api_tokens` (so the person sees and revokes it with the others) that
//! lives an hour, and a refresh token that lives 30 days and is replaced at every use.

use base64::Engine;
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::tokens::PREFIX;
use crate::util::{random_token, sha256};
use crate::{events, Caller, Error, Kernel, Result};

pub const ACCESS_SECONDS: i64 = 3600;
pub const MAX_CLIENTS: i64 = 2000;

fn oauth(code: &'static str, msg: impl Into<String>) -> Error {
    Error::bad(msg).with_code(code)
}

/// `https` anywhere, `http` only on this machine (a desktop client listens on a local port); no fragment.
pub fn redirect_ok(u: &str) -> bool {
    if u.len() > 500 || u.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Ok(url) = url::Url::parse(u) else { return false };
    if url.fragment().is_some() || url.host_str().is_none() {
        return false;
    }
    match url.scheme() {
        "https" => true,
        "http" => matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")),
        _ => false,
    }
}

#[derive(Debug, Serialize)]
pub struct Client {
    pub client_id: String,
    pub client_name: String,
    pub redirect_uris: Vec<String>,
    pub token_endpoint_auth_method: &'static str,
    pub grant_types: [&'static str; 2],
    pub response_types: [&'static str; 1],
}

/// Dynamic client registration (RFC 7591): a public client names itself and the addresses it may be sent back to.
pub async fn register(k: &Kernel, name: &str, redirect_uris: &[String]) -> Result<Client> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(oauth("invalid_client_metadata", "client_name: 1 to 80 characters"));
    }
    if redirect_uris.is_empty() || redirect_uris.len() > 5 || !redirect_uris.iter().all(|u| redirect_ok(u)) {
        return Err(oauth(
            "invalid_redirect_uri",
            "redirect_uris: one to five addresses, https (or http on localhost), no fragment",
        ));
    }
    // a client nobody connected for a month is forgotten; the table does not grow without end
    let _ = mosaikit_db::query(
        "delete from core.oauth_clients where created_at < now() - make_interval(days => 30)
         and not exists (select 1 from core.api_tokens t where t.client_id = core.oauth_clients.client_id)",
    )
    .execute(&k.db)
    .await;
    let n: i64 =
        mosaikit_db::query_scalar("select count(*) from core.oauth_clients").fetch_one(&k.db).await?;
    if n >= MAX_CLIENTS {
        return Err(oauth("invalid_client_metadata", "too many registered clients: try again later"));
    }
    let id = format!("msk_{}", random_token(16));
    mosaikit_db::query("insert into core.oauth_clients (client_id, name, redirect_uris) values ($1, $2, $3)")
        .bind(&id)
        .bind(name)
        .bind(json!(redirect_uris))
        .execute(&k.db)
        .await?;
    Ok(Client {
        client_id: id,
        client_name: name.to_string(),
        redirect_uris: redirect_uris.to_vec(),
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
    })
}

async fn tenant_id(k: &Kernel, slug: &str) -> Result<Uuid> {
    mosaikit_db::query_scalar(
        "select id from core.tenants where slug = $1 and status = 'active' and not is_system",
    )
    .bind(slug)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("unknown tenant"))
}

#[derive(Debug, Serialize)]
pub struct Begun {
    pub grant: Uuid,
    pub client_name: String,
}

/// The client sends the person here (`/authorize`): the request is checked and kept until the person decides.
pub async fn begin(
    k: &Kernel,
    tenant: &str,
    client_id: &str,
    redirect_uri: &str,
    challenge: &str,
    method: &str,
    state: Option<&str>,
) -> Result<Begun> {
    let tenant = tenant_id(k, tenant).await?;
    let row = mosaikit_db::query("select name, redirect_uris from core.oauth_clients where client_id = $1")
        .bind(client_id)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(|| oauth("invalid_client", "unknown client"))?;
    let (name, uris): (String, serde_json::Value) = (row.get(0), row.get(1));
    if !uris.as_array().is_some_and(|a| a.iter().any(|u| u.as_str() == Some(redirect_uri))) {
        return Err(oauth("invalid_request", "redirect_uri is not one the client registered"));
    }
    if method != "S256" {
        return Err(oauth("invalid_request", "code_challenge_method must be S256"));
    }
    let ok = (43..=128).contains(&challenge.len())
        && challenge.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~'));
    if !ok {
        return Err(oauth("invalid_request", "code_challenge is not a valid S256 challenge"));
    }
    if state.is_some_and(|s| s.len() > 500) {
        return Err(oauth("invalid_request", "state is too long"));
    }
    let _ = mosaikit_db::query("delete from core.oauth_grants where expires_at < now()").execute(&k.db).await;
    let grant = Uuid::new_v4();
    mosaikit_db::query(
        "insert into core.oauth_grants (id, client_id, tenant_id, redirect_uri, code_challenge, state, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => 10))",
    )
    .bind(grant)
    .bind(client_id)
    .bind(tenant)
    .bind(redirect_uri)
    .bind(challenge)
    .bind(state)
    .execute(&k.db)
    .await?;
    Ok(Begun { grant, client_name: name })
}

/// What the person is asked to approve.
#[derive(Debug, Serialize)]
pub struct Pending {
    pub client_name: String,
    pub redirect_host: String,
}

pub async fn pending(k: &Kernel, c: &Caller, grant: Uuid) -> Result<Pending> {
    let row = mosaikit_db::query(
        "select cl.name, g.redirect_uri from core.oauth_grants g join core.oauth_clients cl on cl.client_id = g.client_id
         where g.id = $1 and g.tenant_id = $2 and g.status = 'pending' and g.expires_at > now()",
    )
    .bind(grant)
    .bind(c.tenant.tenant_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| oauth("invalid_request", "this request expired: start again from the application"))?;
    let uri: String = row.get(1);
    let host = url::Url::parse(&uri).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
    Ok(Pending { client_name: row.get(0), redirect_host: host })
}

fn back(uri: &str, params: &[(&str, &str)]) -> String {
    let mut u = url::Url::parse(uri).expect("registered address");
    {
        let mut q = u.query_pairs_mut();
        for (k, v) in params {
            q.append_pair(k, v);
        }
    }
    u.to_string()
}

/// The person answers: the address to send them back to, with the code (or `access_denied`) and the `state` of the client.
pub async fn decide(k: &Kernel, c: &Caller, grant: Uuid, approve: bool, allow_write: bool) -> Result<String> {
    let row = mosaikit_db::query(
        "select g.redirect_uri, g.state, cl.name from core.oauth_grants g join core.oauth_clients cl on cl.client_id = g.client_id
         where g.id = $1 and g.tenant_id = $2 and g.status = 'pending' and g.expires_at > now()",
    )
    .bind(grant)
    .bind(c.tenant.tenant_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| oauth("invalid_request", "this request expired: start again from the application"))?;
    let (uri, state, name): (String, Option<String>, String) = (row.get(0), row.get(1), row.get(2));
    let state = state.unwrap_or_default();
    if !approve {
        mosaikit_db::query("update core.oauth_grants set status = 'denied' where id = $1")
            .bind(grant)
            .execute(&k.db)
            .await?;
        events::record(
            k,
            Some(c.tenant.tenant_id),
            Some(c.user.user_id),
            None,
            None,
            "assistant.oauth_denied",
            json!({ "client": name }),
        )
        .await;
        let mut p: Vec<(&str, &str)> = vec![("error", "access_denied")];
        if !state.is_empty() {
            p.push(("state", &state));
        }
        return Ok(back(&uri, &p));
    }
    let code = format!("mskc_{}", random_token(24));
    let n = mosaikit_db::query(
        "update core.oauth_grants set status = 'approved', user_id = $2, allow_write = $3, code_hash = $4,
                expires_at = now() + make_interval(mins => 5)
         where id = $1 and status = 'pending' and expires_at > now()",
    )
    .bind(grant)
    .bind(c.user.user_id)
    .bind(allow_write)
    .bind(sha256(code.as_bytes()))
    .execute(&k.db)
    .await?
    .rows_affected();
    if n != 1 {
        return Err(oauth("invalid_request", "this request expired: start again from the application"));
    }
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "assistant.oauth_approved",
        json!({ "client": name, "allow_write": allow_write }),
    )
    .await;
    let mut p: Vec<(&str, &str)> = vec![("code", &code)];
    if !state.is_empty() {
        p.push(("state", &state));
    }
    Ok(back(&uri, &p))
}

#[derive(Debug, Serialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub token_type: &'static str,
    pub expires_in: i64,
    pub refresh_token: String,
    pub scope: &'static str,
}

fn response(access: String, refresh: String) -> TokenResponse {
    TokenResponse {
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_SECONDS,
        refresh_token: refresh,
        scope: "mcp",
    }
}

/// The code of the client for tokens, once (`grant_type=authorization_code`): the PKCE verifier must match the challenge.
pub async fn exchange(
    k: &Kernel,
    tenant: &str,
    client_id: &str,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse> {
    let bad = || oauth("invalid_grant", "the code is wrong, used or expired");
    let tenant = tenant_id(k, tenant).await.map_err(|_| bad())?;
    let row = mosaikit_db::query(
        "select g.id, g.user_id, g.allow_write, g.code_challenge, g.redirect_uri, cl.name
         from core.oauth_grants g join core.oauth_clients cl on cl.client_id = g.client_id
         where g.code_hash = $1 and g.client_id = $2 and g.tenant_id = $3 and g.status = 'approved' and g.expires_at > now()",
    )
    .bind(sha256(code.as_bytes()))
    .bind(client_id)
    .bind(tenant)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(bad)?;
    let (id, user, write, challenge, uri, name): (Uuid, Option<Uuid>, bool, String, String, String) =
        (row.get(0), row.get(1), row.get(2), row.get(3), row.get(4), row.get(5));
    // the code works once, whatever happens next
    let used = mosaikit_db::query(
        "update core.oauth_grants set status = 'used' where id = $1 and status = 'approved'",
    )
    .bind(id)
    .execute(&k.db)
    .await?
    .rows_affected();
    let computed = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(sha256(verifier.as_bytes()));
    if used != 1 || uri != redirect_uri || computed != challenge {
        return Err(bad());
    }
    let user = user.ok_or_else(bad)?;
    let (access, refresh) = (format!("{PREFIX}{}", random_token(24)), format!("mskr_{}", random_token(24)));
    mosaikit_db::query(
        "insert into core.api_tokens (id, token_hash, user_id, tenant_id, name, allow_write, expires_at, client_id, refresh_hash, refresh_expires_at)
         values ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => 60), $7, $8, now() + make_interval(days => 30))",
    )
    .bind(Uuid::new_v4())
    .bind(sha256(access.as_bytes()))
    .bind(user)
    .bind(tenant)
    .bind(format!("{name} (OAuth)"))
    .bind(write)
    .bind(client_id)
    .bind(sha256(refresh.as_bytes()))
    .execute(&k.db)
    .await?;
    Ok(response(access, refresh))
}

/// A new access token for a refresh token, which is replaced (`grant_type=refresh_token`): the old one never works again.
pub async fn refresh(
    k: &Kernel,
    tenant: &str,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse> {
    let bad = || oauth("invalid_grant", "the refresh token is wrong, used or expired");
    let tenant = tenant_id(k, tenant).await.map_err(|_| bad())?;
    let (access, refresh) = (format!("{PREFIX}{}", random_token(24)), format!("mskr_{}", random_token(24)));
    let n = mosaikit_db::query(
        "update core.api_tokens set token_hash = $1, refresh_hash = $2, expires_at = now() + make_interval(mins => 60),
                refresh_expires_at = now() + make_interval(days => 30)
         where refresh_hash = $3 and client_id = $4 and tenant_id = $5 and revoked_at is null and refresh_expires_at > now()",
    )
    .bind(sha256(access.as_bytes()))
    .bind(sha256(refresh.as_bytes()))
    .bind(sha256(refresh_token.as_bytes()))
    .bind(client_id)
    .bind(tenant)
    .execute(&k.db)
    .await?
    .rows_affected();
    if n != 1 {
        return Err(bad());
    }
    Ok(response(access, refresh))
}
