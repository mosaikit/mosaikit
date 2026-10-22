//! Extensions (docs/architecture.md, "Extensions"): plugins with `kind = "extension"` that add fields
//! and actions to the items of another plugin.
//!
//! The contract is narrow on purpose:
//! - an extension declares its fields and actions on the resources of the plugin it extends
//!   (`[[extension.fields]]`, `[[extension.actions]]`); it never reads the tables of that plugin;
//! - the kernel keeps the values of the fields, one set per item and extension
//!   (`core.extension_values`), and checks every read and write with the permissions of the item:
//!   who sees the item sees the values, who can edit it can change them;
//! - an action either sets some fields (`set`) or runs a command of the logic of the extension, which
//!   receives the item and the current values and answers with the values to set;
//! - the UI of the extended plugin shows fields and actions through the bridge (`msk.extensions`),
//!   `mountCrud` does it by itself;
//! - a tab (`[[extension.tabs]]`) is a page of the UI of the extension that the host shows inside the
//!   detail of an item, in a frame of its own (docs/architecture.md, "Tabs of an extension").

use std::collections::BTreeMap;

use mosaikit_mskp::{ExtActionDecl, FieldDecl, ResourceDecl};
use serde::Serialize;
use serde_json::{json, Map, Value};
use uuid::Uuid;

use super::LoadedPlugin;
use crate::crud::{self, Values};
use crate::{access, events, Caller, Error, Kernel, Result};

/// An extension as the UI of the extended plugin sees it, for one resource.
#[derive(Debug, Clone, Serialize)]
pub struct ExtensionView {
    pub id: String,
    pub label: String,
    pub fields: Vec<FieldDecl>,
    pub actions: Vec<ActionView>,
    pub tabs: Vec<TabView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActionView {
    pub key: String,
    pub label: String,
}

/// A tab of an extension in the detail of an item: the host opens `page` of the UI of the extension.
#[derive(Debug, Clone, Serialize)]
pub struct TabView {
    pub key: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub page: String,
}

/// The extensions of `base` on in the tenant that the caller may use, with what they add to `resource`.
pub async fn for_resource(
    k: &Kernel,
    c: &Caller,
    base: &str,
    resource: &str,
    lang: &str,
) -> Result<Vec<ExtensionView>> {
    let (p, _) = access::plugin_for(k, c, base).await?;
    if p.manifest.resource(resource).is_none() {
        return Err(Error::not_found(format!("unknown resource: {resource}")));
    }
    let perms = access::effective_all(k, c.tenant.tenant_id, c.user.user_id, c.tenant.role).await?;
    let mut out = Vec::new();
    for e in k.plugins.list() {
        if !e.manifest.extends.as_ref().is_some_and(|x| x.plugin == base) {
            continue;
        }
        // effective_all lists only the plugins on in the tenant
        if !perms.get(&e.id).is_some_and(|keys| keys.contains(access::USE)) {
            continue;
        }
        let m = e.manifest.localized(lang);
        let fields = m.extension.fields_of(resource);
        let actions: Vec<ActionView> = m
            .extension
            .actions
            .iter()
            .filter(|a| a.resource == resource)
            .map(|a| ActionView { key: a.key.clone(), label: a.label.clone() })
            .collect();
        // a tab needs the UI of the extension, built and served
        let tabs: Vec<TabView> = match (&m.ui, e.ui_dir.is_some()) {
            (Some(ui), true) => m
                .extension
                .tabs
                .iter()
                .filter(|t| t.resource == resource)
                .map(|t| TabView {
                    key: t.key.clone(),
                    label: t.label.clone(),
                    icon: t.icon.clone(),
                    page: t.page.clone().unwrap_or_else(|| ui.entry.clone()),
                })
                .collect(),
            _ => Vec::new(),
        };
        if fields.is_empty() && actions.is_empty() && tabs.is_empty() {
            continue;
        }
        out.push(ExtensionView {
            id: e.id.clone(),
            label: m.contribution.label.clone(),
            fields,
            actions,
            tabs,
        });
    }
    Ok(out)
}

/// The level of the caller on items of the extended plugin (0 = not visible).
async fn levels(k: &Kernel, c: &Caller, base: &str, ids: &[Uuid]) -> Result<Vec<i32>> {
    let mut tx = k.db.begin_plugin(base, &c.ctx()).await?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let l: i32 =
            mosaikit_db::query_scalar("select core.level_of($1)").bind(*id).fetch_one(&mut *tx).await?;
        out.push(l);
    }
    tx.commit().await?;
    Ok(out)
}

/// The extension, on in the tenant for the caller, extending `base`.
async fn extension_for(
    k: &Kernel,
    c: &Caller,
    base: &str,
    ext: &str,
) -> Result<std::sync::Arc<LoadedPlugin>> {
    let (e, _) = access::plugin_for(k, c, ext).await?;
    if !e.manifest.extends.as_ref().is_some_and(|x| x.plugin == base) {
        return Err(Error::bad(format!("{ext} does not extend {base}")));
    }
    Ok(e)
}

/// The resource made of the fields of the extension on `resource` (to check the values).
fn decl_of(e: &LoadedPlugin, resource: &str) -> Result<ResourceDecl> {
    let fields = e.manifest.extension.fields_of(resource);
    if fields.is_empty() {
        return Err(Error::not_found(format!("the extension adds no field to {resource}")));
    }
    Ok(ResourceDecl { name: resource.to_string(), label: String::new(), title_field: None, fields })
}

async fn stored(k: &Kernel, id: Uuid, ext: &str) -> Result<Option<Values>> {
    let v: Option<Value> = mosaikit_db::query_scalar(
        "select data from core.extension_values where resource_id = $1 and extension_id = $2",
    )
    .bind(id)
    .bind(ext)
    .fetch_optional(&k.db)
    .await?;
    Ok(v.and_then(|v| v.as_object().cloned()))
}

/// The values of the extensions on the items `ids` of `resource` the caller can see:
/// item id -> extension id -> values. Items not visible are left out.
pub async fn values(
    k: &Kernel,
    c: &Caller,
    base: &str,
    resource: &str,
    ids: &[Uuid],
) -> Result<BTreeMap<Uuid, BTreeMap<String, Values>>> {
    if ids.len() > 1000 {
        return Err(Error::bad("at most 1000 items at a time"));
    }
    let views = for_resource(k, c, base, resource, "en").await?;
    let mut out = BTreeMap::new();
    if views.is_empty() || ids.is_empty() {
        return Ok(out);
    }
    let lv = levels(k, c, base, ids).await?;
    for (id, l) in ids.iter().zip(lv) {
        if l < 1 {
            continue;
        }
        let mut per = BTreeMap::new();
        for v in &views {
            if v.fields.is_empty() {
                continue;
            }
            per.insert(v.id.clone(), stored(k, *id, &v.id).await?.unwrap_or_default());
        }
        out.insert(*id, per);
    }
    Ok(out)
}

async fn write(k: &Kernel, c: &Caller, ext: &str, id: Uuid, values: &Values) -> Result<()> {
    mosaikit_db::query(
        "insert into core.extension_values (resource_id, extension_id, tenant_id, data, updated_by)
         values ($1, $2, $3, $4, $5)
         on conflict (resource_id, extension_id) do update set data = excluded.data,
             updated_at = now(), updated_by = excluded.updated_by",
    )
    .bind(id)
    .bind(ext)
    .bind(c.tenant.tenant_id)
    .bind(Value::Object(values.clone()))
    .bind(c.user.user_id)
    .execute(&k.db)
    .await?;
    Ok(())
}

/// Checks the item (editable by the caller) and returns the fields of the extension with its values.
async fn editable(
    k: &Kernel,
    c: &Caller,
    base: &str,
    resource: &str,
    id: Uuid,
    ext: &str,
) -> Result<(std::sync::Arc<LoadedPlugin>, ResourceDecl, Values)> {
    access::plugin_for(k, c, base).await?;
    let e = extension_for(k, c, base, ext).await?;
    let lv = levels(k, c, base, &[id]).await?[0];
    if lv < 1 {
        return Err(Error::not_found("record not found"));
    }
    if lv < 2 {
        return Err(Error::forbidden("the write permission is required"));
    }
    let d = decl_of(&e, resource)?;
    let current = stored(k, id, ext).await?.unwrap_or_default();
    Ok((e, d, current))
}

/// Changes the values of an extension on an item (partial: the fields not given stay).
pub async fn set_values(
    k: &Kernel,
    c: &Caller,
    base: &str,
    resource: &str,
    id: Uuid,
    ext: &str,
    input: &Values,
) -> Result<Values> {
    let (_, d, current) = editable(k, c, base, resource, id, ext).await?;
    let values = crud::coerce(&d, input, Some(&current))?;
    write(k, c, ext, id, &values).await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(ext),
        Some(id),
        "extension.update",
        json!({ "resource": resource }),
    )
    .await;
    Ok(values)
}

/// `$user` and `$today` in the values of a `set` action.
fn expand(c: &Caller, v: &Value) -> Value {
    match v {
        Value::String(s) if s == "$user" => {
            let name =
                if c.user.display_name.trim().is_empty() { &c.user.username } else { &c.user.display_name };
            Value::String(name.clone())
        }
        Value::String(s) if s == "$today" => Value::String(chrono::Utc::now().format("%Y-%m-%d").to_string()),
        other => other.clone(),
    }
}

/// Runs an action of an extension on an item; returns the new values of the extension.
#[allow(clippy::too_many_arguments)]
pub async fn run_action(
    k: &Kernel,
    c: &Caller,
    base: &str,
    resource: &str,
    id: Uuid,
    ext: &str,
    action: &str,
) -> Result<Values> {
    let (e, d, current) = editable(k, c, base, resource, id, ext).await?;
    let a: ExtActionDecl = e
        .manifest
        .extension
        .actions
        .iter()
        .find(|a| a.key == action && a.resource == resource)
        .cloned()
        .ok_or_else(|| Error::not_found(format!("unknown action: {action}")))?;
    let changes: Values = match &a.command {
        None => a.set.iter().map(|(k, v)| (k.clone(), expand(c, v))).collect(),
        Some(cmd) => {
            let item = crud::get(k, c, base, resource, id).await?;
            let out = crud::call(
                k,
                c,
                ext,
                cmd,
                json!({ "resource": resource, "resource_id": id.to_string(),
                        "item": item.get("values"), "values": current }),
            )
            .await?;
            out.get("set").and_then(Value::as_object).cloned().unwrap_or_else(Map::new)
        }
    };
    let values = crud::coerce(&d, &changes, Some(&current))?;
    write(k, c, ext, id, &values).await?;
    events::record(
        k,
        Some(c.tenant.tenant_id),
        Some(c.user.user_id),
        Some(ext),
        Some(id),
        "extension.action",
        json!({ "resource": resource, "action": action }),
    )
    .await;
    Ok(values)
}
