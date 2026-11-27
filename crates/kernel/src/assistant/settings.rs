//! Provider settings of the assistant: the platform row (system Administrator) and the row a Tenant Manager brings
//! when the Administrator allows it. The key is sealed and never leaves the kernel.

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{events, Caller, Error, Kernel, Result, SessionUser};

pub const PROVIDERS: [&str; 4] = ["anthropic", "openai", "openai_compatible", "fake"];
pub const DEFAULT_HOURLY_LIMIT: i32 = 60;

/// The nil uuid is the platform row.
pub fn platform_id() -> Uuid {
    Uuid::nil()
}

/// Settings as a person sees them (no key).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SettingsView {
    pub configured: bool,
    pub provider: String,
    pub base_url: Option<String>,
    pub model: String,
    pub has_key: bool,
    pub enabled: bool,
    pub allow_byok: bool,
    pub hourly_limit: i32,
    /// the models, besides the default, that people may choose
    pub user_models: Vec<String>,
}

impl SettingsView {
    fn empty() -> SettingsView {
        SettingsView {
            configured: false,
            provider: String::new(),
            base_url: None,
            model: String::new(),
            has_key: false,
            enabled: false,
            allow_byok: false,
            hourly_limit: DEFAULT_HOURLY_LIMIT,
            user_models: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct SettingsInput {
    pub provider: String,
    #[serde(default)]
    pub base_url: Option<String>,
    pub model: String,
    /// absent: keep the key; empty: remove it; otherwise the new key
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub allow_byok: bool,
    #[serde(default)]
    pub hourly_limit: Option<i32>,
    /// the models people may choose besides the default; absent: keep
    #[serde(default)]
    pub user_models: Option<Vec<String>>,
}

fn yes() -> bool {
    true
}

/// What the loop needs to call a provider.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub provider: String,
    pub base_url: Option<String>,
    pub model: String,
    pub key: Option<String>,
    pub hourly_limit: u32,
    /// the models, besides `model`, that people may choose
    pub user_models: Vec<String>,
    /// `platform` or `tenant`
    pub source: &'static str,
}

struct Row {
    provider: String,
    base_url: Option<String>,
    model: String,
    secret: Option<Vec<u8>>,
    enabled: bool,
    allow_byok: bool,
    hourly_limit: i32,
    user_models: Vec<String>,
}

fn models_of(v: Option<serde_json::Value>) -> Vec<String> {
    v.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

async fn row(k: &Kernel, id: Uuid) -> Result<Option<Row>> {
    Ok(mosaikit_db::query(
        "select provider, base_url, model, secret, enabled, allow_byok, hourly_limit, user_models
         from core.assistant_settings where tenant_id = $1",
    )
    .bind(id)
    .fetch_optional(&k.db)
    .await?
    .map(|r| Row {
        provider: r.get(0),
        base_url: r.get(1),
        model: r.get(2),
        secret: r.get(3),
        enabled: r.get(4),
        allow_byok: r.get(5),
        hourly_limit: r.get(6),
        user_models: models_of(r.get(7)),
    }))
}

fn view(r: Option<Row>) -> SettingsView {
    match r {
        None => SettingsView::empty(),
        Some(r) => SettingsView {
            configured: true,
            provider: r.provider,
            base_url: r.base_url,
            model: r.model,
            has_key: r.secret.is_some(),
            enabled: r.enabled,
            allow_byok: r.allow_byok,
            hourly_limit: r.hourly_limit,
            user_models: r.user_models,
        },
    }
}

fn aad(id: Uuid) -> String {
    format!("assistant:{id}")
}

fn open_key(k: &Kernel, id: Uuid, r: &Row) -> Result<Option<String>> {
    match &r.secret {
        None => Ok(None),
        Some(s) => {
            let plain = k.secrets.open(aad(id).as_bytes(), s)?;
            Ok(Some(String::from_utf8(plain).map_err(|_| Error::internal("assistant key unreadable"))?))
        }
    }
}

/// The settings that apply in a tenant: its own row when the platform allows it and it is on, else the platform row.
pub async fn resolve(k: &Kernel, tenant: Uuid) -> Result<Option<Resolved>> {
    let platform = row(k, platform_id()).await?;
    let allow = platform.as_ref().is_some_and(|p| p.allow_byok);
    let (id, chosen, source) = match row(k, tenant).await? {
        Some(t) if allow && t.enabled => (tenant, t, "tenant"),
        _ => match platform {
            Some(p) if p.enabled => (platform_id(), p, "platform"),
            _ => return Ok(None),
        },
    };
    let key = open_key(k, id, &chosen)?;
    Ok(Some(Resolved {
        provider: chosen.provider,
        base_url: chosen.base_url,
        model: chosen.model,
        key,
        hourly_limit: chosen.hourly_limit.max(1) as u32,
        user_models: chosen.user_models,
        source,
    }))
}

/// The settings of the platform row as the loop would use them, whether or not it is switched on (the Administrator asks the
/// provider for its models before turning it on).
pub async fn resolve_platform(k: &Kernel) -> Result<Option<Resolved>> {
    let Some(p) = row(k, platform_id()).await? else { return Ok(None) };
    let key = open_key(k, platform_id(), &p)?;
    Ok(Some(Resolved {
        provider: p.provider,
        base_url: p.base_url,
        model: p.model,
        key,
        hourly_limit: p.hourly_limit.max(1) as u32,
        user_models: p.user_models,
        source: "platform",
    }))
}

pub async fn platform_view(k: &Kernel, admin: &SessionUser) -> Result<SettingsView> {
    crate::tenancy::require_admin(admin)?;
    Ok(view(row(k, platform_id()).await?))
}

pub async fn tenant_view(k: &Kernel, c: &Caller) -> Result<SettingsView> {
    c.require_manager()?;
    let mut v = view(row(k, c.tenant.tenant_id).await?);
    // the tenant sees whether it may bring a key; `allow_byok` of its own row is never used
    v.allow_byok = row(k, platform_id()).await?.is_some_and(|p| p.allow_byok);
    Ok(v)
}

fn check(k: &Kernel, i: &SettingsInput, tenant_row: bool) -> Result<()> {
    if !PROVIDERS.contains(&i.provider.as_str()) {
        return Err(Error::bad(format!("provider: one of {}", PROVIDERS.join(", "))));
    }
    if i.provider == "fake" && !super::fake_allowed(k) {
        return Err(Error::bad("the fake provider is for development and tests only"));
    }
    let model = i.model.trim();
    if model.is_empty() || model.len() > 200 || model.chars().any(char::is_control) {
        return Err(Error::bad("model: 1 to 200 characters"));
    }
    if let Some(l) = i.hourly_limit {
        if !(1..=10_000).contains(&l) {
            return Err(Error::bad("hourly_limit: 1 to 10000"));
        }
    }
    let base = i.base_url.as_deref().map(str::trim).filter(|b| !b.is_empty());
    if let Some(b) = base {
        if tenant_row {
            return Err(Error::bad("a custom address is set by the Administrator only")
                .with_code("base_url_admin_only"));
        }
        if !(b.starts_with("http://") || b.starts_with("https://"))
            || b.len() > 500
            || b.chars().any(char::is_whitespace)
        {
            return Err(Error::bad("base_url: an http or https address"));
        }
    } else if i.provider == "openai_compatible" {
        return Err(Error::bad(
            "base_url is required for an OpenAI-compatible provider (e.g. http://localhost:11434/v1)",
        ));
    }
    if let Some(list) = &i.user_models {
        if list.len() > 200
            || list.iter().any(|m| m.trim().is_empty() || m.len() > 200 || m.chars().any(char::is_control))
        {
            return Err(Error::bad("user_models: at most 200 model names"));
        }
    }
    if let Some(key) = &i.api_key {
        if key.len() > 4096 || key.chars().any(char::is_control) {
            return Err(Error::bad("invalid key").with_code("key_invalid"));
        }
    }
    Ok(())
}

async fn save(k: &Kernel, by: Uuid, id: Uuid, i: &SettingsInput, allow_byok: bool) -> Result<()> {
    let old = row(k, id).await?;
    let user_models: Vec<String> = match &i.user_models {
        Some(list) => {
            let mut v: Vec<String> = list.iter().map(|m| m.trim().to_string()).collect();
            v.sort();
            v.dedup();
            v
        }
        None => old.as_ref().map(|o| o.user_models.clone()).unwrap_or_default(),
    };
    let secret: Option<Vec<u8>> = match i.api_key.as_deref().map(str::trim) {
        None => old.and_then(|o| o.secret),
        Some("") => None,
        Some(v) => Some(k.secrets.seal(aad(id).as_bytes(), v.as_bytes())),
    };
    let base =
        i.base_url.as_deref().map(str::trim).filter(|b| !b.is_empty()).map(|b| b.trim_end_matches('/'));
    mosaikit_db::query(
        "insert into core.assistant_settings (tenant_id, provider, base_url, model, secret, enabled, allow_byok, hourly_limit, user_models, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         on conflict (tenant_id) do update set provider = excluded.provider, base_url = excluded.base_url,
            model = excluded.model, secret = excluded.secret, enabled = excluded.enabled,
            allow_byok = excluded.allow_byok, hourly_limit = excluded.hourly_limit, user_models = excluded.user_models,
            updated_at = now()",
    )
    .bind(id)
    .bind(&i.provider)
    .bind(base)
    .bind(i.model.trim())
    .bind(secret)
    .bind(i.enabled)
    .bind(allow_byok)
    .bind(i.hourly_limit.unwrap_or(DEFAULT_HOURLY_LIMIT))
    .bind(serde_json::json!(user_models))
    .execute(&k.db)
    .await?;
    events::record(
        k,
        (id != platform_id()).then_some(id),
        Some(by),
        None,
        None,
        "assistant.settings",
        json!({ "scope": if id == platform_id() { "platform" } else { "tenant" }, "provider": i.provider,
                "model": i.model.trim(), "enabled": i.enabled, "allow_byok": allow_byok,
                "key_changed": i.api_key.is_some() }),
    )
    .await;
    Ok(())
}

pub async fn set_platform(k: &Kernel, admin: &SessionUser, i: &SettingsInput) -> Result<SettingsView> {
    crate::tenancy::require_admin(admin)?;
    check(k, i, false)?;
    save(k, admin.user_id, platform_id(), i, i.allow_byok).await?;
    platform_view(k, admin).await
}

pub async fn set_tenant(k: &Kernel, c: &Caller, i: &SettingsInput) -> Result<SettingsView> {
    c.require_manager()?;
    let allowed = row(k, platform_id()).await?.is_some_and(|p| p.allow_byok);
    if !allowed {
        return Err(Error::forbidden("the Administrator has not allowed a key of your own")
            .with_code("byok_not_allowed"));
    }
    check(k, i, true)?;
    save(k, c.user.user_id, c.tenant.tenant_id, i, false).await?;
    tenant_view(k, c).await
}

/// Removes the key and the settings the Manager brought: the platform ones apply again.
pub async fn clear_tenant(k: &Kernel, c: &Caller) -> Result<()> {
    c.require_manager()?;
    mosaikit_db::query("delete from core.assistant_settings where tenant_id = $1")
        .bind(c.tenant.tenant_id)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "assistant.settings_cleared",
        json!({}),
    )
    .await;
    Ok(())
}
