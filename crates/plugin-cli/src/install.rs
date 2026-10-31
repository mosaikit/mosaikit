//! `install --server`: uploads a package to a test server the way Plugins › Install from a file does.
//!
//! The server takes the bytes of the `.mskp` at `POST <server>/api/admin/plugins` from a signed-in
//! Administrator (session cookie and `X-CSRF-Token`), so the tool signs in first with the Administrator
//! door (`/api/auth/admin/login`, and `/api/auth/totp/verify` when the account has a second factor).

use std::path::Path;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use reqwest::blocking::{Client, Response};
use reqwest::header::{COOKIE, SET_COOKIE};
use serde_json::{json, Value};

const SESSION_COOKIE: &str = "msk_session";

#[derive(Debug, Clone, Default)]
pub struct Login {
    pub user: String,
    pub password: String,
    /// current code of the second factor, when the Administrator has one
    pub totp: Option<String>,
}

/// What the server says it installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Installed {
    pub id: String,
    pub version: String,
    pub status: String,
    pub signed_by: Option<String>,
}

fn api(server: &str, path: &str) -> String {
    format!("{}{path}", server.trim_end_matches('/'))
}

/// The error message of a server answer (`{"error": ...}` or the raw text).
fn failure(what: &str, r: Response) -> anyhow::Error {
    let status = r.status();
    let body = r.text().unwrap_or_default();
    let msg = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message").or(Some(e)))
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| v.get("message").and_then(Value::as_str).map(str::to_string))
        })
        .unwrap_or(body);
    anyhow!("{what}: the server answered {status}: {}", msg.trim())
}

fn session_cookie(r: &Response) -> Option<String> {
    r.headers().get_all(SET_COOKIE).iter().filter_map(|v| v.to_str().ok()).find_map(|c| {
        let first = c.split(';').next()?.trim();
        let (k, v) = first.split_once('=')?;
        (k == SESSION_COOKIE && !v.is_empty()).then(|| v.to_string())
    })
}

/// Signs in and uploads the package. Checks the package locally before the first request.
pub fn install(server: &str, package: &Path, login: &Login) -> Result<Installed> {
    let bytes = std::fs::read(package).with_context(|| package.display().to_string())?;
    let pkg = mosaikit_mskp::Package::read(&bytes).context("the package is not valid: nothing was sent")?;
    if login.user.is_empty() || login.password.is_empty() {
        bail!("an Administrator is needed: --user and --password (or MOSAIKIT_ADMIN_USER / MOSAIKIT_ADMIN_PASSWORD)");
    }
    let http = Client::builder().timeout(Duration::from_secs(120)).build()?;

    let r = http
        .post(api(server, "/api/auth/admin/login"))
        .json(&json!({ "username": login.user, "password": login.password }))
        .send()
        .with_context(|| format!("reaching {server}"))?;
    if !r.status().is_success() {
        return Err(failure("sign-in", r));
    }
    let mut cookie = session_cookie(&r).context("the server did not start a session")?;
    let body: Value = r.json().context("sign-in answer")?;
    let mut csrf =
        body.get("csrf").and_then(Value::as_str).context("sign-in answer without csrf")?.to_string();

    if let Some(step) = body.get("pending").and_then(Value::as_str) {
        let Some(code) = &login.totp else {
            bail!("this Administrator needs a second factor ({step}): add --totp <code>");
        };
        if step != "totp" {
            bail!("the second factor of this Administrator is not set up yet: sign in to the shell once to set it up");
        }
        let r = http
            .post(api(server, "/api/auth/totp/verify"))
            .header(COOKIE, format!("{SESSION_COOKIE}={cookie}"))
            .header("x-csrf-token", &csrf)
            .json(&json!({ "code": code }))
            .send()?;
        if !r.status().is_success() {
            return Err(failure("second factor", r));
        }
        cookie = session_cookie(&r).unwrap_or(cookie);
        let b: Value = r.json().context("second factor answer")?;
        csrf = b.get("csrf").and_then(Value::as_str).unwrap_or(&csrf).to_string();
    }

    let r = http
        .post(api(server, "/api/admin/plugins"))
        .header(COOKIE, format!("{SESSION_COOKIE}={cookie}"))
        .header("x-csrf-token", &csrf)
        .header("content-type", "application/octet-stream")
        .body(bytes)
        .send()?;
    if !r.status().is_success() {
        return Err(failure(&format!("install of {} {}", pkg.manifest.id, pkg.manifest.version), r));
    }
    let v: Value = r.json().context("install answer")?;
    let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    Ok(Installed {
        id: text("id").unwrap_or(pkg.manifest.id),
        version: text("version").unwrap_or(pkg.manifest.version),
        status: text("status").unwrap_or_default(),
        signed_by: text("signed_by"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// One request: (request line, headers lower-cased, body).
    type Seen = (String, String, Vec<u8>);
    /// (status, headers, body) of an answer
    type Answer = (u16, Vec<(&'static str, String)>, String);

    /// A server that answers what `answer` says for each request and records them.
    fn serve(answer: fn(&str, bool) -> Answer) -> (String, Arc<Mutex<Vec<Seen>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/mosaikit", listener.local_addr().unwrap());
        let seen: Arc<Mutex<Vec<Seen>>> = Arc::default();
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                let (head_end, len) = loop {
                    let n = s.read(&mut chunk).unwrap_or(0);
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..i]).to_lowercase();
                        let len = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .and_then(|v| v.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        break (i + 4, len);
                    }
                    if n == 0 {
                        return;
                    }
                };
                while buf.len() < head_end + len {
                    let n = s.read(&mut chunk).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                let line = head.lines().next().unwrap_or_default().to_string();
                let has_session = head.to_lowercase().contains("msk_session=tok");
                let (code, headers, body) = answer(&line, has_session);
                log.lock().unwrap().push((line, head.to_lowercase(), buf[head_end..].to_vec()));
                let mut out = format!("HTTP/1.1 {code} X\r\ncontent-type: application/json\r\nconnection: close\r\ncontent-length: {}\r\n", body.len());
                for (k, v) in headers {
                    out.push_str(&format!("{k}: {v}\r\n"));
                }
                out.push_str("\r\n");
                out.push_str(&body);
                let _ = s.write_all(out.as_bytes());
            }
        });
        (url, seen)
    }

    fn package(dir: &Path) -> std::path::PathBuf {
        let mut files = std::collections::BTreeMap::new();
        files.insert(
            "plugin.toml".to_string(),
            b"id = \"com.test.demo\"\nname = \"Demo\"\nversion = \"0.1.0\"\n".to_vec(),
        );
        let f = dir.join("demo.mskp");
        std::fs::write(&f, mosaikit_mskp::pack(&files, None).unwrap()).unwrap();
        f
    }

    fn login() -> Login {
        Login { user: "admin".into(), password: "secret".into(), totp: None }
    }

    #[test]
    fn signs_in_and_uploads_the_package() {
        let (url, seen) = serve(|line, session| {
            if line.contains("/api/auth/admin/login") {
                (
                    200,
                    vec![("set-cookie", "msk_session=tok; HttpOnly; Path=/".into())],
                    r#"{"csrf":"c1"}"#.into(),
                )
            } else if line.starts_with("POST /mosaikit/api/admin/plugins") && session {
                (
                    200,
                    vec![],
                    r#"{"id":"com.test.demo","version":"0.1.0","status":"active","signed_by":null}"#.into(),
                )
            } else {
                (404, vec![], "{}".into())
            }
        });
        let d = tempfile::tempdir().unwrap();
        let f = package(d.path());
        let got = install(&url, &f, &login()).unwrap();
        assert_eq!(
            (got.id.as_str(), got.version.as_str(), got.status.as_str()),
            ("com.test.demo", "0.1.0", "active")
        );
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert!(seen[1].1.contains("x-csrf-token: c1"));
        assert_eq!(seen[1].2, std::fs::read(&f).unwrap());
    }

    #[test]
    fn a_second_factor_is_asked_for_and_sent() {
        let (url, seen) = serve(|line, session| {
            if line.contains("/api/auth/admin/login") {
                (
                    200,
                    vec![("set-cookie", "msk_session=tok; Path=/".into())],
                    r#"{"pending":"totp","csrf":"c1"}"#.into(),
                )
            } else if line.contains("/api/auth/totp/verify") {
                (200, vec![("set-cookie", "msk_session=tok; Path=/".into())], r#"{"csrf":"c2"}"#.into())
            } else if session {
                (200, vec![], r#"{"id":"com.test.demo","version":"0.1.0","status":"active"}"#.into())
            } else {
                (401, vec![], "{}".into())
            }
        });
        let d = tempfile::tempdir().unwrap();
        let f = package(d.path());
        let e = install(&url, &f, &login()).unwrap_err().to_string();
        assert!(e.contains("--totp"), "{e}");
        let l = Login { totp: Some("123456".into()), ..login() };
        assert_eq!(install(&url, &f, &l).unwrap().id, "com.test.demo");
        assert!(seen.lock().unwrap().last().unwrap().1.contains("x-csrf-token: c2"));
    }

    #[test]
    fn the_server_refusal_is_shown_and_a_bad_package_is_not_sent() {
        let (url, seen) = serve(|line, _| {
            if line.contains("/api/auth/admin/login") {
                (200, vec![("set-cookie", "msk_session=tok; Path=/".into())], r#"{"csrf":"c1"}"#.into())
            } else {
                (
                    400,
                    vec![],
                    r#"{"error":"plugin_incompatible: needs Mosaikit >=99","code":"bad_request"}"#.into(),
                )
            }
        });
        let d = tempfile::tempdir().unwrap();
        let f = package(d.path());
        let e = install(&url, &f, &login()).unwrap_err().to_string();
        assert!(e.contains("400") && e.contains("needs Mosaikit >=99"), "{e}");
        let bad = d.path().join("bad.mskp");
        std::fs::write(&bad, b"nothing").unwrap();
        let before = seen.lock().unwrap().len();
        assert!(install(&url, &bad, &login()).is_err());
        assert_eq!(seen.lock().unwrap().len(), before);
        assert!(install(&url, &f, &Login::default()).unwrap_err().to_string().contains("--user"));
    }
}
