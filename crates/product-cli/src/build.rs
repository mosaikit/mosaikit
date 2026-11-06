//! `build desktop|docker|k8s`: a release of the product from a compiled base. No compilation of the kernel: the
//! base is the executable (or the image) of the kit; the product adds its signed plugins and registry, its brand
//! and its configuration.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use mosaikit_plugin_cli::util::{exe, run, which};
use mosaikit_plugin_cli::{package, project};
use serde_json::Value;

use crate::model::Distribution;

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// folder of the release (default: `dist/<id>-<version>-<target>` in the product folder)
    pub out: Option<PathBuf>,
    /// the signing key of the product (default: `MOSAIKIT_SIGNING_KEY`, `MOSAIKIT_SIGNING_KEY_FILE`, then the development key)
    pub key: Option<PathBuf>,
    pub release: bool,
    /// pack what is already built
    pub no_build: bool,
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)? {
        let e = e?;
        let (src, dst) = (e.path(), to.join(e.file_name()));
        if e.file_type()?.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst).with_context(|| src.display().to_string())?;
        }
    }
    Ok(())
}

fn fresh_dir(p: &Path) -> Result<()> {
    if p.exists() {
        std::fs::remove_dir_all(p).with_context(|| format!("removing {}", p.display()))?;
    }
    std::fs::create_dir_all(p)?;
    Ok(())
}

fn out_dir(d: &Distribution, o: &Options, target: &str) -> PathBuf {
    o.out.clone().unwrap_or_else(|| {
        d.dir.join("dist").join(format!("{}-{}-{target}", d.product.id, d.product.version))
    })
}

/// The registry of the release in `out`: the own packages, built and signed with the key of the product, and the
/// official plugins the product keeps, copied (with their own signature) from the registry of the base.
/// Returns the keys the server must trust.
pub fn registry(
    d: &Distribution,
    base_registry: Option<&Path>,
    out: &Path,
    o: &Options,
) -> Result<Vec<String>> {
    let own = d.release_plugins()?;
    let mut keys: Vec<String> = Vec::new();
    let mut entries: Vec<Value> = Vec::new();
    std::fs::create_dir_all(out.join("plugins"))?;
    if !own.is_empty() {
        if !o.no_build {
            project::build_wasm(&own, o.release)?;
            project::build_ui(&own)?;
        }
        let (key, source) = package::signing_key(o.key.as_deref(), &package::default_key_path())?;
        eprintln!("signing the own plugins with {source}");
        package::pack_registry(&own, o.release, out, &key)?;
        let idx: Value = serde_json::from_str(&std::fs::read_to_string(out.join("index.json"))?)?;
        entries = idx["plugins"].as_array().cloned().unwrap_or_default();
        keys.push(std::fs::read_to_string(out.join("trusted_key.txt"))?.trim().to_string());
    }
    let ids = d.official_ids()?;
    if d.all_official() || !ids.is_empty() {
        let base =
            base_registry.context("the official plugins come from the registry of the base: give --base")?;
        let bidx: Value = serde_json::from_str(
            &std::fs::read_to_string(base.join("index.json"))
                .with_context(|| format!("{}: no index.json", base.display()))?,
        )?;
        let mut found: Vec<String> = Vec::new();
        for e in bidx["plugins"].as_array().cloned().unwrap_or_default() {
            let id = e["id"].as_str().unwrap_or_default().to_string();
            if !(d.all_official() || ids.contains(&id)) || own.iter().any(|p| p.id == id) {
                continue;
            }
            for v in e["versions"].as_array().cloned().unwrap_or_default() {
                let file = v["file"].as_str().unwrap_or_default();
                let name = Path::new(file).file_name().context("file name of a package")?;
                std::fs::copy(base.join(file), out.join("plugins").join(name))
                    .with_context(|| format!("copying {file} from the registry of the base"))?;
            }
            found.push(id);
            entries.push(e);
        }
        for id in &ids {
            if !found.contains(id) {
                bail!("the official plugin {id} is not in the registry of the base");
            }
        }
        if let Ok(k) = std::fs::read_to_string(base.join("trusted_key.txt")) {
            keys.push(k.trim().to_string());
        }
    }
    keys.retain(|k| !k.is_empty());
    keys.dedup();
    verify_signed(out, &keys)?;
    std::fs::write(
        out.join("index.json"),
        serde_json::to_string_pretty(&serde_json::json!({ "plugins": entries, "blocklist": [] }))?,
    )?;
    std::fs::write(out.join("trusted_key.txt"), keys.join("\n"))?;
    eprintln!("registry: {} plugin(s)", entries.len());
    Ok(keys)
}

/// Every package of the registry must be signed by a key the release trusts: a release never carries an unsigned
/// plugin (a production server refuses it at start).
pub fn verify_signed(registry: &Path, keys: &[String]) -> Result<()> {
    let trusted = mosaikit_mskp::TrustedKeys::from_b64(keys).context("a trusted key is not a key")?;
    let dir = registry.join("plugins");
    for e in std::fs::read_dir(&dir)? {
        let p = e?.path();
        if p.extension().is_none_or(|x| x != "mskp") {
            continue;
        }
        let bytes = std::fs::read(&p)?;
        let pkg = mosaikit_mskp::Package::read(&bytes)
            .with_context(|| format!("{}: not a package", p.display()))?;
        pkg.verify(&trusted, false).with_context(|| {
            format!(
                "{}: not signed by a key the release trusts (a production server would refuse it)",
                p.display()
            )
        })?;
    }
    Ok(())
}

/// Whether `distribution.toml` asks for PostgreSQL extensions.
pub fn has_extensions(d: &Distribution) -> bool {
    std::fs::read_to_string(d.file())
        .ok()
        .and_then(|t| toml::from_str::<toml::Table>(&t).ok())
        .and_then(|t| {
            t.get("database")
                .and_then(|b| b.get("extensions"))
                .and_then(|e| e.as_array().map(|a| !a.is_empty()))
        })
        .unwrap_or(false)
}

/// Whether `distribution.toml` itself sets the first tenant (`[bootstrap] tenant`).
fn has_bootstrap_tenant(d: &Distribution) -> bool {
    std::fs::read_to_string(d.file())
        .ok()
        .and_then(|t| toml::from_str::<toml::Table>(&t).ok())
        .and_then(|t| t.get("bootstrap").and_then(|b| b.get("tenant")).cloned())
        .is_some()
}

/// Slug and name of the first tenant as the base will create it: `[bootstrap]` of the file, else `main` and the name
/// of the product (the defaults of the configuration written by `desktop_config`).
fn first_tenant(d: &Distribution) -> (String, String) {
    let b = std::fs::read_to_string(d.file())
        .ok()
        .and_then(|t| toml::from_str::<toml::Table>(&t).ok())
        .and_then(|t| t.get("bootstrap").and_then(|b| b.as_table()).cloned())
        .unwrap_or_default();
    let get = |k: &str| b.get(k).and_then(|v| v.as_str()).map(str::to_string);
    (
        get("tenant").unwrap_or_else(|| "main".into()),
        get("tenant_name").unwrap_or_else(|| d.product.name.clone()),
    )
}

fn trusted_line(keys: &[String]) -> String {
    format!("trusted_keys = [{}]", keys.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(", "))
}

fn desktop_config(d: &Distribution, keys: &[String], brand: bool) -> String {
    let mut l: Vec<String> = vec![
        format!("# {} desktop: everything on this computer.", d.product.name),
        "# Every available property is described in mosaikit.example.toml.".into(),
        String::new(),
        "# address of the app (UI of the plugins and public links on the next port)".into(),
        format!("url = \"http://127.0.0.1:{}\"", d.desktop.port),
        "# data folder: database, uploaded files, logs".into(),
        "data_dir = \"data\"".into(),
        "# opens the browser at start".into(),
        "open_browser = true".into(),
        "# local use: no second factor for the Administrator".into(),
        "admin_totp = false".into(),
    ];
    if !has_bootstrap_tenant(d) {
        l.push("# at the first start creates the work tenant with its user (or set [bootstrap] in distribution.toml)".into());
        l.push("initial_tenant = \"main\"".into());
    }
    l.extend([
        "# initial password of admin and user (to change from the Account page)".into(),
        "initial_password = \"mosaikit\"".into(),
        "# catalog of the plugins of the release (signed packages)".into(),
        "registry = \"registry/index.json\"".into(),
        "# at the first start installs and turns on the plugins of the catalog".into(),
        "preinstall = true".into(),
        "# keys of the trusted publishers: only plugins signed with these are installed".into(),
        trusted_line(keys),
    ]);
    if brand {
        l.push("# brand folder (name, logo, colours, texts)".into());
        l.push("brand = \"branding\"".into());
    }
    l.push("# the policy of the product: defaults, locked settings, first start, extensions, seeds".into());
    l.push("plugin_settings_file = \"distribution.toml\"".into());
    l.push(String::new());
    l.push("[database]".into());
    if d.desktop.database == "postgres" {
        l.push(format!("# embedded PostgreSQL in data/pg (started and stopped by {})", d.product.name));
        l.push("embedded = true".into());
    } else {
        l.push("# SQLite: a single file, data/mosaikit.db".into());
        l.push("backend = \"sqlite\"".into());
    }
    l.join("\n") + "\n"
}

fn server_config(d: &Distribution, keys: &[String], brand: bool) -> String {
    let mut l: Vec<String> = vec![
        format!("# {} server. Every property is described in mosaikit.example.toml;", d.product.name),
        "# they can also be set with the environment variables MOSAIKIT_*.".into(),
        String::new(),
        "# public address of the app (in Docker it comes from MOSAIKIT_URL)".into(),
        "url = \"http://127.0.0.1:8080\"".into(),
        "# in a container it listens on every interface, fixed internal ports".into(),
        "listen = \"0.0.0.0:8080\"".into(),
        "plugin_listen = \"0.0.0.0:8081\"".into(),
        "# data folder (volume)".into(),
        "data_dir = \"/data\"".into(),
        "registry = \"registry/index.json\"".into(),
        "preinstall = true".into(),
        trusted_line(keys),
    ];
    if brand {
        l.push("brand = \"branding\"".into());
    }
    l.push("plugin_settings_file = \"distribution.toml\"".into());
    l.join("\n") + "\n"
}

/// The base folder: a folder as it is, or a `.zip` unpacked next to `scratch` (a folder with one top folder gives that one).
fn unpack_base(base: &Path, scratch: &Path) -> Result<PathBuf> {
    if base.is_dir() {
        return Ok(base.to_path_buf());
    }
    if base.extension().is_some_and(|e| e == "zip") {
        let target = scratch.join(".base");
        fresh_dir(&target)?;
        let mut zip = zip::ZipArchive::new(std::fs::File::open(base)?)?;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i)?;
            let Some(rel) = f.enclosed_name() else { continue };
            let dst = target.join(rel);
            if f.is_dir() {
                std::fs::create_dir_all(&dst)?;
            } else {
                if let Some(p) = dst.parent() {
                    std::fs::create_dir_all(p)?;
                }
                std::io::copy(&mut f, &mut std::fs::File::create(&dst)?)?;
            }
        }
        let tops: Vec<PathBuf> = std::fs::read_dir(&target)?.flatten().map(|e| e.path()).collect();
        return Ok(if tops.len() == 1 && tops[0].is_dir() { tops[0].clone() } else { target });
    }
    bail!("--base {}: give the folder of the desktop kit, or its .zip", base.display())
}

/// `build desktop`: the folder of a release of the product for the desktop.
pub fn desktop(d: &Distribution, base: &Path, o: &Options) -> Result<PathBuf> {
    if d.desktop.database != "postgres" && has_extensions(d) {
        bail!("[database] extensions need PostgreSQL: set [desktop] database = \"postgres\" (embedded) or ship the Docker release only");
    }
    let out = out_dir(d, o, "desktop");
    fresh_dir(&out)?;
    let base_dir = unpack_base(base, &out.parent().map(Path::to_path_buf).unwrap_or_default())?;
    let base_exe = base_dir.join(exe("mosaikit"));
    if !base_exe.is_file() {
        bail!("{}: no {} in the desktop kit", base_dir.display(), exe("mosaikit"));
    }
    // everything of the base but what the product replaces
    for e in std::fs::read_dir(&base_dir)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().to_string();
        if matches!(
            name.as_str(),
            "data" | "registry" | "branding" | "mosaikit.toml" | "START.txt" | "distribution.toml"
        ) || e.path() == base_exe
        {
            continue;
        }
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &out.join(&name))?;
        } else {
            std::fs::copy(e.path(), out.join(&name))?;
        }
    }
    let product_exe = out.join(exe(&d.executable()));
    std::fs::copy(&base_exe, &product_exe)?;
    let keys = registry(d, Some(&base_dir.join("registry")), &out.join("registry"), o)?;
    let brand = d.brand_dir();
    if let Some(b) = &brand {
        copy_dir(b, &out.join("branding"))?;
    }
    std::fs::copy(d.file(), out.join("distribution.toml"))?;
    std::fs::write(out.join("mosaikit.toml"), desktop_config(d, &keys, brand.is_some()))?;
    std::fs::write(
        out.join("START.txt"),
        format!(
            "{name} {version}\n\n1. Start {exe} (double click). The first start creates the database and installs the plugins;\n   the browser opens on http://127.0.0.1:{port}.\n2. User \"user\" works in the tenant {tenant} (slug {slug}); \"admin\" (link \"Administrator access\") administers the platform.\n   Initial password of both: \"mosaikit\" (change it from the Account page).\n3. Configuration: mosaikit.toml (every property is described in mosaikit.example.toml).\n   Backup: with the program stopped copy the whole data\\ folder.\n\nBuilt on Mosaikit, with the policy of distribution.toml.\n",
            name = d.product.name,
            version = d.product.version,
            tenant = first_tenant(d).1,
            slug = first_tenant(d).0,
            exe = exe(&d.executable()),
            port = d.desktop.port
        ),
    )?;
    brand_executable(d, &product_exe, brand.as_deref());
    println!("desktop release: {}", out.display());
    Ok(out)
}

/// Name, version and icon of the executable (Windows): with `rcedit` when it is on the PATH.
fn brand_executable(d: &Distribution, exe_path: &Path, brand: Option<&Path>) {
    if !cfg!(windows) {
        return;
    }
    let icon = brand
        .and_then(|b| std::fs::read_to_string(b.join("brand.toml")).ok())
        .and_then(|t| toml::from_str::<toml::Table>(&t).ok())
        .and_then(|t| t.get("icon").and_then(|v| v.as_str().map(str::to_string)))
        .map(|f| brand.map(|b| b.join(f)).unwrap_or_default())
        .filter(|p| p.is_file());
    let Some(rcedit) = which("rcedit").or_else(|| which("rcedit-x64")) else {
        eprintln!(
            "the name, version and icon of {} were not changed: install rcedit (https://github.com/electron/rcedit) and build again",
            exe_path.display()
        );
        return;
    };
    let mut c = Command::new(rcedit);
    c.arg(exe_path)
        .args(["--set-version-string", "ProductName", &d.product.name])
        .args(["--set-version-string", "FileDescription", &d.product.name])
        .args(["--set-file-version", &d.product.version])
        .args(["--set-product-version", &d.product.version]);
    if let Some(i) = icon {
        c.arg("--set-icon").arg(i);
    }
    if let Err(e) = run(&mut c) {
        eprintln!("rcedit failed: {e}");
    }
}

/// `build docker`: the folder (context, Dockerfile, compose file) of the image of the product, `FROM` the base
/// image. With `build` it also runs `docker build`.
pub fn docker(d: &Distribution, base: &Path, base_image: &str, build: bool, o: &Options) -> Result<PathBuf> {
    let out = out_dir(d, o, "docker");
    fresh_dir(&out)?;
    // the registry of the base: the registry folder of a server bundle of the base kit
    let base_registry = base.join("registry");
    let keys =
        registry(d, base_registry.is_dir().then_some(base_registry.as_path()), &out.join("registry"), o)?;
    let brand = d.brand_dir();
    if let Some(b) = &brand {
        copy_dir(b, &out.join("branding"))?;
    } else {
        std::fs::create_dir_all(out.join("branding"))?;
    }
    std::fs::copy(d.file(), out.join("distribution.toml"))?;
    std::fs::write(out.join("mosaikit.toml"), server_config(d, &keys, brand.is_some()))?;
    let image = format!("{}:{}", d.image(), d.product.version);
    std::fs::write(
        out.join("Dockerfile"),
        format!(
            "# {name} {version}: the product on the base image.\nFROM {base_image}\nLABEL org.opencontainers.image.title=\"{name}\" org.opencontainers.image.version=\"{version}\"\nCOPY registry/ /app/registry/\nCOPY branding/ /app/branding/\nCOPY distribution.toml mosaikit.toml /app/\n",
            name = d.product.name,
            version = d.product.version
        ),
    )?;
    let pg = d.docker.postgres_image.clone().unwrap_or_else(|| "postgres:17-alpine".into());
    std::fs::write(out.join("compose.yml"), compose(&image, &pg))?;
    std::fs::create_dir_all(out.join("initdb"))?;
    std::fs::write(
        out.join("initdb").join("01-mosaikit.sh"),
        include_str!("../../../deploy/initdb/01-mosaikit.sh"),
    )?;
    if build {
        if which("docker").is_none() {
            bail!("docker not found (leave out --build to write only the folder)");
        }
        run(Command::new("docker").current_dir(&out).args(["build", "-t", &image, "."]))?;
    }
    println!("docker release: {} (image {image}{})", out.display(), if build { "" } else { ", not built" });
    Ok(out)
}

fn compose(image: &str, postgres: &str) -> String {
    format!(
        r#"# {image} + PostgreSQL. Start: docker compose up -d   (app on :8080, plugins on :8081)
# Set MOSAIKIT_ADMIN_PASSWORD, POSTGRES_PASSWORD and MOSAIKIT_DB_PASSWORD (a .env file), MOSAIKIT_URL and
# MOSAIKIT_PLUGIN_URL when the app is not on localhost. The database is never published on the host.
services:
  db:
    image: {postgres}
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: ${{POSTGRES_PASSWORD:-change-this-password}}
      MOSAIKIT_DB_PASSWORD: ${{MOSAIKIT_DB_PASSWORD:-change-this-too}}
    shm_size: 256mb
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d mosaikit"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 10s
  app:
    image: {image}
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      MOSAIKIT_DATABASE_URL: postgres://mosaikit_app:${{MOSAIKIT_DB_PASSWORD:-change-this-too}}@db:5432/mosaikit
      MOSAIKIT_ADMIN_PASSWORD: ${{MOSAIKIT_ADMIN_PASSWORD:-change-me-now}}
      MOSAIKIT_URL: ${{MOSAIKIT_URL:-http://localhost:8080}}
      MOSAIKIT_PLUGIN_URL: ${{MOSAIKIT_PLUGIN_URL:-http://localhost:8081}}
    ports:
      - "${{MOSAIKIT_HTTP_PORT:-8080}}:8080"
      - "${{MOSAIKIT_PLUGIN_PORT:-8081}}:8081"
    volumes:
      - appdata:/data
volumes:
  pgdata:
  appdata:
"#
    )
}

/// `build k8s`: the kustomize overlay of the product over the `k8s` folder of the base kit.
pub fn k8s(d: &Distribution, base_k8s: &Path, o: &Options) -> Result<PathBuf> {
    if !base_k8s.join("kustomization.yaml").is_file() {
        bail!("{}: no kustomization.yaml (give the k8s folder of the base kit)", base_k8s.display());
    }
    let out = out_dir(d, o, "k8s");
    fresh_dir(&out)?;
    copy_dir(base_k8s, &out.join("base"))?;
    std::fs::write(
        out.join("kustomization.yaml"),
        format!(
            "# {name} {version} on Kubernetes: the base kit plus the image of the product.\napiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - base\nimages:\n  - name: mosaikit\n    newName: {image}\n    newTag: \"{version}\"\n",
            name = d.product.name,
            version = d.product.version,
            image = d.image()
        ),
    )?;
    println!(
        "kubernetes release: {} (build and push the image {}:{} first)",
        out.display(),
        d.image(),
        d.product.version
    );
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn product(t: &Path) -> Distribution {
        let root = crate::scaffold::new_product("acme", t).unwrap();
        // no own plugin: the official ones of the base come with the release
        let text = std::fs::read_to_string(root.join("distribution.toml"))
            .unwrap()
            .replace("roots = [\"plugins\"]", "roots = []");
        std::fs::write(root.join("distribution.toml"), text).unwrap();
        Distribution::load(&root).unwrap()
    }

    fn package(signed: bool) -> (Vec<u8>, String) {
        let key = mosaikit_mskp::generate_key();
        let mut files = std::collections::BTreeMap::new();
        files.insert(
            "plugin.toml".to_string(),
            b"id = \"com.mosaikit.notes\"
name = \"Notes\"
version = \"1.0.0\"
"
            .to_vec(),
        );
        (mosaikit_mskp::pack(&files, signed.then_some(&key)).unwrap(), mosaikit_mskp::public_key_b64(&key))
    }

    fn fake_desktop_base(t: &Path) -> PathBuf {
        fake_desktop_base_with(t, true)
    }

    fn fake_desktop_base_with(t: &Path, signed: bool) -> PathBuf {
        let (pkg, key) = package(signed);
        let base = t.join("base");
        std::fs::create_dir_all(base.join("registry").join("plugins")).unwrap();
        std::fs::write(base.join(exe("mosaikit")), b"exe").unwrap();
        std::fs::write(base.join("mosaikit.example.toml"), "# all\n").unwrap();
        std::fs::write(base.join("registry").join("plugins").join("com.mosaikit.notes-1.0.0.mskp"), pkg)
            .unwrap();
        std::fs::write(
            base.join("registry").join("index.json"),
            r#"{"plugins":[{"id":"com.mosaikit.notes","versions":[{"version":"1.0.0","file":"plugins/com.mosaikit.notes-1.0.0.mskp"}]},{"id":"com.mosaikit.tasks","versions":[{"version":"1.0.0","file":"plugins/gone.mskp"}]}],"blocklist":[]}"#,
        )
        .unwrap();
        std::fs::write(base.join("registry").join("trusted_key.txt"), key).unwrap();
        base
    }

    #[test]
    fn a_desktop_release_has_the_executable_the_registry_the_brand_and_the_configuration() {
        let t = tempfile::tempdir().unwrap();
        let mut d = product(t.path());
        d.plugins.include = vec!["com.mosaikit.notes".into()];
        let base = fake_desktop_base(t.path());
        let out =
            desktop(&d, &base, &Options { out: Some(t.path().join("out")), ..Options::default() }).unwrap();
        assert!(out.join(exe("acme")).is_file() && !out.join(exe("mosaikit")).exists());
        assert!(out.join("registry/plugins/com.mosaikit.notes-1.0.0.mskp").is_file());
        assert!(!out.join("registry/plugins/gone.mskp").exists(), "only the plugins the product keeps");
        let index = std::fs::read_to_string(out.join("registry/index.json")).unwrap();
        assert!(index.contains("com.mosaikit.notes") && !index.contains("com.mosaikit.tasks"), "{index}");
        let cfg = std::fs::read_to_string(out.join("mosaikit.toml")).unwrap();
        assert!(
            cfg.contains("trusted_keys = [\"")
                && cfg.contains("brand = \"branding\"")
                && cfg.contains("plugin_settings_file"),
            "{cfg}"
        );
        assert!(out.join("branding/brand.toml").is_file() && out.join("distribution.toml").is_file());
        // START.txt names the tenant of the policy, not the product
        let start = std::fs::read_to_string(out.join("START.txt")).unwrap();
        let (slug, name) = first_tenant(&d);
        assert!(start.contains(&format!("tenant {name} (slug {slug})")), "{start}");
    }

    #[test]
    fn a_release_never_carries_an_unsigned_plugin() {
        let t = tempfile::tempdir().unwrap();
        let mut d = product(t.path());
        d.plugins.include = vec!["com.mosaikit.notes".into()];
        let base = fake_desktop_base_with(t.path(), false);
        let e = desktop(&d, &base, &Options { out: Some(t.path().join("out")), ..Options::default() })
            .unwrap_err();
        assert!(format!("{e:#}").contains("not signed"), "{e:#}");
    }

    #[test]
    fn extensions_need_postgresql_on_the_desktop() {
        let t = tempfile::tempdir().unwrap();
        let mut d = product(t.path());
        d.plugins.include = vec!["com.mosaikit.notes".into()];
        let text = std::fs::read_to_string(d.file())
            .unwrap()
            .replace(
                "# [database]
# extensions",
                "[database]
extensions",
            )
            .replace("= [\"postgis\"]         #", "= [\"postgis\"] #");
        std::fs::write(d.file(), text).unwrap();
        assert!(has_extensions(&d), "{}", std::fs::read_to_string(d.file()).unwrap());
        let base = fake_desktop_base(t.path());
        let e = desktop(&d, &base, &Options { out: Some(t.path().join("out")), ..Options::default() })
            .unwrap_err();
        assert!(format!("{e:#}").contains("need PostgreSQL"), "{e:#}");
    }

    #[test]
    fn an_official_plugin_missing_from_the_base_is_an_error() {
        let t = tempfile::tempdir().unwrap();
        let mut d = product(t.path());
        d.plugins.include = vec!["com.mosaikit.nowhere".into()];
        let base = fake_desktop_base(t.path());
        let e = desktop(&d, &base, &Options { out: Some(t.path().join("out")), ..Options::default() })
            .unwrap_err();
        assert!(format!("{e:#}").contains("com.mosaikit.nowhere"), "{e:#}");
    }

    #[test]
    fn the_docker_release_is_a_dockerfile_on_the_base_image_and_a_compose_file() {
        let t = tempfile::tempdir().unwrap();
        let mut d = product(t.path());
        d.plugins.include = vec!["com.mosaikit.notes".into()];
        d.docker.postgres_image = Some("postgis/postgis:17-3.5-alpine".into());
        let base = fake_desktop_base(t.path());
        let out = docker(
            &d,
            &base,
            "mosaikit:1.0.0",
            false,
            &Options { out: Some(t.path().join("img")), ..Options::default() },
        )
        .unwrap();
        let df = std::fs::read_to_string(out.join("Dockerfile")).unwrap();
        assert!(df.contains("FROM mosaikit:1.0.0") && df.contains("COPY registry/"), "{df}");
        let c = std::fs::read_to_string(out.join("compose.yml")).unwrap();
        assert!(c.contains("image: acme:0.1.0") && c.contains("postgis/postgis"), "{c}");
        assert!(std::fs::read_to_string(out.join("mosaikit.toml")).unwrap().contains("0.0.0.0:8080"));
        assert!(out.join("initdb/01-mosaikit.sh").is_file());
    }

    #[test]
    fn the_kubernetes_overlay_sets_the_image() {
        let t = tempfile::tempdir().unwrap();
        let d = product(t.path());
        let k = t.path().join("k8s");
        std::fs::create_dir_all(&k).unwrap();
        std::fs::write(k.join("kustomization.yaml"), "resources: []\n").unwrap();
        let out = k8s(&d, &k, &Options { out: Some(t.path().join("kout")), ..Options::default() }).unwrap();
        let text = std::fs::read_to_string(out.join("kustomization.yaml")).unwrap();
        assert!(text.contains("newName: acme") && text.contains("newTag: \"0.1.0\""), "{text}");
        assert!(out.join("base/kustomization.yaml").is_file());
        assert!(k8s(&d, &t.path().join("nope"), &Options::default()).is_err());
    }
}
