//! Embedded pages: a plugin shows a page of another plugin (a viewer of one of its resources) in a frame of its own
//! page (docs/architecture.md, "Embedded pages"). `embed.url` is the one call that makes it possible:
//!
//! * the plugin that embeds must declare the other one in `[permissions] embeds`, and the other one must declare the page in
//!   `[[embeds]]` (the checks of the platform, so neither can be made to do it by the other alone);
//! * the person must use the plugin that owns the resource and must see the resource now (`resource_kind` is checked too);
//! * the answer is the address of the page on the origin of its plugin, with a **run ticket** limited to the resource and to
//!   the `commands` of the embed: the page reads with the rights of the person, never with more, for at most an hour;
//! * nothing here lets a page read a plugin that is not its own;
//! * in a public link view (`public_url`, `call_public`) the ticket belongs to the link, not to a person: see the section
//!   "Embedded pages" of the architecture.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
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
    Ok(answer(k, &t.id, decl, &minted.token, rid, json!(minted.expires_at)))
}

/// The answer of `embed.url`: the address of the page on the origin of its plugin, with its ticket.
fn answer(
    k: &Kernel,
    plugin: &str,
    decl: &mosaikit_mskp::EmbedDecl,
    token: &str,
    rid: Uuid,
    exp: Value,
) -> Value {
    let base = k.cfg.plugin_url_for(plugin);
    let api = k.cfg.app_origin();
    let q = format!(
        "embed={}&plugin={}&resource={}&api={}",
        token,
        crate::util::url_encode(plugin),
        rid,
        crate::util::url_encode(&api)
    );
    json!({
        "url": format!("{}/ui/{}/{}?{}", base.trim_end_matches('/'), plugin, decl.entry, q),
        "expires_at": exp,
        "contract": decl.contract,
        "resource": rid,
    })
}

// ------------------------------------------------------------------ public link views

/// Prefix of the ticket of an embedded page in a public view; a run ticket is 48 hex characters and never has it.
pub const PUBLIC_PREFIX: &str = "pe.";

#[derive(Serialize, Deserialize)]
struct PublicTicket {
    /// the public link
    l: Uuid,
    /// the resource the frame shows (the one of the link or one of its descendants)
    r: Uuid,
    /// the embedded plugin and the name of its embed
    p: String,
    e: String,
    /// expiry, seconds since the epoch
    x: i64,
}

/// The signature of a ticket: HMAC-SHA256 with the secret of the server over the payload and the password of the link
/// (a new password of the link kills the tickets made before).
fn sign(k: &Kernel, payload: &[u8], password_hash: Option<&str>) -> Hmac<Sha256> {
    let mut mac = Hmac::<Sha256>::new_from_slice(&k.cookie_secret).expect("HMAC accepts keys of any length");
    mac.update(b"mosaikit public embed v1");
    mac.update(payload);
    mac.update(password_hash.unwrap_or("").as_bytes());
    mac
}

/// The resource of a frame in a public view: it must be the shared resource or one of its descendants (what the link
/// sees, the database decides) and of the kind the embed shows. Its plugin is the one of the link: resources never have a
/// parent of another plugin, so nothing under a link belongs to the embedded plugin.
async fn shown(
    k: &Kernel,
    r: &crate::links::Resolved,
    rid: Uuid,
    kind: Option<&str>,
) -> Result<(String, String)> {
    let nf = || Error::not_found("resource not found");
    let mut tx = k.db.begin_plugin(&r.plugin_id, &r.ctx()).await?;
    let row = mosaikit_db::query("select kind, title from core.visible_resources where id = $1")
        .bind(rid)
        .fetch_optional(&mut *tx)
        .await?;
    tx.commit().await?;
    let row = row.ok_or_else(nf)?;
    let (kind_now, title): (String, String) = (row.get(0), row.get(1));
    if kind.is_some_and(|want| want != kind_now) {
        return Err(nf());
    }
    Ok((kind_now, title))
}

type PublicEmbed = (std::sync::Arc<crate::plugins::LoadedPlugin>, mosaikit_mskp::EmbedDecl, Vec<String>);

/// What a public view may embed: the plugin of the link must declare the other one, the other must declare the page,
/// and the commands are those of the page that the plugin ALSO lists in `[[public_commands]]`.
fn public_embed(k: &Kernel, r: &crate::links::Resolved, target: &str, name: &str) -> Result<PublicEmbed> {
    let host = k.plugins.active(&r.plugin_id)?;
    if !host.manifest.permissions.embeds.iter().any(|p| p == target) {
        return Err(Error::forbidden("the plugin is not declared in `embeds` in [permissions]")
            .with_code("permission_denied"));
    }
    let t = k.plugins.active(target).map_err(|_| Error::not_found("the plugin has no such embedded page"))?;
    let decl = t
        .manifest
        .embeds
        .iter()
        .find(|e| e.name == name)
        .ok_or_else(|| Error::not_found("the plugin has no such embedded page"))?
        .clone();
    let commands: Vec<String> = decl
        .commands
        .iter()
        .filter(|c| t.manifest.public_commands.iter().any(|d| &d.name == *c))
        .cloned()
        .collect();
    Ok((t, decl, commands))
}

/// `embed.url` for the page of a public link (`POST /p/{token}/embed`): `{ plugin, name, resource }` gives the same answer
/// as for a person, but the ticket belongs to the link: it is limited to `resource` (the shared one or a descendant) and to the
/// commands of the embed that the plugin also exposes as public commands, runs read only as a visitor (no person, no
/// rights) and stops with the link.
pub async fn public_url(k: &Kernel, r: &crate::links::Resolved, req: &Value) -> Result<Value> {
    let bad = |m: &str| Error::bad(m.to_string());
    let target = req.get("plugin").and_then(Value::as_str).ok_or_else(|| bad("plugin is required"))?;
    let name = req.get("name").and_then(Value::as_str).ok_or_else(|| bad("name is required"))?;
    let rid: Uuid = req
        .get("resource")
        .and_then(Value::as_str)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| bad("resource must be an id"))?;
    if !r.public_commands_enabled {
        return Err(Error::forbidden("public commands are turned off for this tenant")
            .with_code("public_commands_off"));
    }
    let (t, decl, commands) = public_embed(k, r, target, name)?;
    if !crate::plugins::tenants::is_on(k, r.tenant, &t.id).await? {
        return Err(Error::not_found("the plugin has no such embedded page"));
    }
    if commands.is_empty() {
        return Err(
            Error::forbidden("the embedded page has no public command").with_code("command_not_public")
        );
    }
    shown(k, r, rid, decl.resource_kind.as_deref()).await?;
    let exp = chrono::Utc::now() + chrono::Duration::minutes(i64::from(TTL_MINUTES));
    let payload = serde_json::to_vec(&PublicTicket {
        l: r.link_id,
        r: rid,
        p: t.id.clone(),
        e: name.to_string(),
        x: exp.timestamp(),
    })?;
    let mac = sign(k, &payload, r.password_hash.as_deref()).finalize().into_bytes();
    let token = format!("{PUBLIC_PREFIX}{}.{}", hex::encode(&payload), hex::encode(mac));
    Ok(answer(k, &t.id, &decl, &token, rid, json!(exp)))
}

fn invalid() -> Error {
    Error::new(crate::Kind::Unauthorized, "invalid, expired or revoked run ticket")
        .with_code("run_ticket_invalid")
}

/// A call from an embedded page in a public view (`POST /api/run/{ticket}/call/{plugin}/{command}` with a ticket of
/// `public_url`). Everything is checked again on every call: the link (revoked, expired, trashed, plugin off, tenant
/// policy), the signature, the declarations of both plugins as they are now, the resource and the command, which must be
/// one of the embed AND a public command of the plugin. It then runs as any public command (`crud::call_public`: read only,
/// no user, rate limits of the link), with the link narrowed to the resource of the frame.
pub async fn call_public(k: &Kernel, token: &str, plugin: &str, command: &str, args: Value) -> Result<Value> {
    let rest = token.strip_prefix(PUBLIC_PREFIX).ok_or_else(invalid)?;
    let (payload, mac) = rest.split_once('.').ok_or_else(invalid)?;
    let (payload, mac) =
        (hex::decode(payload).map_err(|_| invalid())?, hex::decode(mac).map_err(|_| invalid())?);
    let t: PublicTicket = serde_json::from_slice(&payload).map_err(|_| invalid())?;
    let mut r = crate::links::resolve_id(k, t.l).await.map_err(|_| invalid())?;
    sign(k, &payload, r.password_hash.as_deref()).verify_slice(&mac).map_err(|_| invalid())?;
    if t.x <= chrono::Utc::now().timestamp() {
        return Err(invalid());
    }
    if t.p != plugin {
        return Err(Error::forbidden("this ticket is for another plugin").with_code("run_wrong_plugin"));
    }
    let (p, decl, commands) = public_embed(k, &r, &t.p, &t.e)?;
    if !decl.commands.iter().any(|c| c == command) {
        return Err(
            Error::forbidden("this ticket does not allow this command").with_code("run_wrong_command")
        );
    }
    if !commands.iter().any(|c| c == command) {
        return Err(Error::forbidden("this command is not public").with_code("command_not_public"));
    }
    if !crate::plugins::tenants::is_on(k, r.tenant, &p.id).await? {
        return Err(invalid());
    }
    let (kind, title) = shown(k, &r, t.r, decl.resource_kind.as_deref()).await.map_err(|_| invalid())?;
    // the link, narrowed to the resource of the frame and run by the embedded plugin: what the command reads and `link_resource` say
    r.resource = t.r;
    r.plugin_id = p.id.clone();
    r.kind = kind;
    r.title = title;
    crate::crud::call_public(k, &r, command, args).await
}
