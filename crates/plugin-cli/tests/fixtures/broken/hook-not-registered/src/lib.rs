use mosaikit_plugin_sdk::prelude::*;

fn welcome(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    ctx.notify(&Notice::new("Created"))?;
    Ok(None)
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "other.after_create" => welcome },
    commands: {},
}
