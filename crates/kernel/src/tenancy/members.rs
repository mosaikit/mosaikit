//! Membri del tenant: creazione, ruolo (Tenant Manager o User), reset della password, uscita con
//! riassegnazione delle risorse.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use crate::identity::{check_password_policy, hash_password, valid_username};
use crate::{events, Caller, Error, Kernel, Result, Role};

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
