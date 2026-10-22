//! Preferences of a person that follow them everywhere: every tenant, every device. Today high
//! contrast and the guided tours already seen (the mode and the language stay with the browser).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{Error, Kernel, Result};

/// Guided tours remembered, at most.
const MAX_TOURS: usize = 50;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonPrefs {
    /// sharper colours, for whoever reads with effort (every theme)
    #[serde(default)]
    pub contrast: bool,
    /// ids of the guided tours seen to the end or skipped
    #[serde(default)]
    pub tours_done: Vec<String>,
}

/// A change: only the keys present are changed.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PrefsChange {
    pub contrast: Option<bool>,
    /// a tour to remember as done
    pub tour_done: Option<String>,
    /// forget every tour (they show again)
    #[serde(default)]
    pub reset_tours: bool,
}

pub async fn get(k: &Kernel, user: Uuid) -> Result<PersonPrefs> {
    let v: Option<Value> =
        mosaikit_db::query_scalar("select prefs from core.person_prefs where user_id = $1")
            .bind(user)
            .fetch_optional(&k.db)
            .await?;
    Ok(v.and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default())
}

pub async fn change(k: &Kernel, user: Uuid, ch: &PrefsChange) -> Result<PersonPrefs> {
    let mut p = get(k, user).await?;
    if let Some(c) = ch.contrast {
        p.contrast = c;
    }
    if ch.reset_tours {
        p.tours_done.clear();
    }
    if let Some(t) = &ch.tour_done {
        let ok = !t.is_empty()
            && t.len() <= 40
            && t.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !ok {
            return Err(Error::bad("invalid tour"));
        }
        if !p.tours_done.contains(t) {
            if p.tours_done.len() >= MAX_TOURS {
                p.tours_done.remove(0);
            }
            p.tours_done.push(t.clone());
        }
    }
    mosaikit_db::query(
        "insert into core.person_prefs (user_id, prefs, updated_at) values ($1, $2, now())
         on conflict (user_id) do update set prefs = excluded.prefs, updated_at = now()",
    )
    .bind(user)
    .bind(json!(p))
    .execute(&k.db)
    .await?;
    Ok(p)
}
