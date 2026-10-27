//! Allow-list check of the SVG images people upload (logos, browser icon).
//!
//! The file is parsed as XML (no DTD, so no entities) and every element and attribute must be in a
//! short list of drawing features: shapes, paths, text, gradients, clips and masks. References may
//! only point inside the document (`#id`). Anything else — scripts, styles, event handlers, embedded
//! documents, links, animations, external URLs — refuses the whole file. The images are also served
//! with `Content-Security-Policy: default-src 'none'; sandbox`, so this is a second line of defence.

use crate::{Error, Result};

const ELEMENTS: &[&str] = &[
    "svg",
    "g",
    "defs",
    "title",
    "desc",
    "metadata",
    "symbol",
    "use",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "linearGradient",
    "radialGradient",
    "stop",
    "clipPath",
    "mask",
    "pattern",
    "filter",
    "feGaussianBlur",
    "feOffset",
    "feBlend",
    "feColorMatrix",
    "feComposite",
    "feFlood",
    "feMerge",
    "feMergeNode",
];

const ATTRIBUTES: &[&str] = &[
    // structure and identity
    "id",
    "class",
    "version",
    "baseProfile",
    "viewBox",
    "preserveAspectRatio",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "width",
    "height",
    "transform",
    "href",
    // shapes and text
    "d",
    "points",
    "r",
    "rx",
    "ry",
    "cx",
    "cy",
    "fx",
    "fy",
    "dx",
    "dy",
    "pathLength",
    "rotate",
    "lengthAdjust",
    "textLength",
    "startOffset",
    "text-anchor",
    "dominant-baseline",
    "alignment-baseline",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "letter-spacing",
    "word-spacing",
    // paint
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
    "color",
    "visibility",
    "display",
    "clip-path",
    "clip-rule",
    "clipPathUnits",
    "mask",
    "maskUnits",
    "maskContentUnits",
    "filter",
    "filterUnits",
    "primitiveUnits",
    "shape-rendering",
    "vector-effect",
    // gradients and patterns
    "offset",
    "stop-color",
    "stop-opacity",
    "gradientUnits",
    "gradientTransform",
    "spreadMethod",
    "patternUnits",
    "patternContentUnits",
    "patternTransform",
    // filter primitives
    "in",
    "in2",
    "result",
    "stdDeviation",
    "mode",
    "type",
    "values",
    "operator",
    "k1",
    "k2",
    "k3",
    "k4",
    "flood-color",
    "flood-opacity",
    "color-interpolation-filters",
];

/// Namespaces an attribute may come from: none (plain attributes), xlink (only `xlink:href`) and
/// xml (`xml:space`, `xml:lang`).
const XLINK: &str = "http://www.w3.org/1999/xlink";
const XML: &str = "http://www.w3.org/XML/1998/namespace";
const SVG: &str = "http://www.w3.org/2000/svg";

fn unsafe_svg(why: &str) -> Error {
    Error::bad(format!("SVG not allowed: {why}")).with_code("image_unsafe")
}

/// A value that refers to something: only a fragment of this document (`#id`).
fn local_ref(v: &str) -> bool {
    let v = v.trim();
    v.starts_with('#')
        && v.len() > 1
        && v[1..].bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.:".contains(&b))
}

/// `url(...)` inside paint and clip values: only `url(#id)`.
fn urls_are_local(v: &str) -> bool {
    let lower = v.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(i) = rest.find("url(") {
        let after = &rest[i + 4..];
        let Some(end) = after.find(')') else { return false };
        let inner = after[..end].trim().trim_matches(|c| c == '"' || c == '\'');
        if !local_ref(inner) {
            return false;
        }
        rest = &after[end + 1..];
    }
    true
}

/// Checks an SVG document against the allow list.
pub fn check(text: &str) -> Result<()> {
    let opts = roxmltree::ParsingOptions { allow_dtd: false, ..Default::default() };
    let doc = roxmltree::Document::parse_with_options(text, opts)
        .map_err(|_| unsafe_svg("not well-formed XML or a DTD"))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" {
        return Err(unsafe_svg("the root is not <svg>"));
    }
    for node in doc.descendants() {
        if node.is_pi() {
            return Err(unsafe_svg("processing instruction"));
        }
        if !node.is_element() {
            continue;
        }
        let tag = node.tag_name();
        if tag.namespace().is_some_and(|ns| ns != SVG) || !ELEMENTS.contains(&tag.name()) {
            return Err(unsafe_svg(&format!("element <{}>", tag.name())));
        }
        for a in node.attributes() {
            let name = a.name();
            match a.namespace() {
                None if ATTRIBUTES.contains(&name) => {}
                Some(XLINK) if name == "href" => {}
                Some(XML) if name == "space" || name == "lang" => {}
                _ => return Err(unsafe_svg(&format!("attribute {name}"))),
            }
            let value = a.value();
            if name == "href" && !local_ref(value) {
                return Err(unsafe_svg("a reference outside the image"));
            }
            if !urls_are_local(value) {
                return Err(unsafe_svg("an external url()"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::check;

    #[test]
    fn drawings_pass() {
        for ok in [
            "<svg xmlns='http://www.w3.org/2000/svg'><rect width='4' height='4' fill='#123'/></svg>",
            "<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8'><defs><linearGradient id='g'><stop offset='0' stop-color='red'/></linearGradient></defs><path d='M0 0h8v8z' fill='url(#g)'/></svg>",
            "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'><symbol id='s'><circle r='2'/></symbol><use xlink:href='#s'/><text x='1' y='2' font-family='sans-serif'>Mosaikit</text></svg>",
        ] {
            assert!(check(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for bad in [
            "<svg><script>alert(1)</script></svg>",
            "<svg onload='alert(1)'></svg>",
            "<svg><image href='https://evil.example/x.png'/></svg>",
            "<svg><foreignObject></foreignObject></svg>",
            "<svg><a href='javascript:alert(1)'><rect/></a></svg>",
            "<svg><use href='//evil.example/s.svg#x'/></svg>",
            "<svg xmlns:xlink='http://www.w3.org/1999/xlink'><use xlink:href='&#106;avascript:x'/></svg>",
            "<svg><rect fill='url(https://evil.example/p)'/></svg>",
            "<svg><style>@import url(https://evil.example/c.css)</style></svg>",
            "<svg><rect style='fill:url(http://x)'/></svg>",
            "<svg><animate attributeName='href' to='javascript:x'/></svg>",
            "<svg><set attributeName='onclick'/></svg>",
            "<!DOCTYPE svg [<!ENTITY x 'y'>]><svg>&x;</svg>",
            "<svg><?xml-stylesheet href='https://evil.example/c.css'?></svg>",
            "<html><svg/></html>",
            "<svg><rect",
        ] {
            assert!(check(bad).is_err(), "{bad}");
        }
    }
}
