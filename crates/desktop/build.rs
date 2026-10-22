// On Windows it embeds icon and description in the executable: they are the ones
// File Explorer and Task Manager show. A distribution with a brand of its own
// passes them with MOSAIKIT_PRODUCT_NAME, MOSAIKIT_PRODUCT_VERSION and MOSAIKIT_BRAND_ICON
// (.ico file), set by `cargo xtask --dist ... release desktop`.

#[allow(dead_code)]
mod icon {
    include!("src/icon.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=src/icon.rs");
    for v in ["MOSAIKIT_PRODUCT_NAME", "MOSAIKIT_PRODUCT_VERSION", "MOSAIKIT_BRAND_ICON"] {
        println!("cargo:rerun-if-env-changed={v}");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let path = match std::env::var("MOSAIKIT_BRAND_ICON").ok().filter(|p| std::path::Path::new(p).is_file()) {
        Some(p) => {
            println!("cargo:rerun-if-changed={p}");
            std::path::PathBuf::from(p)
        }
        None => {
            let p = out.join("mosaikit.ico");
            std::fs::write(&p, icon::ico()).expect("writing the icon");
            p
        }
    };
    let name = std::env::var("MOSAIKIT_PRODUCT_NAME").unwrap_or_else(|_| "Mosaikit".into());
    let version = std::env::var("MOSAIKIT_PRODUCT_VERSION").ok();
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon(path.to_str().expect("icon path"));
        res.set("FileDescription", &name);
        res.set("ProductName", &name);
        res.set("CompanyName", &name);
        if let Some(v) = &version {
            res.set("ProductVersion", v);
        }
        if let Err(e) = res.compile() {
            println!("cargo:warning=icon and description of the executable not embedded: {e}");
        }
    }
}
