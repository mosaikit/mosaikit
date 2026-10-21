// Su Windows incorpora nell'eseguibile icona e descrizione: sono quelle che
// mostrano Esplora file e Task Manager. Una distribuzione con un proprio marchio
// le passa con MOSAIKIT_PRODUCT_NAME, MOSAIKIT_PRODUCT_VERSION e MOSAIKIT_BRAND_ICON
// (file .ico), impostate da `cargo xtask --dist ... release desktop`.

#[allow(dead_code)]
mod icon {
    include!("src/icon.rs");
}

/// File .ico con immagini BMP a 32 bit (16, 24, 32, 48, 256 px).
fn ico() -> Vec<u8> {
    let sizes = [16u32, 24, 32, 48, 256];
    let images: Vec<Vec<u8>> = sizes
        .iter()
        .map(|&s| {
            let rgba = icon::render(s);
            let mut bmp = Vec::new();
            // BITMAPINFOHEADER: altezza doppia (immagine + maschera AND)
            bmp.extend_from_slice(&40u32.to_le_bytes());
            bmp.extend_from_slice(&(s as i32).to_le_bytes());
            bmp.extend_from_slice(&((s * 2) as i32).to_le_bytes());
            bmp.extend_from_slice(&1u16.to_le_bytes());
            bmp.extend_from_slice(&32u16.to_le_bytes());
            bmp.extend_from_slice(&[0u8; 24]);
            for y in (0..s).rev() {
                for x in 0..s {
                    let i = ((y * s + x) * 4) as usize;
                    bmp.extend_from_slice(&[rgba[i + 2], rgba[i + 1], rgba[i], rgba[i + 3]]);
                }
            }
            let mask_row = (s.div_ceil(32) * 4) as usize;
            bmp.extend(std::iter::repeat_n(0u8, mask_row * s as usize));
            bmp
        })
        .collect();
    let mut out = Vec::new();
    out.extend_from_slice(&[0, 0, 1, 0]);
    out.extend_from_slice(&(sizes.len() as u16).to_le_bytes());
    let mut offset = 6 + 16 * sizes.len() as u32;
    for (s, img) in sizes.iter().zip(&images) {
        let dim = if *s >= 256 { 0 } else { *s as u8 };
        out.extend_from_slice(&[dim, dim, 0, 0]);
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&(img.len() as u32).to_le_bytes());
        out.extend_from_slice(&offset.to_le_bytes());
        offset += img.len() as u32;
    }
    for img in images {
        out.extend_from_slice(&img);
    }
    out
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
            std::fs::write(&p, ico()).expect("scrittura dell'icona");
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
