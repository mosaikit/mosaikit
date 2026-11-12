//! `validate`: the product folder, its brand, its plugins (the strict checks of `mosaikit-plugin`) and the policy
//! tables (checked by the base: `mosaikit-server check-distribution`).

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::Result;
use mosaikit_mskp::VersionReq;
use mosaikit_plugin_cli::validate as plugin_validate;

use crate::model::Distribution;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Default)]
pub struct Report {
    pub findings: Vec<(Level, String)>,
}

impl Report {
    pub fn add(&mut self, l: Level, m: impl Into<String>) {
        self.findings.push((l, m.into()));
    }
    pub fn errors(&self) -> usize {
        self.findings.iter().filter(|f| f.0 == Level::Error).count()
    }
    pub fn warnings(&self) -> usize {
        self.findings.iter().filter(|f| f.0 == Level::Warning).count()
    }
    pub fn ok(&self) -> bool {
        self.errors() == 0
    }
    pub fn print(&self) {
        for (l, m) in &self.findings {
            let tag = match l {
                Level::Error => "error  ",
                Level::Warning => "warning",
                Level::Info => "info   ",
            };
            println!("  {tag} {m}");
        }
        println!("  {} error(s), {} warning(s)", self.errors(), self.warnings());
    }
}

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// the `mosaikit-server` of the base, to check the policy tables against it
    pub server: Option<PathBuf>,
    /// the desktop kit of the base (a folder): its registry is checked for the official plugins the product keeps
    pub base: Option<PathBuf>,
}

pub fn validate(dir: &Path, o: &Options) -> Result<Report> {
    let mut r = Report::default();
    let d = match Distribution::load(dir) {
        Ok(d) => d,
        Err(e) => {
            r.add(Level::Error, format!("{e:#}"));
            return Ok(r);
        }
    };
    match &d.product.base {
        Some(range) if VersionReq::parse(range).is_none() => r.add(
            Level::Error,
            format!("[product] base = \"{range}\": not a range of versions (e.g. \">=1.0, <2\")"),
        ),
        Some(range) => {
            // the sample tenant of Keycloak is made by the base from 1.0.3; an older one refuses the table
            let old = mosaikit_mskp::Version::parse("1.0.2").zip(VersionReq::parse(range));
            if d.docker.keycloak && old.is_some_and(|(v, req)| req.matches(v)) {
                r.add(
                    Level::Error,
                    format!("[docker] keycloak = true needs a base from 1.0.3, and [product] base = \"{range}\" accepts 1.0.2: set base = \">=1.0.3, <2\" or keycloak = false"),
                );
            }
        }
        None => r.add(
            Level::Warning,
            "no [product] base: the product says it works with any version of the base (e.g. \">=1.0, <2\")",
        ),
    }
    // the compose files and the files the Docker release takes from the folder of the product
    for (what, list) in [("compose_files", &d.docker.compose_files), ("copy", &d.docker.copy)] {
        for p in list {
            if !crate::model::Docker::safe_path(p) {
                r.add(Level::Error, format!("[docker] {what} = \"{p}\": a path inside the folder of the product (no `..`, not absolute)"));
            } else if !d.dir.join(p).exists() {
                r.add(Level::Error, format!("[docker] {what} = \"{p}\": not found in {}", d.dir.display()));
            }
        }
    }
    if d.docker
        .compose_files
        .iter()
        .any(|p| std::path::Path::new(p).file_name().is_some_and(|n| n == "compose.yml"))
    {
        r.add(Level::Error, "[docker] compose_files: a file called compose.yml would replace the generated one: give it another name");
    }
    // the sidecars of the desktop release: the executable must exist when the release is built
    for s in &d.sidecars {
        match &s.command {
            Some(c) if mosaikit_sidecars::resolve_command(&d.dir, c).is_none() => r.add(
                Level::Warning,
                format!("[[sidecars]] \"{}\": executable {} not found (the desktop release needs it)", s.name, d.dir.join(c).display()),
            ),
            None => r.add(
                Level::Warning,
                format!("[[sidecars]] \"{}\": no `command`: the desktop release cannot start it (it needs `command`)", s.name),
            ),
            _ => {}
        }
    }
    // the brand
    match (&d.brand.dir, d.brand_dir()) {
        (Some(p), None) => r.add(Level::Error, format!("[brand] dir = {}: not a folder", p.display())),
        (None, _) => r.add(Level::Info, "no brand: the product shows the Mosaikit brand"),
        (Some(_), Some(b)) => check_brand(&b, &mut r),
    }
    // the plugins
    match d.own_plugins() {
        Err(e) => r.add(Level::Error, format!("{e:#}")),
        Ok(own) => {
            for p in &own {
                match plugin_validate::validate_with(&p.dir, plugin_validate::Options { strict: true }) {
                    Ok(rep) => {
                        for f in rep.findings {
                            let l = match f.level {
                                plugin_validate::Level::Error => Level::Error,
                                plugin_validate::Level::Warning => Level::Warning,
                                plugin_validate::Level::Info => Level::Info,
                            };
                            r.add(l, format!("{}: {}", p.id, f.message));
                        }
                    }
                    Err(e) => r.add(Level::Error, format!("{}: {e:#}", p.id)),
                }
            }
            for id in d.plugins.include.iter().filter(|i| *i != "*") {
                if !own.iter().any(|p| &p.id == id) && !id.starts_with("com.mosaikit.") {
                    r.add(
                        Level::Warning,
                        format!("[plugins] include \"{id}\": no plugin of that id in the roots and not an official plugin"),
                    );
                }
            }
        }
    }
    check_nav_groups(&d, &mut r);
    if let Some(base) = o.base.as_deref().filter(|b| b.is_dir()) {
        check_base_registry(&d, base, &mut r);
    }
    // the policy tables, by the base itself
    match mosaikit_plugin_cli::dev::find_server(o.server.as_deref()) {
        Ok(server) => match Command::new(&server).arg("check-distribution").arg(&d.dir).output() {
            Ok(out) if out.status.success() => {
                r.add(Level::Info, "the policy of the product is accepted by the base");
                // the plugins of the product must work with this base
                let text = String::from_utf8_lossy(&out.stdout);
                let base = text.lines().find_map(|l| l.strip_prefix("base").and_then(|x| x.split("Mosaikit ").nth(1))).map(str::trim);
                if let (Some(v), Ok(own)) = (base.and_then(mosaikit_mskp::Version::parse), d.own_plugins()) {
                    for p in &own {
                        let range = std::fs::read_to_string(p.dir.join("plugin.toml"))
                            .ok()
                            .and_then(|t| mosaikit_mskp::Manifest::from_toml(&t).ok())
                            .map(|m| m.mosaikit_range());
                        if range.is_some_and(|rg| !rg.matches(v)) {
                            r.add(Level::Error, format!("{}: [requires] mosaikit does not include the base {base}", p.id, base = base.unwrap_or("")));
                        }
                    }
                }
            }
            Ok(out) => {
                let text = String::from_utf8_lossy(&out.stderr).trim().to_string();
                r.add(Level::Error, if text.is_empty() { "the base refuses the policy of the product".into() } else { text });
            }
            Err(e) => r.add(Level::Warning, format!("the policy was not checked: {} did not start ({e})", server.display())),
        },
        Err(_) => r.add(
            Level::Warning,
            "the policy tables ([defaults], [locked], [languages], [bootstrap], [database]) were not checked: the server of the base was not found (--server, MOSAIKIT_SERVER_BIN)",
        ),
    }
    Ok(r)
}

/// A group of the sidebar that lists a plugin the release does not carry: the server only warns at start and shows
/// nothing, so say it here.
fn check_nav_groups(d: &Distribution, r: &mut Report) {
    let Some(groups) = d.nav_groups.as_ref().and_then(|v| v.as_array()) else { return };
    let own: Vec<String> = d.own_plugins().map(|o| o.into_iter().map(|p| p.id).collect()).unwrap_or_default();
    let official = d.official_ids().unwrap_or_default();
    for g in groups {
        let name = g.get("id").and_then(|v| v.as_str()).unwrap_or("?");
        for id in g.get("plugins").and_then(|v| v.as_array()).into_iter().flatten().filter_map(|v| v.as_str())
        {
            let carried = (own.iter().any(|o| o == id) && d.includes(id))
                || official.iter().any(|o| o == id)
                || d.all_official();
            if !carried {
                r.add(
                    Level::Warning,
                    format!("[[nav_groups]] \"{name}\": the plugin {id} is not in [plugins] include, so the group will not show it"),
                );
            }
        }
    }
}

/// The official plugins the product keeps must be in the registry of the base, or `build` stops.
fn check_base_registry(d: &Distribution, base: &Path, r: &mut Report) {
    let Ok(text) = std::fs::read_to_string(base.join("registry").join("index.json")) else {
        r.add(
            Level::Warning,
            format!(
                "{}: no registry/index.json: the official plugins of [plugins] include were not checked",
                base.display()
            ),
        );
        return;
    };
    let Ok(idx) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    let have: Vec<&str> =
        idx["plugins"].as_array().into_iter().flatten().filter_map(|e| e["id"].as_str()).collect();
    for id in d.official_ids().unwrap_or_default() {
        if !have.contains(&id.as_str()) {
            r.add(
                Level::Warning,
                format!(
                    "[plugins] include \"{id}\": not in the registry of the base ({}): `build` will stop",
                    base.display()
                ),
            );
        }
    }
}

fn check_brand(dir: &Path, r: &mut Report) {
    let file = dir.join("brand.toml");
    let Ok(text) = std::fs::read_to_string(&file) else {
        r.add(Level::Error, format!("{}: brand.toml not found", dir.display()));
        return;
    };
    let t: toml::Table = match toml::from_str(&text) {
        Ok(t) => t,
        Err(e) => {
            r.add(Level::Error, format!("brand.toml: {e}"));
            return;
        }
    };
    for k in ["logo", "favicon", "icon"] {
        if let Some(f) = t.get(k).and_then(|v| v.as_str()) {
            if !dir.join(f).is_file() {
                r.add(Level::Error, format!("brand.toml: {k} = \"{f}\" is not a file of the brand folder"));
            }
        }
    }
    if let Some(c) = t.get("colors").and_then(|v| v.as_table()) {
        for (k, v) in c {
            let ok = v.as_str().is_some_and(|s| {
                s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
            });
            if !ok {
                r.add(Level::Error, format!("brand.toml: colors.{k} must be #rrggbb"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_product_has_no_error() {
        let t = tempfile::tempdir().unwrap();
        let root = crate::scaffold::new_product("acme", t.path()).unwrap();
        let r = validate(&root, &Options { server: Some(t.path().join("no-server")), ..Options::default() })
            .unwrap();
        assert!(r.ok(), "{:?}", r.findings);
    }

    #[test]
    fn the_brand_and_the_range_are_checked() {
        let t = tempfile::tempdir().unwrap();
        let root = crate::scaffold::new_product("acme", t.path()).unwrap();
        std::fs::write(root.join("branding/brand.toml"), "logo = \"gone.svg\"\n[colors]\naccent = \"red\"\n")
            .unwrap();
        let text =
            std::fs::read_to_string(root.join("distribution.toml")).unwrap().replace(">=1.0.3, <2", "banana");
        std::fs::write(root.join("distribution.toml"), text).unwrap();
        let r = validate(&root, &Options { server: Some(t.path().join("no-server")), ..Options::default() })
            .unwrap();
        let all = format!("{:?}", r.findings);
        assert!(all.contains("gone.svg") && all.contains("colors.accent") && all.contains("banana"), "{all}");
        assert!(!r.ok());
    }

    #[test]
    fn keycloak_needs_a_base_that_knows_the_sample_tenant() {
        let t = tempfile::tempdir().unwrap();
        let root = crate::scaffold::new_product("acme", t.path()).unwrap();
        let file = root.join("distribution.toml");
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("keycloak = true"), "a new product has Keycloak");
        let opts = || Options { server: Some(t.path().join("no-server")), ..Options::default() };
        assert!(!format!("{:?}", validate(&root, &opts()).unwrap().findings).contains("keycloak"));
        std::fs::write(&file, text.replace(">=1.0.3, <2", ">=1.0, <2")).unwrap();
        let r = validate(&root, &opts()).unwrap();
        assert!(format!("{:?}", r.findings).contains("needs a base from 1.0.3") && !r.ok());
    }

    #[test]
    fn a_nav_group_plugin_and_an_official_plugin_the_base_lacks_are_warned() {
        let t = tempfile::tempdir().unwrap();
        let root = crate::scaffold::new_product("acme", t.path()).unwrap();
        let mut text = std::fs::read_to_string(root.join("distribution.toml")).unwrap();
        text = text.replace("include = [\"*\"]", "include = [\"com.mosaikit.notes\"]");
        text.push_str(
            "
[[nav_groups]]
id = \"g\"
label = \"G\"
icon = \"folder\"
plugins = [\"com.mosaikit.notes\", \"com.acme.gone\"]
",
        );
        std::fs::write(root.join("distribution.toml"), text).unwrap();
        let base = t.path().join("base");
        std::fs::create_dir_all(base.join("registry")).unwrap();
        std::fs::write(base.join("registry/index.json"), r#"{"plugins":[]}"#).unwrap();
        let r =
            validate(&root, &Options { server: Some(t.path().join("no-server")), base: Some(base) }).unwrap();
        let all = format!("{:?}", r.findings);
        assert!(r.ok(), "{all}");
        assert!(all.contains("com.acme.gone") && all.contains("not in [plugins] include"), "{all}");
        assert!(all.contains("not in the registry of the base"), "{all}");
    }
}
