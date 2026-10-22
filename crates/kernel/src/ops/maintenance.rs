//! Maintenance mode (System › Maintenance): while it is on, everybody sees the notice and only the
//! Administrators sign in and work; the rest is refused with the code `maintenance` (requests of the shell
//! and of the plugins, sign-in, public links). A planned maintenance shows its notice in advance and turns
//! the mode on by itself at the planned time.

use std::time::{Duration as StdDuration, Instant};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::tenancy::levels;
use crate::{events, Error, Kernel, Result, SessionUser};

/// How long the state read from the database is reused.
const CACHE: StdDuration = StdDuration::from_secs(5);

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Maintenance {
    #[serde(default)]
    pub on: bool,
    /// notice shown while it is on
    #[serde(default)]
    pub message: String,
    /// planned start: its notice is shown before, and the mode turns on at that time
    #[serde(default)]
    pub planned_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub planned_message: String,
}

async fn stored(k: &Kernel) -> Result<Maintenance> {
    let s = levels::system_settings(k).await?;
    Ok(s.get("maintenance").cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default())
}

/// The state, reused for a few seconds (it is read at every request).
pub async fn get(k: &Kernel) -> Result<Maintenance> {
    if let Some((at, m)) = k.ops.maintenance.lock().expect("maintenance").clone() {
        if at.elapsed() < CACHE {
            return Ok(m);
        }
    }
    let m = stored(k).await?;
    *k.ops.maintenance.lock().expect("maintenance") = Some((Instant::now(), m.clone()));
    Ok(m)
}

/// Refuses who is not an Administrator while the mode is on.
pub async fn check(k: &Kernel, user: Option<&SessionUser>) -> Result<()> {
    if user.is_some_and(|u| u.is_system_admin) {
        return Ok(());
    }
    let m = get(k).await?;
    if m.on {
        let msg =
            if m.message.is_empty() { "The platform is under maintenance".to_string() } else { m.message };
        return Err(Error::forbidden(msg).with_code("maintenance"));
    }
    Ok(())
}

async fn write(k: &Kernel, m: &Maintenance) -> Result<()> {
    let mut s = levels::system_settings(k).await?;
    s["maintenance"] = serde_json::to_value(m)?;
    levels::write_system(k, &s).await?;
    *k.ops.maintenance.lock().expect("maintenance") = Some((Instant::now(), m.clone()));
    Ok(())
}

/// Changes the mode or the planned maintenance (Administrator).
pub async fn set(k: &Kernel, admin: &SessionUser, m: &Maintenance) -> Result<Maintenance> {
    crate::tenancy::require_admin(admin)?;
    let mut m = m.clone();
    m.message = m.message.trim().chars().take(500).collect();
    m.planned_message = m.planned_message.trim().chars().take(500).collect();
    if m.planned_at.is_some_and(|p| p <= Utc::now()) && !m.on {
        return Err(Error::bad("the planned time must be in the future").with_code("planned_past"));
    }
    let before = stored(k).await?;
    write(k, &m).await?;
    if before.on != m.on {
        events::record(
            k,
            None,
            Some(admin.user_id),
            None,
            None,
            if m.on { "maintenance.on" } else { "maintenance.off" },
            json!({ "message": m.message }),
        )
        .await;
    } else if before.planned_at != m.planned_at {
        events::record(
            k,
            None,
            Some(admin.user_id),
            None,
            None,
            "maintenance.planned",
            json!({ "at": m.planned_at }),
        )
        .await;
    }
    Ok(m)
}

/// Turns the mode on at the planned time (background work).
pub async fn start_planned(k: &Kernel) -> Result<()> {
    let mut m = stored(k).await?;
    if m.on || !m.planned_at.is_some_and(|p| p <= Utc::now()) {
        return Ok(());
    }
    m.on = true;
    if m.message.is_empty() {
        m.message = m.planned_message.clone();
    }
    m.planned_at = None;
    m.planned_message.clear();
    write(k, &m).await?;
    events::record(
        k,
        None,
        None,
        None,
        None,
        "maintenance.on",
        json!({ "planned": true, "message": m.message }),
    )
    .await;
    Ok(())
}
