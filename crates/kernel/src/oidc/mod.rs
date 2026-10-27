//! Sign-in through the identity provider of a tenant (OpenID Connect, docs/architecture.md, OIDC).
//!
//! A tenant signs in either with local accounts or with its provider, never both; the Administrator
//! decides (the Tenant Manager sees it read-only). The flow is the authorization code flow with PKCE
//! (S256), `state` bound to the browser by an encrypted cookie and `nonce` in the ID token. The ID token
//! is checked here (`iss`, `aud`/`azp`, `exp`, `iat`, `nonce`, signature RS256 or ES256 with the keys
//! of `jwks_uri`, fetched again when an unknown key appears: rotation). A person is identified by the
//! tenant, the issuer and `sub`, never by the email; the account is created at the first sign-in.
//! Roles come from one source per tenant: Mosaikit (the Tenant Manager gives them) or the groups of
//! the token, read at every sign-in. The provider can close the sessions of a person with the
//! back-channel logout; Mosaikit sends the person to its end-session endpoint at sign-out.
//!
//! Implementation: a small client on top of `ring` and `reqwest`, already in the tree, rather than a
//! general OIDC library: Mosaikit needs one flow and two signature algorithms, and every check is in
//! this file, next to its test.

pub mod fake;
pub mod jwt;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::identity::{self, LoginResult};
use crate::tenancy::require_admin;
use crate::util::{random_token, sha256};
use crate::{events, Error, Kernel, Kind, Result, SessionUser};

/// The event of a back-channel logout token (OpenID Connect Back-Channel Logout 1.0).
pub const BACKCHANNEL_EVENT: &str = "http://schemas.openid.net/event/backchannel-logout";

/// How long the discovery document and the keys are kept before being fetched again.
const PROVIDER_TTL: Duration = Duration::from_secs(3600);
/// An unknown key fetches the keys again (rotation), then not again for this long (no hammering).
const JWKS_REFRESH: Duration = Duration::from_secs(30);
/// Lifetime of the cookie of a sign-in in progress.
const FLOW_SECONDS: i64 = 600;
/// Tolerance on the clocks of the provider.
const LEEWAY: i64 = 60;
/// A logout token older than this is refused (and its `jti` remembered for as long).
const LOGOUT_TOKEN_AGE: i64 = 600;

/// The discovery document of a provider (`/.well-known/openid-configuration`), the parts used.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Discovery {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
    #[serde(default)]
    pub end_session_endpoint: Option<String>,
    #[serde(default)]
    pub backchannel_logout_supported: Option<bool>,
    #[serde(default)]
    pub frontchannel_logout_supported: Option<bool>,
    #[serde(default)]
    pub code_challenge_methods_supported: Option<Vec<String>>,
    #[serde(default)]
    pub token_endpoint_auth_methods_supported: Option<Vec<String>>,
    #[serde(default)]
    pub id_token_signing_alg_values_supported: Option<Vec<String>>,
}

struct Provider {
    doc: Discovery,
    jwks: jwt::Jwks,
    fetched: Instant,
    /// last time the keys were fetched again because of an unknown key
    jwks_retry: Option<Instant>,
}

/// Discovery documents and keys of the providers, and the `jti` of the logout tokens already used.
#[derive(Default)]
pub struct Cache {
    providers: Mutex<HashMap<String, Provider>>,
    jtis: Mutex<HashMap<String, Instant>>,
}

fn provider_error(msg: impl Into<String>) -> Error {
    Error::bad(msg).with_code("oidc_provider")
}

fn token_error(msg: impl Into<String>) -> Error {
    Error::unauthorized(msg).with_code("oidc_token")
}

/// Addresses of a provider: HTTPS, or plain HTTP on this computer only (development and tests).
pub fn check_url(what: &str, u: &str) -> Result<url::Url> {
    let parsed = url::Url::parse(u.trim()).map_err(|_| Error::bad(format!("{what}: not a valid address")))?;
    let loopback = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    match parsed.scheme() {
        "https" => Ok(parsed),
        "http" if loopback => Ok(parsed),
        _ => Err(Error::bad(format!("{what}: an https address is required"))),
    }
}

fn discovery_url(issuer: &str) -> String {
    format!("{}/.well-known/openid-configuration", issuer.trim_end_matches('/'))
}

async fn get_json<T: serde::de::DeserializeOwned>(k: &Kernel, what: &str, u: &str) -> Result<T> {
    check_url(what, u)?;
    // the messages never carry the text of the HTTP library (English, technical, sometimes in the
    // language of the operating system): a code the shell translates and the address
    let res = k.http.get(u).send().await.map_err(|e| {
        let (code, what_happened) = if e.is_timeout() {
            ("oidc_timeout", "no answer in time")
        } else {
            ("oidc_unreachable", "cannot be reached")
        };
        Error::bad(format!("{what}: {u} {what_happened}")).with_code(code)
    })?;
    if !res.status().is_success() {
        return Err(
            Error::bad(format!("{what}: {u} answered HTTP {}", res.status().as_u16())).with_code("oidc_http")
        );
    }
    res.json::<T>().await.map_err(|_| {
        Error::bad(format!("{what}: {u} did not answer with a valid document")).with_code("oidc_document")
    })
}

async fn fetch_discovery(k: &Kernel, issuer: &str) -> Result<Discovery> {
    let doc: Discovery = get_json(k, "discovery document", &discovery_url(issuer)).await?;
    if doc.issuer != issuer {
        return Err(provider_error(format!(
            "the provider calls itself {} instead of {issuer}: the issuer must be the same",
            doc.issuer
        )));
    }
    for (what, u) in [
        ("authorization endpoint", &doc.authorization_endpoint),
        ("token endpoint", &doc.token_endpoint),
        ("keys (jwks_uri)", &doc.jwks_uri),
    ] {
        check_url(what, u)?;
    }
    Ok(doc)
}

/// Discovery document and keys of `issuer`, from the cache while fresh.
async fn provider(k: &Kernel, issuer: &str) -> Result<(Discovery, jwt::Jwks)> {
    if let Some(p) = k.oidc.providers.lock().expect("oidc cache").get(issuer) {
        if p.fetched.elapsed() < PROVIDER_TTL {
            return Ok((p.doc.clone(), p.jwks.clone()));
        }
    }
    let doc = fetch_discovery(k, issuer).await?;
    let jwks: jwt::Jwks = get_json(k, "keys (jwks_uri)", &doc.jwks_uri).await?;
    let now = Instant::now();
    k.oidc.providers.lock().expect("oidc cache").insert(
        issuer.to_string(),
        Provider { doc: doc.clone(), jwks: jwks.clone(), fetched: now, jwks_retry: None },
    );
    Ok((doc, jwks))
}

/// Verifies the signature of a token of `issuer`; an unknown key fetches the keys again once.
async fn verify_signature(k: &Kernel, issuer: &str, d: &jwt::Decoded) -> Result<()> {
    let (doc, jwks) = provider(k, issuer).await?;
    if jwt::verify(d, &jwks)? == jwt::Check::Valid {
        return Ok(());
    }
    let recent = k
        .oidc
        .providers
        .lock()
        .expect("oidc cache")
        .get(issuer)
        .and_then(|p| p.jwks_retry)
        .is_some_and(|at| at.elapsed() < JWKS_REFRESH);
    if recent {
        return Err(token_error("the token is signed with a key the provider does not publish"));
    }
    let fresh: jwt::Jwks = get_json(k, "keys (jwks_uri)", &doc.jwks_uri).await?;
    if let Some(p) = k.oidc.providers.lock().expect("oidc cache").get_mut(issuer) {
        p.jwks = fresh.clone();
        p.jwks_retry = Some(Instant::now());
    }
    match jwt::verify(d, &fresh)? {
        jwt::Check::Valid => Ok(()),
        jwt::Check::UnknownKey => {
            Err(token_error("the token is signed with a key the provider does not publish"))
        }
    }
}

// --------------------------------------------------------------------------------- configuration

/// The configuration of a tenant, as the Administrator sees it (never the client secret).
#[derive(Debug, Clone, Serialize)]
pub struct OidcView {
    pub enabled: bool,
    pub issuer: String,
    pub client_id: String,
    pub has_secret: bool,
    pub secret_hint: String,
    pub scopes: String,
    pub button_text: String,
    /// "mosaikit" or "idp"
    pub roles_source: String,
    pub manager_groups: Vec<String>,
    pub user_groups: Vec<String>,
    pub claim_username: String,
    pub claim_name: String,
    pub claim_email: String,
    pub claim_groups: String,
    /// mirror the groups of the token as read-only groups of the tenant
    pub sync_groups: bool,
    /// only the groups whose name starts with this (empty: all of them)
    pub group_prefix: String,
    /// addresses to register in the provider
    pub redirect_uri: String,
    pub backchannel_logout_uri: String,
    pub frontchannel_logout_uri: String,
    pub post_logout_redirect_uri: String,
    /// people of the tenant: local accounts (they cannot sign in while OIDC is on), accounts of the
    /// provider, guests from other tenants
    pub local_accounts: i64,
    pub provider_accounts: i64,
    pub guests: i64,
}

/// What the Administrator saves. `client_secret`: absent keeps the stored one, empty removes it.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct OidcInput {
    pub enabled: bool,
    pub issuer: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub scopes: Option<String>,
    #[serde(default)]
    pub button_text: Option<String>,
    #[serde(default)]
    pub roles_source: Option<String>,
    #[serde(default)]
    pub manager_groups: Vec<String>,
    #[serde(default)]
    pub user_groups: Vec<String>,
    #[serde(default)]
    pub claim_username: Option<String>,
    #[serde(default)]
    pub claim_name: Option<String>,
    #[serde(default)]
    pub claim_email: Option<String>,
    #[serde(default)]
    pub claim_groups: Option<String>,
    #[serde(default)]
    pub sync_groups: bool,
    #[serde(default)]
    pub group_prefix: Option<String>,
}

/// The stored configuration, with the encrypted secret.
#[derive(Debug, Clone)]
struct Settings {
    enabled: bool,
    issuer: String,
    client_id: String,
    secret: Option<Vec<u8>>,
    secret_hint: String,
    scopes: String,
    button_text: String,
    roles_source: String,
    manager_groups: Vec<String>,
    user_groups: Vec<String>,
    claim_username: String,
    claim_name: String,
    claim_email: String,
    claim_groups: String,
    sync_groups: bool,
    group_prefix: String,
}

fn strings(v: Option<Value>) -> Vec<String> {
    v.and_then(|v| v.as_array().cloned())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

async fn settings(k: &Kernel, tenant: Uuid) -> Result<Option<Settings>> {
    let row = mosaikit_db::query(
        "select enabled, issuer, client_id, client_secret, secret_hint, scopes, button_text, roles_source,
                manager_groups, user_groups, claim_username, claim_name, claim_email, claim_groups,
                sync_groups, group_prefix
         from core.tenant_oidc where tenant_id = $1",
    )
    .bind(tenant)
    .fetch_optional(&k.db)
    .await?;
    Ok(row.map(|r| Settings {
        enabled: r.get(0),
        issuer: r.get(1),
        client_id: r.get(2),
        secret: r.get(3),
        secret_hint: r.get(4),
        scopes: r.get(5),
        button_text: r.get(6),
        roles_source: r.get(7),
        manager_groups: strings(r.get(8)),
        user_groups: strings(r.get(9)),
        claim_username: r.get(10),
        claim_name: r.get(11),
        claim_email: r.get(12),
        claim_groups: r.get(13),
        sync_groups: r.get(14),
        group_prefix: r.get(15),
    }))
}

fn secret_aad(tenant: Uuid) -> String {
    format!("oidc-client-secret:{tenant}")
}

fn redirect_uri(k: &Kernel, slug: &str) -> String {
    format!("{}/api/auth/oidc/{slug}/callback", k.cfg.app_url)
}

/// Whether the tenant signs in through its identity provider.
pub async fn tenant_uses_oidc(k: &Kernel, tenant: Uuid) -> Result<bool> {
    let on: Option<bool> =
        mosaikit_db::query_scalar("select enabled from core.tenant_oidc where tenant_id = $1")
            .bind(tenant)
            .fetch_optional(&k.db)
            .await?;
    Ok(on == Some(true))
}

/// The error of a local password feature in a tenant that signs in through its provider.
pub fn local_refused() -> Error {
    Error::bad("this tenant signs in with its identity provider: there are no local passwords")
        .with_code("oidc_tenant")
}

/// Refuses local passwords for the people whose home tenant signs in through its provider.
pub async fn refuse_local_password(k: &Kernel, home_tenant: Uuid) -> Result<()> {
    if tenant_uses_oidc(k, home_tenant).await? {
        return Err(local_refused());
    }
    Ok(())
}

/// Whether the person signs in through an identity provider.
pub async fn is_external(k: &Kernel, user: Uuid) -> Result<bool> {
    let n: i64 = mosaikit_db::query_scalar("select count(*) from core.user_identities where user_id = $1")
        .bind(user)
        .fetch_one(&k.db)
        .await?;
    Ok(n > 0)
}

async fn tenant_slug(k: &Kernel, tenant: Uuid) -> Result<String> {
    let slug: Option<String> =
        mosaikit_db::query_scalar("select slug from core.tenants where id = $1 and not is_system")
            .bind(tenant)
            .fetch_optional(&k.db)
            .await?;
    slug.ok_or_else(|| Error::not_found("tenant not found"))
}

/// The sign-in configuration of a tenant (Administrator).
pub async fn config(k: &Kernel, admin: &SessionUser, tenant: Uuid) -> Result<OidcView> {
    require_admin(admin)?;
    let slug = tenant_slug(k, tenant).await?;
    let s = settings(k, tenant).await?;
    let count = |sql: &'static str| async move {
        mosaikit_db::query_scalar::<i64>(sql).bind(tenant).fetch_one(&k.db).await.map_err(Error::from)
    };
    let local_accounts = count(
        "select count(*) from core.users u where u.home_tenant_id = $1
           and not exists (select 1 from core.user_identities i where i.user_id = u.id)",
    )
    .await?;
    let provider_accounts = count("select count(*) from core.user_identities where tenant_id = $1").await?;
    let guests = count(
        "select count(*) from core.memberships m join core.users u on u.id = m.user_id
          where m.tenant_id = $1 and u.home_tenant_id <> $1",
    )
    .await?;
    let d = Settings {
        enabled: false,
        issuer: String::new(),
        client_id: String::new(),
        secret: None,
        secret_hint: String::new(),
        scopes: "openid profile email".into(),
        button_text: String::new(),
        roles_source: "mosaikit".into(),
        manager_groups: vec![],
        user_groups: vec![],
        claim_username: "preferred_username".into(),
        claim_name: "name".into(),
        claim_email: "email".into(),
        claim_groups: "groups".into(),
        sync_groups: false,
        group_prefix: String::new(),
    };
    let s = s.unwrap_or(d);
    Ok(OidcView {
        enabled: s.enabled,
        issuer: s.issuer,
        client_id: s.client_id,
        has_secret: s.secret.is_some(),
        secret_hint: s.secret_hint,
        scopes: s.scopes,
        button_text: s.button_text,
        roles_source: s.roles_source,
        manager_groups: s.manager_groups,
        user_groups: s.user_groups,
        claim_username: s.claim_username,
        claim_name: s.claim_name,
        claim_email: s.claim_email,
        claim_groups: s.claim_groups,
        sync_groups: s.sync_groups,
        group_prefix: s.group_prefix,
        redirect_uri: redirect_uri(k, &slug),
        backchannel_logout_uri: format!("{}/api/auth/oidc/{slug}/backchannel-logout", k.cfg.app_url),
        frontchannel_logout_uri: format!("{}/api/auth/oidc/{slug}/frontchannel-logout", k.cfg.app_url),
        post_logout_redirect_uri: format!("{}/", k.cfg.app_url),
        local_accounts,
        provider_accounts,
        guests,
    })
}

fn claim_name(v: Option<String>, default: &str) -> Result<String> {
    let v = v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| default.to_string());
    if v.len() > 100 || !v.chars().all(|c| c.is_ascii_alphanumeric() || "_-.:/".contains(c)) {
        return Err(Error::bad(format!("invalid claim name: {v}")));
    }
    Ok(v)
}

fn group_list(v: &[String]) -> Result<Value> {
    let list: Vec<String> = v.iter().map(|g| g.trim().to_string()).filter(|g| !g.is_empty()).collect();
    if list.len() > 50 || list.iter().any(|g| g.len() > 200) {
        return Err(Error::bad("too many or too long group names"));
    }
    Ok(json!(list))
}

/// Saves the sign-in configuration of a tenant (Administrator). With `enabled` the tenant signs in
/// only through its provider.
pub async fn set_config(k: &Kernel, admin: &SessionUser, tenant: Uuid, i: &OidcInput) -> Result<OidcView> {
    require_admin(admin)?;
    tenant_slug(k, tenant).await?;
    let old = settings(k, tenant).await?;
    let issuer = i.issuer.trim().to_string();
    let client_id = i.client_id.trim().to_string();
    if i.enabled || !issuer.is_empty() {
        check_url("issuer", &issuer)?;
    }
    if i.enabled && client_id.is_empty() {
        return Err(Error::bad("the client id is required"));
    }
    if client_id.len() > 255 || issuer.len() > 500 {
        return Err(Error::bad("issuer or client id too long"));
    }
    let roles_source = i.roles_source.clone().unwrap_or_else(|| "mosaikit".into());
    if !["mosaikit", "idp"].contains(&roles_source.as_str()) {
        return Err(Error::bad("roles come from \"mosaikit\" or \"idp\""));
    }
    let scopes = i.scopes.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let scopes = scopes.unwrap_or_else(|| "openid profile email".into());
    if !scopes.split_whitespace().any(|s| s == "openid") || scopes.len() > 300 {
        return Err(Error::bad("the scopes must include openid"));
    }
    let (secret, hint) = match &i.client_secret {
        None => (
            old.as_ref().and_then(|o| o.secret.clone()),
            old.as_ref().map(|o| o.secret_hint.clone()).unwrap_or_default(),
        ),
        Some(s) if s.trim().is_empty() => (None, String::new()),
        Some(s) => {
            let s = s.trim();
            if s.len() > 1000 {
                return Err(Error::bad("client secret too long"));
            }
            let hint: String = s.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
            (Some(k.secrets.seal(secret_aad(tenant).as_bytes(), s.as_bytes())), hint)
        }
    };
    let button = i.button_text.clone().unwrap_or_default().trim().chars().take(80).collect::<String>();
    let prefix = i.group_prefix.clone().unwrap_or_default().trim().to_string();
    if prefix.chars().count() > 100 {
        return Err(Error::bad("group prefix too long"));
    }
    mosaikit_db::query(
        "insert into core.tenant_oidc (tenant_id, enabled, issuer, client_id, client_secret, secret_hint, scopes,
             button_text, roles_source, manager_groups, user_groups, claim_username, claim_name, claim_email,
             claim_groups, updated_by, sync_groups, group_prefix, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
         on conflict (tenant_id) do update set enabled = excluded.enabled, issuer = excluded.issuer,
             client_id = excluded.client_id, client_secret = excluded.client_secret,
             secret_hint = excluded.secret_hint, scopes = excluded.scopes, button_text = excluded.button_text,
             roles_source = excluded.roles_source, manager_groups = excluded.manager_groups,
             user_groups = excluded.user_groups, claim_username = excluded.claim_username,
             claim_name = excluded.claim_name, claim_email = excluded.claim_email,
             claim_groups = excluded.claim_groups, sync_groups = excluded.sync_groups,
             group_prefix = excluded.group_prefix, updated_by = excluded.updated_by, updated_at = now()",
    )
    .bind(tenant)
    .bind(i.enabled)
    .bind(&issuer)
    .bind(&client_id)
    .bind(secret)
    .bind(hint)
    .bind(scopes)
    .bind(button)
    .bind(&roles_source)
    .bind(group_list(&i.manager_groups)?)
    .bind(group_list(&i.user_groups)?)
    .bind(claim_name(i.claim_username.clone(), "preferred_username")?)
    .bind(claim_name(i.claim_name.clone(), "name")?)
    .bind(claim_name(i.claim_email.clone(), "email")?)
    .bind(claim_name(i.claim_groups.clone(), "groups")?)
    .bind(admin.user_id)
    .bind(i.sync_groups)
    .bind(&prefix)
    .execute(&k.db)
    .await?;
    // the cache of the provider is fetched again with the new configuration
    k.oidc.providers.lock().expect("oidc cache").remove(&issuer);
    events::record(
        k,
        Some(tenant),
        Some(admin.user_id),
        None,
        None,
        "tenant.sign_in",
        json!({ "method": if i.enabled { "oidc" } else { "local" }, "issuer": issuer, "roles": roles_source,
                "sync_groups": i.sync_groups }),
    )
    .await;
    config(k, admin, tenant).await
}

/// One step of the check of a configuration.
#[derive(Debug, Clone, Serialize)]
pub struct CheckStep {
    pub step: &'static str,
    /// "ok", "warning" or "error"
    pub level: &'static str,
    pub detail: String,
    /// for an error: its stable code (the shell shows its translation, with the detail in English apart)
    pub code: Option<&'static str>,
}

fn step(step: &'static str, level: &'static str, detail: impl Into<String>) -> CheckStep {
    CheckStep { step, level, detail: detail.into(), code: None }
}

fn failed(step: &'static str, e: Error) -> CheckStep {
    CheckStep { step, level: "error", code: e.code, detail: e.message }
}

/// "Check the configuration": reads the discovery document and the keys of `issuer` as a sign-in
/// would, and says what is missing (Administrator).
pub async fn check(k: &Kernel, admin: &SessionUser, issuer: &str) -> Result<Vec<CheckStep>> {
    require_admin(admin)?;
    let issuer = issuer.trim();
    let mut out = vec![];
    if let Err(e) = check_url("issuer", issuer) {
        out.push(failed("issuer", e));
        return Ok(out);
    }
    let doc = match fetch_discovery(k, issuer).await {
        Ok(d) => {
            out.push(step("discovery", "ok", discovery_url(issuer)));
            d
        }
        Err(e) => {
            out.push(failed("discovery", e));
            return Ok(out);
        }
    };
    let pkce = doc.code_challenge_methods_supported.as_ref().is_none_or(|m| m.iter().any(|x| x == "S256"));
    out.push(if pkce {
        step("pkce", "ok", "S256")
    } else {
        step("pkce", "error", "the provider does not support PKCE with S256")
    });
    match get_json::<jwt::Jwks>(k, "keys (jwks_uri)", &doc.jwks_uri).await {
        Ok(j) => {
            let usable = j
                .keys
                .iter()
                .filter(|x| x.kty == "RSA" || (x.kty == "EC" && x.crv.as_deref() == Some("P-256")))
                .count();
            out.push(if usable > 0 {
                step("keys", "ok", format!("{usable} keys RS256/ES256"))
            } else {
                step("keys", "error", "no RS256 or ES256 key")
            });
        }
        Err(e) => out.push(failed("keys", e)),
    }
    out.push(match &doc.end_session_endpoint {
        Some(u) => step("end_session", "ok", u.clone()),
        None => step(
            "end_session",
            "warning",
            "no end-session endpoint: signing out of Mosaikit does not sign out of the provider",
        ),
    });
    out.push(if doc.backchannel_logout_supported == Some(true) {
        step("backchannel_logout", "ok", "supported")
    } else {
        step(
            "backchannel_logout",
            "warning",
            "back-channel logout not announced: sessions end only when they expire or the person signs out",
        )
    });
    out.push(if doc.frontchannel_logout_supported == Some(true) {
        step("frontchannel_logout", "ok", "supported")
    } else {
        step("frontchannel_logout", "warning", "front-channel logout not announced")
    });
    Ok(out)
}

/// The sign-in method of the tenants on the sign-in page: `(tenant id, button text)` of the OIDC ones.
pub async fn login_methods(k: &Kernel) -> Result<HashMap<Uuid, String>> {
    let rows = mosaikit_db::query("select tenant_id, button_text from core.tenant_oidc where enabled")
        .fetch_all(&k.db)
        .await?;
    Ok(rows.iter().map(|r| (r.get::<Uuid, _>(0), r.get::<String, _>(1))).collect())
}

// -------------------------------------------------------------------------------------- sign-in

/// The start of a sign-in: where to send the browser and the cookie that binds the flow to it.
#[derive(Debug)]
pub struct Begin {
    pub url: String,
    pub cookie: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Flow {
    slug: String,
    state: String,
    nonce: String,
    verifier: String,
    remember: bool,
    exp: i64,
}

const FLOW_AAD: &[u8] = b"oidc-flow";

async fn enabled_tenant(k: &Kernel, slug: &str) -> Result<(Uuid, Settings)> {
    let id: Option<Uuid> = mosaikit_db::query_scalar(
        "select id from core.tenants where slug = $1 and status = 'active' and not is_system",
    )
    .bind(slug)
    .fetch_optional(&k.db)
    .await?;
    let id = id.ok_or_else(|| Error::not_found("tenant not found"))?;
    match settings(k, id).await? {
        Some(s) if s.enabled => Ok((id, s)),
        _ => Err(Error::bad("this tenant signs in with username and password").with_code("oidc_off")),
    }
}

/// Starts the sign-in of the tenant `slug` through its provider.
pub async fn begin(k: &Kernel, slug: &str, remember: bool) -> Result<Begin> {
    let slug = slug.trim().to_lowercase();
    let (_, s) = enabled_tenant(k, &slug).await?;
    let (doc, _) = provider(k, &s.issuer).await?;
    let flow = Flow {
        slug: slug.clone(),
        state: random_token(32),
        nonce: random_token(32),
        verifier: URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>()),
        remember,
        exp: chrono::Utc::now().timestamp() + FLOW_SECONDS,
    };
    let challenge = URL_SAFE_NO_PAD.encode(sha256(flow.verifier.as_bytes()));
    let mut u = check_url("authorization endpoint", &doc.authorization_endpoint)?;
    u.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &s.client_id)
        .append_pair("redirect_uri", &redirect_uri(k, &slug))
        .append_pair("scope", &s.scopes)
        .append_pair("state", &flow.state)
        .append_pair("nonce", &flow.nonce)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    let sealed = k.secrets.seal(FLOW_AAD, &serde_json::to_vec(&flow)?);
    Ok(Begin { url: u.to_string(), cookie: URL_SAFE_NO_PAD.encode(sealed) })
}

/// The parameters of the return from the provider.
#[derive(Debug, Default, Deserialize)]
pub struct Callback {
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_description: Option<String>,
    /// RFC 9207: the issuer of the response, when the provider sends it
    #[serde(default)]
    pub iss: Option<String>,
}

fn flow_error(msg: &str) -> Error {
    Error::unauthorized(msg.to_string()).with_code("oidc_state")
}

/// The claims of a checked ID token that Mosaikit uses.
#[derive(Debug, Clone)]
pub struct Identity {
    pub subject: String,
    pub sid: Option<String>,
    pub claims: Value,
}

/// Checks the claims of an ID token (the signature is checked by the caller).
pub fn check_id_claims(
    claims: &Value,
    issuer: &str,
    client_id: &str,
    nonce: &str,
    now: i64,
) -> Result<Identity> {
    let s = |k: &str| claims.get(k).and_then(Value::as_str);
    if s("iss") != Some(issuer) {
        return Err(token_error("the token comes from another issuer"));
    }
    let aud_ok = match claims.get("aud") {
        Some(Value::String(a)) => a == client_id,
        Some(Value::Array(a)) => {
            a.iter().any(|x| x.as_str() == Some(client_id)) && (a.len() == 1 || s("azp") == Some(client_id))
        }
        _ => false,
    };
    if !aud_ok {
        return Err(token_error("the token is for another client"));
    }
    if let Some(azp) = s("azp") {
        if azp != client_id {
            return Err(token_error("the token is for another client"));
        }
    }
    let exp =
        claims.get("exp").and_then(Value::as_i64).ok_or_else(|| token_error("the token has no expiry"))?;
    if exp + LEEWAY < now {
        return Err(token_error("the token has expired"));
    }
    if claims.get("iat").and_then(Value::as_i64).is_some_and(|iat| iat > now + LEEWAY * 5) {
        return Err(token_error("the token is issued in the future"));
    }
    if s("nonce") != Some(nonce) {
        return Err(token_error("the token does not belong to this sign-in (nonce)"));
    }
    let subject = s("sub")
        .filter(|x| !x.is_empty() && x.len() <= 255)
        .ok_or_else(|| token_error("the token has no subject"))?;
    Ok(Identity { subject: subject.to_string(), sid: s("sid").map(str::to_owned), claims: claims.clone() })
}

/// Completes the sign-in on the return from the provider: checks the flow and the ID token, finds or
/// creates the person, opens the session.
pub async fn finish(
    k: &Kernel,
    slug: &str,
    cookie: Option<&str>,
    cb: &Callback,
    ip: &str,
) -> Result<LoginResult> {
    let slug = slug.trim().to_lowercase();
    if let Some(e) = &cb.error {
        let desc: String = cb.error_description.clone().unwrap_or_default().chars().take(200).collect();
        return Err(Error::forbidden(
            format!("the identity provider refused the sign-in: {e} {desc}").trim().to_string(),
        )
        .with_code("oidc_denied"));
    }
    let sealed = cookie.and_then(|c| URL_SAFE_NO_PAD.decode(c).ok()).ok_or_else(|| {
        flow_error("the sign-in has expired or was started in another browser: start again")
    })?;
    let flow: Flow =
        k.secrets.open(FLOW_AAD, &sealed).ok().and_then(|p| serde_json::from_slice(&p).ok()).ok_or_else(
            || flow_error("the sign-in has expired or was started in another browser: start again"),
        )?;
    let now = chrono::Utc::now().timestamp();
    if flow.exp < now || flow.slug != slug {
        return Err(flow_error("the sign-in has expired or was started in another browser: start again"));
    }
    let state = cb.state.as_deref().unwrap_or_default();
    if state.is_empty() || state != flow.state {
        return Err(flow_error("the sign-in does not match the one started in this browser (state)"));
    }
    let code =
        cb.code.as_deref().filter(|c| !c.is_empty()).ok_or_else(|| flow_error("no authorization code"))?;
    let (tenant, s) = enabled_tenant(k, &slug).await?;
    if let Some(iss) = &cb.iss {
        if iss != &s.issuer {
            return Err(token_error("the answer comes from another issuer"));
        }
    }
    let (doc, _) = provider(k, &s.issuer).await?;
    let secret = match &s.secret {
        Some(sealed) => Some(
            String::from_utf8(k.secrets.open(secret_aad(tenant).as_bytes(), sealed)?)
                .map_err(|_| Error::internal("client secret not readable"))?,
        ),
        None => None,
    };
    let id_token = exchange_code(
        k,
        &doc,
        &s.client_id,
        secret.as_deref(),
        code,
        &redirect_uri(k, &slug),
        &flow.verifier,
    )
    .await?;
    let d = jwt::decode(&id_token)?;
    verify_signature(k, &s.issuer, &d).await?;
    let id = check_id_claims(&d.claims, &s.issuer, &s.client_id, &flow.nonce, now)?;
    let user = person(k, tenant, &s, &id).await?;
    let lr =
        identity::external_session(k, user, ip, flow.remember, id.sid.as_deref(), Some(&id_token)).await?;
    events::record(k, Some(tenant), Some(user), None, None, "login.oidc", json!({ "ip": ip })).await;
    Ok(lr)
}

async fn exchange_code(
    k: &Kernel,
    doc: &Discovery,
    client_id: &str,
    secret: Option<&str>,
    code: &str,
    redirect: &str,
    verifier: &str,
) -> Result<String> {
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect),
        ("code_verifier", verifier),
    ];
    let methods = doc.token_endpoint_auth_methods_supported.clone().unwrap_or_default();
    let basic = methods.is_empty() || methods.iter().any(|m| m == "client_secret_basic");
    let mut req = k.http.post(&doc.token_endpoint);
    match secret {
        Some(sec) if basic => {
            let enc = |v: &str| url::form_urlencoded::byte_serialize(v.as_bytes()).collect::<String>();
            req = req.basic_auth(enc(client_id), Some(enc(sec)));
        }
        Some(sec) => {
            form.push(("client_id", client_id));
            form.push(("client_secret", sec));
        }
        None => form.push(("client_id", client_id)),
    }
    let body = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(form).finish();
    let res = req
        .header("content-type", "application/x-www-form-urlencoded")
        .header("accept", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| provider_error(format!("token endpoint: {e}")))?;
    let status = res.status();
    let v: Value = res.json().await.map_err(|e| provider_error(format!("token endpoint: {e}")))?;
    if !status.is_success() {
        let e = v.get("error").and_then(Value::as_str).unwrap_or("error");
        return Err(provider_error(format!("the provider refused the code: {e}")));
    }
    v.get("id_token")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| provider_error("the provider answered without an ID token"))
}

fn claim_str(claims: &Value, name: &str) -> Option<String> {
    claims.get(name).and_then(Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn claim_groups(claims: &Value, name: &str) -> Vec<String> {
    match claims.get(name) {
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect(),
        Some(Value::String(s)) => vec![s.clone()],
        _ => vec![],
    }
}

/// The role a person gets from the groups of the token, when the roles come from the provider.
pub fn role_from_groups(
    groups: &[String],
    manager_groups: &[String],
    user_groups: &[String],
) -> Option<&'static str> {
    if groups.iter().any(|g| manager_groups.contains(g)) {
        Some("tenant_manager")
    } else if user_groups.is_empty() || groups.iter().any(|g| user_groups.contains(g)) {
        Some("user")
    } else {
        None
    }
}

/// A username from the claim of the provider, in the format of Mosaikit.
fn username_from(claim: Option<&str>, subject: &str) -> String {
    let mut u: String = claim
        .unwrap_or_default()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || ".-_".contains(c) { c } else { '-' })
        .collect();
    u = u.trim_start_matches(['.', '-', '_']).chars().take(56).collect();
    if identity::valid_username(&u) {
        u
    } else {
        format!("user-{}", &hex::encode(sha256(subject.as_bytes()))[..10])
    }
}

/// The person of the token: the account linked to (tenant, issuer, sub), or a new one.
async fn person(k: &Kernel, tenant: Uuid, s: &Settings, id: &Identity) -> Result<Uuid> {
    let claims = &id.claims;
    let display = claim_str(claims, &s.claim_name);
    let email = claim_str(claims, &s.claim_email).filter(|e| e.len() <= 320);
    let role = if s.roles_source == "idp" {
        let groups = claim_groups(claims, &s.claim_groups);
        Some(role_from_groups(&groups, &s.manager_groups, &s.user_groups).ok_or_else(|| {
            Error::forbidden("your account of the identity provider is not in a group allowed in this tenant")
                .with_code("oidc_no_role")
        })?)
    } else {
        None
    };
    let found: Option<Uuid> = mosaikit_db::query_scalar(
        "select user_id from core.user_identities where tenant_id = $1 and issuer = $2 and subject = $3",
    )
    .bind(tenant)
    .bind(&s.issuer)
    .bind(&id.subject)
    .fetch_optional(&k.db)
    .await?;
    let user = match found {
        Some(user) => {
            let active: Option<String> =
                mosaikit_db::query_scalar("select status from core.users where id = $1")
                    .bind(user)
                    .fetch_optional(&k.db)
                    .await?;
            if active.as_deref() != Some("active") {
                return Err(
                    Error::forbidden("your account is suspended in this tenant").with_code("oidc_disabled")
                );
            }
            mosaikit_db::query(
                "update core.users set display_name = coalesce($2, display_name), email = coalesce($3, email) where id = $1",
            )
            .bind(user)
            .bind(display.clone())
            .bind(email.clone())
            .execute(&k.db)
            .await?;
            mosaikit_db::query(
                "update core.user_identities set last_login = now() where tenant_id = $1 and issuer = $2 and subject = $3",
            )
            .bind(tenant)
            .bind(&s.issuer)
            .bind(&id.subject)
            .execute(&k.db)
            .await?;
            if let Some(role) = role {
                mosaikit_db::query(
                    "update core.memberships set role = $3 where tenant_id = $1 and user_id = $2",
                )
                .bind(tenant)
                .bind(user)
                .bind(role)
                .execute(&k.db)
                .await?;
            }
            user
        }
        None => create_person(k, tenant, s, id, display, email, role.unwrap_or("user")).await?,
    };
    if s.sync_groups {
        let groups = synced_groups(&claim_groups(claims, &s.claim_groups), &s.group_prefix);
        sync_groups(k, tenant, user, &groups).await?;
    }
    Ok(user)
}

/// The groups of the token to mirror: those starting with the prefix (all without one), each once, at
/// most 100.
pub fn synced_groups(groups: &[String], prefix: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for g in groups {
        let g = g.trim();
        if g.is_empty() || g.chars().count() > 200 || !g.starts_with(prefix) || out.iter().any(|x| x == g) {
            continue;
        }
        out.push(g.to_string());
        if out.len() == 100 {
            break;
        }
    }
    out
}

/// Mirrors the groups of the provider for a person: the groups are created when new (read-only,
/// `source = 'idp'`), the person joins those of the token and leaves the other groups of the provider.
/// Groups are never deleted here: a group the provider no longer sends empties as its people sign in.
pub async fn sync_groups(k: &Kernel, tenant: Uuid, user: Uuid, groups: &[String]) -> Result<()> {
    let mut ids: Vec<Uuid> = Vec::with_capacity(groups.len());
    for external in groups {
        let found: Option<Uuid> = mosaikit_db::query_scalar(
            "select id from core.groups where tenant_id = $1 and external_name = $2",
        )
        .bind(tenant)
        .bind(external)
        .fetch_optional(&k.db)
        .await?;
        let id = match found {
            Some(id) => id,
            None => create_idp_group(k, tenant, external).await?,
        };
        ids.push(id);
    }
    let mut tx = k.db.begin_app().await?;
    let current: Vec<Uuid> = mosaikit_db::query_scalar(
        "select gm.group_id from core.group_members gm join core.groups g on g.id = gm.group_id
          where gm.user_id = $1 and g.tenant_id = $2 and g.source = 'idp'",
    )
    .bind(user)
    .bind(tenant)
    .fetch_all(&mut *tx)
    .await?;
    for g in current.iter().filter(|g| !ids.contains(g)) {
        mosaikit_db::query("delete from core.group_members where group_id = $1 and user_id = $2")
            .bind(g)
            .bind(user)
            .execute(&mut *tx)
            .await?;
    }
    for g in ids.iter().filter(|g| !current.contains(g)) {
        mosaikit_db::query(
            "insert into core.group_members (group_id, user_id) values ($1, $2) on conflict do nothing",
        )
        .bind(g)
        .bind(user)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// A new group of the provider. Its name in Mosaikit is the one of the provider or, when a group of
/// Mosaikit already has it, the same with "(identity provider)".
async fn create_idp_group(k: &Kernel, tenant: Uuid, external: &str) -> Result<Uuid> {
    let base: String = external.chars().take(80).collect();
    for n in 0..20 {
        let name = match n {
            0 => base.clone(),
            1 => format!("{} (identity provider)", base.chars().take(60).collect::<String>()),
            _ => format!("{} (identity provider {n})", base.chars().take(56).collect::<String>()),
        };
        let r = mosaikit_db::query_scalar::<Uuid>(
            "insert into core.groups (tenant_id, name, source, external_name) values ($1, $2, 'idp', $3)
             returning id",
        )
        .bind(tenant)
        .bind(&name)
        .bind(external)
        .fetch_one(&k.db)
        .await;
        match r {
            Ok(id) => {
                events::record(
                    k,
                    Some(tenant),
                    None,
                    None,
                    None,
                    "group.create.oidc",
                    json!({ "group": id, "name": name }),
                )
                .await;
                return Ok(id);
            }
            Err(e) => {
                let e = Error::from(e);
                if e.kind != Kind::Conflict {
                    return Err(e);
                }
                // created meanwhile by another sign-in with the same group
                let found: Option<Uuid> = mosaikit_db::query_scalar(
                    "select id from core.groups where tenant_id = $1 and external_name = $2",
                )
                .bind(tenant)
                .bind(external)
                .fetch_optional(&k.db)
                .await?;
                if let Some(id) = found {
                    return Ok(id);
                }
            }
        }
    }
    Err(Error::conflict("no free name for the group of the identity provider"))
}

async fn create_person(
    k: &Kernel,
    tenant: Uuid,
    s: &Settings,
    id: &Identity,
    display: Option<String>,
    email: Option<String>,
    role: &str,
) -> Result<Uuid> {
    // a new person of the tenant: refused at the limit of its people
    crate::quotas::check(k, tenant, crate::quotas::Add::people(1)).await?;
    let base = username_from(claim_str(&id.claims, &s.claim_username).as_deref(), &id.subject);
    for n in 1..=50 {
        let username = if n == 1 { base.clone() } else { format!("{base}-{n}") };
        let mut tx = k.db.begin_app().await?;
        let inserted = mosaikit_db::query_scalar::<Uuid>(
            "insert into core.users (home_tenant_id, username, display_name, email, password_hash)
             values ($1, $2, $3, $4, null) returning id",
        )
        .bind(tenant)
        .bind(&username)
        .bind(display.clone().unwrap_or_else(|| username.clone()))
        .bind(email.clone())
        .fetch_one(&mut *tx)
        .await;
        let user = match inserted {
            Ok(u) => u,
            Err(e) => {
                let e = Error::from(e);
                if e.kind == Kind::Conflict {
                    continue;
                }
                return Err(e);
            }
        };
        mosaikit_db::query("insert into core.memberships (tenant_id, user_id, role) values ($1, $2, $3)")
            .bind(tenant)
            .bind(user)
            .bind(role)
            .execute(&mut *tx)
            .await?;
        mosaikit_db::query(
            "insert into core.user_identities (issuer, subject, user_id, tenant_id) values ($1, $2, $3, $4)",
        )
        .bind(&s.issuer)
        .bind(&id.subject)
        .bind(user)
        .bind(tenant)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        events::record(
            k,
            Some(tenant),
            Some(user),
            None,
            None,
            "user.create.oidc",
            json!({ "username": username }),
        )
        .await;
        return Ok(user);
    }
    Err(Error::conflict("no free username for this person"))
}

// -------------------------------------------------------------------------------------- sign-out

/// Where to send the browser after the sign-out of a person of an OIDC tenant (end-session endpoint
/// of the provider), if it has one. Errors of the provider are not the person's problem: `None`.
pub async fn end_session_url(k: &Kernel, user: &SessionUser) -> Option<String> {
    let row = mosaikit_db::query(
        "select o.issuer, o.client_id from core.user_identities i
           join core.tenant_oidc o on o.tenant_id = i.tenant_id and o.issuer = i.issuer
          where i.user_id = $1 and o.enabled",
    )
    .bind(user.user_id)
    .fetch_optional(&k.db)
    .await
    .ok()??;
    let (issuer, client_id): (String, String) = (row.get(0), row.get(1));
    let (doc, _) = provider(k, &issuer).await.ok()?;
    let mut u = check_url("end-session endpoint", doc.end_session_endpoint.as_deref()?).ok()?;
    let hint = identity::session_id_token(k, user).await;
    {
        let mut q = u.query_pairs_mut();
        if let Some(h) = &hint {
            q.append_pair("id_token_hint", h);
        }
        q.append_pair("client_id", &client_id)
            .append_pair("post_logout_redirect_uri", &format!("{}/", k.cfg.app_url));
    }
    Some(u.to_string())
}

/// Back-channel logout: the provider closes the sessions of a person (`sub`) or of one of its
/// sessions (`sid`). Returns how many sessions were closed.
pub async fn backchannel_logout(k: &Kernel, slug: &str, logout_token: &str) -> Result<u64> {
    let (tenant, s) = enabled_tenant(k, &slug.trim().to_lowercase()).await?;
    let d = jwt::decode(logout_token)?;
    verify_signature(k, &s.issuer, &d).await?;
    let c = &d.claims;
    let st = |k: &str| c.get(k).and_then(Value::as_str);
    let now = chrono::Utc::now().timestamp();
    let aud_ok = match c.get("aud") {
        Some(Value::String(a)) => a == &s.client_id,
        Some(Value::Array(a)) => a.iter().any(|x| x.as_str() == Some(s.client_id.as_str())),
        _ => false,
    };
    if st("iss") != Some(s.issuer.as_str()) || !aud_ok {
        return Err(token_error("the logout token is for another issuer or client"));
    }
    let iat =
        c.get("iat").and_then(Value::as_i64).ok_or_else(|| token_error("the logout token has no iat"))?;
    if iat < now - LOGOUT_TOKEN_AGE || iat > now + LEEWAY {
        return Err(token_error("the logout token is too old or from the future"));
    }
    if c.get("events").and_then(|e| e.get(BACKCHANNEL_EVENT)).is_none() || c.get("nonce").is_some() {
        return Err(token_error("not a back-channel logout token"));
    }
    let jti =
        st("jti").filter(|j| !j.is_empty()).ok_or_else(|| token_error("the logout token has no jti"))?;
    {
        let mut seen = k.oidc.jtis.lock().expect("oidc cache");
        seen.retain(|_, at| at.elapsed() < Duration::from_secs(LOGOUT_TOKEN_AGE as u64 * 2));
        if seen.insert(format!("{}|{jti}", s.issuer), Instant::now()).is_some() {
            return Err(token_error("the logout token was already used"));
        }
    }
    let closed = match (st("sid"), st("sub")) {
        (Some(sid), _) => mosaikit_db::query(
            "delete from core.sessions where oidc_sid = $1
               and user_id in (select user_id from core.user_identities where tenant_id = $2 and issuer = $3)",
        )
        .bind(sid)
        .bind(tenant)
        .bind(&s.issuer)
        .execute(&k.db)
        .await?
        .rows_affected(),
        (None, Some(sub)) => mosaikit_db::query(
            "delete from core.sessions where user_id in
               (select user_id from core.user_identities where tenant_id = $1 and issuer = $2 and subject = $3)",
        )
        .bind(tenant)
        .bind(&s.issuer)
        .bind(sub)
        .execute(&k.db)
        .await?
        .rows_affected(),
        (None, None) => return Err(token_error("the logout token names neither a person nor a session")),
    };
    events::record(k, Some(tenant), None, None, None, "logout.backchannel", json!({ "sessions": closed }))
        .await;
    Ok(closed)
}

/// Front-channel logout (OpenID Connect Front-Channel Logout 1.0): the provider loads the page of the
/// tenant in an iframe with its issuer and the session (`sid`) that ended; the sessions of Mosaikit
/// opened with that `sid` close. The iframe may not carry the cookies of Mosaikit (a third-party frame),
/// so the sessions are found by `sid`, never by cookie. Returns how many closed.
pub async fn frontchannel_logout(k: &Kernel, slug: &str, iss: &str, sid: &str) -> Result<u64> {
    let (tenant, s) = enabled_tenant(k, &slug.trim().to_lowercase()).await?;
    if iss != s.issuer {
        return Err(token_error("the logout comes from another issuer"));
    }
    if sid.is_empty() || sid.len() > 255 {
        return Err(token_error("the logout names no session (sid)"));
    }
    let closed = mosaikit_db::query(
        "delete from core.sessions where oidc_sid = $1
           and user_id in (select user_id from core.user_identities where tenant_id = $2 and issuer = $3)",
    )
    .bind(sid)
    .bind(tenant)
    .bind(&s.issuer)
    .execute(&k.db)
    .await?
    .rows_affected();
    events::record(k, Some(tenant), None, None, None, "logout.frontchannel", json!({ "sessions": closed }))
        .await;
    Ok(closed)
}

/// The origin of the provider of a tenant (the `frame-ancestors` of the front-channel logout page).
pub async fn issuer_origin(k: &Kernel, slug: &str) -> Option<String> {
    let (_, s) = enabled_tenant(k, &slug.trim().to_lowercase()).await.ok()?;
    let u = url::Url::parse(&s.issuer).ok()?;
    Some(u.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use super::fake::{self, FakeKeys};
    use super::*;

    const ISS: &str = "https://idp.example";

    fn decoded(keys: &FakeKeys, alg: &str, claims: &Value) -> jwt::Decoded {
        jwt::decode(&keys.sign(alg, claims)).unwrap()
    }

    #[test]
    fn signatures_rs256_and_es256_and_rotation() {
        let k0 = FakeKeys::new(0);
        let k1 = FakeKeys::new(1);
        let claims = fake::id_claims(ISS, "mosaikit", &fake::USERS[0], "n", "s", 300);
        for alg in ["RS256", "ES256"] {
            let d = decoded(&k0, alg, &claims);
            assert_eq!(jwt::verify(&d, &k0.jwks()).unwrap(), jwt::Check::Valid, "{alg}");
            // after a rotation the old token is signed with a key the provider no longer publishes
            assert_eq!(jwt::verify(&d, &k1.jwks()).unwrap(), jwt::Check::UnknownKey, "{alg}");
        }
        // a token signed by someone else with the same kid is refused
        let mut forged = k1.jwks();
        for key in &mut forged.keys {
            key.kid = Some(if key.kty == "EC" { k0.ec_kid() } else { k0.rsa_kid() });
        }
        for alg in ["RS256", "ES256"] {
            let d = decoded(&k0, alg, &claims);
            assert_eq!(jwt::verify(&d, &forged).unwrap_err().code(), "oidc_token", "{alg}");
        }
    }

    #[test]
    fn unsigned_and_hmac_tokens_refused() {
        let k0 = FakeKeys::new(0);
        let none = jwt::encode(&json!({ "alg": "none" }), &json!({ "sub": "x" }), |_| vec![]);
        assert!(jwt::verify(&jwt::decode(&none).unwrap(), &k0.jwks()).is_err());
        let hs = jwt::encode(&json!({ "alg": "HS256" }), &json!({ "sub": "x" }), |_| vec![1, 2, 3]);
        assert!(jwt::verify(&jwt::decode(&hs).unwrap(), &k0.jwks()).is_err());
        assert!(jwt::decode("a.b").is_err());
        // a valid signature on modified claims
        let good = k0.sign("ES256", &json!({ "sub": "anna" }));
        let mut parts: Vec<&str> = good.split('.').collect();
        let other = URL_SAFE_NO_PAD.encode(json!({ "sub": "admin" }).to_string());
        parts[1] = &other;
        assert!(jwt::verify(&jwt::decode(&parts.join(".")).unwrap(), &k0.jwks()).is_err());
    }

    #[test]
    fn claims_of_the_id_token() {
        let now = chrono::Utc::now().timestamp();
        let u = &fake::USERS[1];
        let ok = fake::id_claims(ISS, "mosaikit", u, "n1", "sid1", 300);
        let id = check_id_claims(&ok, ISS, "mosaikit", "n1", now).unwrap();
        assert_eq!((id.subject.as_str(), id.sid.as_deref()), (u.sub, Some("sid1")));
        let code =
            |c: &Value, nonce: &str| check_id_claims(c, ISS, "mosaikit", nonce, now).unwrap_err().code();
        assert_eq!(code(&ok, "other"), "oidc_token", "wrong nonce");
        let mut c = ok.clone();
        c["iss"] = json!("https://evil.example");
        assert_eq!(code(&c, "n1"), "oidc_token", "wrong issuer");
        let mut c = ok.clone();
        c["aud"] = json!("someone-else");
        assert_eq!(code(&c, "n1"), "oidc_token", "wrong audience");
        let mut c = ok.clone();
        c["aud"] = json!(["mosaikit", "other"]);
        assert_eq!(code(&c, "n1"), "oidc_token", "several audiences without azp");
        c["azp"] = json!("mosaikit");
        assert!(check_id_claims(&c, ISS, "mosaikit", "n1", now).is_ok());
        let expired = fake::id_claims(ISS, "mosaikit", u, "n1", "s", -(LEEWAY + 5));
        assert_eq!(code(&expired, "n1"), "oidc_token", "expired");
        let mut c = ok.clone();
        c["sub"] = json!("");
        assert_eq!(code(&c, "n1"), "oidc_token", "no subject");
    }

    #[test]
    fn roles_from_groups() {
        let g = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let managers = g(&["mosaikit-managers"]);
        let users = g(&["mosaikit-users"]);
        assert_eq!(
            role_from_groups(&g(&["mosaikit-managers", "staff"]), &managers, &users),
            Some("tenant_manager")
        );
        assert_eq!(role_from_groups(&g(&["mosaikit-users"]), &managers, &users), Some("user"));
        assert_eq!(role_from_groups(&g(&["staff"]), &managers, &users), None);
        // no user groups: everybody the provider lets in is a User
        assert_eq!(role_from_groups(&g(&[]), &managers, &[]), Some("user"));
    }

    #[test]
    fn groups_to_mirror() {
        let g = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(synced_groups(&g(&["staff", " staff ", "", "sales"]), ""), g(&["staff", "sales"]));
        assert_eq!(
            synced_groups(&g(&["msk-staff", "other", "msk-sales"]), "msk-"),
            g(&["msk-staff", "msk-sales"])
        );
        let many: Vec<String> = (0..150).map(|i| format!("g{i}")).collect();
        assert_eq!(synced_groups(&many, "").len(), 100);
    }

    #[test]
    fn usernames_from_the_provider() {
        assert_eq!(username_from(Some("Anna.Rossi"), "s"), "anna.rossi");
        assert_eq!(username_from(Some("anna rossi@corp"), "s"), "anna-rossi-corp");
        assert!(username_from(None, "abc").starts_with("user-"));
        assert!(username_from(Some("_"), "abc").starts_with("user-"));
    }

    #[test]
    fn addresses_of_a_provider() {
        assert!(check_url("issuer", "https://login.example/realms/x").is_ok());
        assert!(check_url("issuer", "http://127.0.0.1:5556").is_ok());
        assert!(check_url("issuer", "http://localhost:5556").is_ok());
        assert!(check_url("issuer", "http://login.example").is_err());
        assert!(check_url("issuer", "ftp://login.example").is_err());
    }
}
