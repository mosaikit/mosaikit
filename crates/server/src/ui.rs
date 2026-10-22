//! Host UI (React) embedded in the executable, with SPA fallback and CSP.

use axum::extract::State;
use axum::http::{header, HeaderValue, Method, StatusCode, Uri};
use axum::response::{Html, IntoResponse, Response};
use axum::Router;

use crate::AppState;

/// `ui/host/dist`: in debug read from disk at every request, in release embedded.
#[derive(rust_embed::Embed)]
#[folder = "../../ui/host/dist/"]
#[allow_missing = true]
struct HostUi;

pub fn router() -> Router<AppState> {
    Router::new().fallback(serve)
}

pub fn host_csp(s: &AppState) -> String {
    format!(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; \
         font-src 'self' data:; connect-src 'self'; frame-src {} {}; frame-ancestors 'none'; \
         object-src 'none'; base-uri 'self'; form-action 'self'",
        s.k.cfg.plugin_origin(),
        s.k.cfg.public_origin()
    )
}

const MISSING: &str = "<!doctype html><meta charset=utf-8><title>Mosaikit</title>\
    <body style=\"font:15px system-ui;padding:40px;background:#0b0c0f;color:#ece7db\">\
    <h1>UI not built</h1><p>Run <code>npm run build -w ui/host</code> \
    or, in development, open the app from Vite: <code>cargo xtask dev</code> (http://127.0.0.1:5173).</p>";

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Title and colours of the brand in the page (no flash of the default brand), and the social preview
/// with absolute URLs built from the public address of the app (crawlers do not resolve relative ones).
fn branded(b: &mosaikit_kernel::brand::Brand, app_url: &str, html: String) -> String {
    let html = html.replace("<title>Mosaikit</title>", &format!("<title>{}</title>", esc(&b.name)));
    let html =
        html.replace("content=\"social.png\"", &format!("content=\"{}/social.png\"", esc(app_url))).replacen(
            "<meta property=\"og:type\"",
            &format!(
                "<meta property=\"og:url\" content=\"{}/\" />\n    <meta property=\"og:type\"",
                esc(app_url)
            ),
            1,
        );
    let css = b.css();
    if css.is_empty() {
        html
    } else {
        html.replacen("</head>", &format!("<style>{css}</style></head>"), 1)
    }
}

/// Logo, favicon and icon of the brand (default: the Mosaikit symbol).
/// Mosaikit symbol, embedded from the source: it does not depend on the compiled UI.
const DEFAULT_ICON: &str = include_str!("../../../ui/host/public/favicon.svg");

/// Images of the identity of the platform set by the Administrator (System › Identity and texts) come
/// first; then the files of the brand; then the Mosaikit symbol. `logo-dark` is the logo for dark
/// backgrounds (404 without one: the light logo is used).
async fn brand_file(s: &AppState, which: &str) -> Response {
    use mosaikit_kernel::tenancy::levels;
    let slot = match which {
        "logo" => Some("logo_light"),
        "logo-dark" => Some("logo_dark"),
        "favicon" | "icon" => Some("icon"),
        _ => None,
    };
    if let Some(slot) = slot {
        if let Ok(Some((data, mime))) = levels::image(&s.k, None, slot).await {
            return crate::api::image_response(data, &mime);
        }
    }
    if which == "logo-dark" {
        return StatusCode::NOT_FOUND.into_response();
    }
    let (data, name) = match s.k.brand.file(which).and_then(|p| std::fs::read(&p).ok().map(|d| (d, p))) {
        Some((d, p)) => (d, p.to_string_lossy().into_owned()),
        None => match which {
            "logo" | "favicon" | "icon" => (DEFAULT_ICON.as_bytes().to_vec(), "favicon.svg".to_string()),
            _ => return StatusCode::NOT_FOUND.into_response(),
        },
    };
    let mime = mime_guess::from_path(&name).first_or_octet_stream();
    let mut res = data.into_response();
    let h = res.headers_mut();
    if let Ok(v) = HeaderValue::from_str(mime.as_ref()) {
        h.insert(header::CONTENT_TYPE, v);
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("public, max-age=3600"));
    // an SVG of the brand runs no scripts
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    );
    res
}

async fn serve(State(s): State<AppState>, method: Method, uri: Uri) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return StatusCode::NOT_FOUND.into_response();
    }
    let path = uri.path().trim_start_matches('/');
    if path.contains("..") || path.contains('\\') {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(which) = path.strip_prefix("brand/") {
        return brand_file(&s, which).await;
    }
    if !path.is_empty() && path != "index.html" {
        if let Some(f) = HostUi::get(path) {
            let mut res = f.data.into_owned().into_response();
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            if let Ok(v) = HeaderValue::from_str(mime.as_ref()) {
                res.headers_mut().insert(header::CONTENT_TYPE, v);
            }
            if path.starts_with("assets/") {
                res.headers_mut().insert(
                    header::CACHE_CONTROL,
                    HeaderValue::from_static("public, max-age=31536000, immutable"),
                );
            }
            return res;
        }
        // static file with a missing extension: 404, not the SPA
        if path.rsplit('/').next().is_some_and(|last| last.contains('.')) {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    let body = HostUi::get("index.html")
        .map(|f| String::from_utf8_lossy(&f.data).into_owned())
        .unwrap_or_else(|| MISSING.to_string());
    let body = branded(&s.k.brand, &s.k.cfg.app_url, body);
    let mut res = Html(body).into_response();
    let h = res.headers_mut();
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    if let Ok(v) = HeaderValue::from_str(&host_csp(&s)) {
        h.insert(header::CONTENT_SECURITY_POLICY, v);
    }
    res
}

#[cfg(test)]
mod tests {
    #[test]
    fn social_preview_with_absolute_urls() {
        let html = "<head><title>Mosaikit</title><meta property=\"og:type\" content=\"website\" />\
                    <meta property=\"og:image\" content=\"social.png\" />\
                    <meta name=\"twitter:image\" content=\"social.png\" /></head>"
            .to_string();
        let out = super::branded(&Default::default(), "https://apps.example.com/mosaikit", html);
        assert!(out.contains("og:image\" content=\"https://apps.example.com/mosaikit/social.png\""), "{out}");
        assert!(
            out.contains("twitter:image\" content=\"https://apps.example.com/mosaikit/social.png\""),
            "{out}"
        );
        assert!(out.contains("og:url\" content=\"https://apps.example.com/mosaikit/\""), "{out}");
        assert!(!out.contains("\"social.png\""), "{out}");
    }
}
