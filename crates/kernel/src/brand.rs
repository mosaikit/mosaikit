//! Marchio del prodotto: nome, versione, testi, logo, favicon, colori.
//!
//! Una distribuzione basata su Mosaikit fornisce una cartella con
//! `brand.toml` e i file indicati; senza cartella si usa il marchio Mosaikit.
//! Vedi `branding/brand.toml` per l'elenco delle proprieta'.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Brand {
    /// nome del prodotto (titolo della pagina, login, area di notifica)
    #[serde(default = "d_name")]
    pub name: String,
    /// versione del prodotto (default: quella di Mosaikit)
    #[serde(default)]
    pub version: Option<String>,
    /// frase sotto il nome nella pagina di accesso
    #[serde(default = "d_tagline")]
    pub tagline: String,
    /// messaggio nella pagina di accesso (es. a chi rivolgersi per un account)
    #[serde(default)]
    pub login_message: String,
    /// testo a pie' di pagina (es. copyright)
    #[serde(default)]
    pub footer: String,
    /// indirizzo di supporto o documentazione
    #[serde(default)]
    pub support_url: Option<String>,
    /// file del logo nella cartella del marchio (svg, png, webp)
    #[serde(default)]
    pub logo: Option<String>,
    /// file della favicon (svg, png, ico)
    #[serde(default)]
    pub favicon: Option<String>,
    /// icona per l'area di notifica e l'eseguibile desktop (ico)
    #[serde(default)]
    pub icon: Option<String>,
    /// colori del tema: accent, bg, panel, panel2, line, fg, dim, ok, err
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
    #[serde(skip)]
    pub dir: Option<PathBuf>,
}

fn d_name() -> String {
    "Mosaikit".into()
}
fn d_tagline() -> String {
    "applicazioni, dati e condivisione per ogni tenant".into()
}

impl Default for Brand {
    fn default() -> Brand {
        toml::from_str("").expect("marchio di default")
    }
}

/// Colori ammessi e variabile CSS corrispondente.
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

/// Solo `#rgb`, `#rrggbb`, `#rrggbbaa`: niente CSS arbitrario nella pagina.
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

/// File della cartella del marchio: solo nomi semplici, niente percorsi.
fn safe_file(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && !name.starts_with('.') && name.len() < 128
}

impl Brand {
    /// Legge `<dir>/brand.toml` e verifica colori e file.
    pub fn load(dir: &Path) -> Result<Brand> {
        let file = dir.join("brand.toml");
        let text =
            std::fs::read_to_string(&file).map_err(|e| Error::bad(format!("{}: {e}", file.display())))?;
        let mut b: Brand =
            toml::from_str(&text).map_err(|e| Error::bad(format!("{}: {e}", file.display())))?;
        for (k, v) in &b.colors {
            if !COLORS.iter().any(|(n, _)| n == k) {
                return Err(Error::bad(format!("brand.toml: colore sconosciuto {k}")));
            }
            if hex_color(v).is_none() {
                return Err(Error::bad(format!("brand.toml: colore {k} non valido: {v} (atteso #rrggbb)")));
            }
        }
        for f in [&b.logo, &b.favicon, &b.icon].into_iter().flatten() {
            if !safe_file(f) || !dir.join(f).is_file() {
                return Err(Error::bad(format!("brand.toml: file {f} non trovato in {}", dir.display())));
            }
        }
        b.dir = Some(dir.to_path_buf());
        Ok(b)
    }

    pub fn version(&self) -> &str {
        self.version.as_deref().unwrap_or(crate::KERNEL_VERSION)
    }

    /// Regole CSS con i colori del marchio (anche le varianti trasparenti dell'accento).
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

    /// Percorso di un file del marchio (logo, favicon, icona), se configurato.
    pub fn file(&self, which: &str) -> Option<PathBuf> {
        let name = match which {
            "logo" => self.logo.as_ref(),
            "favicon" => self.favicon.as_ref(),
            "icon" => self.icon.as_ref(),
            _ => None,
        }?;
        Some(self.dir.as_ref()?.join(name))
    }

    /// Dati pubblici per la UI (pagina di accesso compresa).
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
    fn colori_validati_e_css() {
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
            "[colors]\nsfondo = \"#000\"",
            "logo = \"../segreto.svg\"",
            "logo = \"manca.svg\"",
        ] {
            std::fs::write(dir.path().join("brand.toml"), bad).unwrap();
            assert!(Brand::load(dir.path()).is_err(), "{bad}");
        }
        assert_eq!(Brand::default().name, "Mosaikit");
        assert_eq!(Brand::default().css(), "");
    }
}
