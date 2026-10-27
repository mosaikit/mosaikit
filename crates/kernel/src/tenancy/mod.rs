//! Tenants, Administrators, members, invitations, groups, policies, directory for sharing.
//!
//! One sub-module per area; here the common functions (check of the Administrator,
//! resolution of the active tenant) and the re-exports: from outside one uses
//! `tenancy::<function>` without knowing the sub-modules.

mod administrators;
pub mod bulk;
mod directory;
mod groups;
mod invitations;
pub mod keys;
pub mod layouts;
pub mod levels;
pub mod lifecycle;
mod members;
mod people;
pub mod profile;
mod requests;
mod settings;
mod support;
mod tenants;
pub mod themes;

pub use administrators::{
    administrators, create_administrator, reset_administrator_password, reset_administrator_totp,
    set_administrator_active, AdminInfo,
};
pub use directory::{directory, Principal};
pub use groups::{create_group, delete_group, groups, groups_page, set_group_member, GroupInfo, GroupMember};
pub use invitations::{
    invite, invite_with, my_invitations, respond_invitation, revoke_invitation, tenant_invitations,
    InvitationInfo,
};
pub use members::{
    create_member, members, members_page, remove_member, reset_member_password, set_member_suspended,
    set_role, MemberFilter, MemberInfo, MemberPage, RemoveReport,
};
pub use people::{
    add_to_tenant, close_session, close_sessions, create_person, directory_of_people, group_detail,
    member_detail, move_home, person, person_activity, person_sessions, remove_from_tenant, reset_info,
    reset_link, reset_with_link, set_person_status, update_membership, update_person, why_not, By, EventInfo,
    GroupDetail, MemberDetail, MembershipChange, NewMembership, NewPerson, PersonRow, PersonTenant,
    ResetInfo, ResetLink, SessionInfo, SharedItem, Step, WhyNot,
};
pub use people::{people_page, PeopleCounts, PeopleFilter, PeoplePage};
pub use requests::{decide_request, request_access, requests, AccessRequest};
pub use settings::{
    platform_theme, prefs, set_platform_theme, set_prefs, set_settings, set_shell_band, set_tenant_theme,
    shell_band, tenant_theme, ShellBand, ThemeChoice, DEFAULT_THEME,
};
pub use support::{create_tenant_manager, reset_tenant_password, set_tenant_role, tenant_members};
pub(crate) use tenants::all_tenants;
pub use tenants::{
    create_tenant, list_tenants, login_tenants, set_tenant_status, tenants_page, LoginTenant, NewTenant,
    TenantFilter, TenantInfo,
};

use serde_json::Value;

use crate::{Caller, Error, Kernel, Result, Role, SessionUser, TenantCtx};

pub fn require_admin(user: &SessionUser) -> Result<()> {
    if user.is_system_admin {
        Ok(())
    } else {
        Err(Error::forbidden("operation reserved to the Administrator"))
    }
}

/// Resolves the active tenant of a request and checks the membership. The system
/// tenant is not a workspace: it never resolves.
pub async fn caller(k: &Kernel, user: &SessionUser, slug: &str) -> Result<Caller> {
    let row = mosaikit_db::query(
        "select t.id, t.slug, t.name, t.settings, m.role from core.tenants t
         join core.memberships m on m.tenant_id = t.id
         where t.slug = $1 and m.user_id = $2 and t.status = 'active' and not t.is_system
           and m.status = 'active'",
    )
    .bind(slug)
    .bind(user.user_id)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::forbidden(format!("you are not a member of the tenant '{slug}'")))?;
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

pub(crate) fn valid_slug(s: &str) -> bool {
    let mut c = s.chars();
    matches!(c.next(), Some('a'..='z' | '0'..='9'))
        && (2..=40).contains(&s.len())
        && c.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}
