//! Tenant, membri, inviti, gruppi, policy, rubrica per la condivisione.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::identity::{check_password_policy, hash_password, valid_username};
use crate::{events, Caller, Error, Kernel, Result, Role, SessionUser, TenantCtx, TenantSettings};

pub fn require_admin(user: &SessionUser) -> Result<()> {
    if user.is_system_admin {
        Ok(())
    } else {
        Err(Error::forbidden("operazione riservata all'Administrator"))
    }
}

/// Risolve il tenant attivo di una richiesta e verifica la membership.
pub async fn caller(k: &Kernel, user: &SessionUser, slug: &str) -> Result<Caller> {
    let row = mosaikit_db::query(
        "select t.id, t.slug, t.name, t.settings, m.role from core.tenants t
         join core.memberships m on m.tenant_id = t.id
         where t.slug = $1 and m.user_id = $2 and t.status = 'active'",
    )
    .bind(slug)
    .bind(user.user_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::forbidden(format!("non sei membro del tenant '{slug}'")))?;
    let settings: Value = row.get(3);
    Ok(Caller {
        user: user.clone(),
        tenant: TenantCtx {
            tenant_id: row.get(0),
            slug: row.get(1),
            name: row.get(2),
            settings: serde_json::from_value(settings).unwrap_or_default(),
            role: Role::parse(row.get::<&str, _>(4))?,
        },
    })
}

fn valid_slug(s: &str) -> bool {
    let mut c = s.chars();
    matches!(c.next(), Some('a'..='z' | '0'..='9'))
        && (2..=40).contains(&s.len())
        && c.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

// ------------------------------------------------------------------ tenant (admin)

#[derive(Debug, Clone, Serialize)]
pub struct TenantInfo {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub status: String,
    pub is_system: bool,
    pub members: i64,
    pub guests: i64,
    pub resources: i64,
    pub bytes: i64,
    pub created_at: DateTime<Utc>,
}

const TENANT_INFO_SQL: &str = "
    select t.id, t.slug, t.name, t.status, t.is_system,
           (select count(*) from core.memberships m join core.users u on u.id = m.user_id
             where m.tenant_id = t.id and u.home_tenant_id = t.id) as members,
           (select count(*) from core.memberships m join core.users u on u.id = m.user_id
             where m.tenant_id = t.id and u.home_tenant_id <> t.id) as guests,
           (select count(*) from core.resources r where r.tenant_id = t.id) as resources,
           (select coalesce(sum(size_bytes), 0)::bigint from core.resources r where r.tenant_id = t.id) as bytes,
           t.created_at
    from core.tenants t";

fn tenant_info(r: &mosaikit_db::Row) -> TenantInfo {
    TenantInfo {
        id: r.get(0),
        slug: r.get(1),
        name: r.get(2),
        status: r.get(3),
        is_system: r.get(4),
        members: r.get(5),
        guests: r.get(6),
        resources: r.get(7),
        bytes: r.get(8),
        created_at: r.get(9),
    }
}

pub async fn list_tenants(k: &Kernel, admin: &SessionUser) -> Result<Vec<TenantInfo>> {
    require_admin(admin)?;
    let rows = mosaikit_db::query(format!("{TENANT_INFO_SQL} order by t.is_system desc, t.name"))
        .fetch_all(&k.db)
        .await?;
    Ok(rows.iter().map(tenant_info).collect())
}

pub struct NewTenant<'a> {
    pub slug: &'a str,
    pub name: &'a str,
    pub manager_username: &'a str,
    pub manager_display_name: &'a str,
    pub manager_password: &'a str,
}

pub async fn create_tenant(k: &Kernel, admin: &SessionUser, t: NewTenant<'_>) -> Result<TenantInfo> {
    require_admin(admin)?;
    let slug = t.slug.trim().to_lowercase();
    if !valid_slug(&slug) {
        return Err(Error::bad("slug non valido: 2-40 caratteri, minuscole, cifre e '-'"));
    }
    if t.name.trim().is_empty() {
        return Err(Error::bad("nome del tenant obbligatorio"));
    }
    let username = t.manager_username.trim().to_lowercase();
    if !valid_username(&username) {
        return Err(Error::bad("username del gestore non valido"));
    }
    check_password_policy(t.manager_password)?;
    let hash = hash_password(k, t.manager_password).await?;
    let mut tx = k.db.begin_app().await?;
    let id: Uuid =
        mosaikit_db::query_scalar("insert into core.tenants (slug, name) values ($1, $2) returning id")
            .bind(&slug)
            .bind(t.name.trim())
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| match Error::from(e) {
                err if err.kind == crate::Kind::Conflict => {
                    Error::conflict(format!("esiste gia' un tenant '{slug}'"))
                }
                err => err,
            })?;
    let manager: Uuid = mosaikit_db::query_scalar(
        "insert into core.users (home_tenant_id, username, display_name, password_hash) values ($1, $2, $3, $4) returning id",
    )
    .bind(id)
    .bind(&username)
    .bind(t.manager_display_name.trim())
    .bind(hash)
    .fetch_one(&mut *tx)
    .await?;
    mosaikit_db::query(
        "insert into core.memberships (tenant_id, user_id, role) values ($1, $2, 'tenant_manager')",
    )
    .bind(id)
    .bind(manager)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    events::record(k, Some(id), Some(admin.user_id), None, None, "tenant.create", json!({ "slug": slug }))
        .await;
    let row =
        mosaikit_db::query(format!("{TENANT_INFO_SQL} where t.id = $1")).bind(id).fetch_one(&k.db).await?;
    Ok(tenant_info(&row))
}

pub async fn set_tenant_status(k: &Kernel, admin: &SessionUser, id: Uuid, status: &str) -> Result<()> {
    require_admin(admin)?;
    if !["active", "suspended"].contains(&status) {
        return Err(Error::bad("stato non valido"));
    }
    let n = mosaikit_db::query("update core.tenants set status = $2 where id = $1 and not is_system")
        .bind(id)
        .bind(status)
        .execute(&k.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(Error::bad("tenant inesistente o di sistema"));
    }
    events::record(
        k,
        Some(id),
        Some(admin.user_id),
        None,
        None,
        "tenant.status",
        json!({ "status": status }),
    )
    .await;
    Ok(())
}

// ------------------------------------------------------------------ administrator

/// Utente con il ruolo di sistema Administrator.
#[derive(Debug, Clone, Serialize)]
pub struct AdminInfo {
    pub user_id: Uuid,
    pub tenant: String,
    pub username: String,
    pub display_name: String,
    pub status: String,
}

pub async fn administrators(k: &Kernel, admin: &SessionUser) -> Result<Vec<AdminInfo>> {
    require_admin(admin)?;
    let rows = mosaikit_db::query(
        "select u.id, t.slug, u.username, u.display_name, u.status from core.users u
         join core.tenants t on t.id = u.home_tenant_id where u.is_system_admin order by t.slug, u.username",
    )
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| AdminInfo {
            user_id: r.get(0),
            tenant: r.get(1),
            username: r.get(2),
            display_name: r.get(3),
            status: r.get(4),
        })
        .collect())
}

/// Assegna o toglie il ruolo Administrator a `<tenant>/<username>`. Resta sempre
/// almeno un Administrator attivo.
pub async fn set_administrator(
    k: &Kernel,
    admin: &SessionUser,
    tenant: &str,
    username: &str,
    on: bool,
) -> Result<()> {
    require_admin(admin)?;
    let mut tx = k.db.begin_app().await?;
    // serializza le modifiche concorrenti (mai zero amministratori)
    mosaikit_db::query("select pg_advisory_xact_lock(hashtext('mosaikit.administrators'))")
        .execute(&mut *tx)
        .await?;
    let row = mosaikit_db::query(
        "select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id
         where t.slug = $1 and u.username = $2",
    )
    .bind(tenant)
    .bind(username)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| Error::not_found(format!("utente {tenant}/{username} inesistente")))?;
    let id: Uuid = row.get(0);
    if !on {
        let others: i64 = mosaikit_db::query_scalar(
            "select count(*) from core.users where is_system_admin and status = 'active' and id <> $1",
        )
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
        if others == 0 {
            return Err(Error::conflict("deve restare almeno un Administrator attivo"));
        }
    }
    mosaikit_db::query("update core.users set is_system_admin = $2 where id = $1")
        .bind(id)
        .bind(on)
        .execute(&mut *tx)
        .await?;
    if !on {
        // le sessioni aperte perdono subito i privilegi
        mosaikit_db::query("delete from core.sessions where user_id = $1").bind(id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        if on { "admin.grant" } else { "admin.revoke" },
        json!({ "user": id, "tenant": tenant, "username": username }),
    )
    .await;
    Ok(())
}

// ------------------------------------------------------------------ membri

#[derive(Debug, Clone, Serialize)]
pub struct MemberInfo {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub home_tenant: String,
    pub is_guest: bool,
    pub role: Role,
    pub status: String,
    pub joined_at: DateTime<Utc>,
    pub owned_resources: i64,
}

pub async fn members(k: &Kernel, c: &Caller) -> Result<Vec<MemberInfo>> {
    c.require_manager()?;
    let rows = mosaikit_db::query(
        "select u.id, u.username, u.display_name, h.slug, u.home_tenant_id <> m.tenant_id, m.role, u.status, m.joined_at,
                (select count(*) from core.resources r where r.tenant_id = m.tenant_id and r.owner_id = u.id)
         from core.memberships m join core.users u on u.id = m.user_id join core.tenants h on h.id = u.home_tenant_id
         where m.tenant_id = $1 order by u.username",
    )
    .bind(c.tenant.tenant_id)
    .fetch_all(&k.db)
    .await?;
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
                joined_at: r.get(7),
                owned_resources: r.get(8),
            })
        })
        .collect()
}

/// Crea un utente locale con questo tenant come tenant di appartenenza.
pub async fn create_member(
    k: &Kernel,
    c: &Caller,
    username: &str,
    display_name: &str,
    password: &str,
    role: Role,
) -> Result<Uuid> {
    c.require_manager()?;
    let username = username.trim().to_lowercase();
    if !valid_username(&username) {
        return Err(Error::bad("username non valido: minuscole, cifre, '.', '-', '_' (2-64)"));
    }
    check_password_policy(password)?;
    let hash = hash_password(k, password).await?;
    let mut tx = k.db.begin_app().await?;
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.users (home_tenant_id, username, display_name, password_hash) values ($1, $2, $3, $4) returning id",
    )
    .bind(c.tenant.tenant_id)
    .bind(&username)
    .bind(display_name.trim())
    .bind(hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match Error::from(e) {
        err if err.kind == crate::Kind::Conflict => Error::conflict(format!("l'utente '{username}' esiste gia'")),
        err => err,
    })?;
    mosaikit_db::query(
        "insert into core.memberships (tenant_id, user_id, role, invited_by) values ($1, $2, $3, $4)",
    )
    .bind(c.tenant.tenant_id)
    .bind(id)
    .bind(role.as_str())
    .bind(c.user.user_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "member.create",
        json!({ "username": username }),
    )
    .await;
    Ok(id)
}

/// Reimposta la password di un membro che ha questo tenant come tenant di appartenenza.
pub async fn reset_member_password(k: &Kernel, c: &Caller, user_id: Uuid, password: &str) -> Result<()> {
    c.require_manager()?;
    let home: Option<Uuid> = mosaikit_db::query_scalar("select home_tenant_id from core.users where id = $1")
        .bind(user_id)
        .fetch_optional(&k.db)
        .await?;
    if home != Some(c.tenant.tenant_id) {
        return Err(Error::forbidden("puoi reimpostare solo le password degli utenti del tuo tenant"));
    }
    crate::identity::set_password(k, user_id, password).await?;
    mosaikit_db::query("delete from core.sessions where user_id = $1").bind(user_id).execute(&k.db).await?;
    Ok(())
}

async fn managers_count(k: &Kernel, tenant: Uuid) -> Result<i64> {
    Ok(mosaikit_db::query_scalar(
        "select count(*) from core.memberships m join core.users u on u.id = m.user_id
         where m.tenant_id = $1 and m.role = 'tenant_manager' and u.status = 'active'",
    )
    .bind(tenant)
    .fetch_one(&k.db)
    .await?)
}

async fn member_role(k: &Kernel, tenant: Uuid, user: Uuid) -> Result<Option<Role>> {
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
    let current = member_role(k, c.tenant.tenant_id, user_id)
        .await?
        .ok_or_else(|| Error::not_found("membro non trovato"))?;
    if current == Role::TenantManager
        && role == Role::User
        && managers_count(k, c.tenant.tenant_id).await? <= 1
    {
        return Err(Error::bad("il tenant deve avere almeno un gestore"));
    }
    mosaikit_db::query("update core.memberships set role = $3 where tenant_id = $1 and user_id = $2")
        .bind(c.tenant.tenant_id)
        .bind(user_id)
        .bind(role.as_str())
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
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

/// Rimuove un membro dal tenant. Le sue risorse passano a `new_owner`
/// (obbligatorio se ne possiede). Se il tenant e' il suo tenant di
/// appartenenza l'account viene disabilitato.
pub async fn remove_member(
    k: &Kernel,
    c: &Caller,
    user_id: Uuid,
    new_owner: Option<Uuid>,
) -> Result<RemoveReport> {
    c.require_manager()?;
    let tenant = c.tenant.tenant_id;
    let role =
        member_role(k, tenant, user_id).await?.ok_or_else(|| Error::not_found("membro non trovato"))?;
    if role == Role::TenantManager && managers_count(k, tenant).await? <= 1 {
        return Err(Error::bad("non puoi rimuovere l'unico gestore del tenant"));
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
            Error::bad(format!("l'utente possiede {owned} risorse: indica a chi riassegnarle"))
        })?;
        if to == user_id {
            return Err(Error::bad("il nuovo proprietario deve essere un altro membro"));
        }
        let active: bool = mosaikit_db::query_scalar("select core.is_member($1, $2)")
            .bind(to)
            .bind(tenant)
            .fetch_one(&k.db)
            .await?;
        if !active {
            return Err(Error::bad("il nuovo proprietario non e' un membro attivo del tenant"));
        }
    }
    let home: Uuid = mosaikit_db::query_scalar("select home_tenant_id from core.users where id = $1")
        .bind(user_id)
        .fetch_one(&k.db)
        .await?;
    let disabled = home == tenant;

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
        Some(c.user.user_id),
        None,
        None,
        "member.remove",
        json!({ "user": user_id, "new_owner": new_owner, "reassigned": reassigned, "disabled": disabled }),
    )
    .await;
    Ok(RemoveReport { reassigned, disabled })
}

// ------------------------------------------------------------------ inviti

#[derive(Debug, Clone, Serialize)]
pub struct InvitationInfo {
    pub id: Uuid,
    pub tenant_slug: String,
    pub tenant_name: String,
    pub user_id: Uuid,
    pub user: String,
    pub role: Role,
    pub status: String,
    pub invited_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

const INVITE_SQL: &str = "
    select i.id, t.slug, t.name, u.id, u.username || '@' || h.slug, i.role,
           case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
           coalesce(nullif(b.display_name, ''), b.username), i.created_at, i.expires_at
    from core.invitations i
    join core.tenants t on t.id = i.tenant_id
    join core.users u on u.id = i.user_id
    join core.tenants h on h.id = u.home_tenant_id
    left join core.users b on b.id = i.invited_by";

fn invitation(r: &mosaikit_db::Row) -> Result<InvitationInfo> {
    Ok(InvitationInfo {
        id: r.get(0),
        tenant_slug: r.get(1),
        tenant_name: r.get(2),
        user_id: r.get(3),
        user: r.get(4),
        role: Role::parse(r.get::<&str, _>(5))?,
        status: r.get(6),
        invited_by: r.get(7),
        created_at: r.get(8),
        expires_at: r.get(9),
    })
}

/// Invita nel tenant corrente un utente di un altro tenant (`username` + tenant di appartenenza).
pub async fn invite(
    k: &Kernel,
    c: &Caller,
    home_tenant: &str,
    username: &str,
    role: Role,
) -> Result<InvitationInfo> {
    c.require_manager()?;
    let user: Option<Uuid> = mosaikit_db::query_scalar(
        "select u.id from core.users u join core.tenants t on t.id = u.home_tenant_id
         where t.slug = $1 and u.username = $2 and u.status = 'active'",
    )
    .bind(home_tenant.trim().to_lowercase())
    .bind(username.trim().to_lowercase())
    .fetch_optional(&k.db)
    .await?;
    let user = user.ok_or_else(|| Error::not_found("utente non trovato nel tenant indicato"))?;
    if member_role(k, c.tenant.tenant_id, user).await?.is_some() {
        return Err(Error::conflict("l'utente e' gia' membro del tenant"));
    }
    let pending: bool = mosaikit_db::query_scalar(
        "select exists (select 1 from core.invitations where tenant_id = $1 and user_id = $2 and status = 'pending' and expires_at > now())",
    )
    .bind(c.tenant.tenant_id)
    .bind(user)
    .fetch_one(&k.db)
    .await?;
    if pending {
        return Err(Error::conflict("esiste gia' un invito in attesa per questo utente"));
    }
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.invitations (tenant_id, user_id, role, invited_by) values ($1, $2, $3, $4) returning id",
    )
    .bind(c.tenant.tenant_id)
    .bind(user)
    .bind(role.as_str())
    .bind(c.user.user_id)
    .fetch_one(&k.db)
    .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "invitation.create",
        json!({ "user": user, "role": role }),
    )
    .await;
    let row = mosaikit_db::query(format!("{INVITE_SQL} where i.id = $1")).bind(id).fetch_one(&k.db).await?;
    invitation(&row)
}

pub async fn tenant_invitations(k: &Kernel, c: &Caller) -> Result<Vec<InvitationInfo>> {
    c.require_manager()?;
    let rows = mosaikit_db::query(format!("{INVITE_SQL} where i.tenant_id = $1 order by i.created_at desc"))
        .bind(c.tenant.tenant_id)
        .fetch_all(&k.db)
        .await?;
    rows.iter().map(invitation).collect()
}

pub async fn revoke_invitation(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    c.require_manager()?;
    let n = mosaikit_db::query("update core.invitations set status = 'revoked' where id = $1 and tenant_id = $2 and status = 'pending'")
        .bind(id)
        .bind(c.tenant.tenant_id)
        .execute(&k.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(Error::not_found("invito non trovato o gia' chiuso"));
    }
    Ok(())
}

pub async fn my_invitations(k: &Kernel, user: &SessionUser) -> Result<Vec<InvitationInfo>> {
    let rows = mosaikit_db::query(format!(
        "{INVITE_SQL} where i.user_id = $1 and i.status = 'pending' and i.expires_at > now() order by i.created_at desc"
    ))
    .bind(user.user_id)
    .fetch_all(&k.db)
    .await?;
    rows.iter().map(invitation).collect()
}

pub async fn respond_invitation(k: &Kernel, user: &SessionUser, id: Uuid, accept: bool) -> Result<()> {
    let mut tx = k.db.begin_app().await?;
    let row = mosaikit_db::query(
        "select tenant_id, role, invited_by from core.invitations
         where id = $1 and user_id = $2 and status = 'pending' and expires_at > now() for update",
    )
    .bind(id)
    .bind(user.user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| Error::not_found("invito non trovato o scaduto"))?;
    let tenant: Uuid = row.get(0);
    let role: String = row.get(1);
    let invited_by: Option<Uuid> = row.get(2);
    mosaikit_db::query("update core.invitations set status = $2 where id = $1")
        .bind(id)
        .bind(if accept { "accepted" } else { "declined" })
        .execute(&mut *tx)
        .await?;
    if accept {
        mosaikit_db::query(
            "insert into core.memberships (tenant_id, user_id, role, invited_by) values ($1, $2, $3, $4)
             on conflict do nothing",
        )
        .bind(tenant)
        .bind(user.user_id)
        .bind(role)
        .bind(invited_by)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    events::record(
        k,
        Some(tenant),
        Some(user.user_id),
        None,
        None,
        if accept { "invitation.accept" } else { "invitation.decline" },
        json!({}),
    )
    .await;
    Ok(())
}

// ------------------------------------------------------------------ gruppi

#[derive(Debug, Clone, Serialize)]
pub struct GroupMember {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupInfo {
    pub id: Uuid,
    pub name: String,
    pub members: Vec<GroupMember>,
}

pub async fn groups(k: &Kernel, c: &Caller) -> Result<Vec<GroupInfo>> {
    let rows = mosaikit_db::query(
        "select g.id, g.name, coalesce(json_agg(json_build_object('user_id', u.id, 'username', u.username,
                'display_name', u.display_name) order by u.username) filter (where u.id is not null), '[]')
         from core.groups g left join core.group_members gm on gm.group_id = g.id left join core.users u on u.id = gm.user_id
         where g.tenant_id = $1 group by g.id order by g.name",
    )
    .bind(c.tenant.tenant_id)
    .fetch_all(&k.db)
    .await?;
    rows.iter()
        .map(|r| {
            let members: Value = r.get(2);
            Ok(GroupInfo {
                id: r.get(0),
                name: r.get(1),
                members: members
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .map(|m| GroupMember {
                                user_id: m["user_id"]
                                    .as_str()
                                    .and_then(|s| s.parse().ok())
                                    .unwrap_or_default(),
                                username: m["username"].as_str().unwrap_or_default().into(),
                                display_name: m["display_name"].as_str().unwrap_or_default().into(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect()
}

pub async fn create_group(k: &Kernel, c: &Caller, name: &str) -> Result<Uuid> {
    c.require_manager()?;
    let name = name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(Error::bad("nome del gruppo non valido"));
    }
    let id: Uuid =
        mosaikit_db::query_scalar("insert into core.groups (tenant_id, name) values ($1, $2) returning id")
            .bind(c.tenant.tenant_id)
            .bind(name)
            .fetch_one(&k.db)
            .await
            .map_err(|e| match Error::from(e) {
                err if err.kind == crate::Kind::Conflict => {
                    Error::conflict(format!("esiste gia' il gruppo '{name}'"))
                }
                err => err,
            })?;
    Ok(id)
}

pub async fn delete_group(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    c.require_manager()?;
    let mut tx = k.db.begin_app().await?;
    let n = mosaikit_db::query("delete from core.groups where id = $1 and tenant_id = $2")
        .bind(id)
        .bind(c.tenant.tenant_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(Error::not_found("gruppo non trovato"));
    }
    mosaikit_db::query("delete from core.grants where principal_type = 'group' and principal_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn set_group_member(k: &Kernel, c: &Caller, group: Uuid, user: Uuid, member: bool) -> Result<()> {
    c.require_manager()?;
    let ok: bool = mosaikit_db::query_scalar(
        "select exists (select 1 from core.groups where id = $1 and tenant_id = $2)",
    )
    .bind(group)
    .bind(c.tenant.tenant_id)
    .fetch_one(&k.db)
    .await?;
    if !ok {
        return Err(Error::not_found("gruppo non trovato"));
    }
    if member {
        if member_role(k, c.tenant.tenant_id, user).await?.is_none() {
            return Err(Error::bad("l'utente non e' membro del tenant"));
        }
        mosaikit_db::query(
            "insert into core.group_members (group_id, user_id) values ($1, $2) on conflict do nothing",
        )
        .bind(group)
        .bind(user)
        .execute(&k.db)
        .await?;
    } else {
        mosaikit_db::query("delete from core.group_members where group_id = $1 and user_id = $2")
            .bind(group)
            .bind(user)
            .execute(&k.db)
            .await?;
    }
    Ok(())
}

// ------------------------------------------------------------------ policy e preferenze

pub async fn set_settings(k: &Kernel, c: &Caller, s: &TenantSettings) -> Result<()> {
    c.require_manager()?;
    if s.public_link_max_days > 3650 {
        return Err(Error::bad("durata massima dei link: al massimo 3650 giorni"));
    }
    mosaikit_db::query("update core.tenants set settings = $2 where id = $1")
        .bind(c.tenant.tenant_id)
        .bind(serde_json::to_value(s)?)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "tenant.settings",
        serde_json::to_value(s)?,
    )
    .await;
    Ok(())
}

pub async fn prefs(k: &Kernel, c: &Caller) -> Result<Value> {
    let p: Option<Value> =
        mosaikit_db::query_scalar("select prefs from core.user_prefs where user_id = $1 and tenant_id = $2")
            .bind(c.user.user_id)
            .bind(c.tenant.tenant_id)
            .fetch_optional(&k.db)
            .await?;
    Ok(p.unwrap_or_else(|| json!({})))
}

pub async fn set_prefs(k: &Kernel, c: &Caller, prefs: &Value) -> Result<()> {
    if !prefs.is_object() || prefs.to_string().len() > 16 * 1024 {
        return Err(Error::bad("preferenze non valide"));
    }
    mosaikit_db::query(
        "insert into core.user_prefs (user_id, tenant_id, prefs) values ($1, $2, $3)
         on conflict (user_id, tenant_id) do update set prefs = excluded.prefs",
    )
    .bind(c.user.user_id)
    .bind(c.tenant.tenant_id)
    .bind(prefs)
    .execute(&k.db)
    .await?;
    Ok(())
}

// ------------------------------------------------------------------ rubrica

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Principal {
    pub kind: String,
    pub id: Uuid,
    pub name: String,
    pub detail: String,
}

/// Utenti e gruppi del tenant (per la finestra di condivisione).
pub async fn directory(k: &Kernel, c: &Caller, q: &str) -> Result<Vec<Principal>> {
    let like = format!("%{}%", crate::util::like_escape(q.trim()));
    let rows = mosaikit_db::query(
        "select 'user', u.id, coalesce(nullif(u.display_name, ''), u.username), u.username || '@' || h.slug
         from core.memberships m join core.users u on u.id = m.user_id join core.tenants h on h.id = u.home_tenant_id
         where m.tenant_id = $1 and u.status = 'active'
           and (u.username ilike $2 escape '\\' or u.display_name ilike $2 escape '\\')
         union all
         select 'group', g.id, g.name, (select count(*) from core.group_members gm where gm.group_id = g.id)::text || ' membri'
         from core.groups g where g.tenant_id = $1 and g.name ilike $2 escape '\\'
         order by 1 desc, 3 limit 50",
    )
    .bind(c.tenant.tenant_id)
    .bind(like)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Principal { kind: r.get(0), id: r.get(1), name: r.get(2), detail: r.get(3) })
        .collect())
}
