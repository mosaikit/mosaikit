// The host UI (ui/host/dist) is embedded with rust-embed: recompile the server
// when it changes, even if the folder did not exist at the first build.
fn main() {
    println!("cargo:rerun-if-changed=../../ui/host/dist");
    println!("cargo:rerun-if-changed=../../ui/host/dist/index.html");
}
