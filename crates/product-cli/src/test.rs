//! `test`: what a publisher proves before shipping. The product is validated (strict checks of its plugins, the
//! policy by the base), then started on the base in the developer profile and checked over HTTP: it answers, it has
//! its brand and its About data, every test user signs in, the Tenant Manager sees every own plugin of the release.
//! With `--upgrade-from <older server>` the product first runs on the older base and then, on the same data, on the
//! new one (the migrations of the base and of the plugins run and nothing is lost). The pages of the plugins and the
//! accessibility are checked in the browser with `@mosaikit/plugin-testing` (see the reference product).

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use mosaikit_plugin_cli::dev::{find_server, ports, PASSWORD};
use reqwest::blocking::Client;
use serde_json::{json, Value};

use crate::dev;
use crate::model::Distribution;
use crate::validate::{self, Level, Report};

#[derive(Debug, Clone, Default)]
pub struct Options {
    pub dir: PathBuf,
    /// folder of the desktop kit (the official plugins of the product)
    pub base: Option<PathBuf>,
    /// the `mosaikit-server` of the base to test on
    pub server: Option<PathBuf>,
    /// an older `mosaikit-server`: the product runs on it first, then on the new one with the same data
    pub upgrade_from: Option<PathBuf>,
    pub no_build: bool,
}

fn get(client: &Client, url: &str, cookie: Option<&str>) -> Result<(u16, Value)> {
    let mut r = client.get(url);
    if let Some(c) = cookie {
        r = r.header("Cookie", c);
    }
    let resp = r.send().with_context(|| url.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text()?;
    Ok((status, serde_json::from_str(&text).unwrap_or(Value::Null)))
}

/// Signs in as a user of the tenant `dev` and gives the cookie of the session.
fn sign_in(client: &Client, app: &str, user: &str) -> Result<String> {
    let resp = client
        .post(format!("{app}/api/auth/login"))
        .json(&json!({ "tenant": "dev", "username": user, "password": PASSWORD }))
        .send()?;
    if !resp.status().is_success() {
        bail!("{user} cannot sign in ({})", resp.status());
    }
    let cookie = resp
        .headers()
        .get_all("set-cookie")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or_default().to_string())
        .collect::<Vec<_>>()
        .join("; ");
    Ok(cookie)
}

/// The checks over HTTP of a running product.
pub fn smoke(d: &Distribution, own: &[String], app: &str, r: &mut Report) -> Result<()> {
    let client = Client::builder().timeout(std::time::Duration::from_secs(20)).build()?;
    let (_, health) = get(&client, &format!("{app}/api/health"), None)?;
    if health["ok"] != true {
        r.add(Level::Error, format!("{app}/api/health does not say ok: {health}"));
        return Ok(());
    }
    // the brand and the About data
    let (_, brand) = get(&client, &format!("{app}/api/brand"), None)?;
    let brand_name = d
        .brand_dir()
        .and_then(|b| std::fs::read_to_string(b.join("brand.toml")).ok())
        .and_then(|t| toml::from_str::<toml::Table>(&t).ok())
        .and_then(|t| t.get("name").and_then(|v| v.as_str().map(str::to_string)));
    if let Some(n) = &brand_name {
        if brand["name"] != json!(n) {
            r.add(
                Level::Error,
                format!("the sign-in page shows the name {} and the brand says \"{n}\"", brand["name"]),
            );
        } else {
            r.add(Level::Info, format!("brand: \"{n}\""));
        }
    }
    let about = &brand["about"];
    if about["product"] != json!(d.product.name) || about["version"] != json!(d.product.version) {
        r.add(
            Level::Error,
            format!("About says {about} and the product is {} {}", d.product.name, d.product.version),
        );
    } else {
        r.add(
            Level::Info,
            format!(
                "About: {} {} on Mosaikit {}",
                d.product.name,
                d.product.version,
                about["base"].as_str().unwrap_or("?")
            ),
        );
    }
    // the test users
    for user in ["manager", "alice", "bob"] {
        match sign_in(&client, app, user) {
            Ok(cookie) => {
                if user == "manager" {
                    let (code, ctx) = get(&client, &format!("{app}/api/t/dev/context"), Some(&cookie))?;
                    let ids: Vec<String> = ctx["plugins"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|p| p["id"].as_str().map(str::to_string)).collect())
                        .unwrap_or_default();
                    if code != 200 {
                        r.add(Level::Error, format!("the context of the tenant answers {code}"));
                    }
                    for id in own {
                        if ids.contains(id) {
                            r.add(Level::Info, format!("plugin {id} is in the tenant"));
                        } else {
                            r.add(
                                Level::Error,
                                format!(
                                    "plugin {id} of the release is not in the tenant of the Tenant Manager"
                                ),
                            );
                        }
                    }
                }
            }
            Err(e) => r.add(Level::Error, format!("{e}")),
        }
    }
    let admin = client
        .post(format!("{app}/api/auth/admin/login"))
        .json(&json!({ "username": "admin", "password": PASSWORD }))
        .send()?;
    if admin.status().is_success() {
        r.add(Level::Info, "the Administrator signs in");
    } else {
        r.add(Level::Error, format!("the Administrator cannot sign in ({})", admin.status()));
    }
    Ok(())
}

pub fn test(o: &Options) -> Result<Report> {
    let mut r = validate::validate(&o.dir, &validate::Options { server: o.server.clone() })?;
    if !r.ok() {
        return Ok(r);
    }
    let d = Distribution::load(&o.dir)?;
    let server_bin = find_server(o.server.as_deref())?;
    let own = d.release_plugins()?;
    if !o.no_build && !own.is_empty() {
        mosaikit_plugin_cli::project::build_wasm(&own, false)?;
        mosaikit_plugin_cli::project::build_ui(&own)?;
    }
    let ids: Vec<String> = own.iter().map(|p| p.id.clone()).collect();
    let data: PathBuf = d.dir.join(".mosaikit-product").join("test-data");
    if data.exists() {
        std::fs::remove_dir_all(&data)?;
    }
    let run = |bin: &Path, label: &str, r: &mut Report| -> Result<()> {
        let port = ports(None, 8300)?;
        match dev::start(&d, &own, o.base.as_deref(), bin, &data, port) {
            Ok((_server, app)) => {
                r.add(Level::Info, format!("{label}: started on {app}"));
                smoke(&d, &ids, &app, r)
            }
            Err(e) => {
                r.add(Level::Error, format!("{label}: the product does not start: {e:#}"));
                Ok(())
            }
        }
    };
    if let Some(old) = &o.upgrade_from {
        let old = find_server(Some(old))?;
        run(&old, "on the older base", &mut r)?;
        if !r.ok() {
            return Ok(r);
        }
        run(&server_bin, "on the new base, same data", &mut r)?;
    } else {
        run(&server_bin, "on the base", &mut r)?;
    }
    Ok(r)
}
