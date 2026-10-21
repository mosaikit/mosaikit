// Su Windows incorpora nell'eseguibile icona e descrizione: sono quelle che
// mostrano Esplora file e Task Manager. Una distribuzione con un proprio marchio
// le passa con MOSAIKIT_PRODUCT_NAME, MOSAIKIT_PRODUCT_VERSION e MOSAIKIT_BRAND_ICON
// (file .ico), impostate da `cargo xtask --dist ... release desktop`.

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
            std::fs::write(&p, icon::ico()).expect("scrittura dell'icona");
            p
        }
    };
    let name = std::env::var("MOSAIKIT_PRODUCT_NAME").unwrap_or_else(|_| "Mosaikit".into());
    let version = std::env::var("MOSAIKIT_PRODUCT_VERSION").ok();
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon(path.to_str().expect("percorso icona"));
        res.set("FileDescription", &name);
        res.set("ProductName", &name);
        res.set("CompanyName", &name);
        if let Some(v) = &version {
            res.set("ProductVersion", v);
        }
        if let Err(e) = res.compile() {
            println!("cargo:warning=icona e descrizione dell'eseguibile non incorporate: {e}");
        }
    }
}
