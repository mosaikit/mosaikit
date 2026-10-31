//! The `mosaikit-plugin` executable against temporary folders: new, validate, pack, sign, build, test.
//! Nothing here knows the layout of the repository, except where the SDK is (the plugin takes it by path,
//! as the SDK is not published yet).

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn tool(dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_mosaikit-plugin"))
        .current_dir(dir)
        .args(args)
        // everything is in the cache of the machine: the tests do not need the network
        .env("CARGO_NET_OFFLINE", "true")
        .env_remove("CARGO_TARGET_DIR")
        .env_remove("MOSAIKIT_SIGNING_KEY")
        .env_remove("MOSAIKIT_SIGNING_KEY_FILE")
        .output()
        .expect("mosaikit-plugin starts")
}

fn ok(dir: &Path, args: &[&str]) -> String {
    let o = tool(dir, args);
    let out = String::from_utf8_lossy(&o.stdout).to_string();
    assert!(o.status.success(), "{args:?} failed:\n{out}\n{}", String::from_utf8_lossy(&o.stderr));
    out
}

fn temp() -> tempfile::TempDir {
    // CLAUDE.md: temporary work under MOSAIKIT_TEMP when it is set
    match std::env::var_os("MOSAIKIT_TEMP") {
        Some(t) => {
            std::fs::create_dir_all(&t).unwrap();
            tempfile::Builder::new().prefix("plugin-cli-").tempdir_in(t).unwrap()
        }
        None => tempfile::tempdir().unwrap(),
    }
}

fn sdk() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("plugin-sdk")
}

#[test]
fn new_validate_pack_sign_without_a_build() {
    let d = temp();
    let w = d.path();
    ok(w, &["new", "demo", "--id", "com.test.demo", "--no-logic", "--no-ui"]);
    let plugin = w.join("demo");
    assert!(plugin.join("plugin.toml").is_file() && plugin.join(".gitignore").is_file());

    ok(w, &["keygen", "--out", "publisher.key"]);
    // a key is never overwritten
    assert!(!tool(w, &["keygen", "--out", "publisher.key"]).status.success());

    assert!(ok(&plugin, &["validate"]).contains("0 error(s), 0 warning(s)"));
    let packed = ok(&plugin, &["pack", "--no-build", "--key", "../publisher.key"]);
    assert!(packed.contains("com.test.demo-0.1.0.mskp") && packed.contains("sha256"));
    let mskp = plugin.join("dist").join("com.test.demo-0.1.0.mskp");
    assert!(ok(w, &["validate", mskp.to_str().unwrap()]).contains("signature valid"));

    // signed again with a second key: another publisher, same content
    ok(w, &["keygen", "--out", "second.key"]);
    let before = std::fs::read(&mskp).unwrap();
    ok(w, &["sign", mskp.to_str().unwrap(), "--key", "second.key"]);
    assert_ne!(before, std::fs::read(&mskp).unwrap());
    assert!(ok(w, &["validate", mskp.to_str().unwrap()]).contains("signature valid"));

    // a broken manifest stops `pack` and fails `validate` with the exit code 1
    std::fs::write(plugin.join("plugin.toml"), "id = \"x\"\n").unwrap();
    assert_eq!(tool(&plugin, &["validate"]).status.code(), Some(1));
    assert!(!tool(&plugin, &["pack", "--no-build", "--key", "../publisher.key"]).status.success());
}

#[test]
fn doctor_dev_and_install_say_what_they_do() {
    let d = temp();
    let o = tool(d.path(), &["doctor"]);
    let out = String::from_utf8_lossy(&o.stdout);
    assert!(out.contains("rustc") && out.contains("wasm32 target") && out.contains("node"), "{out}");
    // `dev` is announced for phase 4 and exits with 2
    let o = tool(d.path(), &["dev"]);
    assert_eq!(o.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&o.stderr).contains("phase 4"));
    // install needs a package and an Administrator before it sends anything
    let o = tool(d.path(), &["install", "nothing.mskp", "--server", "http://127.0.0.1:9"]);
    assert!(!o.status.success());
}

#[test]
fn new_build_pack_validate_with_logic() {
    let d = temp();
    let w = d.path();
    let sdk = sdk();
    ok(w, &["new", "weather", "--id", "com.test.weather", "--no-ui", "--sdk-path", sdk.to_str().unwrap()]);
    let plugin = w.join("weather");
    ok(w, &["keygen", "--out", "k.key"]);

    ok(&plugin, &["build", "--release"]);
    assert!(plugin.join("target/wasm32-unknown-unknown/release/weather.wasm").is_file());

    ok(&plugin, &["pack", "--release", "--no-build", "--key", "../k.key"]);
    let mskp = plugin.join("dist").join("com.test.weather-0.1.0.mskp");
    let report = ok(w, &["validate", mskp.to_str().unwrap()]);
    assert!(report.contains("0 error(s)") && report.contains("signature valid"), "{report}");

    // the tests of the logic run natively with the mock host of the SDK
    ok(&plugin, &["test"]);
}
