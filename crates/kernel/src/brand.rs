//! Brand of the product: name, version, texts, logo, favicon, colours.
//!
//! A distribution based on Mosaikit provides a folder with
//! `brand.toml` and the files it names; without a folder the Mosaikit brand is used.
//! See `branding/brand.toml` for the list of properties.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Brand {
    /// name of the product (page title, sign-in, notification area)
    #[serde(default = "d_name")]
    pub name: String,
    /// version of the product (default: the one of Mosaikit)
    #[serde(default)]
    pub version: Option<String>,
    /// phrase under the name on the sign-in page
    #[serde(default = "d_tagline")]
    pub tagline: String,
    /// message on the sign-in page (e.g. whom to ask for an account)
    #[serde(default)]
    pub login_message: String,
    /// footer text (e.g. copyright)
    #[serde(default)]
    pub footer: String,
    /// support or documentation address
    #[serde(default)]
    pub support_url: Option<String>,
    /// file of the logo in the brand folder (svg, png, webp)
    #[serde(default)]
    pub logo: Option<String>,
    /// file of the favicon (svg, png, ico)
    #[serde(default)]
    pub favicon: Option<String>,
    /// icon for the notification area and the desktop executable (ico)
    #[serde(default)]
    pub icon: Option<String>,
    /// colours of the theme: accent, bg, panel, panel2, line, fg, dim, ok, err
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
    #[serde(skip)]
    pub dir: Option<PathBuf>,
}

fn d_name() -> String {
    "Mosaikit".into()
}
fn d_tagline() -> String {
    "apps, data and sharing for every tenant".into()
}

impl Default for Brand {
    fn default() -> Brand {
        toml::from_str("").expect("default brand")
    }
}

/// Allowed colours and the matching CSS variable.
const COLORS: &[(&str, &str)] = &[
    ("accent", "--acc"),
    ("bg", "--bg"),
    ("panel", "--panel"),
    ("panel2", "--panel2"),
    ("line", "--line"),
    ("fg", "--fg"),
    ("dim", "--dim"),
    ("ok", "--ok"),
    ("err", "--err"),
];

/// Only `#rgb`, `#rrggbb`, `#rrggbbaa`: no arbitrary CSS in the page.
fn hex_color(v: &str) -> Option<(u8, u8, u8)> {
    let h = v.strip_prefix('#')?;
    if !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let p = |s: &str| u8::from_str_radix(s, 16).ok();
    match h.len() {
        3 => {
            let c: Vec<String> = h.chars().map(|c| format!("{c}{c}")).collect();
            Some((p(&c[0])?, p(&c[1])?, p(&c[2])?))
        }
        6 | 8 => Some((p(&h[0..2])?, p(&h[2..4])?, p(&h[4..6])?)),
        _ => None,
    }
}

/// File of the brand folder: plain names only, no paths.
fn safe_file(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && !name.starts_with('.') && name.len() < 128
}

impl Brand {
    /// Reads `<dir>/brand.toml` and checks colours and files.
    pub fn load(dir: &Path) -> Result<Brand> {
        let file = dir.join("brand.toml");
        let text =
            std::fs::read_to_string(&file).map_err(|e| Error::bad(format!("{}: {e}", file.display())))?;
        let mut b: Brand =
            toml::from_str(&text).map_err(|e| Error::bad(format!("{}: {e}", file.display())))?;
        for (k, v) in &b.colors {
            if !COLORS.iter().any(|(n, _)| n == k) {
                return Err(Error::bad(format!("brand.toml: unknown colour {k}")));
            }
            if hex_color(v).is_none() {
                return Err(Error::bad(format!("brand.toml: invalid colour {k}: {v} (expected #rrggbb)")));
            }
        }
        for f in [&b.logo, &b.favicon, &b.icon].into_iter().flatten() {
            if !safe_file(f) || !dir.join(f).is_file() {
                return Err(Error::bad(format!("brand.toml: file {f} not found in {}", dir.display())));
            }
        }
        b.dir = Some(dir.to_path_buf());
        Ok(b)
    }

    pub fn version(&self) -> &str {
        self.version.as_deref().unwrap_or(crate::KERNEL_VERSION)
    }

    /// CSS rules with the colours of the brand (the transparent variants of the accent too).
    pub fn css(&self) -> String {
        let mut out = String::new();
        for (k, var) in COLORS {
            if let Some(v) = self.colors.get(*k) {
                out.push_str(&format!("{var}:{v};"));
                if *k == "accent" {
                    if let Some((r, g, b)) = hex_color(v) {
                        out.push_str(&format!(
                            "--acc-soft:rgba({r},{g},{b},0.12);--acc-line:rgba({r},{g},{b},0.45);--acc-glow:rgba({r},{g},{b},0.22);"
                        ));
                    }
                }
            }
        }
        if out.is_empty() {
            String::new()
        } else {
            format!(":root{{{out}}}")
        }
    }

    /// Path of a brand file (logo, favicon, icon), if configured.
    pub fn file(&self, which: &str) -> Option<PathBuf> {
        let name = match which {
            "logo" => self.logo.as_ref(),
            "favicon" => self.favicon.as_ref(),
            "icon" => self.icon.as_ref(),
            _ => None,
        }?;
        Some(self.dir.as_ref()?.join(name))
    }

    /// Public data for the UI (sign-in page included).
    pub fn public(&self) -> serde_json::Value {
        serde_json::json!({
            "name": self.name,
            "version": self.version(),
            "kernel_version": crate::KERNEL_VERSION,
            "tagline": self.tagline,
            "login_message": self.login_message,
            "footer": self.footer,
            "support_url": self.support_url,
            "logo": self.logo.is_some(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validated_colours_and_css() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("logo.svg"), "<svg/>").unwrap();
        std::fs::write(
            dir.path().join("brand.toml"),
            "name = \"Atlante\"\nversion = \"2.1.0\"\nlogo = \"logo.svg\"\n[colors]\naccent = \"#1e88e5\"\n",
        )
        .unwrap();
        let b = Brand::load(dir.path()).unwrap();
        assert_eq!(b.name, "Atlante");
        assert_eq!(b.version(), "2.1.0");
        assert!(b.css().contains("--acc:#1e88e5;--acc-soft:rgba(30,136,229,0.12)"));
        assert!(b.file("logo").unwrap().ends_with("logo.svg"));

        for bad in [
            "[colors]\naccent = \"red;}body{display:none\"",
            "[colors]\nbackground = \"#000\"",
            "logo = \"../secret.svg\"",
            "logo = \"missing.svg\"",
        ] {
            std::fs::write(dir.path().join("brand.toml"), bad).unwrap();
            assert!(Brand::load(dir.path()).is_err(), "{bad}");
        }
        assert_eq!(Brand::default().name, "Mosaikit");
        assert_eq!(Brand::default().css(), "");
    }
}
