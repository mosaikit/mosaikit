//! Plugin del repository: build (WASM e UI), pacchetti firmati, scaffolding, reset dei dati.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::util::{exe, npm, output, pg_bin, root, run};

/// Un plugin di una delle cartelle della distribuzione.
#[derive(Debug, Clone)]
pub struct Plugin {
    pub dir: PathBuf,
    pub id: String,
    pub version: String,
    /// nome del crate, se il plugin ha logica WASM
    pub crate_name: Option<String>,
    pub has_ui: bool,
    /// workspace Cargo che contiene il crate (cartella antenata con `[workspace]`)
    pub cargo_root: Option<PathBuf>,
    /// workspace npm che contiene la UI (cartella antenata con `workspaces`)
    pub npm_root: Option<PathBuf>,
}

fn ancestor_with(dir: &Path, file: &str, marker: &str) -> Option<PathBuf> {
    dir.ancestors()
        .skip(1)
        .find(|a| std::fs::read_to_string(a.join(file)).is_ok_and(|t| t.contains(marker)))
        .map(Path::to_path_buf)
}

/// Plugin delle cartelle della distribuzione attiva (solo quelli inclusi).
pub fn discover() -> Result<Vec<Plugin>> {
    let d = crate::dist::current();
    let mut out = Vec::new();
    for base in &d.plugins.roots {
        let rd = std::fs::read_dir(base).with_context(|| {
            format!("cartella dei plugin {} (vedi [plugins] roots in distribution.toml)", base.display())
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
            bail!("plugin {want} indicato in distribution.toml ma non trovato nelle cartelle dei plugin");
        }
    }
    Ok(out)
}

/// Workspace Cargo distinti dei plugin.
pub fn cargo_roots(plugins: &[Plugin]) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = plugins.iter().filter_map(|p| p.cargo_root.clone()).collect();
    v.sort();
    v.dedup();
    v
}

/// Radici npm distinte delle UI dei plugin.
pub fn npm_roots(plugins: &[Plugin]) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = plugins.iter().filter(|p| p.has_ui).map(|p| ui_workspace(p).0).collect();
    v.sort();
    v.dedup();
    v
}

/// `target` di cargo del workspace di mosaikit (server, xtask).
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

/// Compila la logica WASM, un `cargo build` per workspace dei plugin.
pub fn build_wasm(plugins: &[Plugin], release: bool) -> Result<()> {
    let mut by_ws: BTreeMap<PathBuf, Vec<&String>> = BTreeMap::new();
    for p in plugins {
        if let (Some(c), Some(ws)) = (&p.crate_name, &p.cargo_root) {
            by_ws.entry(ws.clone()).or_default().push(c);
        } else if let Some(c) = &p.crate_name {
            bail!("{} ({c}) non appartiene a nessun workspace Cargo", p.dir.display());
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

/// `npm install` nella radice indicata se manca node_modules.
pub fn ensure_npm_in(dir: &Path) -> Result<()> {
    if !dir.join("node_modules").is_dir() {
        run(npm().current_dir(dir).args(["install", "--no-audit", "--no-fund"]))?;
    }
    Ok(())
}

/// npm di mosaikit (UI host, plugin-api, e2e).
pub fn ensure_npm() -> Result<()> {
    ensure_npm_in(&root())
}

/// (radice npm, nome del workspace) della UI di un plugin.
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

/// Comando npm per la UI di un plugin (`npm run <script> -w <ui>` nella sua radice npm).
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
// ------------------------------------------------------------------ chiavi di firma

/// Chiave di firma: `MOSAIKIT_SIGNING_KEY` (base64), `MOSAIKIT_SIGNING_KEY_FILE`,
/// altrimenti la chiave locale di sviluppo `.dev/signing.key` (creata se manca).
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
        std::fs::create_dir_all(path.parent().expect("cartella .dev"))?;
        let k = mosaikit_mskp::generate_key();
        std::fs::write(&path, mosaikit_mskp::signing_key_to_b64(&k))?;
        eprintln!("creata la chiave di sviluppo {} (non va committata)", path.display());
    }
    Ok((
        mosaikit_mskp::signing_key_from_b64(&std::fs::read_to_string(&path)?)?,
        "chiave di sviluppo .dev/signing.key",
    ))
}

pub fn keygen(out: Option<PathBuf>) -> Result<()> {
    let k = mosaikit_mskp::generate_key();
    let private = mosaikit_mskp::signing_key_to_b64(&k);
    match out {
        Some(p) => {
            std::fs::write(&p, &private)?;
            println!("chiave privata salvata in {}", p.display());
        }
        None => println!("chiave privata (MOSAIKIT_SIGNING_KEY): {private}"),
    }
    println!("chiave pubblica (trusted_keys):       {}", mosaikit_mskp::public_key_b64(&k));
    Ok(())
}

// ------------------------------------------------------------------ pacchetti

/// Crea `<out>/<id>-<versione>.mskp` firmato. Ritorna (percorso, sha256).
pub fn pack(
    p: &Plugin,
    release: bool,
    key: &ed25519_dalek::SigningKey,
    out: &Path,
) -> Result<(PathBuf, String)> {
    let wasm = wasm_path(p, release);
    if let Some(w) = &wasm {
        if !w.is_file() {
            bail!("{}: {} non compilato (cargo xtask plugin build)", p.id, w.display());
        }
    }
    if p.has_ui && !p.dir.join("ui").join("dist").is_dir() {
        bail!("{}: UI non compilata (npm run build in {})", p.id, p.dir.join("ui").display());
    }
    let files: BTreeMap<String, Vec<u8>> = mosaikit_mskp::collect_plugin_dir(&p.dir, wasm.as_deref())?;
    let files: BTreeMap<String, Vec<u8>> = files.into_iter().filter(|(k, _)| !k.ends_with(".map")).collect();
    let bytes = mosaikit_mskp::pack(&files, Some(key))?;
    std::fs::create_dir_all(out)?;
    let path = out.join(format!("{}-{}.mskp", p.id, p.version));
    std::fs::write(&path, &bytes)?;
    Ok((path, mosaikit_mskp::package_sha256(&bytes)))
}

/// Pacchetti di tutti i plugin + `index.json` del registry in `out`.
pub fn pack_all(plugins: &[Plugin], release: bool, out: &Path) -> Result<PathBuf> {
    let (key, source) = signing_key()?;
    eprintln!("firma dei pacchetti con: {source}");
    let pkgs = out.join("plugins");
    let mut entries = Vec::new();
    for p in plugins {
        let (path, sha) = pack(p, release, &key, &pkgs)?;
        let manifest =
            mosaikit_mskp::Manifest::from_toml(&std::fs::read_to_string(p.dir.join("plugin.toml"))?)?;
        eprintln!("  {} {} -> {}", p.id, p.version, path.display());
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
            }],
        }));
    }
    let index = serde_json::json!({ "plugins": entries, "blocklist": [] });
    let path = out.join("index.json");
    std::fs::write(&path, serde_json::to_string_pretty(&index)?)?;
    std::fs::write(out.join("trusted_key.txt"), mosaikit_mskp::public_key_b64(&key))?;
    Ok(path)
}

// ------------------------------------------------------------------ nuovo plugin

fn replace_all(s: &str, vars: &[(&str, &str)]) -> String {
    vars.iter().fold(s.to_string(), |acc, (k, v)| acc.replace(&format!("{{{{{k}}}}}"), v))
}

/// Percorso relativo da `from` (cartella) a `to`, con `/`.
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

/// Nuovo plugin dal template, nella prima cartella dei plugin della distribuzione
/// (o in `into`), aggiunto ai workspace Cargo e npm di quella cartella.
pub fn new_plugin(name: &str, id: Option<String>, no_logic: bool, into: Option<PathBuf>) -> Result<()> {
    if !mosaikit_mskp::is_identifier(&name.replace('-', "_")) || name.contains('_') {
        bail!("nome non valido: minuscole, cifre e '-' (es. meteo, catasto-strade)");
    }
    let base = match into {
        Some(d) => d,
        None => {
            crate::dist::current().plugins.roots.first().cloned().context("nessuna cartella dei plugin")?
        }
    };
    let dir = base.join(name);
    if dir.exists() {
        bail!("{} esiste gia'", dir.display());
    }
    let id = id.unwrap_or_else(|| format!("com.example.{name}"));
    if !mosaikit_mskp::is_plugin_id(&id) {
        bail!("id non valido: {id} (es. com.azienda.{name})");
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
    let template = root().join("templates").join("plugin");
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
        std::fs::create_dir_all(dest.parent().expect("cartella"))?;
        std::fs::write(dest, text)?;
    }
    // workspace Cargo della cartella dei plugin
    if !no_logic {
        let cargo = base.join("Cargo.toml");
        let text = std::fs::read_to_string(&cargo).with_context(|| format!("{}", cargo.display()))?;
        if !text.contains(&format!("\"{name}\"")) {
            match text.find("members = [") {
                Some(i) => {
                    let at = i + "members = [".len();
                    std::fs::write(&cargo, format!("{}\n    \"{name}\",{}", &text[..at], &text[at..]))?;
                }
                None => eprintln!("aggiungi a mano \"{name}\" ai members di {}", cargo.display()),
            }
        }
    }
    // workspace npm della cartella dei plugin
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
        "\nplugin creato in {}\n  id: {id}\n  `cargo xtask dev` lo carica in sviluppo (se la distribuzione lo include)",
        dir.display()
    );
    Ok(())
}
// ------------------------------------------------------------------ reset dei dati di sviluppo

/// Stesso nome di `mosaikit_db::Db::plugin_role`.
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

/// Elimina schema, ruolo e risorse di un plugin dal database di sviluppo.
pub fn db_reset(id: &str) -> Result<()> {
    let bin = pg_bin().context("psql non trovato (MOSAIKIT_PG_BIN)")?;
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
    println!("dati di {id} azzerati: al prossimo avvio di `cargo xtask dev` lo schema viene ricreato");
    Ok(())
}
