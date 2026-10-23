//! Search of the shell: the items of the plugins a person can see, by title and searchable fields.
//!
//! The kernel keeps, for each item of a `[[resources]]` declaration, the text of its searchable fields
//! in `core.resources.search_text` (written after every create and update; items still without it are
//! indexed by the background worker). The search reads `core.resources` with the same rules as every
//! other list of the kernel: the tenant of the caller, never the trash, only plugins on in the tenant
//! where the caller has `use`, and the level of the caller on the item (ownership, shares, groups).
//!
//! PostgreSQL: full text on `search_vec` (configuration `simple`: no stemming, the same for every
//! language), each word as a prefix (`acc` finds `account`); the title also matches anywhere with
//! `ilike`. SQLite: every word must appear (anywhere) in title or searchable text, with `like`
//! (case-insensitive for ASCII letters only). A plugin can add results with a command (`[search]`).

use std::collections::{BTreeMap, HashSet};

use mosaikit_db::Ctx;
use mosaikit_mskp::ResourceDecl;
use serde::Serialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::crud::Values;
use crate::{Caller, Kernel, Result, SessionUser};

/// Words considered, at most; shorter queries are faster and enough to find an item.
const MAX_WORDS: usize = 5;
/// Rows read before grouping by plugin.
const MAX_ROWS: i64 = 300;
/// Results per plugin returned to the shell.
const PER_PLUGIN: usize = 20;

/// The searchable text of a record: the values of its searchable fields, except the title (stored on
/// its own), at most 20 000 characters.
pub fn text_of(d: &ResourceDecl, values: &Values) -> String {
    let title = d.title_key();
    let parts: Vec<String> = d
        .fields
        .iter()
        .filter(|f| f.searchable() && Some(f.key.as_str()) != title)
        .filter_map(|f| match values.get(&f.key) {
            Some(Value::String(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Some(Value::Number(n)) => Some(n.to_string()),
            _ => None,
        })
        .collect();
    parts.join("\n").chars().take(20_000).collect()
}

/// Writes the searchable text of an item (after its create or update).
pub async fn index(k: &Kernel, id: Uuid, text: &str) {
    if let Err(e) = mosaikit_db::query("update core.resources set search_text = $2 where id = $1")
        .bind(id)
        .bind(text)
        .execute(&k.db)
        .await
    {
        tracing::warn!("search text of {id}: {e}");
    }
}

/// Indexes the items without a search text yet (created before the search, or by an older kernel):
/// a batch at a time, read with the rights of their owner. Returns how many were written.
pub async fn reindex_pending(k: &Kernel) -> Result<u64> {
    let rows = mosaikit_db::query(
        "select id, tenant_id, owner_id, plugin_id, kind from core.resources
         where search_text is null and not core.in_trash(id) limit 200",
    )
    .fetch_all(&k.db)
    .await?;
    let mut n = 0;
    for r in &rows {
        let id: Uuid = r.get(0);
        let tenant: Uuid = r.get(1);
        let owner: Uuid = r.get(2);
        let plugin: String = r.get(3);
        let kind: String = r.get(4);
        let text = match k.plugins.active(&plugin).ok().filter(|p| p.manifest.resource(&kind).is_some()) {
            Some(p) => {
                let d = p.manifest.resource(&kind).expect("resource of the manifest");
                let ctx = Ctx::user(owner, tenant);
                match crate::crud::get_ctx(k, &ctx, &p, &kind, id).await {
                    Ok(row) => {
                        text_of(d, row.get("values").and_then(Value::as_object).unwrap_or(&Values::new()))
                    }
                    Err(_) => String::new(),
                }
            }
            // files, folders and items of the logic: found by their title
            None => String::new(),
        };
        index(k, id, &text).await;
        n += 1;
    }
    Ok(n)
}

/// One item found.
#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    /// a piece of the searchable text around the first word found, if it is not in the title
    pub snippet: String,
    pub owner_name: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// The results of one plugin.
#[derive(Debug, Clone, Serialize)]
pub struct Group {
    pub plugin_id: String,
    pub label: String,
    pub icon: Option<String>,
    /// how many items match (the list holds at most 20)
    pub count: usize,
    pub items: Vec<Hit>,
}

/// The words of a query: letters and digits only, lower case, at most 5 of at least 2 characters.
pub fn words(q: &str) -> Vec<String> {
    q.split(|c: char| !c.is_alphanumeric())
        .map(str::to_lowercase)
        .filter(|w| w.chars().count() >= 2)
        .take(MAX_WORDS)
        .collect()
}

/// A word for `like ... escape '!'`. The words are letters and digits only (see `words`): the escape is
/// for safety if that ever changes.
fn like_bang(w: &str) -> String {
    w.replace('!', "!!").replace('%', "!%").replace('_', "!_")
}

/// `w1:* & w2:*`: every word, as the beginning of a word.
fn tsquery(words: &[String]) -> String {
    words.iter().map(|w| format!("{w}:*")).collect::<Vec<_>>().join(" & ")
}

/// A piece of `text` around the first of `words` (about 120 characters), or empty.
pub fn snippet(text: &str, words: &[String]) -> String {
    let lower = text.to_lowercase();
    let Some(at) = words.iter().filter_map(|w| lower.find(w.as_str())).min() else {
        return String::new();
    };
    // positions in characters (the lower case of a text has the same characters for the scripts used)
    let start_char = lower[..at].chars().count().saturating_sub(40);
    let piece: String = text.chars().skip(start_char).take(120).collect();
    let piece = piece.split_whitespace().collect::<Vec<_>>().join(" ");
    if start_char > 0 {
        format!("…{piece}")
    } else {
        piece
    }
}

/// The items of the tenant the caller can see that match `q`, grouped by plugin (the plugins on in the
/// tenant where the caller has `use`), with the labels in `lang`.
pub async fn search(k: &Kernel, c: &Caller, q: &str, lang: &str) -> Result<Vec<Group>> {
    let words = words(q);
    if words.is_empty() {
        return Ok(Vec::new());
    }
    let perms = crate::access::effective_all(k, c.tenant.tenant_id, c.user.user_id, c.tenant.role).await?;
    let usable: HashSet<String> =
        perms.into_iter().filter(|(_, keys)| keys.contains(crate::access::USE)).map(|(p, _)| p).collect();
    if usable.is_empty() {
        return Ok(Vec::new());
    }
    // `!` escapes the wildcards (a backslash does not survive the translation for SQLite)
    let likes: Vec<String> = (0..MAX_WORDS)
        .map(|i| words.get(i).map(|w| format!("%{}%", like_bang(w))).unwrap_or_else(|| "%".into()))
        .collect();
    // PostgreSQL: full text (and the title anywhere); SQLite: every word anywhere in title or text
    let sql = if k.db.is_sqlite() {
        "select r.id, r.plugin_id, r.kind, r.title, coalesce(r.search_text, ''),
                coalesce(nullif(u.display_name, ''), u.username), r.updated_at
         from core.resources r join core.users u on u.id = r.owner_id
         where r.tenant_id = $1 and not core.in_trash(r.id) and length($3) >= 0
           and lower(r.title || ' ' || coalesce(r.search_text, '')) like $4 escape '!'
           and lower(r.title || ' ' || coalesce(r.search_text, '')) like $5 escape '!'
           and lower(r.title || ' ' || coalesce(r.search_text, '')) like $6 escape '!'
           and lower(r.title || ' ' || coalesce(r.search_text, '')) like $7 escape '!'
           and lower(r.title || ' ' || coalesce(r.search_text, '')) like $8 escape '!'
           and core.level_for($2, r.tenant_id, r.id, r.ancestors) >= 1
         order by r.updated_at desc
         limit $9"
    } else {
        "select r.id, r.plugin_id, r.kind, r.title, coalesce(r.search_text, ''),
                coalesce(nullif(u.display_name, ''), u.username), r.updated_at
         from core.resources r join core.users u on u.id = r.owner_id
         where r.tenant_id = $1 and not core.in_trash(r.id)
           and (r.search_vec @@ to_tsquery('simple', $3)
                or (r.title ilike $4 escape '!' and r.title ilike $5 escape '!' and r.title ilike $6 escape '!'
                    and r.title ilike $7 escape '!' and r.title ilike $8 escape '!'))
           and r.id in (select v.id from core.levels_for($2, $1) v)
         order by ts_rank(r.search_vec, to_tsquery('simple', $3)) desc, r.updated_at desc
         limit $9"
    };
    let rows = mosaikit_db::query(sql)
        .bind(c.tenant.tenant_id)
        .bind(c.user.user_id)
        .bind(tsquery(&words))
        .bind(likes[0].as_str())
        .bind(likes[1].as_str())
        .bind(likes[2].as_str())
        .bind(likes[3].as_str())
        .bind(likes[4].as_str())
        .bind(MAX_ROWS)
        .fetch_all(&k.db)
        .await?;

    let mut by_plugin: BTreeMap<String, Vec<Hit>> = BTreeMap::new();
    let mut seen = HashSet::new();
    for r in &rows {
        let plugin: String = r.get(1);
        if !usable.contains(&plugin) {
            continue;
        }
        let id: Uuid = r.get(0);
        seen.insert(id);
        let title: String = r.get(3);
        let text: String = r.get(4);
        let in_title = words.iter().all(|w| title.to_lowercase().contains(w.as_str()));
        by_plugin.entry(plugin).or_default().push(Hit {
            id,
            kind: r.get(2),
            title,
            snippet: if in_title { String::new() } else { snippet(&text, &words) },
            owner_name: r.get(5),
            updated_at: r.get(6),
        });
    }

    // results of the plugins with a search command, checked like the others
    for pid in &usable {
        let Ok(p) = k.plugins.active(pid) else { continue };
        let Some(sd) = p.manifest.search.clone() else { continue };
        if p.module.is_none() {
            continue;
        }
        let out = match crate::crud::call(k, c, pid, &sd.command, json!({ "q": q })).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("search command of {pid}: {e}");
                continue;
            }
        };
        let found: Vec<(Uuid, String)> = out
            .get("results")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|x| {
                let id = x.get("id").and_then(Value::as_str).and_then(|s| s.parse::<Uuid>().ok())?;
                let snip =
                    x.get("snippet").and_then(Value::as_str).unwrap_or_default().chars().take(160).collect();
                Some((id, snip))
            })
            .filter(|(id, _)| !seen.contains(id))
            .take(PER_PLUGIN)
            .collect();
        for (id, snip) in found {
            if let Some(hit) = visible(k, c, pid, id, snip).await? {
                seen.insert(id);
                by_plugin.entry(pid.clone()).or_default().push(hit);
            }
        }
    }

    let mut groups: Vec<Group> = by_plugin
        .into_iter()
        .filter_map(|(pid, mut items)| {
            let p = k.plugins.active(&pid).ok()?;
            let m = p.manifest.localized(lang);
            let count = items.len();
            items.truncate(PER_PLUGIN);
            Some(Group {
                plugin_id: pid,
                label: m.contribution.label.clone(),
                icon: m.icon.clone(),
                count,
                items,
            })
        })
        .collect();
    groups.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.label.cmp(&b.label)));
    Ok(groups)
}

/// An item a plugin's search command returned, if the caller can see it (same rules as the rest).
async fn visible(k: &Kernel, c: &Caller, plugin: &str, id: Uuid, snippet: String) -> Result<Option<Hit>> {
    let row = mosaikit_db::query(
        "select r.kind, r.title, coalesce(nullif(u.display_name, ''), u.username), r.updated_at
         from core.resources r join core.users u on u.id = r.owner_id
         where r.id = $1 and r.tenant_id = $2 and r.plugin_id = $3 and not core.in_trash(r.id)
           and core.level_for($4, r.tenant_id, r.id, r.ancestors) >= 1",
    )
    .bind(id)
    .bind(c.tenant.tenant_id)
    .bind(plugin)
    .bind(c.user.user_id)
    .fetch_optional(&k.db)
    .await?;
    Ok(row.map(|r| Hit {
        id,
        kind: r.get(0),
        title: r.get(1),
        snippet,
        owner_name: r.get(2),
        updated_at: r.get(3),
    }))
}

/// A tenant or a person found by the Administrator.
#[derive(Debug, Clone, Serialize)]
pub struct AdminHit {
    pub id: Uuid,
    pub name: String,
    /// slug of the tenant, or username and home tenant of the person
    pub sub: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminResults {
    pub tenants: Vec<AdminHit>,
    pub people: Vec<AdminHit>,
}

/// The search of the Administrator: tenants (name, slug) and people (name, username, email).
pub async fn admin_search(k: &Kernel, admin: &SessionUser, q: &str) -> Result<AdminResults> {
    crate::tenancy::require_admin(admin)?;
    let q = q.trim();
    if q.chars().count() < 2 {
        return Ok(AdminResults { tenants: Vec::new(), people: Vec::new() });
    }
    let like = format!("%{}%", crate::util::like_escape(q));
    let tenants = mosaikit_db::query(
        "select id, name, slug from core.tenants
         where not is_system and (name ilike $1 escape '\\' or slug ilike $1 escape '\\')
         order by name limit 20",
    )
    .bind(like.as_str())
    .fetch_all(&k.db)
    .await?
    .iter()
    .map(|r| AdminHit { id: r.get(0), name: r.get(1), sub: r.get(2) })
    .collect();
    let people = mosaikit_db::query(
        "select u.id, coalesce(nullif(u.display_name, ''), u.username), u.username || ' · ' || t.name
         from core.users u join core.tenants t on t.id = u.home_tenant_id
         where not u.is_system_admin and (u.username ilike $1 escape '\\' or u.display_name ilike $1 escape '\\'
                                          or coalesce(u.email, '') ilike $1 escape '\\')
         order by 2 limit 20",
    )
    .bind(like.as_str())
    .fetch_all(&k.db)
    .await?
    .iter()
    .map(|r| AdminHit { id: r.get(0), name: r.get(1), sub: r.get(2) })
    .collect();
    Ok(AdminResults { tenants, people })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_and_queries() {
        assert_eq!(words("  Site visit, north-depot! a "), vec!["site", "visit", "north", "depot"]);
        assert_eq!(tsquery(&words("Acc ré")), "acc:* & ré:*");
        assert!(words("a ! ?").is_empty());
        assert_eq!(words("one two three four five six").len(), 5);
    }

    #[test]
    fn snippets() {
        let text = "Introduction. The north depot needs another look before the end of the month.";
        assert_eq!(snippet(text, &words("depot")), text);
        let long = format!("{} needle here", "x ".repeat(100));
        let s = snippet(&long, &words("needle"));
        assert!(s.starts_with('…') && s.contains("needle"));
        assert_eq!(snippet("nothing", &words("zzz")), "");
    }
}
