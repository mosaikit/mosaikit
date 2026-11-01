//! `validate`: manifest, migrations, permissions and `.mskp` packages, checked without a server.

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use mosaikit_mskp::{Manifest, Package, TrustedKeys, API_VERSION};

use crate::conformance;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone)]
pub struct Finding {
    pub level: Level,
    pub message: String,
}

#[derive(Debug, Default)]
pub struct Report {
    /// what was checked (a folder or a package)
    pub subject: String,
    pub findings: Vec<Finding>,
}

impl Report {
    pub(crate) fn add(&mut self, level: Level, message: impl Into<String>) {
        self.findings.push(Finding { level, message: message.into() });
    }
    pub(crate) fn error(&mut self, m: impl Into<String>) {
        self.add(Level::Error, m);
    }
    pub(crate) fn warn(&mut self, m: impl Into<String>) {
        self.add(Level::Warning, m);
    }
    pub(crate) fn info(&mut self, m: impl Into<String>) {
        self.add(Level::Info, m);
    }
    pub fn errors(&self) -> usize {
        self.findings.iter().filter(|f| f.level == Level::Error).count()
    }
    pub fn warnings(&self) -> usize {
        self.findings.iter().filter(|f| f.level == Level::Warning).count()
    }
    pub fn ok(&self) -> bool {
        self.errors() == 0
    }
    pub fn print(&self) {
        println!("{}", self.subject);
        for f in &self.findings {
            let tag = match f.level {
                Level::Error => "error  ",
                Level::Warning => "warning",
                Level::Info => "info   ",
            };
            println!("  {tag} {}", f.message);
        }
        println!("  {} error(s), {} warning(s)", self.errors(), self.warnings());
    }
}

/// What `validate` checks besides the basics.
#[derive(Debug, Clone, Copy, Default)]
pub struct Options {
    /// the conformance suite (`conformance.rs`): permissions against the calls of the logic, migrations,
    /// the UI, i18n coverage, the layout contract; and the description, author and license are required
    pub strict: bool,
}

/// Checks a plugin folder (with a `plugin.toml`) or a `.mskp` file.
pub fn validate(path: &Path) -> Result<Report> {
    validate_with(path, Options::default())
}

/// The same, with options.
pub fn validate_with(path: &Path, o: Options) -> Result<Report> {
    let mut r = Report { subject: path.display().to_string(), ..Default::default() };
    if path.is_dir() {
        folder(path, o, &mut r)?;
    } else if path.is_file() {
        package(path, o, &mut r)?;
    } else {
        bail!("{} does not exist", path.display());
    }
    Ok(r)
}

/// What the manifest asks for, whatever carries it: versions, deprecated keys, permissions.
fn manifest_checks(m: &Manifest, strict: bool, r: &mut Report) {
    r.info(format!("{} {} ({})", m.id, m.version, m.effective_kind().as_str()));
    if strict {
        if m.description.trim().is_empty() {
            r.error("no description: the Administrator reads it before installing");
        }
        if m.author.is_none() {
            r.error("no author");
        }
        if m.license.is_none() {
            r.error("no license");
        }
    }
    for d in m.deprecations() {
        r.warn(d);
    }
    if m.requires.mosaikit.is_none() {
        r.warn("no [requires] mosaikit: the plugin says it works with any version of Mosaikit (e.g. \">=1.0, <2\")");
    }
    if m.requires.api.is_none() && m.abi.is_none() {
        r.warn(format!(
            "no [requires] api: the plugin is taken to be built for the current API ({API_VERSION})"
        ));
    }
    if m.api() != API_VERSION {
        r.error(format!("[requires] api = {}: this tool builds for plugin API {API_VERSION}", m.api()));
    }
    let p = &m.permissions;
    for c in &p.calls {
        if !mosaikit_mskp::is_plugin_id(c) {
            r.error(format!("[permissions] calls lists '{c}', which is not a plugin id"));
        }
    }
    for (what, list) in [("network", &p.network), ("frame_src", &p.frame_src)] {
        for o in list {
            let ok = o.starts_with("https://") || o.starts_with("http://") || o.starts_with("wss://");
            if !ok || o.contains(' ') {
                r.warn(format!("[permissions] {what} '{o}' is not an origin (https://host[:port])"));
            }
        }
    }
    // what the Administrator is shown as sensitive when the plugin is installed
    let mut sensitive: Vec<&str> = Vec::new();
    for (on, name) in [
        (p.script_eval, "script_eval"),
        (p.web, "web"),
        (p.files, "files"),
        (p.files_read, "files_read"),
        (p.content, "content"),
        (p.notify, "notify"),
        (!p.network.is_empty(), "network"),
    ] {
        if on {
            sensitive.push(name);
        }
    }
    if !sensitive.is_empty() {
        r.info(format!("permissions the Administrator will review: {}", sensitive.join(", ")));
    }
}

/// Every migration against the allow-list of statements (the one the server applies at install).
fn migration_checks(m: &Manifest, migrations: &[(String, String)], r: &mut Report) {
    let schema = m.schema_name();
    for (name, sql) in migrations {
        if let Err(e) = mosaikit_sql_guard::check_migration(sql, &schema) {
            r.error(format!("migrations/{name}: {e}"));
        }
    }
    if !migrations.is_empty() {
        r.info(format!("{} migration(s) checked against schema {schema}", migrations.len()));
    }
}

fn folder(dir: &Path, o: Options, r: &mut Report) -> Result<()> {
    let toml_path = dir.join("plugin.toml");
    let text = match std::fs::read_to_string(&toml_path) {
        Ok(t) => t,
        Err(_) => {
            r.error(format!("{} not found: it is not a plugin folder", toml_path.display()));
            return Ok(());
        }
    };
    let m = match Manifest::from_toml(&text) {
        Ok(m) => m,
        Err(e) => {
            r.error(format!("plugin.toml: {e}"));
            return Ok(());
        }
    };
    manifest_checks(&m, o.strict, r);

    // migrations
    let mut migrations = Vec::new();
    let mdir = dir.join("migrations");
    if mdir.is_dir() {
        let mut names: Vec<_> = std::fs::read_dir(&mdir)?.flatten().map(|e| e.file_name()).collect();
        names.sort();
        for n in names {
            let name = n.to_string_lossy().to_string();
            if mosaikit_mskp::parse_migration_name(&name).is_none() {
                r.error(format!("migrations/{name}: invalid name (expected NNN_name.sql)"));
                continue;
            }
            match std::fs::read_to_string(mdir.join(&n)) {
                Ok(sql) => migrations.push((name, sql)),
                Err(e) => r.error(format!("migrations/{name}: {e}")),
            }
        }
    }
    migration_checks(&m, &migrations, r);
    if o.strict {
        conformance::folder(dir, &m, &migrations, r);
    }

    // logic
    let has_crate = dir.join("Cargo.toml").is_file();
    if !m.permissions.hooks.is_empty() && !has_crate {
        r.error("[permissions] hooks are listed but the plugin has no logic (no Cargo.toml)");
    }

    // UI
    if let Some(ui) = &m.ui {
        if !dir.join("ui").is_dir() {
            r.error("[ui] is declared but there is no ui/ folder");
        } else {
            let dist = dir.join("ui").join("dist");
            if !dist.is_dir() {
                r.warn("the UI is not built yet (mosaikit-plugin build): its entry page was not checked");
            } else {
                for page in std::iter::once(&ui.entry).chain(ui.public_view.iter()) {
                    if !dist.join(page).is_file() {
                        r.error(format!(
                            "ui/dist/{page} not found: the manifest points at a page the build does not make"
                        ));
                    }
                }
            }
        }
    }

    // the same assembly `pack` does, without the build products: names, screenshots, layout, language
    match mosaikit_mskp::collect_plugin_dir(dir, None).and_then(|files| mosaikit_mskp::pack(&files, None)) {
        Ok(bytes) => {
            if let Err(e) = Package::read(&bytes) {
                r.error(e.to_string());
            }
        }
        Err(e) => r.error(e.to_string()),
    }
    Ok(())
}

fn package(path: &Path, o: Options, r: &mut Report) -> Result<()> {
    let bytes = std::fs::read(path).with_context(|| path.display().to_string())?;
    let pkg = match Package::read(&bytes) {
        Ok(p) => p,
        Err(e) => {
            r.error(e.to_string());
            return Ok(());
        }
    };
    r.info(format!("{} KB, sha256 {}", bytes.len().div_ceil(1024), pkg.sha256));
    manifest_checks(&pkg.manifest, o.strict, r);
    match pkg.migrations() {
        Ok(ms) => {
            let pairs: Vec<(String, String)> = ms.into_iter().map(|(_, n, s)| (n, s)).collect();
            migration_checks(&pkg.manifest, &pairs, r);
            if o.strict {
                conformance::package(&pkg, &pairs, r);
            }
        }
        Err(e) => r.error(e.to_string()),
    }
    match &pkg.signature {
        None => r.warn("unsigned: a server installs it only if it allows unsigned packages"),
        Some(sig) => match TrustedKeys::from_b64(&[&sig.key]).and_then(|t| pkg.verify(&t, false)) {
            Ok(_) => r.info(format!("signature valid, publisher key {} (the server must trust it)", sig.key)),
            Err(e) => r.error(format!("signature: {e}")),
        },
    }
    match pkg.wasm() {
        Some(w) if !w.starts_with(b"\0asm") => r.error("logic.wasm is not a WebAssembly module"),
        None if !pkg.manifest.permissions.hooks.is_empty() => {
            r.error("[permissions] hooks are listed but the package has no logic.wasm")
        }
        _ => {}
    }
    if let Some(ui) = &pkg.manifest.ui {
        let files: BTreeMap<&str, &[u8]> = pkg.ui_files().collect();
        for page in std::iter::once(&ui.entry).chain(ui.public_view.iter()) {
            if !files.contains_key(page.as_str()) {
                r.error(format!("ui/{page} is not in the package"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(dir: &Path, toml: &str, migration: Option<&str>) {
        std::fs::write(dir.join("plugin.toml"), toml).unwrap();
        if let Some(sql) = migration {
            std::fs::create_dir_all(dir.join("migrations")).unwrap();
            std::fs::write(dir.join("migrations").join("001_init.sql"), sql).unwrap();
        }
    }

    const MIN: &str = "id = \"com.test.demo\"\nname = \"Demo\"\nversion = \"0.1.0\"\n[requires]\nmosaikit = \">=1.0, <2\"\napi = 1\n";

    #[test]
    fn a_good_folder_passes() {
        let d = tempfile::tempdir().unwrap();
        plugin(d.path(), MIN, None);
        let r = validate(d.path()).unwrap();
        assert!(r.ok() && r.warnings() == 0, "{:?}", r.findings);
    }

    #[test]
    fn manifest_errors_and_warnings_are_reported() {
        let d = tempfile::tempdir().unwrap();
        plugin(d.path(), "id = \"x\"\nname = \"Demo\"\nversion = \"0.1.0\"\n", None);
        assert!(validate(d.path()).unwrap().errors() > 0);
        plugin(d.path(), "id = \"com.test.demo\"\nname = \"Demo\"\nversion = \"0.1.0\"\n", None);
        let r = validate(d.path()).unwrap();
        assert!(r.ok() && r.warnings() == 2, "{:?}", r.findings);
        let with_hook = format!(
            "{MIN}[[resources]]\nname = \"notes\"\nlabel = \"Notes\"\nfields = [{{ key = \"title\", label = \"Title\", kind = \"text\" }}]\n[permissions]\nhooks = [\"notes\"]\n"
        );
        plugin(d.path(), &with_hook, None);
        let r = validate(d.path()).unwrap();
        assert!(r.errors() == 1, "hooks without logic: {:?}", r.findings);
        std::fs::write(d.path().join("Cargo.toml"), "[package]\nname = \"demo\"\n").unwrap();
        assert!(validate(d.path()).unwrap().ok());
    }

    #[test]
    fn migrations_go_through_the_guard() {
        let d = tempfile::tempdir().unwrap();
        let schema = mosaikit_mskp::schema_name("com.test.demo");
        plugin(d.path(), MIN, Some(&format!("create table {schema}.t (id int);")));
        assert!(validate(d.path()).unwrap().ok());
        plugin(d.path(), MIN, Some("drop table core.users;"));
        assert!(validate(d.path()).unwrap().errors() > 0);
    }

    #[test]
    fn packages_are_checked() {
        let d = tempfile::tempdir().unwrap();
        let mut files = BTreeMap::new();
        files.insert("plugin.toml".to_string(), MIN.as_bytes().to_vec());
        let key = mosaikit_mskp::generate_key();
        let f = d.path().join("a.mskp");
        std::fs::write(&f, mosaikit_mskp::pack(&files, Some(&key)).unwrap()).unwrap();
        let r = validate(&f).unwrap();
        assert!(r.ok() && r.warnings() == 0, "{:?}", r.findings);
        std::fs::write(&f, mosaikit_mskp::pack(&files, None).unwrap()).unwrap();
        assert!(validate(&f).unwrap().warnings() == 1);
        std::fs::write(&f, b"not a zip").unwrap();
        assert!(!validate(&f).unwrap().ok());
    }
}
