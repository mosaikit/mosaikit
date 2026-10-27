//! Layouts of the shell (phase 10): how the slots are arranged. Two are built in, Teams (a rail of
//! icons with their names) and Console (a band with the breadcrumb and a sidebar card with groups that
//! open); the others come from layout plugins (`kind = "layout"`, `layout/layout.toml`), which are
//! declarative: an arrangement from the vocabulary of the shell, default style, a checked stylesheet and
//! images.
//!
//! The settings are the ones on three levels (`levels.rs`): `layout` (customizable: the platform's,
//! or the tenant's when the Administrator lets tenants customize it), `layout.allowed` (the layouts
//! tenants may choose, managed by the platform; none: every one), the style variables `style.*` and the
//! band image (`style.band_image`, a PNG checked for the contrast of the band texts).

use std::collections::BTreeMap;

use mosaikit_mskp::layout::{
    BandDecl, LayoutDecl, NavStyleDecl, Pattern, PhoneDecl, PhoneNav, SearchPlace, TenantPlace,
};
use mosaikit_mskp::PluginKind;
use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use super::levels::effective;
use crate::{Error, Kernel, Result};

/// Id of the layout every installation has and uses by default.
pub const DEFAULT_LAYOUT: &str = "teams";

/// A layout as the shell and the settings pages see it.
#[derive(Debug, Clone, Serialize)]
pub struct LayoutInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub built_in: bool,
    pub decl: LayoutDecl,
    /// the class of the shell that scopes its stylesheet
    pub class: String,
    pub has_css: bool,
    /// the image under the band, if the package has one (`api/layouts/<id>/images/<name>`)
    pub band_image: Option<String>,
}

fn built_in(id: &str, name: &str, description: &str, decl: LayoutDecl) -> LayoutInfo {
    LayoutInfo {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        built_in: true,
        class: mosaikit_mskp::layout::layout_class(id),
        decl,
        has_css: false,
        band_image: None,
    }
}

/// The built-in layouts, with their texts in `lang`.
fn built_ins(lang: &str) -> Vec<LayoutInfo> {
    let it = lang.starts_with("it");
    vec![
        built_in(
            "teams",
            "Teams",
            if it {
                "Barra in alto, rail di icone con i loro nomi, pannelli a lato"
            } else {
                "Top band, rail of icons with their names, panels at the side"
            },
            LayoutDecl {
                pattern: Pattern::Rail,
                band: BandDecl::default(),
                nav: NavStyleDecl::default(),
                phone: PhoneDecl::default(),
                style: BTreeMap::new(),
                band_image: None,
            },
        ),
        built_in(
            "console",
            "Console",
            if it {
                "Barra scura con il percorso, una sidebar staccata con gruppi che si aprono"
            } else {
                "Dark band with the breadcrumb, a floating sidebar with groups that open"
            },
            LayoutDecl {
                pattern: Pattern::Sidebar,
                band: BandDecl {
                    brand: true,
                    breadcrumb: true,
                    search: SearchPlace::Center,
                    tenant: TenantPlace::Nav,
                },
                nav: NavStyleDecl { card: true },
                phone: PhoneDecl { nav: PhoneNav::Drawer },
                style: BTreeMap::new(),
                band_image: None,
            },
        ),
    ]
}

/// Every layout the installation has: the built-in ones and the active layout plugins.
pub fn list(k: &Kernel, lang: &str) -> Vec<LayoutInfo> {
    let mut out = built_ins(lang);
    for p in k.plugins.list() {
        if !p.is_active() || p.manifest.effective_kind() != PluginKind::Layout {
            continue;
        }
        let Some(l) = &p.layout else { continue };
        let m = p.manifest.localized(lang);
        out.push(LayoutInfo {
            id: p.id.clone(),
            name: m.contribution.label.clone(),
            description: m.description.clone(),
            built_in: false,
            class: mosaikit_mskp::layout::layout_class(&p.id),
            decl: l.decl.clone(),
            has_css: !l.css.is_empty(),
            band_image: l.decl.band_image.clone(),
        });
    }
    out
}

fn exists(k: &Kernel, id: &str) -> bool {
    list(k, "en").iter().any(|l| l.id == id)
}

/// The layouts tenants may choose (`None`: every one), from the settings of the platform.
pub fn allowed_in(platform: &serde_json::Map<String, Value>) -> Option<Vec<String>> {
    platform.get("layout.allowed").and_then(|v| serde_json::from_value(v.clone()).ok())
}

/// Checks a choice of a layout before it is saved: it must exist and, for a tenant, be allowed.
pub(super) async fn check_choice(k: &Kernel, tenant: bool, v: &Value) -> Result<()> {
    let id = v.as_str().unwrap_or_default();
    if !exists(k, id) {
        return Err(Error::bad(format!("no layout '{id}'")).with_code("layout_unknown"));
    }
    if tenant {
        let platform = effective(k, None).await?;
        let platform_layout = platform.get("layout").and_then(Value::as_str).unwrap_or(DEFAULT_LAYOUT);
        if id != platform_layout && allowed_in(&platform).is_some_and(|a| !a.iter().any(|x| x == id)) {
            return Err(Error::forbidden(format!("layout '{id}' not allowed to tenants"))
                .with_code("layout_not_allowed"));
        }
    }
    Ok(())
}

/// Checks the list of the layouts tenants may choose: every id must exist.
pub(super) fn check_allowed(k: &Kernel, v: &Value) -> Result<()> {
    let list = v.as_array().ok_or_else(|| Error::bad("a list of layouts").with_code("setting_invalid"))?;
    for id in list {
        let id = id.as_str().unwrap_or_default();
        if !exists(k, id) {
            return Err(Error::bad(format!("no layout '{id}'")).with_code("layout_unknown"));
        }
    }
    Ok(())
}

/// The layout in use for the platform (`None`) or a tenant: the tenant's choice when it exists and is
/// still allowed, otherwise the platform's, otherwise Teams.
pub async fn in_use(k: &Kernel, tenant: Option<Uuid>) -> Result<String> {
    let platform = effective(k, None).await?;
    let platform_layout = platform
        .get("layout")
        .and_then(Value::as_str)
        .filter(|id| exists(k, id))
        .unwrap_or(DEFAULT_LAYOUT)
        .to_string();
    let Some(t) = tenant else { return Ok(platform_layout) };
    let own = effective(k, Some(t)).await?;
    let choice = own.get("layout").and_then(Value::as_str).unwrap_or_default();
    let allowed = allowed_in(&platform);
    let ok = exists(k, choice)
        && (choice == platform_layout || allowed.is_none_or(|a| a.iter().any(|x| x == choice)));
    Ok(if ok { choice.to_string() } else { platform_layout })
}

/// The stylesheet of a layout plugin (already scoped), if it has one.
pub fn css(k: &Kernel, id: &str) -> Option<String> {
    let p = k.plugins.get(id).filter(|p| p.is_active())?;
    p.layout.as_ref().map(|l| l.css.clone()).filter(|c| !c.is_empty())
}

/// An image of a layout plugin and its type.
pub fn image(k: &Kernel, id: &str, name: &str) -> Option<(Vec<u8>, &'static str)> {
    let p = k.plugins.get(id).filter(|p| p.is_active())?;
    p.layout.as_ref()?.images.get(name).cloned()
}

// ------------------------------------------------------------------ band image and its contrast

/// Bands of the built-in themes (light and dark) and their text, as in the CSS of the shell.
const BUILT_IN_BANDS: &[(&str, [&str; 2], &str)] = &[
    ("mosaikit", ["#444791", "#2b2b40"], "#ffffff"),
    ("italia", ["#0066cc", "#0a3d73"], "#ffffff"),
    ("tessera", ["#6e1522", "#4a0e17"], "#ffffff"),
];

/// The band colours of the theme in use: `(band, text)` in light and dark mode.
pub async fn band_colors(k: &Kernel, tenant: Option<Uuid>) -> Result<Vec<([u8; 3], [u8; 3])>> {
    let preset = match tenant {
        Some(t) => super::settings::tenant_theme(k, t).await?.preset,
        None => super::settings::platform_theme(k).await?,
    };
    let mut out = Vec::new();
    if let Some((_, bands, fg)) = BUILT_IN_BANDS.iter().find(|(id, _, _)| *id == preset) {
        for b in bands {
            out.push((hex(b).unwrap_or([0, 0, 0]), hex(fg).unwrap_or([255, 255, 255])));
        }
        return Ok(out);
    }
    let mut themes = super::themes::platform_themes(k).await?;
    if let Some(t) = tenant {
        themes.extend(super::themes::tenant_themes(k, t).await?);
    }
    if let Some(t) = themes.into_iter().find(|t| t.id == preset) {
        for vars in [&t.light, &t.dark] {
            let b = vars.get("--band").and_then(|v| hex(v));
            let f = vars.get("--band-foreground").and_then(|v| hex(v));
            if let (Some(b), Some(f)) = (b, f) {
                out.push((b, f));
            }
        }
    }
    if out.is_empty() {
        out.push(([0x44, 0x47, 0x91], [255, 255, 255]));
    }
    Ok(out)
}

fn hex(v: &str) -> Option<[u8; 3]> {
    let h = v.trim().strip_prefix('#')?;
    let full: String = match h.len() {
        3 | 4 => h.chars().take(3).flat_map(|c| [c, c]).collect(),
        6 | 8 => h[..6].to_string(),
        _ => return None,
    };
    let n = u32::from_str_radix(&full, 16).ok()?;
    Some([(n >> 16) as u8, (n >> 8) as u8, n as u8])
}

fn lum(c: [f64; 3]) -> f64 {
    let lin = |x: f64| {
        let x = x / 255.0;
        if x <= 0.03928 {
            x / 12.92
        } else {
            ((x + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
}

fn ratio(a: [f64; 3], b: [f64; 3]) -> f64 {
    let (la, lb) = (lum(a), lum(b));
    let (hi, lo) = if la > lb { (la, lb) } else { (lb, la) };
    (hi + 0.05) / (lo + 0.05)
}

/// The cells of the grid the image is cut into to find its brightest region (the same in the shell).
pub const GRID: (usize, usize) = (16, 4);
/// The scrim of the band colour over the image: from this, in steps of 0.05, up to the maximum.
pub const SCRIM_MIN: f64 = 0.3;
pub const SCRIM_MAX: f64 = 0.85;

/// The mean colour of the brightest cell of an RGBA image (`width` × `height`), composed on `ground`.
pub fn brightest(rgba: &[u8], width: usize, height: usize, ground: [u8; 3]) -> [f64; 3] {
    let (cols, rows) = GRID;
    let mut best = [0.0; 3];
    let mut best_l = -1.0;
    for cy in 0..rows {
        for cx in 0..cols {
            let (x0, x1) =
                (cx * width / cols, ((cx + 1) * width / cols).max(cx * width / cols + 1).min(width));
            let (y0, y1) =
                (cy * height / rows, ((cy + 1) * height / rows).max(cy * height / rows + 1).min(height));
            let mut sum = [0.0; 3];
            let mut n = 0.0;
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = (y * width + x) * 4;
                    let Some(px) = rgba.get(i..i + 4) else { continue };
                    let a = f64::from(px[3]) / 255.0;
                    for c in 0..3 {
                        sum[c] += f64::from(px[c]) * a + f64::from(ground[c]) * (1.0 - a);
                    }
                    n += 1.0;
                }
            }
            if n == 0.0 {
                continue;
            }
            let mean = [sum[0] / n, sum[1] / n, sum[2] / n];
            let l = lum(mean);
            if l > best_l {
                best_l = l;
                best = mean;
            }
        }
    }
    best
}

/// The least scrim (band colour over the image) that keeps the texts of the band at 4.5:1 over the
/// brightest region, for every `(band, text)` pair; `None` if even the maximum is not enough.
pub fn scrim_for(cell: [f64; 3], colors: &[([u8; 3], [u8; 3])]) -> Option<f64> {
    let mut s = SCRIM_MIN;
    while s <= SCRIM_MAX + 1e-9 {
        let ok = colors.iter().all(|(band, fg)| {
            let mix = |i: usize| f64::from(band[i]) * s + cell[i] * (1.0 - s);
            let ground = [mix(0), mix(1), mix(2)];
            ratio(ground, [f64::from(fg[0]), f64::from(fg[1]), f64::from(fg[2])]) >= 4.5
        });
        if ok {
            return Some((s * 100.0).round() / 100.0);
        }
        s += 0.05;
    }
    None
}

/// Decodes a PNG to RGBA 8 bits.
pub fn decode_png(data: &[u8]) -> Result<(Vec<u8>, usize, usize)> {
    let bad = || Error::bad("the band image must be a PNG").with_code("image_type");
    let mut dec = png::Decoder::new(std::io::Cursor::new(data));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|_| bad())?;
    let (w, h) = (reader.info().width as usize, reader.info().height as usize);
    if w == 0 || h == 0 || w * h > 16_000_000 {
        return Err(Error::bad("the band image is too large").with_code("image_too_large"));
    }
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|_| bad())?;
    let buf = &buf[..info.buffer_size()];
    let rgba: Vec<u8> = match info.color_type {
        png::ColorType::Rgba => buf.to_vec(),
        png::ColorType::Rgb => buf.as_chunks::<3>().0.iter().flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => {
            buf.as_chunks::<2>().0.iter().flat_map(|p| [p[0], p[0], p[0], p[1]]).collect()
        }
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err(bad()),
    };
    Ok((rgba, w, h))
}

/// The scrim a band image needs with the theme in use, or the error `band_image_contrast`.
pub async fn band_image_scrim(k: &Kernel, tenant: Option<Uuid>, data: &[u8]) -> Result<f64> {
    let (rgba, w, h) = decode_png(data)?;
    let colors = band_colors(k, tenant).await?;
    // the transparent parts of the image show the band colour of the first mode
    let cell = brightest(&rgba, w, h, colors[0].0);
    scrim_for(cell, &colors).ok_or_else(|| {
        Error::bad("the texts of the band would not read over this image (WCAG 4.5:1), even darkened")
            .with_code("band_image_contrast")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_scrim_grows_with_a_brighter_image() {
        let white = vec![255u8; 32 * 8 * 4];
        let dark = [30u8, 30, 30, 255].repeat(32 * 8);
        let colors = vec![([0x44, 0x47, 0x91], [255, 255, 255])];
        let s_white = scrim_for(brightest(&white, 32, 8, [0, 0, 0]), &colors).unwrap();
        let s_dark = scrim_for(brightest(&dark, 32, 8, [0, 0, 0]), &colors).unwrap();
        assert!(s_white > s_dark, "{s_white} > {s_dark}");
        assert_eq!(s_dark, SCRIM_MIN);
        // a pale band with white text never reads over a white image
        assert_eq!(
            scrim_for(brightest(&white, 32, 8, [0, 0, 0]), &[([0xdd, 0xdd, 0xdd], [255, 255, 255])]),
            None
        );
    }

    #[test]
    fn the_brightest_cell_wins() {
        // a black image with one white cell (the first of 16 × 4)
        let (w, h) = (32, 8);
        let mut rgba = [0u8, 0, 0, 255].repeat(w * h);
        for y in 0..2 {
            for x in 0..2 {
                let i = (y * w + x) * 4;
                rgba[i..i + 3].copy_from_slice(&[255, 255, 255]);
            }
        }
        assert_eq!(brightest(&rgba, w, h, [0, 0, 0]), [255.0, 255.0, 255.0]);
    }
}
