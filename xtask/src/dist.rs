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

impl Distribution {
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
