//! EXAMPLE 2 - logic of the expenses plugin.
//!
//! Three things the UI cannot do alone:
//! - a hook that refuses what makes no sense (an amount that is not positive);
//! - the command `by_category`, which adds up in the database what the overview page draws;
//! - the command of the search (`[search]` of the manifest, a plain name without dots): extra results for the search box of the shell.

use mosaikit_plugin_sdk::prelude::*;

fn before_save(_ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let v = hook.values.clone();
    match v.f64("amount") {
        Some(a) if a > 0.0 => Ok(Some(v)),
        _ => Err(Error::coded("amount_invalid", "the amount must be more than zero")),
    }
}

/// The totals by category: `[{ "category": "food", "total": 42.5, "items": 3 }, ...]`, the biggest first.
/// The queries of a plugin run with the security context of the person who calls: row-level security keeps
/// only the rows the person may see, so each person (or tenant manager) gets their own totals.
fn by_category(ctx: &Ctx, _args: Value) -> Result<Value> {
    let rows = ctx.db().query(
        "select coalesce(category, 'other') as category, sum(amount) as total, count(*) as items
         from {{table}} group by 1 order by 2 desc",
        &[],
    )?;
    Ok(Value::Array(rows))
}

/// The search command receives `{ "q": "..." }` and answers `{ "results": [{ "id", "snippet" }] }`.
/// `id` is the id of a resource: the shell opens it when the result is chosen. The parameters `$1..$n` are
/// never put into the SQL text: they are sent apart, so there is nothing to escape.
fn find(ctx: &Ctx, args: Value) -> Result<Value> {
    let q = args["q"].as_str().unwrap_or("").trim().to_lowercase();
    if q.chars().count() < 2 {
        return Ok(json!({ "results": [] }));
    }
    let like = format!("%{q}%");
    let rows = ctx.db().query(
        "select resource_id::text as id, title || ' - ' || coalesce(category, 'other') as snippet
         from {{table}} where lower(category) like $1 order by spent_on desc limit 20",
        &[json!(like)],
    )?;
    Ok(json!({ "results": rows }))
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "{{table}}.before_create" => before_save, "{{table}}.before_update" => before_save },
    commands: { "{{table}}.by_category" => by_category, "find" => find },
}

#[cfg(test)]
mod tests {
    use super::*;
    use mosaikit_plugin_sdk::testing::MockHost;

    #[test]
    fn the_amount_must_be_positive() {
        let host = MockHost::new();
        let reg = __msk_registry();
        assert!(host.hook(&reg, "before_create", "{{table}}", json!({ "title": "x", "amount": 0 })).is_err());
        assert!(host.hook(&reg, "before_create", "{{table}}", json!({ "title": "x" })).is_err());
        assert!(host.hook(&reg, "before_create", "{{table}}", json!({ "title": "x", "amount": 5.5 })).is_ok());
    }

    #[test]
    fn totals_come_from_the_database() {
        let host = MockHost::new()
            .on("db.query", |_| Ok(json!([{ "category": "food", "total": 42.5, "items": 3 }])));
        let r = host.command(&__msk_registry(), "{{table}}.by_category", json!({})).unwrap();
        assert_eq!(r[0]["category"], "food");
    }

    #[test]
    fn a_short_search_asks_nothing_and_a_long_one_sends_the_text_as_a_parameter() {
        let host = MockHost::new().on("db.query", |_| Ok(json!([{ "id": "1", "snippet": "Lunch - food" }])));
        let reg = __msk_registry();
        let none = host.command(&reg, "find", json!({ "q": "f" })).unwrap();
        assert_eq!(none["results"].as_array().unwrap().len(), 0);
        assert!(host.calls().is_empty());
        let found = host.command(&reg, "find", json!({ "q": "Food" })).unwrap();
        assert_eq!(found["results"][0]["id"], "1");
        let calls = host.calls();
        let (op, req) = &calls[0];
        assert_eq!(op, "db.query");
        assert_eq!(req["params"][0], "%food%");
    }
}
