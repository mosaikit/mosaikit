//! Tenants: list, creation with the first Tenant Manager, suspension (Administrator).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::{require_admin, valid_slug};
use crate::identity::{check_password_len, hash_password, password_min, valid_username};
use crate::{events, Error, Kernel, Result, SessionUser};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    /// end of the trial period, if any
    pub trial_until: Option<DateTime<Utc>>,
    /// archived (suspended and kept as it is)
    pub archived_at: Option<DateTime<Utc>>,
}

const TENANT_INFO_SQL: &str = "
    select t.id, t.slug, t.name, t.status, t.is_system,
           (select count(*) from core.memberships m join core.users u on u.id = m.user_id
             where m.tenant_id = t.id and u.home_tenant_id = t.id) as members,
           (select count(*) from core.memberships m join core.users u on u.id = m.user_id
             where m.tenant_id = t.id and u.home_tenant_id <> t.id) as guests,
           (select count(*) from core.resources r where r.tenant_id = t.id) as resources,
           (select coalesce(sum(size_bytes), 0)::bigint from core.resources r where r.tenant_id = t.id) as bytes,
           t.created_at, t.trial_until, t.archived_at
    from core.tenants t";

/// Tenant offered on the sign-in page.
#[derive(Debug, Clone, Serialize)]
pub struct LoginTenant {
    pub slug: String,
    pub name: String,
    /// sign-in method: "local" (username and password) or "oidc" (the identity provider of the tenant)
    pub auth: &'static str,
    /// text of the button of the identity provider ("" for the default one)
    pub button: String,
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
        "select slug, name, settings, id from core.tenants where status = 'active' and not is_system order by name",
    )
    .fetch_all(&k.db)
    .await?;
    let oidc = crate::oidc::login_methods(k).await?;
    let platform = super::levels::system_settings(k).await?;
    let defaults = super::levels::Defaults::of(k);
    Ok(rows
        .iter()
        .map(|r| {
            let own: Option<serde_json::Value> = r.get(2);
            let own = own.filter(serde_json::Value::is_object).unwrap_or_else(|| serde_json::json!({}));
            let name: String = r.get(1);
            let button = oidc.get(&r.get::<Uuid, _>(3));
            let v = super::levels::values(&super::levels::tenant_view(&platform, &own, &name, &defaults));
            let text =
                |key: &str| v.get(key).and_then(serde_json::Value::as_str).unwrap_or_default().to_string();
            LoginTenant {
                slug: r.get(0),
                name: text("identity.name"),
                auth: if button.is_some() { "oidc" } else { "local" },
                button: button.cloned().unwrap_or_default(),
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
        trial_until: r.get(10),
        archived_at: r.get(11),
    }
}

/// The tenants of a page (or all) with their figures, counted per tenant of the page through the
/// indexes: with the filters as parameters the planner cannot tell how few tenants a page has, and
/// grouping read every item (0.5 s for 1,000,000 items).
fn tenant_list_sql(cond: &str, limit: &str) -> String {
    format!(
        "with tp as (select t.* from core.tenants t where not t.is_system and {cond}
                     order by lower(t.name), t.id {limit})
         select tp.id, tp.slug, tp.name, tp.status, tp.is_system,
                (select count(*) from core.memberships mm join core.users u on u.id = mm.user_id
                  where mm.tenant_id = tp.id and u.home_tenant_id = tp.id),
                (select count(*) from core.memberships mm join core.users u on u.id = mm.user_id
                  where mm.tenant_id = tp.id and u.home_tenant_id <> tp.id),
                (select count(*) from core.resources r where r.tenant_id = tp.id),
                (select coalesce(sum(r.size_bytes), 0)::bigint from core.resources r where r.tenant_id = tp.id),
                tp.created_at, tp.trial_until, tp.archived_at, lower(tp.name)
         from tp
         order by lower(tp.name), tp.id"
    )
}

pub async fn list_tenants(k: &Kernel, admin: &SessionUser) -> Result<Vec<TenantInfo>> {
    require_admin(admin)?;
    all_tenants(k).await
}

/// Every tenant but the system one, with its figures (no check: for the kernel itself).
pub(crate) async fn all_tenants(k: &Kernel) -> Result<Vec<TenantInfo>> {
    let rows = mosaikit_db::query(tenant_list_sql("true", "")).fetch_all(&k.db).await?;
    Ok(rows.iter().map(tenant_info).collect())
}

/// Filters of the list of the tenants (Administrator).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct TenantFilter {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    #[serde(default)]
    pub q: Option<String>,
    /// active, trial, suspended, archived
    #[serde(default)]
    pub status: Option<String>,
}

impl TenantFilter {
    pub fn page(&self) -> crate::paging::PageQuery {
        crate::paging::PageQuery { limit: self.limit, cursor: self.cursor.clone(), q: self.q.clone() }
    }
}

/// A page of the tenants, filtered by words (name, slug) and state, by name.
pub async fn tenants_page(
    k: &Kernel,
    admin: &SessionUser,
    f: &TenantFilter,
) -> Result<crate::paging::Page<TenantInfo>> {
    require_admin(admin)?;
    let like = f.page().like();
    let status = f.status.as_deref().filter(|s| !s.is_empty() && *s != "all");
    let cond = |after: bool| {
        let mut c = vec![if like.is_some() {
            "(t.name ilike $1 escape '\\' or t.slug ilike $1 escape '\\')"
        } else {
            "$1::text is null"
        }
        .to_string()];
        c.push(
            match status {
                Some("trial") => {
                    "(t.trial_until is not null and t.status = 'active' and $2::text is not null)"
                }
                Some("archived") => "(t.archived_at is not null and $2::text is not null)",
                Some(_) => "(t.status = $2 and t.archived_at is null)",
                None => "$2::text is null",
            }
            .to_string(),
        );
        if after {
            c.push("(lower(t.name), t.id) > ($3, $4::uuid)".to_string());
        }
        c.join(" and ")
    };
    let total: i64 = mosaikit_db::query_scalar(format!(
        "select count(*) from core.tenants t where not t.is_system and {}",
        cond(false)
    ))
    .bind(like.as_deref())
    .bind(status)
    .fetch_one(&k.db)
    .await?;
    let limit = f.page().limit();
    let after = f.page().after()?;
    let sql = tenant_list_sql(&cond(after.is_some()), &format!("limit {}", limit + 1));
    let mut q = mosaikit_db::query(sql).bind(like.as_deref()).bind(status);
    if let Some((text, id)) = &after {
        q = q.bind(text.clone()).bind(*id);
    }
    let rows = q.fetch_all(&k.db).await?;
    // the key of the order as the database computed it (lower() of the database, not of Rust)
    let items: Vec<(TenantInfo, String)> = rows.iter().map(|r| (tenant_info(r), r.get(12))).collect();
    let p = crate::paging::page(items, limit, total, |(t, key)| (key.clone(), t.id));
    Ok(crate::paging::Page {
        items: p.items.into_iter().map(|(t, _)| t).collect(),
        total: p.total,
        next: p.next,
    })
}

pub struct NewTenant<'a> {
    pub slug: &'a str,
    pub name: &'a str,
    pub manager_username: &'a str,
    pub manager_display_name: &'a str,
    /// required: the Tenant Manager recovers the password at this address
    pub manager_email: &'a str,
    pub manager_password: &'a str,
    /// end of the trial period (none: no trial)
    pub trial_until: Option<DateTime<Utc>>,
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
    let email = crate::notify::required_email(t.manager_email)?;
    // a new tenant has the rules of the platform
    check_password_len(t.manager_password, password_min(k, None).await?)?;
    if t.trial_until.is_some_and(|u| u <= chrono::Utc::now()) {
        return Err(Error::bad("the end of the trial must be in the future").with_code("trial_past"));
    }
    let hash = hash_password(k, t.manager_password).await?;
    let mut tx = k.db.begin_app().await?;
    let id: Uuid = mosaikit_db::query_scalar(
        "insert into core.tenants (slug, name, trial_until) values ($1, $2, $3) returning id",
    )
    .bind(&slug)
    .bind(t.name.trim())
    .bind(t.trial_until)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match Error::from(e) {
        err if err.kind == crate::Kind::Conflict => {
            Error::conflict(format!("a tenant '{slug}' already exists"))
        }
        err => err,
    })?;
    let manager: Uuid = mosaikit_db::query_scalar(
        "insert into core.users (home_tenant_id, username, display_name, email, password_hash) values ($1, $2, $3, $4, $5) returning id",
    )
    .bind(id)
    .bind(&username)
    .bind(t.manager_display_name.trim())
    .bind(&email)
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
    crate::access::create_default_profile(&mut tx, id).await?;
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
    // reactivating brings an archived tenant back and forgets a trial already over
    let n = mosaikit_db::query(
        "update core.tenants set status = $2,
                archived_at = case when $2 = 'active' then null else archived_at end,
                trial_until = case when $2 = 'active' and trial_until <= $3 then null else trial_until end
         where id = $1 and not is_system",
    )
    .bind(id)
    .bind(status)
    .bind(chrono::Utc::now())
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
