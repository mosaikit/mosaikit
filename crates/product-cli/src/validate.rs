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
        Some(_) => {}
        None => r.add(
            Level::Warning,
            "no [product] base: the product says it works with any version of the base (e.g. \">=1.0, <2\")",
        ),
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
        let r = validate(&root, &Options { server: Some(t.path().join("no-server")) }).unwrap();
        assert!(r.ok(), "{:?}", r.findings);
    }

    #[test]
    fn the_brand_and_the_range_are_checked() {
        let t = tempfile::tempdir().unwrap();
        let root = crate::scaffold::new_product("acme", t.path()).unwrap();
        std::fs::write(root.join("branding/brand.toml"), "logo = \"gone.svg\"\n[colors]\naccent = \"red\"\n")
            .unwrap();
        let text =
            std::fs::read_to_string(root.join("distribution.toml")).unwrap().replace(">=1.0, <2", "banana");
        std::fs::write(root.join("distribution.toml"), text).unwrap();
        let r = validate(&root, &Options { server: Some(t.path().join("no-server")) }).unwrap();
        let all = format!("{:?}", r.findings);
        assert!(all.contains("gone.svg") && all.contains("colors.accent") && all.contains("banana"), "{all}");
        assert!(!r.ok());
    }
}
