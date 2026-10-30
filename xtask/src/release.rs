//! Release: bundle (server + signed plugins + registry), desktop (zip with
//! embedded PostgreSQL), Docker image.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::plugins;
use crate::util::{copy_dir, exe, npm, pg_bin, root, run, walk_files, which};

#[derive(Clone, Copy, PartialEq, Eq, clap::ValueEnum, Debug)]
pub enum Flavor {
    /// server (Docker or installation with an external PostgreSQL)
    Server,
    /// desktop (embedded PostgreSQL, opens the browser)
    Desktop,
}

fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// `mosaikit.toml` of the release, with a description for every property.
fn config(flavor: Flavor, trusted: &str, brand: bool) -> String {
    let d = crate::dist::current();
    let name = &d.product.name;
    let mut l: Vec<String> = Vec::new();
    let mut push = |s: &str| l.push(s.to_string());
    match flavor {
        Flavor::Desktop => {
            push(&format!("# {name} desktop: everything on this computer."));
            push("# Every available property is described in mosaikit.example.toml.");
            push("");
            push("# address of the app (UI of the plugins and public links on the next port)");
            push(&format!("url = \"http://127.0.0.1:{}\"", d.desktop.port));
            push("# data folder: database, uploaded files, logs");
            push("data_dir = \"data\"");
            push("# opens the browser at start");
            push("open_browser = true");
            push("# local use: no second factor for the Administrator");
            push("admin_totp = false");
            push("# at the first start creates the work tenant with its user");
            push("initial_tenant = \"locale\"");
            push("# initial password of admin and user (to change from the Account page)");
            push("initial_password = \"mosaikit\"");
        }
        Flavor::Server => {
            push(&format!("# {name} server. Every property is described in mosaikit.example.toml;"));
            push("# they can also be set with the environment variables MOSAIKIT_* (see README):");
            push("# MOSAIKIT_URL, MOSAIKIT_PLUGIN_URL, MOSAIKIT_DATABASE_URL, MOSAIKIT_ADMIN_PASSWORD.");
            push("");
            push("# public address of the app (in Docker it comes from MOSAIKIT_URL)");
            push("url = \"http://127.0.0.1:8080\"");
            push("# in a container it listens on every interface, fixed internal ports");
            push("listen = \"0.0.0.0:8080\"");
            push("plugin_listen = \"0.0.0.0:8081\"");
            push("# data folder (volume)");
            push("data_dir = \"/data\"");
        }
    }
    push("# catalog of the plugins included in the release (signed packages)");
    push("registry = \"registry/index.json\"");
    push("# at the first start installs and turns on the plugins of the catalog");
    push("preinstall = true");
    push("# keys of the trusted publishers: only plugins signed with these are installed");
    push(&format!("trusted_keys = [\"{trusted}\"]"));
    if brand {
        push("# brand folder (name, logo, colours, texts)");
        push("brand = \"branding\"");
    }
    if flavor == Flavor::Desktop {
        push("");
        push("[database]");
        if d.desktop.database == "postgres" {
            push(&format!("# embedded PostgreSQL in data/pg (started and stopped by {name})"));
            push("embedded = true");
        } else {
            push("# SQLite: a single file, data/mosaikit.db");
            push("backend = \"sqlite\"");
        }
    }
    l.join("\n") + "\n"
}

/// Release server + signed plugins + registry + configuration in `out`.
pub fn bundle(out: &Path, skip_ui: bool, flavor: Flavor) -> Result<()> {
    let all = plugins::discover()?;
    if !skip_ui {
        plugins::ensure_npm()?;
        run(npm().current_dir(root()).args(["run", "build"]))?;
        plugins::build_ui(&all)?;
    }
    if !root().join("ui").join("host").join("dist").join("index.html").is_file() {
        bail!("host UI not built (ui/host/dist): run npm run build");
    }
    plugins::build_wasm(&all, true)?;
    let mut build = Command::new("cargo");
    build.current_dir(root()).args(["build", "--release"]);
    if flavor == Flavor::Server {
        build.args(["-p", "mosaikit-server"]);
    } else {
        // a single executable: app without a console with an icon in the notification area,
        // with name, version and icon of the brand; from a terminal also the administration
        // commands (migrate, reset-password, config)
        let d = crate::dist::current();
        build.args(["-p", "mosaikit-desktop"]);
        build
            .env("MOSAIKIT_PRODUCT_NAME", &d.product.name)
            .env("MOSAIKIT_PRODUCT_VERSION", &d.product.version);
        if let Some(ico) = brand_icon(d) {
            build.env("MOSAIKIT_BRAND_ICON", ico);
        }
    }
    run(&mut build)?;
    std::fs::create_dir_all(out)?;
    let (bin, dest) = match flavor {
        Flavor::Server => (exe("mosaikit-server"), exe("mosaikit-server")),
        Flavor::Desktop => (exe("mosaikit"), exe(&crate::dist::current().executable())),
    };
    {
        std::fs::copy(plugins::target_dir().join("release").join(&bin), out.join(&dest))
            .with_context(|| format!("copying {bin}"))?;
    }
    plugins::pack_all(&all, true, &out.join("registry"))?;
    let brand = crate::dist::current().brand.dir.clone().filter(|b| b.is_dir());
    if let Some(b) = &brand {
        copy_dir(b, &out.join("branding"))?;
    }
    let trusted = std::fs::read_to_string(out.join("registry").join("trusted_key.txt"))?;
    std::fs::write(out.join("mosaikit.toml"), config(flavor, trusted.trim(), brand.is_some()))?;
    std::fs::copy(root().join("mosaikit.example.toml"), out.join("mosaikit.example.toml"))?;
    // --- sidecars ---
    if flavor == Flavor::Desktop {
        bundle_sidecars(out)?;
    }
    // --- end sidecars ---
    eprintln!("bundle ready in {}", out.display());
    Ok(())
}

// --- sidecars ---
/// Desktop bundle: executables of the sidecars in `sidecars/<name>/` and `sidecars.toml` for the launcher.
fn bundle_sidecars(out: &Path) -> Result<()> {
    let d = crate::dist::current();
    if d.sidecars.is_empty() {
        return Ok(());
    }
    crate::sidecars::check_desktop(&d.sidecars, &d.dir)?;
    for s in &d.sidecars {
        let Some(c) = &s.command else { continue };
        let src = d.dir.join(crate::sidecars::bundle_source(c));
        let dest = out.join("sidecars").join(&s.name);
        std::fs::create_dir_all(&dest)?;
        if src.is_dir() {
            copy_dir(&src, &dest)?;
        } else {
            let file = crate::sidecars::resolve_command(&d.dir, c).context("sidecar executable")?;
            std::fs::copy(&file, dest.join(file.file_name().context("file name")?))?;
        }
    }
    std::fs::write(out.join("sidecars.toml"), crate::sidecars::desktop_toml(&d.sidecars)?)?;
    eprintln!("{} sidecar(s) copied", d.sidecars.len());
    Ok(())
}
// --- end sidecars ---

/// .ico file of the brand of the distribution (property `icon` of brand.toml).
fn brand_icon(d: &crate::dist::Distribution) -> Option<PathBuf> {
    let dir = d.brand.dir.as_ref()?;
    let text = std::fs::read_to_string(dir.join("brand.toml")).ok()?;
    let v: toml::Value = toml::from_str(&text).ok()?;
    let ico = dir.join(v.get("icon")?.as_str()?);
    ico.is_file().then_some(ico)
}

fn start_guide(postgres: bool) -> String {
    let d = crate::dist::current();
    let (name, version, exe) = (&d.product.name, &d.product.version, d.executable());
    let port = d.desktop.port;
    let title = format!("{name} {version} - desktop version");
    let db = if postgres {
        "At the first start it creates the PostgreSQL database in data\\pg and installs the included plugins."
    } else {
        "At the first start it creates the database (SQLite, data\\mosaikit.db) and installs the included plugins."
    };
    let stop = if postgres { " (it stops PostgreSQL too)" } else { "" };
    format!(
        "{title}\n{}\n\n\
         1. Start {name} (double click on {exe}.exe). The {name} icon appears\n   \
            in the notification area (next to the clock); if the start takes a few\n   \
            seconds, a small window shows its version and progress.\n   \
            {db}\n\
         2. At the first start the browser opens on http://127.0.0.1:{port}; from then on\n   \
            a Windows notification with the address appears (click to open it).\n   \
            To open the app again: click on the icon.\n\
         3. First sign-in: user \"user\", ready to work. For the\n   \
            administration (plugins, other tenants and users): link \"Administrator\n   \
            access\", user \"admin\". Initial password of both:\n   \
            \"mosaikit\" (also in data\\credenziali-iniziali.txt, icon menu >\n   \
            Initial credentials): change it at once from the Account page.\n\
         4. To stop: icon menu > Quit{stop}.\n\n\
         Log: data\\logs\\mosaikit.log (icon menu > Log).\n\
         Backup: with the program stopped copy the whole data\\ folder.\n\
         Configuration: mosaikit.toml (every property is described in mosaikit.example.toml).\n\
         Administration, from a terminal in the folder of the program (with the program stopped):\n   \
            .\\{exe}.exe --help\n   \
            .\\{exe}.exe reset-password --user admin\n   \
            .\\{exe}.exe config\n",
        "=".repeat(title.chars().count())
    )
}

/// Desktop zip. The database is the one of the distribution (`[desktop] database`):
/// with "sqlite" nothing else is needed, with "postgres" PostgreSQL is included (`--pg-dir`).
pub fn desktop(pg_dir: Option<PathBuf>, no_pg: bool) -> Result<()> {
    let d = crate::dist::current();
    let postgres = d.desktop.database == "postgres";
    let name = format!("{}-{}-desktop-{}", d.product.id, d.product.version, platform());
    let dist = dist_dir(d);
    let out = dist.join(&name);
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    bundle(&out, false, Flavor::Desktop)?;
    std::fs::write(out.join("START.txt"), start_guide(postgres))?;
    if postgres && !no_pg {
        let src = match pg_dir {
            Some(d) => d,
            None => pg_bin().and_then(|b| b.parent().map(Path::to_path_buf)).context(
                "PostgreSQL not found: give --pg-dir (folder with bin/, lib/, share/) or use --no-pg",
            )?,
        };
        eprintln!("copying PostgreSQL from {}", src.display());
        for sub in ["bin", "lib", "share"] {
            copy_dir(&src.join(sub), &out.join("pgsql").join(sub))?;
        }
    }
    let zip_path = dist.join(format!("{name}.zip"));
    zip_dir(&out, &name, &zip_path)?;
    checksums(&dist)?;
    println!("\nrelease desktop: {}\n                 {}", out.display(), zip_path.display());
    Ok(())
}

fn zip_dir(dir: &Path, prefix: &str, dest: &Path) -> Result<()> {
    eprintln!("creating {}", dest.display());
    let f = std::fs::File::create(dest)?;
    let mut w = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    for (rel, path) in walk_files(dir)? {
        w.start_file(format!("{prefix}/{rel}"), opts)?;
        let mut src = std::fs::File::open(&path)?;
        std::io::copy(&mut src, &mut w)?;
    }
    w.finish()?.flush()?;
    Ok(())
}

/// Release folder of the distribution: `<distribution>/dist`
/// (mosaikit/dist for Mosaikit).
fn dist_dir(d: &crate::dist::Distribution) -> PathBuf {
    d.dir.join("dist")
}

/// Docker images saved in the `*-docker` folders of the dist.
fn walk_tars(dist: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dist)?.flatten() {
        if e.path().is_dir() && e.file_name().to_string_lossy().ends_with("-docker") {
            for f in std::fs::read_dir(e.path())?.flatten() {
                if f.path().extension().is_some_and(|x| x == "tar") {
                    out.push(f.path());
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

fn checksums(dist: &Path) -> Result<()> {
    let mut lines = String::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(dist)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "zip" || e == "tar"))
        .collect();
    files.sort();
    for p in files.iter().chain(walk_tars(dist)?.iter()) {
        let mut h = Sha256::new();
        let mut f = std::fs::File::open(p)?;
        std::io::copy(&mut f, &mut h)?;
        lines.push_str(&format!(
            "{}  {}\n",
            hex::encode(h.finalize()),
            p.strip_prefix(dist).unwrap_or(p).to_string_lossy().replace('\\', "/")
        ));
    }
    std::fs::write(dist.join("SHA256SUMS"), lines)?;
    Ok(())
}

/// Docker image of the active distribution (multi-stage build). The context is the
/// folder that contains mosaikit, mosaikit-plugins and the distributions; the signing
/// key arrives as a BuildKit secret.
pub fn docker(tag: Option<String>) -> Result<()> {
    if which("docker").is_none() {
        bail!("docker not found");
    }
    let d = crate::dist::current();
    crate::sidecars::check_containers(&d.sidecars)?;
    // build context: mosaikit, the plugin folders and the distribution, copied
    // (without builds, dependencies and data) into a temporary folder with the same
    // relative layout they have locally
    let parent = root().parent().context("parent folder of mosaikit")?.to_path_buf();
    let rel = |p: &Path| -> Result<PathBuf> {
        let abs = std::path::absolute(p)?;
        let base = std::path::absolute(&parent)?;
        Ok(abs
            .strip_prefix(&base)
            .map_err(|_| anyhow::anyhow!("{} must be next to mosaikit ({})", p.display(), base.display()))?
            .to_path_buf())
    };
    let mut dirs: Vec<PathBuf> = vec![rel(&root())?, rel(&d.dir)?];
    for r in &d.plugins.roots {
        dirs.push(rel(r)?);
    }
    dirs.sort();
    dirs.dedup();
    // a folder already inside another one of the list is copied with that one
    let tops: Vec<PathBuf> =
        dirs.iter().filter(|x| !dirs.iter().any(|y| y != *x && x.starts_with(y))).cloned().collect();
    let context = std::env::temp_dir().join(format!("mosaikit-docker-{}", d.product.id));
    if context.exists() {
        std::fs::remove_dir_all(&context)?;
    }
    for t in &tops {
        copy_sources(&parent.join(t), &context.join(t))?;
    }
    let dist_rel = rel(&d.dir)?.to_string_lossy().replace('\\', "/");
    let image = d.docker.image.clone().unwrap_or_else(|| d.product.id.clone());
    let tag = tag.unwrap_or_else(|| format!("{image}:{}", d.product.version));
    let (key, source) = plugins::signing_key()?;
    let key_file = root().join(".dev").join("docker-signing.key");
    std::fs::create_dir_all(key_file.parent().expect(".dev folder"))?;
    std::fs::write(&key_file, mosaikit_mskp::signing_key_to_b64(&key))?;
    eprintln!("signing the plugins in the image with: {source}");
    let res = run(Command::new("docker")
        .current_dir(&context)
        .env("DOCKER_BUILDKIT", "1")
        .args(["build", "-f", "mosaikit/deploy/Dockerfile", "--build-arg"])
        .arg(format!("DIST={dist_rel}"))
        .args(["-t", &tag, "--secret"])
        .arg(format!("id=signing_key,src={}", key_file.display()))
        .arg("."));
    let _ = std::fs::remove_file(&key_file);
    let _ = std::fs::remove_dir_all(&context);
    res?;

    // Docker distribution ready to use in <distribution>/dist/<id>-<version>-docker
    let pg = d.docker.postgres_image.clone().unwrap_or_else(|| "postgres:17-alpine".into());
    let (img, ver) = tag.rsplit_once(':').unwrap_or((tag.as_str(), "latest"));
    let dist = dist_dir(d);
    let name = format!("{}-{}-docker", d.product.id, d.product.version);
    let out = dist.join(&name);
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    std::fs::create_dir_all(&out)?;
    std::fs::copy(root().join("deploy").join("compose.yml"), out.join("compose.yml"))?;
    copy_dir(&root().join("deploy").join("initdb"), &out.join("initdb"))?;
    for d in ["keycloak", "nginx"] {
        copy_dir(&root().join("deploy").join(d), &out.join(d))?;
    }
    let mut env_text = docker_env(img, ver, &pg);
    // --- sidecars ---
    if !d.sidecars.is_empty() {
        std::fs::write(out.join("compose.sidecars.yml"), crate::sidecars::compose(&d.sidecars))?;
        env_text.push_str(&crate::sidecars::compose_env(&d.sidecars));
    }
    // --- end sidecars ---
    std::fs::write(out.join(".env"), env_text)?;
    let tar = format!("{}-{}-image.tar", d.product.id, d.product.version);
    eprintln!("saving the image in {}", out.join(&tar).display());
    run(Command::new("docker").args(["save", "-o"]).arg(out.join(&tar)).arg(&tag))?;
    let vars = deploy_vars(img, ver, &pg);
    std::fs::write(
        out.join("README.md"),
        render(&std::fs::read_to_string(root().join("deploy").join("README.docker.md"))?, &vars),
    )?;
    // the same image for Kubernetes too
    let k = k8s_dir(img, ver)?;
    checksums(&dist)?;
    println!(
        "\nimage ready: {tag}\nDocker distribution:     {}\nKubernetes distribution: {}",
        out.display(),
        k.display()
    );
    Ok(())
}

/// Placeholders of the deploy templates (`{{id}}`, `{{image}}`...).
fn deploy_vars(image: &str, version: &str, pg: &str) -> Vec<(&'static str, String)> {
    let d = crate::dist::current();
    let (pg_repo, pg_tag) = pg.rsplit_once(':').unwrap_or((pg, "latest"));
    vec![
        ("id", d.product.id.clone()),
        ("name", d.product.name.clone()),
        ("version", version.to_string()),
        ("image", image.to_string()),
        ("postgres_image", pg.to_string()),
        ("postgres_repo", pg_repo.to_string()),
        ("postgres_tag", pg_tag.to_string()),
    ]
}

fn render(text: &str, vars: &[(&str, String)]) -> String {
    vars.iter().fold(text.to_string(), |acc, (k, v)| acc.replace(&format!("{{{{{k}}}}}"), v))
}

/// Kubernetes manifests (kustomize) in `<distribution>/dist/<id>-<version>-k8s`,
/// from the templates of `deploy/k8s`.
fn k8s_dir(image: &str, version: &str) -> Result<PathBuf> {
    let d = crate::dist::current();
    let pg = d.docker.postgres_image.clone().unwrap_or_else(|| "postgres:17-alpine".into());
    let vars = deploy_vars(image, version, &pg);
    let out = dist_dir(d).join(format!("{}-{}-k8s", d.product.id, d.product.version));
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    std::fs::create_dir_all(&out)?;
    for (rel, path) in walk_files(&root().join("deploy").join("k8s"))? {
        let dest = out.join(&rel);
        std::fs::create_dir_all(dest.parent().expect("folder"))?;
        std::fs::write(&dest, render(&std::fs::read_to_string(&path)?, &vars))?;
    }
    copy_dir(&root().join("deploy").join("initdb"), &out.join("initdb"))?;
    crate::sidecars::apply_k8s(&out, &d.sidecars, &d.product.id)?; // sidecars
                                                                   // check of the manifests, if kubectl is there (kustomize included, no cluster required)
    if which("kubectl").is_some() {
        let o = Command::new("kubectl").arg("kustomize").arg(&out).output()?;
        if !o.status.success() {
            bail!("invalid Kubernetes manifests: {}", String::from_utf8_lossy(&o.stderr));
        }
        eprintln!("Kubernetes manifests checked with kubectl kustomize");
    }
    Ok(out)
}

/// Kubernetes manifests only (without building the image).
pub fn k8s(tag: Option<String>) -> Result<()> {
    let d = crate::dist::current();
    let image = d.docker.image.clone().unwrap_or_else(|| d.product.id.clone());
    let tag = tag.unwrap_or_else(|| format!("{image}:{}", d.product.version));
    let (img, ver) = tag.rsplit_once(':').unwrap_or((tag.as_str(), "latest"));
    let out = k8s_dir(img, ver)?;
    println!(
        "\nKubernetes distribution: {}\n(the image {tag} is built with `release docker`)",
        out.display()
    );
    Ok(())
}

/// Every release of the distribution: desktop, Docker and Kubernetes. Without Docker
/// running only the Kubernetes manifests are generated (the image is built later).
pub fn all(pg_dir: Option<PathBuf>, no_pg: bool) -> Result<()> {
    desktop(pg_dir, no_pg)?;
    let docker_ok = which("docker").is_some()
        && Command::new("docker").arg("info").output().map(|o| o.status.success()).unwrap_or(false);
    if docker_ok {
        docker(None)
    } else {
        eprintln!(
            "Docker not available: skipping the image and the Docker folder, generating the Kubernetes manifests"
        );
        k8s(None)
    }
}

/// Copies the sources of a project for the Docker context: no builds, dependencies,
/// releases, development data nor git repository.
fn copy_sources(from: &Path, to: &Path) -> Result<()> {
    const SKIP: &[&str] =
        &["target", "node_modules", "dist", ".dev", ".git", "test-results", "playwright-report"];
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from).with_context(|| format!("reading {}", from.display()))? {
        let e = e?;
        let name = e.file_name();
        // by name, before the type: in a worktree node_modules is a junction, not a directory
        if SKIP.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        if e.file_type()?.is_dir() {
            copy_sources(&e.path(), &to.join(&name))?;
        } else if !name.to_string_lossy().ends_with(".key") {
            std::fs::copy(e.path(), to.join(&name))
                .with_context(|| format!("copying {}", e.path().display()))?;
        }
    }
    Ok(())
}

/// Variables of the compose (read from `.env` next to compose.yml).
fn docker_env(image: &str, version: &str, pg: &str) -> String {
    let name = &crate::dist::current().product.name;
    format!(
        "# {name} with Docker: values used by compose.yml (change them before the first start)\n\
         MOSAIKIT_IMAGE={image}\n\
         MOSAIKIT_VERSION={version}\n\
         # PostgreSQL (with PostGIS for the geographic distributions)\n\
         POSTGRES_IMAGE={pg}\n\
         POSTGRES_PASSWORD=cambia-questa-password\n\
         MOSAIKIT_DB_PASSWORD=cambia-anche-questa\n\
         # initial password of the Administrator admin, only at the first start\n\
         MOSAIKIT_ADMIN_PASSWORD=cambiami-subito\n\
         # public addresses: app (also with a base path) and plugins (a different origin)\n\
         MOSAIKIT_URL=http://localhost:8080\n\
         MOSAIKIT_PLUGIN_URL=http://localhost:8081\n\
         # ports published on the host\n\
         MOSAIKIT_HTTP_PORT=8080\n\
         MOSAIKIT_PLUGIN_PORT=8081\n\
         # true only behind a reverse proxy that sets X-Forwarded-For\n\
         MOSAIKIT_TRUST_PROXY=false\n\
         # optional profiles (README.md): COMPOSE_PROFILES=keycloak,mail,proxy\n\
         MOSAIKIT_OIDC_CLIENT_SECRET=cambia-questo-segreto\n\
         KEYCLOAK_ADMIN_PASSWORD=cambiami-subito\n"
    )
}
