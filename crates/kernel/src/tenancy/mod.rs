//! Tenant, Administrator, membri, inviti, gruppi, policy, rubrica per la condivisione.
//!
//! Un sotto-modulo per area; qui le funzioni comuni (verifica dell'Administrator,
//! risoluzione del tenant attivo) e le riesportazioni: dall'esterno si usa
//! `tenancy::<funzione>` senza conoscere i sotto-moduli.

mod administrators;
mod directory;
mod groups;
mod invitations;
mod members;
mod settings;
mod tenants;

pub use administrators::{administrators, set_administrator, AdminInfo};
pub use directory::{directory, Principal};
pub use groups::{create_group, delete_group, groups, set_group_member, GroupInfo, GroupMember};
pub use invitations::{
    invite, my_invitations, respond_invitation, revoke_invitation, tenant_invitations, InvitationInfo,
};
pub use members::{
    create_member, members, remove_member, reset_member_password, set_role, MemberInfo, RemoveReport,
};
pub use settings::{prefs, set_prefs, set_settings};
pub use tenants::{create_tenant, list_tenants, set_tenant_status, NewTenant, TenantInfo};

use serde_json::Value;

use crate::{Caller, Error, Kernel, Result, Role, SessionUser, TenantCtx};

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
