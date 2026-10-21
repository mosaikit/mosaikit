//! Distribuzione: cosa compone un prodotto basato su Mosaikit (nome, versione,
//! branding, plugin inclusi, cartelle dei plugin). Mosaikit stesso e' la
//! distribuzione di default (`distribution.toml` nella radice); un prodotto
//! derivato ha la propria nel suo progetto (`cargo xtask --dist ../<prodotto> ...`).

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
    /// cartella del file (per risolvere i percorsi relativi)
    #[serde(skip)]
    pub dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Product {
    /// identificatore tecnico (nomi di file, immagine Docker): minuscole, cifre, '-'
    pub id: String,
    /// nome mostrato agli utenti
    pub name: String,
    /// versione del prodotto (puo' differire da quella di Mosaikit)
    pub version: String,
    #[serde(default)]
    #[allow(dead_code)] // documentazione del prodotto
    pub description: String,
    /// nome dell'eseguibile desktop (senza .exe)
    #[serde(default)]
    pub executable: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Brand {
    /// cartella con brand.toml, logo, favicon, icone (relativa al file)
    #[serde(default)]
    pub dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plugins {
    /// cartelle che contengono plugin (ognuna con il proprio workspace Cargo e npm)
    pub roots: Vec<PathBuf>,
    /// id dei plugin da includere; "*" = tutti quelli trovati nelle cartelle
    #[serde(default = "all")]
    pub include: Vec<String>,
}

fn all() -> Vec<String> {
    vec!["*".into()]
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Desktop {
    /// database della versione desktop: "sqlite" (default) o "postgres" (PostgreSQL embedded)
    #[serde(default = "sqlite")]
    pub database: String,
    /// porta dell'app desktop (quella dei plugin e' la successiva)
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

/// Test propri della distribuzione (oltre a quelli di mosaikit e dei plugin).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tests {
    /// cartelle con un progetto Cargo di test di integrazione (`cargo test` con PostgreSQL)
    #[serde(default)]
    pub cargo: Vec<PathBuf>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Docker {
    /// nome dell'immagine (default: id del prodotto)
    #[serde(default)]
    pub image: Option<String>,
    /// immagine PostgreSQL del compose (es. postgis/postgis:17-3.5 se servono dati geospaziali)
    #[serde(default)]
    pub postgres_image: Option<String>,
}

impl Distribution {
    pub fn load(path: &Path) -> Result<Distribution> {
        let file = if path.is_dir() { path.join("distribution.toml") } else { path.to_path_buf() };
        let text =
            std::fs::read_to_string(&file).with_context(|| format!("lettura di {}", file.display()))?;
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

/// Imposta la distribuzione attiva (opzione globale `--dist`, `MOSAIKIT_DIST` o quella di mosaikit).
pub fn init(path: Option<PathBuf>) -> Result<()> {
    let path = path.or_else(|| std::env::var_os("MOSAIKIT_DIST").map(PathBuf::from)).unwrap_or_else(root);
    let d = Distribution::load(&path)?;
    let _ = CURRENT.set(d);
    Ok(())
}

pub fn current() -> &'static Distribution {
    CURRENT.get().expect("distribuzione non inizializzata")
}
