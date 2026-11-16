//! Directory: users and groups of the tenant to share a resource with.

use serde::Serialize;
use uuid::Uuid;

use crate::{Caller, Kernel, Result};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Principal {
    pub kind: String,
    pub id: Uuid,
    pub name: String,
    pub detail: String,
    /// `Some("all")`: the built-in group of every member (the shell shows it with its own name)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub builtin: Option<String>,
}

/// Users and groups of the tenant (for the share dialog).
pub async fn directory(k: &Kernel, c: &Caller, q: &str) -> Result<Vec<Principal>> {
    let like = format!("%{}%", crate::util::like_escape(q.trim()));
    let rows = mosaikit_db::query(
        "select 'user', u.id, coalesce(nullif(u.display_name, ''), u.username), u.username || '@' || h.slug, cast(null as text)
         from core.memberships m join core.users u on u.id = m.user_id join core.tenants h on h.id = u.home_tenant_id
         where m.tenant_id = $1 and u.status = 'active'
           and (u.username ilike $2 escape '\\' or u.display_name ilike $2 escape '\\')
         union all
         select 'group', g.id, g.name, (select count(*) from core.group_members gm where gm.group_id = g.id)::text || ' members', g.builtin
         from core.groups g where g.tenant_id = $1 and g.name ilike $2 escape '\\'
         order by 1 desc, 3 limit 50",
    )
    .bind(c.tenant.tenant_id)
    .bind(like)
    .fetch_all(&k.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| Principal {
            kind: r.get(0),
            id: r.get(1),
            name: r.get(2),
            detail: r.get(3),
            builtin: r.get(4),
        })
        .collect())
}
