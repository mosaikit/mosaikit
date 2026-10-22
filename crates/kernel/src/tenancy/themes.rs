//! Themes made with the theme editor of the shell, next to the built-in ones (Mosaikit, Italia, Tessera).
//!
//! The editor generates the CSS variables of a theme, light and dark, from a main colour, the style of
//! the top band and the greys; the kernel stores them as they come (with the choices, to edit them
//! again), after checking the names of the variables, the colours and the contrast of the pairs that
//! must read (WCAG 2.1 AA). The themes of the platform (Administrator) live in the settings of the
//! system tenant under `themes`; the ones of a tenant (Tenant Manager, when the theme is not locked) in
//! the settings of the tenant. `themes_allowed` (platform) lists the themes tenants may use; absent:
//! every theme. A tenant theme that is no longer allowed falls back to the one of the platform.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use super::require_admin;
use super::settings::{settings_of, system_settings, theme_locked, write_settings, DEFAULT_THEME};
use crate::{events, Caller, Error, Kernel, Result, SessionUser};

/// The themes every installation has (`data-preset` in the CSS of the shell).
pub const BUILT_IN: &[&str] = &["mosaikit", "italia", "tessera"];
/// Themes of the platform or of a tenant, at most.
const MAX_THEMES: usize = 20;

/// The variables a theme sets: the ones of the presets in the CSS of the shell.
pub const VARIABLES: &[&str] = &[
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--primary-strong",
    "--secondary",
    "--secondary-foreground",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--accent-foreground",
    "--destructive",
    "--border",
    "--input",
    "--ring",
    "--ok",
    "--warn",
    "--pane",
    "--band",
    "--band-foreground",
    "--band-muted",
    "--band-hover",
    "--band-line",
    "--search",
    "--search-foreground",
    "--sidebar",
    "--sidebar-foreground",
    "--sidebar-primary",
    "--sidebar-primary-foreground",
    "--sidebar-accent",
    "--sidebar-accent-foreground",
    "--sidebar-border",
    "--sidebar-ring",
    "--sidebar-hover",
    "--rail-foreground",
];

/// Pairs (text, background) that must read, with the minimum contrast: the ones the theme editor checks.
pub const CHECKS: &[(&str, &str, f64)] = &[
    ("--foreground", "--background", 4.5),
    ("--muted-foreground", "--background", 4.5),
    ("--primary", "--background", 4.5),
    ("--primary-foreground", "--primary", 4.5),
    ("--band-foreground", "--band", 4.5),
    ("--band-muted", "--band", 4.5),
    ("--search-foreground", "--search", 4.5),
    ("--sidebar-foreground", "--sidebar", 4.5),
    ("--sidebar-accent-foreground", "--sidebar-accent", 4.5),
    ("--rail-foreground", "--sidebar", 4.5),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    /// `platform` or `tenant`
    pub scope: String,
    /// the choices of the editor (main colour, band, greys, advanced), to edit the theme again
    #[serde(default)]
    pub input: Value,
    pub light: BTreeMap<String, String>,
    pub dark: BTreeMap<String, String>,
}

/// A theme to save: without `id` a new one.
#[derive(Debug, Clone, Deserialize)]
pub struct ThemeInput {
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub input: Value,
    pub light: BTreeMap<String, String>,
    pub dark: BTreeMap<String, String>,
}

fn is_color(v: &str) -> bool {
    let v = v.trim();
    if let Some(h) = v.strip_prefix('#') {
        return matches!(h.len(), 3 | 4 | 6 | 8) && h.bytes().all(|b| b.is_ascii_hexdigit());
    }
    let inner = v.strip_prefix("rgba(").or_else(|| v.strip_prefix("rgb(")).and_then(|r| r.strip_suffix(')'));
    inner.is_some_and(|i| {
        let parts: Vec<&str> = i.split(',').map(str::trim).collect();
        (3..=4).contains(&parts.len())
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.len() <= 8 && p.bytes().all(|b| b.is_ascii_digit() || b == b'.'))
    })
}

/// sRGB of `#rgb` / `#rrggbb` (alpha ignored), 0..1; `None` for other forms.
fn rgb(v: &str) -> Option<[f64; 3]> {
    let h = v.trim().strip_prefix('#')?;
    let full: String = match h.len() {
        3 | 4 => h.chars().take(3).flat_map(|c| [c, c]).collect(),
        6 | 8 => h[..6].to_string(),
        _ => return None,
    };
    let n = u32::from_str_radix(&full, 16).ok()?;
    Some([(n >> 16 & 255) as f64 / 255.0, (n >> 8 & 255) as f64 / 255.0, (n & 255) as f64 / 255.0])
}

fn luminance(c: [f64; 3]) -> f64 {
    let lin = |x: f64| if x <= 0.03928 { x / 12.92 } else { ((x + 0.055) / 1.055).powf(2.4) };
    0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
}

/// Contrast ratio of two colours (WCAG), when both are `#rrggbb`.
pub fn contrast(a: &str, b: &str) -> Option<f64> {
    let (la, lb) = (luminance(rgb(a)?), luminance(rgb(b)?));
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    Some((hi + 0.05) / (lo + 0.05))
}

/// The main button under the pointer: 12 % darker in light mode, 12 % lighter in dark mode (the hover of
/// the buttons of the shell, `components/ui/button.tsx`), as `#rrggbb`.
fn primary_hover(primary: &str, mode: &str) -> Option<String> {
    let c = rgb(primary)?;
    let to = if mode == "dark" { 1.0 } else { 0.0 };
    let m = |x: f64| ((x + (to - x) * 0.12) * 255.0).round().clamp(0.0, 255.0) as u8;
    Some(format!("#{:02x}{:02x}{:02x}", m(c[0]), m(c[1]), m(c[2])))
}

/// The checks that fail in a set of variables: `(text, background, mode, ratio)`; the main button is
/// checked also under the pointer.
pub fn failing(vars: &BTreeMap<String, String>, mode: &str) -> Vec<(String, String, String, f64)> {
    let mut out: Vec<(String, String, String, f64)> = CHECKS
        .iter()
        .filter_map(|(fg, bg, min)| {
            let r = contrast(vars.get(*fg)?, vars.get(*bg)?)?;
            (r + 1e-9 < *min)
                .then(|| (fg.to_string(), bg.to_string(), mode.to_string(), (r * 100.0).round() / 100.0))
        })
        .collect();
    let hover = vars.get("--primary").and_then(|p| primary_hover(p, mode));
    if let (Some(h), Some(fg)) = (hover, vars.get("--primary-foreground")) {
        if let Some(r) = contrast(fg, &h).filter(|r| r + 1e-9 < 4.5) {
            out.push((
                "--primary-foreground".into(),
                "--primary (hover)".into(),
                mode.into(),
                (r * 100.0).round() / 100.0,
            ));
        }
    }
    out
}

fn check(t: &ThemeInput) -> Result<()> {
    let name = t.name.trim();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(Error::bad("the name of the theme is required (at most 60 characters)"));
    }
    if t.input.to_string().len() > 4096 {
        return Err(Error::bad("invalid theme"));
    }
    for (mode, vars) in [("light", &t.light), ("dark", &t.dark)] {
        if vars.len() > VARIABLES.len() {
            return Err(Error::bad("too many variables"));
        }
        for (k, v) in vars {
            if !VARIABLES.contains(&k.as_str()) || !is_color(v) {
                return Err(Error::bad(format!("invalid variable of the theme: {k}")));
            }
        }
        for need in [
            "--background",
            "--foreground",
            "--primary",
            "--primary-foreground",
            "--band",
            "--band-foreground",
        ] {
            if !vars.contains_key(need) {
                return Err(Error::bad(format!("the {mode} variant lacks {need}")));
            }
        }
        if let Some((fg, bg, _, r)) = failing(vars, mode).into_iter().next() {
            return Err(Error::bad(format!("{fg} on {bg} ({mode}) has contrast {r}, below WCAG AA"))
                .with_code("theme_contrast"));
        }
    }
    Ok(())
}

fn themes_in(s: &Value) -> Vec<CustomTheme> {
    s.get("themes").cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

/// The themes of the platform.
pub async fn platform_themes(k: &Kernel) -> Result<Vec<CustomTheme>> {
    Ok(themes_in(&system_settings(k).await?))
}

/// The themes a tenant made itself.
pub async fn tenant_themes(k: &Kernel, tenant: Uuid) -> Result<Vec<CustomTheme>> {
    Ok(themes_in(&settings_of(k, tenant).await?))
}

/// The themes tenants may use (`None`: every one).
pub async fn allowed(k: &Kernel) -> Result<Option<Vec<String>>> {
    Ok(system_settings(k).await?.get("themes_allowed").cloned().and_then(|v| serde_json::from_value(v).ok()))
}

/// Whether a tenant may use the theme `id` (built-in or of the platform, when allowed; its own always).
pub(super) fn usable(system: &Value, tenant: &Value, id: &str) -> bool {
    if themes_in(tenant).iter().any(|t| t.id == id) {
        return true;
    }
    let exists = BUILT_IN.contains(&id) || themes_in(system).iter().any(|t| t.id == id);
    let platform = system.get("theme").and_then(Value::as_str).unwrap_or(DEFAULT_THEME);
    let allowed: Option<Vec<String>> =
        system.get("themes_allowed").cloned().and_then(|v| serde_json::from_value(v).ok());
    exists && (id == platform || allowed.is_none_or(|a| a.iter().any(|x| x == id)))
}

/// Whether the platform may use the theme `id` (built-in or of the platform).
pub(super) fn exists_for_platform(system: &Value, id: &str) -> bool {
    BUILT_IN.contains(&id) || themes_in(system).iter().any(|t| t.id == id)
}

/// The custom themes a tenant can see: its own and the allowed ones of the platform.
pub async fn for_tenant(k: &Kernel, tenant: Uuid) -> Result<Vec<CustomTheme>> {
    let system = system_settings(k).await?;
    let own = settings_of(k, tenant).await?;
    let mut out: Vec<CustomTheme> =
        themes_in(&system).into_iter().filter(|t| usable(&system, &own, &t.id)).collect();
    out.extend(themes_in(&own));
    Ok(out)
}

/// The themes the sign-in page may need before a session exists: every theme of the platform and the
/// themes of the tenants in use by an active tenant (colours only, nothing private).
pub async fn public(k: &Kernel) -> Result<Vec<CustomTheme>> {
    let system = system_settings(k).await?;
    let mut out = themes_in(&system);
    let rows: Vec<Value> = mosaikit_db::query_scalar(
        "select settings from core.tenants where status = 'active' and not is_system",
    )
    .fetch_all(&k.db)
    .await?;
    for s in rows {
        let Some(id) = s.get("theme").and_then(Value::as_str) else { continue };
        if let Some(t) = themes_in(&s).into_iter().find(|t| t.id == id) {
            out.push(t);
        }
    }
    Ok(out)
}

fn new_id() -> String {
    format!("c-{}", &Uuid::new_v4().simple().to_string()[..10])
}

fn upsert(list: &mut Vec<CustomTheme>, t: &ThemeInput, scope: &str) -> Result<CustomTheme> {
    check(t)?;
    let id = match &t.id {
        Some(id) => {
            if !list.iter().any(|x| &x.id == id) {
                return Err(Error::not_found("theme not found"));
            }
            id.clone()
        }
        None => {
            if list.len() >= MAX_THEMES {
                return Err(Error::bad(format!("at most {MAX_THEMES} themes")));
            }
            new_id()
        }
    };
    let theme = CustomTheme {
        id: id.clone(),
        name: t.name.trim().to_string(),
        scope: scope.into(),
        input: t.input.clone(),
        light: t.light.clone(),
        dark: t.dark.clone(),
    };
    match list.iter_mut().find(|x| x.id == id) {
        Some(x) => *x = theme.clone(),
        None => list.push(theme.clone()),
    }
    Ok(theme)
}

async fn write_system(k: &Kernel, s: Value) -> Result<()> {
    mosaikit_db::query("update core.tenants set settings = $1 where is_system")
        .bind(s)
        .execute(&k.db)
        .await?;
    Ok(())
}

/// Saves a theme of the platform (new or changed).
pub async fn save_platform(k: &Kernel, admin: &SessionUser, t: &ThemeInput) -> Result<CustomTheme> {
    require_admin(admin)?;
    let mut s = system_settings(k).await?;
    let mut list = themes_in(&s);
    let theme = upsert(&mut list, t, "platform")?;
    s["themes"] = serde_json::to_value(&list)?;
    write_system(k, s).await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        "platform.theme_saved",
        json!({ "id": theme.id, "name": theme.name }),
    )
    .await;
    Ok(theme)
}

/// Deletes a theme of the platform; not the one in use by the platform. Tenants using it fall back.
pub async fn delete_platform(k: &Kernel, admin: &SessionUser, id: &str) -> Result<()> {
    require_admin(admin)?;
    let mut s = system_settings(k).await?;
    if s.get("theme").and_then(Value::as_str) == Some(id) {
        return Err(Error::conflict("the theme is the one of the platform: choose another first")
            .with_code("theme_in_use"));
    }
    let mut list = themes_in(&s);
    let n = list.len();
    list.retain(|t| t.id != id);
    if list.len() == n {
        return Err(Error::not_found("theme not found"));
    }
    s["themes"] = serde_json::to_value(&list)?;
    if let Some(a) = s.get_mut("themes_allowed").and_then(Value::as_array_mut) {
        a.retain(|x| x.as_str() != Some(id));
    }
    write_system(k, s).await?;
    events::record(k, None, Some(admin.user_id), None, None, "platform.theme_deleted", json!({ "id": id }))
        .await;
    Ok(())
}

/// The themes tenants may use (`None`: every one); unknown ids are refused.
pub async fn set_allowed(k: &Kernel, admin: &SessionUser, ids: Option<Vec<String>>) -> Result<()> {
    require_admin(admin)?;
    let mut s = system_settings(k).await?;
    match ids {
        Some(ids) => {
            if let Some(bad) = ids.iter().find(|id| !exists_for_platform(&s, id)) {
                return Err(Error::bad(format!("unknown theme: {bad}")));
            }
            s["themes_allowed"] = json!(ids);
        }
        None => {
            if let Some(o) = s.as_object_mut() {
                o.remove("themes_allowed");
            }
        }
    }
    let allowed = s.get("themes_allowed").cloned();
    write_system(k, s).await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        "platform.themes_allowed",
        json!({ "allowed": allowed }),
    )
    .await;
    Ok(())
}

/// Saves a theme of the tenant (Tenant Manager, when the theme is not locked by the Administrator).
pub async fn save_tenant(k: &Kernel, c: &Caller, t: &ThemeInput) -> Result<CustomTheme> {
    c.require_manager()?;
    if theme_locked(&system_settings(k).await?) {
        return Err(Error::forbidden("managed by the Administrator").with_code("setting_locked"));
    }
    let mut s = settings_of(k, c.tenant.tenant_id).await?;
    let mut list = themes_in(&s);
    let theme = upsert(&mut list, t, "tenant")?;
    s["themes"] = serde_json::to_value(&list)?;
    write_settings(k, c.tenant.tenant_id, s).await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "tenant.theme_saved",
        json!({ "id": theme.id, "name": theme.name }),
    )
    .await;
    Ok(theme)
}

/// Deletes a theme of the tenant; if it was in use the tenant goes back to the platform's.
pub async fn delete_tenant(k: &Kernel, c: &Caller, id: &str) -> Result<()> {
    c.require_manager()?;
    let mut s = settings_of(k, c.tenant.tenant_id).await?;
    let mut list = themes_in(&s);
    let n = list.len();
    list.retain(|t| t.id != id);
    if list.len() == n {
        return Err(Error::not_found("theme not found"));
    }
    s["themes"] = serde_json::to_value(&list)?;
    if s.get("theme").and_then(Value::as_str) == Some(id) {
        if let Some(o) = s.as_object_mut() {
            o.remove("theme");
        }
    }
    write_settings(k, c.tenant.tenant_id, s).await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "tenant.theme_deleted",
        json!({ "id": id }),
    )
    .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_and_contrast() {
        assert!(
            is_color("#fff")
                && is_color("#5b5fc7")
                && is_color("rgba(255, 255, 255, .16)")
                && is_color("rgb(1,2,3)")
        );
        assert!(!is_color("red") && !is_color("#12345") && !is_color("url(x)") && !is_color("rgba(1,2)"));
        assert!((contrast("#000000", "#ffffff").unwrap() - 21.0).abs() < 0.01);
        assert!((contrast("#5b5fc7", "#ffffff").unwrap() - 5.38).abs() < 0.01);
        assert_eq!(contrast("rgba(0,0,0,1)", "#fff"), None);
    }

    #[test]
    fn checks_of_a_theme() {
        let vars = |fg: &str| -> BTreeMap<String, String> {
            [
                ("--background", "#ffffff"),
                ("--foreground", "#242424"),
                ("--primary", "#3d409e"),
                ("--primary-foreground", fg),
                ("--band", "#444791"),
                ("--band-foreground", "#ffffff"),
            ]
            .into_iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect()
        };
        let ok = ThemeInput {
            id: None,
            name: "Mine".into(),
            input: Value::Null,
            light: vars("#ffffff"),
            dark: vars("#ffffff"),
        };
        assert!(check(&ok).is_ok());
        let low = ThemeInput { light: vars("#8f93e0"), ..ok.clone() };
        assert_eq!(check(&low).unwrap_err().code, Some("theme_contrast"));
        let mut bad = ok.clone();
        bad.light.insert("--evil".into(), "#000".into());
        assert!(check(&bad).is_err());
        let mut inject = ok.clone();
        inject.dark.insert("--card".into(), "#000; } body { display:none".into());
        assert!(check(&inject).is_err());
    }
}
