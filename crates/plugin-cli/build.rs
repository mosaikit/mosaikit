// On Windows it embeds the name and the description in the executable (File Explorer and Task Manager show them);
// without the Windows resource compiler the build goes on and warns.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    #[cfg(windows)]
    embed();
}

#[cfg(windows)]
fn embed() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set("FileDescription", "Mosaikit plugin tool");
        res.set("ProductName", "Mosaikit");
        res.set("OriginalFilename", "mosaikit-plugin.exe");
        if let Err(e) = res.compile() {
            println!("cargo:warning=name and description of the executable not embedded: {e}");
        }
    }
}
