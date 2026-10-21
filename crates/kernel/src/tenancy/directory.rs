//! Rubrica: utenti e gruppi del tenant a cui condividere una risorsa.

use serde::Serialize;
use uuid::Uuid;

use crate::{Caller, Kernel, Result};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Principal {
    pub kind: String,
    pub id: Uuid,
    pub name: String,
    pub detail: String,
}

/// Utenti e gruppi del tenant (per la finestra di condivisione).
pub async fn directory(k: &Kernel, c: &Caller, q: &str) -> Result<Vec<Principal>> {
    let like = format!("%{}%", crate::util::like_escape(q.trim()));
    let rows = mosaikit_db::query(
        "select 'user', u.id, coalesce(nullif(u.display_name, ''), u.username), u.username || '@' || h.slug
         from core.memberships m join core.users u on u.id = m.user_id join core.tenants h on h.id = u.home_tenant_id
         where m.tenant_id = $1 and u.status = 'active'
           and (u.username ilike $2 escape '\\' or u.display_name ilike $2 escape '\\')
         union all
         select 'group', g.id, g.name, (select count(*) from core.group_members gm where gm.group_id = g.id)::text || ' membri'
         from core.groups g where g.tenant_id = $1 and g.name ilike $2 escape '\\'
         order by 1 desc, 3 limit 50",
    )
    .bind(c.tenant.tenant_id)
    .bind(like)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Principal { kind: r.get(0), id: r.get(1), name: r.get(2), detail: r.get(3) })
        .collect())
}
