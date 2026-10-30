//! Distribution: what makes up a product based on Mosaikit (name, version,
//! branding, included plugins, plugin folders). Mosaikit itself is the
//! default distribution (`distribution.toml` in the root); a derived
//! product has its own in its project (`cargo xtask --dist ../<product> ...`).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{Context, Result};
use serde::Deserialize;

use crate::util::root;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Distribution {
    pub product: Product,
    #[serde(default)]
    pub brand: Brand,
    pub plugins: Plugins,
    #[serde(default)]
    pub desktop: Desktop,
    #[serde(default)]
    pub docker: Docker,
    #[serde(default)]
    pub tests: Tests,
    // --- sidecars: see sidecars.rs ---
    #[serde(default)]
    pub sidecars: Vec<crate::sidecars::Sidecar>,
    // --- end sidecars ---
    /// settings of plugins to seed at the first start of the server (see `seed.rs` of the kernel)
    #[serde(default)]
    pub plugin_settings: Vec<PluginSetting>,
    /// platform keys of outside services to seed at the first start of the server
    #[serde(default)]
    pub service_key_values: Vec<ServiceKeyValue>,
    /// folder of the file (to resolve relative paths)
    #[serde(skip)]
    pub dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Product {
    /// technical identifier (file names, Docker image): lower case, digits, '-'
    pub id: String,
    /// name shown to users
    pub name: String,
    /// version of the product (may differ from the one of Mosaikit)
    pub version: String,
    #[serde(default)]
    #[allow(dead_code)] // documentation of the product
    pub description: String,
    /// name of the desktop executable (without .exe)
    #[serde(default)]
    pub executable: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Brand {
    /// folder with brand.toml, logo, favicon, icons (relative to the file)
    #[serde(default)]
    pub dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plugins {
    /// folders that contain plugins (each with its own Cargo and npm workspace)
    pub roots: Vec<PathBuf>,
    /// ids of the plugins to include; "*" = every one found in the folders
    #[serde(default = "all")]
    pub include: Vec<String>,
}

fn all() -> Vec<String> {
    vec!["*".into()]
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Desktop {
    /// database of the desktop version: "sqlite" (default) or "postgres" (embedded PostgreSQL)
    #[serde(default = "sqlite")]
    pub database: String,
    /// port of the desktop app (the plugins use the next one)
    #[serde(default = "desktop_port")]
    pub port: u16,
}

fn sqlite() -> String {
    "sqlite".into()
}
fn desktop_port() -> u16 {
    48080
}

impl Default for Desktop {
    fn default() -> Desktop {
        Desktop { database: sqlite(), port: desktop_port() }
    }
}

/// Tests of the distribution itself (besides the ones of mosaikit and of the plugins).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tests {
    /// folders with a Cargo integration test project (`cargo test` with PostgreSQL)
    #[serde(default)]
    pub cargo: Vec<PathBuf>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Docker {
    /// name of the image (default: id of the product)
    #[serde(default)]
    pub image: Option<String>,
    /// PostgreSQL image of the compose (e.g. postgis/postgis:17-3.5 if geospatial data are needed)
    #[serde(default)]
    pub postgres_image: Option<String>,
}

/// `[[plugin_settings]]`: a setting of a plugin, seeded only while unset. `value` is a literal or
/// `env:NAME` / `file:PATH` (secrets must be referenced, not written here).
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginSetting {
    pub plugin: String,
    pub key: String,
    pub value: toml::Value,
}

/// `[[service_key_values]]`: the platform key of an outside service, seeded only while unset.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceKeyValue {
    pub service: String,
    pub value: String,
    #[serde(default)]
    #[allow(dead_code)] // read by the server
    pub shared: bool,
}

/// A reference `env:NAME` / `file:PATH` must name something; anything else is a literal.
fn check_value(what: &str, v: &str) -> Result<()> {
    if let Some(n) = v.strip_prefix("env:") {
        let ok = !n.is_empty() && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        anyhow::ensure!(ok, "{what}: \"env:{n}\" is not a valid environment variable name");
    } else if let Some(p) = v.strip_prefix("file:") {
        anyhow::ensure!(!p.trim().is_empty(), "{what}: \"file:\" needs a path");
    }
    Ok(())
}

impl Distribution {
    /// Checks `[[plugin_settings]]` and `[[service_key_values]]` (called when the distribution is loaded).
    fn check_seeds(&self) -> Result<()> {
        let mut seen = Vec::new();
        for s in &self.plugin_settings {
            let what = format!("[[plugin_settings]] {} / {}", s.plugin, s.key);
            anyhow::ensure!(
                !s.plugin.trim().is_empty() && !s.key.trim().is_empty(),
                "{what}: plugin and key are required"
            );
            anyhow::ensure!(!s.key.contains(':'), "{what}: a key has no ':'");
            anyhow::ensure!(!seen.contains(&(&s.plugin, &s.key)), "{what}: listed twice");
            seen.push((&s.plugin, &s.key));
            if let toml::Value::String(v) = &s.value {
                check_value(&what, v)?;
            }
        }
        let mut services = Vec::new();
        for s in &self.service_key_values {
            let what = format!("[[service_key_values]] {}", s.service);
            anyhow::ensure!(!s.service.trim().is_empty(), "{what}: service is required");
            anyhow::ensure!(!services.contains(&&s.service), "{what}: listed twice");
            services.push(&s.service);
            check_value(&what, &s.value)?;
        }
        Ok(())
    }

    /// The distribution seeds settings or keys (the server reads them from `distribution.toml`).
    pub fn has_seeds(&self) -> bool {
        !self.plugin_settings.is_empty() || !self.service_key_values.is_empty()
    }

    pub fn load(path: &Path) -> Result<Distribution> {
        let file = if path.is_dir() { path.join("distribution.toml") } else { path.to_path_buf() };
        let text = std::fs::read_to_string(&file).with_context(|| format!("reading {}", file.display()))?;
        let mut d: Distribution = toml::from_str(&text).with_context(|| format!("{}", file.display()))?;
        d.dir = file.parent().map(Path::to_path_buf).unwrap_or_else(root);
        d.dir = std::path::absolute(&d.dir).unwrap_or(d.dir);
        let dir = d.dir.clone();
        let abs = |p: &PathBuf| if p.is_relative() { dir.join(p) } else { p.clone() };
        d.plugins.roots = d.plugins.roots.iter().map(abs).collect();
        d.brand.dir = d.brand.dir.as_ref().map(abs);
        d.tests.cargo = d.tests.cargo.iter().map(abs).collect();
        // --- sidecars ---
        crate::sidecars::validate(&d.sidecars, d.desktop.port)
            .with_context(|| format!("{}", file.display()))?;
        // --- end sidecars ---
        d.check_seeds().with_context(|| format!("{}", file.display()))?;
        Ok(d)
    }

    pub fn includes(&self, id: &str) -> bool {
        self.plugins.include.iter().any(|i| i == "*" || i == id)
    }

    pub fn executable(&self) -> String {
        self.product.executable.clone().unwrap_or_else(|| self.product.id.clone())
    }
}

static CURRENT: OnceLock<Distribution> = OnceLock::new();

/// Sets the active distribution (global option `--dist`, `MOSAIKIT_DIST` or the one of mosaikit).
pub fn init(path: Option<PathBuf>) -> Result<()> {
    let path = path.or_else(|| std::env::var_os("MOSAIKIT_DIST").map(PathBuf::from)).unwrap_or_else(root);
    let d = Distribution::load(&path)?;
    let _ = CURRENT.set(d);
    Ok(())
}

pub fn current() -> &'static Distribution {
    CURRENT.get().expect("distribution not initialized")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(extra: &str) -> Result<Distribution> {
        let dir = std::env::temp_dir().join(format!("mk-dist-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("distribution.toml");
        std::fs::write(&f, format!("[product]\nid='p'\nname='P'\nversion='1'\n[plugins]\nroots=[]\n{extra}"))
            .unwrap();
        let r = Distribution::load(&f);
        let _ = std::fs::remove_dir_all(&dir);
        r
    }

    #[test]
    fn seed_sections_are_validated() {
        let d = load(
            "[[plugin_settings]]\nplugin='a.b'\nkey='token'\nvalue='env:A_TOKEN'\n\
             [[plugin_settings]]\nplugin='a.b'\nkey='n'\nvalue=3\n\
             [[service_key_values]]\nservice='translate'\nvalue='file:/run/secrets/t'\nshared=true\n",
        )
        .unwrap();
        assert!(d.has_seeds());
        for bad in [
            "[[plugin_settings]]\nplugin='a.b'\nkey='k'\nvalue='v'\nextra=1\n",
            "[[plugin_settings]]\nplugin='a.b'\nkey='k'\nvalue='env:'\n",
            "[[plugin_settings]]\nplugin='a.b'\nkey='k'\nvalue='env:A B'\n",
            "[[plugin_settings]]\nplugin='a.b'\nkey='k'\nvalue='file:'\n",
            "[[plugin_settings]]\nplugin='a.b'\nkey='k'\nvalue='1'\n[[plugin_settings]]\nplugin='a.b'\nkey='k'\nvalue='2'\n",
            "[[plugin_settings]]\nplugin='a.b'\nkey='x:y'\nvalue='1'\n",
            "[[service_key_values]]\nservice=''\nvalue='x'\n",
            "[[service_key_values]]\nservice='s'\nvalue='x'\nbogus=true\n",
        ] {
            assert!(load(bad).is_err(), "{bad}");
        }
        assert!(!load("").unwrap().has_seeds());
    }
}
