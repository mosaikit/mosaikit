//! EXAMPLE 1 - logic of the to-do list (WASM, wasmi sandbox).
//!
//! The logic is small on purpose: the kernel and `mountCrud` already do the CRUD. What is left for the plugin is
//! what only it knows: the rules of a task.
//!
//! - a hook runs before a task is saved (`before_create`, `before_update`): it cleans the values, fills a
//!   default or refuses the save with a message that the form shows;
//! - a command is called by the UI with `msk.call("<name>", args)`.

use mosaikit_plugin_sdk::prelude::*;

/// Rules of a task, applied before it is created and before it is updated.
fn before_save(_ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    let title = v.str("title").trim().to_string();
    if title.is_empty() {
        // `coded` gives the UI a stable code to branch on; the text is for the person
        return Err(Error::coded("title_required", "a task needs a title"));
    }
    v.set("title", title);
    // a task without a priority is a medium one
    if v.str("priority").is_empty() {
        v.set("priority", "medium");
    }
    Ok(Some(v))
}

/// Command `{{table}}.counts`: how many tasks are open, done and late for the person who asks. The database
/// answers only with the rows the person may see (row-level security), so there is no check to write here.
fn counts(ctx: &Ctx, _args: Value) -> Result<Value> {
    let row = ctx.db().query_one(
        "select count(*) filter (where not coalesce(done, false)) as open,
                count(*) filter (where coalesce(done, false)) as done,
                count(*) filter (where not coalesce(done, false) and due < current_date) as overdue
         from {{table}}",
        &[],
    )?;
    Ok(row.unwrap_or_else(|| json!({ "open": 0, "done": 0, "overdue": 0 })))
}

// Registers the hooks and the commands: the host finds them by name.
mosaikit_plugin_sdk::plugin! {
    hooks: { "{{table}}.before_create" => before_save, "{{table}}.before_update" => before_save },
    commands: { "{{table}}.counts" => counts },
}

// Tests of the logic run natively, with a mock host: `cargo test` (or `mosaikit-plugin test`).
#[cfg(test)]
mod tests {
    use super::*;
    use mosaikit_plugin_sdk::testing::MockHost;

    #[test]
    fn a_task_needs_a_title() {
        let host = MockHost::new();
        let r = host.hook(&__msk_registry(), "before_create", "{{table}}", json!({ "title": "   " }));
        assert!(r.is_err());
    }

    #[test]
    fn the_title_is_trimmed_and_the_priority_defaults_to_medium() {
        let host = MockHost::new();
        let v = host
            .hook(&__msk_registry(), "before_create", "{{table}}", json!({ "title": "  Buy milk " }))
            .unwrap()
            .unwrap();
        assert_eq!(v.str("title"), "Buy milk");
        assert_eq!(v.str("priority"), "medium");
        // a priority the person chose stays
        let v = host
            .hook(&__msk_registry(), "before_update", "{{table}}", json!({ "title": "x", "priority": "high" }))
            .unwrap()
            .unwrap();
        assert_eq!(v.str("priority"), "high");
    }

    #[test]
    fn counts_come_from_the_database() {
        // `on` answers a host operation; the real one would run the SQL in the schema of the plugin
        let host = MockHost::new().on("db.query", |_| Ok(json!([{ "open": 3, "done": 1, "overdue": 1 }])));
        let r = host.command(&__msk_registry(), "{{table}}.counts", json!({})).unwrap();
        assert_eq!(r["open"], 3);
    }
}
