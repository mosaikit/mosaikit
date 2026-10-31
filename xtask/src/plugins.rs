//! Plugins of the repository: the ones of the active distribution, and the data reset.
//!
//! The work itself (build, packages, scaffolding, keys) is the crate `mosaikit-plugin-cli`, which this module only
//! calls: the same code serves `cargo xtask plugin ...` and the `mosaikit-plugin` executable.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

pub use mosaikit_plugin_cli::project::{
    build_ui, build_wasm, cargo_roots, ensure_npm_in, npm_roots, npm_ui, Plugin,
};

use crate::util::{exe, output, pg_bin, root};

/// Plugins of the folders of the active distribution (only the included ones).
pub fn discover() -> Result<Vec<Plugin>> {
    let d = crate::dist::current();
    let mut out = Vec::new();
    for base in &d.plugins.roots {
        let rd = std::fs::read_dir(base).with_context(|| {
            format!("plugin folder {} (see [plugins] roots in distribution.toml)", base.display())
        })?;
        let mut dirs: Vec<PathBuf> =
            rd.flatten().map(|e| e.path()).filter(|p| p.join("plugin.toml").is_file()).collect();
        dirs.sort();
        for dir in dirs {
            let plugin = Plugin::load(&dir)?;
            if !d.includes(&plugin.id) {
                continue;
            }
            out.push(plugin);
        }
    }
    for want in &d.plugins.include {
        if want != "*" && !out.iter().any(|p| &p.id == want) {
            bail!("plugin {want} listed in distribution.toml but not found in the plugin folders");
        }
    }
    Ok(out)
}

/// cargo `target` of the mosaikit workspace (server, xtask).
pub fn target_dir() -> PathBuf {
    std::env::var_os("CARGO_TARGET_DIR").map(PathBuf::from).unwrap_or_else(|| root().join("target"))
}

/// `npm install` of mosaikit (host UI, plugin-api, e2e).
pub fn ensure_npm() -> Result<()> {
    ensure_npm_in(&root())
}

/// Signing key of the repository: the environment, else the development key `.dev/signing.key`.
pub fn signing_key() -> Result<(ed25519_dalek::SigningKey, String)> {
    mosaikit_plugin_cli::package::signing_key(None, &root().join(".dev").join("signing.key"))
}

pub fn keygen(out: Option<PathBuf>) -> Result<()> {
    let (private, public) = mosaikit_plugin_cli::package::keygen(out.as_deref())?;
    match out {
        Some(p) => println!("private key saved in {}", p.display()),
        None => println!("private key (MOSAIKIT_SIGNING_KEY): {private}"),
    }
    println!("public key (trusted_keys):            {public}");
    Ok(())
}

/// Packages of every plugin + `index.json` of the registry in `out`.
pub fn pack_all(plugins: &[Plugin], release: bool, out: &Path) -> Result<PathBuf> {
    let (key, source) = signing_key()?;
    eprintln!("signing the packages with: {source}");
    mosaikit_plugin_cli::package::pack_registry(plugins, release, out, &key)
}

/// New plugin from the template, in the first plugin folder of the distribution (or in `into`), added to the
/// Cargo and npm workspaces of that folder.
pub fn new_plugin(name: &str, id: Option<String>, no_logic: bool, into: Option<PathBuf>) -> Result<()> {
    let base = match into {
        Some(d) => d,
        None => crate::dist::current().plugins.roots.first().cloned().context("no plugin folder")?,
    };
    let dir = mosaikit_plugin_cli::scaffold::new_plugin(&mosaikit_plugin_cli::scaffold::NewOptions {
        name: name.to_string(),
        id,
        no_logic,
        into: base,
        plugin_api_path: Some(root().join("ui").join("plugin-api")),
        install: true,
        ..Default::default()
    })?;
    println!(
        "
plugin created in {}
  `cargo xtask dev` loads it in development (if the distribution includes it)",
        dir.display()
    );
    Ok(())
}
// ------------------------------------------------------------------ reset of the development data

/// Same name as `mosaikit_db::Db::plugin_role`.
fn plugin_role(prefix: &str, id: &str) -> String {
    let hash = hex::encode(&Sha256::digest(id.as_bytes())[..4]);
    let last: String = id
        .rsplit('.')
        .next()
        .unwrap_or("p")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .take(16)
        .collect();
    let mut name = format!("{prefix}_p_{last}_{hash}");
    name.truncate(63);
    name
}

/// Deletes schema, role and resources of a plugin from the development database.
pub fn db_reset(id: &str) -> Result<()> {
    let bin = pg_bin().context("psql not found (MOSAIKIT_PG_BIN)")?;
    let schema = mosaikit_mskp::schema_name(id);
    let role = plugin_role("msk_mosaikit", id);
    let sql = format!(
        "delete from core.plugins where id = '{id}'; drop schema if exists \"{schema}\" cascade; \
         do $$ begin if exists (select 1 from pg_roles where rolname = '{role}') then execute 'drop owned by \"{role}\"'; execute 'drop role \"{role}\"'; end if; end $$;"
    );
    output(
        Command::new(bin.join(exe("psql")))
            .args(["-v", "ON_ERROR_STOP=1", "-d"])
            .arg(crate::db::dev_url())
            .args(["-c", &sql]),
    )?;
    println!("data of {id} reset: at the next start of `cargo xtask dev` the schema is created again");
    Ok(())
}
