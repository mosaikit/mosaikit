//! The `distribution.toml` of a product, as the tool reads it. The tool does not link the kernel: the checks of the
//! policy sections (`[defaults]`, `[locked]`, ...) are made by the base itself (`mosaikit-server check-distribution`,
//! see `validate`); here only what the tool needs to build and to start.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use mosaikit_plugin_cli::Plugin;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Product {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// the versions of the base the product release works with, as a range
    #[serde(default)]
    pub base: Option<String>,
    /// name of the desktop executable (without .exe)
    #[serde(default)]
    pub executable: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Brand {
    #[serde(default)]
    pub dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plugins {
    /// folders that contain plugins: a plugin folder itself, or a folder of plugin folders
    #[serde(default)]
    pub roots: Vec<PathBuf>,
    /// ids of the plugins of the release (`"*"`: every one found in the roots). An id that is not in the roots is an
    /// official plugin, taken from the registry of the base
    #[serde(default)]
    pub include: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Desktop {
    /// "sqlite" (default) or "postgres" (embedded)
    #[serde(default = "sqlite")]
    pub database: String,
    #[serde(default = "port")]
    pub port: u16,
}

impl Default for Desktop {
    fn default() -> Desktop {
        Desktop { database: sqlite(), port: port() }
    }
}

fn sqlite() -> String {
    "sqlite".into()
}
fn port() -> u16 {
    48080
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Docker {
    /// name of the image of the product (default: the id)
    #[serde(default)]
    pub image: Option<String>,
    /// image of the database (default: postgres:17-alpine; e.g. a PostGIS image)
    #[serde(default)]
    pub postgres_image: Option<String>,
    /// also run Keycloak with a realm of the product and a sample tenant that signs in through it (a demonstration)
    #[serde(default)]
    pub keycloak: bool,
    /// compose files of the product (services next to the product: a map server, a catalogue, a worker), laid over the
    /// generated `compose.yml` of the release: `docker compose up -d` starts all of them
    #[serde(default)]
    pub compose_files: Vec<String>,
    /// files and folders of the product copied into the release with the same relative path (what the compose files above
    /// mount or build: configuration, an image context)
    #[serde(default)]
    pub copy: Vec<String>,
}

impl Docker {
    /// A path of `compose_files` or `copy`: relative, inside the folder of the product.
    pub fn safe_path(p: &str) -> bool {
        let path = std::path::Path::new(p);
        !p.trim().is_empty()
            && path.is_relative()
            && !path.components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir
                        | std::path::Component::Prefix(_)
                        | std::path::Component::RootDir
                )
            })
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Distribution {
    pub product: Product,
    #[serde(default)]
    pub brand: Brand,
    #[serde(default)]
    pub plugins: Plugins,
    #[serde(default)]
    pub desktop: Desktop,
    #[serde(default)]
    pub docker: Docker,
    // The tables below are read by the base or by other tools; they are named here only so that a table
    // that nobody reads (a typo such as `[quota_defaults]`) is refused instead of silently ignored.
    #[serde(default)]
    pub tests: Option<toml::Value>,
    /// extra processes started with the desktop application (see `docs/devkit/manifest.md`)
    #[serde(default)]
    pub sidecars: Vec<mosaikit_sidecars::Sidecar>,
    #[serde(default)]
    pub plugin_settings: Option<toml::Value>,
    #[serde(default)]
    pub service_key_values: Option<toml::Value>,
    #[serde(default)]
    pub nav_groups: Option<toml::Value>,
    #[serde(default)]
    pub defaults: Option<toml::Value>,
    #[serde(default)]
    pub locked: Option<toml::Value>,
    #[serde(default)]
    pub languages: Option<toml::Value>,
    #[serde(default)]
    pub bootstrap: Option<toml::Value>,
    #[serde(default)]
    pub database: Option<toml::Value>,
    #[serde(default)]
    pub about: Option<toml::Value>,
    /// folder of the file (to resolve the relative paths)
    #[serde(skip)]
    pub dir: PathBuf,
}

impl Distribution {
    /// Reads the `distribution.toml` of a folder (or the file itself).
    pub fn load(path: &Path) -> Result<Distribution> {
        let file = if path.is_dir() { path.join("distribution.toml") } else { path.to_path_buf() };
        let text = std::fs::read_to_string(&file).with_context(|| format!("reading {}", file.display()))?;
        let mut d: Distribution = toml::from_str(&text)
            .with_context(|| format!("{}: not a valid distribution.toml", file.display()))?;
        d.dir = std::path::absolute(file.parent().unwrap_or(Path::new(".")))?;
        let id_ok = !d.product.id.is_empty()
            && d.product.id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
        if !id_ok {
            bail!("[product] id = \"{}\": lower case letters, digits and '-' only", d.product.id);
        }
        mosaikit_sidecars::validate(&d.sidecars, d.desktop.port)
            .with_context(|| format!("{}", file.display()))?;
        mosaikit_sidecars::check_file_sources(&d.sidecars, &d.dir)
            .with_context(|| format!("{}", file.display()))?;
        Ok(d)
    }

    pub fn file(&self) -> PathBuf {
        self.dir.join("distribution.toml")
    }

    pub fn executable(&self) -> String {
        self.product.executable.clone().unwrap_or_else(|| self.product.id.clone())
    }

    pub fn image(&self) -> String {
        self.docker.image.clone().unwrap_or_else(|| self.product.id.clone())
    }

    pub fn brand_dir(&self) -> Option<PathBuf> {
        self.brand.dir.as_ref().map(|d| self.dir.join(d)).filter(|d| d.is_dir())
    }

    /// The plugin folders of the roots (own plugins), whatever `include` says.
    pub fn own_plugins(&self) -> Result<Vec<Plugin>> {
        let mut out: Vec<Plugin> = Vec::new();
        for r in &self.plugins.roots {
            let root = self.dir.join(r);
            if !root.is_dir() {
                bail!("[plugins] roots: {} is not a folder", root.display());
            }
            let dirs: Vec<PathBuf> = if root.join("plugin.toml").is_file() {
                vec![root]
            } else {
                let mut v: Vec<PathBuf> = std::fs::read_dir(&root)?
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.join("plugin.toml").is_file())
                    .collect();
                v.sort();
                v
            };
            for d in dirs {
                let p = Plugin::load(&d)?;
                if !out.iter().any(|o| o.id == p.id) {
                    out.push(p);
                }
            }
        }
        Ok(out)
    }

    /// Whether the release includes the plugin `id` (`include` empty or `"*"`: every one).
    pub fn includes(&self, id: &str) -> bool {
        self.plugins.include.is_empty() || self.plugins.include.iter().any(|i| i == "*" || i == id)
    }

    /// The own plugins of the release.
    pub fn release_plugins(&self) -> Result<Vec<Plugin>> {
        Ok(self.own_plugins()?.into_iter().filter(|p| self.includes(&p.id)).collect())
    }

    /// The ids of `include` that name no own plugin: the official plugins to take from the base.
    pub fn official_ids(&self) -> Result<Vec<String>> {
        let own: Vec<String> = self.own_plugins()?.into_iter().map(|p| p.id).collect();
        Ok(self.plugins.include.iter().filter(|i| *i != "*" && !own.contains(i)).cloned().collect())
    }

    /// Whether the release takes every official plugin of the base (`include` empty or has `"*"` and no roots).
    pub fn all_official(&self) -> bool {
        self.plugins.roots.is_empty()
            && (self.plugins.include.is_empty() || self.plugins.include.iter().any(|i| i == "*"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_distribution_and_finds_its_plugins() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(
            t.path().join("distribution.toml"),
            "[product]\nid = \"acme\"\nname = \"Acme\"\nversion = \"1.0.0\"\n[plugins]\nroots = [\"plugins\"]\ninclude = [\"com.acme.a\", \"com.mosaikit.notes\"]\n",
        )
        .unwrap();
        let p = t.path().join("plugins").join("a");
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("plugin.toml"), "id = \"com.acme.a\"\nname = \"A\"\nversion = \"0.1.0\"\n")
            .unwrap();
        let d = Distribution::load(t.path()).unwrap();
        assert_eq!(d.executable(), "acme");
        assert_eq!(d.release_plugins().unwrap().len(), 1);
        assert_eq!(d.official_ids().unwrap(), ["com.mosaikit.notes"]);
        assert!(!d.all_official());
    }

    #[test]
    fn the_id_is_checked() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(
            t.path().join("distribution.toml"),
            "[product]\nid = \"Acme!\"\nname = \"A\"\nversion = \"1\"\n",
        )
        .unwrap();
        assert!(Distribution::load(t.path()).is_err());
    }

    #[test]
    fn a_table_or_key_nobody_reads_is_refused() {
        let t = tempfile::tempdir().unwrap();
        let head = "[product]
id = \"acme\"
name = \"Acme\"
version = \"1.0.0\"
";
        let load = |extra: &str| {
            std::fs::write(t.path().join("distribution.toml"), format!("{head}{extra}")).unwrap();
            Distribution::load(t.path())
        };
        assert!(load(
            "[bootstrap]
tenant = \"acme\"
[nav_groups_typo]
x = 1
"
        )
        .is_err());
        assert!(load(
            "[quota_defaults]
people = 5
"
        )
        .is_err());
        assert!(load(
            "[desktop]
prot = 1
"
        )
        .is_err());
        assert!(load(
            "[bootstrap]
tenant = \"acme\"
[[nav_groups]]
id = \"a\"
[about]
text = \"x\"
"
        )
        .is_ok());
    }
}
