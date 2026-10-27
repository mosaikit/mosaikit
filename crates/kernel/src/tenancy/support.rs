//! Interventions of the Administrator on a tenant: users and roles (never the contents), to
//! appoint or replace a Tenant Manager and unlock a sign-in. Everything is recorded
//! in the events of the tenant.

use serde_json::json;
use uuid::Uuid;

use super::members::{create_member_in, members_of, reset_password_in, set_role_in};
use super::{require_admin, MemberInfo};
use crate::{events, Error, Kernel, Result, Role, SessionUser};

/// The tenant exists and is not the system one.
pub(super) async fn client_tenant(k: &Kernel, tenant: Uuid) -> Result<()> {
    let ok: Option<bool> = mosaikit_db::query_scalar("select not is_system from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?;
    match ok {
        Some(true) => Ok(()),
        Some(false) => Err(Error::bad("the system tenant holds only Administrators")),
        None => Err(Error::not_found("tenant not found")),
    }
}

pub async fn tenant_members(k: &Kernel, admin: &SessionUser, tenant: Uuid) -> Result<Vec<MemberInfo>> {
    require_admin(admin)?;
    client_tenant(k, tenant).await?;
    members_of(k, tenant).await
}

/// New local Tenant Manager of the tenant.
pub async fn create_tenant_manager(
    k: &Kernel,
    admin: &SessionUser,
    tenant: Uuid,
    username: &str,
    display_name: &str,
    email: &str,
    password: &str,
) -> Result<Uuid> {
    require_admin(admin)?;
    client_tenant(k, tenant).await?;
    create_member_in(k, tenant, admin.user_id, username, display_name, email, password, Role::TenantManager)
        .await
}

/// Role of a member of the tenant (at least one Tenant Manager always stays).
pub async fn set_tenant_role(
    k: &Kernel,
    admin: &SessionUser,
    tenant: Uuid,
    user: Uuid,
    role: Role,
) -> Result<()> {
    require_admin(admin)?;
    client_tenant(k, tenant).await?;
    set_role_in(k, tenant, admin.user_id, user, role).await
}

/// New password for a user who belongs to the tenant (not for guests).
pub async fn reset_tenant_password(
    k: &Kernel,
    admin: &SessionUser,
    tenant: Uuid,
    user: Uuid,
    password: &str,
) -> Result<()> {
    require_admin(admin)?;
    client_tenant(k, tenant).await?;
    reset_password_in(k, tenant, user, password).await?;
    events::record(
        k,
        Some(tenant),
        Some(admin.user_id),
        None,
        None,
        "member.password_reset",
        json!({ "user": user, "by": "administrator" }),
    )
    .await;
    Ok(())
}
