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
    // `dev` without a server executable says where to get it and exits with 1; it builds nothing first
    let o = Command::new(env!("CARGO_BIN_EXE_mosaikit-plugin"))
        .current_dir(d.path())
        .args(["new", "devdemo", "--no-logic", "--no-ui"])
        .output()
        .unwrap();
    assert!(o.status.success());
    // the tool is copied to an empty folder: in a build folder of Cargo the server stands next to it
    let alone =
        d.path().join("alone").join(if cfg!(windows) { "mosaikit-plugin.exe" } else { "mosaikit-plugin" });
    std::fs::create_dir_all(alone.parent().unwrap()).unwrap();
    std::fs::copy(env!("CARGO_BIN_EXE_mosaikit-plugin"), &alone).unwrap();
    let o = Command::new(&alone)
        .current_dir(d.path().join("devdemo"))
        .args(["dev", "--no-open"])
        .env_remove("MOSAIKIT_SERVER_BIN")
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(1));
    let err = String::from_utf8_lossy(&o.stderr);
    assert!(err.contains("--server") && err.contains("MOSAIKIT_SERVER_BIN"), "{err}");
    let o = Command::new(env!("CARGO_BIN_EXE_mosaikit-plugin"))
        .current_dir(d.path().join("devdemo"))
        .args(["dev", "--server", "nowhere/mosaikit-server"])
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&o.stderr).contains("does not exist"));
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

/// The kit as the release builds it (phase 7): the SDK as the unpacked crate that `cargo package` makes, the UI package
/// as the unpacked tarball of `npm pack`. Nothing of the checkout is used by the plugins below except these two folders.
fn kit(root: &Path) -> PathBuf {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let kit = root.join("kit");
    let packed = root.join("packed");
    std::fs::create_dir_all(&packed).unwrap();
    let st = Command::new("cargo")
        .current_dir(&repo)
        .env("CARGO_TARGET_DIR", root.join("pkg-target"))
        .args(["package", "-p", "mosaikit-plugin-sdk", "--allow-dirty", "--no-verify", "--offline", "-q"])
        .status()
        .expect("cargo package");
    assert!(st.success(), "cargo package");
    let krate = root.join("pkg-target").join("package").join("mosaikit-plugin-sdk-1.0.0.crate");
    untar(&krate, &kit);
    std::fs::rename(kit.join("mosaikit-plugin-sdk-1.0.0"), kit.join("sdk")).unwrap();

    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let out = Command::new(npm)
        .current_dir(&packed)
        .args([
            "pack",
            repo.join("ui").join("plugin-api").to_str().unwrap(),
            "--pack-destination",
            ".",
            "--silent",
        ])
        .output()
        .expect("npm pack");
    assert!(out.status.success(), "npm pack: {}", String::from_utf8_lossy(&out.stderr));
    let tgz = std::fs::read_dir(&packed)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.extension().is_some_and(|e| e == "tgz"))
        .expect("the tarball of @mosaikit/plugin-api");
    untar(&tgz, &kit);
    std::fs::rename(kit.join("package"), kit.join("plugin-api")).unwrap();
    kit
}

fn untar(archive: &Path, into: &Path) {
    std::fs::create_dir_all(into).unwrap();
    let st = Command::new("tar")
        .args(["-xzf", archive.to_str().unwrap(), "-C", into.to_str().unwrap()])
        .status()
        .expect("tar");
    assert!(st.success(), "tar {}", archive.display());
}

/// Every variant and the three examples, made from the archives of the kit, then built, tested, packed and validated
/// (about two minutes: it installs the UI packages and builds the logic of four plugins). No Mosaikit checkout is read.
#[test]
fn every_variant_builds_and_packs_from_the_kit() {
    let d = temp();
    let w = d.path();
    let kit = kit(w);
    let kit_s = kit.to_str().unwrap().to_string();
    ok(w, &["keygen", "--out", "k.key"]);

    // (name, args of `new`, has something to build)
    let cases: [(&str, &[&str], bool); 8] = [
        ("e-todo", &["--example", "todo"], true),
        ("e-insights", &["--example", "insights"], true),
        ("v-ui", &["--variant", "ui"], true),
        ("v-service", &["--variant", "service"], true),
        ("e-priority", &["--example", "note-priority"], false),
        ("v-extension", &["--variant", "extension"], false),
        ("lang-fr", &["--variant", "language"], false),
        ("v-layout", &["--variant", "layout"], false),
    ];
    for (name, extra, build) in cases {
        let mut args = vec!["new", name, "--kit", kit_s.as_str()];
        args.extend_from_slice(extra);
        ok(w, &args);
        let plugin = w.join(name);
        let id = format!("com.example.{name}");
        if build {
            ok(&plugin, &["test"]);
            ok(&plugin, &["pack", "--release", "--key", "../k.key"]);
        } else {
            assert!(ok(&plugin, &["validate"]).contains("0 error(s), 0 warning(s)"), "{name}");
            ok(&plugin, &["pack", "--no-build", "--key", "../k.key"]);
        }
        let mskp = plugin.join("dist").join(format!("{id}-0.1.0.mskp"));
        let report = ok(w, &["validate", mskp.to_str().unwrap()]);
        assert!(report.contains("0 error(s)") && report.contains("signature valid"), "{name}: {report}");
    }
    // the UI of the examples is in the package, built from the vendored @mosaikit/plugin-api
    assert!(
        w.join("e-todo/ui/dist/index.html").is_file() && w.join("e-insights/ui/dist/index.html").is_file()
    );
    assert!(w.join("e-todo/target/wasm32-unknown-unknown/release/e_todo.wasm").is_file());
}

// ------------------------------------------------------------------ the conformance suite (`validate --strict`)

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures")
}

fn copy_over(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap().flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if src.is_dir() {
            copy_over(&src, &dst);
        } else {
            std::fs::copy(&src, &dst).unwrap();
        }
    }
}

/// The good fixture, with the files of a broken case laid over it.
fn fixture(case: Option<&str>) -> tempfile::TempDir {
    let d = temp();
    copy_over(&fixtures().join("good"), d.path());
    if let Some(c) = case {
        copy_over(&fixtures().join("broken").join(c), d.path());
    }
    d
}

fn strict(dir: &Path) -> (bool, String) {
    let o = tool(dir, &["validate", "--strict"]);
    (o.status.success(), String::from_utf8_lossy(&o.stdout).to_string())
}

#[test]
fn the_good_fixture_passes_the_strict_suite() {
    let d = fixture(None);
    let (ok, out) = strict(d.path());
    assert!(ok && out.contains("0 error(s)"), "{out}");
    assert!(
        out.contains("migrations checked for PostgreSQL and for SQLite") && out.contains("layout contract"),
        "{out}"
    );
    // the plain validate stays as it was: no conformance report
    assert!(!ok_plain(d.path()).contains("layout contract"));
}

fn ok_plain(dir: &Path) -> String {
    ok(dir, &["validate"])
}

#[test]
fn the_broken_fixtures_fail_the_strict_suite() {
    for (case, expected) in [
        ("undeclared-notify", "[permissions] notify is not set"),
        ("unused-permission", "files_read is set but the logic never reads the Files area"),
        ("hook-not-registered", "registers no hook of it"),
        ("migration-drop", "is irreversible"),
        ("migration-gap", "002 is expected"),
        ("migration-other-schema", "migrations/002_core.sql"),
        ("ui-outside", "outside origin"),
        ("i18n-incomplete", "[i18n.it] is incomplete"),
        ("crud-layout", "which [[resources]] does not declare"),
        ("no-metadata", "no description"),
    ] {
        let d = fixture(Some(case));
        let (ok, out) = strict(d.path());
        assert!(!ok && out.contains(expected), "{case}: expected `{expected}` in\n{out}");
    }
    // the inline script and the missing style are found too
    let (_, out) = strict(fixture(Some("ui-outside")).path());
    assert!(out.contains("inline script"), "{out}");
    let (_, out) = strict(fixture(Some("crud-layout")).path());
    assert!(out.contains("style.css") && out.contains("connect()"), "{out}");
}

#[test]
fn the_official_plugins_pass_the_strict_suite() {
    // the repository of the official plugins sits next to this one (CLAUDE.md); without it there is nothing to check
    let plugins =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..").join("mosaikit-plugins");
    if !plugins.join("notes").join("plugin.toml").is_file() {
        eprintln!("mosaikit-plugins is not next to this repository: skipped");
        return;
    }
    let mut failed = Vec::new();
    for e in std::fs::read_dir(&plugins).unwrap().flatten() {
        if e.path().join("plugin.toml").is_file() {
            let (ok, out) = strict(&e.path());
            if !ok {
                failed.push(out);
            }
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}
