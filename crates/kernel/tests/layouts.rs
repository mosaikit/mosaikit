//! Layouts and style (phase 10): the layout of the platform and of a tenant on three levels, the layouts
//! tenants may choose, the style variables, the band image with its contrast check, layout plugins
//! installed from a package (checked stylesheet, images) and kept away from the plugins of the tenants.

use mosaikit_kernel::plugins::tenants::tenant_plugins;
use mosaikit_kernel::tenancy::layouts::{self, in_use, list};
use mosaikit_kernel::tenancy::levels::{effective, set_image, set_platform, set_tenant, Who};
use mosaikit_kernel::testing::{pack_dir, start};
use mosaikit_kernel::Kind;
use serde_json::{json, Map, Value};

fn map(v: Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap()
}

/// A PNG of one colour, `w` × `h`.
fn png(rgb: [u8; 3], w: u32, h: u32) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().unwrap();
        let data: Vec<u8> = (0..w * h).flat_map(|_| rgb).collect();
        writer.write_image_data(&data).unwrap();
    }
    out
}

/// A layout plugin in a folder: manifest, `layout/layout.toml`, stylesheet and image.
fn layout_package(css: &str) -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("plugin.toml"),
        r#"
id = "com.example.layout-wide"
name = "Wide"
version = "1.0.0"
kind = "layout"
description = "Everything wide"
[contribution]
icon = "L"
label = "Wide"
[i18n.it]
label = "Largo"
"#,
    )
    .unwrap();
    std::fs::create_dir_all(dir.path().join("layout").join("images")).unwrap();
    std::fs::write(
        dir.path().join("layout").join("layout.toml"),
        "pattern = \"drawer\"\nband_image = \"band.png\"\n[band]\nsearch = \"wide\"\n[style]\nradius = \"round\"\n",
    )
    .unwrap();
    std::fs::write(dir.path().join("layout").join("layout.css"), css).unwrap();
    std::fs::write(dir.path().join("layout").join("images").join("band.png"), png([20, 20, 40], 64, 16))
        .unwrap();
    pack_dir(dir.path(), None)
}

#[tokio::test]
async fn layout_of_the_platform_and_of_a_tenant() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let alfa = manager.tenant.tenant_id;

    // two built-in layouts, Teams by default
    let ids: Vec<String> = list(&t, "en").into_iter().map(|l| l.id).collect();
    assert_eq!(ids, ["teams", "console"]);
    assert_eq!(list(&t, "it")[1].description.split(' ').next(), Some("Barra"), "texts in the language");
    assert_eq!(in_use(&t, None).await.unwrap(), "teams");
    assert_eq!(in_use(&t, Some(alfa)).await.unwrap(), "teams");

    // the platform chooses Console: the tenant inherits it
    set_platform(&t, &admin, &map(json!({ "layout": "console" })), &Map::new()).await.unwrap();
    assert_eq!(in_use(&t, Some(alfa)).await.unwrap(), "console");
    let e = set_platform(&t, &admin, &map(json!({ "layout": "nope" })), &Map::new()).await.unwrap_err();
    assert_eq!(e.code(), "layout_unknown");

    // the tenant customizes it; a User may not
    set_tenant(&t, &manager, &map(json!({ "layout": "teams" }))).await.unwrap();
    assert_eq!(in_use(&t, Some(alfa)).await.unwrap(), "teams");
    assert_eq!(
        set_tenant(&t, &anna, &map(json!({ "layout": "console" }))).await.unwrap_err().kind,
        Kind::Forbidden
    );

    // only the layouts the Administrator allows (the platform's always): a choice no longer allowed
    // falls back to the platform's
    set_platform(&t, &admin, &map(json!({ "layout.allowed": ["console"] })), &Map::new()).await.unwrap();
    assert_eq!(in_use(&t, Some(alfa)).await.unwrap(), "console", "teams is no longer allowed");
    let e = set_tenant(&t, &manager, &map(json!({ "layout": "teams" }))).await.unwrap_err();
    assert_eq!(e.code(), "layout_not_allowed");
    let e = set_platform(&t, &admin, &map(json!({ "layout.allowed": ["ghost"] })), &Map::new())
        .await
        .unwrap_err();
    assert_eq!(e.code(), "layout_unknown");
    set_platform(&t, &admin, &map(json!({ "layout.allowed": null })), &Map::new()).await.unwrap();
    assert_eq!(in_use(&t, Some(alfa)).await.unwrap(), "teams", "allowed again");

    // "tenants may customize it" off: the platform's for everybody, the tenant cannot change it
    set_platform(&t, &admin, &Map::new(), &map(json!({ "layout": false }))).await.unwrap();
    assert_eq!(in_use(&t, Some(alfa)).await.unwrap(), "console");
    assert_eq!(
        set_tenant(&t, &manager, &map(json!({ "layout": "teams" }))).await.unwrap_err().code(),
        "setting_locked"
    );
}

#[tokio::test]
async fn style_variables_and_band_image() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let alfa = manager.tenant.tenant_id;

    // no value: the default of the layout (null); only the values of the vocabulary
    assert_eq!(effective(&t, Some(alfa)).await.unwrap()["style.radius"], Value::Null);
    set_platform(&t, &admin, &map(json!({ "style.radius": "square", "style.font": "serif" })), &Map::new())
        .await
        .unwrap();
    for bad in [json!({ "style.radius": "huge" }), json!({ "style.tabs": 3 }), json!({ "style.nope": "x" })] {
        assert!(set_platform(&t, &admin, &map(bad.clone()), &Map::new()).await.is_err(), "accepted: {bad}");
    }
    let e = effective(&t, Some(alfa)).await.unwrap();
    assert_eq!((e["style.radius"].as_str(), e["style.font"].as_str()), (Some("square"), Some("serif")));
    // the tenant customizes the style too, unless the Administrator turns it off
    set_tenant(&t, &manager, &map(json!({ "style.radius": "round" }))).await.unwrap();
    assert_eq!(effective(&t, Some(alfa)).await.unwrap()["style.radius"], "round");
    set_platform(&t, &admin, &Map::new(), &map(json!({ "style.radius": false }))).await.unwrap();
    assert_eq!(effective(&t, Some(alfa)).await.unwrap()["style.radius"], "square");

    // the band image: a PNG; a dark one is accepted with the scrim it needs, a white one with a pale
    // theme band is not; the tenant without one sees the platform's
    let e = set_image(&t, Who::Platform(&admin), "band", b"<svg xmlns='http://www.w3.org/2000/svg'/>")
        .await
        .unwrap_err();
    assert_eq!(e.code(), "image_type");
    set_image(&t, Who::Platform(&admin), "band", &png([10, 10, 30], 64, 16)).await.unwrap();
    let v = effective(&t, None).await.unwrap()["style.band_image"].clone();
    assert_eq!(v["scrim"], json!(layouts::SCRIM_MIN), "a dark image needs the least scrim");
    let white = set_image(&t, Who::Platform(&admin), "band", &png([255, 255, 255], 64, 16)).await;
    assert!(white.is_ok(), "a white image darkened by the band of the default theme reads: {white:?}");
    let s = effective(&t, None).await.unwrap()["style.band_image"]["scrim"].as_f64().unwrap();
    assert!(s > layouts::SCRIM_MIN && s <= layouts::SCRIM_MAX, "{s}");
    let (data, mime) =
        mosaikit_kernel::tenancy::levels::image(&t, Some(alfa), "band").await.unwrap().unwrap();
    assert_eq!((mime.as_str(), data.len() > 8), ("image/png", true), "inherited by the tenant");
    // contrast: with a pale band, a white image is refused
    let pale = layouts::scrim_for(
        layouts::brightest(&[255, 255, 255, 255].repeat(64), 8, 8, [0, 0, 0]),
        &[([0xdd, 0xdd, 0xdd], [255, 255, 255])],
    );
    assert_eq!(pale, None);
}

#[tokio::test]
async fn layout_plugins() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;

    // a hostile stylesheet is refused at install
    for css in [
        ".a { display: none }",
        "@import url(images/band.png);",
        ".a { background: url(https://evil.example/x.png) }",
    ] {
        assert!(t.install_package(&layout_package(css)).await.is_err(), "installed: {css}");
    }
    let id = t
        .install_package(&layout_package(".msk-band { border-radius: 0 } .msk-nav-item { padding: 6px }"))
        .await
        .unwrap();
    assert_eq!(id, "com.example.layout-wide");
    let l = list(&t, "it").into_iter().find(|l| l.id == id).unwrap();
    assert_eq!((l.name.as_str(), l.built_in, l.has_css), ("Largo", false, true));
    assert_eq!(l.decl.band_image.as_deref(), Some("band.png"));
    let css = layouts::css(&t, &id).unwrap();
    assert!(css.contains(".mskl-com-example-layout-wide .msk-band {"), "{css}");
    let (img, mime) = layouts::image(&t, &id, "band.png").unwrap();
    assert_eq!((mime, img.starts_with(b"\x89PNG")), ("image/png", true));
    assert!(layouts::image(&t, &id, "missing.png").is_none());

    // a layout belongs to the platform: not among the plugins of the tenants
    let plugins = tenant_plugins(&t, &manager, "en").await.unwrap();
    assert!(plugins.iter().all(|p| p.id != id));

    // the platform may choose it; turned off it is gone and the shell falls back to Teams
    let admin = t.admin().await;
    set_platform(&t, &admin, &map(json!({ "layout": id })), &Map::new()).await.unwrap();
    assert_eq!(in_use(&t, None).await.unwrap(), id);
    mosaikit_kernel::plugins::set_active(&t, Some(&admin), &id, false).await.unwrap();
    assert_eq!(in_use(&t, None).await.unwrap(), "teams");
    assert!(layouts::css(&t, &id).is_none());
}

#[tokio::test]
async fn official_layout_plugins_install() {
    let t = start().await;
    for name in ["layout-workspace", "layout-suite", "layout-project", "layout-tabs"] {
        let pkg = mosaikit_kernel::testing::pack_plugin(name);
        let id = t.install_package(&pkg).await.unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(id, format!("com.mosaikit.{name}"));
    }
    let ids: Vec<String> = list(&t, "en").into_iter().map(|l| l.id).collect();
    assert_eq!(ids.len(), 6, "{ids:?}");
    let project = list(&t, "en").into_iter().find(|l| l.id == "com.mosaikit.layout-project").unwrap();
    assert_eq!(project.band_image.as_deref(), Some("band.png"));
    assert!(layouts::image(&t, &project.id, "band.png").is_some());
}
