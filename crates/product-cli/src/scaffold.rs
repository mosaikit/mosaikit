//! `new`: a standalone product folder.

use std::path::{Path, PathBuf};

use anyhow::{bail, Result};

fn write(root: &Path, rel: &str, text: &str) -> Result<()> {
    let p = root.join(rel);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(p, text)?;
    Ok(())
}

/// A product folder `<into>/<name>`; the id is the name, the product name is the name with capitals.
pub fn new_product(name: &str, into: &Path) -> Result<PathBuf> {
    let id_ok =
        !name.is_empty() && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !id_ok {
        bail!("the name of a product is lower case letters, digits and '-' (it is the id: file names and Docker image)");
    }
    let root = into.join(name);
    if root.exists() {
        bail!("{} already exists", root.display());
    }
    let title: String = name
        .split('-')
        .filter(|w| !w.is_empty())
        .map(|w| w[..1].to_uppercase() + &w[1..])
        .collect::<Vec<_>>()
        .join(" ");
    write(
        &root,
        "distribution.toml",
        &format!(
            r#"# The product {title}: built on a compiled Mosaikit with `mosaikit-product build`.
# Every table of this file is described in docs/devkit/building-an-application.md.

[product]
# technical identifier: names of the release files and of the Docker image
id = "{name}"
# name shown to users (title, sign-in, icon in the notification area)
name = "{title}"
# version of the product
version = "0.1.0"
description = "{title}, built on Mosaikit"
# the versions of the base this release works with; the base refuses to start outside the range
base = ">=1.0, <2"
# name of the desktop executable (without .exe)
executable = "{name}"

[brand]
dir = "branding"

[plugins]
# folders that contain your own plugins (a plugin folder, or a folder of plugin folders)
roots = ["plugins"]
# the plugins of the release: your own by id, the official ones you keep by id ("*": every one of the roots)
include = ["*"]

[desktop]
# "sqlite" (a single file) or "postgres" (embedded)
database = "sqlite"
port = 48080

[docker]
# image of the product (default: the id) and of the database (a PostGIS image, for example)
image = "{name}"
# postgres_image = "postgis/postgis:17-3.5-alpine"

# ---- identity, defaults and first start (optional) ----
# [defaults]                       # values of the settings of the platform, in place of the built-in ones
# "identity.welcome" = "Welcome to {title}"
# [locked]                         # settings nobody can change
# keys = ["identity.name"]
# [languages]
# enabled = ["en", "it"]
# default = "en"
# [bootstrap]                      # first start
# tenant = "main"
# tenant_name = "{title}"
# trial_days = 30
# [database]
# extensions = ["postgis"]         # PostgreSQL extensions the product needs (checked at start)
# [about]
# licence = "Proprietary"
# text = "Support: support@example.com"
"#
        ),
    )?;
    write(
        &root,
        "branding/brand.toml",
        &format!(
            "# brand of {title}: name, texts and colours (every property is optional)\nname = \"{title}\"\ntagline = \"built on Mosaikit\"\n# logo = \"logo.svg\"\n# favicon = \"favicon.svg\"\n# icon = \"icon.ico\"\n\n[colors]\n# accent = \"#5b5fc7\"\n"
        ),
    )?;
    write(
        &root,
        "plugins/README.md",
        "Your own plugins, one folder each (`mosaikit-plugin new <name> --into plugins`).\nThe official plugins you keep are named in `[plugins] include` of `distribution.toml`.\n",
    )?;
    write(&root, "shared/README.md", "Code used by several of your plugins (a Rust crate, an npm package): a plugin refers to it by path.\n")?;
    write(&root, "tests/README.md", "Tests of the product itself: `mosaikit-product test` runs the checks of the kit; put your own scripts here.\n")?;
    write(&root, ".gitignore", "dist/\n.mosaikit-product/\nnode_modules/\ntarget/\n*.key\n")?;
    write(
        &root,
        ".github/workflows/ci.yml",
        r#"name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # the kit (mosaikit-plugin, mosaikit-product and the server) must be on the PATH: see docs/devkit/getting-started.md
      - run: mosaikit-product validate .
      - run: mosaikit-product test .
"#,
    )?;
    write(
        &root,
        "README.md",
        &format!(
            "# {title}\n\nA product built on Mosaikit.\n\n```text\nmosaikit-product validate          check the product\nmosaikit-product dev               start it with the brand and the plugins loaded from their folders\nmosaikit-product build desktop --base <desktop kit folder>\nmosaikit-product build docker  --base-image ghcr.io/mosaikit/mosaikit:v<version of the base>\n```\n"
        ),
    )?;
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_product_loads_and_has_a_brand() {
        let t = tempfile::tempdir().unwrap();
        let root = new_product("acme-maps", t.path()).unwrap();
        let d = crate::Distribution::load(&root).unwrap();
        assert_eq!(d.product.name, "Acme Maps");
        assert_eq!(d.executable(), "acme-maps");
        assert!(d.brand_dir().is_some());
        assert!(new_product("acme-maps", t.path()).is_err(), "never over an existing folder");
        assert!(new_product("Acme Maps", t.path()).is_err());
    }
}
