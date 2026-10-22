//! Email: the mail server of the platform (System › Email), the queue of the messages with retries,
//! the daily digest of the notifications and a small SMTP client (plain, STARTTLS or TLS, AUTH PLAIN).
//!
//! The settings are in the system tenant (`settings.email`); the password is encrypted with the secret
//! key of the installation (`secret`) and never goes back to the browser. Messages wait in
//! `core.mail_outbox`: a worker of the kernel sends them every few seconds and retries a failure later
//! (1, 5, 30 minutes, 2 and 12 hours), then gives up.

use std::sync::{Arc, Weak};
use std::time::Duration as StdDuration;

use base64::Engine;
use chrono::{Duration, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use uuid::Uuid;

use crate::tenancy::{levels, require_admin};
use crate::{events, notify, Error, Kernel, Result, SessionUser};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Security {
    /// STARTTLS on the plain connection (port 587)
    #[default]
    Starttls,
    /// TLS from the start (port 465)
    Tls,
    /// no encryption: only for a relay on the same machine or network
    None,
}

/// The mail server and the texts of the messages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EmailSettings {
    #[serde(default)]
    pub host: String,
    #[serde(default = "d_port")]
    pub port: u16,
    #[serde(default)]
    pub security: Security,
    #[serde(default)]
    pub username: String,
    /// `Name <address>` or an address
    #[serde(default)]
    pub sender: String,
    /// text at the end of every message
    #[serde(default)]
    pub footer: String,
}

fn d_port() -> u16 {
    587
}

impl Default for EmailSettings {
    fn default() -> EmailSettings {
        EmailSettings {
            host: String::new(),
            port: d_port(),
            security: Security::default(),
            username: String::new(),
            sender: String::new(),
            footer: "Automatic message, do not reply.".into(),
        }
    }
}

/// The settings as System › Email shows them.
#[derive(Debug, Clone, Serialize)]
pub struct EmailView {
    #[serde(flatten)]
    pub settings: EmailSettings,
    pub has_password: bool,
    /// a server and a sender: the platform can send
    pub configured: bool,
}

/// A change: the password only if present (empty: removed).
#[derive(Debug, Clone, Deserialize)]
pub struct EmailChange {
    #[serde(flatten)]
    pub settings: EmailSettings,
    #[serde(default)]
    pub password: Option<String>,
}

const SECRET_NAME: &str = "smtp.password";

async fn stored(k: &Kernel) -> Result<EmailSettings> {
    let s = levels::system_settings(k).await?;
    Ok(s.get("email").cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default())
}

async fn password(k: &Kernel) -> Result<Option<String>> {
    let sealed: Option<Vec<u8>> = mosaikit_db::query_scalar("select value from core.secrets where name = $1")
        .bind(SECRET_NAME)
        .fetch_optional(&k.db)
        .await?;
    match sealed {
        None => Ok(None),
        Some(b) => {
            let plain = k.secrets.open(SECRET_NAME.as_bytes(), &b)?;
            Ok(Some(String::from_utf8(plain).map_err(|_| Error::internal("password of the mail server"))?))
        }
    }
}

fn configured(s: &EmailSettings) -> bool {
    !s.host.is_empty() && !s.sender.is_empty()
}

pub async fn settings(k: &Kernel, admin: &SessionUser) -> Result<EmailView> {
    require_admin(admin)?;
    let settings = stored(k).await?;
    Ok(EmailView { configured: configured(&settings), has_password: password(k).await?.is_some(), settings })
}

fn valid_host(h: &str) -> bool {
    !h.is_empty()
        && h.len() <= 253
        && h.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b':')
}

/// The address inside `Name <address>` (or the whole text).
fn address_of(sender: &str) -> &str {
    match (sender.rfind('<'), sender.rfind('>')) {
        (Some(a), Some(b)) if a < b => sender[a + 1..b].trim(),
        _ => sender.trim(),
    }
}

pub async fn set_settings(k: &Kernel, admin: &SessionUser, c: &EmailChange) -> Result<EmailView> {
    require_admin(admin)?;
    let s = &c.settings;
    if !s.host.is_empty() && !valid_host(&s.host) {
        return Err(Error::bad("invalid address of the mail server").with_code("setting_invalid"));
    }
    if s.port == 0 {
        return Err(Error::bad("invalid port of the mail server").with_code("setting_invalid"));
    }
    if !s.sender.is_empty() && (!notify::valid_email(address_of(&s.sender)) || s.sender.len() > 200) {
        return Err(Error::bad("invalid sender: an address or «Name <address>»").with_code("setting_invalid"));
    }
    if s.username.len() > 200 || s.footer.chars().count() > 300 || s.sender.contains(['\r', '\n']) {
        return Err(Error::bad("text too long").with_code("setting_invalid"));
    }
    let mut all = levels::system_settings(k).await?;
    all["email"] = serde_json::to_value(s)?;
    levels::write_system(k, &all).await?;
    match c.password.as_deref() {
        Some("") => {
            mosaikit_db::query("delete from core.secrets where name = $1")
                .bind(SECRET_NAME)
                .execute(&k.db)
                .await?;
        }
        Some(p) => {
            let sealed = k.secrets.seal(SECRET_NAME.as_bytes(), p.as_bytes());
            mosaikit_db::query(
                "insert into core.secrets (name, value) values ($1, $2)
                 on conflict (name) do update set value = excluded.value",
            )
            .bind(SECRET_NAME)
            .bind(sealed)
            .execute(&k.db)
            .await?;
        }
        None => {}
    }
    events::record(k, None, Some(admin.user_id), None, None, "platform.email", json!({ "host": s.host }))
        .await;
    settings(k, admin).await
}

/// Sends a test message at once (not through the queue): the error of the server goes back to the page.
pub async fn send_test(k: &Kernel, admin: &SessionUser, to: &str) -> Result<()> {
    require_admin(admin)?;
    if !notify::valid_email(to) {
        return Err(Error::bad("invalid email address").with_code("email_invalid"));
    }
    let s = stored(k).await?;
    if !configured(&s) {
        return Err(Error::bad("the mail server is not set").with_code("email_not_configured"));
    }
    let name = levels::effective(k, None)
        .await?
        .get("identity.name")
        .and_then(Value::as_str)
        .unwrap_or("Mosaikit")
        .to_string();
    let body = format!("This is a test message of {name}: the mail server works.\n\n-- \n{}", s.footer);
    deliver(&s, password(k).await?.as_deref(), to, &format!("Test message of {name}"), &body).await
}

// ------------------------------------------------------------------ queue

/// Puts a message in the queue.
pub async fn enqueue(k: &Kernel, to: &str, subject: &str, body: &str) -> Result<Uuid> {
    Ok(mosaikit_db::query_scalar(
        "insert into core.mail_outbox (to_addr, subject, body, next_at) values ($1, $2, $3, $4) returning id",
    )
    .bind(to)
    .bind(subject)
    .bind(body)
    .bind(Utc::now())
    .fetch_one(&k.db)
    .await?)
}

/// The text of the email of a notification: the text, the address to open it, the footer.
pub async fn note_body(k: &Kernel, body: &str, link: &str) -> String {
    let footer = stored(k).await.map(|s| s.footer).unwrap_or_default();
    let mut out = String::new();
    if !body.is_empty() {
        out.push_str(body);
        out.push_str("\n\n");
    }
    if !link.is_empty() {
        out.push_str(&format!("Open: {}/{}\n\n", k.cfg.app_url, link));
    } else {
        out.push_str(&format!("Open: {}/\n\n", k.cfg.app_url));
    }
    out.push_str("-- \n");
    out.push_str(&footer);
    out
}

const RETRY_MINUTES: &[i64] = &[1, 5, 30, 120, 720];

/// Sends the messages due; returns how many went out. Each one is taken by a single sender.
pub async fn drain(k: &Kernel) -> Result<usize> {
    let s = stored(k).await?;
    if !configured(&s) {
        return Ok(0);
    }
    let pw = password(k).await?;
    let due: Vec<Uuid> = mosaikit_db::query_scalar(
        "select id from core.mail_outbox where status = 'pending' and next_at <= $1 order by next_at limit 50",
    )
    .bind(Utc::now())
    .fetch_all(&k.db)
    .await?;
    let mut sent = 0;
    for id in due {
        let taken = mosaikit_db::query(
            "update core.mail_outbox set status = 'sending' where id = $1 and status = 'pending'",
        )
        .bind(id)
        .execute(&k.db)
        .await?
        .rows_affected();
        if taken == 0 {
            continue;
        }
        let row =
            mosaikit_db::query("select to_addr, subject, body, attempts from core.mail_outbox where id = $1")
                .bind(id)
                .fetch_one(&k.db)
                .await?;
        let (to, subject, body, attempts): (String, String, String, i32) =
            (row.get(0), row.get(1), row.get(2), row.get(3));
        match deliver(&s, pw.as_deref(), &to, &subject, &body).await {
            Ok(()) => {
                sent += 1;
                mosaikit_db::query("update core.mail_outbox set status = 'sent', attempts = $2, sent_at = $3, last_error = '' where id = $1")
                    .bind(id)
                    .bind(attempts + 1)
                    .bind(Utc::now())
                    .execute(&k.db)
                    .await?;
            }
            Err(e) => {
                let next = RETRY_MINUTES.get(attempts as usize);
                tracing::warn!("email to {to} not sent (attempt {}): {e}", attempts + 1);
                mosaikit_db::query(
                    "update core.mail_outbox set status = $2, attempts = $3, next_at = $4, last_error = $5 where id = $1",
                )
                .bind(id)
                .bind(if next.is_some() { "pending" } else { "failed" })
                .bind(attempts + 1)
                .bind(Utc::now() + Duration::minutes(*next.unwrap_or(&0)))
                .bind(e.to_string().chars().take(500).collect::<String>())
                .execute(&k.db)
                .await?;
            }
        }
    }
    Ok(sent)
}

/// Removes the sent and failed messages older than 30 days, and puts back in the queue the ones left
/// "sending" by a stop of the server.
pub async fn tidy(k: &Kernel) -> Result<()> {
    mosaikit_db::query("delete from core.mail_outbox where status in ('sent', 'failed') and created_at < $1")
        .bind(Utc::now() - Duration::days(30))
        .execute(&k.db)
        .await?;
    mosaikit_db::query(
        "update core.mail_outbox set status = 'pending' where status = 'sending' and next_at < $1",
    )
    .bind(Utc::now() - Duration::minutes(15))
    .execute(&k.db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------ digest

const DIGEST_DAY: &str = "digest.day";

/// The daily digest: for every person who chose it, one message with the unread notifications not sent by
/// email yet. Runs once a day from the hour of the platform (UTC); `force` runs it now (tests, tools).
pub async fn digest(k: &Kernel, force: bool) -> Result<usize> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    if !force {
        let hour =
            levels::effective(k, None).await?.get("notify.digest_hour").and_then(Value::as_i64).unwrap_or(7);
        if (Utc::now().hour() as i64) < hour {
            return Ok(0);
        }
        let last: Option<Vec<u8>> =
            mosaikit_db::query_scalar("select value from core.secrets where name = $1")
                .bind(DIGEST_DAY)
                .fetch_optional(&k.db)
                .await?;
        if last.as_deref() == Some(today.as_bytes()) {
            return Ok(0);
        }
    }
    mosaikit_db::query(
        "insert into core.secrets (name, value) values ($1, $2) on conflict (name) do update set value = excluded.value",
    )
    .bind(DIGEST_DAY)
    .bind(today.into_bytes())
    .execute(&k.db)
    .await?;
    let users: Vec<Uuid> = mosaikit_db::query_scalar(
        "select distinct user_id from core.notifications where emailed = false and read_at is null",
    )
    .fetch_all(&k.db)
    .await?;
    let footer = stored(k).await?.footer;
    let mut sent = 0;
    for user in users {
        let prefs = notify::prefs_of(k, user).await?;
        let Some(to) = prefs.address.clone() else { continue };
        if prefs.mode != "digest" {
            continue;
        }
        let rows = mosaikit_db::query(
            "select id, kind, title, body, link from core.notifications
             where user_id = $1 and emailed = false and read_at is null order by created_at limit 50",
        )
        .bind(user)
        .fetch_all(&k.db)
        .await?;
        let mut lines = Vec::new();
        let mut ids = Vec::new();
        for r in &rows {
            let id: Uuid = r.get(0);
            ids.push(id);
            let kind = notify::NoteKind::parse(r.get::<&str, _>(1))?;
            if !prefs.kinds.iter().any(|p| p.kind == kind && p.email) {
                continue;
            }
            let (title, body, link): (String, String, String) = (r.get(2), r.get(3), r.get(4));
            let mut line = format!("• {title}");
            if !body.is_empty() {
                line.push_str(&format!("\n  {body}"));
            }
            if !link.is_empty() {
                line.push_str(&format!("\n  {}/{link}", k.cfg.app_url));
            }
            lines.push(line);
        }
        for id in &ids {
            mosaikit_db::query("update core.notifications set emailed = true where id = $1")
                .bind(*id)
                .execute(&k.db)
                .await?;
        }
        if lines.is_empty() {
            continue;
        }
        let subject = if lines.len() == 1 {
            "1 new notification".to_string()
        } else {
            format!("{} new notifications", lines.len())
        };
        let body = format!("{}\n\nAll of them: {}/\n\n-- \n{footer}", lines.join("\n\n"), k.cfg.app_url);
        enqueue(k, &to, &subject, &body).await?;
        sent += 1;
    }
    Ok(sent)
}

// ------------------------------------------------------------------ worker

/// The background work of the notifications: the queue every 15 seconds, the digest, the retention and
/// the cleaning of the queue every 10 minutes. Stops with the kernel.
pub(crate) fn spawn_worker(k: &Arc<Kernel>) {
    let weak: Weak<Kernel> = Arc::downgrade(k);
    tokio::spawn(async move {
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(StdDuration::from_secs(15)).await;
            let Some(k) = weak.upgrade() else { break };
            if let Err(e) = drain(&k).await {
                tracing::warn!("queue of the emails: {e}");
            }
            if tick % 40 == 0 {
                if let Err(e) = digest(&k, false).await {
                    tracing::warn!("digest of the notifications: {e}");
                }
                if let Err(e) = notify::purge(&k).await {
                    tracing::warn!("retention of the notifications: {e}");
                }
                if let Err(e) = tidy(&k).await {
                    tracing::warn!("cleaning of the queue of the emails: {e}");
                }
            }
            tick += 1;
        }
    });
}

// ------------------------------------------------------------------ SMTP

trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}

struct Smtp {
    io: BufReader<Box<dyn Io>>,
}

fn smtp_err(m: impl std::fmt::Display) -> Error {
    Error::new(crate::Kind::Internal, format!("mail server: {m}")).with_code("email_failed")
}

const TIMEOUT: StdDuration = StdDuration::from_secs(20);

impl Smtp {
    /// Reads a reply (also multi-line); the code must be one of `ok`.
    async fn reply(&mut self, ok: &[u16]) -> Result<String> {
        let mut all = String::new();
        loop {
            let mut line = String::new();
            let n = tokio::time::timeout(TIMEOUT, self.io.read_line(&mut line))
                .await
                .map_err(|_| smtp_err("no answer"))?
                .map_err(smtp_err)?;
            if n == 0 {
                return Err(smtp_err("connection closed"));
            }
            all.push_str(&line);
            if line.len() < 4 || line.as_bytes()[3] != b'-' {
                break;
            }
        }
        let code: u16 = all
            .get(..3)
            .and_then(|c| c.parse().ok())
            .ok_or_else(|| smtp_err(format!("unexpected answer: {}", all.trim())))?;
        if !ok.contains(&code) {
            return Err(smtp_err(all.trim()));
        }
        Ok(all)
    }

    async fn send(&mut self, line: &str) -> Result<()> {
        let w = self.io.get_mut();
        tokio::time::timeout(TIMEOUT, async {
            w.write_all(line.as_bytes()).await?;
            w.write_all(b"\r\n").await?;
            w.flush().await
        })
        .await
        .map_err(|_| smtp_err("timeout"))?
        .map_err(smtp_err)
    }

    async fn cmd(&mut self, line: &str, ok: &[u16]) -> Result<String> {
        self.send(line).await?;
        self.reply(ok).await
    }
}

async fn tls(host: &str, io: Box<dyn Io>) -> Result<Box<dyn Io>> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let cfg = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(smtp_err)?
        .with_root_certificates(roots)
        .with_no_client_auth();
    let name = rustls::pki_types::ServerName::try_from(host.to_string()).map_err(smtp_err)?;
    let s = tokio_rustls::TlsConnector::from(Arc::new(cfg)).connect(name, io).await.map_err(smtp_err)?;
    Ok(Box::new(s))
}

/// A header with non-ASCII text, encoded (RFC 2047).
fn header_text(s: &str) -> String {
    if s.is_ascii() {
        s.to_string()
    } else {
        format!("=?UTF-8?B?{}?=", base64::engine::general_purpose::STANDARD.encode(s))
    }
}

/// The message: headers and the text in base64 (UTF-8).
fn message(sender: &str, to: &str, subject: &str, body: &str) -> String {
    let b64 =
        base64::engine::general_purpose::STANDARD.encode(body.replace("\r\n", "\n").replace('\n', "\r\n"));
    let mut lines = String::new();
    for chunk in b64.as_bytes().chunks(76) {
        lines.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        lines.push_str("\r\n");
    }
    let domain = address_of(sender).rsplit_once('@').map(|(_, d)| d).unwrap_or("localhost");
    format!(
        "From: {sender}\r\nTo: {to}\r\nSubject: {}\r\nDate: {}\r\nMessage-ID: <{}@{domain}>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{lines}",
        header_text(subject),
        Utc::now().to_rfc2822(),
        Uuid::new_v4(),
    )
}

/// One message through the mail server.
pub async fn deliver(
    s: &EmailSettings,
    password: Option<&str>,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<()> {
    if to.contains(['\r', '\n', '<', '>']) || subject.contains(['\r', '\n']) {
        return Err(smtp_err("invalid address or subject"));
    }
    let tcp = tokio::time::timeout(TIMEOUT, TcpStream::connect((s.host.as_str(), s.port)))
        .await
        .map_err(|_| smtp_err("no answer"))?
        .map_err(smtp_err)?;
    let mut io: Box<dyn Io> = Box::new(tcp);
    if s.security == Security::Tls {
        io = tls(&s.host, io).await?;
    }
    let mut c = Smtp { io: BufReader::new(io) };
    c.reply(&[220]).await?;
    let mut ehlo = c.cmd("EHLO mosaikit", &[250]).await?;
    if s.security == Security::Starttls {
        if !ehlo.to_ascii_uppercase().contains("STARTTLS") {
            return Err(smtp_err("the server does not offer STARTTLS"));
        }
        c.cmd("STARTTLS", &[220]).await?;
        let plain = c.io.into_inner();
        c = Smtp { io: BufReader::new(tls(&s.host, plain).await?) };
        ehlo = c.cmd("EHLO mosaikit", &[250]).await?;
    }
    if !s.username.is_empty() {
        let pw = password.unwrap_or_default();
        if !ehlo.to_ascii_uppercase().contains("AUTH") {
            return Err(smtp_err("the server does not offer authentication"));
        }
        let token = base64::engine::general_purpose::STANDARD.encode(format!("\0{}\0{pw}", s.username));
        c.cmd(&format!("AUTH PLAIN {token}"), &[235]).await?;
    }
    c.cmd(&format!("MAIL FROM:<{}>", address_of(&s.sender)), &[250]).await?;
    c.cmd(&format!("RCPT TO:<{to}>"), &[250, 251]).await?;
    c.cmd("DATA", &[354]).await?;
    let msg = message(&s.sender, to, subject, body);
    // dot-stuffing: a line that starts with a dot gets one more (the body is base64, the headers do not
    // start with a dot, but the rule costs nothing)
    for line in msg.split("\r\n") {
        let line = if line.starts_with('.') { format!(".{line}") } else { line.to_string() };
        let w = c.io.get_mut();
        w.write_all(line.as_bytes()).await.map_err(smtp_err)?;
        w.write_all(b"\r\n").await.map_err(smtp_err)?;
    }
    c.cmd(".", &[250]).await?;
    let _ = c.cmd("QUIT", &[221]).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sender_and_headers() {
        assert_eq!(address_of("Mosaikit <noreply@example.org>"), "noreply@example.org");
        assert_eq!(address_of("noreply@example.org"), "noreply@example.org");
        assert_eq!(header_text("Hello"), "Hello");
        assert!(header_text("Città").starts_with("=?UTF-8?B?"));
        let m = message("A <a@example.org>", "b@example.org", "Hi", "line one\nline two");
        assert!(m.contains("Content-Transfer-Encoding: base64"));
        assert!(m.contains("Message-ID: <"));
        assert!(m.contains("@example.org>"));
    }
}
