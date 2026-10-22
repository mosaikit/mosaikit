//! Untrusted origin: UI of the plugins, contents through tickets, public links.
//!
//! Everything uploaded by users is served with CSP `sandbox`
//! (opaque origin): it cannot read storage or DOM of any other page.

use std::collections::HashMap;

use axum::extract::{Form, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use mosaikit_kernel::{content, crud, links, Kind};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::pages;
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/ui/{plugin}/", get(plugin_ui_root))
        .route("/ui/{plugin}/{*path}", get(plugin_ui))
        .route("/c/{ticket}/", get(ticket_root))
        .route("/c/{ticket}/{*path}", get(ticket_file))
        .route("/p/{token}", get(public_redirect))
        .route("/p/{token}/", get(public_root))
        .route("/p/{token}/api", get(public_api))
        .route("/p/{token}/unlock", post(public_unlock))
        .route("/p/{token}/f/{id}/{name}", get(public_child_file))
        .route("/p/{token}/d/{id}/", get(public_child_folder))
        .route("/p/{token}/{*path}", get(public_path))
        .fallback(|| async { (StatusCode::NOT_FOUND, "not found") })
}

fn set(res: &mut Response, name: header::HeaderName, value: &str) {
    if let Ok(v) = HeaderValue::from_str(value) {
        res.headers_mut().insert(name, v);
    }
}

fn mime(path: &str) -> String {
    mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string()
}

// ------------------------------------------------------------------ UI of the plugins

fn plugin_csp(s: &AppState, p: &mosaikit_kernel::plugins::LoadedPlugin) -> String {
    let net = p.manifest.permissions.network.join(" ");
    let frames = p.manifest.permissions.frame_src.join(" ");
    format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
         img-src 'self' data: blob: {net} {frames}; font-src 'self' data:; media-src 'self' data: blob:; \
         connect-src 'self' {net}; frame-src 'self' blob: {frames}; worker-src 'self' blob:; \
         frame-ancestors {} {}; object-src 'none'; base-uri 'self'; form-action 'self'",
        s.k.cfg.app_origin(),
        s.k.cfg.public_origin()
    )
}

async fn plugin_ui_root(s: State<AppState>, Path(plugin): Path<String>) -> Response {
    plugin_ui(s, Path((plugin, String::new()))).await
}

async fn plugin_ui(State(s): State<AppState>, Path((plugin, path)): Path<(String, String)>) -> Response {
    let Ok(p) = s.k.plugins.active(&plugin) else {
        return (StatusCode::NOT_FOUND, "plugin not active").into_response();
    };
    let (Some(dir), Some(ui)) = (p.ui_dir.clone(), p.manifest.ui.clone()) else {
        return (StatusCode::NOT_FOUND, "the plugin has no UI").into_response();
    };
    let rel = if path.is_empty() { ui.entry.clone() } else { path };
    if !mosaikit_mskp::is_safe_path(&rel) {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    let file = dir.join(&rel);
    let Ok(data) = tokio::fs::read(&file).await else {
        let hint = if p.dev { " (in development: run the build of the UI of the plugin)" } else { "" };
        return (StatusCode::NOT_FOUND, format!("file of the UI not found: {rel}{hint}")).into_response();
    };
    let mut res = data.into_response();
    set(&mut res, header::CONTENT_TYPE, &mime(&rel));
    set(&mut res, header::CONTENT_SECURITY_POLICY, &plugin_csp(&s, &p));
    let cache = if p.dev || rel.ends_with(".html") { "no-cache" } else { "public, max-age=300" };
    set(&mut res, header::CACHE_CONTROL, cache);
    // the tab of an extension runs in a frame without an origin of its own (sandbox without
    // allow-same-origin): its module scripts are fetched with CORS. The files of a UI are public anyway.
    set(&mut res, header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    res
}

// ------------------------------------------------------------------ user contents

/// Content uploaded by a user: opaque origin, no sniffing, no referrer.
fn user_content(
    data: Vec<u8>,
    name: &str,
    allow_scripts: bool,
    download: bool,
    frame_ancestors: &str,
) -> Response {
    let mut res = data.into_response();
    let sandbox = if allow_scripts {
        "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads"
    } else {
        "sandbox allow-downloads"
    };
    set(&mut res, header::CONTENT_SECURITY_POLICY, &format!("{sandbox}; frame-ancestors {frame_ancestors}"));
    set(&mut res, header::REFERRER_POLICY, "no-referrer");
    set(&mut res, header::CACHE_CONTROL, "no-cache");
    if download {
        set(&mut res, header::CONTENT_TYPE, "application/octet-stream");
        let safe: String = name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || ".-_ ".contains(c) { c } else { '_' })
            .collect();
        set(&mut res, header::CONTENT_DISPOSITION, &format!("attachment; filename=\"{safe}\""));
    } else {
        set(&mut res, header::CONTENT_TYPE, &mime(name));
    }
    res
}

fn ancestors(s: &AppState) -> String {
    format!("'self' {} {}", s.k.cfg.app_origin(), s.k.cfg.plugin_origin())
}

/// Who may embed the public pages of a tenant: the sites the tenant (within the platform's) allows,
/// besides the origins of Mosaikit for the static sites; nobody else.
async fn embedders(s: &AppState, tenant: Uuid, own: bool) -> String {
    let sites = mosaikit_kernel::tenancy::levels::embed_sites(&s.k, tenant).await.unwrap_or_default();
    let mut list: Vec<String> = if own { vec![ancestors(s)] } else { Vec::new() };
    list.extend(sites);
    if list.is_empty() {
        "'none'".to_string()
    } else {
        list.join(" ")
    }
}

/// The CSP of a page with `frame-ancestors 'none'` opened to the sites of the tenant.
fn embeddable(csp: &str, ancestors: &str) -> String {
    csp.replace("frame-ancestors 'none'", &format!("frame-ancestors {ancestors}"))
}

async fn serve_site(s: &AppState, tenant: Uuid, rid: Uuid, rel: &str, base: &str, entry: &str) -> Response {
    let fa = embedders(s, tenant, true).await;
    let rel = if rel.is_empty() { entry } else { rel };
    let site = s.k.blobs.site_dir(tenant, rid);
    // folder without trailing "/": relative URLs would resolve badly
    if !rel.is_empty() && !rel.ends_with('/') && mosaikit_mskp::is_safe_path(rel) && site.join(rel).is_dir() {
        return Redirect::permanent(&format!("{base}{rel}/")).into_response();
    }
    match s.k.blobs.site_file(tenant, rid, rel) {
        Some(path) => match tokio::fs::read(&path).await {
            Ok(data) => user_content(data, &path.to_string_lossy(), true, false, &fa),
            Err(_) => (StatusCode::NOT_FOUND, "not found").into_response(),
        },
        None => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

async fn ticket_root(
    s: State<AppState>,
    Path(ticket): Path<String>,
    q: Query<HashMap<String, String>>,
) -> Response {
    ticket_file(s, Path((ticket, String::new())), q).await
}

async fn ticket_file(
    State(s): State<AppState>,
    Path((ticket, path)): Path<(String, String)>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let t = match content::resolve_ticket(&s.k, &ticket).await {
        Ok(t) => t,
        Err(e) => return (StatusCode::FORBIDDEN, e.message).into_response(),
    };
    if t.kind == "file" {
        let Ok(data) = s.k.blobs.read_file(t.tenant, t.resource) else {
            return (StatusCode::NOT_FOUND, "missing file").into_response();
        };
        let download = t.download || q.contains_key("download");
        return user_content(data, &t.title, false, download, &ancestors(&s));
    }
    let entry = site_entry(&s, t.resource).await;
    serve_site(&s, t.tenant, t.resource, &path, &format!("{}/c/{ticket}/", s.k.cfg.plugin_base_path), &entry)
        .await
}

async fn site_entry(s: &AppState, rid: Uuid) -> String {
    let meta: Option<Value> = mosaikit_db::query_scalar("select meta from core.resources where id = $1")
        .bind(rid)
        .fetch_optional(&s.k.db)
        .await
        .ok()
        .flatten();
    meta.and_then(|m| m.pointer("/content/entry").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default()
}

// ------------------------------------------------------------------ public links

fn html(body: String, csp: &str) -> Response {
    let mut res = Html(body).into_response();
    set(&mut res, header::CONTENT_SECURITY_POLICY, csp);
    set(&mut res, header::REFERRER_POLICY, "no-referrer");
    set(&mut res, header::CACHE_CONTROL, "no-store");
    res
}

const PAGE_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

fn not_found_page() -> Response {
    let mut res = html(pages::not_found(), PAGE_CSP);
    *res.status_mut() = StatusCode::NOT_FOUND;
    res
}

fn unlock_cookie_name(r: &links::Resolved) -> String {
    format!("msk_link_{}", &r.link_id.simple().to_string()[..12])
}

fn unlocked(s: &AppState, headers: &HeaderMap, r: &links::Resolved) -> bool {
    if r.password_hash.is_none() {
        return true;
    }
    let want = links::unlock_cookie_value(&s.k, r);
    let name = unlock_cookie_name(r);
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|kv| kv.trim().split_once('='))
        .any(|(k, v)| k == name && v == want)
}

/// Resolves the link and checks the unlocking; otherwise the response to give.
async fn open(s: &AppState, token: &str, headers: &HeaderMap) -> Result<links::Resolved, Box<Response>> {
    let r = links::resolve(&s.k, token).await.map_err(|_| Box::new(not_found_page()))?;
    if !unlocked(s, headers, &r) {
        return Err(Box::new(html(pages::password(&r.title, false), PAGE_CSP)));
    }
    Ok(r)
}

async fn public_redirect(State(s): State<AppState>, Path(token): Path<String>) -> Redirect {
    Redirect::permanent(&format!("{}/p/{token}/", s.k.cfg.plugin_base_path))
}

async fn public_root(s: State<AppState>, Path(token): Path<String>, headers: HeaderMap) -> Response {
    public_path(s, Path((token, String::new())), headers).await
}

async fn public_path(
    State(s): State<AppState>,
    Path((token, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let r = match open(&s, &token, &headers).await {
        Ok(r) => r,
        Err(res) => return *res,
    };
    if path.is_empty() {
        links::count_view(&s.k, &r).await;
    }
    let base = format!("{}/p/{token}/", s.k.cfg.plugin_base_path);
    let fa = embedders(&s, r.tenant, false).await;
    // static site
    if let Some(entry) = r.meta.pointer("/content/entry").and_then(Value::as_str) {
        return serve_site(&s, r.tenant, r.resource, &path, &base, entry).await;
    }
    if !path.is_empty() {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    }
    match r.kind.as_str() {
        "file" => match s.k.blobs.read_file(r.tenant, r.resource) {
            Ok(data) => user_content(data, &r.title, false, false, &fa),
            Err(_) => not_found_page(),
        },
        "folder" => with_ancestors(folder_page(&s, &r, r.resource, &r.title, &token).await, &fa),
        _ => {
            let Ok(p) = s.k.plugins.active(&r.plugin_id) else { return not_found_page() };
            if let Some(view) =
                p.manifest.ui.as_ref().and_then(|u| u.public_view.clone()).filter(|_| p.ui_dir.is_some())
            {
                let nonce = hex::encode(rand::random::<[u8; 16]>());
                let src = format!(
                    "{}/ui/{}/{}?mode=public&host={}",
                    s.k.cfg.plugin_url,
                    p.id,
                    view,
                    urlenc(&s.k.cfg.public_origin())
                );
                let csp = format!(
                    "default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; connect-src 'self'; \
                     frame-src {}; frame-ancestors 'none'; base-uri 'none'",
                    s.k.cfg.plugin_origin()
                );
                return html(
                    pages::viewer(&r.title, &src, &s.k.cfg.plugin_origin(), &nonce),
                    &embeddable(&csp, &fa),
                );
            }
            match public_values(&s, &r, &crate::api::request_lang(&headers)).await {
                Some((label, fields)) => {
                    html(pages::record(&r.title, &label, &fields), &embeddable(PAGE_CSP, &fa))
                }
                None => not_found_page(),
            }
        }
    }
}

fn urlenc(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// Visible (not hidden) fields of a CRUD record reached through a link, with the texts of the
/// plugin in the language of the visitor.
async fn public_values(
    s: &AppState,
    r: &links::Resolved,
    lang: &str,
) -> Option<(String, Vec<(String, String)>)> {
    let p = s.k.plugins.active(&r.plugin_id).ok()?;
    let manifest = p.manifest.localized(lang);
    let decl = manifest.resource(&r.kind)?;
    let row = crud::get_ctx(&s.k, &r.ctx(), &p, &r.kind, r.resource).await.ok()?;
    let fields = decl
        .fields
        .iter()
        .filter(|f| !f.hidden)
        .map(|f| {
            let v = &row["values"][&f.key];
            let text = match v {
                Value::Null => String::new(),
                Value::Bool(b) => {
                    if *b {
                        "yes".into()
                    } else {
                        "no".into()
                    }
                }
                Value::String(s) => f.option_labels.get(s).cloned().unwrap_or_else(|| s.clone()),
                o => o.to_string(),
            };
            (if f.label.is_empty() { f.key.clone() } else { f.label.clone() }, text)
        })
        .collect();
    Some((manifest.contribution.label.clone(), fields))
}

async fn folder_page(s: &AppState, r: &links::Resolved, folder: Uuid, title: &str, token: &str) -> Response {
    match links::children(&s.k, r, folder).await {
        Ok(items) => {
            let rows: Vec<(String, String, String, i64)> = items
                .into_iter()
                .map(|(id, kind, name, size)| {
                    let href = if kind == "folder" {
                        format!("{}/p/{token}/d/{id}/", s.k.cfg.plugin_base_path)
                    } else {
                        format!("{}/p/{token}/f/{id}/{}", s.k.cfg.plugin_base_path, urlenc(&name))
                    };
                    (href, name, kind, size)
                })
                .collect();
            html(pages::folder(title, &rows), PAGE_CSP)
        }
        Err(_) => not_found_page(),
    }
}

async fn child(s: &AppState, r: &links::Resolved, id: &str) -> Option<(Uuid, String, String)> {
    let id: Uuid = id.parse().ok()?;
    if !links::covers(&s.k, r, id).await.ok()? {
        return None;
    }
    let row = mosaikit_db::query("select kind, title from core.resources where id = $1")
        .bind(id)
        .fetch_optional(&s.k.db)
        .await
        .ok()??;
    Some((id, row.try_get(0).ok()?, row.try_get(1).ok()?))
}

async fn public_child_file(
    State(s): State<AppState>,
    Path((token, id, _name)): Path<(String, String, String)>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let r = match open(&s, &token, &headers).await {
        Ok(r) => r,
        Err(res) => return *res,
    };
    match child(&s, &r, &id).await {
        Some((rid, kind, title)) if kind == "file" => match s.k.blobs.read_file(r.tenant, rid) {
            Ok(data) => user_content(data, &title, false, q.contains_key("download"), "'none'"),
            Err(_) => not_found_page(),
        },
        _ => not_found_page(),
    }
}

async fn public_child_folder(
    State(s): State<AppState>,
    Path((token, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    let r = match open(&s, &token, &headers).await {
        Ok(r) => r,
        Err(res) => return *res,
    };
    match child(&s, &r, &id).await {
        Some((rid, kind, title)) if kind == "folder" => folder_page(&s, &r, rid, &title, &token).await,
        _ => not_found_page(),
    }
}

async fn public_api(State(s): State<AppState>, Path(token): Path<String>, headers: HeaderMap) -> Response {
    let r = match open(&s, &token, &headers).await {
        Ok(r) => r,
        Err(_) => return (StatusCode::NOT_FOUND, Json(json!({ "error": "invalid link" }))).into_response(),
    };
    let Ok(p) = s.k.plugins.active(&r.plugin_id) else {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "plugin not active" }))).into_response();
    };
    let values = if p.manifest.resource(&r.kind).is_some() {
        match crud::get_ctx(&s.k, &r.ctx(), &p, &r.kind, r.resource).await {
            Ok(row) => row["values"].clone(),
            Err(e) if e.kind == Kind::NotFound => Value::Null,
            Err(e) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": e.message }))).into_response(),
        }
    } else {
        Value::Null
    };
    let mut res = Json(json!({
        "plugin": p.id, "plugin_label": p.manifest.contribution.label, "id": r.resource,
        "kind": r.kind, "title": r.title, "values": values,
    }))
    .into_response();
    set(&mut res, header::CACHE_CONTROL, "no-store");
    res
}

#[derive(Deserialize)]
struct UnlockForm {
    password: String,
}

async fn public_unlock(
    State(s): State<AppState>,
    Path(token): Path<String>,
    Form(f): Form<UnlockForm>,
) -> Response {
    let Ok(r) = links::resolve(&s.k, &token).await else { return not_found_page() };
    match links::check_password(&s.k, &r, &f.password).await {
        Ok(true) => {
            let secure = if s.k.cfg.public_url.starts_with("https://") { "; Secure" } else { "" };
            let mut res = Redirect::to(&format!("{}/p/{token}/", s.k.cfg.plugin_base_path)).into_response();
            set(
                &mut res,
                header::SET_COOKIE,
                &format!(
                    "{}={}; HttpOnly; SameSite=Lax; Path={}/p/{token}/; Max-Age=86400{secure}",
                    unlock_cookie_name(&r),
                    links::unlock_cookie_value(&s.k, &r),
                    s.k.cfg.plugin_base_path
                ),
            );
            res
        }
        _ => {
            let mut res = html(pages::password(&r.title, true), PAGE_CSP);
            *res.status_mut() = StatusCode::UNAUTHORIZED;
            res
        }
    }
}

/// The CSP of a response opened to the sites that may embed it.
fn with_ancestors(mut res: Response, ancestors: &str) -> Response {
    let csp =
        res.headers().get(header::CONTENT_SECURITY_POLICY).and_then(|v| v.to_str().ok()).map(str::to_owned);
    if let Some(csp) = csp {
        set(&mut res, header::CONTENT_SECURITY_POLICY, &embeddable(&csp, ancestors));
    }
    res
}
