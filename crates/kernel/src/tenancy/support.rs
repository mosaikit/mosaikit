//! Interventi dell'Administrator su un tenant: utenti e ruoli (mai i contenuti), per
//! nominare o sostituire un Tenant Manager e sbloccare un accesso. Tutto registrato
//! negli eventi del tenant.

use serde_json::json;
use uuid::Uuid;

use super::members::{create_member_in, members_of, reset_password_in, set_role_in};
use super::{require_admin, MemberInfo};
use crate::{events, Error, Kernel, Result, Role, SessionUser};

/// Il tenant esiste e non e' quello di sistema.
async fn client_tenant(k: &Kernel, tenant: Uuid) -> Result<()> {
    let ok: Option<bool> = mosaikit_db::query_scalar("select not is_system from core.tenants where id = $1")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?;
    match ok {
        Some(true) => Ok(()),
        Some(false) => Err(Error::bad("il tenant di sistema contiene solo Administrator")),
        None => Err(Error::not_found("tenant inesistente")),
    }
}

pub async fn tenant_members(k: &Kernel, admin: &SessionUser, tenant: Uuid) -> Result<Vec<MemberInfo>> {
    require_admin(admin)?;
    client_tenant(k, tenant).await?;
    members_of(k, tenant).await
}

/// Nuovo Tenant Manager locale del tenant.
pub async fn create_tenant_manager(
    k: &Kernel,
    admin: &SessionUser,
    tenant: Uuid,
    username: &str,
    display_name: &str,
    password: &str,
) -> Result<Uuid> {
    require_admin(admin)?;
    client_tenant(k, tenant).await?;
    create_member_in(k, tenant, admin.user_id, username, display_name, password, Role::TenantManager).await
}

/// Ruolo di un membro del tenant (resta sempre almeno un Tenant Manager).
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

/// Nuova password per un utente che appartiene al tenant (non per gli ospiti).
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
