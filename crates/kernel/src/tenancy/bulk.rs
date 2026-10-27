//! Work on many at once and the details of a tenant, as in the mockup (docs/reports/mockup-vs-product.md):
//! - the Tenant Manager imports people from a CSV file (checked in the shell first) and invites several
//!   people of other tenants at once; every row has its own outcome;
//! - the Tenant Manager asks the Administrators for a plugin;
//! - the Administrator keeps the contact person and the registration data of a tenant.

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::require_admin;
use crate::notify::{self, NoteKind};
use crate::{events, Caller, Error, Kernel, Result, Role, SessionUser};

/// At most this many rows per import or invitation list.
pub const MAX_ROWS: usize = 500;

/// A person to create, from a row of the CSV file.
#[derive(Debug, Clone, Deserialize)]
pub struct ImportRow {
    pub username: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default = "user_role")]
    pub role: Role,
    /// name of a permission profile of the tenant (empty: the default one)
    #[serde(default)]
    pub profile: String,
    /// names of groups of the tenant
    #[serde(default)]
    pub groups: Vec<String>,
}

fn user_role() -> Role {
    Role::User
}

/// The outcome of one row: created (with the link to choose a password) or refused with a code.
#[derive(Debug, Clone, Serialize)]
pub struct RowOutcome {
    pub row: usize,
    pub who: String,
    pub ok: bool,
    pub code: Option<&'static str>,
    pub message: String,
    /// link to choose a password (created people), sent by email when the person has an address
    pub link: Option<String>,
    pub emailed: bool,
}

fn refused(row: usize, who: &str, e: &Error) -> RowOutcome {
    RowOutcome {
        row,
        who: who.into(),
        ok: false,
        code: Some(e.code()),
        message: e.message.clone(),
        link: None,
        emailed: false,
    }
}

/// Creates the people of `rows` in the tenant: each with a link to choose a password, the profile and
/// the groups named in the row. A row that fails does not stop the others.
pub async fn import_people(k: &Kernel, c: &Caller, rows: &[ImportRow]) -> Result<Vec<RowOutcome>> {
    c.require_manager()?;
    if rows.len() > MAX_ROWS {
        return Err(Error::bad(format!("at most {MAX_ROWS} rows at a time")).with_code("too_many_rows"));
    }
    crate::oidc::refuse_local_password(k, c.tenant.tenant_id).await?;
    let profiles = crate::access::profiles(k, c).await?;
    let groups = super::groups(k, c).await?;
    let mut out = Vec::new();
    for (i, r) in rows.iter().enumerate() {
        let who = r.username.trim().to_lowercase();
        let res: Result<RowOutcome> = async {
            let profile = match r.profile.trim() {
                "" => None,
                name => Some(
                    profiles.iter().find(|p| p.name.eq_ignore_ascii_case(name)).map(|p| p.id).ok_or_else(
                        || Error::bad(format!("no permission profile «{name}»")).with_code("profile_unknown"),
                    )?,
                ),
            };
            let mut group_ids = Vec::new();
            for g in r.groups.iter().map(|g| g.trim()).filter(|g| !g.is_empty()) {
                let found = groups.iter().find(|x| x.name.eq_ignore_ascii_case(g) && x.source != "idp");
                group_ids.push(found.map(|x| x.id).ok_or_else(|| {
                    Error::bad(format!("no group «{g}» that can be changed")).with_code("group_unknown")
                })?);
            }
            if let Some(e) = r.email.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
                if !notify::valid_email(e) {
                    return Err(Error::bad("invalid email address").with_code("email_invalid"));
                }
            }
            let password = crate::util::random_token(24);
            let name = if r.display_name.trim().is_empty() {
                who.clone()
            } else {
                r.display_name.trim().to_string()
            };
            let user = super::create_member(k, c, &who, &name, &password, r.role).await?;
            if let Some(e) = r.email.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
                mosaikit_db::query("update core.users set email = $2 where id = $1")
                    .bind(user)
                    .bind(e)
                    .execute(&k.db)
                    .await?;
            }
            if profile.is_some() {
                crate::access::set_member_profile(k, c, user, profile).await?;
            }
            for g in group_ids {
                super::set_group_member(k, c, g, user, true).await?;
            }
            let link = super::reset_link(k, super::By::Manager(c), user).await?;
            Ok(RowOutcome {
                row: i + 1,
                who: who.clone(),
                ok: true,
                code: None,
                message: String::new(),
                link: Some(link.url),
                emailed: link.emailed,
            })
        }
        .await;
        out.push(res.unwrap_or_else(|e| refused(i + 1, &who, &e)));
    }
    let created = out.iter().filter(|o| o.ok).count();
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "people.import",
        json!({ "rows": rows.len(), "created": created }),
    )
    .await;
    Ok(out)
}

/// Invites several people of other tenants at once (`username@tenant`, one per entry).
pub async fn invite_many(
    k: &Kernel,
    c: &Caller,
    people: &[String],
    role: Role,
    profile: Option<Uuid>,
) -> Result<Vec<RowOutcome>> {
    c.require_manager()?;
    if people.len() > MAX_ROWS {
        return Err(Error::bad(format!("at most {MAX_ROWS} people at a time")).with_code("too_many_rows"));
    }
    let mut out = Vec::new();
    for (i, p) in people.iter().map(|p| p.trim()).filter(|p| !p.is_empty()).enumerate() {
        let res = match p.split_once('@') {
            Some((user, tenant)) if !user.is_empty() && !tenant.is_empty() => {
                super::invite_with(k, c, tenant, user, role, profile).await.map(|_| ())
            }
            _ => Err(Error::bad("write username@tenant").with_code("invite_address")),
        };
        out.push(match res {
            Ok(()) => RowOutcome {
                row: i + 1,
                who: p.to_string(),
                ok: true,
                code: None,
                message: String::new(),
                link: None,
                emailed: false,
            },
            Err(e) => refused(i + 1, p, &e),
        });
    }
    Ok(out)
}

/// The Tenant Manager asks the Administrators for a plugin: a notification to each of them.
pub async fn ask_for_plugin(k: &Kernel, c: &Caller, text: &str) -> Result<()> {
    c.require_manager()?;
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 1000 {
        return Err(Error::bad("say which plugin and why (at most 1000 characters)").with_code("ask_text"));
    }
    let admins: Vec<Uuid> =
        mosaikit_db::query_scalar("select id from core.users where is_system_admin and status = 'active'")
            .fetch_all(&k.db)
            .await?;
    for user in admins {
        notify::emit(
            k,
            notify::New {
                user,
                tenant: None,
                kind: NoteKind::System,
                title: format!("{} asks for a plugin", c.tenant.name),
                body: text.to_string(),
                link: "#/admin/plugins/catalog".into(),
                source: "kernel".into(),
                resource: None,
                data: json!({ "code": "plugin.asked", "tenant": c.tenant.name, "text": text }),
            },
        )
        .await;
    }
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "plugin.ask",
        json!({ "text": text }),
    )
    .await;
    Ok(())
}

/// Contact person and registration data of a tenant (Administrator).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct TenantDetails {
    #[serde(default)]
    pub contact_name: String,
    #[serde(default)]
    pub contact_email: String,
    #[serde(default)]
    pub contact_phone: String,
    /// VAT number, tax code or other registration data
    #[serde(default)]
    pub registration: String,
}

pub async fn tenant_details(k: &Kernel, admin: &SessionUser, tenant: Uuid) -> Result<TenantDetails> {
    require_admin(admin)?;
    let r = mosaikit_db::query(
        "select contact_name, contact_email, contact_phone, registration from core.tenants where id = $1 and not is_system",
    )
    .bind(tenant)
    .fetch_optional(&k.db)
    .await?
    .ok_or_else(|| Error::not_found("tenant does not exist"))?;
    Ok(TenantDetails {
        contact_name: r.get(0),
        contact_email: r.get(1),
        contact_phone: r.get(2),
        registration: r.get(3),
    })
}

pub async fn set_tenant_details(
    k: &Kernel,
    admin: &SessionUser,
    tenant: Uuid,
    d: &TenantDetails,
) -> Result<()> {
    require_admin(admin)?;
    let d = TenantDetails {
        contact_name: d.contact_name.trim().to_string(),
        contact_email: d.contact_email.trim().to_string(),
        contact_phone: d.contact_phone.trim().to_string(),
        registration: d.registration.trim().to_string(),
    };
    if [&d.contact_name, &d.contact_email, &d.contact_phone, &d.registration]
        .iter()
        .any(|v| v.chars().count() > 200)
    {
        return Err(Error::bad("at most 200 characters per field").with_code("setting_invalid"));
    }
    if !d.contact_email.is_empty() && !notify::valid_email(&d.contact_email) {
        return Err(Error::bad("invalid email address").with_code("email_invalid"));
    }
    let n = mosaikit_db::query(
        "update core.tenants set contact_name = $2, contact_email = $3, contact_phone = $4, registration = $5
         where id = $1 and not is_system",
    )
    .bind(tenant)
    .bind(&d.contact_name)
    .bind(&d.contact_email)
    .bind(&d.contact_phone)
    .bind(&d.registration)
    .execute(&k.db)
    .await?
    .rows_affected();
    if n == 0 {
        return Err(Error::not_found("tenant does not exist"));
    }
    events::record(k, Some(tenant), Some(admin.user_id), None, None, "tenant.details", json!(d)).await;
    Ok(())
}

/// Renames a tenant and changes its identifier (the slug of the sign-in and of the addresses).
pub async fn rename_tenant(
    k: &Kernel,
    admin: &SessionUser,
    tenant: Uuid,
    name: &str,
    slug: &str,
) -> Result<()> {
    require_admin(admin)?;
    let name = name.trim();
    let slug = slug.trim().to_lowercase();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(Error::bad("the name of the tenant is required (at most 200 characters)"));
    }
    if !super::valid_slug(&slug) {
        return Err(Error::bad("invalid slug: 2-40 characters, lower case, digits and '-'"));
    }
    let n =
        mosaikit_db::query("update core.tenants set name = $2, slug = $3 where id = $1 and not is_system")
            .bind(tenant)
            .bind(name)
            .bind(&slug)
            .execute(&k.db)
            .await
            .map_err(|e| match Error::from(e) {
                err if err.kind == crate::Kind::Conflict => {
                    Error::conflict(format!("a tenant '{slug}' already exists"))
                }
                err => err,
            })?
            .rows_affected();
    if n == 0 {
        return Err(Error::not_found("tenant does not exist"));
    }
    events::record(
        k,
        Some(tenant),
        Some(admin.user_id),
        None,
        None,
        "tenant.rename",
        json!({ "name": name, "slug": slug }),
    )
    .await;
    Ok(())
}
