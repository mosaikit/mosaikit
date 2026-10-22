//! Invitations: a Tenant Manager invites a user of another tenant, who accepts or declines after
//! signing in to their own home tenant.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::members::member_role;
use crate::{events, Caller, Error, Kernel, Result, Role, SessionUser};

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

/// Invites into the current tenant a user of another tenant (`username` + home tenant).
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
         where t.slug = $1 and u.username = $2 and u.status = 'active' and not t.is_system",
    )
    .bind(home_tenant.trim().to_lowercase())
    .bind(username.trim().to_lowercase())
    .fetch_optional(&k.db)
    .await?;
    let user = user.ok_or_else(|| Error::not_found("user not found in the given tenant"))?;
    if member_role(k, c.tenant.tenant_id, user).await?.is_some() {
        return Err(Error::conflict("the user is already a member of the tenant"));
    }
    let pending: bool = mosaikit_db::query_scalar(
        "select exists (select 1 from core.invitations where tenant_id = $1 and user_id = $2 and status = 'pending' and expires_at > now())",
    )
    .bind(c.tenant.tenant_id)
    .bind(user)
    .fetch_one(&k.db)
    .await?;
    if pending {
        return Err(Error::conflict("a pending invitation for this user already exists"));
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
    crate::notify::invited(k, c, id, user, role.as_str()).await;
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
        return Err(Error::not_found("invitation not found or already closed"));
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
    .ok_or_else(|| Error::not_found("invitation not found or expired"))?;
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
    crate::notify::answered(k, user, id, tenant, invited_by, accept).await;
    Ok(())
}
