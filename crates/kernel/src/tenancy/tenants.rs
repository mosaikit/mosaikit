//! Tenants: list, creation with the first Tenant Manager, suspension (Administrator).

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::{require_admin, valid_slug};
use crate::identity::{check_password_len, hash_password, password_min, valid_username};
use crate::{events, Error, Kernel, Result, SessionUser};

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

/// Tenant offered on the sign-in page.
#[derive(Debug, Clone, Serialize)]
pub struct LoginTenant {
    pub slug: String,
    pub name: String,
    /// sign-in method: "local" (username and password)
    pub auth: &'static str,
    /// theme in use: the one the Tenant Manager chose, otherwise the one of the platform (the
    /// sign-in page switches to it as soon as the tenant is known)
    pub theme: String,
    /// logos of the tenant for light and dark backgrounds (`/api/auth/tenants/<slug>/logo/<slot>`)
    pub logo_light: bool,
    pub logo_dark: bool,
    /// texts of the sign-in page
    pub welcome: String,
    pub footer: String,
    pub privacy_url: String,
    pub legal_url: String,
    /// languages of the tenant and the default one ("auto": the one of the browser)
    pub languages: Vec<String>,
    pub language: String,
    /// "remember me" is allowed (days > 0)
    pub remember: bool,
}

/// Active tenants for the sign-in page (public: names, theme, logos and texts of the sign-in). The
/// system tenant has a sign-in of its own.
pub async fn login_tenants(k: &Kernel) -> Result<Vec<LoginTenant>> {
    let rows = mosaikit_db::query(
        "select slug, name, settings from core.tenants where status = 'active' and not is_system order by name",
    )
    .fetch_all(&k.db)
    .await?;
    let platform = super::levels::system_settings(k).await?;
    let defaults = super::levels::Defaults::of(k);
    Ok(rows
        .iter()
        .map(|r| {
            let own: Option<serde_json::Value> = r.get(2);
            let own = own.filter(serde_json::Value::is_object).unwrap_or_else(|| serde_json::json!({}));
            let name: String = r.get(1);
            let v = super::levels::values(&super::levels::tenant_view(&platform, &own, &name, &defaults));
            let text =
                |key: &str| v.get(key).and_then(serde_json::Value::as_str).unwrap_or_default().to_string();
            LoginTenant {
                slug: r.get(0),
                name: text("identity.name"),
                auth: "local",
                theme: text("theme"),
                logo_light: v.get("identity.logo_light").is_some_and(|x| !x.is_null()),
                logo_dark: v.get("identity.logo_dark").is_some_and(|x| !x.is_null()),
                welcome: text("identity.welcome"),
                footer: text("identity.footer"),
                privacy_url: text("identity.privacy_url"),
                legal_url: text("identity.legal_url"),
                languages: v
                    .get("lang.enabled")
                    .and_then(serde_json::Value::as_array)
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
                    .unwrap_or_default(),
                language: text("lang.default"),
                remember: v.get("security.remember_days").and_then(serde_json::Value::as_i64).unwrap_or(0)
                    > 0,
            }
        })
        .collect())
}

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
    let rows = mosaikit_db::query(format!("{TENANT_INFO_SQL} where not t.is_system order by t.name"))
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
        return Err(Error::bad("invalid slug: 2-40 characters, lower case, digits and '-'"));
    }
    if t.name.trim().is_empty() {
        return Err(Error::bad("the name of the tenant is required"));
    }
    let username = t.manager_username.trim().to_lowercase();
    if !valid_username(&username) {
        return Err(Error::bad("invalid username of the manager"));
    }
    // a new tenant has the rules of the platform
    check_password_len(t.manager_password, password_min(k, None).await?)?;
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
                    Error::conflict(format!("a tenant '{slug}' already exists"))
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
        return Err(Error::bad("invalid state"));
    }
    let n = mosaikit_db::query("update core.tenants set status = $2 where id = $1 and not is_system")
        .bind(id)
        .bind(status)
        .execute(&k.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(Error::bad("tenant does not exist or is the system one"));
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
