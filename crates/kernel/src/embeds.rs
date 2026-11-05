//! Embedded pages: a plugin shows a page of another plugin (a viewer of one of its resources) in a frame of its own
//! page (docs/architecture.md, "Embedded pages"). `embed.url` is the one call that makes it possible:
//!
//! * the plugin that embeds must declare the other one in `[permissions] embeds`, and the other one must declare the page in
//!   `[[embeds]]` (the checks of the platform, so neither can be made to do it by the other alone);
//! * the person must use the plugin that owns the resource and must see the resource now (`resource_kind` is checked too);
//! * the answer is the address of the page on the origin of its plugin, with a **run ticket** limited to the resource and to
//!   the `commands` of the embed: the page reads with the rights of the person, never with more, for at most an hour;
//! * nothing here lets a page read a plugin that is not its own.

use serde_json::{json, Value};
use uuid::Uuid;

use crate::run_tickets::{self, MintRequest};
use crate::{acl, Caller, Error, Kernel, Result};

/// Lifetime of the ticket of a frame, in minutes. The page of the host asks again before it ends.
pub const TTL_MINUTES: u32 = 60;
/// Calls the ticket allows.
pub const USES: u32 = 1000;

/// `embed.url` for the plugin `host`: `{ plugin, name, resource }` gives `{ url, expires_at, contract, resource }`.
pub async fn url(k: &Kernel, c: &Caller, host: &str, req: &Value) -> Result<Value> {
    let bad = |m: &str| Error::bad(m.to_string());
    let target = req.get("plugin").and_then(Value::as_str).ok_or_else(|| bad("plugin is required"))?;
    let name = req.get("name").and_then(Value::as_str).ok_or_else(|| bad("name is required"))?;
    let rid: Uuid = req
        .get("resource")
        .and_then(Value::as_str)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| bad("resource must be an id"))?;
    if c.run.is_some() {
        return Err(Error::forbidden("a run ticket cannot open an embedded page"));
    }
    // the plugin that embeds declares who it may embed
    let (h, _) = crate::access::require(k, c, host, crate::access::USE).await?;
    if !h.manifest.permissions.embeds.iter().any(|p| p == target) {
        return Err(Error::forbidden("the plugin is not declared in `embeds` in [permissions]")
            .with_code("permission_denied"));
    }
    let (t, _) = crate::access::require(k, c, target, crate::access::USE).await?;
    let decl = t
        .manifest
        .embeds
        .iter()
        .find(|e| e.name == name)
        .ok_or_else(|| Error::not_found("the plugin has no such embedded page"))?;
    // the resource: of that plugin, of the kind the page shows, and visible to the person now
    let m = acl::meta(k, c, rid).await.map_err(|e| {
        if e.kind == crate::Kind::Forbidden {
            Error::not_found("resource not found")
        } else {
            e
        }
    })?;
    if m.plugin_id != t.id
        || decl.resource_kind.as_deref().is_some_and(|kind| kind != m.kind)
        || m.level < acl::Level::Read
    {
        return Err(Error::not_found("resource not found"));
    }
    let minted = run_tickets::mint(
        k,
        c,
        &MintRequest {
            plugin: t.id.clone(),
            commands: decl.commands.clone(),
            run_ref: format!("embed:{host}:{name}"),
            ttl_minutes: Some(TTL_MINUTES),
            uses: Some(USES),
            resources: Some(vec![rid]),
            schedule: None,
        },
    )
    .await?;
    let base = k.cfg.plugin_url_for(&t.id);
    let api = k.cfg.app_origin();
    let q = format!(
        "embed={}&plugin={}&resource={}&api={}",
        minted.token,
        crate::util::url_encode(&t.id),
        rid,
        crate::util::url_encode(&api)
    );
    Ok(json!({
        "url": format!("{}/ui/{}/{}?{}", base.trim_end_matches('/'), t.id, decl.entry, q),
        "expires_at": minted.expires_at,
        "contract": decl.contract,
        "resource": rid,
    }))
}
