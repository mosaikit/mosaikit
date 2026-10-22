//! HTTP server of Mosaikit.
//!
//! Two listeners, two origins (see `docs/architecture.md` §9):
//! - **app** (`bind`): host UI and API, `HttpOnly` session cookie, CSRF;
//! - **untrusted** (`untrusted_bind`): UI of the plugins, contents uploaded by the
//!   users (always with CSP `sandbox`), public links.

pub mod admin;
pub(crate) mod api;
mod auth;
mod pages;
mod ui;
mod untrusted;

use std::sync::Arc;

use axum::http::{header, HeaderName, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use mosaikit_kernel::{Kernel, Kind};

pub use auth::SESSION_COOKIE;

#[derive(Clone)]
pub struct AppState {
    pub k: Arc<Kernel>,
}

/// HTTP error with a JSON body `{"error": "...", "code": "..."}`: the code is stable, the message is not.
#[derive(Debug)]
pub struct ApiError(pub mosaikit_kernel::Error);

impl From<mosaikit_kernel::Error> for ApiError {
    fn from(e: mosaikit_kernel::Error) -> ApiError {
        ApiError(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self.0.kind {
            Kind::BadRequest => StatusCode::BAD_REQUEST,
            Kind::Unauthorized => StatusCode::UNAUTHORIZED,
            Kind::Forbidden => StatusCode::FORBIDDEN,
            Kind::NotFound => StatusCode::NOT_FOUND,
            Kind::Conflict => StatusCode::CONFLICT,
            Kind::TooMany => StatusCode::TOO_MANY_REQUESTS,
            Kind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = serde_json::json!({ "error": self.0.message, "code": self.0.code() });
        (status, axum::Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

pub fn bad(m: impl Into<String>) -> ApiError {
    ApiError(mosaikit_kernel::Error::bad(m))
}

/// Headers common to every response.
async fn common_headers(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let mut res = next.run(req).await;
    let h = res.headers_mut();
    h.entry(header::X_CONTENT_TYPE_OPTIONS).or_insert(HeaderValue::from_static("nosniff"));
    h.entry(header::REFERRER_POLICY).or_insert(HeaderValue::from_static("same-origin"));
    h.entry(HeaderName::from_static("cross-origin-resource-policy"))
        .or_insert(HeaderValue::from_static("same-site"));
    res
}

/// Router of the app origin (API + host UI), under the base path of `url`.
pub fn app_router(k: Arc<Kernel>) -> Router {
    let base = k.cfg.base_path.clone();
    let state = AppState { k };
    let r = api::router().merge(ui::router()).with_state(state);
    under_base(&base, r).layer(axum::middleware::from_fn(common_headers))
}

/// Router of the untrusted origin (UI of the plugins, contents, public links),
/// under the base path of `plugin_url`.
pub fn untrusted_router(k: Arc<Kernel>) -> Router {
    let base = k.cfg.plugin_base_path.clone();
    let state = AppState { k };
    under_base(&base, untrusted::router().with_state(state)).layer(axum::middleware::from_fn(common_headers))
}

/// Mounts `r` under `base` ("" = root): removes the prefix from the path before
/// passing the request to `r`. `<base>` without trailing `/` redirects to `<base>/`
/// (the UI uses relative paths), the rest outside `base` is 404.
fn under_base(base: &str, r: Router) -> Router {
    if base.is_empty() {
        return r;
    }
    let base = base.to_string();
    Router::new().fallback(move |mut req: axum::extract::Request| {
        let (base, r) = (base.clone(), r.clone());
        async move {
            let path = req.uri().path();
            if path == base {
                return axum::response::Redirect::permanent(&format!("{base}/")).into_response();
            }
            let Some(rest) = path.strip_prefix(base.as_str()).filter(|r| r.starts_with('/')) else {
                return (StatusCode::NOT_FOUND, "not found").into_response();
            };
            let pq = match req.uri().query() {
                Some(q) => format!("{rest}?{q}"),
                None => rest.to_string(),
            };
            match pq.parse() {
                Ok(uri) => *req.uri_mut() = uri,
                Err(_) => return StatusCode::BAD_REQUEST.into_response(),
            }
            match tower::ServiceExt::oneshot(r, req).await {
                Ok(res) => res,
                Err(e) => match e {},
            }
        }
    })
}

/// The two listeners (app and untrusted), with a clear error if a port is taken.
pub struct Listeners {
    app: tokio::net::TcpListener,
    untrusted: tokio::net::TcpListener,
}

pub async fn bind(k: &Kernel) -> std::io::Result<Listeners> {
    let bind = |addr: String| async move {
        tokio::net::TcpListener::bind(&addr).await.map_err(|e| {
            std::io::Error::new(
                e.kind(),
                format!("cannot listen on {addr} ({e}): port taken? change the port of url (or listen/plugin_listen) in mosaikit.toml"),
            )
        })
    };
    let app = bind(k.cfg.bind.clone()).await?;
    let untrusted = bind(k.cfg.untrusted_bind.clone()).await?;
    tracing::info!("app: {} (listening on {})", k.cfg.app_url, k.cfg.bind);
    tracing::info!("plugins and contents: {} (listening on {})", k.cfg.plugin_url, k.cfg.untrusted_bind);
    Ok(Listeners { app, untrusted })
}

/// Starts the two listeners and waits for Ctrl+C.
pub async fn serve(k: Arc<Kernel>) -> std::io::Result<()> {
    let l = bind(&k).await?;
    serve_until(k, l, async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
}

/// Serves until `shutdown` completes, then closes the connections in an orderly way.
pub async fn serve_until(
    k: Arc<Kernel>,
    l: Listeners,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> std::io::Result<()> {
    let Listeners { app, untrusted } = l;
    let (tx, rx) = tokio::sync::watch::channel(false);
    let mut rx2 = rx.clone();
    let mut rx1 = rx;
    let a =
        axum::serve(app, app_router(k.clone()).into_make_service_with_connect_info::<std::net::SocketAddr>())
            .with_graceful_shutdown(async move {
                let _ = rx1.changed().await;
            });
    let u = axum::serve(
        untrusted,
        untrusted_router(k.clone()).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        let _ = rx2.changed().await;
    });
    let stopper = async move {
        shutdown.await;
        tracing::info!("shutting down...");
        let _ = tx.send(true);
    };
    let (ra, ru, _) = tokio::join!(a, u, stopper);
    ra?;
    ru?;
    Ok(())
}

/// Configuration file: `--config`, `MOSAIKIT_CONFIG`, then `mosaikit.toml` next to
/// the executable or in the current folder. It also returns the base folder for the
/// relative paths when the file is missing (the one of the executable).
pub fn config_path(cli: Option<std::path::PathBuf>) -> (Option<std::path::PathBuf>, std::path::PathBuf) {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| ".".into());
    if let Some(p) = cli.or_else(|| std::env::var_os("MOSAIKIT_CONFIG").map(std::path::PathBuf::from)) {
        return (Some(p), exe_dir);
    }
    for dir in [exe_dir.clone(), std::env::current_dir().unwrap_or_else(|_| ".".into())] {
        let p = dir.join("mosaikit.toml");
        if p.is_file() {
            return (Some(p), exe_dir);
        }
    }
    (None, exe_dir)
}

/// Opens a URL (or a file) with the default program of the system.
pub fn open_browser(url: &str) {
    let r = if cfg!(windows) {
        // explorer opens no console: no cmd window flashing
        std::process::Command::new("explorer").arg(url).spawn()
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(url).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(url).spawn()
    };
    if let Err(e) = r {
        tracing::warn!("{url} not opened: {e}");
    }
}
