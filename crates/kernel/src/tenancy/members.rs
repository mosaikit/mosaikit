//! Members of the tenant: creation, role (Tenant Manager or User), permission profile, suspension,
//! password reset, leaving with reassignment of the resources.

use chrono::{DateTime, Utc};
use mosaikit_db::IntoParam;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::identity::{check_password_len, hash_password, password_min, valid_username};
use crate::{events, Caller, Error, Kernel, Result, Role};

#[derive(Debug, Clone, Serialize)]
pub struct MemberInfo {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub home_tenant: String,
    pub is_guest: bool,
    pub role: Role,
    /// status of the account (`active`, `disabled`)
    pub status: String,
    /// status of the membership in this tenant (`active`, `suspended`)
    pub membership: String,
    /// permission profile (`None`: the default profile of the tenant)
    pub profile_id: Option<Uuid>,
    pub profile: String,
    pub groups: Vec<String>,
    pub email: Option<String>,
    pub last_sign_in_at: Option<DateTime<Utc>>,
    pub joined_at: DateTime<Utc>,
    pub owned_resources: i64,
}

pub async fn members(k: &Kernel, c: &Caller) -> Result<Vec<MemberInfo>> {
    c.require_manager()?;
    members_of(k, c.tenant.tenant_id).await
}

pub(super) async fn members_of(k: &Kernel, tenant: Uuid) -> Result<Vec<MemberInfo>> {
    members_where(k, tenant, "true", &[], "order by u.username").await
}

const MEMBER_COLUMNS: &str =
    "u.id, u.username, u.display_name, h.slug, u.home_tenant_id <> m.tenant_id, m.role, u.status, m.joined_at,
     (select count(*) from core.resources r where r.tenant_id = m.tenant_id and r.owner_id = u.id),
     m.status, m.profile_id,
     coalesce(p.name, (select d.name from core.permission_profiles d where d.tenant_id = m.tenant_id and d.is_default), ''),
     u.email, u.last_sign_in_at";

/// The members of `tenant` matching `cond` ($1 is the tenant, the others `extra` from $2), with their
/// groups: those of the members listed only.
async fn members_where(
    k: &Kernel,
    tenant: Uuid,
    cond: &str,
    extra: &[mosaikit_db::Param],
    tail: &str,
) -> Result<Vec<MemberInfo>> {
    let mut q = mosaikit_db::query(format!(
        "select {MEMBER_COLUMNS}
         from core.memberships m join core.users u on u.id = m.user_id join core.tenants h on h.id = u.home_tenant_id
         left join core.permission_profiles p on p.id = m.profile_id
         where m.tenant_id = $1 and {cond} {tail}"
    ))
    .bind(tenant);
    for e in extra {
        q = q.bind(e.clone());
    }
    let rows = q.fetch_all(&k.db).await?;
    members_from(k, tenant, &rows).await
}

async fn members_from(k: &Kernel, tenant: Uuid, rows: &[mosaikit_db::Row]) -> Result<Vec<MemberInfo>> {
    let groups = mosaikit_db::query(
        "select gm.user_id, g.name from core.group_members gm join core.groups g on g.id = gm.group_id
         where g.tenant_id = $1 order by g.name",
    )
    .bind(tenant)
    .fetch_all(&k.db)
    .await?;
    // the groups of each person, grouped once (not a scan of all of them for every member)
    let mut groups_of: std::collections::HashMap<Uuid, Vec<String>> = std::collections::HashMap::new();
    for g in &groups {
        groups_of.entry(g.get::<Uuid, _>(0)).or_default().push(g.get::<String, _>(1));
    }
    rows.iter()
        .map(|r| {
            Ok(MemberInfo {
                user_id: r.get(0),
                username: r.get(1),
                display_name: r.get(2),
                home_tenant: r.get(3),
                is_guest: r.get(4),
                role: Role::parse(r.get::<&str, _>(5))?,
                status: r.get(6),
                membership: r.get(9),
                profile_id: r.get(10),
                profile: r.get(11),
                groups: groups_of.get(&r.get::<Uuid, _>(0)).cloned().unwrap_or_default(),
                email: r.get(12),
                last_sign_in_at: r.get(13),
                joined_at: r.get(7),
                owned_resources: r.get(8),
            })
        })
        .collect()
}

/// Filters of Manage › People.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct MemberFilter {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub q: Option<String>,
    /// tenant_manager or user
    #[serde(default)]
    pub role: Option<String>,
    /// only the ids of every match (for "select all"), up to 10,000
    #[serde(default)]
    pub ids: bool,
}

impl MemberFilter {
    pub fn page(&self) -> crate::paging::PageQuery {
        crate::paging::PageQuery { limit: self.limit, cursor: self.cursor.clone(), q: self.q.clone() }
    }
}

/// A page of the members of the tenant, by username, filtered on the server.
#[derive(Debug, Clone, Serialize)]
pub struct MemberPage {
    #[serde(flatten)]
    pub page: crate::paging::Page<MemberInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<Uuid>>,
}

pub async fn members_page(k: &Kernel, c: &Caller, f: &MemberFilter) -> Result<MemberPage> {
    c.require_manager()?;
    let tenant = c.tenant.tenant_id;
    let like = f.page().like();
    let role = f.role.as_deref().filter(|r| !r.is_empty() && *r != "any").map(str::to_string);
    let cond = format!(
        "{} and {}",
        if like.is_some() {
            "(u.username ilike $2 escape '\\' or u.display_name ilike $2 escape '\\' or h.slug ilike $2 escape '\\'
              or coalesce(u.email, '') ilike $2 escape '\\')"
        } else {
            "$2::text is null"
        },
        if role.is_some() { "m.role = $3" } else { "$3::text is null" }
    );
    let base = || -> Vec<mosaikit_db::Param> { vec![like.clone().into_param(), role.clone().into_param()] };
    let from = "from core.memberships m join core.users u on u.id = m.user_id join core.tenants h on h.id = u.home_tenant_id
                where m.tenant_id = $1";
    let mut q = mosaikit_db::query_scalar(format!("select count(*) {from} and {cond}")).bind(tenant);
    for p in base() {
        q = q.bind(p);
    }
    let total: i64 = q.fetch_one(&k.db).await?;
    let ids = if f.ids {
        let mut q = mosaikit_db::query_scalar(format!(
            "select u.id {from} and {cond} order by lower(u.username), u.id limit 10000"
        ))
        .bind(tenant);
        for p in base() {
            q = q.bind(p);
        }
        Some(q.fetch_all(&k.db).await?)
    } else {
        None
    };
    let limit = f.page().limit();
    let mut extra = base();
    let mut cond = cond;
    if let Some((text, id)) = f.page().after()? {
        extra.push(mosaikit_db::Param::Text(text));
        extra.push(mosaikit_db::Param::Uuid(id));
        cond.push_str(" and (lower(u.username), u.id) > ($4, $5::uuid)");
    }
    let items = members_where(
        k,
        tenant,
        &cond,
        &extra,
        &format!("order by lower(u.username), u.id limit {}", limit + 1),
    )
    .await?;
    // usernames are lower case (valid_username), so the key of the order is the username itself
    Ok(MemberPage {
        page: crate::paging::page(items, limit, total, |m| (m.username.to_lowercase(), m.user_id)),
        ids,
    })
}

/// Creates a local user with this tenant as home tenant.
pub async fn create_member(
    k: &Kernel,
    c: &Caller,
    username: &str,
    display_name: &str,
    email: &str,
    password: &str,
    role: Role,
) -> Result<Uuid> {
    c.require_manager()?;
    create_member_in(k, c.tenant.tenant_id, c.user.user_id, username, display_name, email, password, role)
        .await
}

/// Creates a local user of `tenant` (for the Administrator too, who appoints a manager).
pub(super) async fn create_member_in(
    k: &Kernel,
    tenant: Uuid,
    actor: Uuid,
    username: &str,
    display_name: &str,
    email: &str,
    password: &str,
    role: Role,
) -> Result<Uuid> {
    // in a tenant that signs in through its provider the people come from the provider
    crate::oidc::refuse_local_password(k, tenant).await?;
    let username = username.trim().to_lowercase();
    if !valid_username(&username) {
        return Err(Error::bad("invalid username: lower case, digits, '.', '-', '_' (2-64)"));
    }
    // a local account has an address: the person gets the link to choose or recover a password there
    let email = crate::notify::required_email(email)?;
    check_password_len(password, password_min(k, Some(tenant)).await?)?;
    crate::quotas::check(k, tenant, crate::quotas::Add::people(1)).await?;
    let hash = hash_password(k, password).await?;
    let mut tx = k.db.begin_app().await?;
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.users (home_tenant_id, username, display_name, email, password_hash) values ($1, $2, $3, $4, $5) returning id",
    )
    .bind(tenant)
    .bind(&username)
    .bind(display_name.trim())
    .bind(&email)
    .bind(hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match Error::from(e) {
        err if err.kind == crate::Kind::Conflict => Error::conflict(format!("the user '{username}' already exists")),
        err => err,
    })?;
    mosaikit_db::query(
        "insert into core.memberships (tenant_id, user_id, role, invited_by) values ($1, $2, $3, $4)",
    )
    .bind(tenant)
    .bind(id)
    .bind(role.as_str())
    .bind(actor)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    events::record(
        k,
        Some(tenant),
        Some(actor),
        None,
        None,
        "member.create",
        json!({ "username": username }),
    )
    .await;
    Ok(id)
}

/// Resets the password of a member whose home tenant is this tenant.
pub async fn reset_member_password(k: &Kernel, c: &Caller, user_id: Uuid, password: &str) -> Result<()> {
    c.require_manager()?;
    reset_password_in(k, c.tenant.tenant_id, user_id, password).await
}

pub(super) async fn reset_password_in(k: &Kernel, tenant: Uuid, user_id: Uuid, password: &str) -> Result<()> {
    // never an Administrator: it is an account of the system tenant, managed only by Administrators
    let home: Option<Uuid> = mosaikit_db::query_scalar(
        "select home_tenant_id from core.users where id = $1 and not is_system_admin",
    )
    .bind(user_id)
    .fetch_optional(&k.db)
    .await?;
    if home != Some(tenant) {
        return Err(Error::forbidden("you can only reset the passwords of the users of your tenant"));
    }
    crate::identity::set_password(k, user_id, password).await?;
    mosaikit_db::query("delete from core.sessions where user_id = $1").bind(user_id).execute(&k.db).await?;
    Ok(())
}

pub(super) async fn managers_count(k: &Kernel, tenant: Uuid) -> Result<i64> {
    Ok(mosaikit_db::query_scalar(
        "select count(*) from core.memberships m join core.users u on u.id = m.user_id
         where m.tenant_id = $1 and m.role = 'tenant_manager' and u.status = 'active' and m.status = 'active'",
    )
    .bind(tenant)
    .fetch_one(&k.db)
    .await?)
}

pub(super) async fn member_role(k: &Kernel, tenant: Uuid, user: Uuid) -> Result<Option<Role>> {
    let r: Option<String> =
        mosaikit_db::query_scalar("select role from core.memberships where tenant_id = $1 and user_id = $2")
            .bind(tenant)
            .bind(user)
            .fetch_optional(&k.db)
            .await?;
    r.map(|s| Role::parse(&s)).transpose()
}

pub async fn set_role(k: &Kernel, c: &Caller, user_id: Uuid, role: Role) -> Result<()> {
    c.require_manager()?;
    set_role_in(k, c.tenant.tenant_id, c.user.user_id, user_id, role).await
}

pub(super) async fn set_role_in(
    k: &Kernel,
    tenant: Uuid,
    actor: Uuid,
    user_id: Uuid,
    role: Role,
) -> Result<()> {
    let current =
        member_role(k, tenant, user_id).await?.ok_or_else(|| Error::not_found("member not found"))?;
    if current == Role::TenantManager && role == Role::User && managers_count(k, tenant).await? <= 1 {
        return Err(Error::bad("the tenant must have at least one manager"));
    }
    mosaikit_db::query("update core.memberships set role = $3 where tenant_id = $1 and user_id = $2")
        .bind(tenant)
        .bind(user_id)
        .bind(role.as_str())
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(tenant),
        Some(actor),
        None,
        None,
        "member.role",
        json!({ "user": user_id, "role": role }),
    )
    .await;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RemoveReport {
    pub reassigned: i64,
    pub disabled: bool,
}

/// Removes a member from the tenant. Their resources go to `new_owner`
/// (required if they own any). If the tenant is their home
/// tenant the account is disabled.
pub async fn remove_member(
    k: &Kernel,
    c: &Caller,
    user_id: Uuid,
    new_owner: Option<Uuid>,
) -> Result<RemoveReport> {
    c.require_manager()?;
    remove_member_in(k, c.tenant.tenant_id, c.user.user_id, user_id, new_owner).await
}

/// Like `remove_member`, by an actor with the authority on the tenant (its manager, or the
/// Administrator).
pub(super) async fn remove_member_in(
    k: &Kernel,
    tenant: Uuid,
    actor: Uuid,
    user_id: Uuid,
    new_owner: Option<Uuid>,
) -> Result<RemoveReport> {
    let role = member_role(k, tenant, user_id).await?.ok_or_else(|| Error::not_found("member not found"))?;
    if role == Role::TenantManager && managers_count(k, tenant).await? <= 1 {
        return Err(Error::bad("you cannot remove the only manager of the tenant"));
    }
    let owned: i64 = mosaikit_db::query_scalar(
        "select count(*) from core.resources where tenant_id = $1 and owner_id = $2",
    )
    .bind(tenant)
    .bind(user_id)
    .fetch_one(&k.db)
    .await?;
    if owned > 0 {
        let to = new_owner.ok_or_else(|| {
            Error::bad(format!("the user owns {owned} resources: say to whom to reassign them"))
        })?;
        if to == user_id {
            return Err(Error::bad("the new owner must be another member"));
        }
        let active: bool = mosaikit_db::query_scalar("select core.is_member($1, $2)")
            .bind(to)
            .bind(tenant)
            .fetch_one(&k.db)
            .await?;
        if !active {
            return Err(Error::bad("the new owner is not an active member of the tenant"));
        }
    }
    let home: Uuid = mosaikit_db::query_scalar("select home_tenant_id from core.users where id = $1")
        .bind(user_id)
        .fetch_one(&k.db)
        .await?;
    let disabled = home == tenant;
    if disabled {
        // the account is disabled: no other tenant must stay without a manager
        let orphan: Option<String> = mosaikit_db::query_scalar(
            "select t.slug from core.memberships m join core.tenants t on t.id = m.tenant_id
             where m.user_id = $1 and m.tenant_id <> $2 and m.role = 'tenant_manager'
               and not exists (select 1 from core.memberships o join core.users u on u.id = o.user_id
                               where o.tenant_id = m.tenant_id and o.user_id <> $1
                                 and o.role = 'tenant_manager' and u.status = 'active')
             limit 1",
        )
        .bind(user_id)
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?;
        if let Some(slug) = orphan {
            return Err(Error::conflict(format!(
                "the user is the only Tenant Manager of the tenant '{slug}': appoint another one first"
            )));
        }
    }

    let mut tx = k.db.begin_app().await?;
    let reassigned = match new_owner {
        Some(to) if owned > 0 => mosaikit_db::query(
            "update core.resources set owner_id = $3, updated_at = now() where tenant_id = $1 and owner_id = $2",
        )
        .bind(tenant)
        .bind(user_id)
        .bind(to)
        .execute(&mut *tx)
        .await?
        .rows_affected() as i64,
        _ => 0,
    };
    mosaikit_db::query(
        "delete from core.grants where principal_type = 'user' and principal_id = $2
           and resource_id in (select id from core.resources where tenant_id = $1)",
    )
    .bind(tenant)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    mosaikit_db::query(
        "delete from core.group_members where user_id = $2 and group_id in (select id from core.groups where tenant_id = $1)",
    )
    .bind(tenant)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;
    mosaikit_db::query("delete from core.memberships where tenant_id = $1 and user_id = $2")
        .bind(tenant)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    if disabled {
        mosaikit_db::query("update core.users set status = 'disabled' where id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        mosaikit_db::query("delete from core.sessions where user_id = $1")
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    events::record(
        k,
        Some(tenant),
        Some(actor),
        None,
        None,
        "member.remove",
        json!({ "user": user_id, "new_owner": new_owner, "reassigned": reassigned, "disabled": disabled }),
    )
    .await;
    Ok(RemoveReport { reassigned, disabled })
}

/// Suspends (or reactivates) the membership of a member: a suspended member keeps account, items and
/// groups but cannot work in the tenant until reactivated.
pub async fn set_member_suspended(k: &Kernel, c: &Caller, user_id: Uuid, suspended: bool) -> Result<()> {
    c.require_manager()?;
    if user_id == c.user.user_id && suspended {
        return Err(Error::bad("you cannot suspend yourself"));
    }
    set_suspended_in(k, c.tenant.tenant_id, c.user.user_id, user_id, suspended).await
}

pub(super) async fn set_suspended_in(
    k: &Kernel,
    tenant: Uuid,
    actor: Uuid,
    user_id: Uuid,
    suspended: bool,
) -> Result<()> {
    let role = member_role(k, tenant, user_id).await?.ok_or_else(|| Error::not_found("member not found"))?;
    if suspended && role == Role::TenantManager && managers_count(k, tenant).await? <= 1 {
        return Err(Error::bad("the tenant must have at least one active manager"));
    }
    if !suspended {
        // a reactivated membership takes a place among the people of the tenant again
        let was: Option<String> = mosaikit_db::query_scalar(
            "select status from core.memberships where tenant_id = $1 and user_id = $2",
        )
        .bind(tenant)
        .bind(user_id)
        .fetch_optional(&k.db)
        .await?;
        if was.as_deref() == Some("suspended") {
            crate::quotas::check(k, tenant, crate::quotas::Add::people(1)).await?;
        }
    }
    mosaikit_db::query("update core.memberships set status = $3 where tenant_id = $1 and user_id = $2")
        .bind(tenant)
        .bind(user_id)
        .bind(if suspended { "suspended" } else { "active" })
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(tenant),
        Some(actor),
        None,
        None,
        if suspended { "member.suspend" } else { "member.reactivate" },
        json!({ "user": user_id }),
    )
    .await;
    Ok(())
}
