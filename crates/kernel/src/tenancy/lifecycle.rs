//! Lifecycle of a tenant (Administrator): trial period, archive, deletion (docs/architecture.md,
//! "Lifecycle of the tenants").
//!
//! - **Trial**: an end date. A week and a day before, its Tenant Managers and the Administrators get a
//!   notification; at the end the tenant is suspended (the data stay, the Administrator reactivates it or
//!   extends the trial).
//! - **Archive**: the tenant is suspended and marked as archived: nobody signs in, nothing is deleted, the
//!   Administrator can still export it and bring it back (reactivate).
//! - **Delete**: irreversible, with the address of the tenant typed as confirmation. Everything goes:
//!   items and the rows of the plugins (through their foreign keys), contents, people whose home is the
//!   tenant, groups, settings, log. Items that its people own as guests in other tenants pass to the first
//!   Tenant Manager of those tenants. The system tenant is never deleted.

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::json;
use uuid::Uuid;

use super::require_admin;
use crate::notify::{self, NoteKind};
use crate::{events, Error, Kernel, Result, SessionUser};

/// What a tenant holds: for the confirmations of archive and deletion.
#[derive(Debug, Clone, Serialize)]
pub struct Impact {
    pub slug: String,
    pub name: String,
    pub people: i64,
    pub guests: i64,
    pub groups: i64,
    pub items: i64,
    pub bytes: i64,
    pub public_links: i64,
    /// items its people own as guests in other tenants (they pass to those Tenant Managers)
    pub items_elsewhere: i64,
}

async fn tenant_row(k: &Kernel, id: Uuid) -> Result<(String, String, bool)> {
    let r = mosaikit_db::query("select slug, name, is_system from core.tenants where id = $1")
        .bind(id)
        .fetch_optional(&k.db)
        .await?
        .ok_or_else(|| Error::not_found("tenant does not exist"))?;
    Ok((r.get(0), r.get(1), r.get(2)))
}

pub async fn impact(k: &Kernel, admin: &SessionUser, id: Uuid) -> Result<Impact> {
    require_admin(admin)?;
    let (slug, name, _) = tenant_row(k, id).await?;
    let r = mosaikit_db::query(
        "select
           (select count(*) from core.users where home_tenant_id = $1),
           (select count(*) from core.memberships m join core.users u on u.id = m.user_id
             where m.tenant_id = $1 and u.home_tenant_id <> $1),
           (select count(*) from core.groups where tenant_id = $1),
           (select count(*) from core.resources where tenant_id = $1),
           (select coalesce(sum(size_bytes), 0)::bigint from core.resources where tenant_id = $1),
           (select count(*) from core.public_links l join core.resources r on r.id = l.resource_id
             where r.tenant_id = $1 and l.revoked_at is null),
           (select count(*) from core.resources r join core.users u on u.id = r.owner_id
             where u.home_tenant_id = $1 and r.tenant_id <> $1)",
    )
    .bind(id)
    .fetch_one(&k.db)
    .await?;
    Ok(Impact {
        slug,
        name,
        people: r.get(0),
        guests: r.get(1),
        groups: r.get(2),
        items: r.get(3),
        bytes: r.get(4),
        public_links: r.get(5),
        items_elsewhere: r.get(6),
    })
}

/// Sets (or removes, `None`) the end of the trial period. A date in the past is refused.
pub async fn set_trial(
    k: &Kernel,
    admin: &SessionUser,
    id: Uuid,
    until: Option<DateTime<Utc>>,
) -> Result<()> {
    require_admin(admin)?;
    let (slug, _, system) = tenant_row(k, id).await?;
    if system {
        return Err(Error::bad("the system tenant has no trial period"));
    }
    if until.is_some_and(|u| u <= Utc::now()) {
        return Err(Error::bad("the end of the trial must be in the future").with_code("trial_past"));
    }
    mosaikit_db::query("update core.tenants set trial_until = $2, trial_notice = 0 where id = $1")
        .bind(id)
        .bind(until)
        .execute(&k.db)
        .await?;
    events::record(
        k,
        Some(id),
        Some(admin.user_id),
        None,
        None,
        "tenant.trial",
        json!({ "slug": slug, "until": until }),
    )
    .await;
    Ok(())
}

/// Archives a tenant: suspended and marked as archived; it comes back with a reactivation.
pub async fn archive(k: &Kernel, admin: &SessionUser, id: Uuid) -> Result<()> {
    require_admin(admin)?;
    let (slug, _, system) = tenant_row(k, id).await?;
    if system {
        return Err(Error::bad("the system tenant is not archived"));
    }
    mosaikit_db::query("update core.tenants set status = 'suspended', archived_at = $2 where id = $1")
        .bind(id)
        .bind(Utc::now())
        .execute(&k.db)
        .await?;
    events::record(k, Some(id), Some(admin.user_id), None, None, "tenant.archive", json!({ "slug": slug }))
        .await;
    Ok(())
}

/// Deletes a tenant for good; `confirm` must be its address.
pub async fn delete(k: &Kernel, admin: &SessionUser, id: Uuid, confirm: &str) -> Result<()> {
    require_admin(admin)?;
    let (slug, name, system) = tenant_row(k, id).await?;
    if system {
        return Err(Error::bad("the system tenant is never deleted"));
    }
    if confirm.trim() != slug {
        return Err(Error::bad("type the address of the tenant to confirm").with_code("confirm_mismatch"));
    }
    purge_tenant(k, id).await?;
    // the record stays in the log of the platform
    events::record(
        k,
        None,
        Some(admin.user_id),
        None,
        None,
        "tenant.delete",
        json!({ "slug": slug, "name": name }),
    )
    .await;
    Ok(())
}

/// Removes a tenant and everything it holds (deletion, or an import that replaces it).
pub(crate) async fn purge_tenant(k: &Kernel, id: Uuid) -> Result<()> {
    // items that people of the tenant own as guests elsewhere go to the first Tenant Manager there
    let blocked: Vec<String> = mosaikit_db::query_scalar(
        "select distinct t.name from core.resources r
         join core.users u on u.id = r.owner_id join core.tenants t on t.id = r.tenant_id
         where u.home_tenant_id = $1 and r.tenant_id <> $1
           and not exists (select 1 from core.memberships m join core.users mu on mu.id = m.user_id
                           where m.tenant_id = r.tenant_id and m.role = 'tenant_manager' and m.status = 'active'
                             and mu.home_tenant_id <> $1)",
    )
    .bind(id)
    .fetch_all(&k.db)
    .await?;
    if !blocked.is_empty() {
        return Err(Error::conflict(format!(
            "people of this tenant own items in {} and there is no Tenant Manager there to receive them",
            blocked.join(", ")
        ))
        .with_code("tenant_delete_blocked"));
    }
    let mut tx = k.db.begin_app().await?;
    mosaikit_db::query(
        "update core.resources set owner_id = (
             select m.user_id from core.memberships m join core.users mu on mu.id = m.user_id
             where m.tenant_id = resources.tenant_id and m.role = 'tenant_manager' and m.status = 'active'
               and mu.home_tenant_id <> $1
             order by m.joined_at, m.user_id limit 1)
         where tenant_id <> $1 and owner_id in (select id from core.users where home_tenant_id = $1)",
    )
    .bind(id)
    .execute(&mut tx)
    .await?;
    // the rows of the plugins go with the items (foreign keys), the rest with the tenant
    mosaikit_db::query("delete from core.resources where tenant_id = $1").bind(id).execute(&mut tx).await?;
    mosaikit_db::query("delete from core.users where home_tenant_id = $1").bind(id).execute(&mut tx).await?;
    mosaikit_db::query("delete from core.tenants where id = $1 and not is_system")
        .bind(id)
        .execute(&mut tx)
        .await?;
    tx.commit().await?;
    for dir in [k.blobs.root().join(id.to_string()), k.blobs.root().join("identity").join(id.to_string())] {
        if dir.is_dir() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    Ok(())
}

/// Tenant Managers of a tenant (active).
async fn managers(k: &Kernel, tenant: Uuid) -> Result<Vec<Uuid>> {
    Ok(mosaikit_db::query_scalar(
        "select m.user_id from core.memberships m join core.users u on u.id = m.user_id
         where m.tenant_id = $1 and m.role = 'tenant_manager' and m.status = 'active' and u.status = 'active'",
    )
    .bind(tenant)
    .fetch_all(&k.db)
    .await?)
}

/// Active Administrators.
pub(crate) async fn administrators(k: &Kernel) -> Result<Vec<Uuid>> {
    Ok(mosaikit_db::query_scalar("select id from core.users where is_system_admin and status = 'active'")
        .fetch_all(&k.db)
        .await?)
}

/// Notices of the end of the trial and suspension at the end (background work, every few minutes).
pub async fn check_trials(k: &Kernel) -> Result<()> {
    let now = Utc::now();
    let rows = mosaikit_db::query(
        "select id, slug, name, trial_until, trial_notice from core.tenants
         where trial_until is not null and status = 'active' and not is_system",
    )
    .fetch_all(&k.db)
    .await?;
    let admins = administrators(k).await?;
    for r in rows {
        let (id, slug, name): (Uuid, String, String) = (r.get(0), r.get(1), r.get(2));
        let until: DateTime<Utc> = r.get(3);
        let sent: i16 = r.get(4);
        let day = until.format("%Y-%m-%d").to_string();
        if until <= now {
            mosaikit_db::query("update core.tenants set status = 'suspended' where id = $1")
                .bind(id)
                .execute(&k.db)
                .await?;
            events::record(k, Some(id), None, None, None, "tenant.trial_end", json!({ "slug": slug })).await;
            for a in &admins {
                notify::emit(
                    k,
                    notify::New {
                        user: *a,
                        tenant: None,
                        kind: NoteKind::System,
                        title: format!("The trial of {name} ended: the tenant is suspended"),
                        body: "Reactivate it or extend the trial from its page.".into(),
                        link: format!("#/admin/tenants/{id}"),
                        source: "kernel".into(),
                        resource: None,
                        data: json!({ "code": "tenant.trial_ended", "tenant": name, "until": day }),
                    },
                )
                .await;
            }
            continue;
        }
        let step = if until - now <= Duration::days(1) {
            2
        } else if until - now <= Duration::days(7) {
            1
        } else {
            0
        };
        if step <= sent {
            continue;
        }
        mosaikit_db::query("update core.tenants set trial_notice = $2 where id = $1")
            .bind(id)
            .bind(step)
            .execute(&k.db)
            .await?;
        let mut to: Vec<(Uuid, bool)> = managers(k, id).await?.into_iter().map(|u| (u, false)).collect();
        to.extend(admins.iter().map(|a| (*a, true)));
        for (user, admin) in to {
            notify::emit(
                k,
                notify::New {
                    user,
                    tenant: if admin { None } else { Some(id) },
                    kind: NoteKind::System,
                    title: format!("The trial of {name} ends on {day}"),
                    body: "At the end the tenant is suspended; the data stay.".into(),
                    link: if admin { format!("#/admin/tenants/{id}") } else { String::new() },
                    source: "kernel".into(),
                    resource: None,
                    data: json!({ "code": "tenant.trial_ending", "tenant": name, "until": day }),
                },
            )
            .await;
        }
    }
    Ok(())
}
