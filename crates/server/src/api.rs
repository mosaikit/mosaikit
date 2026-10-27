//! REST API of the app origin.

use std::collections::HashMap;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use futures_util::StreamExt;
use mosaikit_kernel::acl::{self, Level, ResourceFilter};
use mosaikit_kernel::tenancy::keys::{self, Level as KeyLevel};
use mosaikit_kernel::tenancy::{self, levels, NewTenant};
use mosaikit_kernel::{
    content, crud, files, identity, kpi, links, mail, notify, plugins, Error, Role, TenantSettings,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::auth::{session_cookie, Auth, ClientIp, Pending, Tenant};
use crate::{bad, ApiResult, AppState};

const UPLOAD_LIMIT: usize = 512 << 20;
const PACKAGE_LIMIT: usize = 64 << 20;

pub fn router() -> Router<AppState> {
    let uploads = Router::new()
        .route("/api/t/{t}/p/{plugin}/files/upload", post(files_upload))
        .route("/api/t/{t}/p/{plugin}/content/{id}", post(content_upload))
        .layer(DefaultBodyLimit::max(UPLOAD_LIMIT));
    let packages = Router::new()
        .route("/api/admin/plugins", get(admin_plugins).post(admin_install))
        .layer(DefaultBodyLimit::max(PACKAGE_LIMIT));
    Router::new()
        .route("/api/health", get(health))
        .route("/api/brand", get(brand))
        .route("/api/auth/login", post(login))
        .route("/api/auth/tenants", get(login_tenants))
        .route("/api/auth/tenants/{slug}/logo/{slot}", get(tenant_logo))
        // layouts: the list (signed in), the stylesheet and the images of a layout plugin (public, they
        // hold nothing of a tenant)
        .route("/api/layouts", get(layouts_list))
        .route("/api/layouts/{id}/layout.css", get(layout_css))
        .route("/api/layouts/{id}/images/{name}", get(layout_image))
        .route("/api/auth/admin/login", post(admin_login))
        .route("/api/auth/totp/setup", post(totp_setup))
        .route("/api/auth/totp/enable", post(totp_enable))
        .route("/api/auth/totp/verify", post(totp_verify))
        .route("/api/auth/logout", post(logout))
        .route("/api/session", get(session))
        .route("/api/me/password", post(change_password))
        .route("/api/me/profile", put(my_set_profile))
        .route("/api/me/picture", put(my_set_picture).delete(my_remove_picture))
        .route("/api/people/{id}/picture", get(person_picture))
        .route("/api/me/invitations", get(my_invitations))
        .route("/api/me/invitations/{id}/{answer}", post(answer_invitation))
        .route("/api/dev/events", get(dev_events))
        .route("/api/me/stream", get(my_stream))
        .route("/api/me/notifications", get(my_notifications))
        .route("/api/me/notifications/count", get(my_unread))
        .route("/api/me/notifications/read", post(my_mark_read))
        .route("/api/me/notifications/read-all", post(my_mark_all_read))
        .route("/api/me/notifications/delete", post(my_delete_notifications))
        .route("/api/me/notifications/prefs", get(my_note_prefs).put(my_set_note_prefs))
        .route("/api/t/{t}/p/{plugin}/notify", post(plugin_notify))
        .route("/api/admin/email", get(a_email).put(a_set_email))
        .route("/api/admin/email/test", post(a_email_test))
        // tenant
        .route("/api/t/{t}/context", get(context))
        .route("/api/t/{t}/overview", get(overview))
        .route("/api/t/{t}/prefs", put(set_prefs))
        .route("/api/t/{t}/directory", get(directory))
        .route("/api/t/{t}/resources/{rid}", get(resource_meta))
        .route("/api/t/{t}/resources/{rid}/grants", get(resource_grants).put(resource_set_grant))
        .route("/api/t/{t}/resources/{rid}/owner", post(resource_owner))
        .route("/api/t/{t}/resources/{rid}/links", get(resource_links).post(resource_link_create))
        .route("/api/t/{t}/links/{id}", delete(link_revoke))
        // operations of the plugins (always limited to the plugin of the path)
        .route("/api/t/{t}/p/{plugin}/r/{res}", get(crud_list).post(crud_create))
        .route("/api/t/{t}/p/{plugin}/r/{res}/{id}", get(crud_get).put(crud_update).delete(crud_delete))
        .route("/api/t/{t}/p/{plugin}/call/{name}", post(plugin_call))
        .route("/api/t/{t}/p/{plugin}/files", get(files_list))
        .route("/api/t/{t}/p/{plugin}/files/folder", post(files_mkdir))
        .route("/api/t/{t}/p/{plugin}/files/{id}/content", get(files_content))
        .route("/api/t/{t}/p/{plugin}/files/{id}/zip", get(files_zip))
        .route("/api/t/{t}/p/{plugin}/files/{id}/rename", post(files_rename))
        .route("/api/t/{t}/p/{plugin}/files/{id}/move", post(files_move))
        .route("/api/t/{t}/p/{plugin}/files/{id}/copy", post(files_copy))
        .route("/api/t/{t}/p/{plugin}/files/{id}", delete(files_delete))
        .route("/api/t/{t}/p/{plugin}/ticket/{id}", post(ticket))
        // manager of the tenant
        .route("/api/t/{t}/manage/members", get(m_members).post(m_create_member))
        .route("/api/t/{t}/manage/members/{uid}", get(crate::people_api::m_member).delete(m_remove_member))
        .route("/api/t/{t}/manage/members/{uid}/role", put(m_set_role))
        .route("/api/t/{t}/manage/members/{uid}/password", post(m_reset_password))
        .route("/api/t/{t}/manage/invitations", get(m_invitations).post(m_invite))
        .route("/api/t/{t}/manage/invitations/{id}", delete(m_revoke_invitation))
        .route("/api/t/{t}/manage/groups", get(m_groups).post(m_create_group))
        .route("/api/t/{t}/manage/groups/{gid}", get(crate::people_api::m_group).delete(m_delete_group))
        .route("/api/t/{t}/manage/groups/{gid}/members/{uid}", put(m_group_add).delete(m_group_remove))
        .route("/api/t/{t}/manage/resources", get(m_resources))
        .route("/api/t/{t}/manage/resources/reassign", post(m_reassign))
        .route("/api/t/{t}/manage/settings", get(m_settings).put(m_set_settings))
        .route("/api/t/{t}/manage/theme", put(m_set_theme))
        .route("/api/t/{t}/manage/config", get(m_config).put(m_set_config))
        .route("/api/t/{t}/manage/identity/{slot}", put(m_set_image).delete(m_remove_image))
        .route("/api/t/{t}/manage/keys", get(m_keys))
        .route("/api/t/{t}/manage/keys/{service}", put(m_set_key).delete(m_remove_key))
        .route("/api/t/{t}/me/keys", get(my_keys))
        .route("/api/t/{t}/me/keys/{service}", put(my_set_key).delete(my_remove_key))
        .route("/api/t/{t}/manage/kpi", get(m_kpi))
        // system administrator
        .route("/api/admin/tenants", get(a_tenants).post(a_create_tenant))
        .route("/api/admin/tenants/{id}/status", put(a_tenant_status))
        .route("/api/admin/tenants/{id}/members", get(a_tenant_members))
        .route("/api/admin/tenants/{id}/managers", post(a_tenant_manager))
        .route("/api/admin/tenants/{id}/members/{uid}/role", put(a_tenant_role))
        .route("/api/admin/tenants/{id}/members/{uid}/password", post(a_tenant_password))
        .route("/api/admin/overview", get(a_overview))
        .route("/api/admin/plugins/{id}/{action}", post(a_plugin_action))
        .route("/api/admin/plugins/{id}", delete(a_plugin_uninstall))
        .route("/api/admin/catalog", get(a_catalog))
        .route("/api/admin/catalog/{id}/install", post(a_catalog_install))
        .route("/api/admin/kpi", get(a_kpi))
        .route("/api/admin/administrators", get(a_admins).post(a_create_admin))
        .route("/api/admin/administrators/{id}/status", put(a_admin_status))
        .route("/api/admin/administrators/{id}/password", post(a_admin_password))
        .route("/api/admin/administrators/{id}/totp", delete(a_admin_totp))
        .route("/api/admin/band", put(a_set_band))
        .route("/api/admin/settings", get(a_settings).put(a_set_settings))
        .route("/api/admin/identity/{slot}", put(a_set_image).delete(a_remove_image))
        .route("/api/admin/keys", get(a_keys))
        .route("/api/admin/keys/{service}", put(a_set_key).delete(a_remove_key))
        .route("/api/admin/theme", put(a_set_theme))
        .route("/api/{*rest}", axum::routing::any(api_not_found))
        .merge(crate::people_api::router())
        .merge(crate::quotas_api::router())
        .merge(crate::qa_api::router())
        .merge(crate::plugins_api::router())
        .merge(crate::history_api::router())
        .merge(crate::ops_api::router())
        .merge(crate::shell_api::router())
        .merge(uploads)
        .merge(packages)
        .layer(DefaultBodyLimit::max(16 << 20))
}

async fn api_not_found() -> ApiResult<()> {
    Err(Error::not_found("unknown API").into())
}

pub(crate) fn uuid(s: &str) -> ApiResult<Uuid> {
    s.parse().map_err(|_| bad(format!("invalid id: {s}")))
}

pub(crate) fn ok() -> Json<Value> {
    Json(json!({ "ok": true }))
}

// ------------------------------------------------------------------ authentication

async fn health(State(s): State<AppState>) -> Json<Value> {
    Json(json!({ "ok": true, "version": mosaikit_kernel::KERNEL_VERSION, "dev": s.k.cfg.dev.enabled }))
}

/// Brand of the product, with the identity, the theme, the top bar and the languages of the platform:
/// public, so the sign-in page has them before a session exists.
async fn brand(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    let mut b = s.k.brand.public();
    let v = levels::effective(&s.k, None).await?;
    let text = |key: &str| v.get(key).cloned().unwrap_or(Value::Null);
    if let Some(o) = b.as_object_mut() {
        o.insert("theme".into(), json!(tenancy::platform_theme(&s.k).await?));
        o.insert("band".into(), json!(tenancy::shell_band(&s.k).await?));
        o.insert("name".into(), text("identity.name"));
        let uploaded = |key: &str| v.get(key).is_some_and(|x| !x.is_null());
        o.insert("logo".into(), json!(s.k.brand.logo.is_some() || uploaded("identity.logo_light")));
        o.insert("logo_dark".into(), json!(uploaded("identity.logo_dark")));
        o.insert("icon".into(), json!(s.k.brand.favicon.is_some() || uploaded("identity.icon")));
        o.insert("welcome".into(), text("identity.welcome"));
        if v.get("identity.footer").and_then(Value::as_str).is_some_and(|f| !f.is_empty()) {
            o.insert("footer".into(), text("identity.footer"));
        }
        o.insert("privacy_url".into(), text("identity.privacy_url"));
        // the notice of the maintenance, for everybody (also before signing in)
        let m = mosaikit_kernel::ops::maintenance::get(&s.k).await?;
        o.insert(
            "maintenance".into(),
            json!({ "on": m.on, "message": m.message, "planned_at": m.planned_at, "planned_message": m.planned_message }),
        );
        o.insert("legal_url".into(), text("identity.legal_url"));
        o.insert("languages".into(), text("lang.enabled"));
        o.insert("language".into(), text("lang.default"));
        o.insert("locale".into(), text("format.locale"));
        o.insert("mode".into(), text("appearance.mode"));
        // the style of the platform (the sign-in page follows it) and its band image, with its scrim
        let style: serde_json::Map<String, Value> = ["radius", "density", "font", "tabs", "buttons"]
            .iter()
            .map(|k| (k.to_string(), text(&format!("style.{k}"))))
            .collect();
        o.insert("style".into(), Value::Object(style));
        o.insert("band_image".into(), text("style.band_image"));
        o.insert("layout".into(), json!(tenancy::layouts::in_use(&s.k, None).await?));
    }
    Ok(Json(b))
}

/// The layouts of the installation, the ones tenants may choose and the one of the platform.
async fn layouts_list(State(s): State<AppState>, Auth(_u): Auth, h: HeaderMap) -> ApiResult<Json<Value>> {
    let platform = levels::effective(&s.k, None).await?;
    Ok(Json(json!({
        "layouts": tenancy::layouts::list(&s.k, &request_lang(&h)),
        "allowed": tenancy::layouts::allowed_in(&platform),
        "platform": tenancy::layouts::in_use(&s.k, None).await?,
    })))
}

/// The checked stylesheet of a layout plugin (scoped under the class of the layout).
async fn layout_css(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    let css = tenancy::layouts::css(&s.k, &id).ok_or_else(|| Error::not_found("no stylesheet"))?;
    let mut res = css.into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/css; charset=utf-8"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=300"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    Ok(res)
}

/// An image of a layout plugin.
async fn layout_image(
    State(s): State<AppState>,
    Path((id, name)): Path<(String, String)>,
) -> ApiResult<Response> {
    let (data, mime) =
        tenancy::layouts::image(&s.k, &id, &name).ok_or_else(|| Error::not_found("no image"))?;
    Ok(image_response(data, mime))
}

/// Logo of a tenant for its sign-in page (public, only active tenants).
async fn tenant_logo(
    State(s): State<AppState>,
    Path((slug, slot)): Path<(String, String)>,
) -> ApiResult<Response> {
    let id: Option<Uuid> = mosaikit_db::query_scalar(
        "select id from core.tenants where slug = $1 and status = 'active' and not is_system",
    )
    .bind(&slug)
    .fetch_optional(&s.k.db)
    .await
    .map_err(Error::from)?;
    let Some(id) = id else { return Err(Error::not_found("tenant not found").into()) };
    match levels::image(&s.k, Some(id), &slot).await? {
        Some((data, mime)) => Ok(image_response(data, &mime)),
        None => Err(Error::not_found("no logo").into()),
    }
}

/// An image of the identity: it runs nothing (an SVG may not run scripts) and is not sniffed.
pub fn image_response(data: Vec<u8>, mime: &str) -> Response {
    let mut res = data.into_response();
    let h = res.headers_mut();
    if let Ok(v) = HeaderValue::from_str(mime) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=300"));
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );
    res
}

#[derive(Deserialize)]
struct LoginReq {
    tenant: String,
    username: String,
    password: String,
    /// "remember me": the session lasts the days the tenant allows
    #[serde(default)]
    remember: bool,
}

async fn session_body(s: &AppState, user: &mosaikit_kernel::SessionUser) -> ApiResult<Value> {
    Ok(json!({
        "user": user,
        "csrf": user.csrf,
        // signs in through the identity provider of the home tenant (no local password)
        "external": mosaikit_kernel::oidc::is_external(&s.k, user.user_id).await?,
        // version of the picture of Account › Profile (none: the initials)
        "picture": tenancy::profile::picture_version(&s.k, user.user_id).await?,
        "memberships": identity::memberships(&s.k, user).await?,
        "invitations": tenancy::my_invitations(&s.k, user).await?.len(),
        "plugin_origin": s.k.cfg.plugin_origin(),
        "plugin_url": s.k.cfg.plugin_url,
        "public_origin": s.k.cfg.public_origin(),
        "dev": s.k.cfg.dev.enabled,
        "band": tenancy::shell_band(&s.k).await?,
        "theme": tenancy::platform_theme(&s.k).await?,
        // themes made with the theme editor (platform) and the ones tenants may use
        "themes": tenancy::themes::platform_themes(&s.k).await?,
        "themes_allowed": tenancy::themes::allowed(&s.k).await?,
        // preferences that follow the person everywhere (high contrast, guided tours seen)
        "me": mosaikit_kernel::personal::get(&s.k, user.user_id).await?,
        // settings in use for the home tenant of the person (the platform's for the Administrator)
        "config": levels::effective(&s.k, (!user.is_system_admin).then_some(user.home_tenant_id)).await?,
    }))
}

async fn login(
    State(s): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(r): Json<LoginReq>,
) -> ApiResult<Response> {
    // during maintenance only the Administrators sign in (through their own door)
    mosaikit_kernel::ops::maintenance::check(&s.k, None).await?;
    let lr = identity::login_remembered(&s.k, &r.tenant, &r.username, &r.password, &ip, r.remember).await?;
    logged_in(&s, lr, json!({})).await
}

/// Response of a completed sign-in: session + cookie (`extra` added to the body).
async fn logged_in(s: &AppState, lr: identity::LoginResult, extra: Value) -> ApiResult<Response> {
    let mut body = session_body(s, &lr.user).await?;
    if let (Some(b), Value::Object(e)) = (body.as_object_mut(), extra) {
        b.extend(e);
    }
    let mut res = Json(body).into_response();
    res.headers_mut().insert(header::SET_COOKIE, session_cookie(s, Some((&lr.token, lr.max_age))));
    Ok(res)
}

/// Tenants of the sign-in page (public).
async fn login_tenants(State(s): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::login_tenants(&s.k).await?)))
}

#[derive(Deserialize)]
struct AdminLoginReq {
    username: String,
    password: String,
}

/// Sign-in of the Administrators: full session, or `{ pending, csrf }` waiting
/// for the second factor (`totp` or `totp_setup`).
async fn admin_login(
    State(s): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(r): Json<AdminLoginReq>,
) -> ApiResult<Response> {
    match identity::admin_login(&s.k, &r.username, &r.password, &ip).await? {
        identity::AdminLogin::Done(lr) => logged_in(&s, lr, json!({})).await,
        identity::AdminLogin::Pending { token, csrf, step } => {
            let mut res = Json(json!({ "pending": step, "csrf": csrf })).into_response();
            // waiting for the second factor: the session lasts a few minutes
            res.headers_mut().insert(header::SET_COOKIE, session_cookie(&s, Some((&token, 600))));
            Ok(res)
        }
    }
}

async fn totp_setup(State(s): State<AppState>, Pending(p): Pending) -> ApiResult<Json<Value>> {
    Ok(Json(json!(identity::totp_setup(&s.k, &p).await?)))
}

#[derive(Deserialize)]
struct CodeReq {
    code: String,
}

async fn totp_enable(
    State(s): State<AppState>,
    ClientIp(ip): ClientIp,
    Pending(p): Pending,
    Json(r): Json<CodeReq>,
) -> ApiResult<Response> {
    let (lr, codes) = identity::totp_enable(&s.k, &p, &r.code, &ip).await?;
    logged_in(&s, lr, json!({ "recovery_codes": codes })).await
}

async fn totp_verify(
    State(s): State<AppState>,
    ClientIp(ip): ClientIp,
    Pending(p): Pending,
    Json(r): Json<CodeReq>,
) -> ApiResult<Response> {
    let lr = identity::totp_verify(&s.k, &p, &r.code, &ip).await?;
    logged_in(&s, lr, json!({})).await
}

/// Sign-out. For a person of a tenant that signs in through its provider, `end_session` is where to
/// send the browser to sign out of the provider too (if it has an end-session endpoint).
async fn logout(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Response> {
    let end_session = mosaikit_kernel::oidc::end_session_url(&s.k, &u).await;
    identity::logout(&s.k, &u).await?;
    let mut res = Json(json!({ "ok": true, "end_session": end_session })).into_response();
    res.headers_mut().insert(header::SET_COOKIE, session_cookie(&s, None));
    Ok(res)
}

async fn session(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(session_body(&s, &u).await?))
}

#[derive(Deserialize)]
struct PasswordReq {
    old: String,
    new: String,
}

async fn change_password(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<PasswordReq>,
) -> ApiResult<Json<Value>> {
    identity::change_password(&s.k, &u, &r.old, &r.new).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct ProfileReq {
    display_name: String,
}

/// The person changes their own display name (not in the tenants of an identity provider).
async fn my_set_profile(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<ProfileReq>,
) -> ApiResult<Json<Value>> {
    tenancy::profile::set_my_name(&s.k, &u, &r.display_name).await?;
    Ok(ok())
}

async fn my_set_picture(State(s): State<AppState>, Auth(u): Auth, body: Bytes) -> ApiResult<Json<Value>> {
    tenancy::profile::set_my_picture(&s.k, &u, &body).await?;
    Ok(Json(json!({ "picture": tenancy::profile::picture_version(&s.k, u.user_id).await? })))
}

async fn my_remove_picture(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    tenancy::profile::remove_my_picture(&s.k, &u).await?;
    Ok(ok())
}

/// The picture of a person, for whoever shares a tenant with them (and the Administrators).
async fn person_picture(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<Uuid>,
) -> ApiResult<Response> {
    match tenancy::profile::picture(&s.k, &u, id).await? {
        Some((data, mime)) => {
            let mut res = image_response(data, &mime);
            res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=300"));
            Ok(res)
        }
        None => Err(Error::not_found("no picture").into()),
    }
}

async fn my_invitations(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::my_invitations(&s.k, &u).await?)))
}

async fn answer_invitation(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path((id, answer)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    let accept = match answer.as_str() {
        "accept" => true,
        "decline" => false,
        _ => return Err(bad("answer: accept or decline")),
    };
    tenancy::respond_invitation(&s.k, &u, uuid(&id)?, accept).await?;
    Ok(ok())
}

// ------------------------------------------------------------------ notifications

async fn my_notifications(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(f): Query<notify::Filter>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(notify::list(&s.k, &u, &f).await?)))
}

async fn my_unread(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "unread": notify::unread_count(&s.k, &u).await? })))
}

#[derive(Deserialize)]
struct NoteIds {
    ids: Vec<Uuid>,
    #[serde(default = "yes")]
    read: bool,
}

fn yes() -> bool {
    true
}

async fn my_mark_read(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<NoteIds>,
) -> ApiResult<Json<Value>> {
    let n = notify::mark(&s.k, &u, &r.ids, r.read).await?;
    Ok(Json(json!({ "changed": n, "unread": notify::unread_count(&s.k, &u).await? })))
}

async fn my_mark_all_read(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    let n = notify::mark_all_read(&s.k, &u).await?;
    Ok(Json(json!({ "changed": n, "unread": 0 })))
}

async fn my_delete_notifications(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<NoteIds>,
) -> ApiResult<Json<Value>> {
    let n = notify::delete(&s.k, &u, &r.ids).await?;
    Ok(Json(json!({ "deleted": n, "unread": notify::unread_count(&s.k, &u).await? })))
}

async fn my_note_prefs(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(notify::prefs(&s.k, &u).await?)))
}

async fn my_set_note_prefs(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<notify::PrefsChange>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(notify::set_prefs(&s.k, &u, &r).await?)))
}

/// Live events of the person: the number of unread notifications at once, then every change.
async fn my_stream(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Response> {
    let me = u.user_id;
    let first =
        notify::Live { user: me, event: "count", unread: notify::unread_count(&s.k, &u).await?, id: None };
    let rx = s.k.live.subscribe();
    let live = tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(move |e| async move {
        match e {
            Ok(ev) if ev.user == me => Some(ev),
            _ => None,
        }
    });
    let stream = futures_util::stream::once(async move { first }).chain(live).map(|ev| {
        Ok::<_, std::convert::Infallible>(
            Event::default().data(serde_json::to_string(&ev).unwrap_or_default()),
        )
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
}

async fn plugin_notify(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    Json(r): Json<notify::PluginNote>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "sent": notify::from_plugin(&s.k, &c, &p.plugin, &r).await? })))
}

async fn a_email(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(mail::settings(&s.k, &u).await?)))
}

async fn a_set_email(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<mail::EmailChange>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(mail::set_settings(&s.k, &u, &r).await?)))
}

#[derive(Deserialize)]
struct TestMail {
    to: String,
}

async fn a_email_test(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<TestMail>,
) -> ApiResult<Json<Value>> {
    mail::send_test(&s.k, &u, r.to.trim()).await?;
    Ok(ok())
}

/// Development events (hot reload), only in dev mode.
async fn dev_events(State(s): State<AppState>, Auth(_u): Auth) -> ApiResult<Response> {
    if !s.k.cfg.dev.enabled {
        return Err(Error::not_found("development mode not active").into());
    }
    let rx = s.k.dev_events.subscribe();
    let stream = tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(|e| async move {
        e.ok().map(|ev| {
            Ok::<_, std::convert::Infallible>(
                Event::default().data(serde_json::to_string(&ev).unwrap_or_default()),
            )
        })
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()).into_response())
}

/// Language of the request for the texts of the plugins: the first tag of `Accept-Language`
/// (the shell sends the language of its interface), English without it.
pub(crate) fn request_lang(h: &HeaderMap) -> String {
    h.get(header::ACCEPT_LANGUAGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|v| v.split(';').next().unwrap_or_default().trim().to_owned())
        .filter(|v| !v.is_empty() && v.len() <= 35)
        .unwrap_or_else(|| "en".into())
}

// ------------------------------------------------------------------ tenant

async fn context(State(s): State<AppState>, Tenant(c): Tenant, h: HeaderMap) -> ApiResult<Json<Value>> {
    // the plugins the person may use, with what they may do in each
    let perms =
        mosaikit_kernel::access::effective_all(&s.k, c.tenant.tenant_id, c.user.user_id, c.tenant.role)
            .await?;
    let usable = |id: &str| perms.get(id).is_some_and(|p| p.contains(mosaikit_kernel::access::USE));
    let mut views: Vec<_> =
        plugins::active_views_in(&s.k, &request_lang(&h)).into_iter().filter(|v| usable(&v.id)).collect();
    // the pages of the navigation the person may open (`permission` of an entry); a group whose
    // children are all hidden goes too
    for v in &mut views {
        let mine = perms.get(&v.id);
        let may =
            |p: &Option<String>| p.as_ref().is_none_or(|p| mine.is_some_and(|ps| ps.contains(p.as_str())));
        let kept: Vec<_> = v.nav.iter().filter(|n| may(&n.permission)).cloned().collect();
        let had_children = |id: &str| v.nav.iter().any(|c| c.parent.as_deref() == Some(id));
        let has_children = |id: &str| kept.iter().any(|c| c.parent.as_deref() == Some(id));
        let nav: Vec<_> = kept
            .iter()
            .filter(|n| n.place.is_some() || !had_children(&n.id) || has_children(&n.id))
            .cloned()
            .collect();
        v.nav = nav;
    }
    Ok(Json(json!({
        "tenant": { "id": c.tenant.tenant_id, "slug": c.tenant.slug, "name": c.tenant.name,
                    "role": c.tenant.role, "settings": c.tenant.settings },
        "plugins": views,
        "perms": perms,
        "prefs": tenancy::prefs(&s.k, &c).await?,
        "theme": tenancy::tenant_theme(&s.k, c.tenant.tenant_id).await?,
        // themes of the theme editor the tenant can see: its own and the allowed ones of the platform
        "themes": tenancy::themes::for_tenant(&s.k, c.tenant.tenant_id).await?,
        "config": levels::effective(&s.k, Some(c.tenant.tenant_id)).await?,
        "layout": tenancy::layouts::in_use(&s.k, Some(c.tenant.tenant_id)).await?,
    })))
}

async fn set_prefs(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(v): Json<Value>,
) -> ApiResult<Json<Value>> {
    tenancy::set_prefs(&s.k, &c, &v).await?;
    Ok(ok())
}

async fn directory(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::directory(&s.k, &c, q.get("q").map(String::as_str).unwrap_or("")).await?)))
}

#[derive(Deserialize)]
struct RidPath {
    #[allow(dead_code)]
    t: String,
    rid: String,
}

async fn resource_meta(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<RidPath>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(acl::meta(&s.k, &c, uuid(&p.rid)?).await?)))
}

async fn resource_grants(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<RidPath>,
) -> ApiResult<Json<Value>> {
    let rid = uuid(&p.rid)?;
    let m = acl::meta(&s.k, &c, rid).await?;
    Ok(Json(json!({ "resource": m, "grants": acl::grants(&s.k, &c, rid).await? })))
}

#[derive(Deserialize)]
struct GrantReq {
    principal_type: String,
    principal_id: Uuid,
    /// read | write | manage; absent or null = revoke
    level: Option<String>,
}

async fn resource_set_grant(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<RidPath>,
    Json(r): Json<GrantReq>,
) -> ApiResult<Json<Value>> {
    let level = r.level.as_deref().map(Level::parse).transpose()?;
    acl::set_grant(&s.k, &c, uuid(&p.rid)?, &r.principal_type, r.principal_id, level).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct OwnerReq {
    user_id: Uuid,
}

async fn resource_owner(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<RidPath>,
    Json(r): Json<OwnerReq>,
) -> ApiResult<Json<Value>> {
    acl::transfer_owner(&s.k, &c, uuid(&p.rid)?, r.user_id).await?;
    Ok(ok())
}

async fn resource_links(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<RidPath>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(links::list(&s.k, &c, uuid(&p.rid)?).await?)))
}

#[derive(Deserialize)]
struct LinkReq {
    days: Option<u32>,
    password: Option<String>,
}

async fn resource_link_create(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<RidPath>,
    Json(r): Json<LinkReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(links::create(&s.k, &c, uuid(&p.rid)?, r.days, r.password.as_deref()).await?)))
}

async fn link_revoke(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    links::revoke(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

// ------------------------------------------------------------------ CRUD and commands

#[derive(Deserialize)]
struct ResPath {
    #[allow(dead_code)]
    t: String,
    plugin: String,
    res: String,
    #[serde(default)]
    id: Option<String>,
}

#[derive(Deserialize)]
struct RowReq {
    values: Map<String, Value>,
    #[serde(default)]
    parent: Option<Uuid>,
}

async fn crud_list(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<ResPath>,
    Query(q): Query<HashMap<String, String>>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    let parent = q.get("parent").filter(|v| !v.is_empty()).map(|v| uuid(v)).transpose()?;
    // `limit` asks for one page at a time (the next with `cursor`); without it the list answers whole
    let paging = match q.get("limit").filter(|v| !v.is_empty()) {
        Some(l) => Some(crud::Paging {
            limit: l.parse().map_err(|_| bad("invalid limit"))?,
            cursor: q.get("cursor").cloned(),
        }),
        None => None,
    };
    let mut list = crud::list_paged(
        &s.k,
        &c,
        &p.plugin,
        &p.res,
        q.get("filter").map(String::as_str),
        parent,
        paging.as_ref(),
    )
    .await?;
    // the labels of the fields (and of the choice values) in the language of the request
    if let Some(fields) = plugins::localized_fields(&s.k, &p.plugin, &p.res, &request_lang(&h)) {
        list.fields = fields;
    }
    Ok(Json(json!(list)))
}

async fn crud_get(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<ResPath>,
) -> ApiResult<Json<Value>> {
    Ok(Json(crud::get(&s.k, &c, &p.plugin, &p.res, uuid(p.id.as_deref().unwrap_or_default())?).await?))
}

async fn crud_create(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<ResPath>,
    Json(r): Json<RowReq>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let row = crud::create(&s.k, &c, &p.plugin, &p.res, &r.values, r.parent).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

async fn crud_update(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<ResPath>,
    Json(r): Json<RowReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(
        crud::update(&s.k, &c, &p.plugin, &p.res, uuid(p.id.as_deref().unwrap_or_default())?, &r.values)
            .await?,
    ))
}

async fn crud_delete(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<ResPath>,
) -> ApiResult<Json<Value>> {
    crud::delete(&s.k, &c, &p.plugin, &p.res, uuid(p.id.as_deref().unwrap_or_default())?).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct CallPath {
    #[allow(dead_code)]
    t: String,
    plugin: String,
    name: String,
}

async fn plugin_call(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<CallPath>,
    body: Option<Json<Value>>,
) -> ApiResult<Json<Value>> {
    let args = body.map(|b| b.0).unwrap_or(Value::Null);
    let args = args.get("args").cloned().unwrap_or(args);
    Ok(Json(json!({ "result": crud::call(&s.k, &c, &p.plugin, &p.name, args).await? })))
}

// ------------------------------------------------------------------ files and contents

#[derive(Deserialize)]
struct PluginPath {
    #[allow(dead_code)]
    t: String,
    plugin: String,
    #[serde(default)]
    id: Option<String>,
}

impl PluginPath {
    fn id(&self) -> ApiResult<Uuid> {
        uuid(self.id.as_deref().unwrap_or_default())
    }
}

pub(crate) fn opt_uuid(v: Option<&String>) -> ApiResult<Option<Uuid>> {
    v.filter(|s| !s.is_empty() && *s != "null").map(|s| uuid(s)).transpose()
}

async fn files_list(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(files::list(&s.k, &c, &p.plugin, opt_uuid(q.get("parent"))?).await?)))
}

#[derive(Deserialize)]
struct FolderReq {
    parent: Option<Uuid>,
    name: String,
}

async fn files_mkdir(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    Json(r): Json<FolderReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(files::mkdir(&s.k, &c, &p.plugin, r.parent, &r.name).await?)))
}

async fn files_upload(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    Query(q): Query<HashMap<String, String>>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    let name = q.get("name").ok_or_else(|| bad("missing name"))?;
    let replace = q.get("replace").is_some_and(|v| v == "1" || v == "true");
    Ok(Json(json!(
        files::upload(&s.k, &c, &p.plugin, opt_uuid(q.get("parent"))?, name, &body, replace).await?
    )))
}

/// Content as a download: `application/octet-stream` + attachment, never interpreted by the browser.
fn attachment(name: &str, data: Vec<u8>) -> Response {
    let safe: String = name.chars().map(|c| if c == '"' || c.is_control() { '_' } else { c }).collect();
    let ascii: String = safe.chars().map(|c| if c.is_ascii() { c } else { '_' }).collect();
    let encoded: String = safe
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let mut res = data.into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
    if let Ok(v) =
        HeaderValue::from_str(&format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}"))
    {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

async fn files_content(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
) -> ApiResult<Response> {
    let (e, data) = files::read(&s.k, &c, &p.plugin, p.id()?).await?;
    Ok(attachment(&e.name, data))
}

async fn files_zip(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
) -> ApiResult<Response> {
    let (name, data) = files::zip_folder(&s.k, &c, &p.plugin, p.id()?).await?;
    Ok(attachment(&name, data))
}

#[derive(Deserialize)]
struct NameReq {
    name: String,
}

async fn files_rename(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    Json(r): Json<NameReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(files::rename(&s.k, &c, &p.plugin, p.id()?, &r.name).await?)))
}

#[derive(Deserialize)]
struct ParentReq {
    parent: Option<Uuid>,
}

async fn files_move(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    Json(r): Json<ParentReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(files::move_to(&s.k, &c, &p.plugin, p.id()?, r.parent).await?)))
}

async fn files_copy(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    Json(r): Json<ParentReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(files::copy_to(&s.k, &c, &p.plugin, p.id()?, r.parent).await?)))
}

async fn files_delete(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
) -> ApiResult<Json<Value>> {
    files::delete(&s.k, &c, &p.plugin, p.id()?).await?;
    Ok(ok())
}

async fn content_upload(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(content::upload_site(&s.k, &c, &p.plugin, p.id()?, &body).await?)))
}

#[derive(Deserialize, Default)]
struct TicketReq {
    #[serde(default)]
    download: bool,
}

async fn ticket(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<PluginPath>,
    body: Option<Json<TicketReq>>,
) -> ApiResult<Json<Value>> {
    let download = body.map(|b| b.0.download).unwrap_or(false);
    Ok(Json(json!(content::ticket(&s.k, &c, &p.plugin, p.id()?, download).await?)))
}

// ------------------------------------------------------------------ manager of the tenant

#[derive(Deserialize)]
struct UidPath {
    #[allow(dead_code)]
    t: String,
    uid: String,
}

/// Members of the tenant: whole, or a page with `limit` (Manage › People).
async fn m_members(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(f): Query<tenancy::MemberFilter>,
) -> ApiResult<Json<Value>> {
    if f.limit.is_some() || f.ids {
        return Ok(Json(json!(tenancy::members_page(&s.k, &c, &f).await?)));
    }
    Ok(Json(json!(tenancy::members(&s.k, &c).await?)))
}

#[derive(Deserialize)]
struct NewMemberReq {
    username: String,
    #[serde(default)]
    display_name: String,
    password: String,
    #[serde(default = "member_role")]
    role: String,
}

fn member_role() -> String {
    "user".into()
}

async fn m_create_member(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<NewMemberReq>,
) -> ApiResult<Json<Value>> {
    let id =
        tenancy::create_member(&s.k, &c, &r.username, &r.display_name, &r.password, Role::parse(&r.role)?)
            .await?;
    Ok(Json(json!({ "user_id": id })))
}

async fn m_remove_member(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let new_owner = opt_uuid(q.get("new_owner"))?;
    Ok(Json(json!(tenancy::remove_member(&s.k, &c, uuid(&p.uid)?, new_owner).await?)))
}

#[derive(Deserialize)]
struct RoleReq {
    role: String,
}

async fn m_set_role(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
    Json(r): Json<RoleReq>,
) -> ApiResult<Json<Value>> {
    tenancy::set_role(&s.k, &c, uuid(&p.uid)?, Role::parse(&r.role)?).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct ResetReq {
    password: String,
}

async fn m_reset_password(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
    Json(r): Json<ResetReq>,
) -> ApiResult<Json<Value>> {
    tenancy::reset_member_password(&s.k, &c, uuid(&p.uid)?, &r.password).await?;
    Ok(ok())
}

async fn m_invitations(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::tenant_invitations(&s.k, &c).await?)))
}

#[derive(Deserialize)]
struct InviteReq {
    tenant: String,
    username: String,
    #[serde(default = "member_role")]
    role: String,
    #[serde(default)]
    profile: Option<Uuid>,
}

async fn m_invite(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<InviteReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(
        tenancy::invite_with(&s.k, &c, &r.tenant, &r.username, Role::parse(&r.role)?, r.profile).await?
    )))
}

async fn m_revoke_invitation(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    tenancy::revoke_invitation(&s.k, &c, uuid(&id)?).await?;
    Ok(ok())
}

/// Groups of the tenant: whole, or a page with `limit`.
async fn m_groups(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(f): Query<mosaikit_kernel::paging::PageQuery>,
) -> ApiResult<Json<Value>> {
    if f.limit.is_some() {
        return Ok(Json(json!(tenancy::groups_page(&s.k, &c, &f).await?)));
    }
    Ok(Json(json!(tenancy::groups(&s.k, &c).await?)))
}

async fn m_create_group(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<NameReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "id": tenancy::create_group(&s.k, &c, &r.name).await? })))
}

async fn m_delete_group(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, gid)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    tenancy::delete_group(&s.k, &c, uuid(&gid)?).await?;
    Ok(ok())
}

async fn m_group_add(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, gid, uid)): Path<(String, String, String)>,
) -> ApiResult<Json<Value>> {
    tenancy::set_group_member(&s.k, &c, uuid(&gid)?, uuid(&uid)?, true).await?;
    Ok(ok())
}

async fn m_group_remove(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, gid, uid)): Path<(String, String, String)>,
) -> ApiResult<Json<Value>> {
    tenancy::set_group_member(&s.k, &c, uuid(&gid)?, uuid(&uid)?, false).await?;
    Ok(ok())
}

/// Items of the tenant (Shares, all items): up to 1,000 as before, or a page with `limit`.
async fn m_resources(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Query(f): Query<ResourceFilter>,
    Query(p): Query<acl::ResourcePageFilter>,
) -> ApiResult<Json<Value>> {
    if p.limit.is_some() || p.ids {
        return Ok(Json(json!(acl::manager_resources_page(&s.k, &c, &p).await?)));
    }
    Ok(Json(json!(acl::manager_resources(&s.k, &c, &f).await?)))
}

#[derive(Deserialize)]
struct ReassignReq {
    from: Uuid,
    to: Uuid,
}

async fn m_reassign(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<ReassignReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "reassigned": acl::reassign_all(&s.k, &c, r.from, r.to).await? })))
}

async fn m_settings(Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    c.require_manager()?;
    Ok(Json(json!(c.tenant.settings)))
}

async fn m_set_settings(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<TenantSettings>,
) -> ApiResult<Json<Value>> {
    tenancy::set_settings(&s.k, &c, &r).await?;
    Ok(ok())
}

// ------------------------------------------------------------------ settings on three levels

#[derive(Deserialize)]
struct SettingsReq {
    /// key -> value (null: back to the default, or to the value of the platform)
    #[serde(default)]
    values: Map<String, Value>,
    /// "tenants may customize it" (platform only)
    #[serde(default)]
    customizable: Map<String, Value>,
}

async fn a_settings(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    tenancy::require_admin(&u)?;
    Ok(Json(json!(levels::platform_settings(&s.k).await?)))
}

async fn a_set_settings(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<SettingsReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(levels::set_platform(&s.k, &u, &r.values, &r.customizable).await?)))
}

async fn m_config(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    c.require_manager()?;
    Ok(Json(json!(levels::tenant_settings(&s.k, c.tenant.tenant_id).await?)))
}

async fn m_set_config(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<SettingsReq>,
) -> ApiResult<Json<Value>> {
    if !r.customizable.is_empty() {
        return Err(bad("only the Administrator decides what tenants may customize"));
    }
    Ok(Json(json!(levels::set_tenant(&s.k, &c, &r.values).await?)))
}

async fn a_set_image(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(slot): Path<String>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    levels::set_image(&s.k, levels::Who::Platform(&u), &slot, &body).await?;
    Ok(ok())
}

async fn a_remove_image(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(slot): Path<String>,
) -> ApiResult<Json<Value>> {
    levels::remove_image(&s.k, levels::Who::Platform(&u), &slot).await?;
    Ok(ok())
}

async fn m_set_image(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, slot)): Path<(String, String)>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    levels::set_image(&s.k, levels::Who::Tenant(&c), &slot, &body).await?;
    Ok(ok())
}

async fn m_remove_image(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, slot)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    levels::remove_image(&s.k, levels::Who::Tenant(&c), &slot).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct KeyReq {
    /// the key (or the address); absent: only `shared` changes
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    shared: Option<bool>,
}

async fn a_keys(State(s): State<AppState>, Auth(u): Auth, h: HeaderMap) -> ApiResult<Json<Value>> {
    Ok(Json(json!(keys::platform_keys(&s.k, &u, &request_lang(&h)).await?)))
}

async fn a_set_key(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(service): Path<String>,
    h: HeaderMap,
    Json(r): Json<KeyReq>,
) -> ApiResult<Json<Value>> {
    tenancy::require_admin(&u)?;
    keys::set_key(&s.k, u.user_id, KeyLevel::Platform, &service, r.value.as_deref(), r.shared).await?;
    Ok(Json(json!(keys::platform_keys(&s.k, &u, &request_lang(&h)).await?)))
}

async fn a_remove_key(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(service): Path<String>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    tenancy::require_admin(&u)?;
    keys::remove_key(&s.k, u.user_id, KeyLevel::Platform, &service).await?;
    Ok(Json(json!(keys::platform_keys(&s.k, &u, &request_lang(&h)).await?)))
}

async fn m_keys(State(s): State<AppState>, Tenant(c): Tenant, h: HeaderMap) -> ApiResult<Json<Value>> {
    Ok(Json(json!(keys::tenant_keys(&s.k, &c, &request_lang(&h)).await?)))
}

async fn m_set_key(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, service)): Path<(String, String)>,
    h: HeaderMap,
    Json(r): Json<KeyReq>,
) -> ApiResult<Json<Value>> {
    c.require_manager()?;
    let level = KeyLevel::Tenant(c.tenant.tenant_id);
    keys::set_key(&s.k, c.user.user_id, level, &service, r.value.as_deref(), r.shared).await?;
    Ok(Json(json!(keys::tenant_keys(&s.k, &c, &request_lang(&h)).await?)))
}

async fn m_remove_key(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, service)): Path<(String, String)>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    c.require_manager()?;
    keys::remove_key(&s.k, c.user.user_id, KeyLevel::Tenant(c.tenant.tenant_id), &service).await?;
    Ok(Json(json!(keys::tenant_keys(&s.k, &c, &request_lang(&h)).await?)))
}

async fn my_keys(State(s): State<AppState>, Tenant(c): Tenant, h: HeaderMap) -> ApiResult<Json<Value>> {
    Ok(Json(json!(keys::my_keys(&s.k, &c, &request_lang(&h)).await?)))
}

async fn my_set_key(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, service)): Path<(String, String)>,
    h: HeaderMap,
    Json(r): Json<KeyReq>,
) -> ApiResult<Json<Value>> {
    keys::set_key(
        &s.k,
        c.user.user_id,
        KeyLevel::User(c.user.user_id),
        &service,
        r.value.as_deref(),
        r.shared,
    )
    .await?;
    Ok(Json(json!(keys::my_keys(&s.k, &c, &request_lang(&h)).await?)))
}

async fn my_remove_key(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_, service)): Path<(String, String)>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    keys::remove_key(&s.k, c.user.user_id, KeyLevel::User(c.user.user_id), &service).await?;
    Ok(Json(json!(keys::my_keys(&s.k, &c, &request_lang(&h)).await?)))
}

async fn m_kpi(State(s): State<AppState>, Tenant(c): Tenant, h: HeaderMap) -> ApiResult<Json<Value>> {
    let mut r = kpi::tenant(&s.k, &c).await?;
    kpi::localize(&s.k, &mut r.plugins, &request_lang(&h));
    Ok(Json(json!(r)))
}

// ------------------------------------------------------------------ system administrator

async fn overview(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(mosaikit_kernel::overview::overview(&s.k, &c).await?)))
}

async fn a_admins(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::administrators(&s.k, &u).await?)))
}

#[derive(Deserialize)]
struct NewAdminReq {
    username: String,
    #[serde(default)]
    display_name: String,
    password: String,
}

async fn a_create_admin(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<NewAdminReq>,
) -> ApiResult<Json<Value>> {
    tenancy::create_administrator(&s.k, &u, &r.username, &r.display_name, &r.password).await?;
    Ok(Json(json!(tenancy::administrators(&s.k, &u).await?)))
}

#[derive(Deserialize)]
struct ActiveReq {
    active: bool,
}

async fn a_admin_status(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(r): Json<ActiveReq>,
) -> ApiResult<Json<Value>> {
    tenancy::set_administrator_active(&s.k, &u, uuid(&id)?, r.active).await?;
    Ok(Json(json!(tenancy::administrators(&s.k, &u).await?)))
}

async fn a_admin_password(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(r): Json<ResetReq>,
) -> ApiResult<Json<Value>> {
    tenancy::reset_administrator_password(&s.k, &u, uuid(&id)?, &r.password).await?;
    Ok(ok())
}

async fn a_admin_totp(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    tenancy::reset_administrator_totp(&s.k, &u, uuid(&id)?).await?;
    Ok(Json(json!(tenancy::administrators(&s.k, &u).await?)))
}

async fn a_overview(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(mosaikit_kernel::overview::system_overview(&s.k, &u).await?)))
}

#[derive(Deserialize)]
struct TenantUserPath {
    id: String,
    uid: String,
}

async fn a_tenant_members(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::tenant_members(&s.k, &u, uuid(&id)?).await?)))
}

async fn a_tenant_manager(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(r): Json<NewAdminReq>,
) -> ApiResult<Json<Value>> {
    let tenant = uuid(&id)?;
    tenancy::create_tenant_manager(&s.k, &u, tenant, &r.username, &r.display_name, &r.password).await?;
    Ok(Json(json!(tenancy::tenant_members(&s.k, &u, tenant).await?)))
}

async fn a_tenant_role(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(p): Path<TenantUserPath>,
    Json(r): Json<RoleReq>,
) -> ApiResult<Json<Value>> {
    let tenant = uuid(&p.id)?;
    tenancy::set_tenant_role(&s.k, &u, tenant, uuid(&p.uid)?, Role::parse(&r.role)?).await?;
    Ok(Json(json!(tenancy::tenant_members(&s.k, &u, tenant).await?)))
}

async fn a_tenant_password(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(p): Path<TenantUserPath>,
    Json(r): Json<ResetReq>,
) -> ApiResult<Json<Value>> {
    tenancy::reset_tenant_password(&s.k, &u, uuid(&p.id)?, uuid(&p.uid)?, &r.password).await?;
    Ok(ok())
}

/// Tenants: whole (for the lists of choices), or a page with `limit` (Administrator › Tenants).
async fn a_tenants(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(f): Query<tenancy::TenantFilter>,
) -> ApiResult<Json<Value>> {
    if f.limit.is_some() {
        return Ok(Json(json!(tenancy::tenants_page(&s.k, &u, &f).await?)));
    }
    Ok(Json(json!(tenancy::list_tenants(&s.k, &u).await?)))
}

#[derive(Deserialize)]
struct NewTenantReq {
    slug: String,
    name: String,
    manager_username: String,
    #[serde(default)]
    manager_display_name: String,
    manager_password: String,
    /// end of the trial period (none: no trial)
    #[serde(default)]
    trial_until: Option<chrono::DateTime<chrono::Utc>>,
}

async fn a_create_tenant(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<NewTenantReq>,
) -> ApiResult<Json<Value>> {
    let t = tenancy::create_tenant(
        &s.k,
        &u,
        NewTenant {
            slug: &r.slug,
            name: &r.name,
            manager_username: &r.manager_username,
            manager_display_name: &r.manager_display_name,
            manager_password: &r.manager_password,
            trial_until: r.trial_until,
        },
    )
    .await?;
    Ok(Json(json!(t)))
}

#[derive(Deserialize)]
struct StatusReq {
    status: String,
}

async fn a_tenant_status(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(r): Json<StatusReq>,
) -> ApiResult<Json<Value>> {
    tenancy::set_tenant_status(&s.k, &u, uuid(&id)?, &r.status).await?;
    Ok(ok())
}

async fn admin_plugins(State(s): State<AppState>, Auth(u): Auth, h: HeaderMap) -> ApiResult<Json<Value>> {
    Ok(Json(json!(plugins::admin_views_in(&s.k, &u, &request_lang(&h))?)))
}

async fn admin_install(
    State(s): State<AppState>,
    Auth(u): Auth,
    _h: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    let p = plugins::install_package(&s.k, Some(&u), &body, plugins::InstallSource::Upload).await?;
    Ok(Json(
        json!({ "id": p.id, "version": p.manifest.version, "status": p.status, "signed_by": p.signed_by }),
    ))
}

async fn a_plugin_action(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path((id, action)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    match action.as_str() {
        "activate" => plugins::set_active(&s.k, Some(&u), &id, true).await?,
        "deactivate" => plugins::set_active(&s.k, Some(&u), &id, false).await?,
        _ => return Err(bad("action: activate or deactivate")),
    }
    Ok(ok())
}

async fn a_plugin_uninstall(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    plugins::uninstall(&s.k, &u, &id).await?;
    Ok(ok())
}

async fn a_catalog(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    Ok(Json(json!(plugins::registry::catalog(&s.k, &u)?)))
}

async fn a_catalog_install(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    plugins::registry::install_from_catalog(&s.k, &u, &id).await?;
    Ok(ok())
}

async fn a_set_band(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(b): Json<tenancy::ShellBand>,
) -> ApiResult<Json<Value>> {
    tenancy::set_shell_band(&s.k, &u, &b).await?;
    Ok(Json(json!(b)))
}

#[derive(serde::Deserialize)]
struct ThemeReq {
    /// absent or null: the tenant goes back to the theme of the platform
    preset: Option<String>,
}

async fn a_set_theme(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<ThemeReq>,
) -> ApiResult<Json<Value>> {
    let preset = r.preset.ok_or_else(|| Error::bad("missing theme"))?;
    tenancy::set_platform_theme(&s.k, &u, &preset).await?;
    Ok(ok())
}

async fn m_set_theme(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<ThemeReq>,
) -> ApiResult<Json<Value>> {
    tenancy::set_tenant_theme(&s.k, &c, r.preset.as_deref()).await?;
    Ok(Json(json!(tenancy::tenant_theme(&s.k, c.tenant.tenant_id).await?)))
}

/// The platform KPIs: the last snapshot (computed every ten minutes), or computed now with `refresh=true`.
async fn a_kpi(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(q): Query<HashMap<String, String>>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    let refresh = q.get("refresh").is_some_and(|v| v == "true" || v == "1");
    let mut r = kpi::global_snapshot(&s.k, &u, refresh).await?;
    kpi::localize(&s.k, &mut r.kpi.plugins, &request_lang(&h));
    Ok(Json(json!(r)))
}
