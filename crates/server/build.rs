// La UI host (ui/host/dist) e' incorporata con rust-embed: ricompila il server
// quando cambia, anche se la cartella non esisteva alla prima compilazione.
fn main() {
    println!("cargo:rerun-if-changed=../../ui/host/dist");
    println!("cargo:rerun-if-changed=../../ui/host/dist/index.html");
}
