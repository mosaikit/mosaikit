//! Looking at a web page for a plugin (permission `web`): can a site be shown in a frame, what is its
//! title, which picture represents it (`og:image`, else the first image). The page is fetched by the
//! server, so every address is checked first (SSRF): http and https only, no credentials in the address,
//! and only addresses of the public Internet (no loopback, private, link-local, shared or reserved
//! range), checked again at every redirect and on the address the connection really goes to.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;
use url::Url;

use crate::{Caller, Error, Kernel, Result};

const MAX_PAGE: usize = 512 * 1024;
const MAX_IMAGE: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 4;
const TIMEOUT: Duration = Duration::from_secs(8);
/// Requests of a person per minute.
const PER_MINUTE: u32 = 30;
const WINDOW: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WebProbe {
    /// the address after the redirects
    pub url: String,
    /// the site may be shown in a frame of Mosaikit
    pub embeddable: bool,
    /// why not: `x_frame_options`, `frame_ancestors` or `unavailable`
    pub reason: Option<String>,
    pub title: String,
    /// the picture as a `data:` address (only if asked and found)
    pub image: Option<String>,
}

/// An address of the public Internet.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => public_v4(a),
        IpAddr::V6(a) => {
            if let Some(m) = a.to_ipv4_mapped() {
                return public_v4(m);
            }
            let s = a.segments();
            !(a.is_loopback()
                || a.is_unspecified()
                || a.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation
                || a == Ipv6Addr::LOCALHOST)
        }
    }
}

fn public_v4(a: Ipv4Addr) -> bool {
    let o = a.octets();
    !(a.is_private()
        || a.is_loopback()
        || a.is_link_local()
        || a.is_broadcast()
        || a.is_unspecified()
        || a.is_multicast()
        || a.is_documentation()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // shared 100.64.0.0/10
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // benchmarking 198.18.0.0/15
        || o[0] >= 240)
}

struct Fetched {
    url: Url,
    status: u16,
    headers: reqwest::header::HeaderMap,
    body: Vec<u8>,
}

/// The address to fetch, after the checks that do not need the network.
fn check_url(raw: &str) -> Result<Url> {
    let u = Url::parse(raw.trim()).map_err(|_| Error::bad("not a valid address").with_code("web_url"))?;
    if !matches!(u.scheme(), "http" | "https") || !u.username().is_empty() || u.password().is_some() {
        return Err(
            Error::bad("an http or https address without credentials is required").with_code("web_url")
        );
    }
    if u.host_str().is_none() {
        return Err(Error::bad("not a valid address").with_code("web_url"));
    }
    Ok(u)
}

/// The host of an address as compared with `allow_private_fetch_hosts` (lower case, IPv6 in brackets).
fn host_of(u: &Url) -> String {
    u.host_str().unwrap_or_default().to_string()
}

/// The `host:port` of the origins a plugin declares that the deployer allows on private addresses.
pub fn private_exemptions(k: &Kernel, origins: &[String]) -> Vec<String> {
    origins
        .iter()
        .filter_map(|o| Url::parse(o).ok())
        .filter_map(|u| Some(format!("{}:{}", host_of(&u), u.port_or_known_default()?)))
        .filter(|hp| k.cfg.allow_private_fetch_hosts.contains(hp))
        .collect()
}

fn unreachable() -> Error {
    Error::bad("the address cannot be reached").with_code("web_unreachable")
}

/// One GET, redirects followed by hand (each hop checked), the body cut at `max` bytes.
async fn fetch(k: &Kernel, raw: &str, max: usize, accept: &str) -> Result<Fetched> {
    send(k, reqwest::Method::GET, raw, max, accept, &[], None, &[]).await
}

/// What a plugin gets back from [`request`].
#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub body: Vec<u8>,
}

/// A request of a plugin to an outside service, with the same protections as the page probe: http(s)
/// only, public addresses only (unless `allow_private_fetch`, or the exact `host:port` is in `exempt`: the
/// deployer's `allow_private_fetch_hosts` already narrowed to the origins of the plugin), the connection pinned to the address that
/// was checked, redirects followed only for a GET and checked at every hop, the body cut at `max` bytes.
pub async fn request(
    k: &Kernel,
    method: reqwest::Method,
    raw: &str,
    headers: &[(String, String)],
    body: Option<String>,
    max: usize,
    exempt: &[String],
) -> Result<Reply> {
    let f = send(k, method, raw, max, "application/json, text/plain;q=0.8, */*;q=0.5", headers, body, exempt)
        .await?;
    Ok(Reply { status: f.status, body: f.body })
}

#[allow(clippy::too_many_arguments)]
async fn send(
    k: &Kernel,
    method: reqwest::Method,
    raw: &str,
    max: usize,
    accept: &str,
    headers: &[(String, String)],
    body: Option<String>,
    exempt: &[String],
) -> Result<Fetched> {
    let follow = method == reqwest::Method::GET;
    let mut url = check_url(raw)?;
    for _ in 0..=MAX_REDIRECTS {
        let host = url.host_str().unwrap_or_default().trim_matches(['[', ']']).to_string();
        let port = url.port_or_known_default().unwrap_or(80);
        let addrs: Vec<SocketAddr> = match host.parse::<IpAddr>() {
            Ok(ip) => vec![SocketAddr::new(ip, port)],
            Err(_) => {
                tokio::net::lookup_host((host.as_str(), port)).await.map_err(|_| unreachable())?.collect()
            }
        };
        // every address the name resolves to must be public, and the connection is pinned to one of
        // them: the name cannot change its answer between the check and the connection
        let listed = exempt.contains(&format!("{}:{port}", host_of(&url)));
        if addrs.is_empty()
            || (!k.cfg.allow_private_fetch && !listed && addrs.iter().any(|a| !is_public_ip(a.ip())))
        {
            return Err(Error::bad("this address is not allowed").with_code("web_blocked"));
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(TIMEOUT)
            .user_agent("Mosaikit-link-preview/1.0")
            .resolve(&host, addrs[0])
            .build()
            .map_err(|e| Error::internal(e.to_string()))?;
        let mut req = client.request(method.clone(), url.clone()).header("accept", accept);
        for (n, v) in headers {
            req = req.header(n.as_str(), v.as_str());
        }
        if let Some(b) = &body {
            req = req.header("content-type", "application/json").body(b.clone());
        }
        let mut resp = req.send().await.map_err(|_| unreachable())?;
        let status = resp.status();
        if follow && status.is_redirection() {
            let next = resp
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .and_then(|l| url.join(l).ok())
                .ok_or_else(unreachable)?;
            url = check_url(next.as_str())?;
            continue;
        }
        let headers = resp.headers().clone();
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(|_| unreachable())? {
            body.extend_from_slice(&chunk);
            if body.len() >= max {
                body.truncate(max);
                break;
            }
        }
        return Ok(Fetched { url, status: status.as_u16(), headers, body });
    }
    Err(Error::bad("too many redirects").with_code("web_unreachable"))
}

/// Why a response forbids being shown in a frame of Mosaikit, if it does.
pub fn framing_refusal(h: &reqwest::header::HeaderMap) -> Option<&'static str> {
    if h.contains_key("x-frame-options") {
        return Some("x_frame_options");
    }
    for v in h.get_all("content-security-policy") {
        let Ok(v) = v.to_str() else { continue };
        for d in v.split(';') {
            let mut parts = d.split_whitespace();
            if parts.next().is_some_and(|n| n.eq_ignore_ascii_case("frame-ancestors")) {
                // only a wildcard (or a whole scheme) lets any page frame it
                let open = parts
                    .any(|s| s == "*" || s.eq_ignore_ascii_case("https:") || s.eq_ignore_ascii_case("http:"));
                if !open {
                    return Some("frame_ancestors");
                }
            }
        }
    }
    None
}

/// The attributes of a tag (`<meta name="x" content="y">`), names in lower case.
fn attrs(tag: &str) -> Vec<(String, String)> {
    let b = tag.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    // skip the tag name
    while i < b.len() && !b[i].is_ascii_whitespace() {
        i += 1;
    }
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') {
            i += 1;
        }
        let s = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' && b[i] != b'/' {
            i += 1;
        }
        let name = tag[s..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() {
            i += 1;
        }
        let mut val = String::new();
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() {
                i += 1;
            }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                i += 1;
                let vs = i;
                while i < b.len() && b[i] != q {
                    i += 1;
                }
                val = tag[vs..i].to_string();
                i += 1;
            } else {
                let vs = i;
                while i < b.len() && !b[i].is_ascii_whitespace() {
                    i += 1;
                }
                val = tag[vs..i].to_string();
            }
        }
        if !name.is_empty() {
            out.push((name, val));
        }
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

/// The tags `<name …>` of the page: their attributes.
fn tags(html: &str, name: &str) -> Vec<Vec<(String, String)>> {
    let lower = html.to_ascii_lowercase();
    let open = format!("<{name}");
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(p) = lower[from..].find(&open) {
        let start = from + p;
        let after = start + open.len();
        // `<meta` and not `<metadata`
        if !lower[after..].starts_with(|c: char| c.is_ascii_whitespace() || c == '/' || c == '>') {
            from = after;
            continue;
        }
        let Some(end) = lower[after..].find('>') else { break };
        out.push(attrs(&html[start..after + end]));
        from = after + end;
    }
    out
}

fn attr<'a>(a: &'a [(String, String)], k: &str) -> Option<&'a str> {
    a.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
}

/// Title of the page.
pub fn page_title(html: &str) -> String {
    let lower = html.to_ascii_lowercase();
    let Some(s) = lower.find("<title") else { return String::new() };
    let Some(gt) = lower[s..].find('>') else { return String::new() };
    let from = s + gt + 1;
    let Some(e) = lower[from..].find("</title") else { return String::new() };
    let t = unescape(html[from..from + e].trim());
    t.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(200).collect()
}

/// The address of the picture that represents the page: `og:image`, `twitter:image`, else the first
/// image of the page (not a `data:` address), as an address on its own.
pub fn page_image(html: &str, base: &Url) -> Option<Url> {
    let web = |u: &Url| matches!(u.scheme(), "http" | "https");
    let metas = tags(html, "meta");
    for want in ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"] {
        for m in &metas {
            let key = attr(m, "property").or_else(|| attr(m, "name")).unwrap_or_default();
            if key.eq_ignore_ascii_case(want) {
                if let Some(u) = attr(m, "content").map(unescape).and_then(|c| base.join(c.trim()).ok()) {
                    if web(&u) {
                        return Some(u);
                    }
                }
            }
        }
    }
    for im in tags(html, "img") {
        if let Some(u) = attr(&im, "src").map(unescape).and_then(|c| base.join(c.trim()).ok()) {
            if web(&u) {
                return Some(u);
            }
        }
    }
    None
}

/// The type of an image from its first bytes (never from what the server says; no SVG: it is a document).
fn image_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if b.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if b.starts_with(b"GIF8") {
        Some("image/gif")
    } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Looks at a web page for a plugin that has the `web` permission.
pub async fn probe(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    address: &str,
    want_image: bool,
) -> Result<WebProbe> {
    let (p, _) = crate::access::plugin_for(k, c, plugin).await?;
    if !p.manifest.permissions.web {
        return Err(Error::forbidden("the plugin does not declare the web permission"));
    }
    let key = format!("web:{}", c.user.user_id);
    if k.limiter.blocked_after(&key, PER_MINUTE, WINDOW) {
        return Err(crate::identity::too_many());
    }
    k.limiter.fail_within(&key, WINDOW);
    inspect(k, address, want_image).await
}

/// The page at an address: frame allowed, title, picture. Not tied to a plugin (the callers check
/// the permission).
pub async fn inspect(k: &Kernel, address: &str, want_image: bool) -> Result<WebProbe> {
    let page = fetch(k, address, MAX_PAGE, "text/html,application/xhtml+xml").await?;
    let reason = framing_refusal(&page.headers).map(str::to_string);
    let is_html = page
        .headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_none_or(|t| t.to_ascii_lowercase().contains("html"));
    let html = if is_html { String::from_utf8_lossy(&page.body).into_owned() } else { String::new() };
    let mut image = None;
    if want_image {
        if let Some(u) = page_image(&html, &page.url) {
            // a picture that cannot be had does not fail the probe: the card shows the placeholder
            if let Ok(f) = fetch(k, u.as_str(), MAX_IMAGE, "image/*").await {
                if f.status < 400 && f.body.len() < MAX_IMAGE {
                    if let Some(m) = image_mime(&f.body) {
                        image = Some(format!(
                            "data:{m};base64,{}",
                            base64::engine::general_purpose::STANDARD.encode(&f.body)
                        ));
                    }
                }
            }
        }
    }
    Ok(WebProbe {
        url: page.url.to_string(),
        embeddable: reason.is_none() && page.status < 400,
        reason: reason.or_else(|| (page.status >= 400).then(|| "unavailable".to_string())),
        title: page_title(&html),
        image,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_public_internet() {
        for ok in ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"] {
            assert!(is_public_ip(ok.parse().unwrap()), "{ok}");
        }
        for bad in [
            "127.0.0.1",
            "10.0.0.5",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "224.0.0.1",
            "255.255.255.255",
            "198.18.0.1",
            "240.0.0.1",
            "::1",
            "::",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "ff02::1",
        ] {
            assert!(!is_public_ip(bad.parse().unwrap()), "{bad}");
        }
    }

    #[test]
    fn addresses() {
        assert!(check_url("https://example.org/a?b=1").is_ok());
        for bad in [
            "file:///etc/passwd",
            "ftp://example.org",
            "javascript:alert(1)",
            "https://user:pw@example.org",
            "x",
            "",
        ] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn framing_headers() {
        let h = |pairs: &[(&str, &str)]| {
            let mut m = reqwest::header::HeaderMap::new();
            for (k, v) in pairs {
                m.append(reqwest::header::HeaderName::from_bytes(k.as_bytes()).unwrap(), v.parse().unwrap());
            }
            m
        };
        assert_eq!(framing_refusal(&h(&[])), None);
        assert_eq!(framing_refusal(&h(&[("x-frame-options", "SAMEORIGIN")])), Some("x_frame_options"));
        let csp = |v: &str| framing_refusal(&h(&[("content-security-policy", v)]));
        assert_eq!(csp("default-src 'self'; frame-ancestors 'none'"), Some("frame_ancestors"));
        assert_eq!(csp("frame-ancestors 'self' https://a.org"), Some("frame_ancestors"));
        assert_eq!(csp("frame-ancestors *"), None);
        assert_eq!(csp("default-src 'self'"), None);
    }

    #[test]
    fn title_and_picture() {
        let base = Url::parse("https://site.example/dir/page.html").unwrap();
        let html = r#"<html><head><title> My
            &amp; site </title><meta property="og:image" content="/img/og.png"><metadata x></head>
            <body><img src="a.png"></body>"#;
        assert_eq!(page_title(html), "My & site");
        assert_eq!(page_image(html, &base).unwrap().as_str(), "https://site.example/img/og.png");
        let only_img = r#"<body><img alt="x" src='data:image/png;base64,AAAA'><img src="pics/a.jpg"></body>"#;
        assert_eq!(page_image(only_img, &base).unwrap().as_str(), "https://site.example/dir/pics/a.jpg");
        assert!(page_image("<p>nothing</p>", &base).is_none());
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(image_mime(b"<svg xmlns=...>"), None);
    }
}
