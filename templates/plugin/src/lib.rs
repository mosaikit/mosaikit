//! Logica del plugin {{label}} (WASM, sandbox wasmi).
//!
//! - gli hook ricevono i valori di un record prima di salvarli: possono modificarli
//!   (`Ok(Some(v))`), lasciarli invariati (`Ok(None)`) o rifiutarli (`Err`);
//! - i comandi si chiamano dalla UI con `msk.call("{{table}}.riepilogo", args)`;
//! - `ctx.db()` esegue SQL sul proprio schema: la Row-Level Security filtra le righe.

use mosaikit_plugin_sdk::prelude::*;

fn before_save(_ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    let title = v.str("title").trim().to_string();
    if title.len() < 3 {
        return Err(Error::msg("il titolo deve avere almeno 3 caratteri"));
    }
    v.set("title", title);
    if v.str("status").is_empty() {
        v.set("status", "bozza");
    }
    Ok(Some(v))
}

fn riepilogo(ctx: &Ctx, _args: Value) -> Result<Value> {
    let rows = ctx.db().query(
        "select coalesce(status, '(nessuno)') as stato, count(*)::int as n from {{table}} group by 1 order by 2 desc",
        &[],
    )?;
    Ok(Value::Array(rows))
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "{{table}}.before_create" => before_save, "{{table}}.before_update" => before_save },
    commands: { "{{table}}.riepilogo" => riepilogo },
}

#[cfg(test)]
mod tests {
    use super::*;
    use mosaikit_plugin_sdk::testing::MockHost;

    #[test]
    fn stato_di_default_e_validazione() {
        let host = MockHost::new();
        let v = host.hook(&__msk_registry(), "before_create", "{{table}}", json!({ "title": "  prova  " })).unwrap().unwrap();
        assert_eq!(v.str("title"), "prova");
        assert_eq!(v.str("status"), "bozza");
        assert!(host.hook(&__msk_registry(), "before_create", "{{table}}", json!({ "title": "x" })).is_err());
    }

    #[test]
    fn riepilogo_usa_il_database() {
        let host = MockHost::new().on("db.query", |_| Ok(json!([{ "stato": "bozza", "n": 2 }])));
        assert_eq!(host.command(&__msk_registry(), "{{table}}.riepilogo", json!({})).unwrap()[0]["n"], 2);
    }
}
