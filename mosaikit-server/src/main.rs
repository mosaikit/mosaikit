//! Mosaikit server REST — adapter HTTP sul kernel (MosaikitApp).
//!
//!   POST   /login                        {"username","password"} -> {"token"}
//!   POST   /logout                       (Bearer)
//!   GET    /plugins                      elenco installati + stato attivo
//!   POST   /plugins/install              body raw = .mskp (max 32 MB)
//!   POST   /plugins/{id}/activate
//!   POST   /plugins/{id}/deactivate
//!   DELETE /plugins/{id}                 disinstalla
//!   GET    /resources/{view}             righe CRUD (?filter=...)
//!   POST   /resources/{view}/rows        {"values":{...}}
//!   PUT    /resources/{view}/rows/{id}   {"values":{...}}
//!   DELETE /resources/{view}/rows/{id}
//!
//! Storage file dei plugin (permesso "storage.files" nel manifest, plugin
//! attivo; root condivisa data_dir/plugin-data/<id>/files):
//!   POST   /plugins/{id}/storage/unzip?path=   body raw = zip -> estrae in path
//!   POST   /plugins/{id}/storage/delete        {"path"}
//!   POST   /plugins/{id}/storage/ticket        {"path"} -> {"ticket","base"}
//!   GET    /plugins/{id}/storage/t/{ticket}/{*path}   serve i file (iframe)
//!
//! Nota: usa HeadlessEngine (nessun runtime WASM): le viste funzionano
//! tramite manifest; con il runtime wasmtime le operazioni passano sandbox.
//!
//! La UI React (sorgenti in `../mosaikit-ui`) viene servita embedded dal
//! binario via rust-embed (fallback handler `ui` → dist/). In dev si puo'
//! usare il dev server Vite su :5173 con proxy delle API su :8080 (HMR).

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;
use axum::extract::DefaultBodyLimit;
use axum::http::{header, HeaderValue, Method, Uri};
use axum::response::{Html, IntoResponse, Response};
use mosaikit_kernel::auth::Auth;
use mosaikit_kernel::engine::HeadlessEngine;
use mosaikit_kernel::model::ContentArea;
use mosaikit_kernel::vfs::Vfs;
use mosaikit_kernel::{MosaikitApp, Registry};

type Shared = Arc<Mutex<MosaikitApp<HeadlessEngine>>>;

struct AppState {
    app: Shared,
    /// istante di avvio del processo (epoch ms): cambia a ogni restart,
    /// la UI in debug lo usa per ricaricarsi da sola
    started: u64,
    /// ticket di lettura dello storage plugin (vedi `storage_ticket`)
    tickets: std::sync::Mutex<HashMap<String, Ticket>>,
}

/// Accesso in sola lettura a una cartella dello storage di un plugin.
/// Un iframe non puo' inviare l'header Bearer: il ticket nel path lo
/// sostituisce per la pagina e per tutte le sue risorse relative.
struct Ticket {
    plugin_id: String,
    prefix: String,
    /// sessione che l'ha emesso: logout o scadenza invalidano il ticket
    session: String,
    expires: u64,
}

const TICKET_TTL_SECS: u64 = 8 * 3600;
const STORAGE_PERMISSION: &str = "storage.files";

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
}

type ApiError = (StatusCode, String);

fn err(e: impl std::fmt::Display) -> ApiError {
    (StatusCode::BAD_REQUEST, e.to_string())
}

fn token(h: &HeaderMap) -> Result<String, ApiError> {
    h.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(str::to_string)
        .ok_or((StatusCode::UNAUTHORIZED, "missing Bearer token".to_string()))
}

#[derive(Deserialize)]
struct LoginReq {
    username: String,
    password: String,
}

async fn login(State(st): State<Arc<AppState>>, Json(body): Json<LoginReq>) -> Result<Json<Value>, ApiError> {
    let mut app = st.app.lock().await;
    match app.login(&body.username, &body.password) {
        Ok(t) => {
            let user = app.auth.session_public(&t).map(|s| s.username.clone()).unwrap_or_default();
            Ok(Json(json!({"token": t, "username": user})))
        }
        Err(e) => Err((StatusCode::UNAUTHORIZED, e.to_string())),
    }
}

async fn logout(State(st): State<Arc<AppState>>, h: HeaderMap) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    st.app.lock().await.logout(&t);
    Ok(Json(json!({"ok": true})))
}

async fn list_plugins(State(st): State<Arc<AppState>>, h: HeaderMap) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    let app = st.app.lock().await;
    // verifica autenticazione (CrudRead basta anche a User)
    app.auth.session_public(&t).ok_or((StatusCode::UNAUTHORIZED, "sessione non valida".to_string()))?;
    let plugins: Vec<Value> = app.registry.list().iter()
        .map(|m| json!({
            "id": m.id, "name": m.name, "version": m.version,
            "active": app.is_active(&m.id),
            "icon": m.contribution.icon, "label": m.contribution.label,
            "kind": m.contribution.kind,
            "has_ui": m.ui && app.registry.has_ui(&m.id),
            "view": m.contribution.resource.name,
            "permissions": m.permissions,
        }))
        .collect();
    Ok(Json(json!({"plugins": plugins})))
}

async fn install(State(st): State<Arc<AppState>>, h: HeaderMap, body: Bytes) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    let mut app = st.app.lock().await;
    let m = app.install_plugin(&t, &body).map_err(err)?;
    Ok(Json(json!({"installed": m.id, "name": m.name, "version": m.version})))
}

async fn activate(State(st): State<Arc<AppState>>, h: HeaderMap, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    st.app.lock().await.activate_plugin(&t, &id).map_err(err)?;
    Ok(Json(json!({"active": id})))
}

async fn deactivate(State(st): State<Arc<AppState>>, h: HeaderMap, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    st.app.lock().await.deactivate_plugin(&t, &id).map_err(err)?;
    Ok(Json(json!({"inactive": id})))
}

async fn uninstall(State(st): State<Arc<AppState>>, h: HeaderMap, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    st.app.lock().await.uninstall_plugin(&t, &id).map_err(err)?;
    Ok(Json(json!({"uninstalled": id})))
}

/// Apre la vista (serve plugin attivo) e restituisce le righe.
async fn list_rows(
    State(st): State<Arc<AppState>>,
    h: HeaderMap,
    Path(view): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    let mut app = st.app.lock().await;
    app.open_view(&t, &view).map_err(err)?;
    if let Some(f) = q.get("filter") {
        app.set_filter(f.clone()).map_err(err)?;
    }
    match &app.content {
        ContentArea::Crud(v) => {
            use mosaikit_kernel::model::FieldKind;
            let fields: Vec<Value> = v.resource.fields.iter().map(|f| json!({
                "key": f.key, "label": f.label,
                "kind": match f.kind {
                    FieldKind::Text => "text", FieldKind::Number => "number",
                    FieldKind::Bool => "bool", FieldKind::Date => "date",
                    FieldKind::Choice => "choice",
                },
                "required": f.required, "multiline": f.multiline, "options": f.options,
            })).collect();
            let rows: Vec<Value> = v.rows.iter().map(|r| {
                let values: serde_json::Map<String, Value> = r.values.iter()
                    .map(|(k, val)| (k.clone(), Value::String(val.display())))
                    .collect();
                json!({"id": r.id, "values": values})
            }).collect();
            Ok(Json(json!({"resource": view, "fields": fields, "rows": rows})))
        }
        _ => Err(err("vista non disponibile")),
    }
}

#[derive(Deserialize)]
struct RowReq {
    values: BTreeMap<String, String>,
}

async fn create_row(
    State(st): State<Arc<AppState>>,
    h: HeaderMap,
    Path(view): Path<String>,
    Json(body): Json<RowReq>,
) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    let mut app = st.app.lock().await;
    app.open_view(&t, &view).map_err(err)?;
    let row = app.crud_create(&t, &body.values).map_err(err)?;
    Ok(Json(json!({"created": row.id})))
}

async fn update_row(
    State(st): State<Arc<AppState>>,
    h: HeaderMap,
    Path((view, id)): Path<(String, u64)>,
    Json(body): Json<RowReq>,
) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    let mut app = st.app.lock().await;
    app.open_view(&t, &view).map_err(err)?;
    app.crud_update(&t, id, &body.values).map_err(err)?;
    Ok(Json(json!({"updated": id})))
}

async fn delete_row(
    State(st): State<Arc<AppState>>,
    h: HeaderMap,
    Path((view, id)): Path<(String, u64)>,
) -> Result<Json<Value>, ApiError> {
    let t = token(&h)?;
    let mut app = st.app.lock().await;
    app.open_view(&t, &view).map_err(err)?;
    app.crud_delete(&t, id).map_err(err)?;
    Ok(Json(json!({"deleted": id})))
}

/// UI React compilata, sorgenti in `../mosaikit-ui` (`npm run build` → dist).
/// In debug i file sono letti da disco a ogni richiesta (iterazione rapida
/// senza ricompilare il server); in release sono embedded nel binario.
#[derive(rust_embed::Embed)]
#[folder = "../mosaikit-ui/dist/"]
struct UiAssets;

/// Live reload per il dev: poll leggero su /api e reload quando `started`
/// cambia (cioe' il server e' stato ricompilato e riavviato). Iniettato
/// solo nelle build debug (`cfg!(debug_assertions)`), in release il branch
/// e' eliminato dal compilatore.
const RELOAD_SNIPPET: &str = r#"<script>
(() => {
  let started = null;
  setInterval(async () => {
    try {
      const j = await (await fetch("/api", { cache: "no-store" })).json();
      if (started === null) started = j.started;
      else if (j.started !== started) location.reload();
    } catch (e) { /* server in riavvio */ }
  }, 1500);
})();
</script>"#;

/// Serve la UI: file statici embedded e, per i percorsi sconosciuti,
/// fallback SPA su index.html. Metodi diversi da GET/HEAD restano 404,
/// così le chiamate API a route inesistenti non ricevono HTML.
async fn ui(uri: Uri, method: Method) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mut path = uri.path().trim_start_matches('/').to_string();
    if path.is_empty() {
        path.push_str("index.html");
    }
    if path.contains("..") || path.contains('\\') {
        return StatusCode::NOT_FOUND.into_response();
    }

    let (file, is_index) = match UiAssets::get(&path) {
        Some(f) if path != "index.html" => (f, false),
        // percorso sconosciuto (o richiesta esplicita di index.html):
        // fallback SPA, il client-side routing gestisce il percorso
        _ => match UiAssets::get("index.html") {
            Some(f) => (f, true),
            None => return (
                StatusCode::NOT_FOUND,
                "UI non compilata: esegui 'npm run build' in mosaikit-ui/",
            ).into_response(),
        },
    };

    if is_index {
        let mut html = String::from_utf8_lossy(&file.data).into_owned();
        if cfg!(debug_assertions) {
            // live reload anche per chi apre :8080 direttamente con la build
            // embedded (con Vite in dev a fare il reload e' la UI stessa)
            html = html.replace("</body>", &format!("{RELOAD_SNIPPET}</body>"));
        }
        let mut res = Html(html).into_response();
        res.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
        res
    } else {
        let mime = mime_guess::from_path(&path).first_or_octet_stream();
        let mut res = Response::new(file.data.into_owned().into());
        res.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(mime.as_ref()).expect("mime valido"),
        );
        if path.starts_with("assets/") {
            // nomi dei file hashati da Vite: caching aggressivo sicuro
            res.headers_mut().insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
        }
        res
    }
}

async fn api_info(State(st): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({"service": "mosaikit-server", "version": "0.1.0", "started": st.started}))
}


// ---------------------------------------------------------------------------
// File manager — VFS sandboxato per utente (root: data_dir/users/<user>/files)
// ---------------------------------------------------------------------------

async fn vfs_for(st: &AppState, h: &HeaderMap, write: bool) -> Result<(Vfs, String), ApiError> {
    let t = token(h)?;
    let app = st.app.lock().await;
    let session = app.auth.session_public(&t)
        .ok_or((StatusCode::UNAUTHORIZED, "sessione non valida".to_string()))?;
    let username = session.username.clone();
    let action = if write { mosaikit_kernel::auth::Action::CrudWrite }
                 else { mosaikit_kernel::auth::Action::CrudRead };
    app.auth.require(&t, action).map_err(|e| (StatusCode::FORBIDDEN, e.to_string()))?;
    let data_dir = app.registry.data_dir.clone();
    drop(app);
    Vfs::new(&data_dir, &username).map(|v| (v, username)).map_err(err)
}

async fn files_list(st: State<Arc<AppState>>, h: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let path = q.get("path").cloned().unwrap_or_default();
    let (vfs, _) = vfs_for(&st, &h, false).await?;
    let items: Vec<Value> = vfs.list(&path).map_err(err)?.iter().map(|e| json!({
        "name": e.name, "is_dir": e.is_dir, "size": e.size, "modified": e.modified })).collect();
    Ok(Json(json!({ "path": path, "entries": items })))
}

async fn files_stat(st: State<Arc<AppState>>, h: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let path = q.get("path").cloned().unwrap_or_default();
    let (vfs, _) = vfs_for(&st, &h, false).await?;
    let s = vfs.stat(&path).map_err(err)?;
    Ok(Json(json!({ "path": path, "is_dir": s.is_dir, "size": s.size, "modified": s.modified,
        "files": s.files, "dirs": s.dirs })))
}

async fn files_mkdir(st: State<Arc<AppState>>, h: HeaderMap, Json(b): Json<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let (vfs, _) = vfs_for(&st, &h, true).await?;
    vfs.mkdir(b.get("path").map(String::as_str).unwrap_or(""), b.get("name").ok_or(err("manca name"))?).map_err(err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn files_rename(st: State<Arc<AppState>>, h: HeaderMap, Json(b): Json<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let (vfs, _) = vfs_for(&st, &h, true).await?;
    vfs.rename(b.get("path").ok_or(err("manca path"))?, b.get("name").ok_or(err("manca name"))?).map_err(err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn files_delete(st: State<Arc<AppState>>, h: HeaderMap, Json(b): Json<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let (vfs, _) = vfs_for(&st, &h, true).await?;
    vfs.delete(b.get("path").ok_or(err("manca path"))?).map_err(err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn files_move(st: State<Arc<AppState>>, h: HeaderMap, Json(b): Json<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let (vfs, _) = vfs_for(&st, &h, true).await?;
    vfs.move_item(b.get("from").ok_or(err("manca from"))?, b.get("to").ok_or(err("manca to"))?).map_err(err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn files_copy(st: State<Arc<AppState>>, h: HeaderMap, Json(b): Json<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let (vfs, _) = vfs_for(&st, &h, true).await?;
    vfs.copy_item(b.get("from").ok_or(err("manca from"))?, b.get("to").ok_or(err("manca to"))?).map_err(err)?;
    Ok(Json(json!({ "ok": true })))
}

async fn files_upload(st: State<Arc<AppState>>, h: HeaderMap, Query(q): Query<HashMap<String, String>>, body: Bytes) -> Result<Json<Value>, ApiError> {
    let (vfs, _) = vfs_for(&st, &h, true).await?;
    let path = q.get("path").ok_or(err("manca path"))?;
    let size = vfs.write_file(path, &body).map_err(err)?;
    Ok(Json(json!({ "uploaded": path, "size": size })))
}

fn mime_of(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8", "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8", "json" | "geojson" => "application/json",
        "txt" | "md" | "log" | "csv" | "tsv" | "xml" | "yaml" | "yml" | "toml" | "ini" | "rs"
        | "ts" | "tsx" | "jsx" | "py" | "sh" | "sql" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif", "webp" => "image/webp", "bmp" => "image/bmp", "ico" => "image/x-icon",
        "avif" => "image/avif", "pdf" => "application/pdf",
        "mp4" => "video/mp4", "webm" => "video/webm", "ogv" => "video/ogg", "mov" => "video/quicktime",
        "mp3" => "audio/mpeg", "wav" => "audio/wav", "ogg" | "oga" => "audio/ogg", "m4a" => "audio/mp4",
        "flac" => "audio/flac", "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

/// Content-Disposition con fallback ASCII e nome UTF-8 (RFC 6266/5987).
fn content_disposition(kind: &str, name: &str) -> String {
    let ascii: String = name.chars()
        .map(|c| if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' { c } else { '_' })
        .collect();
    let enc: String = name.bytes().map(|b| {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }
    }).collect();
    format!("{kind}; filename=\"{ascii}\"; filename*=UTF-8''{enc}")
}

async fn files_download(st: State<Arc<AppState>>, h: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Result<Response, ApiError> {
    let (vfs, _) = vfs_for(&st, &h, false).await?;
    let path = q.get("path").ok_or(err("manca path"))?;
    let data = vfs.read_file(path).map_err(err)?;
    let name = path.rsplit('/').next().unwrap_or("file");
    Ok(Response::builder()
        .header("Content-Type", mime_of(name))
        .header("Content-Disposition", content_disposition("attachment", name))
        .body(axum::body::Body::from(data)).map_err(err)?)
}

async fn files_zip(st: State<Arc<AppState>>, h: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Result<Response, ApiError> {
    let path = q.get("path").cloned().unwrap_or_default();
    let (vfs, _) = vfs_for(&st, &h, false).await?;
    let data = vfs.zip_dir(&path).map_err(err)?;
    let name = format!("{}.zip", path.rsplit('/').find(|s| !s.is_empty()).unwrap_or("files"));
    Ok(Response::builder()
        .header("Content-Type", "application/zip")
        .header("Content-Disposition", content_disposition("attachment", &name))
        .body(axum::body::Body::from(data)).map_err(err)?)
}

async fn files_preview(st: State<Arc<AppState>>, h: HeaderMap, Query(q): Query<HashMap<String, String>>) -> Result<Response, ApiError> {
    let (vfs, _) = vfs_for(&st, &h, false).await?;
    let path = q.get("path").ok_or(err("manca path"))?;
    let data = vfs.read_file(path).map_err(err)?;
    let name = path.rsplit('/').next().unwrap_or("file");
    Ok(Response::builder()
        .header("Content-Type", mime_of(name))
        .header("Content-Disposition", content_disposition("inline", name))
        .body(axum::body::Body::from(data)).map_err(err)?)
}


// ---------------------------------------------------------------------------
// Storage dei plugin — area file condivisa per plugin (data_dir/plugin-data/<id>)
// ---------------------------------------------------------------------------

/// Storage del plugin `id`: serve sessione valida con permesso di
/// lettura/scrittura CRUD, plugin attivo e permesso "storage.files" nel manifest.
async fn plugin_storage(st: &AppState, h: &HeaderMap, id: &str, write: bool) -> Result<(Vfs, String), ApiError> {
    use mosaikit_kernel::auth::{Action, AuthError};
    let t = token(h)?;
    let app = st.app.lock().await;
    let action = if write { Action::CrudWrite } else { Action::CrudRead };
    app.auth.require(&t, action).map_err(|e| match e {
        AuthError::Unauthorized { .. } => (StatusCode::FORBIDDEN, e.to_string()),
        _ => (StatusCode::UNAUTHORIZED, e.to_string()),
    })?;
    if !app.is_active(id) {
        return Err((StatusCode::NOT_FOUND, format!("plugin non attivo: {id}")));
    }
    let m = app.registry.load_manifest(id).map_err(err)?;
    if !m.permissions.iter().any(|p| p == STORAGE_PERMISSION) {
        return Err((StatusCode::FORBIDDEN, format!("il plugin non dichiara il permesso {STORAGE_PERMISSION}")));
    }
    let data_dir = app.registry.data_dir.clone();
    drop(app);
    Vfs::for_plugin(&data_dir, id).map(|v| (v, t)).map_err(err)
}

async fn storage_unzip(st: State<Arc<AppState>>, h: HeaderMap, Path(id): Path<String>, Query(q): Query<HashMap<String, String>>, body: Bytes) -> Result<Json<Value>, ApiError> {
    let (vfs, _) = plugin_storage(&st, &h, &id, true).await?;
    let path = q.get("path").ok_or(err("manca path"))?;
    let files = vfs.unzip(path, &body).map_err(err)?;
    let size: u64 = files.iter().map(|f| f.1).sum();
    let list: Vec<Value> = files.iter().map(|(p, s)| json!({ "path": p, "size": s })).collect();
    Ok(Json(json!({ "path": path, "files": list, "count": files.len(), "size": size })))
}

async fn storage_delete(st: State<Arc<AppState>>, h: HeaderMap, Path(id): Path<String>, Json(b): Json<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let (vfs, _) = plugin_storage(&st, &h, &id, true).await?;
    let path = b.get("path").map(|p| p.trim_matches('/')).unwrap_or("");
    if path.is_empty() { return Err(err("manca path")); }
    vfs.delete(path).map_err(err)?;
    st.tickets.lock().unwrap().retain(|_, t| !(t.plugin_id == id && t.prefix == path));
    Ok(Json(json!({ "ok": true })))
}

/// Emette un ticket di lettura per una cartella dello storage: la UI lo usa
/// come base URL dell'iframe (`base` + percorso relativo del file).
async fn storage_ticket(st: State<Arc<AppState>>, h: HeaderMap, Path(id): Path<String>, Json(b): Json<HashMap<String, String>>) -> Result<Json<Value>, ApiError> {
    let (vfs, session) = plugin_storage(&st, &h, &id, false).await?;
    let prefix = b.get("path").map(|p| p.trim_matches('/').to_string()).unwrap_or_default();
    if prefix.is_empty() || !vfs.is_dir(&prefix) { return Err((StatusCode::NOT_FOUND, format!("cartella inesistente: {prefix}"))); }
    let ticket = mosaikit_kernel::auth::random_token(24);
    let now = now_secs();
    let mut tickets = st.tickets.lock().unwrap();
    tickets.retain(|_, t| t.expires > now);
    tickets.insert(ticket.clone(), Ticket { plugin_id: id.clone(), prefix, session, expires: now + TICKET_TTL_SECS });
    Ok(Json(json!({ "ticket": ticket, "base": format!("/plugins/{id}/storage/t/{ticket}/"), "expires_in": TICKET_TTL_SECS })))
}

async fn storage_serve_root(st: State<Arc<AppState>>, uri: Uri, Path((id, ticket)): Path<(String, String)>) -> Response {
    storage_serve_file(&st, &uri, &id, &ticket, "").await
}

async fn storage_serve(st: State<Arc<AppState>>, uri: Uri, Path((id, ticket, path)): Path<(String, String, String)>) -> Response {
    storage_serve_file(&st, &uri, &id, &ticket, &path).await
}

/// Serve un file dello storage tramite ticket. Il contenuto e' caricato
/// dagli utenti: CSP `sandbox` (origine opaca anche se aperto fuori
/// dall'iframe, niente accesso a localStorage/token della web app),
/// no-referrer (il ticket non trapela verso siti esterni), nosniff.
async fn storage_serve_file(st: &AppState, uri: &Uri, id: &str, ticket: &str, path: &str) -> Response {
    let not_found = || (StatusCode::NOT_FOUND, "non trovato").into_response();
    let (prefix, session) = match st.tickets.lock().unwrap().get(ticket) {
        Some(t) if t.plugin_id == id && t.expires > now_secs() => (t.prefix.clone(), t.session.clone()),
        _ => return (StatusCode::FORBIDDEN, "ticket non valido o scaduto: riapri il contenuto").into_response(),
    };
    let app = st.app.lock().await;
    if app.auth.session_public(&session).is_none() || !app.is_active(id) {
        return (StatusCode::FORBIDDEN, "sessione scaduta o plugin non attivo").into_response();
    }
    let data_dir = app.registry.data_dir.clone();
    drop(app);
    let Ok(vfs) = Vfs::for_plugin(&data_dir, id) else { return not_found() };
    let mut rel = format!("{prefix}/{}", path.trim_start_matches('/'));
    if vfs.is_dir(&rel) {
        // cartella: senza "/" finale gli URL relativi della pagina si
        // risolverebbero rispetto alla cartella padre
        if !rel.ends_with('/') {
            let loc = format!("{}/", uri.path());
            return (StatusCode::MOVED_PERMANENTLY, [(header::LOCATION, loc)]).into_response();
        }
        rel.push_str("index.html");
    }
    let Ok(data) = vfs.read_file(&rel) else { return not_found() };
    let mime = mime_guess::from_path(&rel).first_or_octet_stream();
    Response::builder()
        .header(header::CONTENT_TYPE, mime.essence_str())
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Content-Type-Options", "nosniff")
        .header("Referrer-Policy", "no-referrer")
        .header("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads")
        .body(axum::body::Body::from(data))
        .unwrap_or_else(|_| not_found())
}

async fn serve_plugin_ui(st: State<Arc<AppState>>, _h: HeaderMap, Path(id): Path<String>) -> Result<Response, ApiError> {
    // ui.js = codice trusted del plugin (modello GeoLibre). Servito PUBBLICO:
    // la pagina lo carica come risorsa <script>/fetch senza header custom
    // (anche via proxy Vite). L'autenticazione vera resta sulle chiamate API
    // che il plugin effettua tramite api.get/post/upload (Bearer token).
    let app = st.app.lock().await;
    let data = app.registry.read_ui(&id).map_err(|_| (StatusCode::NOT_FOUND, "ui.js non trovato".to_string()))?;
    drop(app);
    Ok(Response::builder()
        .header("Content-Type", "text/javascript; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .body(axum::body::Body::from(data)).map_err(err)?)
}

#[tokio::main]
async fn main() {
    let started = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    let state = Arc::new(AppState {
        app: Arc::new(Mutex::new(MosaikitApp::new(
            Auth::seeded_persisted(std::path::Path::new("../mosaikit-data")),
            Registry::new("../mosaikit-data"),
            HeadlessEngine,
        ))),
        started,
        tickets: std::sync::Mutex::new(HashMap::new()),
    });

    let router = Router::new()
        .route("/api", get(api_info))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/plugins", get(list_plugins))
        .route("/plugins/install", post(install))
        .route("/plugins/{id}/activate", post(activate))
        .route("/plugins/{id}/deactivate", post(deactivate))
        .route("/plugins/{id}", delete(uninstall))
        .route("/resources/{view}", get(list_rows))
        .route("/resources/{view}/rows", post(create_row))
        .route("/resources/{view}/rows/{id}", delete(delete_row).put(update_row))
        .route("/files/list", get(files_list))
        .route("/files/stat", get(files_stat))
        .route("/files/zip", get(files_zip))
        .route("/files/mkdir", post(files_mkdir))
        .route("/files/rename", post(files_rename))
        .route("/files/delete", post(files_delete))
        .route("/files/move", post(files_move))
        .route("/files/copy", post(files_copy))
        .route("/files/upload", post(files_upload))
        .route("/files/download", get(files_download))
        .route("/files/preview", get(files_preview))
        .route("/plugins/{id}/ui.js", get(serve_plugin_ui))
        .route("/plugins/{id}/storage/unzip", post(storage_unzip))
        .route("/plugins/{id}/storage/delete", post(storage_delete))
        .route("/plugins/{id}/storage/ticket", post(storage_ticket))
        .route("/plugins/{id}/storage/t/{ticket}/", get(storage_serve_root))
        .route("/plugins/{id}/storage/t/{ticket}/{*path}", get(storage_serve))
        .fallback(ui)
        .layer(CorsLayer::permissive())
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await
        .unwrap_or_else(|e| panic!("bind {addr}: {e} — porta occupata? usa PORT=8081 cargo run"));
    println!("Mosaikit server in ascolto su http://{addr}");
    axum::serve(listener, router).await.unwrap();
}
