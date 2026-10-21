// `sqlx::migrate!` incorpora le migrazioni a compile time: ricompila quando cambiano.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
