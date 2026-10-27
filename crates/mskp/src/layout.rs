//! Layout plugins (`kind = "layout"`): how the shell arranges its slots (brand, tenant switcher,
//! navigation, search, actions, breadcrumb, content), with the default style, a stylesheet and images.
//!
//! A layout is declarative. `layout/layout.toml` picks a navigation pattern from a fixed vocabulary
//! the shell knows how to draw, and the options of the band and of the phone; `layout/layout.css`
//! is checked at install (allowlisted properties, images of the package only, no `@import`, no
//! escapes) and scoped under the class of the layout; `layout/images/*` are PNG, WebP or safe SVG.
//! Nothing a layout ships runs as code in the shell.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{is_safe_path, Error, Result};

/// File with the arrangement, inside `layout/`.
pub const LAYOUT_FILE: &str = "layout.toml";
/// Default stylesheet, inside `layout/`.
pub const LAYOUT_CSS: &str = "layout.css";
const MAX_CSS: usize = 64 << 10;
const MAX_IMAGES: usize = 8;
const MAX_IMAGE: usize = 512 << 10;

/// Values of the style variables (corners, density, font, tabs, main buttons).
pub const STYLE_VALUES: &[(&str, &[&str])] = &[
    ("radius", &["square", "medium", "round"]),
    ("density", &["compact", "comfortable"]),
    ("font", &["system", "humanist", "serif"]),
    ("tabs", &["underline", "pill", "boxed"]),
    ("buttons", &["filled", "outline", "soft"]),
];

/// Whether `value` is one of the values of the style variable `key`.
pub fn style_value_ok(key: &str, value: &str) -> bool {
    STYLE_VALUES.iter().any(|(k, vs)| *k == key && vs.contains(&value))
}

/// How the navigation is drawn: patterns the shell knows.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Pattern {
    /// a rail of icons with their names, panels at the side (the built-in Teams layout)
    Rail,
    /// a sidebar with groups that open, next to the content
    Sidebar,
    /// a drawer that opens and closes, under a top bar
    Drawer,
    /// a launcher grid of the apps and pages, a bar with the pages of the area
    Launcher,
    /// global areas at the left, the sidebar of the area next to it
    Areas,
    /// apps and pages as tabs under the band
    Tabs,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SearchPlace {
    /// in the middle of the band
    #[default]
    Center,
    /// wide, from the brand to the actions
    Wide,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TenantPlace {
    /// in the band, after the brand
    #[default]
    Band,
    /// at the top of the navigation
    Nav,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PhoneNav {
    /// a drawer with the whole tree
    #[default]
    Drawer,
    /// a grid of the apps and pages
    Launcher,
}

fn yes() -> bool {
    true
}

/// `[band]` of `layout.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BandDecl {
    /// logo and name of the application in the band
    #[serde(default = "yes")]
    pub brand: bool,
    /// the breadcrumb of the page in the band
    #[serde(default)]
    pub breadcrumb: bool,
    #[serde(default)]
    pub search: SearchPlace,
    #[serde(default)]
    pub tenant: TenantPlace,
}

impl Default for BandDecl {
    fn default() -> BandDecl {
        BandDecl { brand: true, breadcrumb: false, search: SearchPlace::Center, tenant: TenantPlace::Band }
    }
}

/// `[nav]` of `layout.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct NavStyleDecl {
    /// the navigation drawn as a floating card on the ground of the page
    #[serde(default)]
    pub card: bool,
}

/// `[phone]` of `layout.toml`: what the navigation becomes on a narrow screen (≤ 900 px).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(deny_unknown_fields)]
pub struct PhoneDecl {
    #[serde(default)]
    pub nav: PhoneNav,
}

/// `layout/layout.toml`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LayoutDecl {
    /// the navigation pattern on a wide screen
    pub pattern: Pattern,
    #[serde(default)]
    pub band: BandDecl,
    #[serde(default)]
    pub nav: NavStyleDecl,
    #[serde(default)]
    pub phone: PhoneDecl,
    /// default values of the style variables (the Style of the platform or of a tenant wins)
    #[serde(default)]
    pub style: BTreeMap<String, String>,
    /// the image under the band, a file of `images/` (PNG)
    #[serde(default)]
    pub band_image: Option<String>,
}

/// A layout read from a package or a folder, checked and ready to serve.
#[derive(Debug, Clone, Serialize)]
pub struct Layout {
    pub decl: LayoutDecl,
    /// the stylesheet, scoped under the class of the layout (empty without one)
    #[serde(skip)]
    pub css: String,
    /// images by name (in `images/`), with their type
    #[serde(skip)]
    pub images: BTreeMap<String, (Vec<u8>, &'static str)>,
}

/// The class of the shell for a layout (`mskl-` and the id with `.` as `-`).
pub fn layout_class(id: &str) -> String {
    format!("mskl-{}", id.replace('.', "-"))
}

fn bad(m: impl Into<String>) -> Error {
    Error::Package(format!("layout: {}", m.into()))
}

/// Reads and checks a layout from the files of `layout/` (paths relative to it).
pub fn load_layout(id: &str, files: &BTreeMap<String, Vec<u8>>) -> Result<Layout> {
    let text = files.get(LAYOUT_FILE).ok_or_else(|| bad(format!("missing layout/{LAYOUT_FILE}")))?;
    let text = std::str::from_utf8(text).map_err(|_| bad("layout.toml is not UTF-8"))?;
    let decl: LayoutDecl = toml::from_str(text).map_err(|e| bad(e.to_string()))?;
    for (k, v) in &decl.style {
        if !STYLE_VALUES.iter().any(|(key, _)| key == k) {
            return Err(bad(format!("unknown style variable '{k}'")));
        }
        if !style_value_ok(k, v) {
            return Err(bad(format!("style.{k}: '{v}' is not one of its values")));
        }
    }
    let mut images = BTreeMap::new();
    for (name, data) in files {
        let Some(img) = name.strip_prefix("images/") else { continue };
        if !is_safe_path(img) || img.contains('/') || img.len() > 64 {
            return Err(bad(format!("invalid image name '{name}'")));
        }
        if data.len() > MAX_IMAGE {
            return Err(bad(format!("image '{img}' over 512 KB")));
        }
        let mime = sniff(data).ok_or_else(|| bad(format!("image '{img}': only PNG, WebP or a safe SVG")))?;
        images.insert(img.to_string(), (data.clone(), mime));
    }
    if images.len() > MAX_IMAGES {
        return Err(bad(format!("at most {MAX_IMAGES} images")));
    }
    if let Some(b) = &decl.band_image {
        match images.get(b) {
            Some((_, "image/png")) => {}
            Some(_) => return Err(bad("band_image must be a PNG")),
            None => return Err(bad(format!("band_image '{b}' is not in images/"))),
        }
    }
    let css = match files.get(LAYOUT_CSS) {
        Some(raw) => {
            if raw.len() > MAX_CSS {
                return Err(bad("layout.css over 64 KB"));
            }
            let raw = std::str::from_utf8(raw).map_err(|_| bad("layout.css is not UTF-8"))?;
            scope_css(raw, &layout_class(id), &images).map_err(bad)?
        }
        None => String::new(),
    };
    for name in files.keys() {
        if name != LAYOUT_FILE && name != LAYOUT_CSS && !name.starts_with("images/") {
            return Err(bad(format!("unexpected file layout/{name}")));
        }
    }
    Ok(Layout { decl, css, images })
}

/// Type of an image of a layout from its bytes.
fn sniff(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let lower = std::str::from_utf8(data).ok()?.to_ascii_lowercase();
    let unsafe_svg = [
        "<script",
        "javascript:",
        "<foreignobject",
        "<iframe",
        "<embed",
        "<object",
        "<!entity",
        "href=\"http",
        "href='http",
        "url(http",
    ]
    .iter()
    .any(|b| lower.contains(b))
        || lower.match_indices(" on").any(|(i, _)| {
            let rest = &lower[i + 3..];
            let n = rest.bytes().take_while(u8::is_ascii_alphabetic).count();
            n > 0 && rest[n..].trim_start().starts_with('=')
        });
    (lower.contains("<svg") && !unsafe_svg).then_some("image/svg+xml")
}

/// Properties a layout stylesheet may set. Not `display`, `visibility`, `position`, `content`,
/// `z-index` or `pointer-events`: a layout may change how the slots look, never hide them, cover
/// them or add text (the skip link, the landmarks and the order of the keyboard stay the shell's).
const PROPERTIES: &[&str] = &[
    "color",
    "background",
    "background-color",
    "background-image",
    "background-position",
    "background-size",
    "background-repeat",
    "border",
    "border-top",
    "border-right",
    "border-bottom",
    "border-left",
    "border-color",
    "border-style",
    "border-width",
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-left-radius",
    "border-bottom-right-radius",
    "box-shadow",
    "outline-color",
    "outline-offset",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "padding-inline",
    "padding-block",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "margin-inline",
    "margin-block",
    "gap",
    "row-gap",
    "column-gap",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "line-height",
    "text-transform",
    "text-decoration",
    "opacity",
    "min-width",
    "max-width",
    "width",
    "min-height",
    "max-height",
    "height",
    "transition",
    "backdrop-filter",
];

/// Characters a value may contain (no braces, semicolons, quotes other than in `url()`, escapes, `<`).
fn value_ok(v: &str) -> bool {
    v.chars().all(|c| c.is_ascii_alphanumeric() || " #%.,()-+*/_!'\"".contains(c))
}

fn selector_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && s.chars().all(|c| c.is_ascii_alphanumeric() || " .#:-_[]=\"'*>+~(),&".contains(c))
}

/// Checks a value's `url(...)`: only `images/<name>` of the package.
fn urls_ok(v: &str, images: &BTreeMap<String, (Vec<u8>, &'static str)>) -> std::result::Result<(), String> {
    let lower = v.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(i) = rest.find("url(") {
        let after = &rest[i + 4..];
        let end = after.find(')').ok_or("url( without )")?;
        let target = after[..end].trim().trim_matches(['"', '\'']);
        let name = target
            .strip_prefix("images/")
            .ok_or_else(|| format!("url({target}): only images/ of the package"))?;
        if !images.contains_key(name) {
            return Err(format!("url({target}): no such image in the package"));
        }
        rest = &after[end + 1..];
    }
    Ok(())
}

/// Checks a stylesheet and scopes every rule under `.{class}`. `@media` blocks are kept (their
/// rules scoped); every other at-rule, escape, comment trick or property out of the list is refused.
pub fn scope_css(
    raw: &str,
    class: &str,
    images: &BTreeMap<String, (Vec<u8>, &'static str)>,
) -> std::result::Result<String, String> {
    // comments go; a comment left open is refused
    let mut src = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(i) = rest.find("/*") {
        src.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let end = after.find("*/").ok_or("comment without */")?;
        rest = &after[end + 2..];
    }
    src.push_str(rest);
    let lower = src.to_ascii_lowercase();
    for bad in [
        "\\",
        "<",
        "expression(",
        "javascript:",
        "behavior",
        "-moz-binding",
        "@import",
        "@font-face",
        "@namespace",
        "@charset",
    ] {
        if lower.contains(bad) {
            return Err(format!("'{bad}' is not allowed"));
        }
    }
    let mut out = String::new();
    rules(&src, class, images, &mut out, 0)?;
    Ok(out)
}

fn rules(
    src: &str,
    class: &str,
    images: &BTreeMap<String, (Vec<u8>, &'static str)>,
    out: &mut String,
    depth: usize,
) -> std::result::Result<(), String> {
    let mut rest = src.trim();
    while !rest.is_empty() {
        let open = rest.find('{').ok_or("a rule without {")?;
        let prelude = rest[..open].trim();
        // the matching closing brace
        let mut level = 0;
        let mut close = None;
        for (i, c) in rest[open..].char_indices() {
            match c {
                '{' => level += 1,
                '}' => {
                    level -= 1;
                    if level == 0 {
                        close = Some(open + i);
                        break;
                    }
                }
                _ => {}
            }
        }
        let close = close.ok_or("a rule without }")?;
        let body = &rest[open + 1..close];
        if let Some(media) = prelude.strip_prefix("@media") {
            if depth > 0 {
                return Err("@media inside @media".into());
            }
            let media = media.trim();
            if media.is_empty() || !media.chars().all(|c| c.is_ascii_alphanumeric() || " ():-,.".contains(c))
            {
                return Err(format!("invalid @media '{media}'"));
            }
            out.push_str(&format!("@media {media} {{\n"));
            rules(body, class, images, out, depth + 1)?;
            out.push_str("}\n");
        } else if prelude.starts_with('@') {
            return Err(format!("at-rule '{prelude}' is not allowed"));
        } else {
            if body.contains('{') {
                return Err("nested rules are not allowed".into());
            }
            let mut sels = Vec::new();
            for s in prelude.split(',') {
                let s = s.trim();
                if !selector_ok(s) {
                    return Err(format!("invalid selector '{s}'"));
                }
                sels.push(match s.strip_prefix('&') {
                    Some(r) => format!(".{class}{}", r),
                    None => format!(".{class} {s}"),
                });
            }
            let mut decls = Vec::new();
            for d in body.split(';') {
                let d = d.trim();
                if d.is_empty() {
                    continue;
                }
                let (p, v) = d.split_once(':').ok_or_else(|| format!("invalid declaration '{d}'"))?;
                let p = p.trim().to_ascii_lowercase();
                let v = v.trim();
                let custom = p.starts_with("--layout-") && p.len() <= 48;
                if !custom && !PROPERTIES.contains(&p.as_str()) {
                    return Err(format!("property '{p}' is not allowed"));
                }
                if v.is_empty() || v.len() > 300 || !value_ok(v) {
                    return Err(format!("invalid value of '{p}'"));
                }
                urls_ok(v, images)?;
                decls.push(format!("  {p}: {v};"));
            }
            out.push_str(&format!("{} {{\n{}\n}}\n", sels.join(", "), decls.join("\n")));
        }
        rest = rest[close + 1..].trim();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(css: &str) -> BTreeMap<String, Vec<u8>> {
        let mut f = BTreeMap::new();
        f.insert(
            "layout.toml".into(),
            b"pattern = \"drawer\"\n[band]\nsearch = \"wide\"\n[style]\nradius = \"round\"\n".to_vec(),
        );
        f.insert("layout.css".into(), css.as_bytes().to_vec());
        f.insert("images/band.png".into(), b"\x89PNG\r\n\x1a\nrest".to_vec());
        f
    }

    #[test]
    fn a_layout_is_read_and_its_css_scoped() {
        let l = load_layout(
            "com.example.layout",
            &files(".band { border-radius: 12px; background-image: url(images/band.png) } @media (max-width: 900px) { .nav-item, &.x { padding: 4px } }"),
        )
        .unwrap();
        assert_eq!(l.decl.pattern, Pattern::Drawer);
        assert_eq!(l.decl.band.search, SearchPlace::Wide);
        assert!(l.decl.band.brand, "brand on by default");
        assert!(l.css.contains(".mskl-com-example-layout .band {"), "{}", l.css);
        assert!(l.css.contains(".mskl-com-example-layout.x"), "& joins the class: {}", l.css);
        assert!(l.css.contains("@media (max-width: 900px)"));
        assert_eq!(l.images["band.png"].1, "image/png");
    }

    #[test]
    fn hostile_stylesheets_are_refused() {
        for css in [
            "@import url(images/band.png);",
            ".a { background: url(https://evil.example/x.png) }",
            ".a { background: url(images/missing.png) }",
            ".a { display: none }",
            ".a { visibility: hidden }",
            ".a { position: fixed }",
            ".a { content: \"hello\" }",
            ".a { color: expression(alert(1)) }",
            ".a { background: url(javascript:alert(1)) }",
            ".a { color: re\\64 }",
            ".a { color: red } </style><script>",
            "@font-face { font-family: x }",
            ".a { .b { color: red } }",
            "@media screen { @media print { .a { color: red } } }",
            "@keyframes x { from { opacity: 0 } }",
            ".a { --band-foreground: red }",
            ".a { color: red /* open comment",
            ".a { color: red; } .b{",
            ".a { behavior: url(x.htc) }",
        ] {
            assert!(load_layout("com.example.layout", &files(css)).is_err(), "accepted: {css}");
        }
    }

    #[test]
    fn checks_of_the_arrangement_and_images() {
        let mut f = files("");
        f.insert("layout.toml".into(), b"pattern = \"sideways\"\n".to_vec());
        assert!(load_layout("com.example.layout", &f).is_err(), "unknown pattern");
        let mut f = files("");
        f.insert("layout.toml".into(), b"pattern = \"tabs\"\n[style]\nradius = \"huge\"\n".to_vec());
        assert!(load_layout("com.example.layout", &f).is_err(), "unknown style value");
        let mut f = files("");
        f.insert("images/x.svg".into(), b"<svg><script>alert(1)</script></svg>".to_vec());
        assert!(load_layout("com.example.layout", &f).is_err(), "unsafe SVG");
        let mut f = files("");
        f.insert("layout.toml".into(), b"pattern = \"tabs\"\nband_image = \"logo.svg\"\n".to_vec());
        f.insert("images/logo.svg".into(), b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec());
        assert!(load_layout("com.example.layout", &f).is_err(), "band image must be a PNG");
        let mut f = files("");
        f.insert("script.js".into(), b"alert(1)".to_vec());
        assert!(load_layout("com.example.layout", &f).is_err(), "unexpected file");
        let mut f = files("");
        f.remove("layout.toml");
        assert!(load_layout("com.example.layout", &f).is_err(), "missing layout.toml");
    }
}
