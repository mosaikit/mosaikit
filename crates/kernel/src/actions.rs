//! Actions of a share: names a plugin declares per resource type (`[[resources]] actions = ["download", "run"]`)
//! that sit on top of the levels read / write / manage. A grant of a person or a group carries the level and a
//! set of action names (`core.grants.actions`, comma separated names). Read keeps meaning "see", manage implies
//! every action, the owner has manage. A grant on a folder reaches what is inside, like the level.

use std::collections::{HashMap, HashSet};

use uuid::Uuid;

use crate::acl::Level;
use crate::{Caller, Error, Kernel, Result};

/// Names the kernel keeps for the levels: a plugin cannot declare them as actions.
const RESERVED: &[&str] = &["see", "read", "write", "manage"];

/// An action name: lower case letters, digits and `_`, starting with a letter, at most 32 characters.
pub fn valid_name(s: &str) -> bool {
    let mut ch = s.chars();
    matches!(ch.next(), Some(c) if c.is_ascii_lowercase())
        && s.len() <= 32
        && ch.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !RESERVED.contains(&s)
}

/// The names of a stored value (`,download,run,` or `download,run`).
pub fn parse(s: &str) -> Vec<String> {
    s.split(',').map(str::trim).filter(|a| !a.is_empty()).map(String::from).collect()
}

/// The stored value of a set of names: sorted, with no duplicates.
pub fn join(names: &[String]) -> String {
    let mut v: Vec<&str> = names.iter().map(String::as_str).collect();
    v.sort_unstable();
    v.dedup();
    v.join(",")
}

/// The actions the plugin declares for the kind of a resource (empty: none, or the plugin is not installed).
pub fn declared(k: &Kernel, plugin: &str, kind: &str) -> Vec<String> {
    k.plugins
        .get(plugin)
        .and_then(|p| p.manifest.resources.iter().find(|r| r.name == kind).map(|r| r.actions.clone()))
        .unwrap_or_default()
}

/// The caller may do `action` on the item: manage level, or a grant (own or of one of the groups, on the item
/// or on a folder above it) that lists the action.
pub async fn allowed(k: &Kernel, c: &Caller, rid: Uuid, action: &str) -> Result<bool> {
    if !valid_name(action) {
        return Err(Error::bad(format!("invalid action name: {action}")));
    }
    Ok(allowed_among(k, c, &[rid], action).await?.contains(&rid))
}

/// Of the items `ids` (the ones the caller sees), those on which the caller may do `action`.
pub async fn allowed_among(k: &Kernel, c: &Caller, ids: &[Uuid], action: &str) -> Result<HashSet<Uuid>> {
    let mut out = HashSet::new();
    if ids.is_empty() {
        return Ok(out);
    }
    let want = ids.to_vec();
    let mut tx = k.db.begin(&c.ctx()).await?;
    let rows =
        mosaikit_db::query("select id, ancestors, core.level_of(id) from core.resources where id = any($1)")
            .bind(&want)
            .fetch_all(&mut *tx)
            .await?;
    tx.commit().await?;
    let mut chain: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    let mut every: Vec<Uuid> = Vec::new();
    for r in &rows {
        let id: Uuid = r.get(0);
        if Level::from_i32(r.get(2)) >= Level::Manage {
            out.insert(id);
            continue;
        }
        if Level::from_i32(r.get(2)) == Level::None {
            continue;
        }
        let mut a: Vec<Uuid> = r.get::<Vec<Uuid>, _>(1);
        a.push(id);
        every.extend(a.iter().copied());
        chain.insert(id, a);
    }
    if chain.is_empty() {
        return Ok(out);
    }
    let groups: HashSet<Uuid> =
        mosaikit_db::query_scalar::<Uuid>("select group_id from core.group_members where user_id = $1")
            .bind(c.user.user_id)
            .fetch_all(&k.db)
            .await?
            .into_iter()
            .collect();
    let mut with: HashSet<Uuid> = HashSet::new();
    for g in mosaikit_db::query(
        "select resource_id, principal_type, principal_id, actions from core.grants where resource_id = any($1)",
    )
    .bind(&every)
    .fetch_all(&k.db)
    .await?
    {
        let (rid, kind, who, acts): (Uuid, String, Uuid, String) = (g.get(0), g.get(1), g.get(2), g.get(3));
        let mine = if kind == "user" { who == c.user.user_id } else { groups.contains(&who) };
        if mine && parse(&acts).iter().any(|a| a == action) {
            with.insert(rid);
        }
    }
    for (id, a) in &chain {
        if a.iter().any(|x| with.contains(x)) {
            out.insert(*id);
        }
    }
    Ok(out)
}

/// Checks the names of a grant: well formed, and declared by the plugin for the kind of the resource.
pub fn check(k: &Kernel, plugin: &str, kind: &str, names: &[String]) -> Result<()> {
    if names.is_empty() {
        return Ok(());
    }
    let declared = declared(k, plugin, kind);
    for n in names {
        if !valid_name(n) {
            return Err(Error::bad(format!("invalid action name: {n}")));
        }
        if !declared.contains(n) {
            return Err(Error::bad(format!("the action '{n}' is not declared for '{kind}' by the plugin")));
        }
    }
    Ok(())
}

/// Which actions a grant lists, for the people that manage the item (`GrantInfo`).
pub fn of_grant(stored: &str) -> Vec<String> {
    parse(stored)
}
