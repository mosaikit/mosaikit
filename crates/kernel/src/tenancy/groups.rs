//! Groups of the tenant (recipients of shares).

use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use super::members::member_role;
use crate::{Caller, Error, Kernel, Result};

#[derive(Debug, Clone, Serialize)]
pub struct GroupMember {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupInfo {
    pub id: Uuid,
    pub name: String,
    pub members: Vec<GroupMember>,
}

pub async fn groups(k: &Kernel, c: &Caller) -> Result<Vec<GroupInfo>> {
    let rows = mosaikit_db::query(
        "select g.id, g.name, coalesce(json_agg(json_build_object('user_id', u.id, 'username', u.username,
                'display_name', u.display_name) order by u.username) filter (where u.id is not null), '[]')
         from core.groups g left join core.group_members gm on gm.group_id = g.id left join core.users u on u.id = gm.user_id
         where g.tenant_id = $1 group by g.id order by g.name",
    )
    .bind(c.tenant.tenant_id)
    .fetch_all(&k.db)
    .await?;
    rows.iter()
        .map(|r| {
            let members: Value = r.get(2);
            Ok(GroupInfo {
                id: r.get(0),
                name: r.get(1),
                members: members
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .map(|m| GroupMember {
                                user_id: m["user_id"]
                                    .as_str()
                                    .and_then(|s| s.parse().ok())
                                    .unwrap_or_default(),
                                username: m["username"].as_str().unwrap_or_default().into(),
                                display_name: m["display_name"].as_str().unwrap_or_default().into(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect()
}

pub async fn create_group(k: &Kernel, c: &Caller, name: &str) -> Result<Uuid> {
    c.require_manager()?;
    let name = name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(Error::bad("invalid group name"));
    }
    let id: Uuid =
        mosaikit_db::query_scalar("insert into core.groups (tenant_id, name) values ($1, $2) returning id")
            .bind(c.tenant.tenant_id)
            .bind(name)
            .fetch_one(&k.db)
            .await
            .map_err(|e| match Error::from(e) {
                err if err.kind == crate::Kind::Conflict => {
                    Error::conflict(format!("the group '{name}' already exists"))
                }
                err => err,
            })?;
    Ok(id)
}

pub async fn delete_group(k: &Kernel, c: &Caller, id: Uuid) -> Result<()> {
    c.require_manager()?;
    let mut tx = k.db.begin_app().await?;
    let n = mosaikit_db::query("delete from core.groups where id = $1 and tenant_id = $2")
        .bind(id)
        .bind(c.tenant.tenant_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(Error::not_found("group not found"));
    }
    mosaikit_db::query("delete from core.grants where principal_type = 'group' and principal_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn set_group_member(k: &Kernel, c: &Caller, group: Uuid, user: Uuid, member: bool) -> Result<()> {
    c.require_manager()?;
    let ok: bool = mosaikit_db::query_scalar(
        "select exists (select 1 from core.groups where id = $1 and tenant_id = $2)",
    )
    .bind(group)
    .bind(c.tenant.tenant_id)
    .fetch_one(&k.db)
    .await?;
    if !ok {
        return Err(Error::not_found("group not found"));
    }
    if member {
        if member_role(k, c.tenant.tenant_id, user).await?.is_none() {
            return Err(Error::bad("the user is not a member of the tenant"));
        }
        mosaikit_db::query(
            "insert into core.group_members (group_id, user_id) values ($1, $2) on conflict do nothing",
        )
        .bind(group)
        .bind(user)
        .execute(&k.db)
        .await?;
    } else {
        mosaikit_db::query("delete from core.group_members where group_id = $1 and user_id = $2")
            .bind(group)
            .bind(user)
            .execute(&k.db)
            .await?;
    }
    Ok(())
}
