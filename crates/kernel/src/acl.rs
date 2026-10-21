//! Permessi sulle risorse: metadati, grant, proprieta'. Elenco metadati per i gestori.

use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{events, Caller, Error, Kernel, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum Level {
    None = 0,
    Read = 1,
    Write = 2,
    Manage = 3,
}

impl Level {
    pub fn from_i32(n: i32) -> Level {
        match n {
            3 => Level::Manage,
            2 => Level::Write,
            1 => Level::Read,
            _ => Level::None,
        }
    }
    pub fn parse(s: &str) -> Result<Level> {
        match s {
            "read" => Ok(Level::Read),
            "write" => Ok(Level::Write),
            "manage" => Ok(Level::Manage),
            _ => Err(Error::bad(format!("livello non valido: {s} (read, write, manage)"))),
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Level::Manage => "manage",
            Level::Write => "write",
            Level::Read => "read",
            Level::None => "none",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ResourceMeta {
    pub id: Uuid,
    pub plugin_id: String,
    pub kind: String,
    pub title: String,
    pub parent_id: Option<Uuid>,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub size_bytes: i64,
    pub meta: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub my_level: &'static str,
    #[serde(skip)]
    pub level: Level,
    pub is_owner: bool,
}

/// Metadati di una risorsa visibile al chiamante (altrimenti NotFound).
pub async fn meta(k: &Kernel, c: &Caller, rid: Uuid) -> Result<ResourceMeta> {
    let mut tx = k.db.begin(&c.ctx()).await?;
    let row = mosaikit_db::query(
        "select r.id, r.plugin_id, r.kind, r.title, r.parent_id, r.owner_id,
                coalesce(nullif(u.display_name, ''), u.username), r.size_bytes, r.meta, r.created_at, r.updated_at,
                core.level_of(r.id)
         from core.resources r join core.users u on u.id = r.owner_id where r.id = $1",
    )
    .bind(rid)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    let r = row.ok_or_else(|| Error::not_found("risorsa non trovata"))?;
    let level = Level::from_i32(r.get(11));
    if level == Level::None {
        return Err(Error::not_found("risorsa non trovata"));
    }
    let owner_id: Uuid = r.get(5);
    Ok(ResourceMeta {
        id: r.get(0),
        plugin_id: r.get(1),
        kind: r.get(2),
        title: r.get(3),
        parent_id: r.get(4),
        owner_id,
        owner_name: r.get(6),
        size_bytes: r.get(7),
        meta: r.get(8),
        created_at: r.get(9),
        updated_at: r.get(10),
        my_level: level.name(),
        level,
        is_owner: owner_id == c.user.user_id,
    })
}

pub async fn require_level(k: &Kernel, c: &Caller, rid: Uuid, need: Level) -> Result<ResourceMeta> {
    let m = meta(k, c, rid).await?;
    if m.level < need {
        return Err(Error::forbidden(match need {
            Level::Manage => "serve il permesso di gestione sulla risorsa",
            Level::Write => "serve il permesso di scrittura sulla risorsa",
            _ => "accesso negato",
        }));
    }
    Ok(m)
}

#[derive(Debug, Clone, Serialize)]
pub struct GrantInfo {
    pub principal_type: String,
    pub principal_id: Uuid,
    pub name: String,
    pub detail: String,
    pub level: &'static str,
    pub granted_at: DateTime<Utc>,
}

pub async fn grants(k: &Kernel, c: &Caller, rid: Uuid) -> Result<Vec<GrantInfo>> {
    require_level(k, c, rid, Level::Manage).await?;
    let rows = mosaikit_db::query(
        "select g.principal_type, g.principal_id,
                case when g.principal_type = 'user' then coalesce(nullif(u.display_name, ''), u.username) else gr.name end,
                case when g.principal_type = 'user' then u.username || '@' || h.slug else 'gruppo' end,
                g.level, g.granted_at
         from core.grants g
         left join core.users u on g.principal_type = 'user' and u.id = g.principal_id
         left join core.tenants h on h.id = u.home_tenant_id
         left join core.groups gr on g.principal_type = 'group' and gr.id = g.principal_id
         where g.resource_id = $1 order by g.principal_type desc, 3",
    )
    .bind(rid)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| GrantInfo {
            principal_type: r.get(0),
            principal_id: r.get(1),
            name: r.get::<Option<String>, _>(2).unwrap_or_default(),
            detail: r.get::<Option<String>, _>(3).unwrap_or_default(),
            level: Level::from_i32(r.get::<i16, _>(4) as i32).name(),
            granted_at: r.get(5),
        })
        .collect())
}

/// Concede, modifica (`Some`) o revoca (`None`) un grant. Serve il livello gestione.
pub async fn set_grant(
    k: &Kernel,
    c: &Caller,
    rid: Uuid,
    principal_type: &str,
    principal_id: Uuid,
    level: Option<Level>,
) -> Result<()> {
    let m = require_level(k, c, rid, Level::Manage).await?;
    let tenant = c.tenant.tenant_id;
    match principal_type {
        "user" => {
            if principal_id == m.owner_id {
                return Err(Error::bad("il proprietario ha gia' tutti i permessi"));
            }
            let member: bool = mosaikit_db::query_scalar("select core.is_member($1, $2)")
                .bind(principal_id)
                .bind(tenant)
                .fetch_one(&k.db)
                .await?;
            if !member && level.is_some() {
                return Err(Error::bad(
                    "si condivide solo con membri del tenant (gli esterni vanno invitati)",
                ));
            }
        }
        "group" => {
            let ok: bool = mosaikit_db::query_scalar(
                "select exists (select 1 from core.groups where id = $1 and tenant_id = $2)",
            )
            .bind(principal_id)
            .bind(tenant)
            .fetch_one(&k.db)
            .await?;
            if !ok {
                return Err(Error::bad("gruppo non trovato nel tenant"));
            }
        }
        _ => return Err(Error::bad("principal_type: user o group")),
    }
    match level {
        Some(l) if l > Level::None => {
            mosaikit_db::query(
                "insert into core.grants (resource_id, principal_type, principal_id, level, granted_by)
                 values ($1, $2, $3, $4, $5)
                 on conflict (resource_id, principal_type, principal_id)
                 do update set level = excluded.level, granted_by = excluded.granted_by, granted_at = now()",
            )
            .bind(rid)
            .bind(principal_type)
            .bind(principal_id)
            .bind(l as i16)
            .bind(c.user.user_id)
            .execute(&k.db)
            .await?;
        }
        _ => {
            mosaikit_db::query("delete from core.grants where resource_id = $1 and principal_type = $2 and principal_id = $3")
                .bind(rid)
                .bind(principal_type)
                .bind(principal_id)
                .execute(&k.db)
                .await?;
        }
    }
    events::record(
        k,
        Some(tenant),
        Some(c.user.user_id),
        Some(&m.plugin_id),
        Some(rid),
        if level.is_some() { "share" } else { "unshare" },
        json!({ "principal_type": principal_type, "principal_id": principal_id, "level": level.map(Level::name) }),
    )
    .await;
    Ok(())
}

/// Trasferisce la proprieta' di una risorsa: lo puo' fare il proprietario o il gestore del tenant.
pub async fn transfer_owner(k: &Kernel, c: &Caller, rid: Uuid, new_owner: Uuid) -> Result<()> {
    let row =
        mosaikit_db::query("select owner_id, plugin_id from core.resources where id = $1 and tenant_id = $2")
            .bind(rid)
            .bind(c.tenant.tenant_id)
            .fetch_optional(&k.db)
            .await?
            .ok_or_else(|| Error::not_found("risorsa non trovata"))?;
    let owner: Uuid = row.get(0);
    let plugin: String = row.get(1);
    if owner != c.user.user_id && !c.is_manager() {
        return Err(Error::forbidden("solo il proprietario o il gestore possono trasferire la proprieta'"));
    }
    let member: bool = mosaikit_db::query_scalar("select core.is_member($1, $2)")
        .bind(new_owner)
        .bind(c.tenant.tenant_id)
        .fetch_one(&k.db)
        .await?;
    if !member {
        return Err(Error::bad("il nuovo proprietario non e' un membro attivo del tenant"));
    }
    let mut tx = k.db.begin_app().await?;
    mosaikit_db::query("update core.resources set owner_id = $2, updated_at = now() where id = $1")
        .bind(rid)
        .bind(new_owner)
        .execute(&mut *tx)
        .await?;
    mosaikit_db::query(
        "delete from core.grants where resource_id = $1 and principal_type = 'user' and principal_id = $2",
    )
    .bind(rid)
    .bind(new_owner)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(&plugin),
        Some(rid),
        "owner.transfer",
        json!({ "from": owner, "to": new_owner }),
    )
    .await;
    Ok(())
}

/// Metadati (mai il contenuto) delle risorse di un tenant, per gestore e amministratore.
#[derive(Debug, Clone, Serialize)]
pub struct ResourceRow {
    pub id: Uuid,
    pub plugin_id: String,
    pub kind: String,
    /// vuoto se la policy `managers_see_titles` e' disattivata
    pub title: String,
    pub owner_id: Uuid,
    pub owner_name: String,
    pub owner_active: bool,
    pub size_bytes: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub shares: i64,
    pub public_links: i64,
}

#[derive(Debug, Default, Clone, serde::Deserialize)]
pub struct ResourceFilter {
    pub owner: Option<Uuid>,
    pub plugin: Option<String>,
    pub q: Option<String>,
}

pub async fn tenant_resources(
    k: &Kernel,
    tenant: Uuid,
    see_titles: bool,
    f: &ResourceFilter,
) -> Result<Vec<ResourceRow>> {
    let like =
        f.q.as_deref()
            .filter(|q| !q.trim().is_empty() && see_titles)
            .map(|q| format!("%{}%", crate::util::like_escape(q.trim())));
    let rows = mosaikit_db::query(
        "select r.id, r.plugin_id, r.kind, case when $2 then r.title else '' end, r.owner_id,
                coalesce(nullif(u.display_name, ''), u.username), u.status = 'active'
                    and exists (select 1 from core.memberships m where m.tenant_id = r.tenant_id and m.user_id = u.id),
                r.size_bytes, r.created_at, r.updated_at,
                (select count(*) from core.grants g where g.resource_id = r.id),
                (select count(*) from core.public_links l where l.resource_id = r.id and l.revoked_at is null
                    and (l.expires_at is null or l.expires_at > now()))
         from core.resources r join core.users u on u.id = r.owner_id
         where r.tenant_id = $1 and ($3::uuid is null or r.owner_id = $3) and ($4::text is null or r.plugin_id = $4)
           and ($5::text is null or r.title ilike $5 escape '\\')
         order by r.updated_at desc limit 1000",
    )
    .bind(tenant)
    .bind(see_titles)
    .bind(f.owner)
    .bind(f.plugin.as_deref())
    .bind(like)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| ResourceRow {
            id: r.get(0),
            plugin_id: r.get(1),
            kind: r.get(2),
            title: r.get(3),
            owner_id: r.get(4),
            owner_name: r.get(5),
            owner_active: r.get(6),
            size_bytes: r.get(7),
            created_at: r.get(8),
            updated_at: r.get(9),
            shares: r.get(10),
            public_links: r.get(11),
        })
        .collect())
}

pub async fn manager_resources(k: &Kernel, c: &Caller, f: &ResourceFilter) -> Result<Vec<ResourceRow>> {
    c.require_manager()?;
    tenant_resources(k, c.tenant.tenant_id, c.tenant.settings.managers_see_titles, f).await
}

/// Riassegna tutte le risorse di un utente nel tenant (es. utente uscito senza riassegnazione).
pub async fn reassign_all(k: &Kernel, c: &Caller, from: Uuid, to: Uuid) -> Result<i64> {
    c.require_manager()?;
    let member: bool = mosaikit_db::query_scalar("select core.is_member($1, $2)")
        .bind(to)
        .bind(c.tenant.tenant_id)
        .fetch_one(&k.db)
        .await?;
    if !member || from == to {
        return Err(Error::bad("il nuovo proprietario deve essere un altro membro attivo del tenant"));
    }
    let n = mosaikit_db::query(
        "update core.resources set owner_id = $3, updated_at = now() where tenant_id = $1 and owner_id = $2",
    )
    .bind(c.tenant.tenant_id)
    .bind(from)
    .bind(to)
    .execute(&k.db)
    .await?
    .rows_affected() as i64;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        None,
        None,
        "owner.reassign",
        json!({ "from": from, "to": to, "count": n }),
    )
    .await;
    Ok(n)
}
