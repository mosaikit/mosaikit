//! Memory of an uninstalled plugin: uninstalling drops the plugin with its schema and, in cascade, the
//! choices of the tenants; installing it again brings back its state of then — on or off in the platform,
//! the default availability and, for each tenant that still exists, whether it was available and on
//! (`core.plugin_memory`). The memory is consumed by the install that uses it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use super::Status;
use crate::{Kernel, Result};

/// What a plugin was when it was uninstalled.
#[derive(Debug, Clone)]
pub(crate) struct Memory {
    pub status: Status,
    pub available_default: bool,
    pub tenants: Vec<TenantChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TenantChoice {
    pub tenant_id: Uuid,
    pub available: Option<bool>,
    pub enabled: bool,
}

/// Keeps the state of a plugin about to be uninstalled (inside the transaction of the uninstall).
pub(crate) async fn remember(tx: &mut mosaikit_db::Tx, id: &str) -> Result<()> {
    let row = mosaikit_db::query("select status, available_default from core.plugins where id = $1")
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?;
    let Some(row) = row else { return Ok(()) };
    let status: String = row.get(0);
    let available_default: bool = row.get(1);
    let tenants: Vec<TenantChoice> = mosaikit_db::query(
        "select tenant_id, available, enabled from core.tenant_plugins where plugin_id = $1",
    )
    .bind(id)
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|r| TenantChoice { tenant_id: r.get(0), available: r.get(1), enabled: r.get(2) })
    .collect();
    mosaikit_db::query("delete from core.plugin_memory where plugin_id = $1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    mosaikit_db::query(
        "insert into core.plugin_memory (plugin_id, status, available_default, tenants) values ($1, $2, $3, $4)",
    )
    .bind(id)
    .bind(status)
    .bind(available_default)
    .bind(serde_json::to_value(&tenants)?)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// The memory of a plugin, if it was uninstalled before.
pub(crate) async fn recall(k: &Kernel, id: &str) -> Result<Option<Memory>> {
    let row = mosaikit_db::query(
        "select status, available_default, tenants from core.plugin_memory where plugin_id = $1",
    )
    .bind(id)
    .fetch_optional(&k.db)
    .await?;
    Ok(row.map(|r| {
        let tenants: Value = r.get(2);
        Memory {
            status: match Status::parse(r.get::<&str, _>(0)) {
                // a block comes from the registry at install time, not from memory
                Status::Blocked => Status::Installed,
                s => s,
            },
            available_default: r.get(1),
            tenants: serde_json::from_value(tenants).unwrap_or_default(),
        }
    }))
}

/// Puts back the choices of a plugin installed again (inside the transaction of the install) and forgets
/// the memory.
pub(crate) async fn restore(tx: &mut mosaikit_db::Tx, id: &str, m: &Memory) -> Result<()> {
    mosaikit_db::query("update core.plugins set available_default = $2 where id = $1")
        .bind(id)
        .bind(m.available_default)
        .execute(&mut **tx)
        .await?;
    for c in &m.tenants {
        let exists: bool =
            mosaikit_db::query_scalar("select exists (select 1 from core.tenants where id = $1)")
                .bind(c.tenant_id)
                .fetch_one(&mut **tx)
                .await?;
        if !exists {
            continue;
        }
        mosaikit_db::query(
            "insert into core.tenant_plugins (tenant_id, plugin_id, available, enabled) values ($1, $2, $3, $4)
             on conflict (tenant_id, plugin_id) do update set available = excluded.available, enabled = excluded.enabled",
        )
        .bind(c.tenant_id)
        .bind(id)
        .bind(c.available)
        .bind(c.enabled)
        .execute(&mut **tx)
        .await?;
    }
    mosaikit_db::query("delete from core.plugin_memory where plugin_id = $1")
        .bind(id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
