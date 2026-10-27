//! People: the directory of the Administrator, the detail of a person (for the Tenant Manager of a
//! tenant and for the Administrator), sessions, activity, one-time links to choose a new password,
//! memberships handled by the Administrator (add to a tenant, role and profile, suspension, removal,
//! move of the home tenant).

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use super::members::{
    create_member_in, member_role, members_of, remove_member_in, set_role_in, set_suspended_in,
};
use super::support::client_tenant;
use super::{require_admin, GroupMember, MemberInfo, RemoveReport};
use crate::access::{self, PluginPerms};
use crate::identity::{check_password_len, password_min};
use crate::util::{random_token, sha256};
use crate::{events, Caller, Error, Kernel, Result, Role, SessionUser};

/// Hours a link to choose a new password stays valid.
const RESET_HOURS: i64 = 48;

/// Who looks at a person: the Tenant Manager of a tenant, or the Administrator.
#[derive(Debug, Clone, Copy)]
pub enum By<'a> {
    Manager(&'a Caller),
    Admin(&'a SessionUser),
}

/// Home tenant and kind of an account.
async fn account(k: &Kernel, user: Uuid) -> Result<(Uuid, bool, Option<String>, String)> {
    let row = mosaikit_db::query(
        "select home_tenant_id, is_system_admin, email, username from core.users where id = $1",
    )
    .bind(user)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("person not found"))?;
    Ok((row.get(0), row.get(1), row.get(2), row.get(3)))
}

/// The actor may act on the account of `user` (sign-in, sessions, password): the Administrator on
/// every account that is not an Administrator, the Tenant Manager on the accounts whose home is their
/// tenant.
async fn check_account(k: &Kernel, by: By<'_>, user: Uuid) -> Result<(Uuid, Option<String>, String)> {
    let (home, is_admin, email, username) = account(k, user).await?;
    match by {
        By::Admin(a) => {
            require_admin(a)?;
            if is_admin {
                return Err(Error::bad("the Administrators are handled in System › Administrators"));
            }
        }
        By::Manager(c) => {
            c.require_manager()?;
            if is_admin || home != c.tenant.tenant_id {
                return Err(Error::forbidden("only the accounts whose home is your tenant"));
            }
        }
    }
    Ok((home, email, username))
}

/// The person is a member of the tenant of the manager (any person for the Administrator).
async fn check_member(k: &Kernel, by: By<'_>, user: Uuid) -> Result<()> {
    match by {
        By::Admin(a) => require_admin(a),
        By::Manager(c) => {
            c.require_manager()?;
            member_role(k, c.tenant.tenant_id, user)
                .await?
                .ok_or_else(|| Error::not_found("member not found"))?;
            Ok(())
        }
    }
}

// ------------------------------------------------------------------ detail for the Tenant Manager

#[derive(Debug, Clone, Serialize)]
pub struct MemberDetail {
    pub member: MemberInfo,
    /// what the person may do in every plugin, and why
    pub permissions: Vec<PluginPerms>,
    /// the tenant is the home of the person: sign-in, sessions and password are handled here
    pub home_here: bool,
}

pub async fn member_detail(k: &Kernel, c: &Caller, user: Uuid, lang: &str) -> Result<MemberDetail> {
    c.require_manager()?;
    let member = members_of(k, c.tenant.tenant_id)
        .await?
        .into_iter()
        .find(|m| m.user_id == user)
        .ok_or_else(|| Error::not_found("member not found"))?;
    Ok(MemberDetail {
        home_here: !member.is_guest,
        permissions: access::explain(k, c.tenant.tenant_id, user, lang).await?,
        member,
    })
}

/// Why a member does or does not see an item: each step of the check, in order.
#[derive(Debug, Clone, Serialize)]
pub struct WhyNot {
    /// level on the item: none, read, write, manage
    pub level: &'static str,
    pub title: String,
    pub plugin_id: String,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Step {
    /// stable code, translated by the interface
    pub code: &'static str,
    pub ok: bool,
    pub detail: String,
}

pub async fn why_not(k: &Kernel, c: &Caller, user: Uuid, rid: Uuid) -> Result<WhyNot> {
    c.require_manager()?;
    let tenant = c.tenant.tenant_id;
    let row = mosaikit_db::query(
        "select r.title, r.plugin_id, r.owner_id, coalesce(nullif(u.display_name, ''), u.username),
                core.level_for($2, r.tenant_id, r.id, r.ancestors)
         from core.resources r join core.users u on u.id = r.owner_id where r.id = $1 and r.tenant_id = $3",
    )
    .bind(rid)
    .bind(user)
    .bind(tenant)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("item not found in the tenant"))?;
    let title: String = if c.tenant.settings.managers_see_titles { row.get(0) } else { String::new() };
    let plugin_id: String = row.get(1);
    let owner: Uuid = row.get(2);
    let level: i32 = row.get(4);
    let state = mosaikit_db::query(
        "select u.status, m.status from core.users u
         left join core.memberships m on m.user_id = u.id and m.tenant_id = $2 where u.id = $1",
    )
    .bind(user)
    .bind(tenant)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("person not found"))?;
    let account_ok = state.get::<String, _>(0) == "active";
    let membership: Option<String> = state.get(1);
    let mut steps = vec![
        Step { code: "account_active", ok: account_ok, detail: String::new() },
        Step {
            code: "member_active",
            ok: membership.as_deref() == Some("active"),
            detail: membership.unwrap_or_else(|| "none".into()),
        },
    ];
    let role = member_role(k, tenant, user).await?.unwrap_or(Role::User);
    let perms = access::effective_all(k, tenant, user, role).await?.remove(&plugin_id).unwrap_or_default();
    steps.push(Step { code: "plugin_use", ok: perms.contains(access::USE), detail: plugin_id.clone() });
    let grants = mosaikit_db::query_scalar::<i64>(
        "select count(*) from core.grants g where g.resource_id = $1
           and ((g.principal_type = 'user' and g.principal_id = $2)
             or (g.principal_type = 'group' and g.principal_id in (select group_id from core.group_members where user_id = $2)))",
    )
    .bind(rid)
    .bind(user)
    .fetch_one(&k.db)
    .await?;
    steps.push(Step { code: "owner", ok: owner == user, detail: row.get(3) });
    steps.push(Step { code: "shared", ok: grants > 0, detail: grants.to_string() });
    Ok(WhyNot { level: crate::acl::Level::from_i32(level).name(), title, plugin_id, steps })
}

// ------------------------------------------------------------------ activity and sessions

#[derive(Debug, Clone, Serialize)]
pub struct EventInfo {
    pub ts: DateTime<Utc>,
    pub action: String,
    pub tenant: Option<String>,
    pub plugin_id: Option<String>,
    pub resource_id: Option<Uuid>,
    pub detail: Value,
}

/// The latest events of a person: in the tenant for its manager, everywhere for the Administrator.
pub async fn person_activity(k: &Kernel, by: By<'_>, user: Uuid) -> Result<Vec<EventInfo>> {
    check_member(k, by, user).await?;
    let tenant = match by {
        By::Manager(c) => Some(c.tenant.tenant_id),
        By::Admin(_) => None,
    };
    let rows = mosaikit_db::query(
        "select e.ts, e.action, t.slug, e.plugin_id, e.resource_id, e.detail
         from core.events e left join core.tenants t on t.id = e.tenant_id
         where (e.user_id = $1 or e.detail->>'user' = $3) and ($2::uuid is null or e.tenant_id = $2)
         order by e.ts desc, e.id desc limit 100",
    )
    .bind(user)
    .bind(tenant)
    // the actions by the person and the ones on the person (suspended, role changed, added…)
    .bind(user.to_string())
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| EventInfo {
            ts: r.get(0),
            action: r.get(1),
            tenant: r.get(2),
            plugin_id: r.get(3),
            resource_id: r.get(4),
            detail: r.get(5),
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    /// identifier of the session (hash of its token: it does not open it)
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

pub async fn person_sessions(k: &Kernel, by: By<'_>, user: Uuid) -> Result<Vec<SessionInfo>> {
    check_account(k, by, user).await?;
    let rows = mosaikit_db::query(
        "select token_hash, created_at, last_seen, expires_at from core.sessions
         where user_id = $1 and pending is null and expires_at > now() order by last_seen desc",
    )
    .bind(user)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| SessionInfo {
            id: hex::encode(r.get::<Vec<u8>, _>(0)),
            created_at: r.get(1),
            last_seen: r.get(2),
            expires_at: r.get(3),
        })
        .collect())
}

pub async fn close_session(k: &Kernel, by: By<'_>, user: Uuid, id: &str) -> Result<()> {
    check_account(k, by, user).await?;
    let hash = hex::decode(id).map_err(|_| Error::bad("invalid session"))?;
    let n = mosaikit_db::query("delete from core.sessions where user_id = $1 and token_hash = $2")
        .bind(user)
        .bind(hash)
        .execute(&k.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(Error::not_found("session not found"));
    }
    events::record(k, None, Some(actor_of(by)), None, None, "person.session.close", json!({ "user": user }))
        .await;
    Ok(())
}

pub async fn close_sessions(k: &Kernel, by: By<'_>, user: Uuid) -> Result<u64> {
    check_account(k, by, user).await?;
    let n = mosaikit_db::query("delete from core.sessions where user_id = $1")
        .bind(user)
        .execute(&k.db)
        .await?
        .rows_affected();
    events::record(
        k,
        None,
        Some(actor_of(by)),
        None,
        None,
        "person.session.close_all",
        json!({ "user": user }),
    )
    .await;
    Ok(n)
}

fn actor_of(by: By<'_>) -> Uuid {
    match by {
        By::Manager(c) => c.user.user_id,
        By::Admin(a) => a.user_id,
    }
}

/// Name and email of an account (the Tenant Manager of its home tenant, or the Administrator).
pub async fn update_person(
    k: &Kernel,
    by: By<'_>,
    user: Uuid,
    display_name: Option<&str>,
    email: Option<&str>,
) -> Result<()> {
    check_account(k, by, user).await?;
    // a local account keeps an address: it cannot be emptied, and an account made before the rule (none
    // yet) gets one with the next edit
    let current: Option<String> = mosaikit_db::query_scalar("select email from core.users where id = $1")
        .bind(user)
        .fetch_one(&k.db)
        .await?;
    let has_now = current.as_deref().is_some_and(|e| !e.trim().is_empty());
    let new = match email {
        Some(e) => Some(crate::notify::required_email_or_empty(e)?),
        None => None,
    };
    let will_have = match &new {
        Some(e) => !e.is_empty(),
        None => has_now,
    };
    if !will_have && !crate::oidc::is_external(k, user).await? {
        return Err(Error::bad("the email address is required").with_code("email_required"));
    }
    if let Some(n) = display_name {
        if n.chars().count() > 120 {
            return Err(Error::bad("the name is too long"));
        }
        mosaikit_db::query("update core.users set display_name = $2 where id = $1")
            .bind(user)
            .bind(n.trim())
            .execute(&k.db)
            .await?;
    }
    if let Some(e) = new {
        mosaikit_db::query("update core.users set email = $2 where id = $1")
            .bind(user)
            .bind((!e.is_empty()).then_some(e))
            .execute(&k.db)
            .await?;
    }
    events::record(k, None, Some(actor_of(by)), None, None, "person.update", json!({ "user": user })).await;
    Ok(())
}

// ------------------------------------------------------------------ links to choose a new password

#[derive(Debug, Clone, Serialize)]
pub struct ResetLink {
    pub url: String,
    pub expires_at: DateTime<Utc>,
    /// sent by email too (the account has an address)
    pub emailed: bool,
}

/// A one-time link to choose a new password, valid 48 hours. It replaces the previous ones; the
/// actor gives it to the person, and it is also sent by email when the account has an address.
pub async fn reset_link(k: &Kernel, by: By<'_>, user: Uuid) -> Result<ResetLink> {
    let (home, email, username) = check_account(k, by, user).await?;
    // the people of a tenant with an identity provider have no local password
    crate::oidc::refuse_local_password(k, home).await?;
    let (url, expires_at) = issue_token(k, user, actor_of(by)).await?;
    let mut emailed = false;
    if let Some(to) = email.filter(|e| !e.is_empty()) {
        let body = format!(
            "A new password was asked for the account {username}.\n\nChoose it here, within {RESET_HOURS} hours: {url}\n\nIf you did not expect it, ignore this message."
        );
        emailed =
            crate::mail::enqueue(k, &to, &format!("New password for {}", k.brand.name), &body).await.is_ok();
    }
    events::record(
        k,
        None,
        Some(actor_of(by)),
        None,
        None,
        "person.reset_link",
        json!({ "user": user, "emailed": emailed }),
    )
    .await;
    Ok(ResetLink { url, expires_at, emailed })
}

/// A new single-use token for the account (the previous ones stop working): the address of the page and
/// the end of its validity.
async fn issue_token(k: &Kernel, user: Uuid, actor: Uuid) -> Result<(String, DateTime<Utc>)> {
    let token = random_token(32);
    let expires_at = Utc::now() + Duration::hours(RESET_HOURS);
    let mut tx = k.db.begin_app().await?;
    mosaikit_db::query("delete from core.password_resets where user_id = $1")
        .bind(user)
        .execute(&mut *tx)
        .await?;
    mosaikit_db::query(
        "insert into core.password_resets (token_hash, user_id, created_by, expires_at) values ($1, $2, $3, $4)",
    )
    .bind(sha256(token.as_bytes()))
    .bind(user)
    .bind(actor)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((format!("{}/#/reset/{token}", k.cfg.app_url.trim_end_matches('/')), expires_at))
}

/// Requests of "Forgot your password?" allowed per person and per address in the window.
const FORGOT_PER_PERSON: u32 = 3;
const FORGOT_PER_ADDRESS: u32 = 20;
const FORGOT_WINDOW: std::time::Duration = std::time::Duration::from_secs(15 * 60);

/// What "Forgot your password?" answers. The same for every username or address, existing or not: it
/// never tells whether an account exists. Only whether the platform can send email at all (a fact of the
/// installation, the same for everybody) is told, so that the page can say what to do instead.
#[derive(Debug, Clone, Serialize)]
pub struct ForgotAnswer {
    pub mail: bool,
}

/// "Forgot your password?" of the sign-in page (public). `who` is the username or the email address of
/// a local account of the tenant. If the account exists and has an address, a message goes to it with a
/// single-use link to choose a new password (valid 48 hours, the earlier ones stop working); an account
/// of an identity provider gets a message that says where the password is managed. Anything else: nothing
/// happens, and the answer is the same. Too many requests are dropped silently (no mail bombing).
pub async fn forgot_password(k: &Kernel, tenant: &str, who: &str, ip: &str) -> Result<ForgotAnswer> {
    if !crate::mail::is_configured(k).await? {
        return Ok(ForgotAnswer { mail: false });
    }
    let who = who.trim().to_lowercase();
    let slug = tenant.trim().to_lowercase();
    if who.is_empty() || who.len() > 254 {
        return Ok(ForgotAnswer { mail: true });
    }
    let (key_who, key_ip) = (format!("forgot:{slug}/{who}"), format!("forgot-ip:{ip}"));
    let blocked = k.limiter.blocked_after(&key_who, FORGOT_PER_PERSON, FORGOT_WINDOW)
        || k.limiter.blocked_after(&key_ip, FORGOT_PER_ADDRESS, FORGOT_WINDOW);
    k.limiter.fail_within(&key_who, FORGOT_WINDOW);
    k.limiter.fail_within(&key_ip, FORGOT_WINDOW);
    if blocked {
        return Ok(ForgotAnswer { mail: true });
    }
    let rows = mosaikit_db::query(
        "select u.id, u.username, u.email from core.users u join core.tenants t on t.id = u.home_tenant_id
         where t.slug = $1 and not t.is_system and not u.is_system_admin and u.status = 'active'
           and u.email is not null and (u.username = $2 or lower(u.email) = $2)",
    )
    .bind(&slug)
    .bind(&who)
    .fetch_all(&k.db)
    .await?;
    for r in rows {
        let (user, username, to): (Uuid, String, String) = (r.get(0), r.get(1), r.get(2));
        let name = &k.brand.name;
        let (subject, body) = if crate::oidc::is_external(k, user).await? {
            (
                format!("Your password for {name}"),
                format!(
                    "A new password was asked for the account {username}.

This account signs in through the identity provider of your organization: the password is managed there, not in {name}. Use the password recovery of your identity provider, or ask your administrator."
                ),
            )
        } else {
            let (url, _) = issue_token(k, user, user).await?;
            (
                format!("New password for {name}"),
                format!(
                    "A new password was asked for the account {username}.

Choose it here, within {RESET_HOURS} hours: {url}

The link works once. If you did not ask for it, ignore this message: your password is unchanged."
                ),
            )
        };
        let _ = crate::mail::enqueue(k, &to, &subject, &body).await;
        events::record(k, None, Some(user), None, None, "person.forgot_password", json!({})).await;
    }
    Ok(ForgotAnswer { mail: true })
}

#[derive(Debug, Clone, Serialize)]
pub struct ResetInfo {
    pub username: String,
    pub tenant: String,
    pub min_length: usize,
}

async fn reset_row(k: &Kernel, token: &str) -> Result<(Uuid, String, Uuid, String)> {
    let row = mosaikit_db::query(
        "select u.id, u.username, u.home_tenant_id, t.name from core.password_resets r
         join core.users u on u.id = r.user_id join core.tenants t on t.id = u.home_tenant_id
         where r.token_hash = $1 and r.used_at is null and r.expires_at > now() and u.status = 'active'",
    )
    .bind(sha256(token.as_bytes()))
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| {
        Error::not_found("the link is not valid any more: ask for a new one").with_code("reset_expired")
    })?;
    Ok((row.get(0), row.get(1), row.get(2), row.get(3)))
}

/// What the page of the link shows (public).
pub async fn reset_info(k: &Kernel, token: &str) -> Result<ResetInfo> {
    let (_, username, home, tenant) = reset_row(k, token).await?;
    Ok(ResetInfo { username, tenant, min_length: password_min(k, Some(home)).await? })
}

/// Sets the new password with a link (public): the link is used up and the sessions closed.
pub async fn reset_with_link(k: &Kernel, token: &str, password: &str) -> Result<()> {
    let (user, _, home, _) = reset_row(k, token).await?;
    check_password_len(password, password_min(k, Some(home)).await?)?;
    // the link is used up in one statement: of two requests at the same instant only one wins
    let hash = sha256(token.as_bytes());
    let won = mosaikit_db::query(
        "update core.password_resets set used_at = now()
         where token_hash = $1 and used_at is null and expires_at > now()",
    )
    .bind(hash.clone())
    .execute(&k.db)
    .await?
    .rows_affected();
    if won != 1 {
        return Err(
            Error::not_found("the link is not valid any more: ask for a new one").with_code("reset_expired")
        );
    }
    if let Err(e) = crate::identity::set_password(k, user, password).await {
        // the password was refused: the link stays usable
        mosaikit_db::query("update core.password_resets set used_at = null where token_hash = $1")
            .bind(hash)
            .execute(&k.db)
            .await?;
        return Err(e);
    }
    mosaikit_db::query("delete from core.sessions where user_id = $1").bind(user).execute(&k.db).await?;
    events::record(k, Some(home), Some(user), None, None, "person.reset_password", json!({})).await;
    Ok(())
}

// ------------------------------------------------------------------ directory of the Administrator

#[derive(Debug, Clone, Serialize)]
pub struct PersonTenant {
    pub tenant_id: Uuid,
    pub slug: String,
    pub name: String,
    pub role: Role,
    pub status: String,
    pub profile_id: Option<Uuid>,
    pub profile: String,
    pub is_home: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersonRow {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub email: Option<String>,
    pub home_tenant_id: Uuid,
    pub home_tenant: String,
    pub is_admin: bool,
    pub status: String,
    pub totp: bool,
    pub last_sign_in_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub tenants: Vec<PersonTenant>,
}

const PERSON_COLUMNS: &str =
    "u.id, u.username, u.display_name, u.email, u.home_tenant_id, h.slug, u.is_system_admin,
    u.status, u.totp_enabled, u.last_sign_in_at, u.created_at";

async fn people_rows(k: &Kernel, only: Option<Uuid>) -> Result<Vec<PersonRow>> {
    let rows = mosaikit_db::query(format!(
        "select {PERSON_COLUMNS}
         from core.users u join core.tenants h on h.id = u.home_tenant_id
         where ($1::uuid is null or u.id = $1)
         order by u.is_system_admin desc, h.slug, u.username"
    ))
    .bind(only)
    .fetch_all(&k.db)
    .await?;
    let ms = mosaikit_db::query(
        "select m.user_id, t.id, t.slug, t.name, m.role, m.status, m.profile_id,
                coalesce(p.name, (select d.name from core.permission_profiles d where d.tenant_id = t.id and d.is_default), ''),
                t.id = u.home_tenant_id
         from core.memberships m join core.tenants t on t.id = m.tenant_id join core.users u on u.id = m.user_id
         left join core.permission_profiles p on p.id = m.profile_id
         where not t.is_system and ($1::uuid is null or m.user_id = $1)
         order by t.id = u.home_tenant_id desc, t.name",
    )
    .bind(only)
    .fetch_all(&k.db)
    .await?;
    person_rows_with(&rows, &ms)
}

/// The people of the rows `rows` (columns `PERSON_COLUMNS`) with their memberships `ms`.
fn person_rows_with(rows: &[mosaikit_db::Row], ms: &[mosaikit_db::Row]) -> Result<Vec<PersonRow>> {
    // the memberships of each person, grouped once (not a scan of all of them for every person)
    let mut by_user: std::collections::HashMap<Uuid, Vec<&mosaikit_db::Row>> =
        std::collections::HashMap::new();
    for m in ms {
        by_user.entry(m.get::<Uuid, _>(0)).or_default().push(m);
    }
    rows.iter()
        .map(|r| {
            let id: Uuid = r.get(0);
            let tenants = by_user
                .get(&id)
                .map(Vec::as_slice)
                .unwrap_or_default()
                .iter()
                .map(|m| {
                    Ok(PersonTenant {
                        tenant_id: m.get(1),
                        slug: m.get(2),
                        name: m.get(3),
                        role: Role::parse(m.get::<&str, _>(4))?,
                        status: m.get(5),
                        profile_id: m.get(6),
                        profile: m.get(7),
                        is_home: m.get(8),
                    })
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(PersonRow {
                user_id: id,
                username: r.get(1),
                display_name: r.get(2),
                email: r.get(3),
                home_tenant_id: r.get(4),
                home_tenant: r.get(5),
                is_admin: r.get(6),
                status: r.get(7),
                totp: r.get(8),
                last_sign_in_at: r.get(9),
                created_at: r.get(10),
                tenants,
            })
        })
        .collect()
}

/// Every person of the installation, Administrators included, with their tenants.
pub async fn directory_of_people(k: &Kernel, admin: &SessionUser) -> Result<Vec<PersonRow>> {
    require_admin(admin)?;
    people_rows(k, None).await
}

/// Filters of the people of the installation (Administrator › People).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PeopleFilter {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub q: Option<String>,
    /// all, several (in more than one tenant), admins
    #[serde(default)]
    pub show: Option<String>,
    #[serde(default)]
    pub tenant: Option<Uuid>,
    /// tenant_manager or user, in any of the tenants
    #[serde(default)]
    pub role: Option<String>,
    /// active or disabled
    #[serde(default)]
    pub status: Option<String>,
    /// only the ids of every match (for "select all"), up to 10,000
    #[serde(default)]
    pub ids: bool,
}

impl PeopleFilter {
    pub fn page(&self) -> crate::paging::PageQuery {
        crate::paging::PageQuery { limit: self.limit, cursor: self.cursor.clone(), q: self.q.clone() }
    }
}

/// A page of the people, with the counts of the pills (all, in several tenants, Administrators).
#[derive(Debug, Clone, Serialize)]
pub struct PeoplePage {
    #[serde(flatten)]
    pub page: crate::paging::Page<PersonRow>,
    pub counts: PeopleCounts,
    /// with `ids`: every person the filter matches
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PeopleCounts {
    pub all: i64,
    pub several: i64,
    pub admins: i64,
}

/// A page of the people of the installation, filtered on the server, in the order of the directory
/// (Administrators first, then by home tenant and username).
pub async fn people_page(k: &Kernel, admin: &SessionUser, f: &PeopleFilter) -> Result<PeoplePage> {
    require_admin(admin)?;
    let like = f.page().like();
    let several = "(select count(*) from core.memberships sm join core.tenants st on st.id = sm.tenant_id
                     where sm.user_id = u.id and not st.is_system) > 1";
    let mut conds: Vec<String> = vec![
        if like.is_some() {
            "(u.username ilike $1 escape '\\' or u.display_name ilike $1 escape '\\' or h.slug ilike $1 escape '\\'
              or coalesce(u.email, '') ilike $1 escape '\\')"
        } else {
            "$1::text is null"
        }
        .to_string(),
        match f.show.as_deref() {
            Some("several") => several.to_string(),
            Some("admins") => "u.is_system_admin".to_string(),
            _ => "true".to_string(),
        },
        if f.tenant.is_some() {
            "exists (select 1 from core.memberships fm where fm.user_id = u.id and fm.tenant_id = $2)"
        } else {
            "$2::uuid is null"
        }
        .to_string(),
        if f.role.as_deref().is_some_and(|r| !r.is_empty() && r != "any") {
            "exists (select 1 from core.memberships rm where rm.user_id = u.id and rm.role = $3)"
        } else {
            "$3::text is null"
        }
        .to_string(),
        if f.status.as_deref().is_some_and(|x| !x.is_empty() && x != "any") {
            "u.status = $4"
        } else {
            "$4::text is null"
        }
        .to_string(),
    ];
    let role = f.role.as_deref().filter(|r| !r.is_empty() && *r != "any");
    let status = f.status.as_deref().filter(|x| !x.is_empty() && *x != "any");
    // the key of the order: Administrators first, then home tenant and username
    let key = "(case when u.is_system_admin then '0' else '1' end) || '/' || h.slug || '/' || u.username";
    let from = "from core.users u join core.tenants h on h.id = u.home_tenant_id";
    let total: i64 =
        mosaikit_db::query_scalar(format!("select count(*) {from} where {}", conds.join(" and ")))
            .bind(like.as_deref())
            .bind(f.tenant)
            .bind(role)
            .bind(status)
            .fetch_one(&k.db)
            .await?;
    let ids = if f.ids {
        Some(
            mosaikit_db::query_scalar(format!(
                "select u.id {from} where {} and not u.is_system_admin order by {key}, u.id limit 10000",
                conds.join(" and ")
            ))
            .bind(like.as_deref())
            .bind(f.tenant)
            .bind(role)
            .bind(status)
            .fetch_all(&k.db)
            .await?,
        )
    } else {
        None
    };
    let limit = f.page().limit();
    let after = f.page().after()?;
    if after.is_some() {
        conds.push(format!("({key}, u.id) > ($5, $6::uuid)"));
    }
    let sql = format!(
        "select {PERSON_COLUMNS}, {key} {from} where {} order by {key}, u.id limit {}",
        conds.join(" and "),
        limit + 1
    );
    let mut q = mosaikit_db::query(sql).bind(like.as_deref()).bind(f.tenant).bind(role).bind(status);
    if let Some((text, id)) = &after {
        q = q.bind(text.clone()).bind(*id);
    }
    let rows = q.fetch_all(&k.db).await?;
    // the memberships of the people of the page only
    let page_ids: Vec<Uuid> = rows.iter().map(|r| r.get::<Uuid, _>(0)).collect();
    let ms = if page_ids.is_empty() {
        Vec::new()
    } else {
        let marks: Vec<String> = (1..=page_ids.len()).map(|i| format!("${i}")).collect();
        let mut q = mosaikit_db::query(format!(
            "select m.user_id, t.id, t.slug, t.name, m.role, m.status, m.profile_id,
                    coalesce(p.name, (select d.name from core.permission_profiles d where d.tenant_id = t.id and d.is_default), ''),
                    t.id = u.home_tenant_id
             from core.memberships m join core.tenants t on t.id = m.tenant_id join core.users u on u.id = m.user_id
             left join core.permission_profiles p on p.id = m.profile_id
             where not t.is_system and m.user_id in ({})
             order by t.id = u.home_tenant_id desc, t.name",
            marks.join(", ")
        ));
        for id in &page_ids {
            q = q.bind(*id);
        }
        q.fetch_all(&k.db).await?
    };
    let keys: Vec<String> = rows.iter().map(|r| r.get::<String, _>(11)).collect();
    let people = person_rows_with(&rows, &ms)?;
    let items: Vec<(PersonRow, String)> = people.into_iter().zip(keys).collect();
    let p = crate::paging::page(items, limit, total, |(person, key)| (key.clone(), person.user_id));
    // grouped, not a subquery per person: 20,000 people took a second
    let counts = mosaikit_db::query(
        "select (select count(*) from core.users),
                (select count(*) from (select sm.user_id from core.memberships sm join core.tenants st on st.id = sm.tenant_id
                                       where not st.is_system group by sm.user_id having count(*) > 1) s),
                (select count(*) from core.users where is_system_admin)",
    )
    .fetch_one(&k.db)
    .await?;
    Ok(PeoplePage {
        page: crate::paging::Page {
            items: p.items.into_iter().map(|(x, _)| x).collect(),
            total: p.total,
            next: p.next,
        },
        counts: PeopleCounts { all: counts.get(0), several: counts.get(1), admins: counts.get(2) },
        ids,
    })
}

pub async fn person(k: &Kernel, admin: &SessionUser, user: Uuid) -> Result<PersonRow> {
    require_admin(admin)?;
    people_rows(k, Some(user)).await?.pop().ok_or_else(|| Error::not_found("person not found"))
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewPerson {
    pub username: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub email: Option<String>,
    pub home_tenant: Uuid,
    pub role: Role,
    #[serde(default)]
    pub profile: Option<Uuid>,
    /// initial password; empty: a link to choose one is created
    #[serde(default)]
    pub password: Option<String>,
    /// other tenants: (tenant, role, profile)
    #[serde(default)]
    pub others: Vec<NewMembership>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewMembership {
    pub tenant: Uuid,
    pub role: Role,
    #[serde(default)]
    pub profile: Option<Uuid>,
}

/// A new local account with its required home tenant, and optionally other tenants. Without an initial
/// password the account gets a link to choose one (returned).
pub async fn create_person(
    k: &Kernel,
    admin: &SessionUser,
    n: &NewPerson,
) -> Result<(PersonRow, Option<ResetLink>)> {
    require_admin(admin)?;
    client_tenant(k, n.home_tenant).await?;
    access::check_profile(k, n.home_tenant, n.profile).await?;
    for o in &n.others {
        client_tenant(k, o.tenant).await?;
        access::check_profile(k, o.tenant, o.profile).await?;
        if o.tenant == n.home_tenant {
            return Err(Error::bad("the home tenant is already a tenant of the person"));
        }
    }
    let email = crate::notify::required_email(n.email.as_deref().unwrap_or_default())?;
    let password = match n.password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => p.to_string(),
        // nobody knows it: the person chooses theirs with the link
        None => random_token(24),
    };
    let user = create_member_in(
        k,
        n.home_tenant,
        admin.user_id,
        &n.username,
        &n.display_name,
        &email,
        &password,
        n.role,
    )
    .await?;
    if n.profile.is_some() {
        access::set_member_profile_in(k, n.home_tenant, admin.user_id, user, n.profile).await?;
    }
    for o in &n.others {
        add_to_tenant(k, admin, user, o.tenant, o.role, o.profile).await?;
    }
    let link = if n.password.as_deref().map(str::trim).unwrap_or_default().is_empty() {
        Some(reset_link(k, By::Admin(admin), user).await?)
    } else {
        None
    };
    Ok((person(k, admin, user).await?, link))
}

/// Disables or reactivates an account (not an Administrator: System › Administrators). A disabled
/// account loses its sessions at once; the only active Tenant Manager of a tenant stays.
pub async fn set_person_status(k: &Kernel, admin: &SessionUser, user: Uuid, active: bool) -> Result<()> {
    check_account(k, By::Admin(admin), user).await?;
    if !active {
        let only: Option<String> = mosaikit_db::query_scalar(
            "select t.slug from core.memberships m join core.tenants t on t.id = m.tenant_id
             where m.user_id = $1 and m.role = 'tenant_manager' and m.status = 'active'
               and not exists (select 1 from core.memberships o join core.users u on u.id = o.user_id
                               where o.tenant_id = m.tenant_id and o.user_id <> $1 and o.role = 'tenant_manager'
                                 and o.status = 'active' and u.status = 'active')
             limit 1",
        )
        .bind(user)
        .fetch_optional(&k.db)
        .await?;
        if let Some(slug) = only {
            return Err(Error::conflict(format!(
                "the person is the only Tenant Manager of the tenant '{slug}': appoint another one first"
            )));
        }
    }
    mosaikit_db::query("update core.users set status = $2 where id = $1")
        .bind(user)
        .bind(if active { "active" } else { "disabled" })
        .execute(&k.db)
        .await?;
    if !active {
        mosaikit_db::query("delete from core.sessions where user_id = $1").bind(user).execute(&k.db).await?;
    }
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        if active { "person.reactivate" } else { "person.disable" },
        json!({ "user": user }),
    )
    .await;
    Ok(())
}

/// Adds a person to a tenant at once (the Administrator does not need an invitation).
pub async fn add_to_tenant(
    k: &Kernel,
    admin: &SessionUser,
    user: Uuid,
    tenant: Uuid,
    role: Role,
    profile: Option<Uuid>,
) -> Result<()> {
    check_account(k, By::Admin(admin), user).await?;
    client_tenant(k, tenant).await?;
    access::check_profile(k, tenant, profile).await?;
    if member_role(k, tenant, user).await?.is_some() {
        return Err(Error::conflict("the person is already a member of the tenant"));
    }
    crate::quotas::check(k, tenant, crate::quotas::Add::people(1)).await?;
    mosaikit_db::query(
        "insert into core.memberships (tenant_id, user_id, role, invited_by, profile_id) values ($1, $2, $3, $4, $5)",
    )
    .bind(tenant)
    .bind(user)
    .bind(role.as_str())
    .bind(admin.user_id)
    .bind(profile)
    .execute(&k.db)
    .await?;
    events::record(
        k,
        Some(tenant),
        Some(admin.user_id),
        None,
        None,
        "member.add",
        json!({ "user": user, "role": role }),
    )
    .await;
    Ok(())
}

/// Role, profile and suspension of a person in a tenant, by the Administrator.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct MembershipChange {
    #[serde(default)]
    pub role: Option<Role>,
    /// `Some(None)`: the default profile of the tenant
    #[serde(default, with = "double_option")]
    pub profile: Option<Option<Uuid>>,
    #[serde(default)]
    pub suspended: Option<bool>,
}

mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Ok(Some(Option::deserialize(d)?))
    }
}

pub async fn update_membership(
    k: &Kernel,
    admin: &SessionUser,
    user: Uuid,
    tenant: Uuid,
    ch: &MembershipChange,
) -> Result<()> {
    require_admin(admin)?;
    client_tenant(k, tenant).await?;
    member_role(k, tenant, user).await?.ok_or_else(|| Error::not_found("member not found"))?;
    if let Some(role) = ch.role {
        set_role_in(k, tenant, admin.user_id, user, role).await?;
    }
    if let Some(profile) = ch.profile {
        access::set_member_profile_in(k, tenant, admin.user_id, user, profile).await?;
    }
    if let Some(s) = ch.suspended {
        set_suspended_in(k, tenant, admin.user_id, user, s).await?;
    }
    Ok(())
}

/// Removes a person from a tenant that is not their home (move the home first); their items there go
/// to `new_owner`.
pub async fn remove_from_tenant(
    k: &Kernel,
    admin: &SessionUser,
    user: Uuid,
    tenant: Uuid,
    new_owner: Option<Uuid>,
) -> Result<RemoveReport> {
    let (home, _, _) = check_account(k, By::Admin(admin), user).await?;
    client_tenant(k, tenant).await?;
    if home == tenant {
        return Err(Error::bad("this is the home tenant of the person: move the home tenant first"));
    }
    remove_member_in(k, tenant, admin.user_id, user, new_owner).await
}

/// Moves the home tenant of a person to another tenant they are a member of: they sign in there from
/// now on; the old home stays as a tenant where they are a guest. Their sessions are closed.
pub async fn move_home(k: &Kernel, admin: &SessionUser, user: Uuid, tenant: Uuid) -> Result<()> {
    let (home, _, username) = check_account(k, By::Admin(admin), user).await?;
    client_tenant(k, tenant).await?;
    if home == tenant {
        return Err(Error::bad("it is already the home tenant"));
    }
    // an account of an identity provider belongs to its tenant, and a tenant with a provider has no
    // local accounts: neither can move
    if crate::oidc::is_external(k, user).await? || crate::oidc::tenant_uses_oidc(k, tenant).await? {
        return Err(Error::bad("the home tenant cannot change for the accounts of an identity provider")
            .with_code("oidc_tenant"));
    }
    member_role(k, tenant, user)
        .await?
        .ok_or_else(|| Error::bad("the person must be a member of the new home tenant first"))?;
    let taken: bool = mosaikit_db::query_scalar(
        "select exists (select 1 from core.users where home_tenant_id = $1 and username = $2)",
    )
    .bind(tenant)
    .bind(&username)
    .fetch_one(&k.db)
    .await?;
    if taken {
        return Err(Error::conflict(format!("the new home tenant already has an account '{username}'")));
    }
    mosaikit_db::query("update core.users set home_tenant_id = $2 where id = $1")
        .bind(user)
        .bind(tenant)
        .execute(&k.db)
        .await?;
    mosaikit_db::query("delete from core.sessions where user_id = $1").bind(user).execute(&k.db).await?;
    events::record(
        k,
        Some(tenant),
        Some(admin.user_id),
        None,
        None,
        "person.move_home",
        json!({ "user": user, "from": home }),
    )
    .await;
    Ok(())
}

// ------------------------------------------------------------------ groups

#[derive(Debug, Clone, Serialize)]
pub struct SharedItem {
    pub resource_id: Uuid,
    pub title: String,
    pub plugin_id: String,
    pub level: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupDetail {
    pub id: Uuid,
    pub name: String,
    pub members: Vec<GroupMember>,
    /// items shared with the group
    pub shared: Vec<SharedItem>,
    /// permissions of plugins given to the group: plugin id -> keys
    pub plugins: Vec<(String, Vec<String>)>,
    /// "mosaikit", or "idp" for a group of the identity provider (read-only)
    pub source: String,
}

pub async fn group_detail(k: &Kernel, c: &Caller, group: Uuid) -> Result<GroupDetail> {
    c.require_manager()?;
    let g = super::groups(k, c)
        .await?
        .into_iter()
        .find(|g| g.id == group)
        .ok_or_else(|| Error::not_found("group not found"))?;
    let titles = c.tenant.settings.managers_see_titles;
    let rows = mosaikit_db::query(
        "select r.id, r.title, r.plugin_id, gr.level from core.grants gr join core.resources r on r.id = gr.resource_id
         where gr.principal_type = 'group' and gr.principal_id = $1 and r.tenant_id = $2 and not core.in_trash(r.id)
         order by r.updated_at desc limit 500",
    )
    .bind(group)
    .bind(c.tenant.tenant_id)
    .fetch_all(&k.db)
    .await?;
    Ok(GroupDetail {
        id: g.id,
        name: g.name,
        members: g.members,
        source: g.source,
        shared: rows
            .iter()
            .map(|r| SharedItem {
                resource_id: r.get(0),
                title: if titles { r.get(1) } else { String::new() },
                plugin_id: r.get(2),
                level: crate::acl::Level::from_i32(r.get::<i16, _>(3) as i32).name(),
            })
            .collect(),
        plugins: access::grants_to(k, c.tenant.tenant_id, "group", group).await?,
    })
}
