//! REST API of the lifecycle of the tenants and of the operations (Administrator; see
//! `docs/architecture.md`, "Lifecycle of the tenants" and "Operations"):
//! - tenants: what they hold, trial period, archive, deletion, export and import;
//! - backups: list, run now, download, delete, schedule, restore of one tenant or of one item;
//! - maintenance mode;
//! - monitoring: services, performance, errors, tenants, capacity, alerts; metrics as text.

use std::path::PathBuf;

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use mosaikit_kernel::ops::{backup, backup_item, maintenance, metrics, monitor};
use mosaikit_kernel::tenancy::lifecycle;
use mosaikit_kernel::transfer::{self, ImportOptions};
use mosaikit_kernel::{tenancy, Error};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::api::{ok, uuid};
use crate::auth::Auth;
use crate::{ApiError, ApiResult, AppState};

/// Imports of tenants: up to 4 GB.
const IMPORT_LIMIT: usize = 4 << 30;

pub fn router() -> Router<AppState> {
    let imports = Router::new()
        .route("/api/admin/tenants/import", post(a_import))
        .layer(DefaultBodyLimit::max(IMPORT_LIMIT));
    Router::new()
        // tenants
        .route("/api/admin/tenants/{id}/impact", get(a_impact))
        .route("/api/admin/tenants/{id}/trial", put(a_trial))
        .route("/api/admin/tenants/{id}/archive", post(a_archive))
        .route("/api/admin/tenants/{id}/delete", post(a_delete))
        .route("/api/admin/tenants/{id}/export", post(a_export))
        .route("/api/admin/exports/{name}", get(a_export_file))
        // backups
        .route("/api/admin/backups", get(a_backups).post(a_backup_now))
        .route("/api/admin/backups/settings", get(a_backup_settings).put(a_set_backup_settings))
        .route("/api/admin/backups/{id}", axum::routing::delete(a_backup_delete))
        .route("/api/admin/backups/{id}/file", get(a_backup_file))
        .route("/api/admin/backups/{id}/tenants", get(a_backup_tenants))
        .route("/api/admin/backups/{id}/restore", post(a_backup_restore))
        .route("/api/admin/backups/{id}/tenants/{slug}/items", get(a_backup_items))
        .route("/api/admin/backups/{id}/tenants/{slug}/items/{rid}/restore", post(a_backup_item_restore))
        // maintenance
        .route("/api/admin/maintenance", get(a_maintenance).put(a_set_maintenance))
        // monitoring
        .route("/api/admin/monitoring/status", get(a_status))
        .route("/api/admin/monitoring/performance", get(a_performance))
        .route("/api/admin/monitoring/errors", get(a_errors))
        .route("/api/admin/monitoring/tenants", get(a_tenants_load))
        .route("/api/admin/monitoring/capacity", get(a_capacity))
        .route("/api/admin/monitoring/alerts", get(a_alerts).put(a_set_alerts))
        .route("/api/admin/metrics", get(a_metrics))
        .route("/metrics", get(prometheus))
        .merge(imports)
}

fn admin(u: &mosaikit_kernel::SessionUser) -> ApiResult<()> {
    tenancy::require_admin(u).map_err(ApiError)
}

// ------------------------------------------------------------------ tenants

async fn a_impact(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(lifecycle::impact(&s.k, &u, uuid(&id)?).await?)))
}

#[derive(Deserialize)]
struct TrialReq {
    until: Option<DateTime<Utc>>,
}

async fn a_trial(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(r): Json<TrialReq>,
) -> ApiResult<Json<Value>> {
    lifecycle::set_trial(&s.k, &u, uuid(&id)?, r.until).await?;
    Ok(ok())
}

async fn a_archive(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    lifecycle::archive(&s.k, &u, uuid(&id)?).await?;
    Ok(ok())
}

#[derive(Deserialize)]
struct DeleteReq {
    confirm: String,
}

async fn a_delete(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(r): Json<DeleteReq>,
) -> ApiResult<Json<Value>> {
    lifecycle::delete(&s.k, &u, uuid(&id)?, &r.confirm).await?;
    Ok(ok())
}

async fn a_export(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let (path, manifest) = transfer::export_tenant(&s.k, &u, uuid(&id)?).await?;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(Json(json!({ "file": name, "size": size, "manifest": manifest })))
}

/// A zip on disk as the download response.
async fn download(path: PathBuf, name: &str) -> ApiResult<Response> {
    let f = tokio::fs::File::open(&path).await.map_err(|_| ApiError(Error::not_found("file not found")))?;
    let len = f.metadata().await.map(|m| m.len()).unwrap_or(0);
    let body = Body::from_stream(tokio_util::io::ReaderStream::new(f));
    let mut res = (StatusCode::OK, body).into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"));
    h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
    let disp = format!("attachment; filename=\"{}\"", name.replace(['"', '\\', '\r', '\n'], "_"));
    if let Ok(v) = HeaderValue::from_str(&disp) {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(res)
}

async fn a_export_file(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(name): Path<String>,
) -> ApiResult<Response> {
    admin(&u)?;
    if name.contains(['/', '\\']) || name.starts_with('.') || !name.ends_with(".zip") {
        return Err(crate::bad("invalid name"));
    }
    download(transfer::exports_dir(&s.k).join(&name), &name).await
}

/// Import of an export (the zip is the body of the request).
async fn a_import(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(opts): Query<ImportOptions>,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    admin(&u)?;
    if body.is_empty() {
        return Err(crate::bad("the export is empty"));
    }
    let dir = transfer::exports_dir(&s.k);
    std::fs::create_dir_all(&dir).map_err(|e| ApiError(e.into()))?;
    let tmp = dir.join(format!(".import-{}.zip", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, &body).map_err(|e| ApiError(e.into()))?;
    let r = transfer::import_tenant(&s.k, &u, &tmp, "", &opts).await;
    let _ = std::fs::remove_file(&tmp);
    Ok(Json(json!(r?)))
}

// ------------------------------------------------------------------ backups

async fn a_backups(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    let list = backup::list(&s.k, &u).await?;
    let settings = backup::config(&s.k).await?;
    let running = s.k.ops.backup_running.load(std::sync::atomic::Ordering::SeqCst);
    Ok(Json(json!({ "backups": list, "settings": settings, "running": running })))
}

/// Starts a backup in the background: the list shows it running, then done or failed.
async fn a_backup_now(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Response> {
    admin(&u)?;
    if s.k.ops.backup_running.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(ApiError(Error::conflict("a backup is already running").with_code("backup_running")));
    }
    let k = s.k.clone();
    tokio::spawn(async move {
        if let Err(e) = backup::run(&k, Some(&u)).await {
            tracing::warn!("backup: {e}");
        }
    });
    Ok((StatusCode::ACCEPTED, Json(json!({ "started": true }))).into_response())
}

async fn a_backup_settings(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    admin(&u)?;
    Ok(Json(json!(backup::config(&s.k).await?)))
}

async fn a_set_backup_settings(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(c): Json<backup::BackupConfig>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(backup::set_config(&s.k, &u, &c).await?)))
}

async fn a_backup_delete(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    backup::delete(&s.k, &u, uuid(&id)?).await?;
    Ok(ok())
}

async fn a_backup_file(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let p = backup::file(&s.k, &u, uuid(&id)?).await?;
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    download(p, &name).await
}

async fn a_backup_tenants(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(backup::tenants(&s.k, &u, uuid(&id)?).await?)))
}

#[derive(Deserialize)]
struct RestoreReq {
    slug: String,
    #[serde(default)]
    replace: bool,
}

async fn a_backup_restore(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path(id): Path<String>,
    Json(r): Json<RestoreReq>,
) -> ApiResult<Json<Value>> {
    let rep =
        backup::restore_tenant(&s.k, &u, uuid(&id)?, &r.slug, &ImportOptions { replace: r.replace }).await?;
    Ok(Json(json!(rep)))
}

/// The items of a tenant in a backup (search by title, app, owner).
async fn a_backup_items(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path((id, slug)): Path<(String, String)>,
    Query(q): Query<backup_item::ItemQuery>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(backup_item::items(&s.k, &u, uuid(&id)?, &slug, &q).await?)))
}

/// One item restored from a backup (`mode` when it is still in the tenant: `copy` or `replace`).
async fn a_backup_item_restore(
    State(s): State<AppState>,
    Auth(u): Auth,
    Path((id, slug, rid)): Path<(String, String, String)>,
    Json(r): Json<backup_item::ItemRestore>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(backup_item::restore(&s.k, &u, uuid(&id)?, &slug, uuid(&rid)?, &r).await?)))
}

// ------------------------------------------------------------------ maintenance

async fn a_maintenance(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    admin(&u)?;
    Ok(Json(json!(maintenance::get(&s.k).await?)))
}

async fn a_set_maintenance(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(m): Json<maintenance::Maintenance>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(maintenance::set(&s.k, &u, &m).await?)))
}

// ------------------------------------------------------------------ monitoring

#[derive(Deserialize)]
struct PeriodQ {
    #[serde(default)]
    period: String,
}

async fn a_status(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    admin(&u)?;
    let services = monitor::services(&s.k).await?;
    let ticks = s.k.ops.ticks();
    Ok(Json(json!({
        "services": services,
        "kernel": mosaikit_kernel::KERNEL_VERSION,
        "uptime_s": s.k.ops.uptime().as_secs(),
        "jobs": ticks,
    })))
}

async fn a_performance(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(q): Query<PeriodQ>,
) -> ApiResult<Json<Value>> {
    admin(&u)?;
    Ok(Json(json!({ "points": metrics::series(&s.k, &q.period).await? })))
}

async fn a_errors(
    State(s): State<AppState>,
    Auth(u): Auth,
    Query(q): Query<PeriodQ>,
) -> ApiResult<Json<Value>> {
    admin(&u)?;
    Ok(Json(json!(monitor::errors(&s.k, &q.period).await?)))
}

async fn a_tenants_load(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    admin(&u)?;
    Ok(Json(json!(monitor::tenants(&s.k).await?)))
}

async fn a_capacity(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    admin(&u)?;
    Ok(Json(json!(monitor::capacity(&s.k).await?)))
}

async fn a_alerts(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Json<Value>> {
    admin(&u)?;
    Ok(Json(json!({
        "settings": monitor::alert_config(&s.k).await?,
        "states": monitor::alert_states(&s.k).await?,
    })))
}

async fn a_set_alerts(
    State(s): State<AppState>,
    Auth(u): Auth,
    Json(c): Json<monitor::AlertConfig>,
) -> ApiResult<Json<Value>> {
    Ok(Json(json!(monitor::set_alert_config(&s.k, &u, &c).await?)))
}

fn text(body: String) -> Response {
    let mut res = body.into_response();
    res.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"));
    res
}

async fn a_metrics(State(s): State<AppState>, Auth(u): Auth) -> ApiResult<Response> {
    admin(&u)?;
    Ok(text(metrics::prometheus(&s.k).await?))
}

/// The metrics for a Prometheus server: only with `MOSAIKIT_METRICS_TOKEN` set and sent as
/// `Authorization: Bearer <token>`; otherwise the address does not exist.
async fn prometheus(State(s): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let Some(token) = std::env::var("MOSAIKIT_METRICS_TOKEN").ok().filter(|t| t.len() >= 16) else {
        return Err(ApiError(Error::not_found("not found")));
    };
    let sent = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !constant_eq(sent.as_bytes(), token.as_bytes()) {
        return Err(ApiError(Error::unauthorized("invalid token")));
    }
    Ok(text(metrics::prometheus(&s.k).await?))
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
