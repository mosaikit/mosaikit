//! Settings on three levels (docs/refactoring-ui.md §5): the platform (system tenant) sets a value for
//! everybody, a tenant may change it within what the platform allows. Three kinds:
//!
//! - **managed**: decided by the Administrator only; the tenant sees it with a lock;
//! - **limit**: the tenant may only be stricter than the platform (a higher minimum, a lower maximum,
//!   a subset of a list); the value in use is always the stricter one, also when the platform changes
//!   later;
//! - **customizable**: the tenant may replace the value of the platform, unless the Administrator
//!   turned off "tenants may customize it"; the tenant can always go back to the platform value.
//!
//! Values live in `core.tenants.settings`: under `cfg` (key -> value) for the platform (system tenant)
//! and for each tenant, with `cust` (key -> bool) in the platform for the switches. The theme and the
//! top bar keep the keys they had before this model (`theme`, `band`).

use serde::Serialize;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use super::require_admin;
use crate::{events, Caller, Error, Kernel, Result, SessionUser};

/// Languages of the interface (UI and server messages).
pub const LANGUAGES: &[&str] = &["en", "it"];
/// Formats of dates and numbers ("auto": the one of the language).
pub const LOCALES: &[&str] = &["auto", "en-GB", "en-US", "it-IT"];
/// The shortest password the platform may allow.
pub const PASSWORD_FLOOR: i64 = crate::identity::MIN_PASSWORD_LEN as i64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Managed,
    Limit,
    Custom,
}

/// How a tenant may be stricter than the platform (settings with a limit).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Rule {
    /// a number not lower than the platform's
    Min,
    /// a number not higher than the platform's
    Max,
    /// a part of the platform's list
    Subset,
}

/// Where a setting exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Both,
    Platform,
    Tenant,
}

struct Def {
    key: &'static str,
    kind: Kind,
    rule: Option<Rule>,
    scope: Scope,
    /// without a value of its own the tenant uses the platform's (false: the default of the tenant)
    inherit: bool,
    /// set through a page of its own (uploads, top bar), not through the generic update
    own_api: bool,
    check: fn(&Value) -> Result<()>,
}

const fn def(key: &'static str, kind: Kind, scope: Scope, check: fn(&Value) -> Result<()>) -> Def {
    Def { key, kind, rule: None, scope, inherit: true, own_api: false, check }
}

const fn limit(key: &'static str, rule: Rule, check: fn(&Value) -> Result<()>) -> Def {
    Def { key, kind: Kind::Limit, rule: Some(rule), scope: Scope::Both, inherit: true, own_api: false, check }
}

const fn upload(key: &'static str, scope: Scope) -> Def {
    Def { key, kind: Kind::Custom, rule: None, scope, inherit: false, own_api: true, check: any }
}

const DEFS: &[Def] = &[
    // identity and texts
    Def { inherit: false, ..def("identity.name", Kind::Custom, Scope::Both, name_text) },
    upload("identity.logo_light", Scope::Both),
    upload("identity.logo_dark", Scope::Both),
    upload("identity.icon", Scope::Platform),
    def("identity.welcome", Kind::Custom, Scope::Both, text_300),
    def("identity.footer", Kind::Custom, Scope::Both, text_200),
    def("identity.privacy_url", Kind::Custom, Scope::Both, url_or_empty),
    def("identity.legal_url", Kind::Custom, Scope::Both, url_or_empty),
    // the Guide of the help menu; empty: the short guide built into the shell
    def("identity.guide_url", Kind::Custom, Scope::Both, url_or_empty),
    def("identity.landing", Kind::Custom, Scope::Tenant, landing),
    // appearance
    def("theme", Kind::Custom, Scope::Both, theme),
    def("appearance.mode", Kind::Custom, Scope::Both, mode),
    Def { own_api: true, ..def("band", Kind::Managed, Scope::Platform, any) },
    // languages and formats
    limit("lang.enabled", Rule::Subset, languages),
    def("lang.default", Kind::Custom, Scope::Both, lang_default),
    def("format.locale", Kind::Custom, Scope::Both, locale),
    // security
    limit("security.password_min", Rule::Min, password_min),
    limit("security.lock_attempts", Rule::Max, lock_attempts),
    limit("security.lock_minutes", Rule::Min, lock_minutes),
    limit("security.session_hours", Rule::Max, session_hours),
    limit("security.remember_days", Rule::Max, remember_days),
    // embedding
    limit("embed.sites", Rule::Subset, origins),
    // notifications: emails at once, in a daily digest or never (each person may choose)
    def("notify.email_mode", Kind::Custom, Scope::Both, email_mode),
    def("notify.digest_hour", Kind::Managed, Scope::Platform, digest_hour),
    def("notify.retention_days", Kind::Managed, Scope::Platform, retention_days),
    // trash and log
    def("trash.retention_days", Kind::Managed, Scope::Platform, trash_days),
    def("log.retention_days", Kind::Managed, Scope::Platform, log_days),
];

fn find(key: &str) -> Result<&'static Def> {
    DEFS.iter()
        .find(|d| d.key == key)
        .ok_or_else(|| Error::bad(format!("unknown setting: {key}")).with_code("setting_unknown"))
}

// ------------------------------------------------------------------ checks

fn any(_: &Value) -> Result<()> {
    Ok(())
}

fn invalid(what: &str) -> Error {
    Error::bad(format!("invalid value: {what}")).with_code("setting_invalid")
}

fn text(v: &Value, max: usize) -> Result<()> {
    match v.as_str() {
        Some(s) if s.chars().count() <= max => Ok(()),
        _ => Err(invalid(&format!("a text of at most {max} characters"))),
    }
}

fn name_text(v: &Value) -> Result<()> {
    text(v, 80)?;
    if v.as_str().is_some_and(|s| s.trim().is_empty()) {
        return Err(invalid("a name"));
    }
    Ok(())
}

fn text_300(v: &Value) -> Result<()> {
    text(v, 300)
}

fn text_200(v: &Value) -> Result<()> {
    text(v, 200)
}

fn url_or_empty(v: &Value) -> Result<()> {
    let s = v.as_str().ok_or_else(|| invalid("an address"))?;
    if s.is_empty()
        || ((s.starts_with("https://") || s.starts_with("http://")) && s.len() <= 300 && !s.contains(' '))
    {
        Ok(())
    } else {
        Err(invalid("an address starting with https://"))
    }
}

fn landing(v: &Value) -> Result<()> {
    let s = v.as_str().ok_or_else(|| invalid("a page"))?;
    let ok = !s.is_empty()
        && s.len() <= 100
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b));
    if ok {
        Ok(())
    } else {
        Err(invalid("a page"))
    }
}

fn theme(v: &Value) -> Result<()> {
    super::settings::check_theme(v.as_str().unwrap_or_default())
}

fn one_of(v: &Value, list: &[&str], what: &str) -> Result<()> {
    match v.as_str() {
        Some(s) if list.contains(&s) => Ok(()),
        _ => Err(invalid(what)),
    }
}

fn mode(v: &Value) -> Result<()> {
    one_of(v, &["auto", "light", "dark"], "auto, light or dark")
}

fn lang_default(v: &Value) -> Result<()> {
    if v.as_str() == Some("auto") {
        return Ok(());
    }
    one_of(v, LANGUAGES, "a language")
}

fn locale(v: &Value) -> Result<()> {
    one_of(v, LOCALES, "a format")
}

fn languages(v: &Value) -> Result<()> {
    let list = v.as_array().ok_or_else(|| invalid("a list of languages"))?;
    let mut seen = Vec::new();
    for l in list {
        let s = l.as_str().filter(|s| LANGUAGES.contains(s)).ok_or_else(|| invalid("a known language"))?;
        if seen.contains(&s) {
            return Err(invalid("a list without repetitions"));
        }
        seen.push(s);
    }
    if seen.is_empty() {
        return Err(invalid("at least one language").with_code("setting_empty"));
    }
    Ok(())
}

fn int(v: &Value, lo: i64, hi: i64) -> Result<()> {
    match v.as_i64() {
        Some(n) if (lo..=hi).contains(&n) => Ok(()),
        _ => Err(invalid(&format!("a number from {lo} to {hi}"))),
    }
}

fn password_min(v: &Value) -> Result<()> {
    int(v, PASSWORD_FLOOR, 128)
}

fn lock_attempts(v: &Value) -> Result<()> {
    int(v, 3, 20)
}

fn lock_minutes(v: &Value) -> Result<()> {
    int(v, 1, 1440)
}

fn session_hours(v: &Value) -> Result<()> {
    int(v, 1, 720)
}

fn remember_days(v: &Value) -> Result<()> {
    int(v, 0, 365)
}

fn email_mode(v: &Value) -> Result<()> {
    one_of(v, &["off", "immediate", "digest"], "off, immediate or digest")
}

fn digest_hour(v: &Value) -> Result<()> {
    int(v, 0, 23)
}

fn retention_days(v: &Value) -> Result<()> {
    int(v, 7, 3650)
}

fn trash_days(v: &Value) -> Result<()> {
    int(v, 1, 365)
}

fn log_days(v: &Value) -> Result<()> {
    int(v, 30, 3650)
}

/// An origin that may embed public pages: `https://host[:port]`, without a path.
pub fn valid_origin(s: &str) -> bool {
    let Some(rest) = s.strip_prefix("https://").or_else(|| s.strip_prefix("http://")) else {
        return false;
    };
    let (host, port) = match rest.split_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    !host.is_empty()
        && host.len() <= 253
        && host.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
        && !host.starts_with('.')
        && port.is_none_or(|p| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()))
}

fn origins(v: &Value) -> Result<()> {
    let list = v.as_array().ok_or_else(|| invalid("a list of sites"))?;
    if list.len() > 20 {
        return Err(invalid("at most 20 sites"));
    }
    for o in list {
        if !o.as_str().is_some_and(valid_origin) {
            return Err(invalid("sites like https://www.example.com (lower case, no path)"));
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ resolution

/// Defaults that depend on the installation (brand, configuration).
#[derive(Debug, Clone)]
pub struct Defaults {
    pub name: String,
    pub footer: String,
    pub session_hours: i64,
}

impl Defaults {
    pub fn of(k: &Kernel) -> Defaults {
        Defaults {
            name: k.brand.name.clone(),
            footer: k.brand.footer.clone(),
            session_hours: k.cfg.session_ttl_hours.clamp(1, 720),
        }
    }

    fn value(&self, key: &str) -> Value {
        match key {
            "identity.name" => json!(self.name),
            "identity.footer" => json!(self.footer),
            "identity.welcome" | "identity.privacy_url" | "identity.legal_url" | "identity.guide_url" => {
                json!("")
            }
            "identity.landing" => json!("home"),
            "theme" => json!(super::settings::DEFAULT_THEME),
            "appearance.mode" | "lang.default" | "format.locale" => json!("auto"),
            "band" => serde_json::to_value(super::settings::ShellBand::default()).unwrap_or(Value::Null),
            "lang.enabled" => json!(LANGUAGES),
            "security.password_min" => json!(PASSWORD_FLOOR),
            "security.lock_attempts" => json!(8),
            "security.lock_minutes" => json!(15),
            "security.session_hours" => json!(self.session_hours),
            "security.remember_days" => json!(30),
            "embed.sites" => json!([]),
            "notify.email_mode" => json!("digest"),
            "notify.digest_hour" => json!(7),
            "notify.retention_days" => json!(90),
            "trash.retention_days" => json!(crate::trash::DEFAULT_RETENTION_DAYS),
            "log.retention_days" => json!(crate::log::DEFAULT_RETENTION_DAYS),
            _ => Value::Null,
        }
    }
}

/// A stored value (theme and top bar have their own keys, the rest is under `cfg`).
fn raw(settings: &Value, key: &str) -> Option<Value> {
    let v = match key {
        "theme" | "band" => settings.get(key),
        _ => settings.get("cfg").and_then(|c| c.get(key)),
    };
    v.filter(|v| !v.is_null()).cloned()
}

fn put_raw(settings: &mut Value, key: &str, v: Option<Value>) {
    if !settings.is_object() {
        *settings = json!({});
    }
    let o = settings.as_object_mut().expect("object");
    let target = match key {
        "theme" | "band" => o,
        _ => {
            let cfg = o.entry("cfg").or_insert_with(|| json!({}));
            if !cfg.is_object() {
                *cfg = json!({});
            }
            cfg.as_object_mut().expect("object")
        }
    };
    match v {
        Some(v) => {
            target.insert(key.to_string(), v);
        }
        None => {
            target.remove(key);
        }
    }
}

/// "Tenants may customize it", for the customizable settings (default: yes).
fn customizable(platform: &Value, d: &Def) -> bool {
    match d.kind {
        Kind::Managed => false,
        Kind::Limit => true,
        Kind::Custom => {
            platform.get("cust").and_then(|c| c.get(d.key)).and_then(Value::as_bool).unwrap_or(true)
        }
    }
}

/// The stricter of the platform and the tenant values (settings with a limit).
fn stricter(rule: Rule, platform: &Value, own: &Value) -> Value {
    match rule {
        Rule::Min => json!(platform.as_i64().unwrap_or(0).max(own.as_i64().unwrap_or(0))),
        Rule::Max => json!(platform.as_i64().unwrap_or(0).min(own.as_i64().unwrap_or(i64::MAX))),
        Rule::Subset => {
            let p = platform.as_array().cloned().unwrap_or_default();
            let both: Vec<Value> =
                own.as_array().into_iter().flatten().filter(|x| p.contains(x)).cloned().collect();
            // a tenant left with nothing uses the platform's list
            if both.is_empty() {
                Value::Array(p)
            } else {
                Value::Array(both)
            }
        }
    }
}

/// A setting as a page shows it: the value of the platform, the one of the tenant, the one in use and
/// where it comes from.
#[derive(Debug, Clone, Serialize)]
pub struct Setting {
    pub key: &'static str,
    pub kind: Kind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule: Option<Rule>,
    pub scope: Scope,
    /// the value of the platform (its own or the default)
    pub platform: Value,
    /// the value the tenant set (tenant view only)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant: Option<Value>,
    /// the value in use
    pub value: Value,
    /// where the value in use comes from: "default", "platform" or "tenant"
    pub source: &'static str,
    /// tenants may customize it
    pub customizable: bool,
    /// the tenant cannot change it
    pub locked: bool,
    /// without a value of its own the tenant uses the platform's (false: a default of the tenant, as
    /// its name or its logos)
    pub inherits: bool,
}

fn platform_one(d: &'static Def, platform: &Value, defaults: &Defaults) -> Setting {
    let own = raw(platform, d.key);
    let source = if own.is_some() { "platform" } else { "default" };
    let value = own.unwrap_or_else(|| defaults.value(d.key));
    Setting {
        key: d.key,
        kind: d.kind,
        rule: d.rule,
        scope: d.scope,
        platform: value.clone(),
        tenant: None,
        value,
        source,
        customizable: customizable(platform, d),
        locked: false,
        inherits: false,
    }
}

fn tenant_one(
    d: &'static Def,
    platform: &Value,
    tenant: &Value,
    tenant_name: &str,
    defaults: &Defaults,
) -> Setting {
    let p = platform_one(d, platform, defaults);
    let own = raw(tenant, d.key);
    let cust = customizable(platform, d);
    let locked = d.kind == Kind::Managed || !cust;
    let own_default = match d.key {
        "identity.name" => json!(tenant_name),
        _ => defaults.value(d.key),
    };
    let (value, source) = match (d.kind, &own) {
        (Kind::Managed, _) => (p.value.clone(), p.source),
        (Kind::Limit, Some(o)) => {
            let v = stricter(d.rule.expect("rule of a limit"), &p.value, o);
            let source = if &v == o { "tenant" } else { "platform" };
            (v, source)
        }
        (Kind::Limit, None) => (p.value.clone(), p.source),
        (Kind::Custom, Some(o)) if !locked => (o.clone(), "tenant"),
        (Kind::Custom, _) if d.inherit && d.scope == Scope::Both => (p.value.clone(), p.source),
        (Kind::Custom, _) => (own_default, "default"),
    };
    let inherits = d.kind != Kind::Custom || (d.inherit && d.scope == Scope::Both);
    Setting { platform: p.value, tenant: own, value, source, locked, customizable: cust, inherits, ..p }
}

/// `lang.default` must be one of the enabled languages: otherwise it goes back to "auto".
fn fix_default_language(list: &mut [Setting]) {
    let enabled = list.iter().find(|s| s.key == "lang.enabled").map(|s| s.value.clone());
    if let (Some(enabled), Some(d)) = (enabled, list.iter_mut().find(|s| s.key == "lang.default")) {
        if d.value != "auto" && !enabled.as_array().is_some_and(|a| a.contains(&d.value)) {
            d.value = json!("auto");
        }
    }
}

/// The settings of the platform (pure: the stored settings of the system tenant and the defaults).
pub fn platform_view(platform: &Value, defaults: &Defaults) -> Vec<Setting> {
    let mut list: Vec<Setting> = DEFS
        .iter()
        .filter(|d| d.scope != Scope::Tenant)
        .map(|d| platform_one(d, platform, defaults))
        .collect();
    fix_default_language(&mut list);
    list
}

/// The settings of a tenant (pure): also the ones managed by the platform, shown with a lock.
pub fn tenant_view(platform: &Value, tenant: &Value, tenant_name: &str, defaults: &Defaults) -> Vec<Setting> {
    let mut list: Vec<Setting> = DEFS
        .iter()
        .filter(|d| d.scope != Scope::Platform || d.kind == Kind::Managed)
        .map(|d| tenant_one(d, platform, tenant, tenant_name, defaults))
        .collect();
    fix_default_language(&mut list);
    list
}

/// Only the values in use, by key.
pub fn values(list: &[Setting]) -> Map<String, Value> {
    list.iter().map(|s| (s.key.to_string(), s.value.clone())).collect()
}

pub(crate) async fn system_settings(k: &Kernel) -> Result<Value> {
    let v: Option<Value> = mosaikit_db::query_scalar("select settings from core.tenants where is_system")
        .fetch_optional(&k.db)
        .await?;
    Ok(v.filter(Value::is_object).unwrap_or_else(|| json!({})))
}

/// Stored settings, name and kind of a tenant (`None` if it does not exist).
async fn tenant_row(k: &Kernel, tenant: Uuid) -> Result<Option<(Value, String, bool)>> {
    let row = mosaikit_db::query("select settings, name, is_system from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?;
    Ok(row.map(|r| {
        let s: Option<Value> = r.get(0);
        (s.filter(Value::is_object).unwrap_or_else(|| json!({})), r.get(1), r.get(2))
    }))
}

/// The settings of the platform, as the Administrator sees them.
pub async fn platform_settings(k: &Kernel) -> Result<Vec<Setting>> {
    Ok(platform_view(&system_settings(k).await?, &Defaults::of(k)))
}

/// The settings of a tenant, as its Tenant Manager sees them.
pub async fn tenant_settings(k: &Kernel, tenant: Uuid) -> Result<Vec<Setting>> {
    let platform = system_settings(k).await?;
    let (own, name, _) = tenant_row(k, tenant).await?.ok_or_else(|| Error::not_found("tenant not found"))?;
    Ok(tenant_view(&platform, &own, &name, &Defaults::of(k)))
}

/// The values in use for a tenant (`None` or the system tenant: the platform's).
pub async fn effective(k: &Kernel, tenant: Option<Uuid>) -> Result<Map<String, Value>> {
    let platform = system_settings(k).await?;
    let defaults = Defaults::of(k);
    if let Some(id) = tenant {
        if let Some((own, name, false)) = tenant_row(k, id).await? {
            return Ok(values(&tenant_view(&platform, &own, &name, &defaults)));
        }
    }
    Ok(values(&platform_view(&platform, &defaults)))
}

/// Rules of passwords and sessions in use for a tenant (`None`: the platform's).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Security {
    pub password_min: usize,
    pub lock_attempts: u32,
    pub lock_minutes: u32,
    pub session_hours: i64,
    pub remember_days: i64,
}

impl Security {
    pub fn from_values(v: &Map<String, Value>) -> Security {
        let n = |k: &str, d: i64| v.get(k).and_then(Value::as_i64).unwrap_or(d);
        Security {
            password_min: n("security.password_min", PASSWORD_FLOOR).max(PASSWORD_FLOOR) as usize,
            lock_attempts: n("security.lock_attempts", 8).clamp(1, 1000) as u32,
            lock_minutes: n("security.lock_minutes", 15).clamp(1, 1440) as u32,
            session_hours: n("security.session_hours", 8).clamp(1, 720),
            remember_days: n("security.remember_days", 0).clamp(0, 365),
        }
    }
}

pub async fn security(k: &Kernel, tenant: Option<Uuid>) -> Result<Security> {
    Ok(Security::from_values(&effective(k, tenant).await?))
}

/// Sites that may embed the public pages of a tenant.
pub async fn embed_sites(k: &Kernel, tenant: Uuid) -> Result<Vec<String>> {
    let v = effective(k, Some(tenant)).await?;
    Ok(v.get("embed.sites")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).filter(|s| valid_origin(s)).map(str::to_owned).collect())
        .unwrap_or_default())
}

// ------------------------------------------------------------------ changes

/// Changes of the platform: `values` (null = back to the default) and the switches "tenants may
/// customize it" of the customizable settings.
pub async fn set_platform(
    k: &Kernel,
    admin: &SessionUser,
    values: &Map<String, Value>,
    switches: &Map<String, Value>,
) -> Result<Vec<Setting>> {
    require_admin(admin)?;
    let mut s = system_settings(k).await?;
    for (key, v) in values {
        let d = find(key)?;
        if d.scope == Scope::Tenant {
            return Err(Error::bad(format!("{key} is a setting of the tenants")).with_code("setting_unknown"));
        }
        if d.own_api && !v.is_null() {
            return Err(
                Error::bad(format!("{key} is changed from its own page")).with_code("setting_own_page")
            );
        }
        if !v.is_null() {
            (d.check)(v)?;
        }
        if d.own_api {
            remove_file(k, None, d.key);
        }
        put_raw(&mut s, key, Some(v.clone()).filter(|v| !v.is_null()));
    }
    for (key, on) in switches {
        let d = find(key)?;
        let on = on.as_bool().ok_or_else(|| invalid("on or off"))?;
        if d.kind != Kind::Custom || d.scope != Scope::Both {
            return Err(
                Error::bad(format!("{key} has no switch for the tenants")).with_code("setting_unknown")
            );
        }
        let o = s.as_object_mut().expect("object");
        let cust = o.entry("cust").or_insert_with(|| json!({}));
        if !cust.is_object() {
            *cust = json!({});
        }
        cust[key.as_str()] = json!(on);
    }
    write_system(k, &s).await?;
    let changed: Vec<&String> = values.keys().chain(switches.keys()).collect();
    events::record(k, None, Some(admin.user_id), None, None, "platform.settings", json!({ "keys": changed }))
        .await;
    platform_settings(k).await
}

/// Changes of a tenant (Tenant Manager): `values`, null = back to the value of the platform.
pub async fn set_tenant(k: &Kernel, c: &Caller, values: &Map<String, Value>) -> Result<Vec<Setting>> {
    c.require_manager()?;
    let tenant = c.tenant.tenant_id;
    let platform = system_settings(k).await?;
    let defaults = Defaults::of(k);
    let (mut own, _, _) = tenant_row(k, tenant).await?.ok_or_else(|| Error::not_found("tenant not found"))?;
    for (key, v) in values {
        let d = find(key)?;
        if d.scope == Scope::Platform && d.kind != Kind::Managed {
            return Err(
                Error::bad(format!("{key} is a setting of the platform")).with_code("setting_unknown")
            );
        }
        if d.kind == Kind::Managed || !customizable(&platform, d) {
            return Err(Error::forbidden("managed by the Administrator").with_code("setting_locked"));
        }
        if d.own_api && !v.is_null() {
            return Err(
                Error::bad(format!("{key} is changed from its own page")).with_code("setting_own_page")
            );
        }
        if !v.is_null() {
            (d.check)(v)?;
            if let Some(rule) = d.rule {
                let p = platform_one(d, &platform, &defaults).value;
                check_limit(rule, &p, v)?;
            }
        }
        if d.own_api {
            remove_file(k, Some(tenant), d.key);
        }
        put_raw(&mut own, key, Some(v.clone()).filter(|v| !v.is_null()));
    }
    write_tenant(k, tenant, &own).await?;
    events::record(
        k,
        Some(tenant),
        Some(c.user.user_id),
        None,
        None,
        "tenant.config",
        json!({ "keys": values.keys().collect::<Vec<_>>() }),
    )
    .await;
    tenant_settings(k, tenant).await
}

/// A tenant may only be stricter than the platform.
fn check_limit(rule: Rule, platform: &Value, v: &Value) -> Result<()> {
    let ok = match rule {
        Rule::Min => v.as_i64() >= platform.as_i64(),
        Rule::Max => v.as_i64() <= platform.as_i64(),
        Rule::Subset => {
            let p = platform.as_array().cloned().unwrap_or_default();
            v.as_array().is_some_and(|a| a.iter().all(|x| p.contains(x)))
        }
    };
    if ok {
        Ok(())
    } else {
        let what = match rule {
            Rule::Min => format!("at least {platform}, the minimum of the platform"),
            Rule::Max => format!("at most {platform}, the maximum of the platform"),
            Rule::Subset => "only values the platform allows".to_string(),
        };
        Err(Error::bad(format!("the tenant may only be stricter than the platform: {what}"))
            .with_code("setting_beyond_platform"))
    }
}

pub(crate) async fn write_system(k: &Kernel, s: &Value) -> Result<()> {
    mosaikit_db::query("update core.tenants set settings = $1 where is_system")
        .bind(s)
        .execute(&k.db)
        .await?;
    Ok(())
}

async fn write_tenant(k: &Kernel, tenant: Uuid, s: &Value) -> Result<()> {
    mosaikit_db::query("update core.tenants set settings = $2 where id = $1")
        .bind(tenant)
        .bind(s)
        .execute(&k.db)
        .await?;
    Ok(())
}

// ------------------------------------------------------------------ logos and browser icon

/// Largest logo or icon accepted.
pub const IMAGE_MAX: usize = 512 << 10;

/// Slots of the images: logos for light and dark backgrounds, browser icon (platform only).
fn slot_key(slot: &str, platform: bool) -> Result<&'static str> {
    match (slot, platform) {
        ("logo_light", _) => Ok("identity.logo_light"),
        ("logo_dark", _) => Ok("identity.logo_dark"),
        ("icon", true) => Ok("identity.icon"),
        _ => Err(Error::not_found(format!("unknown image: {slot}"))),
    }
}

/// Type of an image from its bytes (never from the name or the declared type).
pub fn sniff_image(data: &[u8], icon: bool) -> Result<&'static str> {
    if data.is_empty() {
        return Err(Error::bad("empty file").with_code("image_type"));
    }
    if data.len() > IMAGE_MAX {
        return Err(Error::bad("image too large: at most 512 KB").with_code("image_too_large"));
    }
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png");
    }
    if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Ok("image/webp");
    }
    if icon && data.starts_with(&[0, 0, 1, 0]) {
        return Ok("image/x-icon");
    }
    if let Ok(text) = std::str::from_utf8(data) {
        let lower = text.to_ascii_lowercase();
        if lower.contains("<svg") {
            check_svg(&lower)?;
            return Ok("image/svg+xml");
        }
    }
    Err(Error::bad("only SVG, PNG or WebP images").with_code("image_type"))
}

/// An SVG with scripts, event handlers, embedded documents or external references is refused (it is
/// also served with a CSP that runs nothing).
fn check_svg(lower: &str) -> Result<()> {
    const BAD: &[&str] = &[
        "<script",
        "javascript:",
        "<foreignobject",
        "<iframe",
        "<embed",
        "<object",
        "<!entity",
        "href=\"http",
        "href='http",
        "url(http",
    ];
    // an attribute on...= after a blank or a slash: an event handler
    let bytes = lower.as_bytes();
    let handler = lower.match_indices("on").any(|(i, _)| {
        let before = i.checked_sub(1).map(|j| bytes[j]);
        if !before.is_some_and(|b| b.is_ascii_whitespace() || b == b'/') {
            return false;
        }
        let rest = &lower[i + 2..];
        let name = rest.bytes().take_while(u8::is_ascii_alphabetic).count();
        name > 0 && rest[name..].trim_start().starts_with('=')
    });
    if handler || BAD.iter().any(|b| lower.contains(b)) {
        return Err(Error::bad("SVG with scripts or external references").with_code("image_unsafe"));
    }
    Ok(())
}

fn image_path(k: &Kernel, tenant: Option<Uuid>, key: &str) -> std::path::PathBuf {
    let owner = tenant.map(|t| t.to_string()).unwrap_or_else(|| "platform".into());
    k.blobs.root().join("identity").join(owner).join(key.trim_start_matches("identity."))
}

fn remove_file(k: &Kernel, tenant: Option<Uuid>, key: &str) {
    let _ = std::fs::remove_file(image_path(k, tenant, key));
}

/// Saves a logo or the browser icon of the platform (`tenant: None`, Administrator) or of a tenant
/// (Tenant Manager).
pub async fn set_image(k: &Kernel, who: Who<'_>, slot: &str, data: &[u8]) -> Result<()> {
    let tenant = who.tenant()?;
    let key = slot_key(slot, tenant.is_none())?;
    let mime = sniff_image(data, key == "identity.icon")?;
    if matches!(who, Who::Tenant(_)) {
        let platform = system_settings(k).await?;
        if !customizable(&platform, find(key)?) {
            return Err(Error::forbidden("managed by the Administrator").with_code("setting_locked"));
        }
    }
    let path = image_path(k, tenant, key);
    std::fs::create_dir_all(path.parent().expect("folder"))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, &path)?;
    let value = json!({ "type": mime, "v": crate::util::random_token(4) });
    let (mut s, user) = match who {
        Who::Platform(a) => (system_settings(k).await?, a.user_id),
        Who::Tenant(c) => (
            tenant_row(k, c.tenant.tenant_id).await?.map(|r| r.0).unwrap_or_else(|| json!({})),
            c.user.user_id,
        ),
    };
    put_raw(&mut s, key, Some(value));
    match tenant {
        Some(t) => write_tenant(k, t, &s).await?,
        None => write_system(k, &s).await?,
    }
    events::record(k, tenant, Some(user), None, None, "identity.image", json!({ "slot": slot })).await;
    Ok(())
}

/// Removes a logo or the browser icon (the default comes back).
pub async fn remove_image(k: &Kernel, who: Who<'_>, slot: &str) -> Result<()> {
    let tenant = who.tenant()?;
    let key = slot_key(slot, tenant.is_none())?;
    let mut values = Map::new();
    values.insert(key.to_string(), Value::Null);
    match who {
        Who::Platform(a) => {
            set_platform(k, a, &values, &Map::new()).await?;
        }
        Who::Tenant(c) => {
            set_tenant(k, c, &values).await?;
        }
    }
    Ok(())
}

/// A logo or icon and its type, if set (public: the sign-in page shows them).
pub async fn image(k: &Kernel, tenant: Option<Uuid>, slot: &str) -> Result<Option<(Vec<u8>, String)>> {
    let key = slot_key(slot, tenant.is_none())?;
    let settings = match tenant {
        Some(t) => match tenant_row(k, t).await? {
            Some((s, _, false)) => s,
            _ => return Ok(None),
        },
        None => system_settings(k).await?,
    };
    let Some(v) = raw(&settings, key) else { return Ok(None) };
    let mime = v.get("type").and_then(Value::as_str).unwrap_or("application/octet-stream").to_string();
    match std::fs::read(image_path(k, tenant, key)) {
        Ok(data) => Ok(Some((data, mime))),
        Err(_) => Ok(None),
    }
}

/// Who changes: the Administrator for the platform, a Tenant Manager for the tenant.
#[derive(Clone, Copy)]
pub enum Who<'a> {
    Platform(&'a SessionUser),
    Tenant(&'a Caller),
}

impl Who<'_> {
    fn tenant(&self) -> Result<Option<Uuid>> {
        match self {
            Who::Platform(a) => {
                require_admin(a)?;
                Ok(None)
            }
            Who::Tenant(c) => {
                c.require_manager()?;
                Ok(Some(c.tenant.tenant_id))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn defaults() -> Defaults {
        Defaults { name: "Mosaikit".into(), footer: String::new(), session_hours: 8 }
    }

    fn get<'a>(l: &'a [Setting], key: &str) -> &'a Setting {
        l.iter().find(|s| s.key == key).unwrap()
    }

    #[test]
    fn limits_take_the_stricter_value() {
        let platform = json!({ "cfg": { "security.password_min": 12, "security.session_hours": 8, "lang.enabled": ["en", "it"] } });
        // a tenant stricter than the platform keeps its values
        let t = json!({ "cfg": { "security.password_min": 14, "security.session_hours": 4, "lang.enabled": ["it"] } });
        let l = tenant_view(&platform, &t, "Alfa", &defaults());
        assert_eq!(get(&l, "security.password_min").value, json!(14));
        assert_eq!(get(&l, "security.password_min").source, "tenant");
        assert_eq!(get(&l, "security.session_hours").value, json!(4));
        assert_eq!(get(&l, "lang.enabled").value, json!(["it"]));
        // the platform became stricter later: its value wins
        let t = json!({ "cfg": { "security.password_min": 11, "security.session_hours": 12, "lang.enabled": ["fr"] } });
        let l = tenant_view(&platform, &t, "Alfa", &defaults());
        assert_eq!(get(&l, "security.password_min").value, json!(12));
        assert_eq!(get(&l, "security.password_min").source, "platform");
        assert_eq!(get(&l, "security.session_hours").value, json!(8));
        assert_eq!(get(&l, "lang.enabled").value, json!(["en", "it"]));
    }

    #[test]
    fn customizable_values_inherit_and_can_be_locked() {
        let platform = json!({ "theme": "tessera", "cfg": { "identity.footer": "© Platform" } });
        let t = json!({ "theme": "italia", "cfg": { "identity.footer": "© Alfa" } });
        let l = tenant_view(&platform, &t, "Alfa", &defaults());
        assert_eq!(get(&l, "theme").value, json!("italia"));
        assert_eq!(get(&l, "identity.footer").value, json!("© Alfa"));
        // without values of its own the tenant inherits; name and logos are its own
        let l = tenant_view(&platform, &json!({}), "Alfa", &defaults());
        assert_eq!(get(&l, "theme").value, json!("tessera"));
        assert_eq!(get(&l, "identity.footer").source, "platform");
        assert_eq!(get(&l, "identity.name").value, json!("Alfa"));
        // "tenants may customize it" off: the platform value, with a lock
        let locked = json!({ "theme": "tessera", "cust": { "theme": false } });
        let l = tenant_view(&locked, &t, "Alfa", &defaults());
        assert_eq!(get(&l, "theme").value, json!("tessera"));
        assert!(get(&l, "theme").locked);
        // managed by the platform: always the platform's, always locked
        assert!(get(&l, "band").locked);
    }

    #[test]
    fn default_language_follows_the_enabled_ones() {
        let platform = json!({ "cfg": { "lang.enabled": ["en"], "lang.default": "it" } });
        let l = platform_view(&platform, &defaults());
        assert_eq!(get(&l, "lang.default").value, json!("auto"));
    }

    #[test]
    fn checks_of_values() {
        assert!(password_min(&json!(9)).is_err());
        assert!(password_min(&json!(10)).is_ok());
        assert!(languages(&json!([])).is_err());
        assert!(languages(&json!(["en", "en"])).is_err());
        assert!(origins(&json!(["https://www.example.com", "http://localhost:8080"])).is_ok());
        assert!(origins(&json!(["https://www.example.com/path"])).is_err());
        assert!(origins(&json!(["javascript:alert(1)"])).is_err());
        assert!(url_or_empty(&json!("ftp://x")).is_err());
        assert!(check_limit(Rule::Min, &json!(12), &json!(11)).is_err());
        assert!(check_limit(Rule::Max, &json!(8), &json!(4)).is_ok());
        assert!(check_limit(Rule::Subset, &json!(["en"]), &json!(["it"])).is_err());
    }

    #[test]
    fn images_are_checked_from_their_bytes() {
        assert_eq!(sniff_image(b"\x89PNG\r\n\x1a\nxxxx", false).unwrap(), "image/png");
        assert_eq!(
            sniff_image(b"<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>", false).unwrap(),
            "image/svg+xml"
        );
        for bad in [
            "<svg><script>alert(1)</script></svg>",
            "<svg onload=\"alert(1)\"></svg>",
            "<svg><image href=\"https://evil.example/x.png\"/></svg>",
            "<svg><foreignObject></foreignObject></svg>",
        ] {
            assert_eq!(sniff_image(bad.as_bytes(), false).unwrap_err().code(), "image_unsafe", "{bad}");
        }
        assert_eq!(sniff_image(b"GIF89a", false).unwrap_err().code(), "image_type");
        assert_eq!(sniff_image(&[0, 0, 1, 0, 1], true).unwrap(), "image/x-icon");
        assert!(sniff_image(&[0, 0, 1, 0, 1], false).is_err());
        assert_eq!(sniff_image(&vec![b'a'; IMAGE_MAX + 1], false).unwrap_err().code(), "image_too_large");
    }
}
