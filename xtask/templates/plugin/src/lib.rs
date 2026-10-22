//! Logic of the plugin {{label}} (WASM, wasmi sandbox).
//!
//! - hooks receive the values of a record before they are saved: they can change them
//!   (`Ok(Some(v))`), leave them as they are (`Ok(None)`) or refuse them (`Err`);
//! - commands are called from the UI with `msk.call("{{table}}.summary", args)`;
//! - `ctx.db()` runs SQL on the schema of the plugin: Row-Level Security filters the rows.

use mosaikit_plugin_sdk::prelude::*;

fn before_save(_ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    let title = v.str("title").trim().to_string();
    if title.len() < 3 {
        return Err(Error::msg("the title must have at least 3 characters"));
    }
    v.set("title", title);
    if v.str("status").is_empty() {
        v.set("status", "draft");
    }
    Ok(Some(v))
}

fn summary(ctx: &Ctx, _args: Value) -> Result<Value> {
    let rows = ctx.db().query(
        "select coalesce(status, '(none)') as status, count(*)::int as n from {{table}} group by 1 order by 2 desc",
        &[],
    )?;
    Ok(Value::Array(rows))
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "{{table}}.before_create" => before_save, "{{table}}.before_update" => before_save },
    commands: { "{{table}}.summary" => summary },
}

#[cfg(test)]
mod tests {
    use super::*;
    use mosaikit_plugin_sdk::testing::MockHost;

    #[test]
    fn default_state_and_validation() {
        let host = MockHost::new();
        let v = host.hook(&__msk_registry(), "before_create", "{{table}}", json!({ "title": "  trial  " })).unwrap().unwrap();
        assert_eq!(v.str("title"), "trial");
        assert_eq!(v.str("status"), "draft");
        assert!(host.hook(&__msk_registry(), "before_create", "{{table}}", json!({ "title": "x" })).is_err());
    }

    #[test]
    fn summary_uses_the_database() {
        let host = MockHost::new().on("db.query", |_| Ok(json!([{ "status": "draft", "n": 2 }])));
        assert_eq!(host.command(&__msk_registry(), "{{table}}.summary", json!({})).unwrap()[0]["n"], 2);
    }
}
