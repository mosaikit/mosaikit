// The host UI (ui/host/dist) is embedded with rust-embed: recompile the server
// when it changes, even if the folder did not exist at the first build.
// On Windows the executable also gets the icon and the description File Explorer and Task Manager show (the icon of the desktop app).

#[allow(dead_code)]
mod icon {
    include!("../desktop/src/icon.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=../../ui/host/dist");
    println!("cargo:rerun-if-changed=../../ui/host/dist/index.html");
    println!("cargo:rerun-if-changed=../desktop/src/icon.rs");
    #[cfg(windows)]
    embed();
}

#[cfg(windows)]
fn embed() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
        let path = out.join("mosaikit.ico");
        std::fs::write(&path, icon::ico()).expect("writing the icon");
        let mut res = winresource::WindowsResource::new();
        res.set_icon(path.to_str().expect("icon path"));
        res.set("FileDescription", "Mosaikit server");
        res.set("ProductName", "Mosaikit");
        if let Err(e) = res.compile() {
            println!("cargo:warning=icon and description of the executable not embedded: {e}");
        }
    }
}
