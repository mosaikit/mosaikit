//! Pages of the long lists (people, tenants, groups, items): a page of rows, how many match the filter
//! in all and the cursor of the next page. The cursor is a key of the order of the list (keyset), not an
//! offset: a page costs the same however deep it is, and rows added meanwhile do not shift it.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{Error, Result};

/// Default and largest number of rows of a page.
pub const DEFAULT: i64 = 50;
pub const MAX: i64 = 500;

/// The query of a page: `limit` turns paging on (without it the lists answer whole, as before).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PageQuery {
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub cursor: Option<String>,
    /// words in the names (and in the other columns each list names)
    #[serde(default)]
    pub q: Option<String>,
}

impl PageQuery {
    pub fn limit(&self) -> i64 {
        self.limit.unwrap_or(DEFAULT).clamp(1, MAX)
    }
    /// `%words%` for `ilike`, if any.
    pub fn like(&self) -> Option<String> {
        self.q
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
            .map(|q| format!("%{}%", crate::util::like_escape(q)))
    }
    /// The key of the last row of the previous page: `(text, id)`.
    pub fn after(&self) -> Result<Option<(String, Uuid)>> {
        self.cursor.as_deref().filter(|c| !c.is_empty()).map(parse).transpose()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    /// rows matching the filter in all
    pub total: i64,
    /// cursor of the next page (none on the last one)
    pub next: Option<String>,
}

/// The cursor after a row whose key in the order is `(text, id)`.
pub fn cursor(text: &str, id: Uuid) -> String {
    format!("{text}|{id}")
}

fn parse(c: &str) -> Result<(String, Uuid)> {
    let (text, id) = c.rsplit_once('|').ok_or_else(|| Error::bad("invalid cursor"))?;
    let id = Uuid::parse_str(id).map_err(|_| Error::bad("invalid cursor"))?;
    if text.len() > 512 {
        return Err(Error::bad("invalid cursor"));
    }
    Ok((text.to_string(), id))
}

/// A page from rows fetched with `limit + 1`: the extra row says there is a next page.
pub fn page<T>(mut items: Vec<T>, limit: i64, total: i64, key: impl Fn(&T) -> (String, Uuid)) -> Page<T> {
    let next = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|x| {
            let (t, id) = key(x);
            cursor(&t, id)
        })
    } else {
        None
    };
    Page { items, total, next }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursors_round_trip() {
        let id = Uuid::new_v4();
        let q = PageQuery { cursor: Some(cursor("a|b", id)), ..PageQuery::default() };
        assert_eq!(q.after().unwrap(), Some(("a|b".to_string(), id)));
        assert!(PageQuery { cursor: Some("nothing".into()), ..PageQuery::default() }.after().is_err());
        assert_eq!(PageQuery { limit: Some(10_000), ..PageQuery::default() }.limit(), MAX);
        assert_eq!(PageQuery::default().limit(), DEFAULT);
    }

    #[test]
    fn a_page_knows_whether_more_follow() {
        let ids: Vec<Uuid> = (0..3).map(|_| Uuid::new_v4()).collect();
        let p = page(ids.clone(), 2, 3, |id| ("x".to_string(), *id));
        assert_eq!(p.items.len(), 2);
        assert_eq!(p.next, Some(cursor("x", ids[1])));
        let p = page(ids, 5, 3, |id| ("x".to_string(), *id));
        assert_eq!(p.next, None);
    }
}
