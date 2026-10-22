//! Plugins of the repository: build (WASM and UI), signed packages, scaffolding, data reset.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::util::{exe, npm, output, pg_bin, root, run};

/// A plugin of one of the folders of the distribution.
#[derive(Debug, Clone)]
pub struct Plugin {
    pub dir: PathBuf,
    pub id: String,
    pub version: String,
    /// name of the crate, if the plugin has WASM logic
    pub crate_name: Option<String>,
    pub has_ui: bool,
    /// Cargo workspace that contains the crate (ancestor folder with `[workspace]`)
    pub cargo_root: Option<PathBuf>,
    /// npm workspace that contains the UI (ancestor folder with `workspaces`)
    pub npm_root: Option<PathBuf>,
}

fn ancestor_with(dir: &Path, file: &str, marker: &str) -> Option<PathBuf> {
    dir.ancestors()
        .skip(1)
        .find(|a| std::fs::read_to_string(a.join(file)).is_ok_and(|t| t.contains(marker)))
        .map(Path::to_path_buf)
}

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
            let manifest =
                mosaikit_mskp::Manifest::from_toml(&std::fs::read_to_string(dir.join("plugin.toml"))?)
                    .with_context(|| format!("{}", dir.display()))?;
            if !d.includes(&manifest.id) {
                continue;
            }
            let crate_name = if dir.join("Cargo.toml").is_file() {
                let v: toml::Value = toml::from_str(&std::fs::read_to_string(dir.join("Cargo.toml"))?)?;
                v.get("package").and_then(|p| p.get("name")).and_then(|n| n.as_str()).map(str::to_string)
            } else {
                None
            };
            let has_ui = dir.join("ui").join("package.json").is_file();
            out.push(Plugin {
                cargo_root: crate_name
                    .as_ref()
                    .and_then(|_| ancestor_with(&dir, "Cargo.toml", "[workspace]")),
                npm_root: if has_ui {
                    ancestor_with(&dir.join("ui"), "package.json", "\"workspaces\"")
                } else {
                    None
                },
                has_ui,
                id: manifest.id,
                version: manifest.version,
                crate_name,
                dir,
            });
        }
    }
    for want in &d.plugins.include {
        if want != "*" && !out.iter().any(|p| &p.id == want) {
            bail!("plugin {want} listed in distribution.toml but not found in the plugin folders");
        }
    }
    Ok(out)
}

/// Distinct Cargo workspaces of the plugins.
pub fn cargo_roots(plugins: &[Plugin]) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = plugins.iter().filter_map(|p| p.cargo_root.clone()).collect();
    v.sort();
    v.dedup();
    v
}

/// Distinct npm roots of the UIs of the plugins.
pub fn npm_roots(plugins: &[Plugin]) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = plugins.iter().filter(|p| p.has_ui).map(|p| ui_workspace(p).0).collect();
    v.sort();
    v.dedup();
    v
}

/// cargo `target` of the mosaikit workspace (server, xtask).
pub fn target_dir() -> PathBuf {
    std::env::var_os("CARGO_TARGET_DIR").map(PathBuf::from).unwrap_or_else(|| root().join("target"))
}

pub fn wasm_path(p: &Plugin, release: bool) -> Option<PathBuf> {
    let name = p.crate_name.as_ref()?.replace('-', "_");
    let ws = p.cargo_root.clone().unwrap_or_else(|| p.dir.clone());
    Some(
        ws.join("target")
            .join("wasm32-unknown-unknown")
            .join(if release { "release" } else { "debug" })
            .join(format!("{name}.wasm")),
    )
}

/// Builds the WASM logic, one `cargo build` per plugin workspace.
pub fn build_wasm(plugins: &[Plugin], release: bool) -> Result<()> {
    let mut by_ws: BTreeMap<PathBuf, Vec<&String>> = BTreeMap::new();
    for p in plugins {
        if let (Some(c), Some(ws)) = (&p.crate_name, &p.cargo_root) {
            by_ws.entry(ws.clone()).or_default().push(c);
        } else if let Some(c) = &p.crate_name {
            bail!("{} ({c}) does not belong to any Cargo workspace", p.dir.display());
        }
    }
    for (ws, crates) in by_ws {
        let mut cmd = Command::new("cargo");
        cmd.current_dir(&ws).env_remove("CARGO_TARGET_DIR").args([
            "build",
            "--target",
            "wasm32-unknown-unknown",
        ]);
        if release {
            cmd.arg("--release");
        }
        for c in crates {
            cmd.args(["-p", c]);
        }
        run(&mut cmd)?;
    }
    Ok(())
}

/// `npm install` in the given root if node_modules is missing.
pub fn ensure_npm_in(dir: &Path) -> Result<()> {
    if !dir.join("node_modules").is_dir() {
        run(npm().current_dir(dir).args(["install", "--no-audit", "--no-fund"]))?;
    }
    Ok(())
}

/// npm of mosaikit (host UI, plugin-api, e2e).
pub fn ensure_npm() -> Result<()> {
    ensure_npm_in(&root())
}

/// (npm root, workspace name) of the UI of a plugin.
pub fn ui_workspace(p: &Plugin) -> (PathBuf, String) {
    let npm_root = p.npm_root.clone().unwrap_or_else(|| p.dir.join("ui"));
    let ws = p
        .dir
        .join("ui")
        .strip_prefix(&npm_root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    (npm_root, ws)
}

/// npm command for the UI of a plugin (`npm run <script> -w <ui>` in its npm root).
pub fn npm_ui(p: &Plugin, script: &str) -> Command {
    let (dir, ws) = ui_workspace(p);
    let mut c = npm();
    c.current_dir(&dir).args(["run", script]);
    if !ws.is_empty() {
        c.args(["-w", &ws]);
    }
    c
}

pub fn build_ui(plugins: &[Plugin]) -> Result<()> {
    for p in plugins.iter().filter(|p| p.has_ui) {
        ensure_npm_in(&ui_workspace(p).0)?;
        run(&mut npm_ui(p, "build"))?;
    }
    Ok(())
}
// ------------------------------------------------------------------ signing keys

/// Signing key: `MOSAIKIT_SIGNING_KEY` (base64), `MOSAIKIT_SIGNING_KEY_FILE`,
/// otherwise the local development key `.dev/signing.key` (created if missing).
pub fn signing_key() -> Result<(ed25519_dalek::SigningKey, &'static str)> {
    if let Ok(k) = std::env::var("MOSAIKIT_SIGNING_KEY") {
        return Ok((mosaikit_mskp::signing_key_from_b64(&k)?, "MOSAIKIT_SIGNING_KEY"));
    }
    if let Ok(f) = std::env::var("MOSAIKIT_SIGNING_KEY_FILE") {
        if Path::new(&f).is_file() {
            let k = std::fs::read_to_string(&f)?;
            return Ok((mosaikit_mskp::signing_key_from_b64(&k)?, "MOSAIKIT_SIGNING_KEY_FILE"));
        }
    }
    let path = root().join(".dev").join("signing.key");
    if !path.is_file() {
        std::fs::create_dir_all(path.parent().expect(".dev folder"))?;
        let k = mosaikit_mskp::generate_key();
        std::fs::write(&path, mosaikit_mskp::signing_key_to_b64(&k))?;
        eprintln!("created the development key {} (do not commit it)", path.display());
    }
    Ok((
        mosaikit_mskp::signing_key_from_b64(&std::fs::read_to_string(&path)?)?,
        "development key .dev/signing.key",
    ))
}

pub fn keygen(out: Option<PathBuf>) -> Result<()> {
    let k = mosaikit_mskp::generate_key();
    let private = mosaikit_mskp::signing_key_to_b64(&k);
    match out {
        Some(p) => {
            std::fs::write(&p, &private)?;
            println!("private key saved in {}", p.display());
        }
        None => println!("private key (MOSAIKIT_SIGNING_KEY): {private}"),
    }
    println!("public key (trusted_keys):            {}", mosaikit_mskp::public_key_b64(&k));
    Ok(())
}

// ------------------------------------------------------------------ packages

/// Creates `<out>/<id>-<version>.mskp`, signed. Returns (path, sha256).
pub fn pack(
    p: &Plugin,
    release: bool,
    key: &ed25519_dalek::SigningKey,
    out: &Path,
) -> Result<(PathBuf, String)> {
    let wasm = wasm_path(p, release);
    if let Some(w) = &wasm {
        if !w.is_file() {
            bail!("{}: {} not built (cargo xtask plugin build)", p.id, w.display());
        }
    }
    if p.has_ui && !p.dir.join("ui").join("dist").is_dir() {
        bail!("{}: UI not built (npm run build in {})", p.id, p.dir.join("ui").display());
    }
    let files: BTreeMap<String, Vec<u8>> = mosaikit_mskp::collect_plugin_dir(&p.dir, wasm.as_deref())?;
    let files: BTreeMap<String, Vec<u8>> = files.into_iter().filter(|(k, _)| !k.ends_with(".map")).collect();
    let bytes = mosaikit_mskp::pack(&files, Some(key))?;
    std::fs::create_dir_all(out)?;
    let path = out.join(format!("{}-{}.mskp", p.id, p.version));
    std::fs::write(&path, &bytes)?;
    Ok((path, mosaikit_mskp::package_sha256(&bytes)))
}

/// Packages of every plugin + `index.json` of the registry in `out`.
pub fn pack_all(plugins: &[Plugin], release: bool, out: &Path) -> Result<PathBuf> {
    let (key, source) = signing_key()?;
    eprintln!("signing the packages with: {source}");
    let pkgs = out.join("plugins");
    let mut entries = Vec::new();
    for p in plugins {
        let (path, sha) = pack(p, release, &key, &pkgs)?;
        let manifest =
            mosaikit_mskp::Manifest::from_toml(&std::fs::read_to_string(p.dir.join("plugin.toml"))?)?;
        eprintln!("  {} {} -> {}", p.id, p.version, path.display());
        // what changes in this version: RELEASE.md of the plugin, if it has one
        let notes = std::fs::read_to_string(p.dir.join("RELEASE.md"))
            .map(|s| s.trim().chars().take(4000).collect::<String>())
            .unwrap_or_default();
        entries.push(serde_json::json!({
            "id": p.id,
            "name": manifest.name,
            "description": manifest.description,
            "icon": manifest.contribution.icon,
            "versions": [{
                "version": p.version,
                "file": format!("plugins/{}", path.file_name().expect("nome file").to_string_lossy()),
                "sha256": sha,
                "publisher": mosaikit_mskp::public_key_b64(&key),
                "notes": notes,
                "kind": manifest.effective_kind().as_str(),
                "extends": manifest.extends.as_ref().map(|e| e.plugin.clone()),
            }],
        }));
    }
    let index = serde_json::json!({ "plugins": entries, "blocklist": [] });
    let path = out.join("index.json");
    std::fs::write(&path, serde_json::to_string_pretty(&index)?)?;
    std::fs::write(out.join("trusted_key.txt"), mosaikit_mskp::public_key_b64(&key))?;
    Ok(path)
}

// ------------------------------------------------------------------ new plugin

fn replace_all(s: &str, vars: &[(&str, &str)]) -> String {
    vars.iter().fold(s.to_string(), |acc, (k, v)| acc.replace(&format!("{{{{{k}}}}}"), v))
}

/// Relative path from `from` (folder) to `to`, with `/`.
pub fn relative(from: &Path, to: &Path) -> String {
    let norm = |p: &Path| -> Vec<String> {
        let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
        let mut v: Vec<String> = Vec::new();
        for c in abs.components() {
            match c {
                std::path::Component::ParentDir => {
                    v.pop();
                }
                std::path::Component::CurDir => {}
                other => v.push(other.as_os_str().to_string_lossy().to_lowercase()),
            }
        }
        v
    };
    let (a, b) = (norm(from), norm(to));
    let common = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let original: Vec<String> = {
        let abs = std::path::absolute(to).unwrap_or_else(|_| to.to_path_buf());
        let mut v: Vec<String> = Vec::new();
        for c in abs.components() {
            match c {
                std::path::Component::ParentDir => {
                    v.pop();
                }
                std::path::Component::CurDir => {}
                other => v.push(other.as_os_str().to_string_lossy().to_string()),
            }
        }
        v
    };
    let mut parts: Vec<String> = std::iter::repeat_n("..".to_string(), a.len() - common).collect();
    parts.extend(original[common..].iter().cloned());
    parts.join("/")
}

/// New plugin from the template, in the first plugin folder of the distribution
/// (or in `into`), added to the Cargo and npm workspaces of that folder.
pub fn new_plugin(name: &str, id: Option<String>, no_logic: bool, into: Option<PathBuf>) -> Result<()> {
    if !mosaikit_mskp::is_identifier(&name.replace('-', "_")) || name.contains('_') {
        bail!("invalid name: lower case, digits and '-' (e.g. weather, road-registry)");
    }
    let base = match into {
        Some(d) => d,
        None => crate::dist::current().plugins.roots.first().cloned().context("no plugin folder")?,
    };
    let dir = base.join(name);
    if dir.exists() {
        bail!("{} already exists", dir.display());
    }
    let id = id.unwrap_or_else(|| format!("com.example.{name}"));
    if !mosaikit_mskp::is_plugin_id(&id) {
        bail!("invalid id: {id} (e.g. com.company.{name})");
    }
    let label = {
        let mut c = name.chars();
        c.next()
            .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
            .unwrap_or_default()
            .replace('-', " ")
    };
    let table = name.replace('-', "_");
    let api = relative(&dir.join("ui"), &root().join("ui").join("plugin-api"));
    let vars = [
        ("id", id.as_str()),
        ("name", name),
        ("label", label.as_str()),
        ("table", table.as_str()),
        ("plugin_api", api.as_str()),
    ];
    let template = root().join("xtask").join("templates").join("plugin");
    for (rel, path) in crate::util::walk_files(&template)? {
        if no_logic && (rel == "Cargo.toml" || rel.starts_with("src/")) {
            continue;
        }
        let text = std::fs::read_to_string(&path)?;
        let mut text = replace_all(&text, &vars);
        if no_logic && rel == "plugin.toml" {
            text = text.replace(&format!("hooks = [\"{table}\"]"), "hooks = []");
        }
        let dest = dir.join(&rel);
        std::fs::create_dir_all(dest.parent().expect("folder"))?;
        std::fs::write(dest, text)?;
    }
    // Cargo workspace of the plugin folder
    if !no_logic {
        let cargo = base.join("Cargo.toml");
        let text = std::fs::read_to_string(&cargo).with_context(|| format!("{}", cargo.display()))?;
        if !text.contains(&format!("\"{name}\"")) {
            match text.find("members = [") {
                Some(i) => {
                    let at = i + "members = [".len();
                    std::fs::write(&cargo, format!("{}\n    \"{name}\",{}", &text[..at], &text[at..]))?;
                }
                None => eprintln!("add \"{name}\" by hand to the members of {}", cargo.display()),
            }
        }
    }
    // npm workspace of the plugin folder
    let pkg = base.join("package.json");
    let mut v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&pkg)?)?;
    if let Some(ws) = v.get_mut("workspaces").and_then(|w| w.as_array_mut()) {
        let entry = serde_json::Value::String(format!("{name}/ui"));
        if !ws.contains(&entry) {
            ws.push(entry);
        }
    }
    std::fs::write(&pkg, serde_json::to_string_pretty(&v)? + "\n")?;
    run(npm().current_dir(&base).args(["install", "--no-audit", "--no-fund"]))?;
    println!(
        "\nplugin created in {}\n  id: {id}\n  `cargo xtask dev` loads it in development (if the distribution includes it)",
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
