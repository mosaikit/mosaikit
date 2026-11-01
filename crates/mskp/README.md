# mosaikit-mskp

The format of Mosaikit plugin packages (`.mskp`, format 3): the manifest (`plugin.toml`) and its validation, the
package (a zip with a hash of every file), the ed25519 signature and the list of trusted keys, version ranges.

It is the library behind `mosaikit-plugin` (the plugin developer's tool) and the Mosaikit server. Use it to read or
check a package from your own tools:

```rust
let pkg = mosaikit_mskp::Package::read(&bytes)?;   // checks the hashes of the files
let signed_by = pkg.verify(&trusted_keys, false)?; // checks the signature against your keys
```

Install the command-line tool, not this crate, to build and sign plugins: `cargo install mosaikit-plugin-cli`.

Licence: Apache-2.0. Changes: [CHANGELOG.md](CHANGELOG.md).
