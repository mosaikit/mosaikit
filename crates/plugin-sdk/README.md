# mosaikit-plugin-sdk

Write the logic of a [Mosaikit](https://github.com/mosaikit) plugin in Rust: commands, hooks and access to the
database, the resources, outside services and notifications, compiled to WebAssembly (`wasm32-unknown-unknown`).

```rust
use mosaikit_plugin_sdk::prelude::*;

fn before_create(ctx: &Ctx, hook: &Hook) -> Result<Option<Values>> {
    let mut v = hook.values.clone();
    if v.str("tag").is_empty() { v.set("tag", "personal"); }
    ctx.log("default tag applied");
    Ok(Some(v))
}

fn lock(_ctx: &Ctx, _args: Value) -> Result<Value> {
    // the code reaches the UI of the plugin as `BridgeError.code`
    Err(Error::coded("invoice_locked", "The invoice is closed"))
}

mosaikit_plugin_sdk::plugin! {
    hooks: { "notes.before_create" => before_create },
    commands: { "notes.lock" => lock },
}
```

Test the logic natively with `mosaikit_plugin_sdk::testing::MockHost` (a simulated host).

## Versions

- This crate implements **plugin API 1**: a plugin declares it in `plugin.toml` with `[requires] api = 1`, together
  with the versions of Mosaikit it works with, `mosaikit = ">=1.2, <2"`.
- The crate has its own version (see [CHANGELOG.md](CHANGELOG.md)). A minor version adds, a patch fixes; a
  breaking change raises the plugin API and the major version of the crate together.
- **Deprecation rule.** A deprecated item stays for one major version, is marked `#[deprecated]` with what
  replaces it, and is removed in the next major version.
- `Ctx` is `#[non_exhaustive]` (build one with `Ctx::default()`); `abi`, `Registry` and the plumbing of `plugin!`
  are `#[doc(hidden)]` and not part of the API.
- Experimental, until an official sample uses them: `Resources::create`, `Resources::delete`.

The matching UI package is `@mosaikit/plugin-api`. Documentation: `docs/architecture.md` §8 of the Mosaikit repository.
