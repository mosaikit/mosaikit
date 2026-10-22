//! Notifications: what the kernel and the plugins tell a person (docs/architecture.md,
//! notifications).
//!
//! A notification belongs to one person and says which tenant it is about (none: the platform). The
//! kernel produces the ones of invitations, shares and public links; a plugin sends its own through the
//! bridge (`msk.notify`), only to the person who is using it or to the people who can see one of its
//! items. Every notification arrives in the app (the bell, updated live); by email only the kinds the
//! person chose, at once or in a daily digest (`mail`).

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

use crate::tenancy::levels;
use crate::{events, mail, Caller, Error, Kernel, Result, SessionUser};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteKind {
    /// an invitation to another tenant, or its answer
    Invitation,
    /// an item shared with the person
    Share,
    /// a public link on an item of the person
    Link,
    /// sent by a plugin
    Plugin,
    /// the platform (Administrators)
    System,
}

pub const KINDS: &[NoteKind] =
    &[NoteKind::Invitation, NoteKind::Share, NoteKind::Link, NoteKind::Plugin, NoteKind::System];

impl NoteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NoteKind::Invitation => "invitation",
            NoteKind::Share => "share",
            NoteKind::Link => "link",
            NoteKind::Plugin => "plugin",
            NoteKind::System => "system",
        }
    }

    pub fn parse(s: &str) -> Result<NoteKind> {
        KINDS
            .iter()
            .copied()
            .find(|k| k.as_str() == s)
            .ok_or_else(|| Error::bad(format!("unknown kind of notification: {s}")))
    }

    /// Sent by email unless the person turns it off.
    fn email_default(self) -> bool {
        !matches!(self, NoteKind::Link)
    }
}

/// Live events for the open sessions of a person (`/api/me/stream`).
#[derive(Debug, Clone, Serialize)]
pub struct Live {
    #[serde(skip)]
    pub user: Uuid,
    /// "notification" (a new one) or "count" (read or deleted)
    pub event: &'static str,
    pub unread: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Uuid>,
}

/// A notification to send.
#[derive(Debug, Clone)]
pub struct New {
    pub user: Uuid,
    pub tenant: Option<Uuid>,
    pub kind: NoteKind,
    /// English text, also the subject of the email
    pub title: String,
    pub body: String,
    /// address in the app (`#/t/<tenant>/...`), may be empty
    pub link: String,
    /// "kernel" or the id of the plugin
    pub source: String,
    pub resource: Option<Uuid>,
    /// `code` and the parameters of the text, for the translations of the interface
    pub data: Value,
}

const TITLE_MAX: usize = 160;
const BODY_MAX: usize = 600;

fn cut(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max - 1).collect();
        t.push('…');
        t
    }
}

/// Stores a notification, sends the email if the person wants it at once and tells the open sessions.
pub async fn send(k: &Kernel, n: New) -> Result<Uuid> {
    let title = cut(&n.title, TITLE_MAX);
    let body = cut(&n.body, BODY_MAX);
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.notifications (user_id, tenant_id, kind, title, body, link, source, resource_id, data)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
    )
    .bind(n.user)
    .bind(n.tenant)
    .bind(n.kind.as_str())
    .bind(&title)
    .bind(&body)
    .bind(&n.link)
    .bind(&n.source)
    .bind(n.resource)
    .bind(&n.data)
    .fetch_one(&k.db)
    .await?;
    let prefs = prefs_of(k, n.user).await?;
    if prefs.mode == "immediate" && prefs.sends(n.kind) {
        if let Some(to) = prefs.address.as_deref() {
            mail::enqueue(k, to, &title, &mail::note_body(k, &body, &n.link).await).await?;
            mosaikit_db::query("update core.notifications set emailed = true where id = $1")
                .bind(id)
                .execute(&k.db)
                .await?;
        }
    }
    tell(k, n.user, "notification", Some(id)).await;
    Ok(id)
}

/// Like `send`, for the producers of the kernel: an error is logged, never returned (a notification
/// must not make an invitation or a share fail).
pub async fn emit(k: &Kernel, n: New) {
    let what = n.kind.as_str();
    if let Err(e) = send(k, n).await {
        tracing::warn!("notification ({what}) not sent: {e}");
    }
}

async fn tell(k: &Kernel, user: Uuid, event: &'static str, id: Option<Uuid>) {
    let unread = unread_count_of(k, user).await.unwrap_or(0);
    let _ = k.live.send(Live { user, event, unread, id });
}

// ------------------------------------------------------------------ reading

#[derive(Debug, Clone, Serialize)]
pub struct Notification {
    pub id: Uuid,
    pub kind: NoteKind,
    pub title: String,
    pub body: String,
    pub link: String,
    pub source: String,
    pub tenant_slug: Option<String>,
    pub tenant_name: Option<String>,
    pub resource_id: Option<Uuid>,
    pub data: Value,
    pub read: bool,
    pub created_at: DateTime<Utc>,
}

/// Filters of the list (all optional).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Filter {
    #[serde(default)]
    pub unread: bool,
    #[serde(default)]
    pub kind: Option<String>,
    /// only the last N days
    #[serde(default)]
    pub days: Option<i64>,
    /// words in the title or in the text
    #[serde(default)]
    pub q: Option<String>,
    /// older than this moment (the next page)
    #[serde(default)]
    pub before: Option<DateTime<Utc>>,
    #[serde(default)]
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Page {
    pub items: Vec<Notification>,
    pub unread: i64,
    /// the moment to pass as `before` for the next page (none: this is the last one)
    pub next: Option<DateTime<Utc>>,
}

pub async fn list(k: &Kernel, user: &SessionUser, f: &Filter) -> Result<Page> {
    let limit = f.limit.unwrap_or(50).clamp(1, 100);
    let mut sql = String::from(
        "select n.id, n.kind, n.title, n.body, n.link, n.source, t.slug, t.name, n.resource_id, n.data,
                n.read_at is not null, n.created_at
         from core.notifications n left join core.tenants t on t.id = n.tenant_id
         where n.user_id = $1",
    );
    let mut params: Vec<Box<dyn FnOnce(mosaikit_db::Query) -> mosaikit_db::Query + Send>> = Vec::new();
    let mut n = 1;
    let uid = user.user_id;
    params.push(Box::new(move |q| q.bind(uid)));
    if f.unread {
        sql.push_str(" and n.read_at is null");
    }
    if let Some(kind) = f.kind.as_deref().filter(|s| !s.is_empty()) {
        let kind = NoteKind::parse(kind)?.as_str();
        n += 1;
        sql.push_str(&format!(" and n.kind = ${n}"));
        params.push(Box::new(move |q| q.bind(kind)));
    }
    if let Some(days) = f.days.filter(|d| *d > 0) {
        let since = Utc::now() - Duration::days(days.min(3650));
        n += 1;
        sql.push_str(&format!(" and n.created_at > ${n}"));
        params.push(Box::new(move |q| q.bind(since)));
    }
    if let Some(words) = f.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let like = format!("%{}%", words.to_lowercase().replace(['%', '_'], ""));
        n += 1;
        sql.push_str(&format!(" and (lower(n.title) like ${n} or lower(n.body) like ${n})"));
        params.push(Box::new(move |q| q.bind(like)));
    }
    if let Some(before) = f.before {
        n += 1;
        sql.push_str(&format!(" and n.created_at < ${n}"));
        params.push(Box::new(move |q| q.bind(before)));
    }
    n += 1;
    sql.push_str(&format!(" order by n.created_at desc limit ${n}"));
    params.push(Box::new(move |q| q.bind(limit + 1)));
    let mut q = mosaikit_db::query(sql);
    for p in params {
        q = p(q);
    }
    let rows = q.fetch_all(&k.db).await?;
    let mut items: Vec<Notification> = rows
        .iter()
        .map(|r| {
            Ok(Notification {
                id: r.get(0),
                kind: NoteKind::parse(r.get::<&str, _>(1))?,
                title: r.get(2),
                body: r.get(3),
                link: r.get(4),
                source: r.get(5),
                tenant_slug: r.get(6),
                tenant_name: r.get(7),
                resource_id: r.get(8),
                data: r.get(9),
                read: r.get(10),
                created_at: r.get(11),
            })
        })
        .collect::<Result<_>>()?;
    let next = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|x| x.created_at)
    } else {
        None
    };
    Ok(Page { items, unread: unread_count_of(k, user.user_id).await?, next })
}

async fn unread_count_of(k: &Kernel, user: Uuid) -> Result<i64> {
    Ok(mosaikit_db::query_scalar(
        "select count(*) from core.notifications where user_id = $1 and read_at is null",
    )
    .bind(user)
    .fetch_one(&k.db)
    .await?)
}

pub async fn unread_count(k: &Kernel, user: &SessionUser) -> Result<i64> {
    unread_count_of(k, user.user_id).await
}

/// Marks as read (or unread) notifications of the person; the others are ignored.
pub async fn mark(k: &Kernel, user: &SessionUser, ids: &[Uuid], read: bool) -> Result<i64> {
    if ids.len() > 500 {
        return Err(Error::bad("at most 500 notifications at a time"));
    }
    let mut n = 0;
    for id in ids {
        let q = if read {
            mosaikit_db::query(
                "update core.notifications set read_at = $3 where id = $1 and user_id = $2 and read_at is null",
            )
            .bind(*id)
            .bind(user.user_id)
            .bind(Utc::now())
        } else {
            mosaikit_db::query("update core.notifications set read_at = null where id = $1 and user_id = $2")
                .bind(*id)
                .bind(user.user_id)
        };
        n += q.execute(&k.db).await?.rows_affected() as i64;
    }
    tell(k, user.user_id, "count", None).await;
    Ok(n)
}

pub async fn mark_all_read(k: &Kernel, user: &SessionUser) -> Result<i64> {
    let n = mosaikit_db::query(
        "update core.notifications set read_at = $2 where user_id = $1 and read_at is null",
    )
    .bind(user.user_id)
    .bind(Utc::now())
    .execute(&k.db)
    .await?
    .rows_affected() as i64;
    tell(k, user.user_id, "count", None).await;
    Ok(n)
}

pub async fn delete(k: &Kernel, user: &SessionUser, ids: &[Uuid]) -> Result<i64> {
    if ids.len() > 500 {
        return Err(Error::bad("at most 500 notifications at a time"));
    }
    let mut n = 0;
    for id in ids {
        n += mosaikit_db::query("delete from core.notifications where id = $1 and user_id = $2")
            .bind(*id)
            .bind(user.user_id)
            .execute(&k.db)
            .await?
            .rows_affected() as i64;
    }
    tell(k, user.user_id, "count", None).await;
    Ok(n)
}

/// Marks as read the notifications about an invitation once it is answered.
async fn close_invitation(k: &Kernel, user: Uuid, invitation: Uuid) {
    let r = mosaikit_db::query(
        "update core.notifications set read_at = $3
         where user_id = $1 and kind = 'invitation' and read_at is null and resource_id = $2",
    )
    .bind(user)
    .bind(invitation)
    .bind(Utc::now())
    .execute(&k.db)
    .await;
    if let Err(e) = r {
        tracing::warn!("notification of the invitation not closed: {e}");
    }
    tell(k, user, "count", None).await;
}

// ------------------------------------------------------------------ preferences

/// What a person receives by email.
#[derive(Debug, Clone, Serialize)]
pub struct Prefs {
    /// the address of the person (none: no email at all)
    pub address: Option<String>,
    /// "off", "immediate" or "digest", the one in use
    pub mode: String,
    /// the mode chosen by the person (none: the default of the tenant or of the platform)
    pub own_mode: Option<String>,
    /// the default of the tenant or of the platform
    pub default_mode: String,
    /// hour of the daily digest (UTC)
    pub digest_hour: i64,
    pub kinds: Vec<KindPref>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KindPref {
    pub kind: NoteKind,
    /// sent by email
    pub email: bool,
}

impl Prefs {
    fn sends(&self, kind: NoteKind) -> bool {
        self.kinds.iter().any(|k| k.kind == kind && k.email)
    }
}

const MODES: &[&str] = &["off", "immediate", "digest"];

pub async fn prefs_of(k: &Kernel, user: Uuid) -> Result<Prefs> {
    let row = mosaikit_db::query(
        "select u.email, u.home_tenant_id, u.is_system_admin, p.email, p.kinds
         from core.users u left join core.notification_prefs p on p.user_id = u.id where u.id = $1",
    )
    .bind(user)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("user not found"))?;
    let address: Option<String> = row.get(0);
    let home: Uuid = row.get(1);
    let admin: bool = row.get(2);
    let own_mode: Option<String> = row.get(3);
    let kinds: Option<Value> = row.get(4);
    let settings = levels::effective(k, (!admin).then_some(home)).await?;
    let default_mode =
        settings.get("notify.email_mode").and_then(Value::as_str).unwrap_or("digest").to_string();
    let digest_hour = settings.get("notify.digest_hour").and_then(Value::as_i64).unwrap_or(7);
    let kinds = kinds.unwrap_or_else(|| json!({}));
    let kinds = KINDS
        .iter()
        .filter(|k| admin || **k != NoteKind::System)
        .map(|kind| KindPref {
            kind: *kind,
            email: kinds.get(kind.as_str()).and_then(Value::as_bool).unwrap_or(kind.email_default()),
        })
        .collect();
    Ok(Prefs {
        address: address.filter(|a| !a.is_empty()),
        mode: own_mode.clone().unwrap_or_else(|| default_mode.clone()),
        own_mode,
        default_mode,
        digest_hour,
        kinds,
    })
}

pub async fn prefs(k: &Kernel, user: &SessionUser) -> Result<Prefs> {
    prefs_of(k, user.user_id).await
}

/// Changes of the preferences: only the fields present change. `mode` null: back to the default.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PrefsChange {
    #[serde(default, deserialize_with = "some")]
    pub address: Option<Option<String>>,
    #[serde(default, deserialize_with = "some")]
    pub mode: Option<Option<String>>,
    #[serde(default)]
    pub kinds: Option<Map<String, Value>>,
}

/// A field present with null is `Some(None)`, absent is `None`.
fn some<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

/// A plausible email address (the mail server says the last word).
pub fn valid_email(s: &str) -> bool {
    let Some((local, domain)) = s.rsplit_once('@') else {
        return false;
    };
    !local.is_empty()
        && s.len() <= 254
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !s.chars().any(|c| c.is_whitespace() || c.is_control() || "<>,;\"".contains(c))
}

pub async fn set_prefs(k: &Kernel, user: &SessionUser, c: &PrefsChange) -> Result<Prefs> {
    if let Some(address) = &c.address {
        let address = address.as_deref().map(str::trim).filter(|a| !a.is_empty());
        if let Some(a) = address {
            if !valid_email(a) {
                return Err(Error::bad("invalid email address").with_code("email_invalid"));
            }
        }
        mosaikit_db::query("update core.users set email = $2 where id = $1")
            .bind(user.user_id)
            .bind(address.map(str::to_lowercase))
            .execute(&k.db)
            .await?;
    }
    if c.mode.is_some() || c.kinds.is_some() {
        let current: Option<mosaikit_db::Row> =
            mosaikit_db::query("select email, kinds from core.notification_prefs where user_id = $1")
                .bind(user.user_id)
                .fetch_optional(&k.db)
                .await?;
        let (mut mode, mut kinds): (Option<String>, Value) = match current {
            Some(r) => (r.get(0), r.get(1)),
            None => (None, json!({})),
        };
        if let Some(m) = &c.mode {
            if let Some(m) = m {
                if !MODES.contains(&m.as_str()) {
                    return Err(Error::bad("mode: off, immediate or digest"));
                }
            }
            mode = m.clone();
        }
        if let Some(change) = &c.kinds {
            if !kinds.is_object() {
                kinds = json!({});
            }
            for (key, v) in change {
                NoteKind::parse(key)?;
                let on = v.as_bool().ok_or_else(|| Error::bad("kinds: true or false"))?;
                kinds[key.as_str()] = json!(on);
            }
        }
        mosaikit_db::query(
            "insert into core.notification_prefs (user_id, email, kinds, updated_at) values ($1, $2, $3, $4)
             on conflict (user_id) do update set email = excluded.email, kinds = excluded.kinds,
                                                 updated_at = excluded.updated_at",
        )
        .bind(user.user_id)
        .bind(mode)
        .bind(kinds)
        .bind(Utc::now())
        .execute(&k.db)
        .await?;
    }
    prefs_of(k, user.user_id).await
}

// ------------------------------------------------------------------ producers

fn display(name: &str, username: &str) -> String {
    if name.trim().is_empty() {
        username.to_string()
    } else {
        name.to_string()
    }
}

/// An invitation to another tenant: to the person invited.
pub async fn invited(k: &Kernel, c: &Caller, invitation: Uuid, user: Uuid, role: &str) {
    let by = display(&c.user.display_name, &c.user.username);
    let tenant = &c.tenant.name;
    emit(
        k,
        New {
            user,
            tenant: Some(c.tenant.tenant_id),
            kind: NoteKind::Invitation,
            title: format!("{by} invited you to {tenant}"),
            body: format!(
                "You can work in {tenant} as {}: accept or decline from the notifications.",
                if role == "tenant_manager" { "Tenant Manager" } else { "User" }
            ),
            link: String::new(),
            source: "kernel".into(),
            resource: Some(invitation),
            data: json!({ "code": "invitation.received", "invitation_id": invitation, "by": by,
                          "tenant": tenant, "role": role }),
        },
    )
    .await;
}

/// The answer to an invitation: closes the notification of the invited person and tells who invited.
pub async fn answered(
    k: &Kernel,
    who: &SessionUser,
    invitation: Uuid,
    tenant: Uuid,
    inviter: Option<Uuid>,
    accept: bool,
) {
    close_invitation(k, who.user_id, invitation).await;
    let Some(inviter) = inviter else { return };
    let row = mosaikit_db::query("select slug, name from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await;
    let Ok(Some(row)) = row else { return };
    let (slug, name): (String, String) = (row.get(0), row.get(1));
    let person = display(&who.display_name, &who.username);
    emit(
        k,
        New {
            user: inviter,
            tenant: Some(tenant),
            kind: NoteKind::Invitation,
            title: if accept {
                format!("{person} accepted the invitation to {name}")
            } else {
                format!("{person} declined the invitation to {name}")
            },
            body: String::new(),
            link: format!("#/t/{slug}/manage"),
            source: "kernel".into(),
            resource: None,
            data: json!({ "code": if accept { "invitation.accepted" } else { "invitation.declined" },
                          "person": person, "tenant": name }),
        },
    )
    .await;
}

/// People who can see an item (owner and grants, also through groups and parents), except `but`.
async fn readers(k: &Kernel, tenant: Uuid, rid: Uuid, but: Uuid) -> Result<Vec<Uuid>> {
    Ok(mosaikit_db::query_scalar(
        "select u.id from core.users u
         join core.memberships m on m.user_id = u.id and m.tenant_id = $1
         where u.id <> $3
           and core.level_for(u.id, $1, $2, (select r.ancestors from core.resources r where r.id = $2)) >= 1
         order by u.id limit 500",
    )
    .bind(tenant)
    .bind(rid)
    .bind(but)
    .fetch_all(&k.db)
    .await?)
}

/// An item shared with a person or a group: to the people who now see it.
pub async fn shared(
    k: &Kernel,
    c: &Caller,
    rid: Uuid,
    plugin: &str,
    title: &str,
    principal_type: &str,
    principal: Uuid,
) {
    let users: Vec<Uuid> = if principal_type == "group" {
        mosaikit_db::query_scalar("select user_id from core.group_members where group_id = $1 limit 500")
            .bind(principal)
            .fetch_all(&k.db)
            .await
            .unwrap_or_default()
    } else {
        vec![principal]
    };
    let by = display(&c.user.display_name, &c.user.username);
    let item = if title.trim().is_empty() { "an item".to_string() } else { format!("«{title}»") };
    for user in users.into_iter().filter(|u| *u != c.user.user_id) {
        emit(
            k,
            New {
                user,
                tenant: Some(c.tenant.tenant_id),
                kind: NoteKind::Share,
                title: format!("{by} shared {item} with you"),
                body: format!("In {}.", c.tenant.name),
                link: format!("#/t/{}/p/{plugin}", c.tenant.slug),
                source: "kernel".into(),
                resource: Some(rid),
                data: json!({ "code": "share.received", "by": by, "item": title, "tenant": c.tenant.name }),
            },
        )
        .await;
    }
}

/// A public link created on an item by somebody else (a manager of the item): to its owner.
pub async fn link_created(k: &Kernel, c: &Caller, rid: Uuid, owner: Uuid, title: &str) {
    if owner == c.user.user_id {
        return;
    }
    let by = display(&c.user.display_name, &c.user.username);
    emit(
        k,
        New {
            user: owner,
            tenant: Some(c.tenant.tenant_id),
            kind: NoteKind::Link,
            title: format!("{by} created a public link to «{title}»"),
            body: "Whoever has the link can open the item without signing in.".into(),
            link: format!("#/t/{}/shares", c.tenant.slug),
            source: "kernel".into(),
            resource: Some(rid),
            data: json!({ "code": "link.created", "by": by, "item": title }),
        },
    )
    .await;
}

// ------------------------------------------------------------------ plugins

/// A notification of a plugin (`msk.notify`).
#[derive(Debug, Clone, Deserialize)]
pub struct PluginNote {
    pub title: String,
    #[serde(default)]
    pub body: String,
    /// a place inside the plugin (passed to its page), e.g. `notes/2f1c...`
    #[serde(default)]
    pub at: Option<String>,
    /// an item of the plugin: the notification goes to the people who can see it (except the sender);
    /// none: only to the person using the plugin
    #[serde(default)]
    pub resource: Option<Uuid>,
}

/// How many notifications a plugin may send in a minute in the name of one person.
const PLUGIN_RATE: usize = 30;

fn valid_at(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"/_-.=&?%:".contains(&b))
}

/// Sends the notification of a plugin. Safe by design: the plugin names no recipient. Without an item it
/// reaches only the person using it; with an item of the same plugin and tenant, on which the person can
/// write, it reaches the people who can see the item. The text is plain, the link stays inside the page of
/// the plugin.
pub async fn from_plugin(k: &Kernel, c: &Caller, plugin: &str, n: &PluginNote) -> Result<i64> {
    let p = k.plugins.active(plugin)?;
    if n.title.trim().is_empty() {
        return Err(Error::bad("the title of the notification is missing"));
    }
    if let Some(at) = &n.at {
        if !valid_at(at) {
            return Err(Error::bad("invalid place of the notification"));
        }
    }
    {
        let mut rate = k.notify_rate.lock().expect("rate");
        let now = std::time::Instant::now();
        let key = (c.user.user_id, p.id.clone());
        let seen = rate.entry(key).or_default();
        seen.retain(|t| now.duration_since(*t) < std::time::Duration::from_secs(60));
        if seen.len() >= PLUGIN_RATE {
            return Err(Error::new(crate::Kind::TooMany, "too many notifications: try again in a minute")
                .with_code("too_many_notifications"));
        }
        seen.push(now);
    }
    let users = match n.resource {
        None => vec![c.user.user_id],
        Some(rid) => {
            let m = crate::acl::require_level(k, c, rid, crate::acl::Level::Write).await?;
            if m.plugin_id != p.id {
                return Err(Error::not_found("resource not found"));
            }
            readers(k, c.tenant.tenant_id, rid, c.user.user_id).await?
        }
    };
    let link = match &n.at {
        Some(at) => format!("#/t/{}/p/{}/{}", c.tenant.slug, p.id, urlencode(at)),
        None => format!("#/t/{}/p/{}", c.tenant.slug, p.id),
    };
    let label = p.manifest.contribution.label.clone();
    for user in &users {
        send(
            k,
            New {
                user: *user,
                tenant: Some(c.tenant.tenant_id),
                kind: NoteKind::Plugin,
                title: n.title.clone(),
                body: n.body.clone(),
                link: link.clone(),
                source: p.id.clone(),
                resource: n.resource,
                data: json!({ "app": label }),
            },
        )
        .await?;
    }
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&p.id),
        n.resource,
        "notify",
        json!({ "recipients": users.len() }),
    )
    .await;
    Ok(users.len() as i64)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

// ------------------------------------------------------------------ retention

/// Deletes the notifications older than the retention of the platform (`notify.retention_days`).
pub async fn purge(k: &Kernel) -> Result<u64> {
    let settings = levels::effective(k, None).await?;
    let days = settings.get("notify.retention_days").and_then(Value::as_i64).unwrap_or(90).max(1);
    let cutoff = Utc::now() - Duration::days(days);
    Ok(mosaikit_db::query("delete from core.notifications where created_at < $1")
        .bind(cutoff)
        .execute(&k.db)
        .await?
        .rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_addresses() {
        for ok in ["anna@example.org", "a.b+c@sub.example.it"] {
            assert!(valid_email(ok), "{ok}");
        }
        for bad in
            ["", "anna", "anna@", "@example.org", "anna@example", "a b@example.org", "anna@.org", "<a@b.c>"]
        {
            assert!(!valid_email(bad), "{bad}");
        }
    }

    #[test]
    fn places_and_texts() {
        assert!(valid_at("notes/2f1c-9"));
        assert!(!valid_at("javascript:alert(1)<"));
        assert!(!valid_at(""));
        assert_eq!(urlencode("a b/c"), "a%20b%2Fc");
        assert_eq!(cut("  hello  ", 10), "hello");
        assert_eq!(cut("abcdef", 4).chars().count(), 4);
    }
}
