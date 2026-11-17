//! How visible an item is: the summary a catalog shows next to each entry (`private`, `shared`,
//! `organization`, `public`) and the share list of an item for the plugin that owns it (`resource.shares`).
//!
//! The summary follows the platform's own state, with no second flag in the plugin: it looks at the shares and the
//! public links of the item and of its ancestors (a folder shared with a group shares what is inside).
//! `public` is an active public link, `organization` a share to the built-in group "All members", `shared`
//! any other share to a person or a group, `private` none of them. It says nothing about who the people are.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};
use uuid::Uuid;

use crate::acl::{self, Level};
use crate::{links, Caller, Error, Kernel, Result};

/// The built-in group of a tenant that holds every member (`core.groups.builtin = 'all'`).
pub async fn all_members_group(k: &Kernel, tenant: Uuid) -> Result<Option<Uuid>> {
    Ok(mosaikit_db::query_scalar("select id from core.groups where tenant_id = $1 and builtin = 'all'")
        .bind(tenant)
        .fetch_optional(&k.db)
        .await?)
}

/// The summary of each item of `ids` (all of the tenant): `private`, `shared`, `organization` or `public`.
pub async fn of(k: &Kernel, tenant: Uuid, ids: &[Uuid]) -> Result<HashMap<Uuid, &'static str>> {
    let mut out: HashMap<Uuid, &'static str> = ids.iter().map(|i| (*i, "private")).collect();
    if ids.is_empty() {
        return Ok(out);
    }
    let want = ids.to_vec();
    let rows =
        mosaikit_db::query("select id, ancestors from core.resources where id = any($1) and tenant_id = $2")
            .bind(&want)
            .bind(tenant)
            .fetch_all(&k.db)
            .await?;
    // item -> itself and its ancestors (a share on a folder reaches what is inside)
    let mut chain: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    let mut every: HashSet<Uuid> = HashSet::new();
    for r in &rows {
        let id: Uuid = r.get(0);
        let mut c: Vec<Uuid> = r.get::<Vec<Uuid>, _>(1);
        c.push(id);
        every.extend(c.iter().copied());
        chain.insert(id, c);
    }
    let every: Vec<Uuid> = every.into_iter().collect();
    let all = all_members_group(k, tenant).await?;
    let mut shared: HashSet<Uuid> = HashSet::new();
    let mut org: HashSet<Uuid> = HashSet::new();
    for g in mosaikit_db::query(
        "select resource_id, principal_type, principal_id from core.grants where resource_id = any($1)",
    )
    .bind(&every)
    .fetch_all(&k.db)
    .await?
    {
        let (rid, kind, who): (Uuid, String, Uuid) = (g.get(0), g.get(1), g.get(2));
        if kind == "group" && Some(who) == all {
            org.insert(rid);
        } else {
            shared.insert(rid);
        }
    }
    let public: HashSet<Uuid> = mosaikit_db::query_scalar::<Uuid>(
        "select resource_id from core.public_links
         where resource_id = any($1) and revoked_at is null and (expires_at is null or expires_at > now())",
    )
    .bind(&every)
    .fetch_all(&k.db)
    .await?
    .into_iter()
    .collect();
    for (id, c) in &chain {
        let any = |set: &HashSet<Uuid>| c.iter().any(|a| set.contains(a));
        let v = if any(&public) {
            "public"
        } else if any(&org) {
            "organization"
        } else if any(&shared) {
            "shared"
        } else {
            "private"
        };
        out.insert(*id, v);
    }
    Ok(out)
}

/// `resource.shares` for the logic of the plugin `plugin`, which declared `allowed` in `resources_read`:
/// the shares and public links of an item of the plugin (or of one it may read), for a caller who manages it.
/// `req`: `{ id }`. The token of a link is never returned (the server keeps only its hash).
pub async fn shares_from_logic(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    allowed: &[String],
    req: &Value,
) -> Result<Value> {
    let id: Uuid = req
        .get("id")
        .and_then(Value::as_str)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| Error::bad("id is required"))?;
    let m = acl::meta(k, c, id).await?;
    if m.plugin_id != plugin && !allowed.contains(&m.plugin_id) {
        return Err(Error::forbidden(
            "the item is not of this plugin or of one declared in `resources_read` in [permissions]",
        )
        .with_code("permission_denied"));
    }
    // managing the item: the same rule as the sharing dialog
    acl::require_level(k, c, id, Level::Manage).await?;
    let grants = acl::grants(k, c, id).await?;
    let all = all_members_group(k, c.tenant.tenant_id).await?;
    let ls = links::list(k, c, id).await?;
    let visibility = of(k, c.tenant.tenant_id, &[id]).await?.get(&id).copied().unwrap_or("private");
    let shares: Vec<Value> = grants
        .iter()
        .map(|g| {
            json!({
                "principal_type": g.principal_type,
                "principal_id": g.principal_id,
                "name": g.name,
                "level": g.level,
                "actions": g.actions,
                "all_members": g.principal_type == "group" && Some(g.principal_id) == all,
            })
        })
        .collect();
    Ok(json!({ "id": id, "visibility": visibility, "shares": shares, "links": ls }))
}
