//! `dev`: the server of the base in the developer profile, with the brand and the policy of the product and its own
//! plugins loaded from their folders (the server reloads their manifest, migrations, UI and logic when the files
//! change). The official plugins the product keeps come from the registry of the base, when `--base` is given.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use mosaikit_plugin_cli::dev::{find_server, ports, PASSWORD, USERS};
use mosaikit_plugin_cli::project;

use crate::model::Distribution;

#[derive(Debug, Clone, Default)]
pub struct Options {
    pub dir: PathBuf,
    /// folder of the desktop kit: its registry gives the official plugins of the product
    pub base: Option<PathBuf>,
    /// the `mosaikit-server` executable (default: `MOSAIKIT_SERVER_BIN`, then next to this tool)
    pub server: Option<PathBuf>,
    pub port: Option<u16>,
    pub data: Option<PathBuf>,
    pub no_open: bool,
    /// do not build the own plugins first
    pub no_build: bool,
    /// delete the data folder first: a new database, the tenant and the test users again
    pub fresh: bool,
    /// a PostgreSQL database of this computer to run on instead of SQLite (`postgres://user:password@localhost:5432/name`)
    pub database: Option<String>,
}

/// A TOML literal string for a path (single quotes: no escapes, so the backslashes of Windows stay).
fn lit(p: &Path) -> String {
    format!("'{}'", p.display().to_string().trim_start_matches(r"\\?\"))
}

/// The configuration of the server for the product: the developer profile on a loopback address.
pub fn config(
    d: &Distribution,
    own: &[project::Plugin],
    base: Option<&Path>,
    data: &Path,
    port: u16,
) -> String {
    let mut c = format!(
        "# written by `mosaikit-product dev` at every start: do not edit\nurl = \"http://127.0.0.1:{port}\"\nlisten = \"127.0.0.1:{port}\"\nplugin_listen = \"127.0.0.1:{}\"\ndata_dir = {}\ndeveloper_profile = true\nplugin_settings_file = {}\n",
        port + 1,
        lit(data),
        lit(&d.file()),
    );
    if let Some(b) = d.brand_dir() {
        c.push_str(&format!("brand = {}\n", lit(&b)));
    }
    if let Some(reg) = base.map(|b| b.join("registry")).filter(|r| r.join("index.json").is_file()) {
        c.push_str(&format!("registry = {}\npreinstall = true\n", lit(&reg.join("index.json"))));
        if let Ok(k) = std::fs::read_to_string(reg.join("trusted_key.txt")) {
            c.push_str(&format!("trusted_keys = [\"{}\"]\n", k.trim()));
        }
    }
    let dirs: Vec<String> = own.iter().map(|p| lit(&p.dir)).collect();
    c.push_str(&format!("\n[dev]\nplugins = [{}]\n", dirs.join(", ")));
    if let Some(t) = own.first().map(|p| p.cargo_root.clone().unwrap_or_else(|| p.dir.clone()).join("target"))
    {
        c.push_str(&format!("target_dir = {}\n", lit(&t)));
    }
    c
}

pub(crate) struct Server(pub(crate) Child);

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub(crate) fn wait_ready(server: &mut Server, url: &str) -> Result<()> {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(2)).build()?;
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(90) {
        if let Some(status) = server.0.try_wait()? {
            bail!("the server stopped at start ({status}); its message is above (the policy of the product may be refused)");
        }
        if client.get(format!("{url}/api/health")).send().is_ok_and(|r| r.status().is_success()) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    bail!("the server does not answer on {url} after 90 seconds")
}

/// Starts the server of the base for the product and waits until it answers: the guard stops it when dropped.
pub(crate) fn start(
    d: &Distribution,
    own: &[project::Plugin],
    base: Option<&Path>,
    server_bin: &Path,
    data: &Path,
    port: u16,
    database: Option<&str>,
) -> Result<(Server, String)> {
    std::fs::create_dir_all(data)?;
    let cfg = d.dir.join(".mosaikit-product").join("mosaikit.toml");
    std::fs::create_dir_all(cfg.parent().expect("folder"))?;
    std::fs::write(&cfg, config(d, own, base, &std::path::absolute(data)?, port))?;
    let mut cmd = Command::new(server_bin);
    cmd.arg("--config").arg(&cfg).arg("serve").stdin(Stdio::null());
    // PostgreSQL only when asked for with `--database` (not read from the environment of the shell, on purpose)
    if let Some(u) = database {
        cmd.env("MOSAIKIT_DATABASE_URL", u);
    }
    let child = cmd.spawn().with_context(|| format!("starting {}", server_bin.display()))?;
    let mut server = Server(child);
    let url = format!("http://127.0.0.1:{port}");
    wait_ready(&mut server, &url)?;
    Ok((server, url))
}

pub fn dev(o: &Options) -> Result<()> {
    let d = Distribution::load(&o.dir)?;
    let server_bin = find_server(o.server.as_deref())?;
    let own = d.own_plugins()?;
    if !o.no_build && !own.is_empty() {
        project::build_wasm(&own, false)?;
        project::build_ui(&own)?;
    }
    let data = o.data.clone().unwrap_or_else(|| d.dir.join(".mosaikit-product").join("data"));
    if o.fresh && data.exists() {
        std::fs::remove_dir_all(&data).with_context(|| format!("removing {}", data.display()))?;
    }
    std::fs::create_dir_all(&data)?;
    let port = ports(o.port, 8080)?;
    if let Some(u) = &o.database {
        mosaikit_plugin_cli::dev::check_database_url(u)?;
        if o.fresh {
            eprintln!(
                "--fresh does not empty a PostgreSQL database: drop and create it again to start clean"
            );
        }
    }
    let (mut server, url) =
        start(&d, &own, o.base.as_deref(), &server_bin, &data, port, o.database.as_deref())?;
    println!(
        "\n  {} {} in development\n  app:      {url}\n  plugins:  http://127.0.0.1:{}",
        d.product.name,
        d.product.version,
        port + 1
    );
    if let Some(u) = &o.database {
        println!("  database: {} (PostgreSQL)", mosaikit_plugin_cli::dev::redact_database_url(u));
    }
    println!("  test users (password {PASSWORD}):");
    for (user, role, place) in USERS {
        println!("    {user:<8} {role:<15} {place}");
    }
    println!("  Ctrl+C to stop\n");
    if !o.no_open {
        let _ = if cfg!(windows) {
            Command::new("explorer").arg(&url).spawn()
        } else if cfg!(target_os = "macos") {
            Command::new("open").arg(&url).spawn()
        } else {
            Command::new("xdg-open").arg(&url).spawn()
        };
    }
    let status = server.0.wait()?;
    println!("the server stopped ({status})");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_configuration_loads_the_brand_the_policy_and_the_plugins() {
        let t = tempfile::tempdir().unwrap();
        let root = crate::scaffold::new_product("acme", t.path()).unwrap();
        let p = root.join("plugins").join("a");
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("plugin.toml"), "id = \"com.acme.a\"\nname = \"A\"\nversion = \"0.1.0\"\n")
            .unwrap();
        let d = Distribution::load(&root).unwrap();
        let own = d.own_plugins().unwrap();
        let c = config(&d, &own, None, &t.path().join("data"), 8100);
        assert!(
            c.contains("developer_profile = true")
                && c.contains("127.0.0.1:8100")
                && c.contains("127.0.0.1:8101"),
            "{c}"
        );
        assert!(
            c.contains("brand = ") && c.contains("plugin_settings_file = ") && c.contains("[dev]"),
            "{c}"
        );
        assert!(c.contains("plugins = ["), "{c}");
        let parsed: toml::Table = toml::from_str(&c).unwrap();
        assert_eq!(parsed["dev"]["plugins"].as_array().unwrap().len(), 1);
    }
}
