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
    /// the column to sort by (one of the sortable columns each list names); without it the list keeps its own order
    #[serde(default)]
    pub sort: Option<String>,
    /// `asc` (default) or `desc`
    #[serde(default)]
    pub dir: Option<String>,
}

/// A list sorted by a column of the user's choice: the `order by` text (built only from the fixed
/// expressions of the allow-list) and where the page starts.
#[derive(Debug, Clone)]
pub struct Sorted {
    pub order: String,
    pub offset: i64,
}

impl PageQuery {
    /// The sort asked for, checked against the allow-list `(field, sql expression)`; `tie` is the unique
    /// key that makes the order total (`t.id`). None: no sort asked, the list keeps its keyset order. A
    /// sorted list pages by offset (`~<n>` cursors), because the sort key is not unique or may be null.
    pub fn sorted(&self, allowed: &[(&str, &str)], tie: &str) -> Result<Option<Sorted>> {
        let Some(field) = self.sort.as_deref().filter(|s| !s.is_empty()) else {
            return Ok(None);
        };
        let expr = allowed
            .iter()
            .find(|(f, _)| *f == field)
            .map(|(_, e)| *e)
            .ok_or_else(|| Error::bad(format!("cannot sort by {field}")).with_code("sort_unknown"))?;
        let dir = match self.dir.as_deref().unwrap_or("asc") {
            "asc" | "" => "asc",
            "desc" => "desc",
            _ => return Err(Error::bad("invalid sort direction").with_code("sort_unknown")),
        };
        let offset = match self.cursor.as_deref().filter(|c| !c.is_empty()) {
            None => 0,
            Some(c) => c
                .strip_prefix('~')
                .and_then(|n| n.parse::<i64>().ok())
                .filter(|n| *n >= 0)
                .ok_or_else(|| Error::bad("invalid cursor"))?,
        };
        Ok(Some(Sorted { order: format!("{expr} {dir} nulls last, {tie}"), offset }))
    }
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
        self.cursor.as_deref().filter(|c| !c.is_empty() && !c.starts_with('~')).map(parse).transpose()
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

/// A page of a sorted list (rows fetched with `limit + 1` from `offset`): the next cursor is the next offset.
pub fn page_sorted<T>(mut items: Vec<T>, limit: i64, total: i64, offset: i64) -> Page<T> {
    let next = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        Some(format!("~{}", offset + limit))
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
    fn sorts_are_checked_against_the_allow_list() {
        let allowed = [("name", "lower(t.name)"), ("created", "t.created_at")];
        let q = |sort: &str, dir: Option<&str>, cursor: Option<&str>| PageQuery {
            sort: Some(sort.into()),
            dir: dir.map(Into::into),
            cursor: cursor.map(Into::into),
            ..PageQuery::default()
        };
        assert!(PageQuery::default().sorted(&allowed, "t.id").unwrap().is_none());
        let s = q("created", Some("desc"), Some("~50")).sorted(&allowed, "t.id").unwrap().unwrap();
        assert_eq!(s.order, "t.created_at desc nulls last, t.id");
        assert_eq!(s.offset, 50);
        let e = q("1; drop table x", None, None).sorted(&allowed, "t.id").unwrap_err();
        assert_eq!(e.code(), "sort_unknown");
        assert!(q("name", Some("up"), None).sorted(&allowed, "t.id").is_err());
        assert!(q("name", None, Some("abc|1")).sorted(&allowed, "t.id").is_err());
        assert_eq!(PageQuery { cursor: Some("~10".into()), ..PageQuery::default() }.after().unwrap(), None);
        let p = page_sorted(vec![1, 2, 3], 2, 9, 4);
        assert_eq!(p.next.as_deref(), Some("~6"));
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
