// A logic as the conformance tests read it: the file is scanned, never compiled.
use mosaikit_plugin_sdk::prelude::*;

fn welcome(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    ctx.notify(&Notice::new("Created"))?;
    Ok(None)
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "items.after_create" => welcome },
    commands: {},
}
