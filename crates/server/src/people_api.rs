//! REST API of people and permissions: the members of a tenant in detail, permission profiles,
//! permissions of the plugins, access requests, the directory of the Administrator, links to choose a
//! new password (see `docs/architecture.md`, "People and permissions").

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use mosaikit_kernel::access::{self, ProfileChange};
use mosaikit_kernel::acl::Level;
use mosaikit_kernel::tenancy::{self, By, MembershipChange, NewPerson};
use mosaikit_kernel::Role;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::api::{ok, opt_uuid, request_lang, uuid};
use crate::auth::{Auth, Tenant};
use crate::{ApiResult, AppState};

/// Routes of this module (`m_member` and `m_group` share their paths with `api.rs` and are
/// mounted there).
pub fn router() -> Router<AppState> {
    Router::new()
        // Tenant Manager: people, groups, profiles, permissions of the plugins
        .route("/api/t/{t}/manage/members/{uid}/profile", put(m_member_profile))
        .route("/api/t/{t}/manage/members/{uid}/status", put(m_member_status))
        .route("/api/t/{t}/manage/members/{uid}/person", put(m_member_person))
        .route("/api/t/{t}/manage/members/{uid}/activity", get(m_member_activity))
        .route("/api/t/{t}/manage/members/{uid}/sessions", get(m_member_sessions).delete(m_member_close_all))
        .route("/api/t/{t}/manage/members/{uid}/sessions/{sid}", delete(m_member_close))
        .route("/api/t/{t}/manage/members/{uid}/reset-link", post(m_member_reset_link))
        .route("/api/t/{t}/manage/members/{uid}/why", get(m_member_why))
        .route("/api/t/{t}/manage/profiles", get(m_profiles).post(m_create_profile))
        .route("/api/t/{t}/manage/profiles/catalog", get(m_profile_catalog))
        .route("/api/t/{t}/manage/profiles/{pid}", put(m_update_profile).delete(m_delete_profile))
        .route("/api/t/{t}/manage/plugins/{plugin}/access", get(m_plugin_access))
        .route("/api/t/{t}/manage/plugins/{plugin}/grants", put(m_plugin_grant))
        // every member: access requests
        .route("/api/t/{t}/resources/{rid}/request", post(request_access))
        .route("/api/t/{t}/requests", get(requests))
        .route("/api/t/{t}/requests/{id}/{action}", post(decide))
        // Administrator: every person
        .route("/api/admin/people", get(a_people).post(a_create_person))
        .route("/api/admin/people/{uid}", get(a_person).put(a_update_person))
        .route("/api/admin/people/{uid}/status", put(a_person_status))
        .route("/api/admin/people/{uid}/tenants", post(a_add_to_tenant))
        .route("/api/admin/people/{uid}/tenants/{tid}", put(a_update_membership).delete(a_remove_from_tenant))
        .route("/api/admin/people/{uid}/home", post(a_move_home))
        .route("/api/admin/people/{uid}/reset-link", post(a_reset_link))
        .route("/api/admin/people/{uid}/sessions", get(a_sessions).delete(a_close_all))
        .route("/api/admin/people/{uid}/sessions/{sid}", delete(a_close))
        .route("/api/admin/people/{uid}/activity", get(a_activity))
        .route("/api/admin/tenants/{id}/profiles", get(a_tenant_profiles))
        // public: the page of the link to choose a new password
        .route("/api/auth/reset/{token}", get(reset_info))
        .route("/api/auth/reset", post(reset_password))
}

#[derive(Deserialize)]
pub(crate) struct UidPath {
    #[allow(dead_code)]
    t: String,
    uid: String,
}

#[derive(Deserialize)]
struct SessionPath {
    #[allow(dead_code)]
    t: String,
    uid: String,
    sid: String,
}

// ------------------------------------------------------------------ Tenant Manager

pub(crate) async fn m_member(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::member_detail(&s.k, &c, uuid(&p.uid)?, &request_lang(&h)).await?)))
}

#[derive(Deserialize)]
struct ProfileReq {
    #[serde(default)]
    profile: Option<Uuid>,
}

async fn m_member_profile(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
    Json(r): Json<ProfileReq>,
) -> ApiResult<Json<Value>> {
    access::set_member_profile(&s.k, &c, uuid(&p.uid)?, r.profile).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct SuspendReq {
    suspended: bool,
}

async fn m_member_status(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
    Json(r): Json<SuspendReq>,
) -> ApiResult<Json<Value>> {
    tenancy::set_member_suspended(&s.k, &c, uuid(&p.uid)?, r.suspended).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct PersonReq {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    email: Option<String>,
}

async fn m_member_person(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
    Json(r): Json<PersonReq>,
) -> ApiResult<Json<Value>> {
    tenancy::update_person(
        &s.k,
        By::Manager(&c),
        uuid(&p.uid)?,
        r.display_name.as_deref(),
        r.email.as_deref(),
    )
    .await?;
    Ok(ok())
}

async fn m_member_activity(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::person_activity(&s.k, By::Manager(&c), uuid(&p.uid)?).await?)))
}

async fn m_member_sessions(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::person_sessions(&s.k, By::Manager(&c), uuid(&p.uid)?).await?)))
}

async fn m_member_close_all(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "closed": tenancy::close_sessions(&s.k, By::Manager(&c), uuid(&p.uid)?).await? })))
}

async fn m_member_close(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<SessionPath>,
) -> ApiResult<Json<Value>> {
    tenancy::close_session(&s.k, By::Manager(&c), uuid(&p.uid)?, &p.sid).await?;
    Ok(ok())
}

async fn m_member_reset_link(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::reset_link(&s.k, By::Manager(&c), uuid(&p.uid)?).await?)))
}

async fn m_member_why(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<UidPath>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let rid = uuid(q.get("resource").map(String::as_str).unwrap_or_default())?;
    Ok(Json(json!(tenancy::why_not(&s.k, &c, uuid(&p.uid)?, rid).await?)))
}

pub(crate) async fn m_group(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, gid)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::group_detail(&s.k, &c, uuid(&gid)?).await?)))
}

async fn m_profiles(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(access::profiles(&s.k, &c).await?)))
}

#[derive(Deserialize)]
struct NewProfileReq {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    copy_of: Option<Uuid>,
}

async fn m_create_profile(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Json(r): Json<NewProfileReq>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(access::create_profile(&s.k, &c, &r.name, &r.description, r.copy_of).await?)))
}

async fn m_profile_catalog(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(access::permission_catalog(&s.k, &c, &request_lang(&h))?)))
}

async fn m_update_profile(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, pid)): Path<(String, String)>,
    Json(r): Json<ProfileChange>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(access::update_profile(&s.k, &c, uuid(&pid)?, &r).await?)))
}

async fn m_delete_profile(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, pid)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    access::delete_profile(&s.k, &c, uuid(&pid)?).await?;
    Ok(ok())
}

async fn m_plugin_access(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, plugin)): Path<(String, String)>,
    h: HeaderMap,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(access::plugin_access(&s.k, &c, &plugin, &request_lang(&h)).await?)))
}

#[derive(Deserialize)]
struct GrantReq {
    principal_type: String,
    principal_id: Uuid,
    #[serde(default)]
    perms: Vec<String>,
}

async fn m_plugin_grant(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, plugin)): Path<(String, String)>,
    Json(r): Json<GrantReq>,
) -> ApiResult<Json<Value>> {
    access::set_plugin_grant(&s.k, &c, &plugin, &r.principal_type, r.principal_id, &r.perms).await?;
    Ok(ok())
}

// ------------------------------------------------------------------ access requests

#[derive(Deserialize)]
struct RequestReq {
    #[serde(default = "read")]
    level: String,
    #[serde(default)]
    message: String,
}

fn read() -> String {
    "read".into()
}

async fn request_access(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, rid)): Path<(String, String)>,
    Json(r): Json<RequestReq>,
) -> ApiResult<Json<Value>> {
    let level = Level::parse(&r.level)?;
    Ok(Json(json!(tenancy::request_access(&s.k, &c, uuid(&rid)?, level, &r.message).await?)))
}

async fn requests(State(s): State<AppState>, Tenant(c): Tenant) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::requests(&s.k, &c).await?)))
}

async fn decide(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path((_t, id, action)): Path<(String, String, String)>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::decide_request(&s.k, &c, uuid(&id)?, &action).await?)))
}

// ------------------------------------------------------------------ Administrator

/// People of the installation: whole, or a page with `limit` (Administrator › People; the other lists
/// of choices search with `q` and a small `limit`).
async fn a_people(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(f): Query<tenancy::PeopleFilter>,
) -> ApiResult<Json<Value>> {
    if f.limit.is_some() || f.ids {
        return Ok(Json(json!(tenancy::people_page(&s.k, &u, &f).await?)));
    }
    Ok(Json(json!(tenancy::directory_of_people(&s.k, &u).await?)))
}

async fn a_create_person(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(r): Json<NewPerson>,
) -> ApiResult<Json<Value>> {
    let (person, link) = tenancy::create_person(&s.k, &u, &r).await?;
    Ok(Json(json!({ "person": person, "reset_link": link })))
}

async fn a_person(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::person(&s.k, &u, uuid(&uid)?).await?)))
}

async fn a_update_person(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
    Json(r): Json<PersonReq>,
) -> ApiResult<Json<Value>> {
    let user = uuid(&uid)?;
    tenancy::update_person(&s.k, By::Admin(&u), user, r.display_name.as_deref(), r.email.as_deref()).await?;
    Ok(Json(json!(tenancy::person(&s.k, &u, user).await?)))
}

#[derive(Deserialize)]
struct ActiveReq {
    active: bool,
}

async fn a_person_status(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
    Json(r): Json<ActiveReq>,
) -> ApiResult<Json<Value>> {
    tenancy::set_person_status(&s.k, &u, uuid(&uid)?, r.active).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct MembershipReq {
    tenant: Uuid,
    role: Role,
    #[serde(default)]
    profile: Option<Uuid>,
}

async fn a_add_to_tenant(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
    Json(r): Json<MembershipReq>,
) -> ApiResult<Json<Value>> {
    let user = uuid(&uid)?;
    tenancy::add_to_tenant(&s.k, &u, user, r.tenant, r.role, r.profile).await?;
    Ok(Json(json!(tenancy::person(&s.k, &u, user).await?)))
}

async fn a_update_membership(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path((uid, tid)): Path<(String, String)>,
    Json(r): Json<MembershipChange>,
) -> ApiResult<Json<Value>> {
    let user = uuid(&uid)?;
    tenancy::update_membership(&s.k, &u, user, uuid(&tid)?, &r).await?;
    Ok(Json(json!(tenancy::person(&s.k, &u, user).await?)))
}

async fn a_remove_from_tenant(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path((uid, tid)): Path<(String, String)>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let new_owner = opt_uuid(q.get("new_owner"))?;
    Ok(Json(json!(tenancy::remove_from_tenant(&s.k, &u, uuid(&uid)?, uuid(&tid)?, new_owner).await?)))
}

#[derive(Deserialize)]
struct HomeReq {
    tenant: Uuid,
}

async fn a_move_home(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
    Json(r): Json<HomeReq>,
) -> ApiResult<Json<Value>> {
    let user = uuid(&uid)?;
    tenancy::move_home(&s.k, &u, user, r.tenant).await?;
    Ok(Json(json!(tenancy::person(&s.k, &u, user).await?)))
}

async fn a_reset_link(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::reset_link(&s.k, By::Admin(&u), uuid(&uid)?).await?)))
}

async fn a_sessions(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::person_sessions(&s.k, By::Admin(&u), uuid(&uid)?).await?)))
}

async fn a_close_all(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "closed": tenancy::close_sessions(&s.k, By::Admin(&u), uuid(&uid)?).await? })))
}

async fn a_close(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path((uid, sid)): Path<(String, String)>,
) -> ApiResult<Json<Value>> {
    tenancy::close_session(&s.k, By::Admin(&u), uuid(&uid)?, &sid).await?;
    Ok(ok())
}

async fn a_activity(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(uid): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::person_activity(&s.k, By::Admin(&u), uuid(&uid)?).await?)))
}

async fn a_tenant_profiles(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(access::tenant_profiles(&s.k, &u, uuid(&id)?).await?)))
}

// ------------------------------------------------------------------ public

async fn reset_info(State(s): State<AppState>, Path(token): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(json!(tenancy::reset_info(&s.k, &token).await?)))
}

#[derive(Deserialize)]
struct ResetReq {
    token: String,
    password: String,
}

async fn reset_password(State(s): State<AppState>, Json(r): Json<ResetReq>) -> ApiResult<Json<Value>> {
    tenancy::reset_with_link(&s.k, &r.token, &r.password).await?;
    Ok(ok())
}
