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
         where e.user_id = $1 and ($2::uuid is null or e.tenant_id = $2)
         order by e.ts desc, e.id desc limit 100",
    )
    .bind(user)
    .bind(tenant)
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
    if let Some(e) = email {
        let e = e.trim();
        if !e.is_empty() && (!e.contains('@') || e.len() > 200 || e.contains(char::is_whitespace)) {
            return Err(Error::bad("invalid email address"));
        }
        mosaikit_db::query("update core.users set email = $2 where id = $1")
            .bind(user)
            .bind((!e.is_empty()).then(|| e.to_string()))
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
    let (_, email, username) = check_account(k, by, user).await?;
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
    .bind(actor_of(by))
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let url = format!("{}/#/reset/{token}", k.cfg.app_url.trim_end_matches('/'));
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
    crate::identity::set_password(k, user, password).await?;
    mosaikit_db::query("update core.password_resets set used_at = now() where token_hash = $1")
        .bind(sha256(token.as_bytes()))
        .execute(&k.db)
        .await?;
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

async fn people_rows(k: &Kernel, only: Option<Uuid>) -> Result<Vec<PersonRow>> {
    let rows = mosaikit_db::query(
        "select u.id, u.username, u.display_name, u.email, u.home_tenant_id, h.slug, u.is_system_admin, u.status,
                u.totp_enabled, u.last_sign_in_at, u.created_at
         from core.users u join core.tenants h on h.id = u.home_tenant_id
         where ($1::uuid is null or u.id = $1)
         order by u.is_system_admin desc, h.slug, u.username",
    )
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
    rows.iter()
        .map(|r| {
            let id: Uuid = r.get(0);
            let tenants = ms
                .iter()
                .filter(|m| m.get::<Uuid, _>(0) == id)
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
    let password = match n.password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => p.to_string(),
        // nobody knows it: the person chooses theirs with the link
        None => random_token(24),
    };
    let user =
        create_member_in(k, n.home_tenant, admin.user_id, &n.username, &n.display_name, &password, n.role)
            .await?;
    if n.profile.is_some() {
        access::set_member_profile_in(k, n.home_tenant, admin.user_id, user, n.profile).await?;
    }
    if let Some(e) = n.email.as_deref().filter(|e| !e.trim().is_empty()) {
        update_person(k, By::Admin(admin), user, None, Some(e)).await?;
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
         where gr.principal_type = 'group' and gr.principal_id = $1 and r.tenant_id = $2 order by r.updated_at desc limit 500",
    )
    .bind(group)
    .bind(c.tenant.tenant_id)
    .fetch_all(&k.db)
    .await?;
    Ok(GroupDetail {
        id: g.id,
        name: g.name,
        members: g.members,
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
